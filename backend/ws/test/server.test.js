'use strict';
/* ────────────────────────────────────────────────────────────────
 * [FEAT-20260808-WSTICKET] Step-0 test harness (zero new deps).
 *
 * Proves:
 *   1. BEFORE/AFTER — a JWT client still connects and receives events
 *      filtered by its allowed_hooks, and is rejected with 4001 on a bad
 *      token (token path byte-identical).
 *   2. A valid ticket yields the SAME filtered fan-out as an equivalent
 *      JWT — the allowedHooks INVARIANT.
 *   3. A missing/expired ticket is rejected with 4001 (mirrors bad token).
 *   4. The ticket is single-use (GETDEL): a second use is rejected.
 *
 * No real Redis: `ioredis` is swapped for an in-process fake via the
 * require cache BEFORE server.js is loaded. Real `jsonwebtoken` is used
 * so the token path exercises the real verify.
 * ──────────────────────────────────────────────────────────────── */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

const SECRET = 'test-secret-prod';
const PORT = 18099;

// ── Fake ioredis ────────────────────────────────────────────────
// One "primary" instance (the subscriber). `.duplicate()` returns a
// sibling that shares the same in-memory ticket store, mirroring how a
// real duplicate() shares the same Redis keyspace.
const ticketStore = new Map(); // key -> raw JSON string

class FakeRedis extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    // Announce ready on next tick like a real connection.
    setImmediate(() => { this.emit('connect'); this.emit('ready'); });
  }
  subscribe(...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (cb) cb(null, args.length);
    return Promise.resolve(args.length);
  }
  // Atomic get-and-delete, single-use — matches Redis GETDEL semantics.
  async getdel(key) {
    const v = ticketStore.has(key) ? ticketStore.get(key) : null;
    ticketStore.delete(key);
    return v;
  }
  duplicate() { return new FakeRedis(); }
  async quit() { return 'OK'; }
  // Test hook: deliver a pub/sub message to server.js's `sub.on('message')`.
  __deliver(channel, message) { this.emit('message', channel, message); }
}

let primary; // captured first-constructed FakeRedis == the subscriber `sub`
const OrigFakeRedis = FakeRedis;
function TrackingRedis(...a) {
  const inst = new OrigFakeRedis(...a);
  if (!primary) primary = inst;
  return inst;
}
TrackingRedis.prototype = FakeRedis.prototype;

// Inject the fake into the require cache under ioredis's resolved id.
const ioredisId = require.resolve('ioredis', {
  paths: [path.join(__dirname, '..', 'node_modules')],
});
require.cache[ioredisId] = new Module(ioredisId, module);
require.cache[ioredisId].filename = ioredisId;
require.cache[ioredisId].loaded = true;
require.cache[ioredisId].exports = Object.assign(TrackingRedis, { default: TrackingRedis });

// Env for server.js. PROD only; DEV unset (mirrors prod-only deploy).
process.env.PORT = String(PORT);
process.env.REDIS_HOST = '127.0.0.1';
process.env.PROD_JWT_SECRET = SECRET;
process.env.PROD_WS_CHANNEL = 'ticket_events_prod';

// Boot the REAL server.js against the fake Redis.
require('../server.js');

const WS_URL = (qs) => `ws://127.0.0.1:${PORT}/?${qs}`;
const CHANNEL = 'ticket_events_prod';

function eventFor(hookId) {
  return JSON.stringify({ type: 'ticket.updated', data: { hook_id: hookId, foo: 1 } });
}

// Connect and resolve with the TERMINAL outcome { ws, opened, closeCode }.
//
// Note on timing: the token path rejects synchronously and closes before
// the client handshake completes (client never sees `open`). The ticket
// path `await`s a Redis GETDEL, so the handshake completes and the client
// briefly sees `open` before the 4001 close lands. Either way a rejected
// connection ends CLOSED with code 4001 and delivers zero events, so we
// report `opened:true` only for connections that STAY open past a short
// settle window.
function connect(qs, settleMs = 100) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL(qs));
    let closeCode = null;
    let closed = false;
    ws.on('close', (code) => { closed = true; closeCode = code; });
    ws.on('error', () => {}); // close carries the code
    setTimeout(() => {
      resolve({ ws, opened: !closed, closeCode });
    }, settleMs);
  });
}

