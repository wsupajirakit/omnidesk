require('dotenv').config();
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');

/* ────────────────────────────────────────────────────────────────
 * omnidesk-ws — WebSocket fan-out for ticket events.
 *
 * The backend never talks to browsers directly: it PUBLISHes an event
 * to Redis, and this process fans that event out to every authenticated
 * dashboard client. Keeping it separate means a slow/blocked API worker
 * can never stall realtime delivery, and this process holds no state
 * worth persisting — it can be restarted at any time.
 *
 *   legacy-api ──PUBLISH──> Redis ──SUBSCRIBE──> omnidesk-ws ──WS──> dashboards
 *
 * Wire protocol is intentionally identical to the previous server so
 * existing clients need no changes:
 *   connect: wss://host?token=<jwt>&env=<prod|dev>
 *   server → client: the raw Redis payload, forwarded verbatim
 * ──────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────
 * [FEAT-20260808-WSTICKET] HttpOnly-auth migration — Step 0 (additive)
 *
 * Goal: let the handshake authenticate from a single-use Redis "ticket"
 * in ADDITION to the existing `?token=<jwt>` param. This is inert until
 * the FE starts sending `?ticket=`; the token path stays byte-identical.
 *
 *   FE ──GET ws_ticket──> BE mints Redis key ─┐
 *   FE ──WS ?ticket=<t>──> omnidesk-ws GETDEL ─────┘ (single-use)
 *
 * DB-EFFECT: none. No database is touched. The ticket path only performs
 * an atomic GETDEL on an EPHEMERAL Redis key (`ws_ticket:<t>`) that the
 * backend mints; omnidesk-ws never writes it and holds no persistent state.
 *
 * CRITICAL INVARIANT: `ws.allowedHooks` must be derived from the ticket
 * payload EXACTLY as it is from the JWT — same normalization — otherwise
 * the per-tenant fan-out filter (`data.hook_id ∈ ws.allowedHooks`) would
 * behave differently by auth method and leak every tenant's events to
 * every operator. Both paths funnel through normalizeAllowedHooks().
 * ──────────────────────────────────────────────────────────────── */

const PORT = Number(process.env.PORT) || 8080;
const PROD_SECRET = process.env.PROD_JWT_SECRET;
const DEV_SECRET = process.env.DEV_JWT_SECRET;
const PROD_CHANNEL = process.env.PROD_WS_CHANNEL || 'ticket_events_prod';
const DEV_CHANNEL = process.env.DEV_WS_CHANNEL || 'ticket_events_dev';
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS) || 30000;
// Cap per environment so a runaway client loop can't exhaust memory.
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS_PER_ENV) || 500;

// Fail fast and loudly: a missing secret would otherwise mean every
// connection is rejected at runtime with no obvious cause.
const missing = [];
if (!PROD_SECRET) missing.push('PROD_JWT_SECRET');
if (!process.env.REDIS_HOST) missing.push('REDIS_HOST');
if (missing.length) {
  console.error(`[FATAL] missing required env: ${missing.join(', ')}`);
  process.exit(1);
}
if (!DEV_SECRET) {
  console.warn('[WARN] DEV_JWT_SECRET not set — env=dev connections will be rejected');
}

/* ── allowed-hooks normalization (SHARED — invariant enforcer) ──── */
// [FEAT-20260808-WSTICKET] Single source of truth for how a raw
// allowed_hooks value becomes `ws.allowedHooks`. BOTH the JWT path and
// the ticket path MUST call this so the fan-out filter is byte-identical
// regardless of auth method.
//   Array  -> array of strings (fan-out filters to these hook_ids)
//   null   -> null            (explicit "all hooks", no filtering)
//   other  -> undefined       (no filtering — legacy/absent behavior)
function normalizeAllowedHooks(raw) {
  return Array.isArray(raw)
    ? raw.map(String)
    : (raw === null ? null : undefined);
}

