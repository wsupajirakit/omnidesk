/**
 * [FIX-20260822-NOTICEPOLICY] The decisions the owner may change their mind
 * about — all of them, in one file, as named constants.
 * ===========================================================================
 * Owner, 22/08, reviewing the first cut: *"note ไว้เผื่อเปลี่ยนใจ ออกแบบไว้ด้วย
 * ถอดใส่เปลี่ยนได้ เพราะว่าเราบอกแต่แรกแล้วแก้เงื่อนไขได้ ออกแบบท่อไว้"*.
 *
 * So every "should it also…?" answer lives HERE and nowhere else. A case file
 * says WHEN it fires; this file says which of those conditions the owner has
 * reserved the right to flip. Changing one is one line plus a rebuild — no
 * hunting through the cases, the guard or the webhook. ท่อเปลี่ยนใจอยู่ที่นี่ที่เดียว.
 *
 * ⛔ Nothing here changes production behaviour on its own: every consumer reads
 * these at decision time, and the shipped values are the behaviour the owner
 * approved on 22/08. revert: delete this file with the rest of notice-runtime/.
 */

/**
 * Which side's off-service verdict the SLIP cases (E/F) read.
 *
 * Shipped: `'deposit'` — owner, 22/08: *"ข้อ 3 ให้สลิปอ่านค่า ฝาก"*.
 *
 * WHY IT CHANGED. The 13:21 spec wrote case F as "ฝากปิด **หรือ** ถอนปิด".
 * That OR is dangerous in exactly one direction: F rides the DEPOSIT toggle and
 * its firing skips Swiftcheck and payment for that event, so a withdraw-only
 * outage — a normal thing during a bank cutover — would swallow every DEPOSIT
 * slip and leave real money uncredited. Reading the deposit side only keeps the
 * card honest: it fires when the thing the customer is doing is actually off.
 *
 * TO GO BACK: set this to `'either'`. Case F then answers on
 * `depositOff || withdrawOff` again, exactly as the original spec read.
 * เปลี่ยนกลับได้ที่บรรทัดเดียว.
 */
export const NOTICE_SLIP_SIDE: 'deposit' | 'either' = 'deposit';

/**
 * Does an OA whose master switch is OFF (`hook.status === 0`) still send notice
 * cards?
 *
 * Shipped: `true` = it respects the switch and stays silent. Owner, 22/08:
 * *"OA ที่ปิดสวิตช์ (status=0) ยังส่งการ์ด notice … = แก้ไข"*, and the webhook's
 * own rule has said the same since [FEAT-20260806-STATUSOFF]: a switched-off OA
 * is silent, chat is still stored.
 *
 * TO GO BACK: `false` makes notices ignore the master switch. Do not, unless
 * the owner asks — a kill switch that does not kill is worse than none.
 */
export const NOTICE_RESPECTS_HOOK_STATUS = true;

/**
 * Does a room an operator is holding (assist) suppress the notice?
 *
 * Shipped: `true` = the notice STAYS SILENT while an admin holds the room, on
 * BOTH paths. Owner, 22/08: *"เงียบทั้งสอง แต่ต้องตั้งค่าเปลี่ยนแปลงได้ในอนาคต
 * แบบง่ายๆ ทำท่อไว้"*.
 *
 * WHY IT CHANGED. The first cut left this `false`, which was defensible for
 * the MONEY half (an off deposit system is off whoever is in the room) but not
 * for the TALKING half: every other reply site in this webhook suppresses
 * itself in an assisted room — the slip refusal goes as far as skipping its own
 * history row so the admin screen and the customer's phone cannot disagree.
 * Worse, the two call sites disagreed with each other: the text guard sits
 * BELOW the assist bypass and was already silent, while the image guard sits
 * above it and was not. One knob, two behaviours, is a bug whichever way the
 * owner wants it. บอทต้องไม่แทรกตอนแอดมินคุยอยู่ · และสองเส้นต้องเหมือนกัน.
 *
 * ⚠️ WHAT SILENCE COSTS on the slip path: the customer gets no "system closed"
 * card, and the slip is verified and credited normally — the operator is in
 * the room and can say it themselves. That is the trade the owner picked.
 *
 * 🔴 READ THIS BEFORE FLIPPING IT — THE TWO PATHS ARE SILENT FOR DIFFERENT
 * REASONS. On the TEXT path the webhook's own assist bypass returns before the
 * guard is ever reached, so `assisted` arrives false there by construction and
 * this constant does nothing: the text guard stays silent whatever it is set
 * to. Only the IMAGE path actually consults it. Setting `false` therefore does
 * NOT restore "cards in assisted rooms" — it makes the image path answer while
 * the text path stays quiet, which is the asymmetry this knob was created to
 * end. To answer on both, the text bypass itself has to change, and that is a
 * decision about the whole webhook, not about this feature.
 * ปุ่มนี้คุมเส้นรูปจริง ๆ เส้น text เงียบด้วยกลไกของ webhook เอง.
 */
