import { Inject, Injectable } from '@nestjs/common';

import type {
  LineMessage,
  LineSendRequest,
  LineSendResult,
} from '@/infra/line';
import { LinePushDispatcher } from '@/infra/line';

/**
 * [FEAT-20260821-QUOTEREPLY] The admin console's send LADDER — reply first when a
 * token is still alive, push otherwise — as a strategy the chat module binds once.
 *
 * WHY HERE AND NOT IN THE CORE: `src/infra/line/push/line-push.ts:47-73` is
 * explicit — "ladders belong to callers … ตัวกลางต้องโง่เรื่อง business เสมอ". The
 * core sees exactly one `kind` per call and knows nothing about tokens' ages,
 * rooms, or quotes. This file is the business; the core stays the wire.
 *
 * WHY A STRATEGY AND NOT AN `if`: the owner's condition (21/08) — "เปิด ปิดง่าย
 * ถอดใส่ง่ายเผื่อมีปัญหา … เผื่อวันนึงอยาก push อย่างเดียวเหมือนเดิม". Two classes,
 * one binding (`chat.module.ts`, chosen by `CHAT_REPLY_REUSE`), and the services
 * call `strategy.send(...)` without knowing which one they hold:
 *   · `PushOnlySendStrategy`   — today. The request reaches `dispatch` unchanged.
 *                                 Permanent default; `CHAT_REPLY_REUSE=off`.
 *   · `ReplyReuseSendStrategy` — reply → push → push-without-quote.
 *                                 `CHAT_REPLY_REUSE=on`.
 *   Off switch = the env (no deploy). Remove = delete `ReplyReuseSendStrategy`
 *   + its spec + the env line; nothing else knows it existed. ถอด = ลบไฟล์เดียว.
 *
 * THE RUNGS, and why each edge is where it is (pinned by
 * z-test/unit/outbound-send-strategy.spec.ts):
 *   reply  — only with a candidate the caller already judged alive (fresh,
 *            unspent, admin-held room). Free of the monthly push quota; that is
 *            the whole benefit. On a DEFINITE 4xx (token dead/used) → next rung.
 *   push   — with the quoteToken still attached: LINE accepts it on push and it
 *            never expires, so the customer's phone shows the quote either way.
 *   push − quote — only if LINE refused the quoted push (4xx). Says `dropped`.
 *   STOP on 5xx / transport at ANY rung: delivery is unknown, and the reply rung
 *   carries no X-Line-Retry-Key (LINE has none for reply), so a second call could
 *   deliver twice. The error surfaces exactly as today. ไม่รู้ว่าถึงไหม = ห้ามยิงซ้ำ.
 *
 * `replyTokenSpent` is reported, not acted on: the CALLER stamps
 * `reply_token_used_at` on the inbound row (it owns the model; this file owns no
 * I/O but the dispatcher). `wantsReplyCandidate` lets the caller skip that DB
 * lookup entirely when the strategy would never use it — off means zero extra reads.
 *
 * revert: delete this file, bind nothing, and put `this.linePush.dispatch({kind:'push',…})`
 * back at the two call sites (chat.service.ts / chat-media.service.ts).
 */

/** What the service wants delivered. `messages` come from the builder, quote already placed. */
export interface OutboundSendPlan {
  token: string;
  to: string;
  messages: LineMessage[];
  timeoutMs: number;
}

/** An inbound reply token the caller judged still usable. Absent = push only. */
export interface ReplyCandidate {
  replyToken: string;
  /** The inbound `chat_messages._id` whose token this is — so the caller can stamp it spent. */
  rowId: string;
}

export interface OutboundSendOutcome {
  /** The core's result for the rung that ended the ladder. */
  res: LineSendResult;
  /** Which endpoint the final attempt used. */
  sentKind: 'reply' | 'push';
  /** `kept` = quote on the wire · `dropped` = LINE refused it, resent plain · `none` = no quote asked. */
  quote: 'kept' | 'dropped' | 'none';
  /** True only when the reply rung succeeded — the caller must then stamp the row. */
  replyTokenSpent: boolean;
  spentRowId?: string;
  /** How many real HTTP calls the ladder made — the audit writes one row per call. */
  attempts: Array<{
    kind: 'reply' | 'push';
    quote: 'kept' | 'none';
    res: LineSendResult;
  }>;
}

export interface OutboundSendStrategy {
  readonly wantsReplyCandidate: boolean;
  send(
    plan: OutboundSendPlan,
    candidate?: ReplyCandidate | null,
  ): Promise<OutboundSendOutcome>;
}

