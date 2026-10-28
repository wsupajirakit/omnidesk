import { Logger } from '@nestjs/common';

import { buildReplyFlexMessage, buildReplyTextMessage } from '@/infra/line';
import type {
  LineMessage,
  LineSendRequest,
  LineSendResult,
} from '@/infra/line';

/**
 * ==== [FEAT-20260828-PUSHCORE-G] reply through the core, with the old throw ====
 *
 * WHAT: put `messages` on LINE's reply endpoint and hand back the shape the
 * legacy senders handed back — `{status, data}` read off the axios response —
 * so every caller that logs `http_status` / `response_summary` needs no change.
 *
 * WHY IT THROWS, which is the entire reason this exists:
 * `LineApiService.sendLineReplyMessage` / `sendLineFlexReply` let the axios
 * rejection escape on purpose (line-api.service.ts:98-102), and callers lean on
 * it. The register keyword handler is the plainest case — it writes its
 * webhook_logs row with `status:'success'` on the line AFTER the send
 * (customer-register.handler.ts:231-243, :294-312) and never inspects a return
 * value. REACHING that line is the proof of delivery. The push core never
 * throws; it resolves `{ok:false}` (line-push.ts:39-40). Drop it in unchanged
 * and every refused reply gets a row claiming success, with no test anywhere
 * noticing. ส่งไม่ผ่านต้องไม่ได้แถว success.
 *
 * WHY IT IS A FILE AND NOT A METHOD ON THE SERVICE: it started as one. Then the
 * mutations ran — remove the throw, and swap the reply endpoint for push — and
 * BOTH survived a 62-file / 1432-case radius, because every harness that drives
 * this path replaces the collaborator wholesale and so cannot see either change.
 * A rule that cannot be tested is a rule that will be edited by accident. Here
 * it takes `send` as an argument and `reply-via-core.spec.ts` drives it directly.
 * ของที่ mutation ฆ่าไม่ได้ = ไม่มีใครคุม — ต้องแยกออกมาให้เทสถึง
 *
 * WHY NOT `LinePushService.sendOrThrow`, which does exactly this: callers must
 * bind to `LinePushDispatcher` (the wrapper) and never to the service — that
 * leak is pinned at zero by docs/core-push.md and the wrapper is the seam a real
 * queue slots into. So the rule lives caller-side, as the core's own guide says
 * it must (line-push.ts:70-72 — "ladders … belong to callers").
 *
 * revert: delete this file; each call site goes back to
 *         `this.lineApi.sendLineReplyMessage(...)` / `sendLineFlexReply(...)`.
 */

/**
 * What the legacy reply helpers returned, narrowed to what callers ACTUALLY read
 * — checked, not assumed: `slip-flex.handler.ts:739,746,899,905` and
 * `notice-guard.helper.ts:280-281` read `.status` and `.data`, and nothing in
 * either file touches another axios field.
 *
 * `status` is REQUIRED, not optional: this shape is only ever returned on the
 * success path, where the core always carries a numeric HTTP status. Typing it
 * optional would push a needless `?? 0` into every caller that logs it.
 */
export interface ReplySendResponse {
  status: number;
  data?: unknown;
  /**
   * [FEAT-20260830-REPLYPUSH] which leg delivered it. Only `replyThenPush` sets
   * it; `replyViaCore` never does, so the fourteen existing call sites see the
   * exact object they see today.
   */
  via?: 'reply' | 'push';
}

export type CoreSend = (req: LineSendRequest) => Promise<LineSendResult>;

/* [FEAT-20260830-REPLYPUSH] module-level, like the transport's: these functions
   are plain exports, not injectables, so there is no instance to hang one on. */
const logger = new Logger('ReplyViaCore');

export async function replyViaCore(
  send: CoreSend,
  accessToken: string,
  replyToken: string,
  messages: LineMessage[],
): Promise<ReplySendResponse> {
  const res = await send({
    kind: 'reply',
    token: accessToken,
    replyToken,
    messages,
  });
  if (!res.ok) {
    /* The RAW axios error the legacy sender threw, so every downstream
       `err.message` / `err.response?.data` read behaves exactly as before.
       `reason` is the fallback for the one case that never reached the network
       at all — an empty token (line-push.ts:128-138) — where there is no axios
       error to rethrow. */
    if (res.raw instanceof Error) throw res.raw;
    throw new Error(res.reason ?? 'LINE reply failed');
  }
  return { status: res.status, data: res.data };
}

