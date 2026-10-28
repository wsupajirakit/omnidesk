import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import { buildWalletpayApp } from '../src/app.js';
import { walletpayConfig } from '../src/config.js';
import { DEFAULT_DATA_FILE, loadPayins } from '../src/data.js';

const seed = JSON.parse(readFileSync(DEFAULT_DATA_FILE, 'utf8')) as { payins: Array<{ refId: string; amount: number; scenario: string }> };
const by = (s: string) => seed.payins.find((p) => p.scenario === s)!;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const store = loadPayins();
const cfg = walletpayConfig({ NODE_ENV: 'test', WALLETPAY_ADMIN_TOKEN: 'admin-token-for-tests-only-000000' });
const { app } = await buildWalletpayApp(cfg, { logger: false, store });
beforeEach(() => store.reset());

async function upload(refId: string, fields: Record<string, string> = {}, file: Buffer | null = JPEG, field = 'slip') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append(field, new Blob([new Uint8Array(file)], { type: 'image/jpeg' }), 'slip.jpg');
  const r = new Request('http://x', { method: 'POST', body: form });
  const res = await app.inject({ method: 'POST', url: `/api/v1/public/payin/${refId}/slip`, headers: { 'content-type': r.headers.get('content-type')! }, payload: Buffer.from(await r.arrayBuffer()) });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>(), headers: res.headers };
}

test('4000 when refId is not a UUID; 4040 when the pay-in does not exist (live bodies)', async () => {
  assert.deepEqual(await upload('not-a-uuid').then((r) => [r.status, r.body]), [400, { code: 4000, message: 'Invalid refId' }]);
  assert.deepEqual(await upload('00000000-0000-4000-8000-000000000018').then((r) => [r.status, r.body]), [404, { code: 4040, message: 'PayIn transaction not found' }]);
});

test('4001 when the slip part is missing (also under the wrong field name)', async () => {
  const r = await upload(by('confirmed').refId, { amount: '500' }, null);
  assert.deepEqual([r.status, r.body], [400, { code: 4001, message: 'Missing slip file (field name: slip)' }]);
  assert.equal((await upload(by('confirmed').refId, {}, JPEG, 'image')).body['code'], 4001);
});

test('a non-image file is refused', async () => {
  assert.equal((await upload(by('confirmed').refId, {}, Buffer.from('not an image'))).body['code'], 4002);
});

test('confirmed: SINGLE_MATCHED + matchResult{matched, confirmed:true}; a second upload no longer matches', async () => {
  const p = by('confirmed');
  const r = await upload(p.refId, { refId: p.refId, amount: String(p.amount), line_user_id: 'U1', member_user_id: 'U1' });
  assert.equal(r.status, 200);
  assert.equal(r.body['messageType'], 'SINGLE_MATCHED');
  const mr = (r.body['uploadResult'] as Array<{ matchResult: Record<string, unknown> }>)[0]!.matchResult;
  assert.equal(mr['status'], 'matched');
  assert.equal(mr['confirmed'], true);
  assert.equal(typeof mr['transactionId'], 'number');
  const again = await upload(p.refId, { amount: String(p.amount) });
  assert.equal(again.body['messageType'], 'SINGLE_NOT_MATCHED');
});

test('pending: top-level matchResult with confirmed:false (the partial live shape)', async () => {
  const r = await upload(by('pending').refId, { amount: String(by('pending').amount) });
  assert.equal((r.body['matchResult'] as Record<string, unknown>)['confirmed'], false);
});

test('no_match and invalid_destination answer SINGLE_NOT_MATCHED with the matching status', async () => {
  const nm = await upload(by('no_match').refId, { amount: String(by('no_match').amount) });
  const inv = await upload(by('invalid_destination').refId, { amount: String(by('invalid_destination').amount) });
  const st = (b: Record<string, unknown>) => (b['uploadResult'] as Array<{ matchResult: { status: string } }>)[0]!.matchResult.status;
  assert.deepEqual([nm.body['messageType'], st(nm.body)], ['SINGLE_NOT_MATCHED', 'no_match']);
  assert.deepEqual([inv.body['messageType'], st(inv.body)], ['SINGLE_NOT_MATCHED', 'invalid_destination']);
});

test('an amount that differs from the pay-in never matches', async () => {
  const r = await upload(by('confirmed').refId, { amount: '1' });
  assert.equal(r.body['messageType'], 'SINGLE_NOT_MATCHED');
});

test('security: helmet headers, errors never leak internals, unknown routes 404 json', async () => {
  const r = await upload('not-a-uuid');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const nf = await app.inject({ method: 'GET', url: '/nope' });
  assert.deepEqual([nf.statusCode, nf.json()], [404, { success: false, error: { code: 'NOT_FOUND', message: 'route not found' } }]);
});

test('admin reset: refused without the token, works with it', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/__admin/reset' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/__admin/reset', headers: { authorization: 'Bearer wrong' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/__admin/reset', headers: { authorization: `Bearer ${cfg.WALLETPAY_ADMIN_TOKEN}` } })).statusCode, 200);
});

test('admin route does not exist when no token is configured', async () => {
  const { app: bare } = await buildWalletpayApp(walletpayConfig({ NODE_ENV: 'test' }), { logger: false });
  assert.equal((await bare.inject({ method: 'POST', url: '/__admin/reset' })).statusCode, 404);
});

test('rate limit answers 429 once the window is spent', async () => {
  const { app: tight } = await buildWalletpayApp(walletpayConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX: '2' }), { logger: false });
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await tight.inject({ method: 'GET', url: `/api/v1/public/payin/${by('confirmed').refId}` })).statusCode);
  assert.deepEqual(codes, [200, 200, 429]);
});

test('production refuses a weak admin token', () => {
  assert.throws(() => walletpayConfig({ NODE_ENV: 'production', WALLETPAY_ADMIN_TOKEN: 'short' }), /weak or missing/);
});
