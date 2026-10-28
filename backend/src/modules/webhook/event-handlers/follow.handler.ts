import type {
  EventHandlerContext,
  EventHandlerDeps,
  WebhookEventHandler,
} from './event-handler.port';

/**
 * [FEAT-20260905-EVENTREG] `follow` — a customer added the OA.
 *
 * THE FIRST TYPE ONBOARDED, and chosen because it is the one the spine most visibly
 * ignores: today a follow reaches the flow, finds no gate that wants it, and leaves
 * nothing behind but the raw forensic row. An operator asking "did anyone add us today"
 * has nowhere to look.
 *
 * ⚠️⚠️ IT SHIPS SWITCHED OFF. It went live at SP11 with `enabled: true`, which made every
 * follow event write a row that nobody had asked for — a behaviour change inside an
 * infrastructure change. The row itself is fine and this handler is ready; what was wrong
 * was that it started writing without a decision. `handler-entries.ts` now refuses an
 * enabled entry that does not record who decided. เปิดเมื่อมีคนสั่ง ไม่ใช่เปิดมาเอง
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO. It does not reply, does not touch the member row,
 * does not open a ticket. Those are product decisions nobody has made; inventing them
 * inside an infrastructure change would be exactly the kind of silent behaviour this
 * program forbids. It writes ONE structured log row so the event stops being invisible,
 * and the day someone decides a follow should send a greeting, this file is the obvious
 * place and the only file that changes.
 */
export const followHandler: WebhookEventHandler = {
  eventType: 'follow',
  describe: 'records that a customer added the OA; sends nothing',

  async handle(
    ctx: EventHandlerContext,
    deps: EventHandlerDeps,
  ): Promise<void> {
    const userId = ctx.event.source?.userId;
    deps.log(
      `[EVENT] follow from ${userId ?? 'unknown user'} (hook=${ctx.alias ?? '-'})`,
    );
    await deps.emitWlog({
      ...ctx.logContext,
      channel: 'webhook',
      action_type: 'event_follow',
      status: 'success',
      payload_summary: { user_id: userId, source_type: ctx.event.source?.type },
    });
  },
};
