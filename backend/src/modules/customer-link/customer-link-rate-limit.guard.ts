/**
 * Per-IP fixed-window limiter for the PUBLIC customer-link routes.
 *
 * Ported from the `rateLimit()` closure in
 * `legacy-api/src/customer-link/routes/customerLinkRoutes.js`.
 *
 * WHY NOT `RateLimitService` (the Redis-backed one this service already has):
 * legacy deliberately did NOT use its Redis limiter here. The reason is written
 * into the legacy route file — a Redis outage must never take account-linking
 * down, and this surface is public with no credential to fall back on. Process-
 * local counters are accepted as good enough: the goal is stopping abusive
 * bursts toward the third party, not precise global quotas. Reproducing that
 * choice also reproduces its observable behaviour (counters reset on restart),
 * which is what a parity diff measures.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

export interface CustomerLinkLimit {
  windowMs: number;
  max: number;
  label: string;
}

export const CUSTOMER_LINK_LIMIT_KEY = 'customer_link_limit';

/** Declares the window a public customer-link route is throttled by. */
export const CustomerLinkRateLimit = (
  limit: CustomerLinkLimit,
): MethodDecorator => SetMetadata(CUSTOMER_LINK_LIMIT_KEY, limit);

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class CustomerLinkRateLimitGuard implements CanActivate {
  /** label -> ip -> bucket. One map per label mirrors one closure per route. */
  private readonly buckets = new Map<string, Map<string, Bucket>>();

  constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const limit = this.reflector.get<CustomerLinkLimit | undefined>(
      CUSTOMER_LINK_LIMIT_KEY,
      context.getHandler(),
    );
    if (!limit) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const now = Date.now();
    const ip = this.resolveIp(req);

    let hits = this.buckets.get(limit.label);
    if (!hits) {
      hits = new Map<string, Bucket>();
      this.buckets.set(limit.label, hits);
    }

    // Lazy prune so the map cannot grow unbounded under IP churn.
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    const cur = hits.get(ip);
    if (!cur || cur.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + limit.windowMs });
      return true;
    }
    if (cur.count >= limit.max) {
      res.set('Retry-After', String(Math.ceil((cur.resetAt - now) / 1000)));
      // Written straight to the socket, not thrown: AllExceptionsFilter reshapes
      // every HttpException into `{ error: "<message>" }`, and legacy answers
      // `{ success:false, error:{ code, message } }` here. Once the body is sent,
      // the filter sees `headersSent` and steps aside, so returning false below
      // ends the request without touching the response.
      res.status(429).json({
        success: false,
        error: {
          code: 'CUSTOMER_LINK_RATE_LIMITED',
          message: `เรียก ${limit.label} ถี่เกินไป กรุณาลองใหม่ภายหลัง`,
        },
      });
      return false;
    }
    cur.count += 1;
    return true;
  }

  /**
   * Same resolution order as the legacy limiter: Cloudflare's header first,
   * then the first `x-forwarded-for` entry, then the socket address.
   */
  private resolveIp(req: Request): string {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();

    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') {
      const first = fwd.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.ip || 'unknown';
  }
}
