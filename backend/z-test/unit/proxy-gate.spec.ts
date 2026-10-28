import {
  buildProxyGateMiddleware,
  isPublicPath,
} from '@/infra/proxy-gate/proxy-gate.middleware';

/**
 * [FEAT-20260813-PROXYGATE] The proxy gate is the inner layer of the BE
 * lockdown (docs/migrate-stack.md). These tests pin the three behaviours that
 * matter operationally:
 *   1. OFF (env unset/empty) is byte-identical pass-through — the seamless
 *      guarantee the rollout depends on;
 *   2. ON refuses anything without the exact stamp — fail-closed;
 *   3. the public allowlist (LINE / Telegram / handoff / customer-link /
 *      health) is never gated, and is TIGHTER than the rate-limit bypass
 *      (`/webhook/logs` must NOT pass).
 */

type Called = { next: boolean; status: number | null; body: unknown };

function run(
  secret: string | undefined,
  path: string,
  header?: string,
): Called {
  const middleware = buildProxyGateMiddleware(secret);
  const out: Called = { next: false, status: null, body: undefined };
  const req = {
    path,
    headers: header === undefined ? {} : { 'x-internal-secret': header },
  } as unknown as Parameters<typeof middleware>[0];
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
  } as unknown as Parameters<typeof middleware>[1];
  middleware(req, res, () => {
    out.next = true;
  });
  return out;
}

const SECRET = 'a'.repeat(64); // same length class as `openssl rand -hex 32`

describe('proxy-gate middleware', () => {
  describe('OFF mode (default — INTERNAL_PROXY_SECRET unset/empty)', () => {
    it.each([undefined, ''])(
      'secret=%p is a bare pass-through even on a gated path with no header',
      (secret) => {
        const out = run(secret, '/api/auth/login');
        expect(out).toEqual({ next: true, status: null, body: undefined });
      },
    );
  });

  describe('ON mode — gated paths', () => {
    it('refuses a request without the stamp (403, terse body, no next)', () => {
      const out = run(SECRET, '/api/tickets');
      expect(out.next).toBe(false);
      expect(out.status).toBe(403);
      expect(out.body).toEqual({ error: 'forbidden' });
    });

    it('refuses a wrong stamp of the same length', () => {
      const out = run(SECRET, '/api/tickets', 'b'.repeat(64));
      expect(out.next).toBe(false);
      expect(out.status).toBe(403);
    });

    it('refuses a wrong-length stamp (timingSafeEqual length guard)', () => {
      const out = run(SECRET, '/api/tickets', 'short');
      expect(out.next).toBe(false);
      expect(out.status).toBe(403);
    });

    it('passes the exact stamp through', () => {
      const out = run(SECRET, '/api/tickets', SECRET);
      expect(out).toEqual({ next: true, status: null, body: undefined });
    });

    it('gates root-mounted dashboard prefixes too (no /api assumption)', () => {
      for (const path of ['/hook', '/configs', '/audit/logs', '/stats']) {
        expect(run(SECRET, path).status).toBe(403);
      }
    });
  });

  describe('ON mode — public allowlist (external callers, never stamped)', () => {
    it.each([
      '/webhook',
      '/webhook/',
      '/omnideskdevoa/webhook', // real alias observed in stg logs
      '/api/telegram/webhook',
      '/api/handoff/callback/tk_x',
      '/api/handoff/callback/tk_x/job_1',
      '/api/handoff/callback/tk-x', // trailing segment required
      '/customer-link/profile',
      '/customer-link/match',
      '/health',
      '/health/ready',
      // Missing static files must fall through to the legacy 404, never 403
      // (real files are served before the gate by mount position).
      '/uploads/videos/none.mp4',
      '/bank-logos/none.png',
    ])('%s passes without a stamp', (path) => {
      const out = run(SECRET, path);
      expect(out).toEqual({ next: true, status: null, body: undefined });
    });

    it('does NOT treat /webhook/logs (dashboard log API) as public', () => {
      // Tighter than the rate-limit bypass regex on purpose — see middleware doc.
      expect(run(SECRET, '/webhook/logs').status).toBe(403);
      expect(run(SECRET, '/webhook/logs', SECRET).next).toBe(true);
    });

    it('does NOT treat the /api/handoff/callbacks inbox as public', () => {
      // The `/` after `callback` stops the prefix from swallowing `callbacks`
      // (dashboard inbox, handoff.manage JWT). Reached via the stamped route.
      for (const p of [
        '/api/handoff/callbacks',
        '/api/handoff/callbacks/id_1/attach',
        '/api/handoff/callbacks/id_1/dismiss',
        '/api/handoff/callback', // bare, no target_key segment
      ]) {
        expect(run(SECRET, p).status).toBe(403);
      }
    });
  });

  describe('isPublicPath table (kept in sync with Traefik omnidesk-be-allow)', () => {
    it.each([
      ['/webhook', true],
      ['/alias1/webhook', true],
      ['/api/telegram/webhook', true],
      ['/api/handoff/callback/tk', true],
      ['/customer-link/health', true],
      ['/health/ready', true],
      ['/uploads/images/x.png', true],
      ['/bank-logos/kbank.png', true],
      ['/webhook/logs', false],
      ['/api/auth/login', false],
      ['/a/b/webhook', false], // two segments before /webhook is not a LINE alias
      ['/healthz', false],
    ])('%s -> %p', (path, expected) => {
      expect(isPublicPath(path)).toBe(expected);
    });
  });
});
