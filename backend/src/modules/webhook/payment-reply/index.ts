/**
 * [FEAT-20260808-PAYTOOL-P3] Public surface of the payment-reply layer.
 *
 * 📍 [DOC-20260810-PAYSTATES] START HERE IF YOU ARE CHASING A CUSTOMER MESSAGE:
 * `docs/payment-states.md` maps every reply state — flex vs text, which file owns
 * the words, which `tool.payment.*` knob overrides it, and what each state means
 * for the slip lock. LOCAL ONLY, not pushed (`.gitignore:46` ignores `*.md`
 * repo-wide by policy). ตามหาข้อความที่ลูกค้าเห็น เริ่มที่ `docs/payment-states.md`.
 *
 * Everything the webhook needs to render + deliver a payment reply lives behind
 * this one import, so `webhook.service.ts` gains a seam, not a subsystem.
 * The delivery service (3b) is exported from here too once it lands.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ OPEN QUESTIONS — ASK THE OWNER BEFORE GO-LIVE
 * ════════════════════════════════════════════════════════════════════════════
 * `grep -rn "\[ASK-OWNER\]" src/modules/webhook/payment-reply src/modules/payment`
 * lists every decision the spec does NOT settle and that the code currently
 * runs on an ASSUMPTION for. None of them block development or tests — they are
 * chosen to be safe and reversible in one place — but each one is a customer- or
 * money-facing behaviour that must be CONFIRMED, not inherited by silence.
 * [[ask-dont-guess]]: เดาผิดบนเส้นทางเงิน = แก้ทีหลังแพง.
 *
 * ── STILL OPEN ──────────────────────────────────────────────────────────────
 *  (none blocking — but see PENDING IMPLEMENTATION below.)
 *
 * ── PENDING IMPLEMENTATION (answered, code not there yet) ───────────────────
 *  1. ✅ ANSWERED 2026-08-08 (1ans.md §3): `retry` is a SERVER-SIDE resume —
 *        กด [ลองใหม่] = ส่งภาพสลิปเดิม + statement ตัวถัดไป (x+1). The customer
 *        does not re-photograph anything.
 *        ⚠️ NOT IMPLEMENTABLE UNTIL PHASE 2c: needs a statement-level lock, a
 *        per-statement loop, and a run cursor to resume from — plus a postback
 *        handler, which this repo does not have. `buildAction` still renders the
 *        interim `cameraRoll`, which is WRONG per this answer and is tagged as
 *        such at the call site. Replace with a postback in 2c/3.
 *
 * ── ANSWERED 2026-08-08 (kept as a record; no longer blocking) ───────────────
 *  2. ✅ Button labels / altText: DECIDE NOW, optimise for clarity, and name the
 *        identifiers in ENGLISH matching the reply STATE so they are easy to
 *        find and edit. Every state is documented in code.
 *        → BUTTON_LABELS / MINT_FLEX_ALT_TEXT now live in
 *          payment/payment-reply-copy.ts ([FEAT-20260809-PAYTOOL-COPY] moved all
 *          customer-facing copy into one file); STATE_NOTES stays in the builder.
 *  3. ✅ Card design: design it now, keep it noted so it is easy to restyle.
 *        → MINT_COLORS + the bubble literal, each row commented. Styling stayed
 *          in the builder on purpose — the copy split moved WORDS only.
 *  4. ✅ Push fallback applies to EVERY state, not just `review`.
 *        → deliverPaymentReply: same kind, every state, reply → push.
 *  5. ✅ If reply AND push both fail (e.g. push quota exhausted): do NOT lose it
 *        — write a REVIEW log entry carrying a DISTINCT reason + detail text so
 *        an operator can tell "quota/delivery failure" apart from a business
 *        review. → DELIVERY_FAILED_REVIEW in payment-reply.delivery.ts.
 *  6. ✅ Suppression: while the payment tool is ON the customer sees ONLY the
 *        payment reply, never the slip detail card. → 3c `suppressSlipReply`.
 *  8. ✅ topup→walletpay field map: EMPTY IS CORRECT, not a missing config. walletpay
 *        takes only `refId` (from the member statement) + the slip image; it
 *        consumes nothing from the topup response. Operators do NOT need to
 *        fill `topup_to_walletpay_map` for go-live. → payment-runner `_walletpayBody`.
 *  9. ✅ External contracts confirmed 2026-08-09 (topup path/body/HMAC formula,
 *        walletpay host + payin path). Recorded on the runner's class doc. The HMAC
 *        implementation was verified against the stated formula:
 *        HMAC_SHA256(web_code + timestamp + canonical), sorted-key JSON, no
 *        escaping, file as `sha256:<hex>;filename:<name>` — matches
 *        validate-slip-signer.ts as built.
 *        ⚠️ Credentials stay in the tool record, never in this repo.
 *  7. ✅ Slip↔statement matching & where the lock lives (1ans.md §4):
 *        Matching a slip to the RIGHT statement is OUR job, so the SAME slip is
 *        deliberately allowed to pair with a NEW statement (x+1) on retry. The
 *        lock therefore belongs on the STATEMENT, not the slip — "this statement
 *        was credited" is what must never repeat. Duplicate slip IMAGES are
 *        guarded by Shop-API automatically (`duplicate`), NOT by us; adding our own
 *        image dedupe would block the legitimate retry.
 *        ⚠️ Accepted external dependency — verify Shop-API really returns
 *        `duplicate` before go-live (topup Shop-API is still on the "รอค่าจริง"
 *        list). → noted at payment-runner.service.ts `_walletpayBody`.
 *        ⚠️ Today's code still locks the SLIP; Phase 2c moves it.
 *
 * When one is answered: implement it, DELETE its [ASK-OWNER] block, move its
 * entry to ANSWERED with the date, and note the decision in check-list.md.
 * An empty [ASK-OWNER] grep = nothing pending.
 */
export {
  buildMintFlex,
  MINT_FLEX_ALT_TEXT,
  STATE_NOTES,
  type MintFlexContext,
} from './payment-mint-flex.builder';
export {
  handlePaymentPostback,
  buildRetryPostbackData,
  PAYMENT_POSTBACK_PREFIX,
  type PaymentPostbackEvent,
  type PaymentPostbackDeps,
  type PaymentResumeResult,
} from './payment-postback.handler';
/* [FEAT-20260810-PAYSTATEFLEX] `{{paylink.*}}` minting for a card an admin
 * authored, kept behind this barrel like the rest of the layer. */
export {
  mintPayLinks,
  type PayLinkContext,
  type MintPayLinksResult,
} from './payment-action-mint';
/* [FIX-20260817-RETRYRESUME] the result→reply→card bridge that carries `resume`.
 * Exported here so callers and tests reach it through the barrel like the rest. */
export {
  replyWithResume,
  resumeContext,
  type ResumeTarget,
  type ReplyWithResume,
} from './payment-reply-resume';
