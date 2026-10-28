import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { realtimeConfig } from '@/config/app.config';
import { RedisService } from '@/infra/redis/redis.service';

/**
 * Wire format consumed by the websocket gateway. The gateway forwards any
 * `{type, data, ts}` envelope without inspecting `type`, so new event types need
 * no gateway change — but the shape itself is a contract and cannot drift.
 */
export interface RealtimeEnvelope<
  TData extends ScopedEventData = ScopedEventData,
> {
  type: string;
  data: TData;
  ts: number;
}

/**
 * Every realtime payload must carry `hook_id` at the top level.
 *
 * This is a security boundary, not a convention: the gateway filters delivery by
 * `data.hook_id` against each connection's allowed hooks. A payload without it
 * is broadcast to **every** connected operator in the environment, including
 * operators of other tenants. Requiring the field in the type means a new call
 * site cannot forget it — the compiler refuses.
 */
export interface ScopedEventData {
  hook_id: string;
  [key: string]: unknown;
}

/**
 * Publishes realtime events to the websocket gateway over Redis pub/sub.
 *
 * Two rules hold for every method here:
 *
 * 1. **Never throw.** Realtime is an enhancement; a Redis hiccup must not fail
 *    the operation that triggered it (sending a message, linking an account).
 *    Callers fire-and-forget and the failure is logged, not propagated.
 * 2. **Scoped, not sanitised — and that is a deliberate trade.**
 *    [FIX-20260818-PUBSUBTRUTH · plan §7.3 = C5 = T3-6 of fix_plan_18_aug]
 *
 *    This rule used to read "Never carry PII. Events say *what changed and
 *    where*, never the changed values." That was false, and the falsehood was
 *    load-bearing: it was the only place in the repo making that promise, so a
 *    reader adding a field would conclude the channel was already clean and
 *    skip the question entirely.
 *
 *    What actually goes on the wire today — `publish` below does
 *    `JSON.stringify({type, data, ts})` with `data` VERBATIM; there is no
 *    redaction step anywhere between a caller and Redis:
 *      · `message:new` carries `sender_name` and a 120-character `preview` of
 *        the message body (`chat/chat-history.service.ts` — the comment there
 *        explains why: an admin with the room open appends the bubble from this
 *        payload alone, so without them the copy would render wrong);
 *      · customer/ticket events carry ids that identify a person
 *        (`channel_user_id`, `sender_id`, room ids).
 *    So a customer's words and display name DO travel over pub/sub.
 *
 *    Why that is acceptable here: `hook_id` is mandatory (see `ScopedEventData`)
 *    and the gateway filters delivery by it, so an event only reaches operators
 *    already entitled to that OA — the same set the authenticated API would
 *    serve. The protection is the scope, not the emptiness of the payload.
 *
 *    ⚠️ BEFORE ADDING A FIELD, answer these — the old wording let all three be
 *    skipped: (a) would an operator entitled to this `hook_id` be allowed to
 *    read it through the REST API? if not, it must not ride here either;
 *    (b) does anything downstream of Redis persist or log the envelope (a WS
 *    access log, a replay buffer, an AOF that gets backed up)? that turns a
 *    scoped delivery into stored customer data; (c) is it needed to RENDER, or
 *    only to know *that* something changed? if the latter, leave it out and let
 *    the client re-fetch.
 *
 *    Removing `preview`/`sender_name` was considered and is NOT free: the
 *    dashboard appends each bubble from this payload, so dropping them turns
 *    every inbound message into a full page refetch. That is a separate,
 *    cross-repo decision — not something to do while adding an event.
 *    ช่องนี้ปลอดภัยเพราะ "ส่งถึงเฉพาะคนที่มีสิทธิ์ OA นั้น" ไม่ใช่เพราะไม่มีข้อมูลลูกค้า
 */
@Injectable()
export class RealtimePublisherService {
  private readonly logger = new Logger(RealtimePublisherService.name);
  private readonly channel: string;

  constructor(
    private readonly redis: RedisService,
    @Inject(realtimeConfig.KEY) config: ConfigType<typeof realtimeConfig>,
  ) {
    // One channel per environment so a shared Redis host cannot deliver dev
    // events to production dashboards.
    this.channel =
      config.wsEnv === 'prod'
        ? (config.prodWsChannel ?? 'ticket_events_prod')
        : `ticket_events_${config.wsEnv}`;
  }

  /** Channel this instance publishes to — exposed for diagnostics. */
  getChannel(): string {
    return this.channel;
  }

  /**
   * Publishes one scoped event. The only way to emit realtime traffic, so the
   * `hook_id` guarantee cannot be bypassed by a new caller.
   */
  async publish(type: string, data: ScopedEventData): Promise<void> {
    if (!data?.hook_id) {
      // Unscoped payloads would fan out to every operator — drop instead.
      this.logger.warn(`skip publish "${type}" — missing hook_id`);
      return;
    }

    try {
      const envelope: RealtimeEnvelope = { type, data, ts: Date.now() };
      await this.redis.publish(this.channel, JSON.stringify(envelope));
    } catch (error) {
      // Swallow deliberately. Callers fire-and-forget from inside business
      // operations (storing a message, linking an account); letting a realtime
      // failure escape would fail the operation itself, which is strictly worse
      // than a dashboard that updates on the next refresh.
      this.logger.error(
        `publish "${type}" failed: ${(error as Error).message}`,
      );
    }
  }
}
