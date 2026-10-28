/**
 * ==== [FEAT-20260809-PAYTOOL-COPY] payment reply COPY — every customer-facing
 *      string, in one file ====
 *
 * WHAT: the complete set of words a customer can read from the payment feature —
 * the per-state reply body text, the flex button labels, and the flex altText.
 * Nothing here is logic. Every value is a plain string constant, and every entry
 * carries a note saying WHICH state it is, WHEN the customer sees it, whether
 * MONEY MOVED, whether the SLIP IS LOCKED, and WHICH CONFIG KEY overrides it.
 *
 * WHY THIS FILE EXISTS (owner, todo3_9aug.md): "จุดที่เป็นตัวกำหนดข้อความ reply
 * หรือข้อความ detail บนปุ่ม — แยกไฟล์ออกมาเป็นตัวแปร สำหรับแก้ไขง่าย". Before
 * this file, changing one word a customer reads meant opening the runner (a
 * ~2.3k-line money-path service) and editing a literal inside a map that sits
 * next to CAS locking and HTTP legs. That is a scary edit for a copy change, and
 * scary edits get avoided or get made carelessly. Now the copy lives away from
 * the money logic: the runner keeps the STRUCTURE (kind / cfgKey / actions), this
 * file keeps the WORDS. แก้คำที่ลูกค้าเห็น = แก้ไฟล์นี้ไฟล์เดียว ไม่ต้องแตะโค้ดเงิน.
 *
 * WHY NOT ALSO THE COLOURS: `MINT_COLORS` stayed in payment-mint-flex.builder.ts.
 * It is styling, not wording — a hex value is not something an operator rewrites
 * for a customer, and mixing it in here would weaken the one property that makes
 * this file useful ("everything in here is words a customer reads"). It is
 * already a single named object next to the bubble it styles, which is the right
 * home for it.
 *
 * ⚠️ THIS FILE IS COPY ONLY — NOT the config write-path. The stored per-tool
 * defaults live in `PAYMENT_KNOB_DEFAULTS` (modules/hooks/custom-tool-normalize.ts)
 * and are NOT duplicated here. Those are the knob defaults written onto a tool
 * record; these are the runtime fallbacks used when a tool leaves a knob empty.
 * Do not move one into the other.
 *
 * ══ HOW TO CHANGE COPY LATER (แก้ข้อความยังไง) ═══════════════════════════════
 *
 *   1. FOR ONE TOOL ONLY, NO CODE CHANGE (prefer this):
 *      set `tool.payment.<cfgKey>` on the tool record. A non-empty value always
 *      beats the default below. Each entry names its own cfgKey.
 *
 *   2. FOR EVERY TOOL (the default): edit the string in REPLY_TEXT below. That
 *      is the whole edit — the runner reads it, nothing else copies it.
 *
 *   3. BUTTON WORDING: edit BUTTON_LABELS below. The KEY is a contract (it must
 *      match the runner's `ReplyAction`); only the VALUE is customer-facing.
 *
 *   4. NOTIFICATION LINE: edit MINT_FLEX_ALT_TEXT below.
 *
 *   Changing a string here changes what a customer reads on the next reply. It
 *   does NOT change any state, lock, or money decision — those live in the
 *   runner's flow (_runWalletpay / _classifyTopup / _classifyWalletpay).
 *
 * ADDING A NEW STATE: add it to `ReplyState` (payment-runner.service.ts) → add a
 * REPLY_TEXT entry here → add a REPLY_STATE_DEFAULTS entry (runner) → add
 * STATE_NOTES (payment-mint-flex.builder.ts) → add a knob in
 * custom-tool-normalize.ts. REPLY_TEXT is typed `Record<ReplyState, string>`, so
 * a missing entry here is a COMPILE error, not a blank message to a customer.
 *
 * revert: inline these constants back into REPLY_STATE_DEFAULTS
 * (payment-runner.service.ts) and payment-mint-flex.builder.ts, then delete this
 * file. Pure move — no behaviour depends on its existence.
 */
import type { ReplyState } from './payment-runner.service';

