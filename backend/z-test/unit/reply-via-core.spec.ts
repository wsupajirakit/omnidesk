import {
  flexReply,
  noticeFlexReply,
  replyViaCore,
  slipFlexReply,
  textReply,
} from '@/modules/webhook';
import type { LineSendRequest, LineSendResult } from '@/infra/line';

/**
 * [FEAT-20260828-PUSHCORE-G] the reply-through-the-core rule.
 * ===========================================================================
 * WHY THIS FILE EXISTS — it was written because two mutations SURVIVED.
 *
 * With the rule sitting as a private method on `WebhookService`, these were run
 * against the whole 62-file candidate-G radius:
 *
 *     remove the `if (!res.ok) throw`      → 1432 passed
 *     send `kind:'push'` on the reply leg  → 1432 passed
 *
 * Neither is subtle: the first makes every REFUSED reply write a webhook_logs
 * row saying `status:'success'`, the second sends customer replies to the wrong
 * LINE endpoint. Both went unnoticed because every harness that drives this path
 * hands in a replacement collaborator, so none of them can see what the real one
 * would have done. The rule moved into its own file for exactly this reason.
 * เทสที่แทน collaborator ทั้งดุ้น มองไม่เห็นการสลับ collaborator
 *
 * NO NETWORK: `send` is a local double.
 */

const TOKEN = 'unit-test-not-a-real-channel-token';
const REPLY_TOKEN = 'unit-test-reply-token';
const MSG = [{ type: 'text', text: 'สวัสดีค่ะ' }];

const capture = (
  result: LineSendResult,
): {
  send: (r: LineSendRequest) => Promise<LineSendResult>;
  seen: LineSendRequest[];
} => {
  const seen: LineSendRequest[] = [];
  return {
    seen,
    send: (r) => {
      seen.push(r);
      return Promise.resolve(result);
    },
  };
};

const ok = (data: unknown = { sentMessages: [] }): LineSendResult => ({
  ok: true,
  status: 200,
  attempts: 1,
  durationMs: 1,
  data,
});

describe('the request that reaches the core', () => {
  it('⭐ rides the REPLY endpoint — never push', async () => {
    /* Kills the mutation `kind:'reply'` -> `'push'`. It matters beyond tidiness:
       a push is billed against the monthly quota and needs a userId, while a
       reply is free and keyed on the token — swapping them silently changes both
       the cost and the recipient rule of every bot answer. */
    const c = capture(ok());
    await replyViaCore(c.send, TOKEN, REPLY_TOKEN, MSG);

    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.kind).toBe('reply');
    expect(c.seen[0]!.replyToken).toBe(REPLY_TOKEN);
    expect(c.seen[0]!.token).toBe(TOKEN);
    expect(c.seen[0]!.to).toBeUndefined();
  });

  it('passes the messages through untouched', async () => {
    const c = capture(ok());
    const messages = [
      {
        type: 'flex',
        altText: 'ลงทะเบียนสมาชิก',
        contents: { type: 'bubble' },
      },
    ];
    await replyViaCore(c.send, TOKEN, REPLY_TOKEN, messages);
    expect(c.seen[0]!.messages).toEqual(messages);
  });

  it('asks for no retry — a reply token is single-use', async () => {
    /* `LinePushService` THROWS if `retry` is set on a reply
       (line-push.ts:251-255), so a retry option here would crash the reply path
       rather than degrade it. Pinned so nobody adds one "for reliability". */
    const c = capture(ok());
    await replyViaCore(c.send, TOKEN, REPLY_TOKEN, MSG);
    expect(c.seen[0]!.retry).toBeUndefined();
  });
});

describe('what comes back', () => {
  it('is the legacy `{status, data}` shape callers log', async () => {
    const c = capture(ok({ sentMessages: [{ id: '1' }] }));
    const res = await replyViaCore(c.send, TOKEN, REPLY_TOKEN, MSG);
    // customer-register.handler.ts:238,240 read exactly these two.
    expect(res).toEqual({ status: 200, data: { sentMessages: [{ id: '1' }] } });
  });
});