/** Injection token — `chat.module.ts` binds exactly one implementation to it. */
export const OUTBOUND_SEND_STRATEGY = Symbol('OUTBOUND_SEND_STRATEGY');

const hasQuote = (messages: LineMessage[]): boolean =>
  messages.some((m) => 'quoteToken' in (m as object));

const withoutQuote = (messages: LineMessage[]): LineMessage[] =>
  messages.map((m) => {
    const { quoteToken: _dropped, ...rest } = m as LineMessage & {
      quoteToken?: string;
    };
    void _dropped;
    return rest;
  });

/** A 4xx is LINE saying "not delivered, and retrying the same thing will not help". 409 never reaches here (core maps it to ok). */
const definiteRefusal = (res: LineSendResult): boolean =>
  !res.ok && res.status >= 400 && res.status < 500;

/**
 * Today's behaviour, unchanged: one push with the request as built. The only
 * addition is the quote-drop rung, which can only fire when a quote was asked for —
 * a plain send makes exactly one call, as before.
 */
@Injectable()
export class PushOnlySendStrategy implements OutboundSendStrategy {
  public readonly wantsReplyCandidate: boolean = false;

  constructor(
    @Inject(LinePushDispatcher) protected readonly core: LinePushDispatcher,
  ) {}

  /** The candidate is accepted and IGNORED — same signature as the reuse strategy,
   *  so the services never branch on which one they hold. */
  public async send(
    plan: OutboundSendPlan,
    candidate?: ReplyCandidate | null,
  ): Promise<OutboundSendOutcome> {
    void candidate; // accepted and ignored — see the doc line above
    return this.pushRungs(plan, []);
  }

  /** push (with quote if any) → on definite refusal of a quoted push, push plain. */
  protected async pushRungs(
    plan: OutboundSendPlan,
    attempts: OutboundSendOutcome['attempts'],
  ): Promise<OutboundSendOutcome> {
    const quoted = hasQuote(plan.messages);
    const first = await this.core.dispatch(
      this.pushRequest(plan, plan.messages),
    );
    attempts.push({
      kind: 'push',
      quote: quoted ? 'kept' : 'none',
      res: first,
    });
    if (first.ok || !quoted || !definiteRefusal(first)) {
      return {
        res: first,
        sentKind: 'push',
        quote: quoted ? 'kept' : 'none',
        replyTokenSpent: false,
        attempts,
      };
    }
    const plain = await this.core.dispatch(
      this.pushRequest(plan, withoutQuote(plan.messages)),
    );
    attempts.push({ kind: 'push', quote: 'none', res: plain });
    return {
      res: plain,
      sentKind: 'push',
      quote: 'dropped',
      replyTokenSpent: false,
      attempts,
    };
  }

  private pushRequest(
    plan: OutboundSendPlan,
    messages: LineMessage[],
  ): LineSendRequest {
    // Field order matters to nobody but the parity spec, which deep-equals this
    // against what the service used to build inline. Keep it as it was.
    return {
      kind: 'push',
      token: plan.token,
      to: plan.to,
      messages,
      timeoutMs: plan.timeoutMs,
    };
  }
}

/** reply (if a live candidate) → the push rungs above. */
@Injectable()
export class ReplyReuseSendStrategy extends PushOnlySendStrategy {
  public override readonly wantsReplyCandidate: boolean = true;

  public override async send(
    plan: OutboundSendPlan,
    candidate?: ReplyCandidate | null,
  ): Promise<OutboundSendOutcome> {
    if (!candidate?.replyToken) return this.pushRungs(plan, []);

    const quoted = hasQuote(plan.messages);
    const reply = await this.core.dispatch({
      kind: 'reply',
      token: plan.token,
      replyToken: candidate.replyToken,
      messages: plan.messages,
      timeoutMs: plan.timeoutMs,
    });
    const attempts: OutboundSendOutcome['attempts'] = [
      { kind: 'reply', quote: quoted ? 'kept' : 'none', res: reply },
    ];
    if (reply.ok) {
      return {
        res: reply,
        sentKind: 'reply',
        quote: quoted ? 'kept' : 'none',
        replyTokenSpent: true,
        spentRowId: candidate.rowId,
        attempts,
      };
    }
    if (!definiteRefusal(reply)) {
      // 5xx / transport: LINE may have delivered. Do NOT push.
      return {
        res: reply,
        sentKind: 'reply',
        quote: quoted ? 'kept' : 'none',
        replyTokenSpent: false,
        attempts,
      };
    }
    return this.pushRungs(plan, attempts);
  }
}