/**
 * ==== THE CUSTOMER-FACING DEFAULT TEXT, ONE ENTRY PER STATE ====
 *
 * Each value is the DEFAULT body text for that state — what the customer reads
 * when the tool has NOT set the state's `tool.payment.*_reply_text` override.
 * Typed against `ReplyState`, so every state must have an entry and a new state
 * cannot ship without copy.
 *
 * Resolution order (payment-runner.service.ts `_reply`), unchanged by this file:
 *   tool.payment.<cfgKey>  →  the string here  →  dynamicText (last resort)
 */
export const REPLY_TEXT: Record<ReplyState, string> = {
  /**
   * STATE: `topup_success` — LEG 1 topup returned `process-wallet`.
   *
   * WHEN SEEN: the customer sent a slip, topup read it and credited on the spot.
   * This is the happy path and it is TERMINAL — walletpay never runs after it.
   * MONEY: MOVED — credited. SLIP: locked/finalized (`lock_reason:'success'`),
   * so a re-delivery of the same event can never credit twice.
   * OVERRIDE: `tool.payment.reply_success_text` (shared with `walletpay_success`).
   * ลูกค้าได้เครดิตแล้ว — ข้อความนี้บอกว่ากำลังอัพเดท ไม่ใช่ว่ายังไม่สำเร็จ.
   *
   * ⚠️⚠️ [DEADCODE-20260810-TOPUPCARD] ข้อความนี้ **ไม่ถูกส่งให้ลูกค้าแล้ว**
   *
   * ตั้งแต่ 2026-08-10 เจ้าของสั่งว่าเคส `process-wallet` ให้ตอบด้วย **การ์ด
   * `flex_success` ของ Swiftcheck** เหมือน flow ปกติ ไม่ใช่ข้อความของ payment
   * `payment-runner.service.ts` (`_result`) จึงคืน `reply: undefined` สำหรับ state นี้
   * ⇒ `webhook.service.ts:3468` เห็นว่าไม่มี reply ⇒ ปล่อยการ์ดสลิปเดิมตอบแทน
   *
   * การ์ดที่ลูกค้าเห็นจริงมาจาก: `flex_messages` ใน MongoDB เลือกด้วย
   * `hook.flex_success` ประกอบที่ `webhook/slip-flex.handler.ts`
   * ⇒ แอดมินแต่งการ์ดเองได้จากหน้าเว็บ ไม่ต้องแก้ไฟล์นี้
   *
   * ทำไมไม่ลบทิ้ง: (1) `ReplyState` ยังมี `'topup_success'` เป็นสมาชิก และ
   * `REPLY_TEXT` เป็น `Record<ReplyState, string>` — ลบแล้ว type พัง
   * (2) เก็บไว้ให้ revert ได้ทันที ถ้าวันหลังอยากกลับไปตอบข้อความเอง
   * (3) เป็นเอกสารว่าเคยตอบอะไร เผื่อต้องเทียบย้อนหลัง
   *
   * ห้ามแก้ข้อความนี้เพื่อหวังให้ลูกค้าเห็น — ไปแก้การ์ดที่หน้าเว็บแทน.
   */
  topup_success: 'กำลังดำเนินรายการ กำลังอัพเดทเครดิต',

  /**
   * STATE: `walletpay_success` — LEG 2 walletpay matched a statement AND confirmed it.
   *
   * WHEN SEEN: topup did NOT credit, so walletpay ran as the alternative credit
   * path, found the statement matching the slip amount, and confirmed. Terminal.
   * MONEY: MOVED — credited. SLIP: locked/finalized.
   * OVERRIDE: `tool.payment.reply_success_text` — the SAME key as
   * `topup_success`, deliberately: from the customer's side both mean "your
   * money arrived", and which leg credited is our internal business.
   * ⚠️ ผลข้างเคียงที่ต้องรู้: แก้ reply_success_text ทีเดียว เปลี่ยนทั้งสอง state.
   * ถ้าอยากให้ข้อความต่างกัน ต้องเพิ่ม cfgKey ใหม่ใน PaymentCfg ก่อน.
   *
   * ⚠️⚠️ [DEADCODE-20260810-TOPUPCARD] ข้อความนี้ **ไม่ถูกส่งให้ลูกค้าแล้ว**
   * เหมือนกับ `topup_success` — ทั้งคู่อยู่ใน `SLIP_CARD_STATES`
   * (`payment-runner.service.ts`) ⇒ คืน `reply: undefined` ⇒ **การ์ด `flex_success`
   * ของ Swiftcheck** เป็นคนตอบลูกค้าแทน
   *
   * ใช้การ์ด **ตัวเดียวกับ topup process-wallet** โดยตั้งใจ: จากมุมลูกค้าทั้งสองเคส
   * แปลว่า "เงินเข้าแล้ว" เหมือนกัน จะเห็นการตอบต่างกันไม่ได้ (เจ้าของสั่ง 2026-08-10)
   *
   * การ์ดมาจาก `flex_messages` เลือกด้วย `hook.flex_success` ประกอบที่
   * `webhook/slip-flex.handler.ts` ⇒ แอดมินแต่งเองได้จากหน้าเว็บ
   *
   * เก็บไว้ไม่ลบด้วยเหตุผลเดียวกับ `topup_success` (type ของ Record ต้องครบทุก
   * ReplyState + ไว้ revert + เป็นเอกสารว่าเคยตอบอะไร)
   * ห้ามแก้ข้อความนี้เพื่อหวังให้ลูกค้าเห็น — ไปแก้การ์ดที่หน้าเว็บแทน.
   */
  walletpay_success: 'กำลังดำเนินรายการ กำลังอัพเดทเครดิต',

  /**
   * STATE: `matched_pending` — walletpay matched the statement but `confirmed:false`.
   *
   * WHEN SEEN: the slip WAS paired with a real statement, but the far side did
   * not auto-confirm, so a human admin finalizes it. Terminal for us: the
   * customer does nothing and waits.
   * MONEY: not credited YET — matched and awaiting an admin's confirm.
   * SLIP: LOCKED (finalized) — the slip was uploaded, so it must not be run
   * again; a second upload of the same slip is what we are preventing here.
   * OVERRIDE: `tool.payment.pending_reply_text`.
   * ห้ามเขียนข้อความให้ลูกค้าเข้าใจว่า "สำเร็จแล้ว" — แอดมินยังต้องกดยืนยัน.
   */
  matched_pending: 'กำลังดำเนินการเติมเงิน',

  /**
   * STATE: `no_match_retry` — walletpay said no_match AND statements remain.
   *
   * WHEN SEEN: this statement was not the one, but there is a NEXT statement to
   * try. The run PAUSES and the customer is shown a FLEX with [ลองใหม่]; the tap
   * resumes the SAME run at x+1 with the SAME stored slip image — the customer
   * does NOT photograph anything again.
   * MONEY: NOT moved. SLIP: still claimed (paused, not released) so a concurrent
   * run cannot grab it, but the outcome is not decided.
   * OVERRIDE: `tool.payment.no_match_reply_text`.
   * ⚠️ ข้อความนี้ต้องชวนให้กดปุ่มต่อ — ถ้าเขียนเหมือน "ล้มเหลว" ลูกค้าจะเลิกกด
   * แล้ว statement ที่เหลือจะไม่ถูกลองเลย. ชื่อปุ่มอยู่ที่ BUTTON_LABELS ข้างล่าง.
   */
  no_match_retry:
    'ไม่พบรายการที่ตรงกับสลิปนี้ กรุณากด "ลองใหม่" เพื่อตรวจสอบรายการถัดไป',

  /**
   * STATE: `not_linked` — the LINE account has no linked web account.
   *
   * WHEN SEEN: topup answered with a not-linked code (NOT_LINKED_CODES in the
   * runner), which GUARANTEES nothing was credited. The fix belongs to the
   * customer: link the account, then send the slip again.
   * MONEY: NOT moved — nothing credited. SLIP: lock RELEASED, so resending the
   * same slip after linking is allowed and will run normally.
   * OVERRIDE: `tool.payment.not_linked_reply_text`.
   * TEXT, not flex, on purpose: a [ลองใหม่] button here would be a lie — retrying
   * changes nothing until the account is actually linked.
   * ต้องบอกให้ชัดว่าต้อง "ผูกบัญชีก่อน" แล้วค่อยส่งสลิปใหม่ ไม่งั้นลูกค้าจะส่งซ้ำเปล่า ๆ.
   */
  not_linked: 'ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง',

  /**
   * STATE: `member_not_match` — topup ตอบ `slip_status.status === 'member-not-match'`
   *
   * WHEN SEEN: สลิปตรวจผ่าน แต่ **บัญชีต้นทางที่โอนมาไม่ใช่ของลูกค้าคนนี้**
   * (เช่น ให้คนอื่นโอนแทน) ⇒ ระบบยืนยันตัวตนเจ้าของเงินไม่ได้
   *
   * MONEY: ไม่ได้เคลื่อน — topup ไม่เติมเครดิต และ **ไม่ไปต่อ walletpay**
   * (เจ้าของสั่ง 2026-08-10) เพราะ walletpay เป็นทางเติมสำรอง แต่ปัญหาเคสนี้คือ
   * "เจ้าของบัญชีไม่ตรง" ซึ่งอีกทางก็แก้ไม่ได้ ต้องให้คนตัดสิน
   *
   * SLIP: **ปล่อย** (ไม่ล็อก) — เจ้าของเลือกข้อ ข ⇒ ลูกค้าส่งสลิปใบใหม่ได้ทันที
   * ไม่ต้องรอแอดมินปลดล็อก
   * REVIEW: `needs_review: true` + `review_reason: 'member_not_match'`
   * ⇒ แอดมินเห็นในหน้า log และกรองได้
   *
   * OVERRIDE: ยังไม่มี cfgKey ของตัวเอง — ถ้าต้องการให้ตั้งข้อความราย OA
   * ต้องเพิ่ม key ใหม่ใน PaymentCfg ก่อน (ดูวิธีที่ state อื่นทำ)
   * ข้อความบอกลูกค้าตรง ๆ ว่าจะมีแอดมินมาดูแล ไม่ปล่อยให้เงียบ.
   */
  member_not_match:
    'เนื่องจากบัญชีที่โอนมา ไม่ใช่บัญชีของคุณลูกค้าเอง เดี๋ยวน้องลัคกี้จะแจ้งพี่แอดมินให้มาดูแลต่อนะคะ',

  /**
   * STATE: `review` — timeout / statements exhausted / ambiguous outcome.
   *
   * WHEN SEEN: we could NOT determine what happened — topup timed out, or walletpay
   * ran out of statements after uploading, or the answer was unclear. A human
   * must look.
   * MONEY: UNKNOWN — it may have moved. This is exactly why the state exists and
   * why it fails SAFE. SLIP: LOCKED (the slip was already uploaded somewhere), so
   * nothing re-runs behind the admin's back.
   * OVERRIDE: `tool.payment.review_reply_text`.
   * FLEX with contact-admin only — the [ลองใหม่] button is deliberately NOT
   * rendered here (no resume context exists; there is nothing to advance to).
   * ⚠️ เงินอาจถูกตัดไปแล้ว ห้ามเขียนว่า "ไม่สำเร็จ" หรือ "ยกเลิกแล้ว" เด็ดขาด —
   * ต้องเป็นน้ำเสียง "ตรวจสอบไม่ได้อัตโนมัติ ติดต่อแอดมิน".
   */
  /**
   * STATE: `topup_duplicate` — topup ตอบ `slip_status.status === 'duplicate'`
   * [FEAT-20260823-TOPUPDUP] เจ้าของสั่ง 23/08/2026
   *
   * ⚠️ ข้อความนี้เป็น **ทางสำรองเท่านั้น** — ปกติลูกค้าจะได้ *การ์ด* คือ
   *    `hook.flex_duplicate` ของ Swiftcheck (ผ่าน default ที่
   *    `payment-state-flex.resolver.ts` → `withSwiftcheckDuplicateFallback`)
   *    ข้อความนี้จะถูกใช้ก็ต่อเมื่อ OA **ไม่ได้ตั้งการ์ด duplicate ไว้เลย**
   *    และไม่ได้ผูก `payment_flex_ids.topup_duplicate` ด้วย
   *
   * เขียนให้ลูกค้าเข้าใจว่า "ไม่ต้องส่งซ้ำ เงินเข้าไปแล้ว" ไม่ใช่ "ล้มเหลว"
   * เพราะ duplicate แปลว่ารายการก่อนหน้าสำเร็จ ไม่ใช่รายการนี้พัง
   * SLIP: ปล่อย (RELEASED) · REVIEW: ไม่ตั้ง · TICKET: ไม่เปิด — ดูเหตุผลที่
   * `payment-runner.service.ts` แท็ก [FEAT-20260823-TOPUPDUP]
   */
  topup_duplicate:
    'สลิปใบนี้ถูกใช้ทำรายการไปแล้ว ไม่ต้องส่งซ้ำนะคะ หากยอดยังไม่เข้า กรุณาแจ้งแอดมิน',

  review:
    'ไม่สามารถดำเนินรายการอัตโนมัติได้ กรุณาลองใหม่อีกครั้งหรือติดต่อแอดมิน',

  /* [DOC-20260810-PAYSTATES] Every reply state below is one leaf of the run's
   * state machine. The whole machine — gates, both legs, which topup answers
   * stop before walletpay, and what each outcome means for the slip lock — is
   * mapped in `docs/payment-states.md`, with a file:line for every
   * claim so it can be checked against this code rather than trusted. */
  /**
   * STATE: `statement_not_found` — no walletpay statement matched the slip amount.
   *
   * [NOTE-20260810-NOMATCHSTATEMENT] IN PLAIN LANGUAGE, the symptom behind this
   * message is: **"ยอดในสลิปไม่ตรงกับยอดรายการรอฝากของลูกค้า"** — the amount on
   * the slip equals no pending deposit in the customer's own statements. The
   * match is EXACT (`statement.amount === slip.amount`, provider 'walletpay',
   * status 'waiting-deposit') and it happens at
   * `payment-runner.service.ts:_matchStatements` — see the long note at its
   * call site before changing anything, especially before adding a tolerance.
   *
   * THE THREE ORDINARY CAUSES, all customer-side and all self-correcting:
   *   · the transferred amount differs from any pending deposit
   *   · no deposit request was opened before the slip was sent
   *   · the statement has not synced yet (slip sent seconds after transfer)
   * That is why this raises NO admin review — it would be noise, not signal.
   *
   * WHEN SEEN: topup did not credit AND no candidate statement was found at all,
   * so walletpay was never called — we cannot verify the amount against anything.
   * MONEY: NOT moved — nothing credited, nothing uploaded. SLIP: lock RELEASED,
   * so the customer may resend and the run will start clean.
   * OVERRIDE: `tool.payment.not_found_reply_text`.
   * ต่างจาก `review` ตรงที่อันนี้ "รู้ว่าไม่มีอะไรเกิดขึ้น" — ส่งใหม่ได้ปลอดภัย.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * [NOTE-20260815-WALLETPAYARMED] ⚠️ THE EXACT CASE THIS STATE ANSWERS —
   * OWNER-STATED 2026-08-15. All four must hold together; this is the rule,
   * not a description of one incident:
   *
   *   1. topup ran and did NOT succeed          (no credit — e.g. account-not-match)
   *   2. that outcome QUALIFIES for the walletpay leg  (`_classifyTopup` → continue)
   *   3. a walletpay tool is BOUND and SWITCHED ON     (`walletpay_tool_status === true`
   *                                                   && `walletpay_tool_id` set)
   *   4. no statement matches the slip amount       (`_matchStatements` → 0)
   *      ⇒ ตอบ `statement_not_found`
   *
   * ถ้า topup ไม่สำเร็จ + เข้าเงื่อนไขส่ง walletpay + เปิดใช้ walletpay tool อยู่
   * + ไม่มี statement ยอดตรง = ต้องตอบ `statement_not_found` (เจ้าของกำหนด 15/08/2026)
   *
   * ⚠️ CONDITION 3 IS WHAT MAKES THE MESSAGE HONEST. "cannot verify the amount"
   * only means something when a verifier EXISTS. With no walletpay leg armed there
   * was never anything that could have matched, so blaming the amount would send
   * the customer to re-check a slip that was never the problem.
   *
   * SEEN LIVE 15/08/2026 — slip 2,500 on `omnideskdevoa`, all four conditions met:
   * topup answered `account-not-match` (1,2), walletpay tool bound+ON and resolved
   * — `[TOOLCHECK] walletpay: OK "walletpay (payin slip)" (separate tool)` (3) — then
   * `no_matching_statement` with an EMPTY `final` in the handoff result, proving
   * walletpay was never POSTed to (4).
   *
   * WHY THE PRECONDITION MATTERS — "cannot verify the amount" is only honest
   * when a verifier EXISTS. With no walletpay leg armed there is nothing that
   * could ever have matched, and blaming the amount would send the customer to
   * re-check a slip that was never the problem. The runner already keeps those
   * apart, each with its OWN reason, and they must stay apart:
   *
   *   reason (internal)      | precondition                       | site
   *   -----------------------|------------------------------------|-------------------------
   *   no_matching_statement  | walletpay REACHABLE, 0 candidates     | payment-runner.service.ts:1521
   *   walletpay_tool_invalid    | bound + ON but deleted/disabled/   | payment-runner.service.ts:1483
   *                          | no `pay_walletpay` endpoint           |
   *   no_walletpay_endpoint     | nothing bound AND the payment tool | payment-runner.service.ts:1494
   *                          | has no `pay_walletpay` line           |
   *
   * ⚠️ ALL THREE currently land on THIS ONE customer text, because
   * `_statementFallback` maps every reason it is given to the
   * `statement_not_found` reply state (payment-runner.service.ts:1120, :2143).
   * Only the FIRST row is the amount-mismatch this copy describes; the other two
   * are CONFIG faults on our side wearing the same words. The internal reason is
   * preserved in the handoff result (`context.reason`) — read THAT, never the
   * customer text, when diagnosing which of the three actually happened.
   * เห็นข้อความนี้ = ยังไม่พอสรุปว่ายอดไม่ตรง ต้องเปิด reason จริงใน handoff log.
   *
   * IF THE THREE SHOULD EVER READ DIFFERENTLY: add reply states beside this one
   * and map each reason to its own, in `REPLY_BY_REASON`
   * (payment-runner.service.ts:479) — do NOT branch on strings inside the copy.
   */
  /* [COPY-20260810-AMOUNTMISMATCH] Owner-supplied wording, 2026-08-10.
   * Replaces "ไม่สามารถตรวจสอบยอดเงินได้", which read like a system fault and had
   * customers resending the same slip instead of checking the amount. The new text
   * names the actual cause — the transferred amount does not match a pending
   * deposit — which is what the long note above already says the symptom is.
   * It PROMISES an admin will follow up, and that promise IS kept by the system.
   *
   * [FIX-20260815-TICKETNOTE] ⚠️ THIS PARAGRAPH USED TO SAY THE OPPOSITE —
   * "raises NO review and opens NO ticket … the promise is kept by a human
   * seeing the chat, not by the system". That was true when the copy was
   * written, and became WRONG on the same day `[FEAT-20260810-AMOUNTTICKET]`
   * landed; nobody came back to this comment. Corrected here after reading the
   * runner, not from memory. What the code does TODAY:
   *
   *   · a ticket IS opened — payment-runner.service.ts:2106
   *     `openPaymentTicketIfIdle` with the real numbers in `needDetail`:
   *     "ยอดในสลิปไม่ตรงกับรายการรอฝากของลูกค้า — ยอดในสลิป N บาท · รายการรอฝาก …"
   *   · room already claimed ⇒ no duplicate ticket, a chat DIVIDER is written
   *     instead so the admin still sees the new slip (payment-runner.service.ts:2126)
   *   · NO admin review row is raised — that part of the old note still holds
   *
   * ⚠️ ONLY the `no_matching_statement` reason opens that ticket
   * (payment-runner.service.ts:2069 gates on the reason AND on `ticketCtx`).
   * The two config-fault reasons in the table above reach this same text with NO
   * ticket at all — so an operator-side fault is the quiet one, which is exactly
   * backwards. Noted, deliberately NOT changed here: it is a money-path branch.
   * ยืนยันแล้วจาก log จริง 15/08: `[PAYTICKET] ห้องถูก claim อยู่แล้ว — เขียน divider แทน`.
   *
   * เตือน: คอมเมนต์เรื่อง ticket ที่นี่เคยผิดมาแล้วครั้งหนึ่ง — แก้ flow ตรงนั้นเมื่อไหร่ ต้องกลับมาแก้ที่นี่ด้วย. */
  statement_not_found:
    'เนื่องจากยอดที่โอนมา กับยอดเงิน ในสลิป ไม่ถูกต้อง เดี๋ยวน้องลัคกี้จะแจ้งพี่แอดมินให้มาดูแลต่อนะคะ',
};