describe('⭐ a refused reply must THROW — the whole point of the helper', () => {
  it('rethrows the RAW error the legacy sender threw, untouched', async () => {
    /* Kills the mutation that removes the throw. Callers write their
       `status:'success'` webhook_logs row on the line AFTER the send and never
       inspect a return value (customer-register.handler.ts:231-243), so without
       the throw a refused reply is recorded as delivered. And the error must stay
       the axios one: downstream code reads `.message` and `.response?.data` off
       it. แถว success ต้องเกิดเฉพาะตอนส่งผ่านจริง */
    const raw = Object.assign(
      new Error('Request failed with status code 400'),
      {
        response: { status: 400, data: { message: 'Invalid reply token' } },
      },
    );
    const c = capture({
      ok: false,
      status: 400,
      attempts: 1,
      durationMs: 1,
      reason: 'HTTP 400',
      raw,
    });

    await expect(replyViaCore(c.send, TOKEN, REPLY_TOKEN, MSG)).rejects.toBe(
      raw,
    );
  });

  it.each([400, 401, 403, 429, 500, 0])(
    'throws on status %s — every refusal, not just some',
    async (status) => {
      const c = capture({
        ok: false,
        status,
        attempts: 1,
        durationMs: 1,
        reason: `HTTP ${status}`,
      });
      await expect(
        replyViaCore(c.send, TOKEN, REPLY_TOKEN, MSG),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );

  it('falls back to `reason` when there is no axios error to rethrow', async () => {
    /* The one failure that never reaches the network: an empty channel token,
       which the core answers `{ok:false, status:0}` with no `raw`
       (line-push.ts:128-138). Without the fallback this would throw `undefined`
       and the caller's `err.message` read would blow up on the reply path. */
    const c = capture({
      ok: false,
      status: 0,
      attempts: 0,
      durationMs: 0,
      reason: 'missing channel access token — no call made',
    });
    await expect(replyViaCore(c.send, TOKEN, REPLY_TOKEN, MSG)).rejects.toThrow(
      'missing channel access token',
    );
  });

  it('a 2xx never throws', async () => {
    const c = capture(ok());
    await expect(
      replyViaCore(c.send, TOKEN, REPLY_TOKEN, MSG),
    ).resolves.toEqual({ status: 200, data: { sentMessages: [] } });
  });
});

/* ==== [FEAT-20260828-PUSHCORE-A1] the two flex adapters ======================
 * Written because three mutations survived the whole 69-file / 1448-case
 * candidate-A radius while these were inline lambdas in webhook.service:
 * dropping the slip card's quickReply, dropping notice's altText cap, and
 * sending notice with an empty replyToken. Every spec on those paths injects
 * its own `deps`, so none of them could see the wiring.
 */
describe('slipFlexReply — the slip card', () => {
  it('⭐ carries the quickReply through — the "send it again" button', async () => {
    /* Kills the mutation that drops `qr`. On a violation this button is the only
       route back for a customer whose slip was refused; without it the card is a
       dead end and the next thing that happens is a support ticket. */
    const c = capture(ok());
    const qr = { items: [{ type: 'action', action: { type: 'camera' } }] };
    await slipFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      { type: 'bubble' },
      'ก',
      qr,
    );

    const m = c.seen[0]!.messages[0]!;
    expect(m['quickReply']).toEqual(qr);
    expect(m['type']).toBe('flex');
    expect(m['altText']).toBe('ก');
  });

  it('a null quickReply leaves the key OFF the message entirely', async () => {
    // LINE rejects `quickReply: null`; the builder omits the key instead.
    const c = capture(ok());
    await slipFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      { type: 'bubble' },
      'ก',
      null,
    );
    expect('quickReply' in (c.seen[0]!.messages[0] as object)).toBe(false);
  });

  it('rides the reply endpoint with the token it was given', async () => {
    const c = capture(ok());
    await slipFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      { type: 'bubble' },
      'ก',
      null,
    );
    expect(c.seen[0]!.kind).toBe('reply');
    expect(c.seen[0]!.token).toBe(TOKEN);
    expect(c.seen[0]!.replyToken).toBe(REPLY_TOKEN);
  });
});

