/**
 * [FIX-20260902-FLEXLADDER] Every flex card can now fall back to push — and the
 * ordinary reply must still be the one that carries it.
 * ===========================================================================
 * WHY BOTH HALVES ARE HERE. A ladder is easy to get half right in the expensive
 * direction: a version that always pushes would pass any test that only checks
 * "the customer got it", while quietly billing every single card against the
 * monthly push quota. So each case below asserts the leg that ran, not merely
 * that something was delivered.
 *
 *   reply succeeds  → ONE call, kind 'reply', via 'reply', NO push
 *   reply refused   → TWO calls, the second a push carrying the SAME message
 *   refused for any other reason → THROWS, and never pushes
 *
 * The third is the one that protects the caller contracts. Several sites stamp a
 * member as "already told" only after the send returns — `notice-guard.helper`
 * for the warned stamp, `stampIfHelperCardDelivered` for the register offer — so
 * a ladder that swallowed a failure and answered 200 would record a card the
 * customer never saw, and they would never be told again.
 * ⇒ ส่งผ่านทาง reply ต้องไม่ push ซ้ำ · ส่งไม่ถึงต้อง throw เสมอ
 *
 * These exercise the shared rung directly rather than through the webhook: the
 * six flex sites and the menu-postback seat all reach `replyThenPush` by handing
 * it a userId, so this is the behaviour every one of them inherits.
 *
 * revert: delete this file; the ladder itself is reverted by dropping the
 * trailing `userId` argument at each call site.
 */
import {
  flexReply,
  noticeFlexReply,
  replyThenPush,
} from '@/modules/webhook/hook-reply/reply-via-core';

import type { LineSendRequest, LineSendResult } from '@/infra/line';

const TOKEN = 'unit-test-not-a-real-channel-token';
const REPLY_TOKEN = 'unit-test-reply-token';
const USER = 'Ueeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const CARD = { type: 'bubble', body: { type: 'box', layout: 'vertical' } };

const ok = (): LineSendResult => ({
  ok: true,
  status: 200,
  attempts: 1,
  durationMs: 1,
  data: { sentMessages: [] },
});

/** LINE's answer to a spent or expired reply token — the ONE a push can fix. */
const tokenRefused = (): LineSendResult => ({
  ok: false,
  status: 400,
  attempts: 1,
  durationMs: 1,
  reason: 'HTTP 400 - Invalid reply token',
  data: { message: 'Invalid reply token' },
});

const capture = (
  results: LineSendResult[],
): {
  send: (r: LineSendRequest) => Promise<LineSendResult>;
  seen: LineSendRequest[];
} => {
  const seen: LineSendRequest[] = [];
  return {
    seen,
    send: (r) => {
      seen.push(r);
      return Promise.resolve(
        results[seen.length - 1] ?? results[results.length - 1]!,
      );
    },
  };
};

describe('⭐⭐⭐ the ordinary reply still does the work', () => {
  it('a reply that SUCCEEDS is the only call — no push is billed', async () => {
    const c = capture([ok()]);
    const res = await replyThenPush(c.send, TOKEN, REPLY_TOKEN, USER, [
      { type: 'text', text: 'สวัสดีค่ะ' },
    ] as never);

    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.kind).toBe('reply');
    expect(c.seen[0]!.replyToken).toBe(REPLY_TOKEN);
    expect(c.seen[0]!.to).toBeUndefined();
    expect(res.via).toBe('reply');
  });

  it('⭐⭐ a FLEX card on a good token also rides the reply, not a push', async () => {
    const c = capture([ok()]);
    const res = await flexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      CARD,
      'การ์ด',
      null,
      USER,
    );
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.kind).toBe('reply');
    expect(res.via).toBe('reply');
  });
});

describe('🔴 a refused reply token reaches the customer by push', () => {
  it('the card goes out on the second leg, addressed to the member', async () => {
    const c = capture([tokenRefused(), ok()]);
    const res = await flexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      CARD,
      'แจ้งเตือน',
      null,
      USER,
    );

    expect(c.seen).toHaveLength(2);
    expect(c.seen[0]!.kind).toBe('reply');
    expect(c.seen[1]!.kind).toBe('push');
    expect(c.seen[1]!.to).toBe(USER);
    expect(res.via).toBe('push');
  });

  it('⭐⭐⭐ the push carries the SAME card and altText — not a substitute', async () => {
    /* A ladder that re-built the message could quietly send something else on
       the second leg, and the customer would be none the wiser. */
    const c = capture([tokenRefused(), ok()]);
    await flexReply(c.send, TOKEN, REPLY_TOKEN, CARD, 'แจ้งเตือน', null, USER);

    const replyMsg = c.seen[0]!.messages[0]!;
    const pushMsg = c.seen[1]!.messages[0]!;
    expect(pushMsg).toEqual(replyMsg);
    expect(pushMsg['contents']).toEqual(CARD);
    expect(pushMsg['altText']).toBe('แจ้งเตือน');
  });

  it('⭐⭐ the notice card behaves identically — it was the last one without a ladder', async () => {
    const c = capture([tokenRefused(), ok()]);
    const res = await noticeFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      CARD,
      'แจ้งเตือนจากระบบ',
      USER,
    );
    expect(c.seen[1]!.kind).toBe('push');
    expect(c.seen[1]!.to).toBe(USER);
    expect(res.via).toBe('push');
  });
});

describe('🔴 the throw contract — what the stamping sites depend on', () => {
  it.each([401, 403, 429, 500, 0])(
    'a %s refusal THROWS and never pushes — the push carries the same token',
    async (status) => {
      const c = capture([
        {
          ok: false,
          status,
          attempts: 1,
          durationMs: 1,
          reason: `HTTP ${status}`,
        },
      ]);
      await expect(
        flexReply(c.send, TOKEN, REPLY_TOKEN, CARD, 'x', null, USER),
      ).rejects.toThrow();
      expect(c.seen).toHaveLength(1);
      expect(c.seen[0]!.kind).toBe('reply');
    },
  );

  it('⭐⭐⭐ BOTH legs failing throws — so nobody is stamped as told', async () => {
    const c = capture([
      tokenRefused(),
      {
        ok: false,
        status: 429,
        attempts: 1,
        durationMs: 1,
        reason: 'HTTP 429',
      },
    ]);
    await expect(
      flexReply(c.send, TOKEN, REPLY_TOKEN, CARD, 'x', null, USER),
    ).rejects.toThrow();
    expect(c.seen).toHaveLength(2);
    expect(c.seen[1]!.kind).toBe('push');
  });

  it('⭐⭐ no userId ⇒ no ladder and no push, exactly as before the change', async () => {
    /* The guard that keeps every caller which does NOT opt in byte-identical. */
    const c = capture([tokenRefused()]);
    await expect(
      flexReply(c.send, TOKEN, REPLY_TOKEN, CARD, 'x', null),
    ).rejects.toThrow();
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.kind).toBe('reply');
  });
});
