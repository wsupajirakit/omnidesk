import {
  deliverPaymentReply,
  type PaymentSendDeps,
  type PaymentSendPlan,
} from '@/modules/webhook';
import type { LineSendRequest, LineSendResult } from '@/infra/line';

/**
 * [FEAT-20260827-PUSHCORE-B] the payment reply→push ladder.
 * ===========================================================================
 * WHY THIS FILE HAD TO BE WRITTEN, and written NOW
 *
 * Candidate B moved this ladder off `LineApiService` and onto the push core.
 * Before committing that, the two rungs were mutated on purpose:
 *
 *     cut the fallback  (reply fails ⇒ never try push)   → 1373 passed
 *     swap the kind     (the reply rung sends 'push')    → 1373 passed
 *
 * The entire radius stayed green both times. The ladder — the money path's last
 * line between "the customer was told" and silence — had NO test at all. Its
 * previous safety came from `LineApiService` throwing, which the core does not
 * do, so the migration would have replaced an untested guarantee with an
 * untested nothing and every suite would have agreed.
 * เขียวไม่ใช่หลักฐาน · ของที่ mutation ฆ่าไม่ได้ = ไม่มีใครคุม
 *
 * WHAT IT PINS
 *  §1 which rung answers, and that the SAME body rides both
 *  §2 the rung edge is `!res.ok` — including 5xx, which is the OWNER'S CALL
 *     (27/08, "เหมือนเดิม") and differs on purpose from the chat console's ladder
 *  §3 the outcome the caller needs to pick which webhook_logs row to write —
 *     including the mislabelled-but-real case reproduced from the original
 *  §4 the core is never handed a shape it rejects
 *
 * NO NETWORK: `send` is a local double; nothing here can open a socket.
 */

const TOKEN = 'unit-test-not-a-real-channel-token';
const REPLY_TOKEN = 'unit-test-reply-token';
const USER = 'Uunit-test-user';

const ok = (status = 200, data: unknown = { x: 1 }): LineSendResult => ({
  ok: true,
  status,
  attempts: 1,
  durationMs: 1,
  data,
});

/** The core's failure shape — it RESOLVES this, it does not reject. */
const fail = (status: number, reason = 'boom'): LineSendResult => ({
  ok: false,
  status,
  attempts: 1,
  durationMs: 1,
  reason,
});

interface Harness {
  deps: PaymentSendDeps;
  sent: LineSendRequest[];
  warns: string[];
}

/** `results` are handed out in order, one per send() call. */
const harness = (results: LineSendResult[]): Harness => {
  const sent: LineSendRequest[] = [];
  const warns: string[] = [];
  let i = 0;
  return {
    sent,
    warns,
    deps: {
      send: (req) => {
        sent.push(req);
        const r = results[i++];
        if (!r)
          throw new Error(
            `ladder made ${i} calls, only ${results.length} armed`,
          );
        return Promise.resolve(r);
      },
      warn: (m) => warns.push(m),
    },
  };
};

const textPlan = (over: Partial<PaymentSendPlan> = {}): PaymentSendPlan => ({
  token: TOKEN,
  replyToken: REPLY_TOKEN,
  userId: USER,
  text: 'เติมเงินสำเร็จ',
  altText: 'alt',
  ...over,
});

const CARD = { type: 'bubble', body: { type: 'box' } };

describe('§1 which rung answers, and the body is the same on both', () => {
  it('reply succeeds ⇒ one call, via=reply, push never attempted', async () => {
    const h = harness([ok()]);
    const out = await deliverPaymentReply(textPlan(), h.deps);

    expect(out.via).toBe('reply');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.kind).toBe('reply');
    expect(h.sent[0]!.replyToken).toBe(REPLY_TOKEN);
    // the push rung must not have run — this is the mutation "cut the fallback"
    // in reverse, and the reason a delivered reply never costs a push quota unit.
    expect(h.sent.some((r) => r.kind === 'push')).toBe(false);
    expect(h.warns).toEqual([]);
  });

  it('reply fails ⇒ push runs with the SAME messages, via=push', async () => {
    /* ⚠️ THE PLAN MUST CARRY A CARD. Written first with a text-only plan, this
       case could not catch a push rung that rebuilt the body from `plan.text`:
       both rungs produced the same text message and the assertion passed while
       the guarantee was gone. Caught by mutation on 27/08 — a card is the only
       shape where "same body" and "rebuilt from text" differ.
       เทสที่เลือกข้อมูลผิด = เทสที่ผ่านทั้งที่ของพัง */
    const h = harness([fail(400), ok(200, { pushed: true })]);
    const out = await deliverPaymentReply(textPlan({ flex: CARD }), h.deps);

    expect(out.via).toBe('push');
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]!.kind).toBe('reply');
    expect(h.sent[1]!.kind).toBe('push');
    expect(h.sent[1]!.to).toBe(USER);
    /* "send the same kind, just change the pipe" — the whole reason a flex push
       exists at all (line-api.service.ts:252-273). If the two bodies could drift,
       a customer who fell to the push rung would get a different message. */
    expect(h.sent[1]!.messages).toEqual(h.sent[0]!.messages);
  });

  it('the result of the winning rung is handed back untouched', async () => {
    const res = ok(200, { sentMessages: [{ id: '1' }] });
    const h = harness([res]);
    const out = await deliverPaymentReply(textPlan(), h.deps);
    // the caller writes `http_status` and `response_summary` off this object
    expect(out.via === 'reply' && out.res).toBe(res);
  });
});

