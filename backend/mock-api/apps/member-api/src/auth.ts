/**
 * Request authentication for member-api — each guard mirrors what the backend sends:
 *   · v1 routes   — HMAC (`X-Timestamp`, `X-Signature`); GET signs web_code+timestamp, JSON POST
 *                   adds the canonical body (core/auth/hmac.ts). Writes are replay-checked, reads
 *                   are not (parallel GETs share a signature — see core/auth/hmac.ts). validate-slip is verified in its
 *                   handler because the signed map needs the parsed multipart parts.
 *   · v3 / legacy — `Authorization: Bearer <access token>` issued by /auth/login.
 * Every failure answers the same 401 envelope (no hint about which part was wrong).
 */
import { HmacVerifier, JwtIssuer, canonicalJsonPayload } from '@zcrm/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { MemberConfig } from './config.js';

export const UNAUTHORIZED = { success: false, error: { code: 'UNAUTHORIZED', message: 'authentication failed' } };

export interface Guards {
  hmac: HmacVerifier;
  jwt: JwtIssuer;
  hmacGet: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  hmacJson: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  bearer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const header = (req: FastifyRequest, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function makeGuards(cfg: MemberConfig): Guards {
  const hmac = new HmacVerifier(cfg.MEMBER_HMAC_SECRET, cfg.MEMBER_HMAC_WINDOW_SEC);
  const jwt = new JwtIssuer({ secret: cfg.MEMBER_JWT_SECRET, issuer: 'member-api', accessTtlSec: cfg.MEMBER_JWT_ACCESS_TTL_SEC, refreshTtlSec: cfg.MEMBER_JWT_REFRESH_TTL_SEC });
  const deny = (req: FastifyRequest, reply: FastifyReply, why: string) => {
    req.log.warn({ why }, 'auth refused');
    return reply.status(401).send(UNAUTHORIZED);
  };
  const sig = (req: FastifyRequest) => ({ timestamp: header(req, 'x-timestamp'), signature: header(req, 'x-signature') });

  return {
    hmac,
    jwt,
    hmacGet: async (req, reply) => {
      const wc = str((req.query as Record<string, unknown>)['web_code']);
      const v = hmac.verify(sig(req), (ts) => `${wc}${ts}`);
      if (!v.ok) return deny(req, reply, v.reason);
    },
    hmacJson: async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const v = hmac.verify(sig(req), (ts) => `${str(body['web_code'])}${ts}${canonicalJsonPayload(body)}`, Date.now(), `${req.method} ${req.url}`);
      if (!v.ok) return deny(req, reply, v.reason);
    },
    bearer: async (req, reply) => {
      const token = (header(req, 'authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!token || !(await jwt.verify(token, 'access'))) return deny(req, reply, 'bearer');
    },
  };
}
