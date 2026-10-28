import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { rateLimitConfig, realtimeConfig } from '@/config/app.config';
import { RedisService } from '@/infra/redis/redis.service';

/** Named buckets with independent limits, mirroring the legacy middleware. */
export type RateLimitBucket =
  | 'global'
  | 'default'
  | 'login'
  /** [FEAT-20260823-LOGINUSER] นับต่อชื่อผู้ใช้ คนละใบกับ `login` (ที่นับต่อ IP) */
  | 'login_user'
  /** [FEAT-20260823-LOGINFAIL] นับ **เฉพาะรหัสผิด** ต่อ IP — คนละใบกับ `login` */
  | 'login_fail'
  | 'key';

export interface RateLimitVerdict {
  limited: boolean;
  /** Requests made in the current window; null when Redis was unreachable. */
  current: number | null;
  limit: number;
  windowSeconds: number;
}

/**
 * [FEAT-20260821-RATELADDER] A caller-supplied limit for ONE call. The limiter
 * stays a dumb fixed-window counter; whoever escalates a customer (the webhook's
 * per-user ladder) decides the numbers and names the window with `keySuffix`, so
 * an escalated window never shares a counter with the base one. Absent = the
 * bucket's configured limits and the exact key used before this existed.
 */
export interface RateLimitOverride {
  limit: number;
  windowSeconds: number;
  /** Appended to the key, e.g. `L2` → `ratelimit:<env>:<bucket>:<id>:L2`. */
  keySuffix?: string;
}

/**
 * Fixed-window rate limiting backed by Redis INCR + EXPIRE.
 *
 * **Fails open by design.** If Redis is unreachable the request is allowed
 * through. Rate limiting protects against abuse; it is not an authorization
 * control, and failing closed would turn a Redis outage into a full outage —
 * including locking every operator out of login.
 */
@Injectable()
export class RateLimitService {
  /** Namespace so dev and prod cannot consume each other's windows. */
  private readonly envNamespace: string;

  constructor(
    private readonly redis: RedisService,
    @Inject(rateLimitConfig.KEY)
    private readonly config: ConfigType<typeof rateLimitConfig>,
    @Inject(realtimeConfig.KEY)
    realtime: ConfigType<typeof realtimeConfig>,
  ) {
    // Dev and prod share one Redis database. Without a namespace, failed logins
    // from an office IP on dev would eat prod's login window for everyone behind
    // that address. Same variable the other namespaced services key on.
    this.envNamespace = String(realtime.wsEnv || 'prod').replace(/[^\w-]/g, '');
  }