/* ==== [FEAT-20260830-REPLYPUSH] reply first, push only if the reply fails ====
 *
 * WHY
 *   `replyViaCore` above throws the moment LINE refuses the reply token, and on
 *   the AI path that throw is the end of the line: `replyViaPush` is a dead
 *   constant (`webhook.service.ts:4509`, "Every branch that tests it is dead
 *   code"), so the customer simply gets nothing. The local rows show LINE
 *   answering `400 {"message":"Invalid reply token"}` on that path.
 *
 *   The product already solves this for payments — `payment-send.ladder.ts:100`
 *   does reply → push with the SAME messages. This is that ladder, for the AI
 *   reply seam, written here because this file already owns the reply rule.
 *
 * WHAT IT DOES NOT CHANGE
 *   `replyViaCore` is untouched, and the ladder is only reached when a caller
 *   passes a `userId`. Without one the behaviour — including the throw — is
 *   byte-identical to today, which is what keeps the other call sites safe.
 *
 * ⚠️ push is billed differently from reply on a LINE OA plan, so it is used
 * ONLY after a real refusal, and only for the one refusal it can fix — see
 * `isReplyTokenRefused`.
 *
 * ⚠️ NO LOOP, BY CONSTRUCTION: at most one reply and one push per turn. A
 * failed push falls straight through to the throw below; nothing re-enters,
 * and no `retry` option is handed to the sender (its default is one attempt).
 * A spent quota therefore costs one refused call, never a busy loop.
 *
 * revert: delete this function, drop the `userId` parameter from `textReply` /
 * `flexReply`, and drop `via` from `ReplySendResponse`.
 * ======================================================================== */
/**
 * [FEAT-20260830-REPLYPUSH] Is this failure the ONE a push can actually fix?
 *
 * WHY THIS IS NARROW — owner's decision, 30/08/2026
 *   A push reuses the SAME channel access token as the reply. So the only
 *   failure a push can rescue is one that is about the REPLY TOKEN and nothing
 *   else: the token was already spent, or it expired. LINE reports that as
 *   `400 {"message":"Invalid reply token"}` — 109 such rows in webhook_logs.
 *
 *   Every other refusal would fail again on the push leg and cost a wasted
 *   outbound call:
 *     401 — the channel token itself is wrong; the push carries the same token
 *     429 — rate limited; pushing immediately makes it worse
 *     400 "A message … is invalid" — the payload is malformed either way
 *     5xx / status 0 — LINE is unwell; retrying the send is not this seam's job
 *
 *   The payment ladder (`payment-send.ladder.ts:100-133`) pushes on ANY reply
 *   failure. That is deliberate there — a slip result is money and worth a
 *   wasted call — and deliberately NOT copied here.
 *
 * TO CHANGE YOUR MIND (widen it back to "push on any reply failure"):
 *   delete this function and replace the single call to it in `replyThenPush`
 *   below with `true`. Nothing else has to move, and the tests that pin the
 *   narrow behaviour will name themselves when they go red.
 *
 * The match is on the message text rather than the status alone, because 400
 * is also what a malformed payload returns. `reason` is the normalized string
 * built by `describeLineFailure` (`HTTP 400 - Invalid reply token`), `data` is
 * LINE's own body, and `raw` is the untouched axios error — all three are
 * checked so the rule holds whichever shape a caller's sender produces.
 */
