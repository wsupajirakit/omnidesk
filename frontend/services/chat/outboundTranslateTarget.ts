/**
 * [FEAT-20260918-AUTOSENDCONFIRM] Which language a REPLY leaves in.
 * ============================================================================
 * The outbound half of the pair. Its inbound twin lives in the backend
 * (`omnidesk-api/src/modules/chat/translate/auto/should-auto-translate.ts`), and
 * the two answer DIFFERENT questions on purpose:
 *
 * | | inbound | outbound (this file) |
 * |---|---|---|
 * | who reads the result | the operator | the customer |
 * | target | always Thai | the customer's language |
 * | may it block? | no | yes — nothing can be sent until the text exists |
 * | on failure | keep the original, say nothing | send the original as typed |
 *
 * ## The order, and why a declaration outranks an observation
 *
 * 1. `translate_lang` on the room — what a person chose in the room modal's
 *    step 3, *"ระบุภาษาของลูกค้าในห้องนี้ เพื่อใช้แปลและตอบกลับ"*.
 * 2. `effective_translate_lang` — the backend's room-then-hook answer, for
 *    callers that only carry the resolved value.
 * 3. `hook_translate_lang` — the OA's default, for a room nobody set.
 * 4. `detected_source_lang` — what the model observed the customer writing.
 *    Last, because a guess must never outrank a decision.
 *
 * ## `null` means NOBODY KNOWS, and nothing is translated
 *
 * 🔴 There is deliberately NO final fallback language. The code this replaced
 * ended its chain with a literal `'en'`, which is a guess about a stranger:
 * being wrong sends a customer a reply in a language they cannot read, and a
 * sent LINE message cannot be recalled. Sending the draft exactly as typed is
 * the honest outcome, and the confirm dialog says so before the operator agrees.
 * ไม่รู้ภาษาลูกค้า = ส่งตามที่พิมพ์ ห้ามเดา
 *
 * Pure and exported so the whole cross — every declared language against every
 * switch state — can be driven without rendering a composer.
 *
 * revert: inline it back into `ChatInputBox.tsx` and delete this file.
 */

/** Only the fields this decision reads. Anything else is the caller's business. */
export interface OutboundTargetSource {
  translate_lang?: string | null;
  effective_translate_lang?: string | null;
  hook_translate_lang?: string | null;
  detected_source_lang?: string | null;
}

/**
 * @returns the language code a reply should be translated into, or `null` when
 * no source knows — in which case the caller must send the draft untranslated.
 */
export const outboundTargetLang = (
  room: OutboundTargetSource | null | undefined,
): string | null =>
  room?.translate_lang ||
  room?.effective_translate_lang ||
  room?.hook_translate_lang ||
  room?.detected_source_lang ||
  null;

/**
 * Should this send translate at all? Kept next to the target because the two
 * are read together at exactly one call site, and separating them invites a
 * caller that checks one and forgets the other.
 *
 * `auto_send_translated` is a plain boolean, not the tristate the inbound switch
 * uses: there is no hook-level "send translated" to inherit from.
 */
export const shouldAutoSendTranslated = (
  room: (OutboundTargetSource & { auto_send_translated?: boolean }) | null | undefined,
  opts: { mode: string; hasStagedTranslation: boolean; hasText: boolean },
): boolean =>
  opts.mode === 'reply' &&
  opts.hasText &&
  !opts.hasStagedTranslation &&
  Boolean(room?.auto_send_translated);
