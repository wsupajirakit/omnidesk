import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { realtimeConfig } from '@/config/app.config';
import { RedisService } from '@/infra/redis/redis.service';
import { Hook, getAllowedHookIds, type HookDocument } from '@/modules/hooks';

/**
 * [FEAT-20260808-HTTPONLY-S1] Short-lived, single-use WebSocket connection
 * tickets.
 *
 * The dashboard cannot put a token in a WebSocket handshake header, and once the
 * JWT is an HttpOnly cookie it cannot read it to append `?token=` either. So the
 * FE asks this authenticated endpoint for an opaque ticket and connects with
 * `?ticket=<t>`. omnidesk-ws consumes it with a Redis GETDEL — atomic, so the ticket
 * works exactly once and two concurrent handshakes cannot both win.
 *
 * CRITICAL: the ticket payload carries the caller's resolved `allowedHooks` —
 * the SAME per-tenant fan-out set the HTTP endpoints compute — because omnidesk-ws
 * filters events by it. A wrong or missing set would leak another tenant's
 * events. The stored shape is EXACTLY what omnidesk-ws reads: `{ userId,
 * allowedHooks, env }`, with `allowedHooks: null` meaning super/all (no filter).
 *
 * DB-EFFECT: no Mongo schema/write change. The ticket is an EPHEMERAL Redis key
 * (`ws_ticket:<token>`) with a TTL, deleted on first use.
 */

/** Redis key namespace consumed by omnidesk-ws (`ws_ticket:<token>`). */
const WS_TICKET_KEY_PREFIX = 'ws_ticket:';

/**
 * Stored ticket payload. Field names and casing are the contract omnidesk-ws reads
 * with `JSON.parse` — do not rename. `allowedHooks: null` ⇒ no fan-out filter.
 */
export interface WsTicketPayload {
  userId: string;
  allowedHooks: string[] | null;
  env: string;
  /**
   * [FIX-20260818-WSSENTINEL · plan W1] Whether this caller is a super user.
   *
   * WHY IT EXISTS. `allowedHooks: null` is doing two jobs at once: on this path
   * it means "super — no filter", and on omnidesk-ws's other auth path (the raw JWT)
   * it means "this account has no allowed_hooks field", which is 8 of the 11
   * accounts in the live database. omnidesk-ws cannot tell those apart, so it does
   * not filter either of them — that is the leak.
   *
   * This field lets it tell them apart WITHOUT changing what `allowedHooks`
   * carries. Nothing reads it yet: shipping it is a no-op by construction, and
   * that is the point — the consumer can only be changed safely once every
   * ticket in flight already carries the answer.
   *
   * ⚠️ Its PRESENCE is also the version marker. A ticket minted by an older
   * backend (main/dev) simply has no such key, and omnidesk-ws is expected to read
   * that absence as "old rules apply". So this field must never be removed once
   * shipped, and must never be sent as `undefined` — either it is there with a
   * boolean, or the payload is an old one. ห้ามส่งเป็น undefined เด็ดขาด
   */
  is_super: boolean;
}

export interface WsTicketResult {
  ticket: string;
  /** TTL in seconds, so the FE knows how long it has to complete the handshake. */
  expiresIn: number;
}

@Injectable()
export class WsTicketService {
  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<HookDocument>,
    private readonly redis: RedisService,
    @Inject(realtimeConfig.KEY)
    private readonly realtime: ConfigType<typeof realtimeConfig>,
  ) {}

  /**
   * Resolves the caller's OA allowlist for the ticket payload.
   *
   * [FIX-20260818-OAACCESSONE · plan §7.1 = C2/C3 = T3-2] This used to be a local
   * copy that CLAIMED to be "kept byte-identical" to the HTTP path while missing
   * its middle tier — the per-user `allowed_hooks` whitelist. The claim is what
   * made the gap invisible: an operator scoped to one OA over REST received
   * realtime events for every OA in their group. Now there is one implementation
   * and no claim to keep true. ไม่ก๊อปแล้ว ใช้ตัวเดียวกับ REST จริง ๆ
   */
  private async resolveAllowedHooks(
    user: AuthenticatedUser,
  ): Promise<string[] | null> {
    return getAllowedHookIds(user, this.hookModel);
  }

  /**
   * Mints a ticket for an authenticated caller and stores it in Redis with a
   * TTL. The token is 32 random bytes (base64url) — opaque and unguessable, so
   * it carries no meaning of its own; all authority lives in the stored payload.
   */
  async mint(user: AuthenticatedUser): Promise<WsTicketResult> {
    const allowedHooks = await this.resolveAllowedHooks(user);
    const ttlSeconds = this.realtime.wsTicketTtlSec;

    const token = randomBytes(32).toString('base64url');

    const payload: WsTicketPayload = {
      userId: user.userId,
      allowedHooks,
      env: this.realtime.wsEnv,
      /* [FIX-20260818-WSSENTINEL · plan W1] Derived from the SAME predicate the
         resolver above uses, so the two can never disagree about who is super:
         `allowedHooks === null` is exactly what `getAllowedHookIds` returns for
         a super user and for nobody else. Reading it back from the resolved
         value rather than calling `isSuperUser` again means there is one
         decision, not two that could drift. */
      is_super: allowedHooks === null,
    };

    // `set` with EX gives the key its TTL atomically at creation, so a ticket
    // that is never consumed still self-expires and cannot pile up in Redis.
    await this.redis
      .getClient()
      .set(
        `${WS_TICKET_KEY_PREFIX}${token}`,
        JSON.stringify(payload),
        'EX',
        ttlSeconds,
      );

    return { ticket: token, expiresIn: ttlSeconds };
  }
}
