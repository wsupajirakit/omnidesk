/**
 * Legacy client (omnidesk-api `external-api.service.ts`, used when a hook is not bound to a custom
 * tool): form-or-JSON login at `api/v1/auth/login`, then `api/v1/customer` with Bearer. The user id
 * arrives as `userid` (auto-added by that client) or `line_user_id`; `web_code` is optional there,
 * so the first registered web code is used when it is absent.
 */
import type { App } from '@zcrm/core';
import { Type } from 'typebox';

import { UNAUTHORIZED, type Guards } from '../auth.js';
import type { MemberConfig } from '../config.js';
import type { MemberService } from '../service.js';
import { send } from './send.js';
import { Id, WebCode } from './v1.js';
import { LOGIN_LIMIT, credentialsOk } from './v3.js';

export function legacyRoutes(app: App, g: Guards, svc: MemberService, cfg: MemberConfig, defaultWebCode: () => string): void {
  app.post(
    '/api/v1/auth/login',
    { schema: { body: Type.Object({ username: Type.String({ minLength: 1, maxLength: 120 }), password: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: true }) }, config: { rateLimit: LOGIN_LIMIT } },
    async (req, reply) => {
      if (!credentialsOk(cfg, req.body.username, req.body.password)) return reply.status(401).send(UNAUTHORIZED);
      const t = await g.jwt.issue(req.body.username);
      return { success: true, access_token: t.access_token, expires_in: t.expires_in, data: t };
    },
  );
  const Who = Type.Object({ userid: Type.Optional(Id), line_user_id: Type.Optional(Id), web_code: Type.Optional(WebCode) }, { additionalProperties: true });
  const handler = (who: { userid?: string | undefined; line_user_id?: string | undefined; web_code?: string | undefined }) => {
    const id = who.line_user_id ?? who.userid ?? '';
    return svc.profile(id, who.web_code ?? defaultWebCode());
  };
  app.get('/api/v1/customer', { schema: { querystring: Who }, preHandler: g.bearer }, (req, reply) => send(reply, () => handler(req.query)));
  app.post('/api/v1/customer', { schema: { body: Who }, preHandler: g.bearer }, (req, reply) => send(reply, () => handler(req.body)));
}
