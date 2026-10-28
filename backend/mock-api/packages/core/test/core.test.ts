import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  BaseEnv,
  HmacVerifier,
  JsonStore,
  JwtIssuer,
  assertSecrets,
  canonicalJsonPayload,
  loadConfig,
  validateSlipCanonical,
} from '../src/index.js';

const SECRET = 'x'.repeat(40);
const now = Date.UTC(2026, 9, 19, 12, 0, 0);
const ts = String(Math.floor(now / 1000));
const be = (msg: string) => createHmac('sha256', SECRET).update(msg, 'utf8').digest('hex');

test('hmac: parallel GETs with the same signature are both accepted (no replay check on reads)', () => {
  const v = new HmacVerifier(SECRET);
  const sig = be(`WEB01${ts}`);
  assert.deepEqual(v.verify({ timestamp: ts, signature: sig }, (t) => `WEB01${t}`, now), { ok: true });
  assert.deepEqual(v.verify({ timestamp: ts, signature: sig }, (t) => `WEB01${t}`, now), { ok: true });
});

test('hmac: a write replayed to the same method+url is refused; the same signature on another url is not a replay', () => {
  const v = new HmacVerifier(SECRET);
  const sig = be(`WEB01${ts}`);
  assert.equal(v.verify({ timestamp: ts, signature: sig }, (t) => `WEB01${t}`, now, 'POST /a').ok, true);
  assert.deepEqual(v.verify({ timestamp: ts, signature: sig }, (t) => `WEB01${t}`, now, 'POST /a'), { ok: false, reason: 'replay' });
  assert.equal(v.verify({ timestamp: ts, signature: sig }, (t) => `WEB01${t}`, now, 'POST /b').ok, true);
});

test('hmac: JSON body is canonical (sorted keys, Go escaping) exactly like the backend', () => {
  assert.equal(canonicalJsonPayload({ b: '<x&y>', a: 1 }), '{"a":1,"b":"\\u003cx\\u0026y\\u003e"}');
  const v = new HmacVerifier(SECRET);
  const msg = `WEB01${ts}${canonicalJsonPayload({ line_user_id: 'U1', web_code: 'WEB01' })}`;
  assert.equal(v.verify({ timestamp: ts, signature: be(msg) }, () => msg, now).ok, true);
});

test('hmac: stale, wrong and malformed signatures are refused', () => {
  const v = new HmacVerifier(SECRET, 300);
  const old = String(Number(ts) - 301);
  assert.deepEqual(v.verify({ timestamp: old, signature: be(`W${old}`) }, (t) => `W${t}`, now), { ok: false, reason: 'stale' });
  assert.deepEqual(v.verify({ timestamp: ts, signature: be('other') }, (t) => `W${t}`, now), { ok: false, reason: 'mismatch' });
  assert.deepEqual(v.verify({ timestamp: ts, signature: 'zz' }, (t) => `W${t}`, now), { ok: false, reason: 'missing' });
  assert.deepEqual(v.verify({ timestamp: undefined, signature: undefined }, (t) => t, now), { ok: false, reason: 'missing' });
});

test('hmac: validate-slip canonical hashes the file and sorts the map (no Go escaping)', () => {
  const c = validateSlipCanonical({ web_code: 'W', line_user_id: 'U1' }, { field: 'upload_file', buffer: Buffer.from('img'), filename: 'slip.jpg' });
  assert.match(c, /^\{"line_user_id":"U1","upload_file":"sha256:[0-9a-f]{64};filename:slip\.jpg","web_code":"W"\}$/);
});

test('jwt: access verifies, refresh is single-use, wrong type and garbage are refused', async () => {
  const j = new JwtIssuer({ secret: SECRET, issuer: 't', accessTtlSec: 60, refreshTtlSec: 120 });
  const t = await j.issue('svc');
  assert.equal(await j.verify(t.access_token, 'access'), 'svc');
  assert.equal(await j.verify(t.access_token, 'refresh'), null);
  assert.equal(await j.verify(t.refresh_token, 'refresh'), 'svc');
  assert.equal(await j.verify(t.refresh_token, 'refresh'), null);
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x","typ":"access"}').toString('base64url')}.`;
  assert.equal(await j.verify(none, 'access'), null);
});

test('json store: reads are copies, writes persist, reset restores the seed', () => {
  const s = new JsonStore({ n: 1, list: [1] });
  s.read().list.push(9);
  assert.deepEqual(s.read(), { n: 1, list: [1] });
  s.write((d) => { d.n = 2; });
  assert.equal(s.read().n, 2);
  s.reset();
  assert.equal(s.read().n, 1);
});

test('config: defaults + coercion; production refuses weak secrets', () => {
  const c = loadConfig(BaseEnv, { RATE_LIMIT_MAX: '5' });
  assert.equal(c.RATE_LIMIT_MAX, 5);
  assert.equal(c.HOST, '127.0.0.1');
  assert.throws(() => loadConfig(BaseEnv, { NODE_ENV: 'staging' }), /invalid environment/);
  assert.throws(() => assertSecrets('production', { S: 'short' }), /S/);
  assert.doesNotThrow(() => assertSecrets('production', { S: SECRET }));
  assert.doesNotThrow(() => assertSecrets('development', { S: '' }));
});