/* ── [FIX-20260818-WSSCOPE] what an absent hook list is allowed to mean ──
 *
 * THE DEFECT. The fan-out below filters only when `allowedHooks` is an ARRAY, so
 * `null` and `undefined` both mean "send everything". The backend produces `null`
 * for two different reasons and only one is intentional:
 *   ticket path — `null` means "this caller is a super user";
 *   token path  — `null` is just the raw JWT claim of an account that has no
 *                 `allowed_hooks` field, which is 8 of the 11 live accounts,
 *                 `admin` among them. Every one of them received every OA's
 *                 events.
 *
 * THE COMPATIBILITY PROBLEM. This process must keep serving backends from three
 * branches at once (main, dev, p2). Their ticket payloads are shaped identically,
 * so the version cannot be read from the shape — and a process-level flag would
 * flip behaviour for main/dev clients too, which is the outage this avoids.
 *
 * THE ANSWER. Read PRESENCE, per connection: a payload carrying `is_super` was
 * minted by a backend that knows about this rule, so its `null` can be trusted to
 * mean exactly "super". A payload WITHOUT the field came from an older backend,
 * where `null` is ambiguous — those keep the old, permissive behaviour, because
 * silently tightening them would cut off super users the old backend cannot
 * describe. ของเก่าไม่รู้จัก field นี้ ⇒ ใช้กติกาเดิม ไม่กระทบ
 *
 * @returns the value to store on the socket:
 *   array      → filter to these hook ids
 *   null       → no filter (super, or an old payload)
 *   'DENY_ALL' → filter everything out (new payload, not super, no list)
 */
const DENY_ALL = 'DENY_ALL';

function resolveScope(payload, normalized) {
  const marksVersion =
    payload !== null &&
    typeof payload === 'object' &&
    Object.prototype.hasOwnProperty.call(payload, 'is_super');

  // Old backend: nothing changes for it, ever.
  if (!marksVersion) return normalized;

  // New backend: `null` is now unambiguous.
  if (payload.is_super === true) return null;
  return Array.isArray(normalized) ? normalized : DENY_ALL;
}

/* ── Redis subscriber ─────────────────────────────────────────── */
const sub = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT) || 6379,
  username: process.env.REDIS_USER || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 0,
  // Keep retrying forever: Redis coming back should heal the process
  // without an operator restarting it.
  retryStrategy: (times) => Math.min(times * 200, 5000),
  maxRetriesPerRequest: null,
});

let redisReady = false;
sub.on('connect', () => console.log('[redis] connecting…'));
sub.on('ready', () => {
  redisReady = true;
  console.log('[redis] ready');
});
sub.on('error', (err) => console.error('[redis] error:', err.message));
sub.on('close', () => {
  redisReady = false;
  console.warn('[redis] connection closed');
});

sub.subscribe(PROD_CHANNEL, DEV_CHANNEL, (err) => {
  if (err) console.error('[redis] subscribe failed:', err.message);
  else console.log(`[redis] subscribed: ${PROD_CHANNEL}, ${DEV_CHANNEL}`);
});

/* ── ticket consumer ──────────────────────────────────────────── */
// [FEAT-20260808-WSTICKET] Once an ioredis client enters subscriber mode
// it can ONLY run subscribe/ping/quit — a GETDEL on `sub` throws
// "Connection in subscriber mode". So we clone the SAME connection
// config with .duplicate(): no new dependency, no new config, no new
// secret — same Redis instance/db/auth `sub` already uses.
const ticketRedis = sub.duplicate();
ticketRedis.on('error', (err) => console.error('[redis:ticket] error:', err.message));

// Atomically consume a single-use ticket. Returns the parsed payload
// { userId, allowedHooks, env } or null if the key is missing/expired.
// GETDEL guarantees single-use: two concurrent handshakes can't both win.
async function consumeTicket(t) {
  let raw;
  try {
    raw = await ticketRedis.getdel(`ws_ticket:${t}`);
  } catch (err) {
    console.error('[ws:ticket] getdel failed:', err.message);
    return null;
  }
  if (!raw) return null; // missing or already consumed/expired
  try {
    return JSON.parse(raw);
  } catch {
    return null; // corrupt payload → treat as invalid ticket
  }
}

