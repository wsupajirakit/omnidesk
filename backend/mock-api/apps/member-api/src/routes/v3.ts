/**
 * v3 — JWT routes (the backend's custom tool "member API v3", auth_type jwt_login):
 *   POST /auth/login {username,password} → data.{access_token,refresh_token,expires_in}
 *   POST /auth/refresh {refresh_token}    → a new pair; each refresh token works ONCE
 *   GET   <p>/v3/customer?line_user_id&web_code   profile
 *   PATCH <p>/v3/customer                         edit   {line_user_id, web_code, phone_number?, first_name?, account_number?}
 *   POST  <p>/v3/link                             link (same body as v1)
 *   PATCH <p>/v3/link                             edit (alias kept by the older tool record)
 *   POST  <p>/v3/unlink {line_user_id, web_code}  unlink (404 NOT_LINKED when nothing to unlink)
 * Login is rate limited far tighter than the data routes and compares in constant time.
 */
import { safeEqual, type App } from '@zcrm/core';
import { Type } from 'typebox';

import { UNAUTHORIZED, type Guards } from '../auth.js';
import type { MemberConfig } from '../config.js';
import type { MemberService } from '../service.js';
import { send } from './send.js';
import { AcctNo, Id, LinkBody, Name, Phone, WebCode } from './v1.js';

export const LOGIN_LIMIT = { max: 10, timeWindow: 60_000 };
const Login = Type.Object({ username: Type.String({ minLength: 1, maxLength: 120 }), password: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: true });

export function credentialsOk(cfg: MemberConfig, u: string, pw: string): boolean {
  const a = safeEqual(u, cfg.MEMBER_LOGIN_USERNAME);
  const b = safeEqual(pw, cfg.MEMBER_LOGIN_PASSWORD);
  return a && b;
}

export function v3Routes(app: App, p: string, g: Guards, svc: MemberService, cfg: MemberConfig): void {
  app.post('/auth/login', { schema: { body: Login }, config: { rateLimit: LOGIN_LIMIT } }, async (req, reply) => {
    if (!credentialsOk(cfg, req.body.username, req.body.password)) return reply.status(401).send(UNAUTHORIZED);
    return { success: true, data: { ...(await g.jwt.issue(req.body.username)), token_type: 'Bearer' } };
  });
  app.post(
    '/auth/refresh',
    { schema: { body: Type.Object({ refresh_token: Type.String({ minLength: 10, maxLength: 2000 }) }, { additionalProperties: true }) }, config: { rateLimit: LOGIN_LIMIT } },
    async (req, reply) => {
      const sub = await g.jwt.verify(req.body.refresh_token, 'refresh');
      if (!sub) return reply.status(401).send(UNAUTHORIZED);
      return { success: true, data: { ...(await g.jwt.issue(sub)), token_type: 'Bearer' } };
    },
  );

  const Who = Type.Object({ line_user_id: Id, web_code: WebCode }, { additionalProperties: false });
  const Edit = Type.Object(
    { line_user_id: Id, web_code: WebCode, phone_number: Type.Optional(Phone), first_name: Type.Optional(Name), account_number: Type.Optional(AcctNo) },
    { additionalProperties: false },
  );
  app.get(`/${p}/v3/customer`, { schema: { querystring: Who }, preHandler: g.bearer }, (req, reply) => send(reply, () => svc.profile(req.query.line_user_id, req.query.web_code)));
  app.patch(`/${p}/v3/customer`, { schema: { body: Edit }, preHandler: g.bearer }, (req, reply) => send(reply, () => svc.edit(req.body.line_user_id, req.body.web_code, req.body)));
  app.post(`/${p}/v3/link`, { schema: { body: LinkBody }, preHandler: g.bearer }, (req, reply) => send(reply, () => svc.link(req.body)));
  app.patch(`/${p}/v3/link`, { schema: { body: Edit }, preHandler: g.bearer }, (req, reply) => send(reply, () => svc.edit(req.body.line_user_id, req.body.web_code, req.body)));
  app.post(`/${p}/v3/unlink`, { schema: { body: Who }, preHandler: g.bearer }, (req, reply) => send(reply, () => svc.unlink(req.body.line_user_id, req.body.web_code)));
}