/**
 * ==== BUTTON COPY ====
 *
 * The words ON the flex buttons, keyed by the runner's `ReplyAction`.
 *
 * OWNER-DECIDED 2026-08-08: pick clear wording now; English keys, Thai labels, so
 * a label in a log, in the runner, and here is the same word.
 *
 * THE KEY IS A CONTRACT, THE VALUE IS COPY. `retry` / `contact_admin` must keep
 * matching `ReplyAction` in payment-runner.service.ts — `buildAction` looks the
 * label up by key and renders NOTHING for an unknown action. Rename a key and the
 * button silently disappears; change a VALUE and only the wording changes.
 *
 * WHEN EACH IS SEEN:
 *  · `retry` — only on `no_match_retry`, and only when the run really has a next
 *    statement to resume to. It is a server-side resume of the SAME slip image,
 *    not a re-upload. กดแล้วไม่ต้องถ่ายสลิปใหม่.
 *  · `contact_admin` — on both flex states (`no_match_retry`, `review`). Posts
 *    the Thai phrase below into the chat, which is what an operator answers.
 *
 * NOT per-tool overridable today, unlike the body text. That is deliberate:
 * adding `tool.payment.*_button_label` is easy but speculative until an operator
 * actually needs different button wording per tool.
 */
export const BUTTON_LABELS: Record<string, string> = {
  retry: 'ส่งสลิปใหม่',
  contact_admin: 'ติดต่อแอดมิน',
};

