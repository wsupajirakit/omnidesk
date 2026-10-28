import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { realtimeConfig } from '@/config/app.config';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { RedisService } from '@/infra/redis/redis.service';

import {
  DEFAULT_USER_RATE_LADDER,
  isCountedType,
  levelFor,
  limitsAtLevel,
  replyTextFor,
  type UserRateLadderConfig,
} from './user-rate-ladder';

/**
 * [FEAT-20260821-RATELADDER] The strike counter and the escalation — the part
 * of the ladder that touches Redis. The policy (numbers, switches) is the pure
 * file beside this; the reply (send or stay silent) is the webhook's.
 *
 * WHAT A "STRIKE" IS (owner, 21/08): being limited ONCE PER WINDOW. The
 * 4th, 5th, 6th blocked messages of one burst are one strike, not three —
 * recognised as `current === limit + 1`, the first request past the limit in
 * that window, which needs no extra key. Strikes live in
 * `ratelimit-strike:<env>:<userId>` with a TTL set on the FIRST strike only
 * (`incrementWithTtl` sets expiry at count 1), so "reset เมื่อครบ 12 ชั่วโมง"
 * is 12 h from the first strike, fixed, not sliding.
 *
 * WHICH WINDOW A CUSTOMER IS IN: the strike count is read BEFORE charging, so
 * the level's numbers apply from the very next message. ONE key per customer
 * (the pre-existing one) at every level: a level changes the limit compared
 * against and the TTL a window gets when it starts — never the counter. So the
 * rest of the burst that earned a strike stays over the limit until that
 * window expires, and the window after it starts with the harsher numbers.
 * (Per-level keys were tried first and leaked two messages right after a
 * strike — a fresh key is an empty window. Seen live 21/08, removed.)
 *
 * FAIL OPEN, like the limiter it wraps: a Redis miss on the strike read means
 * level 1 (never a harsher level on a guess); a miss on the charge means
 * "not limited" — inherited from RateLimitService, not re-decided here.
 *
 * INJECTED IN THE LIMITER'S OLD SLOT in webhook.service.ts: `consume()` keeps
 * the limiter's verdict shape (`limited`, `current`, `limit`, `windowSeconds`)
 * and adds its own fields, so every spec that hands the webhook a
 * `{ consume: () => ({ limited: false }) }` fake keeps compiling and passing.
 *
 * revert: drop the provider + the slot change; see user-rate-ladder.ts.
 */

export interface UserRateVerdict {
  limited: boolean;
  current: number | null;
  limit: number;
  windowSeconds: number;
  /** false = this message type is not charged (switch in the policy) — nothing was counted */
  counted: boolean;
  level: number;
  strikes: number;
  /** true only on the ONE request that turned this window into a strike */
  strikeAdded: boolean;
  /** what the webhook should say, or null for silence — already resolved per level */
  replyText: string | null;
}

export const USER_RATE_LADDER_CONFIG = Symbol('USER_RATE_LADDER_CONFIG');

@Injectable()
export class UserRateLadderService {
  private readonly logger = new Logger(UserRateLadderService.name);
  private readonly envNamespace: string;
  private readonly cfg: UserRateLadderConfig;

  constructor(
    private readonly limiter: RateLimitService,
    private readonly redis: RedisService,
    @Inject(realtimeConfig.KEY) realtime: ConfigType<typeof realtimeConfig>,
    // Code-level config (owner: ไม่ใช้ env ใช้ code). Injectable only so a spec can
    // hand in a variant; production binds nothing and gets the default.
    @Optional() @Inject(USER_RATE_LADDER_CONFIG) cfg?: UserRateLadderConfig,
  ) {
    this.envNamespace = String(realtime.wsEnv || 'prod').replace(/[^\w-]/g, '');
    this.cfg = cfg ?? DEFAULT_USER_RATE_LADDER;
  }

