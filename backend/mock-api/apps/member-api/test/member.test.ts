import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { buildMemberApp } from '../src/app.js';
import { memberConfig } from '../src/config.js';
import { loadMemberData } from '../src/data.js';
import { SECRET, signGet, signJson, swiftcheckEnvelope, validateSlipRequest } from './helpers.js';

const cfg = memberConfig({ NODE_ENV: 'test', MEMBER_HMAC_SECRET: SECRET, MEMBER_LOGIN_PASSWORD: 'p'.repeat(40), MEMBER_JWT_SECRET: 'j'.repeat(40) });
const data = loadMemberData();
const { app } = await buildMemberApp(cfg, { logger: false, data });
beforeEach(() => data.members.reset());
const acc = (first: string) => data.members.read().accounts.find((a) => a.first_name === first)!;
const WEB = 'DEMO01';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const P = '/member-api';

const getProfile = (uid: string, web = WEB, headers = signGet(web)) =>
  app.inject({ method: 'GET', url: `${P}/v1/customer?line_user_id=${uid}&web_code=${web}`, headers });
const link = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: `${P}/v1/customer`, headers: signJson(body), payload: body });

/* ── v1 · profile ── */
test('v1 profile: linked member → 200 {success,data:{profile}} with the renamed fields and statements', async () => {
  const r = await getProfile(acc('Alpha').line_user_id!);
  assert.equal(r.statusCode, 200);
  const p = r.json<{ success: boolean; data: { profile: Record<string, any> } }>().data.profile;
  assert.ok(p['promotion']['activity_volume_done']);
  assert.equal(p['transaction']['statement'][0]['provider_code'], 'walletpay');
});
test('v1 profile: unknown LINE id → 404 CUSTOMER_NOT_LINKED (the body the backend matches)', async () => {
  const r = await getProfile('U0000');
  assert.deepEqual([r.statusCode, r.json()], [404, { success: false, error: { code: 'CUSTOMER_NOT_LINKED', message: 'LINE นี้ยังไม่ผูกบัญชี' } }]);
});
test('v1 auth: missing, wrong and stale signatures are 401; parallel same-second GETs both pass; unknown web_code 403', async () => {
  const uid = acc('Alpha').line_user_id!;
  assert.equal((await getProfile(uid, WEB, {} as never)).statusCode, 401);
  assert.equal((await getProfile(uid, WEB, { 'x-timestamp': String(Math.floor(Date.now() / 1000)), 'x-signature': 'a'.repeat(64) })).statusCode, 401);
  assert.equal((await getProfile(uid, WEB, { 'x-timestamp': '1000000000', 'x-signature': 'a'.repeat(64) })).statusCode, 401);
  const h = signGet(WEB);
  const [a, b] = await Promise.all([getProfile(uid, WEB, h), getProfile(uid, WEB, h)]);
  assert.deepEqual([a.statusCode, b.statusCode], [200, 200]);
  assert.equal((await getProfile(uid, 'OTHER')).statusCode, 403);
});
test('v1 input: unexpected query keys are refused', async () => {
  const r = await app.inject({ method: 'GET', url: `${P}/v1/customer?line_user_id=U1&web_code=${WEB}&x=1`, headers: signGet(WEB) });
  assert.equal(r.statusCode, 400);
});

/* ── v1 · link ── */
test('v1 link: phone + name links the free account; profile then answers 200', async () => {
  const d = acc('Delta');
  const body = { line_user_id: 'Unewlinked0001', web_code: WEB, phone_number: d.phone_number, first_name: 'delta' };
  const r = await link(body);
  assert.deepEqual([r.statusCode, r.json<{ data: { member_id: string } }>().data.member_id], [200, d.member_id]);
  assert.equal((await getProfile('Unewlinked0001')).statusCode, 200);
  assert.equal((await link(body)).json<{ error: { code: string } }>().error.code, 'ALREADY_LINKED');
  const replay = signJson(body);
  await app.inject({ method: 'POST', url: `${P}/v1/customer`, headers: replay, payload: body });
  assert.equal((await app.inject({ method: 'POST', url: `${P}/v1/customer`, headers: replay, payload: body })).statusCode, 401);
});
test('v1 link: unknown phone 404 · wrong name 422 · account already linked 409 · body must be exact', async () => {
  const code = async (b: Record<string, unknown>) => (await link(b)).json<{ error: { code: string } }>().error.code;
  assert.equal(await code({ line_user_id: 'Ux1', web_code: WEB, phone_number: '0899999999', first_name: 'x' }), 'MEMBER_NOT_FOUND');
  assert.equal(await code({ line_user_id: 'Ux2', web_code: WEB, phone_number: acc('Delta').phone_number, first_name: 'nope' }), 'MEMBER_MISMATCH');
  assert.equal(await code({ line_user_id: 'Ux3', web_code: WEB, phone_number: acc('Alpha').phone_number, account_number: acc('Alpha').account_number }), 'ACCOUNT_ALREADY_LINKED');
  assert.equal((await link({ line_user_id: 'Ux4', web_code: WEB, phone_number: '0811111111', first_name: 'a', admin: true })).statusCode, 400);
});