/**
 * The chat message a [ติดต่อแอดมิน] tap posts on the customer's behalf.
 *
 * Kept a NAMED constant even though it currently equals the button label: they
 * are two different customer-facing things (what the button says vs what gets
 * typed into the chat) and an operator may well want the posted message to be
 * more specific later without renaming the button.
 * ปุ่มกับข้อความที่ถูกส่งเข้าแชท เป็นคนละอย่าง แยกตัวแปรไว้ให้แก้แยกกันได้.
 */
export const CONTACT_ADMIN_MESSAGE = 'ติดต่อแอดมิน';

/**
 * [FEAT-20260831-ADMINVIAWITHDRAW] The chat message a [ติดต่อแอดมินปัญหาการถอน]
 * tap posts — the same idea as the constant above, for the button that screens
 * the withdraw notice lane before it hands the customer to an admin.
 *
 * ⚠️ NO "เงิน" IN IT, ON PURPOSE, and this is worth keeping. `เงิน` sits in the
 * SHARED block of both word lists (`notice-word-match.ts`), so a phrase carrying
 * it matches the DEPOSIT side too — and the deposit cases come first in
 * `NOTICE_CASE_ORDER`, so the customer would get the deposit card. Measured, not
 * assumed:
 *     "ติดต่อแอดมินปัญหาการถอนเงิน"  deposit ✓  withdraw ✓
 *     "ติดต่อแอดมินปัญหาการถอน"      deposit ·  withdraw ✓
 * The door this text opens does not depend on word matching at all — but if it
 * is ever removed, this phrasing falls back to the WITHDRAW side rather than the
 * wrong one. ล้มแล้วยังล้มถูกด้าน.
 */