export const NOTICE_RESPECTS_ASSIST = true;

/**
 * Which inbound events the TEXT cases (A-D) may read.
 *
 * Shipped: `'any-text'` = anything the webhook has turned into text reaches the
 * word screens, including a postback's `data`. Owner, 22/08: *"6 ไม่เป็นไร
 * ตั้งใจแบบนั้น คือว่า event text"* — a customer who taps a button that says
 * "ฝากเงิน" is asking about deposits just as much as one who types it.
 *
 * ⚠️ KNOW WHAT THIS COSTS. A postback that fires a notice RETURNS, so that
 * postback's own handler does not run for that event. Only payloads carrying
 * one of the notice words are affected.
 *
 * ⭐ WIRED, 22/08 (owner: "2 ทำสิ"). `noticeTextEventAllowed` below is read at
 * the TEXT insertion point in webhook.service.ts, which is the only place with
 * the raw `event` in scope. With the shipped `'any-text'` that function answers
 * `true` unconditionally, so the guard is reached exactly as before — the knob
 * costs one boolean and changes nothing until it is flipped.
 *
 * TO NARROW: `'message-only'`. A postback then never reaches the word screens,
 * so its own handler runs instead; the customer sees the postback's normal
 * answer rather than a notice card. Nothing else in the flow moves.
 * ต่อสายแล้ว · ค่าที่ ship = เหมือนเดิมเป๊ะ · พลิกเมื่อไหร่แคบลงทันที.
 */
export const NOTICE_TEXT_EVENTS: 'any-text' | 'message-only' = 'any-text';

/**
 * May the TEXT cases read this event? Answers for NOTICE_TEXT_EVENTS.
 *
 * Pure, and takes the mode as an argument (defaulted) for the same reason the
 * abandon skip list does: a spec must be able to prove BOTH answers without
 * editing the constant, and a caller may run its own policy. ⚠️ Reads the LINE
 * event's own two fields — `event.type` and `event.message.type` — because a
 * postback carries its payload in `postback.data`, which the webhook has already
 * turned into text by the time the guard is called; only the raw event still
 * knows what it really was. ตัดสินจาก event ดิบ ไม่ใช่จากข้อความที่แปลงแล้ว.
 */
export function noticeTextEventAllowed(
  eventType: unknown,
  messageType: unknown,
  mode: 'any-text' | 'message-only' = NOTICE_TEXT_EVENTS,
): boolean {
  if (mode === 'any-text') return true;
  return eventType === 'message' && messageType === 'text';
}

/**
 * The per-member card cooldown.
 *
 * Shipped: `false` = REMOVED. Owner, 22/08: *"เรามี rate limit อยู่แล้ว ไม่ต้องมี
 * cooldown ถ้ามัน flood มันก็ได้การ์ดเดิมนั้นแหละ ถอด cooldown ออก note ไว้
 * (เผื่อเอากลับ)"*.
 *
 * WHY REMOVING IT IS ALSO A BUG FIX, not just a simplification: on the slip
 * path the guard's `false` return means "let Swiftcheck and payment run", so a
 * cooldown that blocked a CARD also decided whether MONEY was processed — two
 * identical slips five minutes apart got opposite treatment. The inbound rate
 * ladder (`rate-limit/user-rate-ladder.ts`, counts images from level 1) is the
 * real flood defence and it was there all along. คูลดาวน์คุมการ์ด ไม่ควรคุมเงิน.
 *
 * TO BRING IT BACK: set `true`. `notice-cooldown.ts` is intact — its constants,
 * its fail-open rules and its tests — and the guard reads the member stamp
 * that is still written on every send, so a flip is all it takes.
 */
