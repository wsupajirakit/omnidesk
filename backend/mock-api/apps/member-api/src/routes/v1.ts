/**
 * v1 — HMAC-signed routes, the shape the backend's custom tool "member API v1" calls:
 *   GET  <p>/v1/customer?line_user_id&web_code      profile (404 CUSTOMER_NOT_LINKED)
 *   POST <p>/v1/customer                            link   {line_user_id, web_code, phone_number, first_name?, account_number?}
 *   GET  <p>/v1/site-rules?web_code[&line_user_id]  site rules {data:{shop}}
 *   POST <p>/v1/customer/validate-slip[-<provider>] top-up, multipart, own signature (fields + file hash)
 */
import { validateSlipCanonical, type App } from '@zcrm/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { UNAUTHORIZED, type Guards } from '../auth.js';
import type { MemberService } from '../service.js';
import { send } from './send.js';

export const Id = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' });
export const WebCode = Type.String({ minLength: 1, maxLength: 32, pattern: '^[A-Za-z0-9_-]+$' });
export const Phone = Type.String({ minLength: 6, maxLength: 20, pattern: '^[0-9+-]+$' });
export const Name = Type.String({ minLength: 1, maxLength: 120 });
export const AcctNo = Type.String({ minLength: 4, maxLength: 30, pattern: '^[0-9-]+$' });
export const LinkBody = Type.Object(
  { line_user_id: Id, web_code: WebCode, phone_number: Phone, first_name: Type.Optional(Name), account_number: Type.Optional(AcctNo) },
  { additionalProperties: false },
);

export function v1Routes(app: App, p: string, g: Guards, svc: MemberService): void {
  const Q = Type.Object({ line_user_id: Id, web_code: WebCode }, { additionalProperties: false });
  app.get(`/${p}/v1/customer`, { schema: { querystring: Q }, preHandler: g.hmacGet }, (req, reply) =>
    send(reply, () => svc.profile(req.query.line_user_id, req.query.web_code)),
  );
  app.post(`/${p}/v1/customer`, { schema: { body: LinkBody }, preHandler: g.hmacJson }, (req, reply) => send(reply, () => svc.link(req.body)));
  app.get(
    `/${p}/v1/site-rules`,
    { schema: { querystring: Type.Object({ web_code: WebCode, line_user_id: Type.Optional(Id) }, { additionalProperties: false }) }, preHandler: g.hmacGet },
    (req, reply) => send(reply, () => svc.siteRules(req.query.web_code)),
  );

  const validateSlip = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.isMultipart()) return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'multipart/form-data required' } });
    const fields: Record<string, string> = {};
    let file: { buffer: Buffer; filename: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname === 'upload_file') file = { buffer, filename: part.filename };
      } else if (typeof part.value === 'string') fields[part.fieldname] = part.value;
    }
    if (!file) return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'upload_file is required' } });
    const web = fields['web_code'] ?? '';
    const uid = fields['line_user_id'] ?? '';
    /* exactly the map the backend signs (validate-slip-signer.ts): web_code, line_user_id, payload? + file */
    const signed: Record<string, string> = { web_code: web, line_user_id: uid };
    if (fields['payload']) signed['payload'] = fields['payload'];
    const ts = req.headers['x-timestamp'];
    const sg = req.headers['x-signature'];
    const v = g.hmac.verify(
      { timestamp: typeof ts === 'string' ? ts : undefined, signature: typeof sg === 'string' ? sg : undefined },
      (t) => `${web}${t}${validateSlipCanonical(signed, { field: 'upload_file', ...file })}`,
      Date.now(),
      `${req.method} ${req.url}`,
    );
    if (!v.ok) return reply.status(401).send(UNAUTHORIZED);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid) || !/^[A-Za-z0-9_-]{1,32}$/.test(web))
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'invalid line_user_id or web_code' } });
    return send(reply, () => svc.topup(uid, web, fields['payload']));
  };
  app.post(`/${p}/v1/customer/validate-slip`, validateSlip);
  app.post(`/${p}/v1/customer/validate-slip-:provider`, { schema: { params: Type.Object({ provider: Type.String({ pattern: '^[a-z0-9]{1,20}$' }) }) } }, validateSlip);
}