/* ── client registry ──────────────────────────────────────────── */
const clients = { prod: new Set(), dev: new Set() };
const stats = { connected: 0, rejected: 0, broadcast: 0, startedAt: new Date().toISOString() };

/* ── HTTP surface (health only) ───────────────────────────────── */
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    // Report degraded (503) when Redis is down: the process is up but
    // cannot deliver events, and a load balancer should know that.
    const healthy = redisReady;
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'ok' : 'degraded',
      redis: redisReady ? 'connected' : 'disconnected',
      clients: { prod: clients.prod.size, dev: clients.dev.size },
      stats,
      uptime_s: Math.round(process.uptime()),
    }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

/* ── WebSocket ────────────────────────────────────────────────── */
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });

wss.on('connection', async (ws, req) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    stats.rejected++;
    ws.close(4000, 'Bad request');
    return;
  }

  const token = url.searchParams.get('token');
  // [FEAT-20260808-WSTICKET] new, additive query param — inert until FE sends it.
  const ticket = url.searchParams.get('ticket');
  const env = url.searchParams.get('env') === 'dev' ? 'dev' : 'prod';
  const secret = env === 'dev' ? DEV_SECRET : PROD_SECRET;

  // Resolved auth: identity + allowedHooks, produced by EITHER path below.
  let authUserId;
  let authAllowedHooks;
  // env used for client bucketing/channel. Ticket payload may carry its own
  // env; default to the query-derived env for the token path.
  let authEnv = env;

  if (ticket) {
    /* ── [FEAT-20260808-WSTICKET] ticket path (single-use Redis) ──
     * Present ONLY when the FE opts in. Rejection behavior mirrors an
     * invalid token: close 4001, no server-initiated reconnect. */
    const payload = await consumeTicket(ticket);
    if (!payload) {
      stats.rejected++;
      console.warn(`[ws] auth rejected via ticket reason=missing_or_expired`);
      ws.close(4001, 'Unauthorized');
      return;
    }
    // Ticket env wins if present & valid; else fall back to query env.
    authEnv = payload.env === 'dev' ? 'dev' : (payload.env === 'prod' ? 'prod' : env);
    authUserId = payload.userId || 'unknown';
    // INVARIANT: same normalization as the JWT path (see normalizeAllowedHooks).
    // [FIX-20260818-WSSCOPE] resolveScope then decides what an ABSENT list may
    // mean, using whether this payload carries `is_super` — see its header.
    authAllowedHooks = resolveScope(
      payload,
      normalizeAllowedHooks(payload.allowedHooks),
    );
  } else {
    /* ── token path (UNCHANGED — byte-identical to pre-Step-0) ── */
    if (!token || !secret) {
      stats.rejected++;
      ws.close(4001, 'Unauthorized');
      return;
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (err) {
      stats.rejected++;
      // Log the reason (expired vs malformed) but never the token itself.
      console.warn(`[ws] auth rejected env=${env} reason=${err.name}`);
      ws.close(4001, 'Unauthorized');
      return;
    }
    authUserId = payload.user_id || payload.username || 'unknown';
    // INVARIANT: same normalization as the ticket path (see normalizeAllowedHooks).
    /* [FIX-20260818-WSSCOPE] A raw JWT never carries `is_super` — no backend
       puts it there — so resolveScope always takes the legacy branch here and
       this path is byte-identical to before. It is written this way, rather than
       calling normalizeAllowedHooks alone, so that the two paths keep sharing one
       decision: if a future backend does add the claim, both honour it the same
       way instead of drifting apart, which is the invariant this file's header
       already insists on. */
    authAllowedHooks = resolveScope(
      payload,
      normalizeAllowedHooks(payload.allowed_hooks),
    );
  }

  if (clients[authEnv].size >= MAX_CLIENTS) {
    stats.rejected++;
    console.warn(`[ws] capacity reached env=${authEnv} (${MAX_CLIENTS}) — rejecting`);
    ws.close(4029, 'Too many connections');
    return;
  }

  ws.isAlive = true;
  ws.env = authEnv;
  ws.userId = authUserId;
  ws.allowedHooks = authAllowedHooks;
  clients[authEnv].add(ws);
  stats.connected++;
  /* [FIX-20260818-WSVIA · plan W2] `via=` records WHICH auth path a client used.
   *
   * Until now this was the only success log and it sits after the ticket and
   * token branches converge, so nothing anywhere recorded the method. That makes
   * the question "is anyone still connecting with ?token=?" unanswerable from
   * the logs — and that question gates removing the token path at all, since two
   * older dashboards exist and their presence on disk proves nothing about what
   * is deployed.
   *
   * Purely additive: one field appended to an existing line. Nothing branches on
   * it. เพิ่มข้อมูล ไม่เปลี่ยนพฤติกรรม */
  console.log(`[ws] + user=${ws.userId} env=${authEnv} via=${ticket ? 'ticket' : 'token'} total=${clients[authEnv].size} allowed_hooks=${ws.allowedHooks ? ws.allowedHooks.length : 'all'}`);

  ws.on('pong', () => { ws.isAlive = true; });

  // [FEAT-20260808-WSTICKET] bucket by authEnv so ticket-auth clients are
  // removed from the same set they were added to (token path: authEnv === env).
  const drop = () => {
    if (clients[authEnv].delete(ws)) {
      console.log(`[ws] - user=${ws.userId} env=${authEnv} total=${clients[authEnv].size}`);
    }
  };
  ws.on('close', drop);
  ws.on('error', drop);
});

