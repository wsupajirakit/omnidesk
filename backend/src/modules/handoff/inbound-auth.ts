import * as crypto from 'node:crypto';

import { coerceString } from './coerce-string';
import type { HandoffTargetInboundAuth } from './schemas/handoff-target.schema';

/**
 * Verification of an inbound callback's signature.
 *
 * LIFTED from legacy-api/src/services/handoff/inboundAuth.js.
 *
 * This is THE security boundary for the two public
 * `POST /api/handoff/callback/:target_key[/:job_ref]` routes: they are on the
 * skip-auth list (apiRoutes.js:127-128) so no bearer token is checked, and the
 * rate limiter in front of them is deliberately fail-open. If this function
 * says ok, the request is trusted. Nothing else stands between an attacker and
 * a write.
 *
 * Pure — no DB, no network, no clock except the injectable `now` — so it can be
 * tested directly and extended with a new mode without touching a caller.
 */

/** The verdicts legacy returns; the reason string is echoed to the caller. */
export type InboundAuthReason =
  'ok' | 'bad_signature' | 'unauthorized' | 'malformed';

export interface InboundAuthVerdict {
  ok: boolean;
  reason: InboundAuthReason;
}

export interface VerifyInboundInput {
  inboundAuth?: HandoffTargetInboundAuth;
  /** The decrypted inbound secret (or password). */
  secret?: string;
  /** The raw request body. A Buffer, never a re-serialised object. */
  rawBody?: Buffer;
  /** Lower-cased request headers. */
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  /** Injectable for tests. */
  now?: number;
}

/**
 * Constant-time compare that never throws on a length mismatch.
 *
 * `crypto.timingSafeEqual` throws when the two buffers differ in length, so the
 * length is checked first. Returning early on that check leaks only the length
 * of the signature, which is already public (it is a fixed-width hex or base64
 * digest).
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(String(a ?? ''), 'utf8');
  const bufferB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function computeHmac(
  secret: string,
  message: Buffer | string,
  algorithm: string | undefined,
  encoding: 'hex' | 'base64',
): string {
  return crypto
    .createHmac(algorithm || 'sha256', String(secret ?? ''))
    .update(message)
    .digest(encoding);
}

/** Reads one header, flattening the array form Node can produce. */
function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = headers[name];
  if (Array.isArray(value)) return String(value[0] ?? '');
  return String(value ?? '');
}

/**
 * Verifies an inbound callback against the target's `inbound_auth` config.
 *
 * Modes, all copied verbatim from legacy:
 *   hmac        — HMAC(secret, signed_payload), compared constant-time
 *   bearer      — inbound_secret equals the presented bearer token
 *   basic       — inbound_password equals the presented basic password
 *   query_token — inbound_secret equals `?token=`
 *
 * `signed_payload` for hmac is `raw_body` or `timestamp.raw_body`; the latter
 * adds a replay window governed by `tolerance_sec`.
 */
export function verifyInbound({
  inboundAuth = {},
  secret = '',
  rawBody = Buffer.alloc(0),
  headers = {},
  query = {},
  now = Date.now(),
}: VerifyInboundInput): InboundAuthVerdict {
  const mode = inboundAuth.mode || 'hmac';
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody ?? ''), 'utf8');

  if (mode === 'bearer') {
    const authorization = header(headers, 'authorization');
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    // An empty secret must never authenticate an empty token, hence the
    // `!!secret` guard — legacy has the same one.
    const good = Boolean(secret) && safeEqual(secret, token);
    return { ok: good, reason: good ? 'ok' : 'unauthorized' };
  }

  if (mode === 'basic') {
    const authorization = header(headers, 'authorization');
    if (!authorization.startsWith('Basic ')) {
      return { ok: false, reason: 'unauthorized' };
    }
    let decoded = '';
    try {
      decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    const password = decoded.includes(':')
      ? decoded.slice(decoded.indexOf(':') + 1)
      : decoded;
    const good = Boolean(secret) && safeEqual(secret, password);
    return { ok: good, reason: good ? 'ok' : 'unauthorized' };
  }

  if (mode === 'query_token') {
    const token = coerceString(query['token']);
    const good = Boolean(secret) && safeEqual(secret, token);
    return { ok: good, reason: good ? 'ok' : 'unauthorized' };
  }

  // Default: hmac.
  const headerName = String(
    inboundAuth.header_name || 'X-Signature',
  ).toLowerCase();
  const presented = header(headers, headerName);
  if (!presented || !secret) return { ok: false, reason: 'bad_signature' };

  let message: Buffer = body;
  if (inboundAuth.signed_payload === 'timestamp.raw_body') {
    const timestampHeader = String(
      inboundAuth.timestamp_header || '',
    ).toLowerCase();
    const timestamp = header(headers, timestampHeader);
    if (!timestamp) return { ok: false, reason: 'malformed' };

    // Replay guard. A 10-digit timestamp is seconds, longer is milliseconds —
    // the same heuristic legacy uses.
    const toleranceSec = Number(inboundAuth.tolerance_sec ?? 300);
    const timestampMs =
      timestamp.length > 10 ? Number(timestamp) : Number(timestamp) * 1000;
    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(now - timestampMs) > toleranceSec * 1000
    ) {
      return { ok: false, reason: 'unauthorized' };
    }
    message = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]);
  }

  const algorithm = inboundAuth.signature_algo || 'sha256';
  // Senders differ on digest encoding, so both forms are accepted — legacy
  // does the same. Both comparisons run regardless of the first result, which
  // keeps the work constant rather than short-circuiting on a match.
  const expectedHex = computeHmac(secret, message, algorithm, 'hex');
  const expectedBase64 = computeHmac(secret, message, algorithm, 'base64');
  const good =
    safeEqual(expectedHex, presented) || safeEqual(expectedBase64, presented);
  return { ok: good, reason: good ? 'ok' : 'bad_signature' };
}
