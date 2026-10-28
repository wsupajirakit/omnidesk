/**
 * Small guards shared by every service:
 *   · ipAllowlist — refuse any source address not listed (empty list = allow all, dev only)
 *   · adminRoutes — `POST /__admin/reset` behind a Bearer token compared in constant time;
 *     when no token is configured the route is NOT REGISTERED at all (404, not 401)
 */
import { timingSafeEqual } from 'node:crypto';

import type { App } from './server.js';

export function ipAllowlist(app: App, csv: string): void {
  const allowed = new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
  if (!allowed.size) return;
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const ip = req.ip.replace(/^::ffff:/, '');
    if (!allowed.has(ip)) return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'source not allowed' } });
  });
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function adminRoutes(app: App, token: string, reset: () => void): void {
  if (!token) return;
  app.post('/__admin/reset', async (req, reply) => {
    const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!got || !safeEqual(got, token)) return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'admin token required' } });
    reset();
    return { success: true };
  });
}