export const CONTACT_ADMIN_WITHDRAW_MESSAGE = 'ติดต่อแอดมินปัญหาการถอน';

/**
 * [FEAT-20260831-ADMINDIRECT] What a [ติดต่อแอดมิน] tap files the case as.
 *
 * `needDetail` is the customer's own words — the same convention every other
 * system-opened case follows (`SCENARIO_A_NEED_DETAIL = 'ต้องการลงทะเบียน'`), and
 * what an operator reads first in the queue.
 * ⚠️ Category is `'Other'`, not `'Payment'`: this button says nothing about money.
 *    `'Payment'` would put the case in the money queue on no evidence at all.
 */
/**
 * [FEAT-20260831-ADMINDIRECT] ⭐ ข้อความที่ตอบกลับลูกค้าทันทีเมื่อกดปุ่มติดต่อแอดมิน
 *
 * เจ้าของสั่ง 31/08 และบอกไว้ว่า **อาจแก้ทีหลัง** — จึงเป็นค่าคงที่ชื่อชัดตัวเดียว
 * แก้ข้อความที่นี่ที่เดียวจบ ไม่ต้องไปตามหาในโค้ดเส้นเว็บฮุค
 * (ไฟล์นี้ตั้งใจแยก "คำบนปุ่ม" กับ "ข้อความที่ถูกส่ง" ออกจากกันอยู่แล้ว — ดู
 *  CONTACT_ADMIN_MESSAGE ด้านบน — ตัวนี้เป็นตัวที่สาม: สิ่งที่ลูกค้าได้อ่านกลับ)
 * ⚠️ ตอบก่อน แล้วค่อยเปิดเคส: ถ้าเปิดเคสก่อน ห้องจะกลายเป็น assisted แล้วข้อความนี้
 *    จะถูกนับเป็นการตอบของบอทในห้องที่แอดมินถือแล้ว
 */