/* ── heartbeat: reap connections that died without a close frame ── */
const heartbeat = setInterval(() => {
  for (const set of Object.values(clients)) {
    for (const ws of set) {
      if (!ws.isAlive) {
        set.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { set.delete(ws); }
    }
  }
}, HEARTBEAT_MS);

/* ── fan-out ──────────────────────────────────────────────────── */
sub.on('message', (channel, message) => {
  const env = channel === DEV_CHANNEL ? 'dev' : 'prod';
  let eventHookId = null;
  try {
    const parsed = JSON.parse(message);
    eventHookId = parsed?.data?.hook_id || parsed?.data?.line_oa_hook_id || null;
    if (eventHookId) eventHookId = String(eventHookId);
  } catch {}

  let sent = 0;
  for (const ws of clients[env]) {
    if (ws.readyState !== WebSocket.OPEN) continue;

    // Filter event delivery by client allowed_hooks (transport-level security)
    /* [FIX-20260818-WSSCOPE] DENY_ALL is what a NEW-format payload resolves to
       when the caller is not super and carries no list. It cannot be expressed as
       an empty array without changing what the log line and the old payloads
       mean, so it is its own value and it is checked first. */
    if (ws.allowedHooks === DENY_ALL) continue;
    if (Array.isArray(ws.allowedHooks) && eventHookId) {
      if (!ws.allowedHooks.includes(eventHookId)) {
        continue;
      }
    }

    try {
      ws.send(message);
      sent++;
    } catch (err) {
      clients[env].delete(ws);
    }
  }
  if (sent > 0) {
    stats.broadcast += sent;
    console.log(`[ws] → ${sent} client(s) env=${env}: ${message.slice(0, 80)}`);
  }
});

/* ── lifecycle ────────────────────────────────────────────────── */
server.listen(PORT, () => {
  console.log(`[omnidesk-ws] listening on :${PORT} (heartbeat ${HEARTBEAT_MS}ms, max ${MAX_CLIENTS}/env)`);
});

// Close sockets before exiting so clients reconnect immediately on the
// next instance rather than waiting for their own timeout to fire.
function shutdown(signal) {
  console.log(`[omnidesk-ws] ${signal} — shutting down`);
  clearInterval(heartbeat);
  for (const set of Object.values(clients)) {
    for (const ws of set) {
      try { ws.close(1001, 'Server shutting down'); } catch { /* already gone */ }
    }
  }
  sub.quit().catch(() => {});
  ticketRedis.quit().catch(() => {}); // [FEAT-20260808-WSTICKET]
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
