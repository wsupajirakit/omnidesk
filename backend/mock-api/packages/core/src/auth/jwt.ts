/**
 * Short-lived HS256 access tokens + rotating refresh tokens (each refresh id is single-use:
 * presenting it twice is treated as theft and fails). Algorithm is pinned on verify, so a
 * token signed with `none` or another algorithm is rejected.
 */
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

import { ReplayCache } from './replay-cache.js';

export interface JwtOptions {
  secret: string;
  issuer: string;
  accessTtlSec: number;
  refreshTtlSec: number;
}

export class JwtIssuer {
  readonly #key: Uint8Array;
  readonly #used: ReplayCache;
  constructor(private readonly opts: JwtOptions) {
    this.#key = new TextEncoder().encode(opts.secret);
    this.#used = new ReplayCache(opts.refreshTtlSec * 1000);
  }

  async issue(subject: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const now = Math.floor(Date.now() / 1000);
    const sign = (typ: string, ttl: number) =>
      new SignJWT({ typ })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(subject)
        .setIssuer(this.opts.issuer)
        .setIssuedAt(now)
        .setExpirationTime(now + ttl)
        .setJti(randomUUID())
        .sign(this.#key);
    return {
      access_token: await sign('access', this.opts.accessTtlSec),
      refresh_token: await sign('refresh', this.opts.refreshTtlSec),
      expires_in: this.opts.accessTtlSec,
    };
  }

  /** Returns the subject, or null for any invalid / expired / wrong-type token. */
  async verify(token: string, typ: 'access' | 'refresh'): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.#key, { algorithms: ['HS256'], issuer: this.opts.issuer });
      if (payload['typ'] !== typ || !payload.sub) return null;
      if (typ === 'refresh' && (!payload.jti || !this.#used.claim(payload.jti))) return null;
      return payload.sub;
    } catch {
      return null;
    }
  }
}