export const CONTACT_ADMIN_ACK_TEXT =
  'น้องลั๊คกี้ติดต่อแอดมินให้เรีบยบร้อยแล้ว กรุณารอสักครู่นะคะ';

export const CONTACT_ADMIN_TICKET_CATEGORY = 'Other';
export const CONTACT_ADMIN_TICKET_NEED = CONTACT_ADMIN_MESSAGE;

/**
 * [FIX-20260902-ADMINDIVIDER] ⭐ The divider an ADMIN reads when this case opens.
 *
 * Owner, 02/09: **the bare label, nothing added.**
 *     before: "เคสนี้สร้างโดยระบบ ติดต่อแอดมิน"
 *     now:    "ติดต่อแอดมิน"
 *
 * "เคสนี้สร้างโดยระบบ" ("this case was opened by the system") reads as the system
 * having decided something on its own, which is not what happened — the customer
 * pressed a button and asked. The two send whoever picks the case up to different
 * first questions: a system-opened case makes them hunt for the trigger, while this
 * one has no trigger to find. Any other wording invented here would be a guess
 * standing in for the owner's, so the label goes through untouched.
 *
 * ⚠️ THIS FUNCTION IS DELIBERATELY THE IDENTITY. It exists as the ONE place the
 *    wording is edited — a prefix or suffix, if ever wanted, is added here and
 *    nowhere else, so nobody has to hunt through the webhook path for it. Do not
 *    decorate the string without being asked.
 * ⚠️ NO OTHER PATH CHANGES. `openTicketBySystem` leaves the sentence to its caller
 *    ("The divider sentence. The caller owns the wording."), and each path builds
 *    its own: register scenario-A (`scenario-a.copy.ts:37`) and the money path
 *    (`ticket-divider.helper.ts:261` → "…เนื่องจาก…") still read byte for byte as
 *    they did.
 * ⚠️ NOTHING READS THIS STRING to make a decision — checked across BE, FE and the
 *    test suite: there are producers only, no parser. Changing the words is safe.
 *
 * @param pressed the label on the button the customer tapped. The two buttons stay
 *   distinguishable because their labels differ ("ติดต่อแอดมิน" vs
 *   "ติดต่อแอดมินปัญหาการถอน"), so an operator can tell a withdraw case — one that
 *   already cleared the withdraw notice screens — from a plain one without any
 *   invented explanation.
 */
export const contactAdminTicketDivider = (pressed: string): string => pressed;

/**
 * The flex `altText` — what LINE shows in the chat list and the push
 * notification, i.e. what a customer reads on a LOCKED SCREEN with no card body.
 *
 * OWNER-DECIDED 2026-08-08: clarity over branding. It must say what happened on
 * its own, because at that moment there is no card to read.
 * WHEN SEEN: on every FLEX reply — `no_match_retry` and `review`. Plain-text
 * states never use it.
 * NOT config-overridable — one line, same for every tool.
 *
 * [EDIT-20260817-ALTTEXT] Owner changed the wording on 2026-08-17:
 * 'แจ้งผลการเติมเงิน' → 'ผลการตรวจสอบจากข้อมูลที่ได้รับ'.
 * Neutral phrasing — reports a CHECK RESULT based on the data received, rather
 * than implying a completed top-up. Value-only change: every consumer imports
 * this constant (no literal copies anywhere, FE included), and both unit specs
 * assert through the symbol, so nothing else moves.
 * revert: restore the previous literal above.
 */
export const MINT_FLEX_ALT_TEXT = 'ผลการตรวจสอบจากข้อมูลที่ได้รับ';
