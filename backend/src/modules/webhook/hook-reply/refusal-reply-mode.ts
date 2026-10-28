/**
 * [FIX-20260819-REFUSALMARKERMODE] the slip-refusal field opts in BY ITS MARKER
 * ===========================================================================
 * WHAT. Decides which `hook_text_reply_mode` the slip-refusal reply
 * (`slip_require_profile_text`) should be resolved and rendered with.
 *
 * WHY. Two facts collided in production on 19/08 and sent a customer literal
 * brackets after they uploaded a slip (seen twice, 09:14 and 09:31):
 *
 *   1. `hook_text_reply_mode` defaults to `'off'`, and `'off'` is contractually
 *      "same string in, same string out" — pinned by
 *      `helper-marker-leak.spec.ts:107` on the owner's own instruction
 *      ("ถอดได้ หยุดได้ สลับได้"). So a field holding `[[[customer-helper]]]`
 *      is sent verbatim. That contract is NOT changed here.
 *   2. **The dashboard has no control for that mode at all** — grep of the FE
 *      finds zero references to `hook_text_reply_mode`. An operator's only
 *      reachable way to ask for the register button is to type the marker into
 *      the Slip tab's "ข้อความตอบคนที่ยังไม่ผูกบัญชี" box.
 *
 * So on this ONE field the marker itself is the opt-in: typing it IS the
 * request. แอดมินตั้งโหมดจากหน้าเว็บไม่ได้ ⇒ ใส่ marker = ขอปุ่ม.
 *
 * THE RULE (and the reason each half exists):
 *   · no marker              → the hook's own mode, untouched. A plain-text
 *                              field behaves byte-identically to before.
 *   · a mode already chosen  → respected as-is. An operator who set 'strip' /
 *     (not 'off')             'button' / 'flex' keeps exactly what they chose.
 *   · marker + 'off'         → upgraded, because 'off' here can only mean
 *                              "never configured", never "deliberately off":
 *                              there is no UI to turn it off with.
 *       `[[[customer-helper]]]` → 'flex'  — the card carries the register
 *                                           button, which is what was asked for
 *
 * ⚠️ DELIBERATELY NARROW (owner, 19/08: *"จะเอาแค่ slip_require_profile_text =
 *    รองรับ flex mint ปุ่ม"*). ONLY the customer-helper marker upgrades. Any other
 *    marker — `[[[assist]]]` included — is left exactly as it behaves today,
 *    brackets and all, because widening it would change OAs that never asked.
 *    That remaining case is recorded, not fixed here. marker อื่นไม่แตะ.
 *
 * SCOPE. This function is used by the slip-refusal site ONLY. The three sibling
 * sites (`image_answer_text`, `missing_api_data_text` ×2) keep their plain
 * mode gate — changing them is a separate decision with a wider blast radius.
 *
 * revert: delete this file and pass `resolveHookTextReplyMode(hook)` directly at
 *         the refusal site, as it did before.
 */
import type { HookTextReplyMode } from './hook-text-reply';

/** The marker that asks for the customer-helper card. Same shape the resolver matches. */
const HELPER_MARKER = /\[\[\[customer-helper\]\]\]?/i;

export function resolveRefusalReplyMode(
  rawText: string | null | undefined,
  hookMode: HookTextReplyMode,
): HookTextReplyMode {
  // An explicit choice always wins — never override an operator.
  if (hookMode !== 'off') return hookMode;
  const raw = String(rawText ?? '');
  return HELPER_MARKER.test(raw) ? 'flex' : 'off';
}
