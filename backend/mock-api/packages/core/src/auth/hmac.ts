/**
 * HMAC request verification — the mirror image of the signers the demo backend uses, so a
 * request the backend signs is accepted byte for byte and anything else is refused.
 *
 *   generic (custom-tool `hmac_signature`, omnidesk-api `src/modules/external/utils/hmac-signer.ts`)
 *     message = web_code + timestamp + payload
 *     payload = ''                                   for GET
 *             = goEscape(JSON.stringify(sortKeysDeep(body)))   for application/json
 *   validate-slip (omnidesk-api `src/modules/payment/validate-slip-signer.ts`)
 *     message = web_code + timestamp + JSON.stringify(sortKeysDeep({ ...signedFields,
 *               [fileField]: `sha256:<hex>;filename:<name>` }))          (no Go escaping)
 *   headers: X-Timestamp (unix seconds) · X-Signature (hex HMAC-SHA256)
 *
 * Hardening on top of the contract: constant-time compare, a ±window on the timestamp, and a
 * replay cache for STATE-CHANGING requests (key = method + url + signature).
 * ⚠️ Reads are NOT replay-checked, on purpose: a GET signature covers only web_code+timestamp, so
 *    two legitimate parallel GETs in the same second (the backend fetches profile + site rules
 *    together) carry the SAME signature. Refusing the second would break the real client.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { ReplayCache } from './replay-cache.js';

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return Object.keys(rec)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeysDeep(rec[k]);
        return acc;
      }, {});
  }
  return value;
}

/** Go's encoding/json HTML escaping — the backend applies it to JSON payloads. */
export function goEscape(json: string): string {
  return json
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export const canonicalJsonPayload = (body: unknown): string =>
  body === undefined || body === null ? '' : goEscape(JSON.stringify(sortKeysDeep(body)));

export function validateSlipCanonical(
  fields: Record<string, string>,
  file: { field: string; buffer: Buffer; filename: string },
): string {
  const map: Record<string, string> = { ...fields };
  map[file.field] = `sha256:${createHash('sha256').update(file.buffer).digest('hex')};filename:${file.filename}`;
  return JSON.stringify(sortKeysDeep(map));
}

export const sign = (secret: string, message: string): string =>
  createHmac('sha256', secret).update(message, 'utf8').digest('hex');

export type HmacVerdict = { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'mismatch' | 'replay' };

export class HmacVerifier {
  readonly #replay: ReplayCache;
  constructor(
    private readonly secret: string,
    private readonly windowSec = 300,
  ) {
    this.#replay = new ReplayCache(windowSec * 2 * 1000);
  }

  verify(
    headers: { timestamp: string | undefined; signature: string | undefined },
    messageFor: (timestamp: string) => string,
    now = Date.now(),
    /** set for writes only (see header) — omitted = no replay check */
    replayKey?: string,
  ): HmacVerdict {
    const { timestamp, signature } = headers;
    if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature))
      return { ok: false, reason: 'missing' };
    if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > this.windowSec) return { ok: false, reason: 'stale' };
    const expected = Buffer.from(sign(this.secret, messageFor(timestamp)), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'mismatch' };
    if (replayKey !== undefined && !this.#replay.claim(`${replayKey} ${signature.toLowerCase()}`, now)) return { ok: false, reason: 'replay' };
    return { ok: true };
  }
}
