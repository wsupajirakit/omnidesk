import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { adminRoutes, createServer, ipAllowlist } from '@zcrm/core';

import { makeGuards } from './auth.js';
import type { MemberConfig } from './config.js';
import { loadMemberData, type MemberData } from './data.js';
import { legacyRoutes } from './routes/legacy.js';
import { v1Routes } from './routes/v1.js';
import { v3Routes } from './routes/v3.js';
import { MemberService } from './service.js';

export async function buildMemberApp(cfg: MemberConfig, opts: { logger?: boolean; data?: MemberData } = {}) {
  const data = opts.data ?? loadMemberData(cfg.MEMBER_DATA_DIR || undefined);
  const app = await createServer({
    name: 'member-api',
    logLevel: cfg.LOG_LEVEL,
    bodyLimit: cfg.BODY_LIMIT_BYTES,
    rateLimit: { max: cfg.RATE_LIMIT_MAX, timeWindow: cfg.RATE_LIMIT_WINDOW_MS },
    ...(opts.logger === undefined ? {} : { logger: opts.logger }),
  });
  ipAllowlist(app, cfg.MEMBER_ALLOW_IPS);
  await app.register(formbody, { bodyLimit: 16_384 });
  await app.register(multipart, { limits: { fileSize: cfg.MEMBER_MAX_SLIP_BYTES, files: 1, fields: 20, fieldSize: 262_144, parts: 25 }, throwFileSizeLimit: true });
  const guards = makeGuards(cfg);
  const svc = new MemberService(data);
  const p = cfg.MEMBER_API_PREFIX;
  v1Routes(app, p, guards, svc);
  v3Routes(app, p, guards, svc, cfg);
  legacyRoutes(app, guards, svc, cfg, () => data.members.read().web_codes[0] ?? '');
  adminRoutes(app, cfg.MEMBER_ADMIN_TOKEN, () => {
    data.members.reset();
    data.site.reset();
  });
  return { app, data };
}