// Collect messages received over `ms` after delivering `events`.
function collect(ws, deliver, ms = 120) {
  return new Promise((resolve) => {
    const got = [];
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    deliver();
    setTimeout(() => resolve(got), ms);
  });
}

test.before(async () => {
  // Wait until server + fake redis are ready.
  await new Promise((r) => setTimeout(r, 150));
});

test('token path: valid JWT connects and events are filtered by allowed_hooks', async () => {
  const token = jwt.sign({ user_id: 'op1', allowed_hooks: ['h1', 'h2'] }, SECRET);
  const { ws, opened } = await connect(`token=${token}&env=prod`);
  assert.strictEqual(opened, true, 'JWT client should connect');

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1')); // allowed
    primary.__deliver(CHANNEL, eventFor('h9')); // NOT allowed
  });
  const hooks = got.map((e) => e.data.hook_id);
  assert.deepStrictEqual(hooks, ['h1'], 'only allowed hook_id delivered');
  ws.close();
});

test('token path: invalid JWT is rejected with 4001, no open', async () => {
  const { opened, closeCode } = await connect(`token=not-a-jwt&env=prod`);
  assert.strictEqual(opened, false);
  assert.strictEqual(closeCode, 4001, 'bad token → 4001');
});

test('token path: missing token is rejected with 4001', async () => {
  const { opened, closeCode } = await connect(`env=prod`);
  assert.strictEqual(opened, false);
  assert.strictEqual(closeCode, 4001);
});

test('INVARIANT: valid ticket yields SAME filtered fan-out as JWT', async () => {
  const t = 'tkt-valid-1';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'op1', allowedHooks: ['h1', 'h2'], env: 'prod',
  }));
  const { ws, opened } = await connect(`ticket=${t}`);
  assert.strictEqual(opened, true, 'valid ticket should connect');

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1')); // allowed
    primary.__deliver(CHANNEL, eventFor('h9')); // NOT allowed
  });
  const hooks = got.map((e) => e.data.hook_id);
  // Byte-identical to the JWT case above.
  assert.deepStrictEqual(hooks, ['h1'], 'ticket path filters identically to JWT');
  ws.close();
});

test('ticket path: missing/expired ticket is rejected with 4001', async () => {
  const { opened, closeCode } = await connect(`ticket=does-not-exist`);
  assert.strictEqual(opened, false);
  assert.strictEqual(closeCode, 4001, 'missing ticket → 4001 (mirrors bad token)');
});

test('ticket path: single-use — second use of same ticket is rejected', async () => {
  const t = 'tkt-once';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'op1', allowedHooks: ['h1'], env: 'prod',
  }));
  const first = await connect(`ticket=${t}`);
  assert.strictEqual(first.opened, true, 'first use connects');
  first.ws.close();

  const second = await connect(`ticket=${t}`);
  assert.strictEqual(second.opened, false, 'second use rejected');
  assert.strictEqual(second.closeCode, 4001);
});

/* ────────────────────────────────────────────────────────────────
 * [FIX-20260818-WSSCOPE] compatibility matrix — one server, three backends.
 *
 * This server must keep serving backends built from `main`, `dev` and the `p2`
 * lane at the same time. Their ticket payloads are shaped identically, so the
 * version is read from PRESENCE: a payload carrying `is_super` came from a
 * backend that knows the new rule; one without it did not.
 *
 * The case immediately below is the SEAMLESS pin for the old shape — it existed
 * before this change and must keep passing untouched. The block after it is the
 * new shape. Together they are the whole contract: same server, both behaviours,
 * decided per connection.
 *
 * The payloads here are written the way each backend writes them, straight into
 * the ticket store — no backend is run, and `dev` is never modified.
 * ──────────────────────────────────────────────────────────────── */
