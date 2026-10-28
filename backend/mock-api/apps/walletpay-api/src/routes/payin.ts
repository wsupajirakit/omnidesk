/**
 * POST /api/v1/public/payin/:refId/slip — the ONLY call the backend's walletpay leg makes
 * (omnidesk-api `payment-runner.service.ts` LEG 2). No auth, multipart, slip in `slip`.
 * Answers, verbatim in shape from the live captures (`payment-reply-response-examples.ts`):
 *   400 {code:4000}  refId not a UUID            404 {code:4040}  unknown pay-in
 *   400 {code:4001}  no slip file part           200 SINGLE_MATCHED / matched / SINGLE_NOT_MATCHED
 * Extras for a full simulation (the backend never calls them): create a pay-in, read its status.
 */
import { randomUUID } from 'node:crypto';

import type { App } from '@zcrm/core';
import { Type } from 'typebox';

import type { WalletpayConfig } from '../config.js';
import type { JsonStore } from '@zcrm/core';
import type { PayinSeed } from '../data.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MAGIC: Array<[string, (b: Buffer) => boolean]> = [
  ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

export function payinRoutes(app: App, cfg: WalletpayConfig, store: JsonStore<PayinSeed>): void {
  app.post('/api/v1/public/payin/:refId/slip', { schema: { params: Type.Object({ refId: Type.String({ maxLength: 64 }) }) } }, async (req, reply) => {
    const { refId } = req.params;
    if (!UUID.test(refId)) return reply.status(400).send({ code: 4000, message: 'Invalid refId' });
    const payin = store.read().payins.find((p) => p.refId === refId);
    if (!payin) return reply.status(404).send({ code: 4040, message: 'PayIn transaction not found' });
    if (!req.isMultipart()) return reply.status(400).send({ code: 4001, message: `Missing slip file (field name: ${cfg.WALLETPAY_FILE_FIELD})` });

    const fields: Record<string, string> = {};
    let slip: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer(); // bounded by the multipart fileSize limit
        if (part.fieldname === cfg.WALLETPAY_FILE_FIELD) slip = buf;
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value.slice(0, 200);
      }
    }
    if (!slip) return reply.status(400).send({ code: 4001, message: `Missing slip file (field name: ${cfg.WALLETPAY_FILE_FIELD})` });
    if (!IMAGE_MAGIC.some(([, is]) => is(slip))) return reply.status(400).send({ code: 4002, message: 'Slip file is not an image' });

    const amountSent = fields['amount'] === undefined ? null : Number(fields['amount']);
    return store.write((d) => {
      const p = d.payins.find((x) => x.refId === refId);
      if (!p) return { code: 4040, message: 'PayIn transaction not found' }; // removed between read and write
      const imageId = String(++d.counters.imageId);
      const evidenceId = String(++d.counters.evidenceId);
      const upload = (result: string) => d.uploads.push({ refId, imageId, evidenceId, result, at: new Date().toISOString() });
      const notMatched = (status: string, message: string) => {
        upload(status);
        return { refId, uploadResult: [{ imageId, evidenceId, matchResult: { status, message } }], messageType: 'SINGLE_NOT_MATCHED', message: 'Slip uploaded successfully. Waiting for admin to confirm.' };
      };
      if (p.status === 'confirmed') return notMatched('no_match', `รายการนี้ยืนยันไปแล้ว (transaction ID ${p.transactionId})`);
      if (amountSent !== null && amountSent !== p.amount)
        return notMatched('no_match', `ไม่พบรายการที่ตรงกัน (amount ${amountSent.toFixed(2)})`);
      switch (p.scenario) {
        case 'confirmed':
          p.status = 'confirmed';
          upload('matched');
          return {
            refId,
            uploadResult: [{ imageId, evidenceId, matchResult: { status: 'matched', message: `[AUTOMATCH] Matched and confirmed transaction ID [${p.transactionId}] extRefId [${p.extRefId}]`, bankExpectId: p.bankExpectId, transactionId: p.transactionId, confirmed: true } }],
            messageType: 'SINGLE_MATCHED',
            message: 'Slip matched and auto-confirmed.',
          };
        case 'pending':
          p.status = 'pending';
          upload('matched_pending');
          return { matchResult: { message: `(… extRefId ${p.extRefId}, status: PROCESSING)`, bankExpectId: p.bankExpectId, transactionId: p.transactionId, confirmed: false } };
        case 'invalid_destination':
          return notMatched('invalid_destination', '[เลขบัญชี] error เลขบัญชีผู้รับไม่อยู่ใน whitelist ปลายทาง [xxx-x-x0000-x]');
        default:
          return notMatched('no_match', `ไม่พบรายการที่ตรงกัน (amount ${p.amount.toFixed(2)})`);
      }
    });
  });

  /* ── simulation extras (not called by the backend) ── */
  app.get('/api/v1/public/payin/:refId', { schema: { params: Type.Object({ refId: Type.String({ maxLength: 64 }) }) } }, async (req, reply) => {
    if (!UUID.test(req.params.refId)) return reply.status(400).send({ code: 4000, message: 'Invalid refId' });
    const p = store.read().payins.find((x) => x.refId === req.params.refId);
    if (!p) return reply.status(404).send({ code: 4040, message: 'PayIn transaction not found' });
    return { code: 0, data: { id: p.refId, amount: p.amount, status: p.status, created_at: p.created_at } };
  });

  app.post('/api/v1/public/payin', {
    schema: { body: Type.Object({ amount: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000 }), member_user_id: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }) },
  }, (req) => {
    const refId = randomUUID();
    store.write((d) => {
      d.payins.push({ refId, amount: req.body.amount, member_user_id: req.body.member_user_id, status: 'waiting-deposit', scenario: 'confirmed', bankExpectId: 800000 + d.payins.length, transactionId: 9000000 + d.payins.length, extRefId: `SIM${Date.now()}`, created_at: new Date().toISOString() });
    });
    return { code: 0, data: { id: refId, slipUploadUrl: `https://slipupload.example-walletpay.dev/?refid=${refId}` } };
  });
}