function isReplyTokenRefused(res: LineSendResult): boolean {
  if (res.status !== 400) return false;
  const body = res.data as { message?: unknown } | null | undefined;
  const rawBody = (
    res.raw as
      { response?: { data?: { message?: unknown } } } | null | undefined
  )?.response?.data;
  const haystack = [
    res.reason,
    typeof body?.message === 'string' ? body.message : '',
    typeof rawBody?.message === 'string' ? rawBody.message : '',
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
  return haystack.includes('invalid reply token');
}

export async function replyThenPush(
  send: CoreSend,
  accessToken: string,
  replyToken: string,
  userId: string | null | undefined,
  messages: LineMessage[],
): Promise<ReplySendResponse> {
  const replyRes = await send({
    kind: 'reply',
    token: accessToken,
    replyToken,
    messages,
  });
  if (replyRes.ok) {
    return { status: replyRes.status, data: replyRes.data, via: 'reply' };
  }

  /* Nobody to push to, or a refusal a push cannot fix ⇒ the old contract,
     unchanged: throw exactly what legacy threw. See isReplyTokenRefused above
     for why the gate is this narrow and how to widen it. */
  if (!userId || !isReplyTokenRefused(replyRes)) {
    if (replyRes.raw instanceof Error) throw replyRes.raw;
    throw new Error(replyRes.reason ?? 'LINE reply failed');
  }

  /* One line so the push leg is visible. Found the hard way on the live run of
     30/08: the reply was refused, the ladder pushed, and NOTHING in the logs
     said so — the error row carries the reply's error either way (see the
     throw below), so a silent push is indistinguishable from no push at all.
     Operators grep this tag. */
  logger.warn(
    `[FEAT-20260830-REPLYPUSH] reply token refused (${replyRes.reason ?? 'no reason'}) — falling back to push`,
  );
  const pushRes = await send({
    kind: 'push',
    token: accessToken,
    to: userId,
    messages,
  });
  logger.warn(
    `[FEAT-20260830-REPLYPUSH] push leg ${pushRes.ok ? 'DELIVERED' : `failed (${pushRes.reason ?? pushRes.status})`}`,
  );
  if (pushRes.ok) {
    return { status: pushRes.status, data: pushRes.data, via: 'push' };
  }

  /* Both legs failed. Throw the REPLY's error, not the push's: every existing
     downstream reader (`err.message`, `err.response?.data`) was written against
     the reply failure, and the push is the addition. */
  if (replyRes.raw instanceof Error) throw replyRes.raw;
  throw new Error(replyRes.reason ?? 'LINE reply failed');
}

/* ==== [FEAT-20260828-PUSHCORE-A1] the two flex-reply adapters ================
 *
 * These are the shapes `webhook.service` used to build inline as `deps` lambdas
 * for `slip-flex.handler` and `notice-runtime`. They are four lines each, and
 * they are HERE rather than there for one measured reason: as lambdas, three
 * mutations survived the entire 69-file / 1448-case candidate-A radius —
 *
 *     drop the slip card's quickReply   (the "send the photo again" button)
 *     drop notice's altText 400-cap
 *     send notice with an empty replyToken
 *
 * — because every spec on those paths injects its own `deps`, so none of them
 * can see what the real wiring passes. Named functions can be driven directly.
 * ต่อสายผิดแล้วไม่มีใครรู้ = ต้องยกออกมาให้เทสถึง
 */

/** slip-flex's card. `quickReply` is the "ส่งรูปใหม่" button on a violation —
 *  dropping it strands a customer whose slip was rejected with no way back. */
export function slipFlexReply(
  send: CoreSend,
  accessToken: string,
  replyToken: string,
  flexContents: unknown,
  altText: string,
  quickReply: unknown,
  /**
   * [FEAT-20260906-SLIPPUSH] LAST parameter, optional — omit and this behaves
   * exactly as it did before, which is what keeps every existing caller and test
   * unchanged.
   *
   * ⚠️⚠️ WHY IT WAS ADDED, and it is a customer-visible hole rather than a tidy-up.
   * A slip card is answered on the REPLY token. That token dies 60 seconds after the
   * message arrives, and the slip lane spends a paid Swiftcheck verification plus a
   * Gemini QR read before it gets here — on a slow turn the token is already refused
   * when the card is finally ready. The card was then LOST: nothing retried it, and
   * the customer who just transferred money saw no answer at all.
   *
   * The ladder for exactly this already existed (`replyThenPush`) and the AI reply and
   * the payment lane both use it. The slip lane did not, only because this function
   * had no way to name the recipient — `flexReply` falls back to push ONLY when it is
   * given a `userId`. So the fix is to pass one, not to write a second ladder.
   * `[PUSHCORE-A2]`'s whole point is one copy of the rule.
   * โควตาก็จ่ายแล้ว ลูกค้าก็โอนแล้ว แต่การ์ดหาย เพราะไม่มีใครบอกว่าจะ push ไปหาใคร
   *
   * ⚠️ IT STILL THROWS WHEN BOTH LEGS FAIL. `replyThenPush` throws the REPLY's error
   * after a failed push, which the slip handler depends on: its caller logs "Failed in
   * result processing logic" and continues, and without the throw a refused card would
   * fall through as if it had been delivered. A ladder that swallowed the failure and
   * returned a fake 200 would be worse than the bug it fixes.
   */
  userId?: string | null,
): Promise<ReplySendResponse> {
  // [FEAT-20260828-PUSHCORE-A2] delegates — one copy of the rule, not two.
  return flexReply(
    send,
    accessToken,
    replyToken,
    flexContents,
    altText,
    quickReply,
    userId,
  );
}

/** notice-runtime's card. The 400-cap is not cosmetic: LINE REJECTS an altText
 *  longer than 400, and the notice text is OA-authored, so an over-long one
 *  would turn a delivered warning into a refusal — which, because the send
 *  throws, also means the member never gets stamped as warned and the card
 *  retries forever. `notice-guard.helper.ts:229-240` is where that matters.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ✅ [FIX-20260902-NOTICEPUSH] THE LADDER IS WIRED HERE NOW. It was reply-only,
 *    and a refused reply token lost the card while the same request's text
 *    survived — found by driving a real signed webhook rather than pushing a
 *    card directly. The rest of the family below is still reply-only.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ WHY THIS IS SAFE FOR THE STAMPING CONTRACT — the thing that had to be
 *    checked before touching it. `notice-guard.helper.ts:250-296` depends on
 *    this send THROWING whenever the card did not arrive: `sent` is set only
 *    after the await, and the bot row, the "already warned" stamp and the quota
 *    charge all happen after it. `replyThenPush` preserves that exactly — it
 *    throws when there is no userId, throws when the refusal is not a reply-token
 *    refusal, and throws the REPLY's error when both legs fail. The only new
 *    outcome is "the push delivered", and stamping there is correct because the
 *    customer did get the card. Verified by reading `replyThenPush`, not assumed.
 *    ⇒ ยัง throw ทุกกรณีที่การ์ดไม่ถึง สัญญาเดิมไม่พัง
 *
 * ── WHAT IS STILL WITHOUT A LADDER — 12 SITES, MEASURED 02/09 ──────────────
 * NOT FIXED, on the owner's instruction. Recorded so nobody has to re-derive it
 * from a lost message. `[FEAT-20260830-REPLYPUSH]` put the ladder behind an
 * OPTIONAL trailing `userId` and its own comment says the rollout was partial on
 * purpose; this is exactly how much of it is left.
 *
 * DONE — every card that goes out through `sendFlexReply`, plus the notice card
 * and the menu POSTBACK seat. Six flex sites, all passing `userId`.
 *
 * 🔴 STILL REPLY-ONLY. Counted by reading every call site in
 *    `webhook.service.ts`, not by grep shape:
 *
 *      sendTextReply — 7 of 9
 *        the slip refusal text · the ask-for-details text · the rate-limit
 *        warning · the missing-API-data text · the image-answer text · the
 *        out-of-hours text · the api-missing text
 *
 *      this.replyViaCore direct — 5
 *        the menu RESOLVER's `coreSend` (a different seat from the postback one
 *        that was fixed) · and two pairs handed to the customer-register
 *        handler, of which `sendLineFlexReply` in EACH pair sends a CARD
 *
 * ⚠️ SO "THE FLEX SIDE IS DONE" IS NOT TRUE, and saying it was an error worth
 *    recording: two card senders remain, because they reach LINE through
 *    `replyViaCore` directly rather than through `sendFlexReply`. Counting by
 *    the wrapper's name misses them.
 *
 * 🔴 THE POLARITY HAS FLIPPED, and that is the part to understand before
 *    deciding when to finish this. Four of the seven text sites are the `else`
 *    branch of a card call that now HAS the ladder — the missing-data card, the
 *    image answer, the api-missing card, the slip refusal. So on a refused
 *    token:
 *        this turn produced a CARD  → it arrives
 *        this turn produced TEXT    → it is lost
 *    which is the exact reverse of the morning, when text survived and cards
 *    died. Neither half is worse than the other; leaving it half-done just means
 *    the failure is harder to predict.
 *    ⇒ ตอนนี้กลับด้าน: มีการ์ดรอด · ตกมาเป็นข้อความหาย
 *
 * ── IF YOU DO FIX IT, THIS IS THE SHAPE ────────────────────────────────────
 *  1. add `userId?: string | null` as the LAST parameter here and hand it to
 *     `flexReply` — do not call `replyViaCore` directly any more, so the ladder
 *     lives in exactly one place, which is the whole point of `[PUSHCORE-A2]`.
 *  2. pass `args.channelUserId` (or whatever the notice deps already carry for
 *     the member) at the `sendFlex:` wiring site.
 *  3. 🔴 RE-READ `notice-guard.helper.ts:250-296` BEFORE YOU DO. Its stamping
 *     contract depends on this send THROWING when the card did not arrive: the
 *     `sent` flag is set only after the await, and the stamp plus the quota
 *     charge happen only on the success path, precisely so a member is never
 *     recorded as "already warned" for a card they never saw. Adding a push
 *     ladder does not break that — it makes the success path MORE often true,
 *     which is correct — but a ladder that swallows the failure and returns a
 *     fake 200 would silently stamp a lost card. The ladder must still throw
 *     when BOTH legs fail.
 *  4. the notice probe (`z-test/manual/prove-notice-push.js`) pushes directly
 *     and therefore cannot see this at all. Prove the fix through the WEBHOOK,
 *     the way the defect was found.
 *
 * revert of the fix: drop the parameter again. Reply-only is the current,
 * deliberate state — not an oversight.
 */
export function noticeFlexReply(
  send: CoreSend,
  accessToken: string,
  replyToken: string,
  card: unknown,
  altText: string,
  /**
   * [FIX-20260902-NOTICEPUSH] omit ⇒ today's behaviour exactly, which is what
   * keeps the four existing cases in `reply-via-core.spec.ts` unchanged.
   */
  userId?: string | null,
): Promise<ReplySendResponse> {
  const messages = [
    buildReplyFlexMessage(
      card as Record<string, unknown>,
      altText.slice(0, 400),
    ),
  ];
  return userId
    ? replyThenPush(send, accessToken, replyToken, userId, messages)
    : replyViaCore(send, accessToken, replyToken, messages);
}

/* ==== [FEAT-20260828-PUSHCORE-A2] the pair the fourteen direct sites use ======
 *
 * These mirror `LineApiService.sendLineFlexReply` / `sendLineReplyMessage`
 * ARGUMENT FOR ARGUMENT, defaults included, so the fourteen call sites in
 * `webhook.service` changed by the receiver's NAME ONLY.
 *
 * They are HERE, not private methods, for the reason every candidate has hit:
 * three mutations survived the whole 69-file / 1455-case radius while they were
 * private — dropping `quickReply` from either sender, and changing the legacy
 * altText default. The quickReply one is the customer-visible worst: on the AI
 * reply path it carries `helperQuickReply`, the "เชื่อมข้อมูล" button, and every
 * spec on that path replaces the collaborator so none of them can see it vanish.
 */

/** Mirrors `sendLineFlexReply(accessToken, replyToken, contents, altText?, qr?)`.
 *  The English altText default is unreachable in practice — every call site
 *  passes Thai — but preserved, exactly as line-api.service.ts:161-164 argues:
 *  "unreachable today" is not "unreachable". */
export function flexReply(
  send: CoreSend,
  accessToken: string,
  replyToken: string,
  flexContents: unknown,
  altText = 'Bank Transfer Details',
  quickReply: unknown = null,
  /** [FEAT-20260830-REPLYPUSH] omit ⇒ today's behaviour exactly. */
  userId?: string | null,
): Promise<ReplySendResponse> {
  const messages = [
    buildReplyFlexMessage(
      flexContents as Record<string, unknown>,
      altText,
      quickReply as Record<string, unknown> | null,
    ),
  ];
  return userId
    ? replyThenPush(send, accessToken, replyToken, userId, messages)
    : replyViaCore(send, accessToken, replyToken, messages);
}

/** Mirrors `sendLineReplyMessage(accessToken, replyToken, text, quickReply?)`.
 *  ⚠️ The legacy PUSH sibling took no quickReply and silently dropped one; the
 *  REPLY one always accepted it, and the AI path depends on that. */
export function textReply(
  send: CoreSend,
  accessToken: string,
  replyToken: string,
  text: string,
  quickReply: unknown = null,
  /** [FEAT-20260830-REPLYPUSH] omit ⇒ today's behaviour exactly. */
  userId?: string | null,
): Promise<ReplySendResponse> {
  const messages = [
    buildReplyTextMessage(text, quickReply as Record<string, unknown> | null),
  ];
  return userId
    ? replyThenPush(send, accessToken, replyToken, userId, messages)
    : replyViaCore(send, accessToken, replyToken, messages);
}
