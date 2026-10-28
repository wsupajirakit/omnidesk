/* Test-side signer, written independently from the mock — a line-for-line port of the backend's
   `hmac-signer.ts` (generic) and `validate-slip-signer.ts`, so a pass means "what the backend
   signs, the mock accepts". */
import { createHash, createHmac } from 'node:crypto';

export const SECRET = 's'.repeat(40);
const sortKeysDeep = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeysDeep) : v && typeof v === 'object'
    ? Object.keys(v).sort().reduce<Record<string, unknown>>((a, k) => ((a[k] = sortKeysDeep((v as Record<string, unknown>)[k])), a), {})
    : v;
const goEscape = (j: string) => j.replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
const hmac = (m: string) => createHmac('sha256', SECRET).update(m, 'utf8').digest('hex');
let tick = 0;
const ts = () => String(Math.floor(Date.now() / 1000) - (tick++ % 250)); // distinct per call, inside the ±300 s window

export function signGet(webCode: string) {
  const t = ts();
  return { 'x-timestamp': t, 'x-signature': hmac(`${webCode}${t}`) };
}
export function signJson(body: Record<string, unknown>) {
  const t = ts();
  return { 'x-timestamp': t, 'x-signature': hmac(`${typeof body['web_code'] === 'string' ? body['web_code'] : ''}${t}${goEscape(JSON.stringify(sortKeysDeep(body)))}`) };
}
export async function validateSlipRequest(fields: Record<string, string>, file: Buffer, signFile = file) {
  const t = ts();
  const map: Record<string, string> = { web_code: fields['web_code'] ?? '', line_user_id: fields['line_user_id'] ?? '' };
  if (fields['payload']) map['payload'] = fields['payload'];
  map['upload_file'] = `sha256:${createHash('sha256').update(signFile).digest('hex')};filename:slip.jpg`;
  const sig = hmac(`${map['web_code']}${t}${JSON.stringify(sortKeysDeep(map))}`);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('upload_file', new Blob([new Uint8Array(file)], { type: 'image/jpeg' }), 'slip.jpg');
  const r = new Request('http://x', { method: 'POST', body: form });
  return { headers: { 'content-type': r.headers.get('content-type')!, 'x-timestamp': t, 'x-signature': sig }, payload: Buffer.from(await r.arrayBuffer()) };
}
export const swiftcheckEnvelope = (transRef: string, amount: number) =>
  JSON.stringify(sortKeysDeep({ data: { amountInSlip: amount, isDuplicate: false, rawSlip: { amount: { amount }, transRef } }, message: 'ok', success: true }));