describe('noticeFlexReply — the off-service warning card', () => {
  it('⭐ caps altText at 400 — LINE REFUSES a longer one', async () => {
    /* Kills the mutation that drops `.slice(0, 400)`. The text is OA-authored,
       so an over-long one is a configuration away. And because the send throws
       on refusal, the refusal also means the member is never stamped as warned
       (notice-guard.helper.ts:229-240) — so the same card would be recomputed
       and refused on every following message. */
    const c = capture(ok());
    await noticeFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      { type: 'bubble' },
      'ก'.repeat(600),
    );

    const alt = String(c.seen[0]!.messages[0]!['altText']);
    expect(alt).toHaveLength(400);
    expect(alt).toBe('ก'.repeat(400));
  });

  it('a short altText is passed through untouched', async () => {
    const c = capture(ok());
    await noticeFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      { type: 'bubble' },
      'แจ้งเตือน',
    );
    expect(c.seen[0]!.messages[0]!['altText']).toBe('แจ้งเตือน');
  });

  it('⭐ sends with the replyToken it was given, not a blank', async () => {
    /* Kills the mutation that passes ''. An empty reply token is not a silent
       no-op: the core would still call LINE, LINE would 400, the helper would
       throw, and the notice would look "attempted but broken" forever. */
    const c = capture(ok());
    await noticeFlexReply(c.send, TOKEN, REPLY_TOKEN, { type: 'bubble' }, 'x');
    expect(c.seen[0]!.replyToken).toBe(REPLY_TOKEN);
    expect(c.seen[0]!.token).toBe(TOKEN);
  });

  it('the card contents reach the wire untouched', async () => {
    const c = capture(ok());
    const card = { type: 'bubble', body: { type: 'box', layout: 'vertical' } };
    await noticeFlexReply(c.send, TOKEN, REPLY_TOKEN, card, 'x');
    expect(c.seen[0]!.messages[0]!['contents']).toEqual(card);
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * [FIX-20260902-NOTICEPUSH] the reply→push ladder on the notice card
   * ═══════════════════════════════════════════════════════════════════════
   * WHY IT WAS ADDED. This was the only flex sender with no ladder. Found by
   * driving a REAL signed webhook instead of pushing a card directly: the same
   * refused reply token lost the CARD while the request's TEXT fell back to push
   * and arrived. The notice probe pushes directly and so can never see it.
   *
   *     [NOTICERUNTIME] guard failed: Request failed with status code 400
   *     … same request: "reply token refused — falling back to push" → DELIVERED
   *
   * 🔴 THE LOAD-BEARING HALF IS THE THROWING, NOT THE PUSHING.
   *    `notice-guard.helper.ts:250-296` sets `sent`, writes the bot row, stamps
   *    the member as "already warned" and charges the quota only on the lines
   *    AFTER this send returns. If a ladder ever swallowed a failure and answered
   *    200, a member would be recorded as warned for a card they never saw and
   *    would never be warned again. The last three cases below are that contract.
   *    ⇒ การ์ดไม่ถึงต้อง throw เสมอ ไม่งั้น stamp ว่าเตือนแล้วทั้งที่ลูกค้าไม่ได้อะไร
   */
  const USER = 'Uffffffffffffffffffffffffffffffff';

  /** Two different answers, one per leg — the ladder needs reply≠push results. */
  const captureSeq = (
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
        return Promise.resolve(results[seen.length - 1] ?? results.at(-1)!);
      },
    };
  };

  const tokenRefused = (): LineSendResult => ({
    ok: false,
    status: 400,
    attempts: 1,
    durationMs: 1,
    reason: 'HTTP 400 - Invalid reply token',
    data: { message: 'Invalid reply token' },
  });

  it('⭐⭐⭐ no userId ⇒ byte-identical to before — one reply, never a push', async () => {
    /* The guard that keeps every other caller safe. Omitting the argument must
       not start billing a push or change the throw. */
    const c = capture(tokenRefused());
    await expect(
      noticeFlexReply(c.send, TOKEN, REPLY_TOKEN, { type: 'bubble' }, 'x'),
    ).rejects.toThrow();
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.kind).toBe('reply');
  });

  it('🔴 a refused reply TOKEN now reaches the customer by push', async () => {
    const card = { type: 'bubble', body: { type: 'box', layout: 'vertical' } };
    const c = captureSeq([tokenRefused(), ok()]);
    const res = await noticeFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      card,
      'แจ้งเตือน',
      USER,
    );

    expect(c.seen).toHaveLength(2);
    expect(c.seen[0]!.kind).toBe('reply');
    expect(c.seen[1]!.kind).toBe('push');
    expect(c.seen[1]!.to).toBe(USER);
    /* the SAME card and altText travel on the push leg — a customer must not get
       a different message just because the first leg was refused. */
    expect(c.seen[1]!.messages[0]!['contents']).toEqual(card);
    expect(c.seen[1]!.messages[0]!['altText']).toBe('แจ้งเตือน');
    expect(res.via).toBe('push');
  });

  it('⭐⭐ a reply that SUCCEEDS never pushes — push is billed, reply is not', async () => {
    const c = captureSeq([ok()]);
    const res = await noticeFlexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      { type: 'bubble' },
      'x',
      USER,
    );
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.kind).toBe('reply');
    expect(res.via).toBe('reply');
  });

  it.each([401, 429, 500])(
    '⭐⭐⭐ a %s refusal THROWS and does NOT push — a push carries the same token',
    async (status) => {
      /* The narrow gate. Only "invalid reply token" is rescuable; everything else
         would fail again and cost a wasted outbound call. And the throw is what
         keeps the member unstamped. */
      const c = captureSeq([
        {
          ok: false,
          status,
          attempts: 1,
          durationMs: 1,
          reason: `HTTP ${status}`,
        },
      ]);
      await expect(
        noticeFlexReply(
          c.send,
          TOKEN,
          REPLY_TOKEN,
          { type: 'bubble' },
          'x',
          USER,
        ),
      ).rejects.toThrow();
      expect(c.seen).toHaveLength(1);
      expect(c.seen[0]!.kind).toBe('reply');
    },
  );

  it('🔴 BOTH legs failing still THROWS — the stamp must not be written', async () => {
    /* The case the whole ladder had to be checked against: the customer got
       nothing, so `notice-guard.helper.ts` must not reach its stamp line. */
    const c = captureSeq([
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
      noticeFlexReply(
        c.send,
        TOKEN,
        REPLY_TOKEN,
        { type: 'bubble' },
        'x',
        USER,
      ),
    ).rejects.toThrow();
    expect(c.seen).toHaveLength(2);
    expect(c.seen[1]!.kind).toBe('push');
  });
});