/* ── v1 · site rules ── */
test('v1 site-rules: {data:{shop}} incl. bank_account; the extra line_user_id the backend appends is accepted', async () => {
  const r = await app.inject({ method: 'GET', url: `${P}/v1/site-rules?web_code=${WEB}&line_user_id=U1`, headers: signGet(WEB) });
  assert.equal(r.statusCode, 200);
  assert.ok(r.json<{ data: { shop: { bank_account: unknown } } }>().data.shop.bank_account);
});

/* ── v1 · validate-slip (top-up) ── */
const topup = async (first: string, transRef: string, path = 'validate-slip', tamper = false) => {
  const a = acc(first);
  const req = await validateSlipRequest({ web_code: WEB, line_user_id: a.line_user_id ?? 'Unot', payload: swiftcheckEnvelope(transRef, 500) }, JPEG, tamper ? Buffer.from('other') : JPEG);
  const r = await app.inject({ method: 'POST', url: `${P}/v1/customer/${path}`, ...req });
  return { status: r.statusCode, body: r.json<Record<string, any>>() };
};
test('validate-slip: each member scenario answers its data.slip_status.status', async () => {
  assert.equal((await topup('Alpha', 'T1')).body['data']['slip_status']['status'], 'account-not-match');
  assert.equal((await topup('Charlie', 'T2')).body['data']['slip_status']['status'], 'member-not-match');
  const ok = await topup('Bravo', 'T3');
  assert.deepEqual([ok.status, ok.body['data']['slip_status']['status']], [200, 'success']);
  assert.equal((await topup('Bravo', 'T3')).body['data']['slip_status']['status'], 'duplicate');
});
test('validate-slip: not linked → 404 CUSTOMER_NOT_LINKED; a tampered file breaks the signature (401); per-provider path works', async () => {
  assert.deepEqual([(await topup('Delta', 'T4')).status, (await topup('Delta', 'T5')).body['error']['code']], [404, 'CUSTOMER_NOT_LINKED']);
  assert.equal((await topup('Alpha', 'T6', 'validate-slip', true)).status, 401);
  assert.equal((await topup('Alpha', 'T7', 'validate-slip-slipguard')).status, 200);
});

/* ── v3 (JWT) ── */
const login = (password = 'p'.repeat(40)) => app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'demo-client', password } });
test('v3: bad login 401; good login → bearer works; refresh token is single-use', async () => {
  assert.equal((await login('wrong')).statusCode, 401);
  const t = (await login()).json<{ data: { access_token: string; refresh_token: string } }>().data;
  const uid = acc('Alpha').line_user_id!;
  const auth = { authorization: `Bearer ${t.access_token}` };
  assert.equal((await app.inject({ method: 'GET', url: `${P}/v3/customer?line_user_id=${uid}&web_code=${WEB}` })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: `${P}/v3/customer?line_user_id=${uid}&web_code=${WEB}`, headers: auth })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token: t.refresh_token } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token: t.refresh_token } })).statusCode, 401);
});
test('v3: edit, link and unlink round-trip; unlinking twice → 404 NOT_LINKED', async () => {
  const t = (await login()).json<{ data: { access_token: string } }>().data;
  const h = { authorization: `Bearer ${t.access_token}` };
  const uid = acc('Bravo').line_user_id!;
  assert.equal((await app.inject({ method: 'PATCH', url: `${P}/v3/customer`, headers: h, payload: { line_user_id: uid, web_code: WEB, phone_number: '0812345678' } })).json<{ data: { phone_number: string } }>().data.phone_number, '0812345678');
  assert.equal((await app.inject({ method: 'POST', url: `${P}/v3/unlink`, headers: h, payload: { line_user_id: uid, web_code: WEB } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${P}/v3/unlink`, headers: h, payload: { line_user_id: uid, web_code: WEB } })).json<{ error: { code: string } }>().error.code, 'NOT_LINKED');
  const relink = await app.inject({ method: 'POST', url: `${P}/v3/link`, headers: h, payload: { line_user_id: uid, web_code: WEB, phone_number: '0812345678', first_name: 'Bravo' } });
  assert.equal(relink.statusCode, 200);
});

/* ── legacy client ── */
test('legacy: form login → top-level access_token; api/v1/customer?userid= answers the profile', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `username=demo-client&password=${'p'.repeat(40)}` });
  const tok = r.json<{ access_token: string }>().access_token;
  const p = await app.inject({ method: 'GET', url: `/api/v1/customer?userid=${acc('Alpha').line_user_id!}`, headers: { authorization: `Bearer ${tok}` } });
  assert.equal(p.statusCode, 200);
});

/* ── hardening ── */
test('login is rate limited (10 / minute)', async () => {
  const { app: fresh } = await buildMemberApp(cfg, { logger: false });
  const codes: number[] = [];
  for (let i = 0; i < 11; i++) codes.push((await fresh.inject({ method: 'POST', url: '/auth/login', payload: { username: 'x', password: 'y' } })).statusCode);
  assert.equal(codes.at(-1), 429);
});
test('production refuses the placeholder secrets', () => {
  assert.throws(() => memberConfig({ NODE_ENV: 'production' }), /MEMBER_HMAC_SECRET/);
});