  /**
   * Charge one message from `userId` of LINE type `messageType`.
   * Not counted types return `{ limited: false, counted: false }` without any I/O.
   */
  async consume(
    userId: string,
    messageType?: string | null,
  ): Promise<UserRateVerdict> {
    const base = this.limiter.limitsFor('default');
    const silent = {
      current: null,
      limit: base.limit,
      windowSeconds: base.windowSeconds,
      level: 1,
      strikes: 0,
      strikeAdded: false,
      replyText: replyTextFor(1, this.cfg),
    };
    if (!userId || !isCountedType(messageType, this.cfg)) {
      return { ...silent, limited: false, counted: false };
    }

    // Level 1 with the ladder off = the pre-existing call, argument for argument.
    if (!this.cfg.enabled) {
      const v = await this.limiter.consume('default', userId);
      return {
        ...v,
        counted: true,
        level: 1,
        strikes: 0,
        strikeAdded: false,
        replyText: replyTextFor(1, this.cfg),
      };
    }

    // [FEAT-20260824-RATEPEEK] the strike read, the level and the limits used to
    // be spelled here. They moved into `resolveLevel` UNCHANGED so `peek` below
    // can ask the same question without a second copy of the arithmetic —
    // two copies would drift and the money path would follow the wrong one.
    const strikeKey = this.strikeKeyFor(userId);
    const { strikes, level, limits } = await this.resolveLevel(userId);

    const v = await this.limiter.consume(
      'default',
      userId,
      // level 1 = no override = the exact pre-existing call. Higher levels pass
      // their numbers but NO key suffix — same counter, see the header.
      level === 1
        ? undefined
        : { limit: limits.limit, windowSeconds: limits.windowSeconds },
    );

    // One strike per window: the first request past the limit, and only that one.
    const strikeAdded = v.limited && v.current === v.limit + 1;
    if (strikeAdded) {
      const total = await this.redis.incrementWithTtl(
        strikeKey,
        this.cfg.strikeResetHours * 3600,
      );
      this.logger.log(
        `[RATELADDER] user=${userId} level=${level} strike #${total ?? '?'} (limit ${v.limit}/${v.windowSeconds}s) — next window runs at level ${levelFor(total ?? strikes + 1, this.cfg)}`,
      );
    }

    return {
      ...v,
      counted: true,
      level,
      strikes,
      strikeAdded,
      replyText: replyTextFor(level, this.cfg),
    };
  }

  /** The one place this service's strike key is spelled. */
  private strikeKeyFor(userId: string): string {
    return `ratelimit-strike:${this.envNamespace}:${userId}`;
  }

  /**
   * [FEAT-20260824-RATEPEEK] Strikes → level → the numbers that level runs at.
   *
   * Lifted verbatim out of `consume`, not rewritten: `peek` has to reach the
   * SAME level for the same customer or it would answer a question about a
   * different window than the one that is about to be charged. Keeping it in one
   * function is what makes that structural rather than a promise.
   *
   * Reads only. `null` from Redis (down, or no strike yet) → 0 → level 1, the
   * same fail-open `consume` has always had.
   */
  private async resolveLevel(userId: string): Promise<{
    strikes: number;
    level: number;
    limits: { limit: number; windowSeconds: number };
  }> {
    const base = this.limiter.limitsFor('default');
    const strikes = (await this.redis.getCount(this.strikeKeyFor(userId))) ?? 0;
    const level = levelFor(strikes, this.cfg);
    return { strikes, level, limits: limitsAtLevel(level, base, this.cfg) };
  }

  /**
   * [FEAT-20260824-RATEPEEK] "Is this customer already over their window?" —
   * answered WITHOUT charging them for asking.
   *
   * WHAT IT IS FOR: the webhook spends a paid slip verification hundreds of
   * lines before `consume` runs, and every branch of the limited path returns
   * before that verification is ever used. So the money was spent on an answer
   * the flow had already decided to throw away. This lets that one call site ask
   * first. It is not a gate, not a second limiter, and not a place to add
   * policy — it reports what the counter already says.
   *
   * ⚠️ IT MUST NOT WRITE ANYTHING. No INCR, no TTL, no strike. `consume` stays
   * the single writer, at its single call site, exactly as
   * `[FEAT-20260821-RATELADDER]` and the "THIS BLOCK MUST EXIST EXACTLY ONCE"
   * warning in webhook.service.ts require. อ่านอย่างเดียว ห้ามนับ.
   *
   * The three early exits mirror `consume` one for one — an uncounted message
   * type, and the ladder switched off — so a caller can never see peek and
   * consume disagree about whether this event is even in scope.
   *
   * revert: delete this method, `resolveLevel`, `strikeKeyFor`, and put the
   *         four inlined lines back at the top of `consume`.
   */
  async peek(
    userId: string,
    messageType?: string | null,
  ): Promise<{
    limited: boolean;
    level: number;
    current: number | null;
    limit: number;
  }> {
    const base = this.limiter.limitsFor('default');

    // Not a counted type / no user ⇒ nothing is being counted, so nothing to be
    // over. Same guard, same order, as `consume`.
    if (!userId || !isCountedType(messageType, this.cfg)) {
      return { limited: false, level: 1, current: null, limit: base.limit };
    }

    // Ladder off ⇒ level 1 only, no override — the pre-ladder call shape.
    if (!this.cfg.enabled) {
      const v = await this.limiter.peek('default', userId);
      return {
        limited: v.limited,
        level: 1,
        current: v.current,
        limit: v.limit,
      };
    }

    const { level, limits } = await this.resolveLevel(userId);
    const v = await this.limiter.peek(
      'default',
      userId,
      // level 1 = no override = the exact key and numbers `consume` would use.
      level === 1
        ? undefined
        : { limit: limits.limit, windowSeconds: limits.windowSeconds },
    );
    return { limited: v.limited, level, current: v.current, limit: v.limit };
  }
}