/* ==== [FEAT-20260828-PUSHCORE-A2] the pair the 14 direct sites use ===========
 * Written because three more mutations survived the whole 69-file / 1455-case
 * radius while these were private methods: dropping `quickReply` from either
 * sender, and changing the legacy altText default.
 */
describe('flexReply — mirrors sendLineFlexReply argument for argument', () => {
  it('⭐ carries the quickReply — the button rides ON the card', async () => {
    const c = capture(ok());
    const qr = { items: [{ type: 'action', action: { type: 'message' } }] };
    await flexReply(
      c.send,
      TOKEN,
      REPLY_TOKEN,
      { type: 'bubble' },
      'ข้อมูลของคุณ',
      qr,
    );
    expect(c.seen[0]!.messages[0]!['quickReply']).toEqual(qr);
  });

  it('⭐ keeps the legacy English altText default', async () => {
    /* Kills the mutation that changes it. Unreachable in practice — every call
       site passes Thai — but line-api.service.ts:161-164 argues it is preserved
       precisely because "unreachable today" is not "unreachable", and altText is
       what a notification-only client reads. */
    const c = capture(ok());
    await flexReply(c.send, TOKEN, REPLY_TOKEN, { type: 'bubble' });
    expect(c.seen[0]!.messages[0]!['altText']).toBe('Bank Transfer Details');
  });

  it('omits quickReply entirely when none is given', async () => {
    const c = capture(ok());
    await flexReply(c.send, TOKEN, REPLY_TOKEN, { type: 'bubble' }, 'ก');
    expect('quickReply' in (c.seen[0]!.messages[0] as object)).toBe(false);
  });
});

describe('textReply — mirrors sendLineReplyMessage argument for argument', () => {
  it('⭐ carries the quickReply — this is the "เชื่อมข้อมูล" button on the AI answer', async () => {
    /* Kills the mutation that drops it. On the AI reply path webhook.service
       passes `helperQuickReply` here; losing it removes the customer's only way
       to link their account from that message, and nothing else would notice. */
    const c = capture(ok());
    const qr = {
      items: [{ type: 'action', action: { type: 'uri', uri: 'https://x' } }],
    };
    await textReply(c.send, TOKEN, REPLY_TOKEN, 'ยอดของคุณคือ 100 บาท', qr);

    const m = c.seen[0]!.messages[0]!;
    expect(m['type']).toBe('text');
    expect(m['text']).toBe('ยอดของคุณคือ 100 บาท');
    expect(m['quickReply']).toEqual(qr);
  });

  it('omits quickReply entirely when none is given — LINE rejects a null one', async () => {
    const c = capture(ok());
    await textReply(c.send, TOKEN, REPLY_TOKEN, 'สวัสดี');
    expect(c.seen[0]!.messages[0]).toEqual({ type: 'text', text: 'สวัสดี' });
  });

  it('rides the reply endpoint with the token it was given', async () => {
    const c = capture(ok());
    await textReply(c.send, TOKEN, REPLY_TOKEN, 'x');
    expect(c.seen[0]!.kind).toBe('reply');
    expect(c.seen[0]!.replyToken).toBe(REPLY_TOKEN);
  });
});