  /**
   * Identifies the caller for per-IP limiting.
   *
   * `cf-connecting-ip` comes first and this ordering is load-bearing: behind
   * Cloudflare, the first `x-forwarded-for` entry is a Cloudflare edge address,
   * not the caller. That was observed live — the only key in Redis was a single
   * Cloudflare IP, meaning every user in the world shared one login quota.
   * Cloudflare sets `cf-connecting-ip` and strips it from inbound traffic, so it
   * cannot be spoofed through the edge.
   */
  resolveClientIp(request: Request): string {
    const cfIp = request.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim();

    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0]?.trim() ?? '';
    }

    return request.ip ?? '';
  }

  /**
   * Counts one hit against `identifier` in `bucket`.
   * `identifier` is typically a client IP or user id.
   */
  async consume(
    bucket: RateLimitBucket,
    identifier: string,
    override?: RateLimitOverride,
  ): Promise<RateLimitVerdict> {
    const { limit, windowSeconds } = override ?? this.limitsFor(bucket);

    if (!identifier) {
      return { limited: false, current: null, limit, windowSeconds };
    }

    const key = this.buildKey(bucket, identifier, override?.keySuffix);
    const current = await this.redis.incrementWithTtl(key, windowSeconds);

    // null means Redis failed — allow the request (see class docs).
    if (current === null) {
      return { limited: false, current: null, limit, windowSeconds };
    }

    return { limited: current > limit, current, limit, windowSeconds };
  }

  /**
   * [FEAT-20260824-RATEPEEK] The READ-ONLY twin of `consume`. Same question,
   * without charging for the answer.
   *
   * WHY IT EXISTS: a caller sometimes needs to know "is this identifier already
   * over its window?" at a point where the real charge has not happened yet and
   * MUST NOT be moved there. The webhook's slip path is the case it was built
   * for: it spends money on a paid verification hundreds of lines before the
   * limiter runs, and that verification is discarded when the verdict comes back
   * limited. Asking here costs one Redis read; guessing costs a billed API call.
   *
   * IT IS DELIBERATELY NOT A SECOND LIMITER. It performs no INCR, writes no key
   * and adds no strike, so it cannot double-charge, cannot advance a ladder
   * level and cannot change what `consume` decides one line later. The counter
   * still moves in exactly one place.
   *
   * EVERY OTHER DETAIL MIRRORS `consume` ON PURPOSE — same `buildKey` (so the
   * two can never read different keys, which is why that helper exists at all),
   * same override handling, same `limited: current > limit` comparison, same
   * fail-open on a null from Redis. The only line that differs is `getCount`
   * where `consume` has `incrementWithTtl`.
   *
   * ⚠️ `current > limit`, NOT `>=`. This answers "is the identifier ALREADY
   * over", not "would the next request tip it over". The conservative reading is
   * the right one for a caller that is deciding whether to skip work: at the
   * exact boundary it says "not over", the work runs, and the behaviour is
   * whatever it is today. Being wrong in that direction costs one API call;
   * being wrong the other way would drop a customer's slip that was still
   * inside its quota. ตอบแบบระวังไว้ก่อน — พลาดทางนี้เสียเงินหนึ่งครั้ง
   * พลาดอีกทางลูกค้าเสียสลิป.
   *
   * revert: delete this method and its one call site.
   */
  async peek(
    bucket: RateLimitBucket,
    identifier: string,
    override?: RateLimitOverride,
  ): Promise<RateLimitVerdict> {
    const { limit, windowSeconds } = override ?? this.limitsFor(bucket);

    if (!identifier) {
      return { limited: false, current: null, limit, windowSeconds };
    }

    const key = this.buildKey(bucket, identifier, override?.keySuffix);
    const current = await this.redis.getCount(key);

    // null means Redis failed, or the window has no key yet — both mean "not
    // over", and both must let the caller proceed. Same rule as `consume`.
    if (current === null) {
      return { limited: false, current: null, limit, windowSeconds };
    }

    return { limited: current > limit, current, limit, windowSeconds };
  }

  /**
   * The one place a Redis key is spelled. Extracted [FEAT-20260823-LOGINUSER]
   * so the username layer cannot drift from `consume`'s format — the exact
   * string is pinned by `rate-limit.spec.ts` ('applies the per-bucket window
   * and limit'), so a change here goes red immediately.
   */
  private buildKey(
    bucket: RateLimitBucket,
    identifier: string,
    keySuffix?: string,
  ): string {
    return (
      `ratelimit:${this.envNamespace}:${bucket}:${identifier}` +
      (keySuffix ? `:${keySuffix}` : '')
    );
  }

  /** The configured numbers for a bucket. Public since [FEAT-20260821-RATELADDER]:
   *  the per-user ladder scales them, and must start from the same values. */
  limitsFor(bucket: RateLimitBucket): {
    limit: number;
    windowSeconds: number;
  } {
    switch (bucket) {
      case 'global':
        return {
          limit: this.config.globalMax,
          windowSeconds: this.config.globalWindowSeconds,
        };
      case 'login':
        return {
          limit: this.config.loginMax,
          windowSeconds: this.config.loginWindowSeconds,
        };
      case 'login_fail':
        // [FEAT-20260823-LOGINFAIL] ตัวเลขอิสระจากอีกสองแกน
        return {
          limit: this.config.loginFailMax,
          windowSeconds: this.config.loginFailWindowSeconds,
        };
      case 'login_user':
        // [FEAT-20260823-LOGINUSER] ตัวเลขอิสระ ไม่ได้อ้างอิงชั้น IP เลย
        return {
          limit: this.config.loginUserMax,
          windowSeconds: this.config.loginUserWindowSeconds,
        };
      case 'key':
        return {
          limit: this.config.keyMax,
          windowSeconds: this.config.keyWindowSeconds,
        };
      case 'default':
        return {
          limit: this.config.defaultMax,
          windowSeconds: this.config.defaultWindowSeconds,
        };
    }
  }

  /** Whether the opt-in global per-IP limiter is switched on. */
  isGlobalEnabled(): boolean {
    return this.config.globalEnabled;
  }

  /** [FEAT-20260826-RLSHADOW] Whether the count-only shadow instrument is on. */
  isGlobalShadowEnabled(): boolean {
    return this.config.globalShadow;
  }

  /* ── [FEAT-20260823-LOGINUSER] ชั้นที่ 2 ของ login — นับต่อชื่อผู้ใช้ ──────────
   * สามเมธอดนี้เป็นก้อนเดียวกัน ลบพร้อมกันได้ทั้งหมดโดยไม่กระทบของเดิม
   * (ไม่มีโค้ดเดิมบรรทัดไหนเรียกมัน). ต่างจาก `consume` ตรงที่แยก
   * "ดู" ออกจาก "นับ" เพราะเราจะนับเฉพาะครั้งที่รหัสผิดจริง.
   *
   * ⚠️ fail-open เหมือนกันทุกเมธอด: Redis ตอบไม่ได้ = ไม่บล็อก
   *    (`getCount`/`incrementWithTtl` คืน null และไม่โยน — redis.service.ts:105,81)
   */

  /** ชั้น username เปิดอยู่ไหม — ปิด = ไม่มีการแตะ Redis เพิ่มเลย */
  isLoginUserEnabled(): boolean {
    return this.config.loginUserEnabled;
  }

  /** [FEAT-20260823-LOGINFAIL] ชั้น "รหัสผิดต่อ IP" เปิดอยู่ไหม */
  isLoginFailEnabled(): boolean {
    return this.config.loginFailEnabled;
  }

  /** ดูอย่างเดียว ไม่นับเพิ่ม — แกน "รหัสผิดต่อ IP" */
  async isLoginIpFailBlocked(clientIp: string): Promise<boolean> {
    return this.peekFailAxis('login_fail', clientIp);
  }

  /** นับหนึ่งครั้ง เฉพาะตอนรหัสผิดจริง — แกน "รหัสผิดต่อ IP" */
  async chargeLoginIpFailure(clientIp: string): Promise<void> {
    return this.chargeFailAxis('login_fail', clientIp);
  }

  /* แกนกลางของ "ดู/นับ แบบนับเฉพาะที่ผิด" — สองแกน (IP กับ username) ใช้ร่วมกัน
     เพื่อไม่ให้กติกา fail-open และรูปแบบคีย์แตกออกเป็นสองชุดที่เพี้ยนกันได้. */
  private async peekFailAxis(
    bucket: RateLimitBucket,
    identifier: string,
  ): Promise<boolean> {
    if (!identifier) return false;

    const { limit } = this.limitsFor(bucket);
    const current = await this.redis.getCount(
      this.buildKey(bucket, identifier),
    );

    // null = Redis ตอบไม่ได้ ⇒ ปล่อยผ่าน
    return current !== null && current >= limit;
  }

  private async chargeFailAxis(
    bucket: RateLimitBucket,
    identifier: string,
  ): Promise<void> {
    if (!identifier) return;

    try {
      const { windowSeconds } = this.limitsFor(bucket);
      await this.redis.incrementWithTtl(
        this.buildKey(bucket, identifier),
        windowSeconds,
      );
    } catch {
      /* นับไม่ได้ = ปล่อยผ่าน ห้ามทำให้ข้อความ error ของ login เพี้ยน */
    }
  }

  /**
   * ดูอย่างเดียว **ไม่นับเพิ่ม** — ใช้ถามก่อนตรวจรหัสผ่าน
   * @returns true = เกินโควตาแล้ว ให้ตอบ 429 · false = ปล่อยผ่าน (รวมกรณี Redis ล่ม)
   */
  async isLoginUserBlocked(normalizedUsername: string): Promise<boolean> {
    return this.peekFailAxis('login_user', normalizedUsername);
  }

  /**
   * นับหนึ่งครั้ง — เรียก **เฉพาะตอนรหัสผิดจริง** เท่านั้น
   *
   * ล็อกอินสำเร็จไม่เรียก และ error อื่น (Mongo ล่ม, 500) ก็ไม่เรียก
   * ⇒ คนใช้งานปกติกับเหตุขัดข้องของระบบ ไม่มีทางกินโควตาบัญชีตัวเอง.
   * ไม่โยน error ออกไปไม่ว่ากรณีใด — มันถูกเรียกอยู่ใน catch ของ login.
   */
  async chargeLoginUserFailure(normalizedUsername: string): Promise<void> {
    return this.chargeFailAxis('login_user', normalizedUsername);
  }
}