export const NOTICE_COOLDOWN_ENABLED = false;

/**
 * Does the notice guard charge the inbound rate ladder for an event it
 * answered — and WHEN?
 *
 * Shipped: `'after-send'` = the ladder is charged once, immediately after the
 * card has actually gone out.
 *
 * WHY THE TIMING IS THE WHOLE POINT. The guard answers the image path ~600
 * lines above the webhook's own limiter, so a slip it answers would never
 * reach a counter — a free window for anyone who keeps uploading during an
 * off-service period. But charging the moment a CASE MATCHED (the first cut)
 * was worse: every path that matched without sending — a `limited` verdict, a
 * card that was never configured, a send LINE rejected — returned false, the
 * flow carried on, and `webhook.service.ts`'s limiter charged the SAME event a
 * second time. That block's own header states the rule it broke: "THIS BLOCK
 * MUST EXIST EXACTLY ONCE… a second copy would charge two units per message."
 *
 * Charging after a successful send makes the count exact in every direction:
 *   · card went out → this guard charges, and the flow never runs → 1
 *   · no card went out → this guard charges nothing, the flow charges → 1
 *
 * ⚠️ WHAT IT DOES NOT DO: it does not let the ladder SILENCE a notice card.
 * A `limited` verdict is counted, not obeyed — owner, 22/08, removing the
 * cooldown: *"ถ้ามัน flood มันก็ได้การ์ดเดิมนั้นแหละ"*. Obeying it here would
 * mean returning false after having charged, which is the double-count again.
 * If the owner ever wants a limited customer silenced, that decision belongs
 * at ONE place — the webhook's limiter, which already owns it — not here.
 *
 * ⚠️ ONE EVENT KIND IS OUTSIDE THIS ARITHMETIC: a POSTBACK. The webhook's
 * limiter is gated on `event.type === 'message'`, and the text call site passes
 * no `consumeQuota` at all, so a postback whose `data` carries a notice word
 * (a rich-menu button labelled "ฝากเงิน") is answered with a card and charged
 * nothing — on either side. That free channel is pre-existing: postbacks are
 * deliberately excluded from the limiter. It is recorded here so the sentence
 * above is not read as covering it. postback ไม่ถูกนับ ทั้งก่อนและหลังงานนี้.
 *
 * TO GO BACK: `'off'` makes the guard ignore the ladder completely; the code
 * path is then byte-identical to the version before this knob existed, and the
 * only cost is that a slip answered by a card goes uncounted.
 * นับครั้งเดียว หลังการ์ดออกจริง · ปิดได้ที่บรรทัดเดียว.
 */
export const NOTICE_QUOTA_CHARGE: 'after-send' | 'off' = 'after-send';

/**
 * How far the "first candidate that can actually send" fallback may reach.
 *
 * Shipped: `'same-stamp'` = only among cases that stamp the SAME member key,
 * i.e. the same side of the business — deposit (A,B) · withdraw (C,D) ·
 * payment/slip (E,F).
 *
 * WHY IT IS NOT `'any'`. [FIX-20260822-NOTICEHARDEN #9] made the guard walk
 * past a matching case whose card is not configured, so one unusable case can
 * no longer silence a usable one. But the word lists share twelve substrings,
 * so an ordinary sentence ("เงินไม่เข้า") matches the deposit AND the withdraw
 * screens at once. With an unrestricted walk, an OA that has the deposit
 * off-time card unset would answer a DEPOSIT complaint with the WITHDRAW
 * card — a wrong-side answer, which is worse than silence: the customer is
 * told the wrong system is closed and may stop trying the one that works.
 * Silence at least leaves the AI and the operator to answer.
 *
 * WHAT IT STILL RESCUES (the whole point of #9): A → B, C → D, E → F — the
 * off-time card missing while the disable card of the SAME side is configured.
 * That is the state a clone or a hand edit actually produces.
 *
 * TO WIDEN: `'any'` restores the unrestricted walk over NOTICE_CASE_ORDER.
 * ถอยได้แค่ในฝั่งเดียวกัน · การ์ดผิดฝั่งแย่กว่าเงียบ.
 */
export const NOTICE_FALLBACK_SCOPE: 'same-stamp' | 'any' = 'same-stamp';