test('INVARIANT: allowedHooks:null (all hooks) is unfiltered from a ticket', async () => {
  const t = 'tkt-null-hooks';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'admin', allowedHooks: null, env: 'prod',
  }));
  const { ws, opened } = await connect(`ticket=${t}`);
  assert.strictEqual(opened, true);

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1'));
    primary.__deliver(CHANNEL, eventFor('h9'));
  });
  const hooks = got.map((e) => e.data.hook_id).sort();
  assert.deepStrictEqual(hooks, ['h1', 'h9'], 'null allowedHooks → no filtering');
  ws.close();
});

/* ── NEW SHAPE (p2): `is_super` present ⇒ null is unambiguous ── */

test('[WSSCOPE] new payload, super: null still means every hook', async () => {
  const t = 'tkt-new-super';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'admin', allowedHooks: null, env: 'prod', is_super: true,
  }));
  const { ws, opened } = await connect(`ticket=${t}`);
  assert.strictEqual(opened, true);

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1'));
    primary.__deliver(CHANNEL, eventFor('h9'));
  });
  assert.deepStrictEqual(
    got.map((e) => e.data.hook_id).sort(), ['h1', 'h9'],
    'a super user on the new payload is still unfiltered',
  );
  ws.close();
});

test('[WSSCOPE] ⭐ new payload, NOT super, no list: receives nothing', async () => {
  // This is the hole. On the old shape this same payload was unfiltered, which
  // is how 8 of the 11 live accounts saw every tenant's events.
  const t = 'tkt-new-notsuper';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'op-no-list', allowedHooks: null, env: 'prod', is_super: false,
  }));
  const { ws, opened } = await connect(`ticket=${t}`);
  assert.strictEqual(opened, true, 'it connects — it just receives nothing');

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1'));
    primary.__deliver(CHANNEL, eventFor('h9'));
  });
  assert.deepStrictEqual(got, [], 'no list and not super ⇒ no events at all');
  ws.close();
});

test('[WSSCOPE] new payload with a list filters exactly as the old one did', async () => {
  const t = 'tkt-new-list';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'op1', allowedHooks: ['h1'], env: 'prod', is_super: false,
  }));
  const { ws, opened } = await connect(`ticket=${t}`);
  assert.strictEqual(opened, true);

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1'));
    primary.__deliver(CHANNEL, eventFor('h9'));
  });
  assert.deepStrictEqual(got.map((e) => e.data.hook_id), ['h1']);
  ws.close();
});

test('[WSSCOPE] ⭐ OLD payload with null is STILL unfiltered — main/dev untouched', async () => {
  // The seamless guarantee, stated as its own case: an older backend cannot
  // describe who is super, so tightening its clients would cut them off.
  const t = 'tkt-old-null-again';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'admin-old', allowedHooks: null, env: 'prod',
  }));
  const { ws, opened } = await connect(`ticket=${t}`);
  assert.strictEqual(opened, true);

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1'));
    primary.__deliver(CHANNEL, eventFor('h9'));
  });
  assert.deepStrictEqual(
    got.map((e) => e.data.hook_id).sort(), ['h1', 'h9'],
    'no is_super key ⇒ old rules ⇒ unchanged',
  );
  ws.close();
});

test('[WSSCOPE] old payload with an empty list receives nothing, as before', async () => {
  const t = 'tkt-old-empty';
  ticketStore.set(`ws_ticket:${t}`, JSON.stringify({
    userId: 'op-empty', allowedHooks: [], env: 'prod',
  }));
  const { ws, opened } = await connect(`ticket=${t}`);
  assert.strictEqual(opened, true);

  const got = await collect(ws, () => {
    primary.__deliver(CHANNEL, eventFor('h1'));
  });
  assert.deepStrictEqual(got, [], '[] already meant nothing — unchanged');
  ws.close();
});

test.after(() => {
  // Server has SIGTERM/SIGINT handlers; force-exit so the runner ends.
  setImmediate(() => process.exit(0));
});