describe('§2 the rung edge is `!res.ok` — 5xx included, by owner decision', () => {
  it.each([400, 401, 403, 429])(
    'a %s reply falls through to push',
    async (status) => {
      const h = harness([fail(status), ok()]);
      const out = await deliverPaymentReply(textPlan(), h.deps);
      expect(out.via).toBe('push');
    },
  );

  it.each([500, 502, 503, 0])(
    '⭐ a %s reply ALSO falls through to push (the old catch made no distinction)',
    async (status) => {
      /* The admin console's ladder STOPS on 5xx (outbound-send-strategy.ts:107-109)
         because delivery is unknown and a reply carries no retry key. This path
         deliberately does NOT: the code it replaces caught every rejection alike,
         so a 5xx always fell through to push. Owner asked and answered 27/08 —
         "เหมือนเดิม". Aligning the two would add `payment_reply_undelivered` rows
         for cases that today end in a delivered push, which is a DB-visible change
         and needs its own decision. ห้ามเปลี่ยนโดยไม่ถาม */
      const h = harness([fail(status), ok()]);
      const out = await deliverPaymentReply(textPlan(), h.deps);
      expect(out.via).toBe('push');
      expect(h.sent[1]!.kind).toBe('push');
    },
  );

  it('the reply-leg failure is warned once, in the wording operators grep', async () => {
    const h = harness([fail(401, 'token expired'), ok()]);
    await deliverPaymentReply(textPlan(), h.deps);
    expect(h.warns).toHaveLength(1);
    expect(h.warns[0]).toContain(
      '[PAYREPLY] reply failed, falling back to push',
    );
    expect(h.warns[0]).toContain('token expired');
  });
});

describe('§3 the outcome tells the caller which row to write', () => {
  it('both legs fail ⇒ none + pushAttempted, carrying the push failure detail', async () => {
    const h = harness([fail(401), fail(429, 'monthly limit reached')]);
    const out = await deliverPaymentReply(textPlan(), h.deps);

    expect(out.via).toBe('none');
    expect(out.via === 'none' && out.pushAttempted).toBe(true);
    // this string becomes `error_message` + `review_detail` on the one audit row
    // that says the money moved and nobody told the customer.
    expect(out.via === 'none' && out.detail).toContain('monthly limit reached');
  });

  it('no replyToken and no userId ⇒ nothing sent, none + pushAttempted=false', async () => {
    const h = harness([]);
    const out = await deliverPaymentReply(
      textPlan({ replyToken: undefined, userId: undefined }),
      h.deps,
    );
    expect(h.sent).toHaveLength(0);
    expect(out).toEqual({ via: 'none', pushAttempted: false });
  });

  it('no replyToken but a userId ⇒ the push rung runs alone', async () => {
    const h = harness([ok()]);
    const out = await deliverPaymentReply(
      textPlan({ replyToken: undefined }),
      h.deps,
    );
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.kind).toBe('push');
    expect(out.via).toBe('push');
  });

  it('⭐ replyToken fails and there is NO userId ⇒ pushAttempted=false (the original quirk)', async () => {
    /* The old code fell out of both `if` blocks here and wrote the row that says
       "no reply token and no userId" — a sentence that is wrong for this case, but
       it is what is in `webhook_logs` today. Reproduced rather than corrected:
       fixing the wording would change rows an operator may already be filtering on,
       and that is a separate decision. เก็บพฤติกรรมเดิมไว้ก่อน แม้ข้อความจะเพี้ยน */
    const h = harness([fail(401)]);
    const out = await deliverPaymentReply(
      textPlan({ userId: undefined }),
      h.deps,
    );
    expect(h.sent).toHaveLength(1);
    expect(out).toEqual({ via: 'none', pushAttempted: false });
  });
});

describe('§4 the request the core receives', () => {
  it('a bound card rides as ONE flex message with the caller-supplied altText', async () => {
    const h = harness([ok()]);
    await deliverPaymentReply(
      textPlan({ flex: CARD, altText: 'รายละเอียดการโอนเงิน' }),
      h.deps,
    );
    expect(h.sent[0]!.messages).toEqual([
      { type: 'flex', altText: 'รายละเอียดการโอนเงิน', contents: CARD },
    ]);
  });

  it('no card ⇒ ONE text message carrying reply.text', async () => {
    const h = harness([ok()]);
    await deliverPaymentReply(textPlan({ flex: null }), h.deps);
    expect(h.sent[0]!.messages).toEqual([
      { type: 'text', text: 'เติมเงินสำเร็จ' },
    ]);
  });

  it('every request carries the token and exactly one message (LINE allows 1-5)', async () => {
    const h = harness([fail(400), ok()]);
    await deliverPaymentReply(textPlan({ flex: CARD }), h.deps);
    for (const req of h.sent) {
      expect(req.token).toBe(TOKEN);
      expect(req.messages).toHaveLength(1);
    }
  });

  it('the ladder asks for no retry — a reply token is single-use', async () => {
    /* `LinePushService` THROWS if `retry` is set on a reply (line-push.ts:251-255),
       so a retry option leaking in here would be a crash on the money path, not a
       degraded send. Pinned so nobody adds one "for reliability". */
    const h = harness([fail(500), ok()]);
    await deliverPaymentReply(textPlan(), h.deps);
    for (const req of h.sent) expect(req.retry).toBeUndefined();
  });
});
