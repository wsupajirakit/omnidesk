/**
 * [P2-20260813] Write-side validation for the per-hook AI vendor + model.
 *
 * Placement: `hooks/ai-vendor/` rather than `hook-write.helpers.ts`, which is
 * already 431 lines — over the repo's 400-line ceiling and NOT on the waiver
 * list, which may only shrink. A new role directory is the compliant home, and
 * the vendor/model pair is a role of its own: every future vendor edits here.
 * ไฟล์เดิมเต็มแล้ว ห้ามยัดเพิ่ม — แยกตาม role ตั้งแต่ไฟล์แรก.
 *
 * Style follows the existing `parseGemini*` helpers verbatim: `undefined` in
 * means "caller did not send this field" and is passed straight through, so an
 * update that omits the key never clears it.
 */

import { BadRequestException } from '@nestjs/common';

/**
 * Vendors the registry can actually resolve. Kept as data next to the parser so
 * a new vendor is one line here and one line in the transport registry — the
 * two lists are the only places a vendor name is written.
 */
export const AI_VENDORS = ['gemini', 'deepseek'] as const;
export type AiVendor = (typeof AI_VENDORS)[number];

/**
 * [FEAT-20260904-VENDORSECCOL] The two names as constants, so a write path can
 * say WHICH vendor a column belongs to without a bare string literal.
 *
 * ⚠️ WHY THEY ARE RE-DECLARED RATHER THAN IMPORTED. The mirror of these lives in
 * `webhook/ai-vendors/resolve-vendor-key.ts` (`VENDOR_GEMINI` / `VENDOR_DEEPSEEK`),
 * and `webhook` already imports `hooks` — importing back would close the cycle
 * `hooks.service.ts` documents as fatal at boot. Same reason, and the same
 * remedy, as the DeepSeek host string in `ai-key-probe.ts`: repeated with its
 * source named, and both copies pinned together by that file's spec.
 * ประกาศซ้ำเพราะ import กลับจะเกิดวงจร — ไม่ใช่เพราะลืม
 */
export const VENDOR_GEMINI: AiVendor = 'gemini';
export const VENDOR_DEEPSEEK: AiVendor = 'deepseek';

/**
 * `''` and `null` both mean "use the default vendor" and normalise to `null`,
 * matching how the schema stores an unset value.
 *
 * ⚠️ An unrecognised name is REJECTED here, at the write, even though the
 *    runtime registry would fall back to the default and answer normally. That
 *    asymmetry is deliberate: a typo saved silently reads as "switched" on the
 *    dashboard while the OA keeps using the old vendor, and nothing surfaces
 *    that. Refusing the write is the only place the operator can be told.
 *    พิมพ์ผิดต้องรู้ตอนเซฟ ไม่ใช่ไปเงียบตอนตอบลูกค้า.
 */
/**
 * [FEAT-20260909-VENDORTRANSLATE] `field` names the column in the error text.
 *
 * OPTIONAL, and its default is the literal this function has always thrown, so
 * every existing caller keeps producing a byte-identical message. It exists
 * because a second column now uses this same parser: an operator who mistypes
 * the TRANSLATE vendor must be told which of the two boxes is wrong, and a
 * message that always says `ai_vendor` would send them to fix the other one.
 */
export function parseAiVendor(
  value: unknown,
  field = 'ai_vendor',
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !AI_VENDORS.includes(value as AiVendor)) {
    throw new BadRequestException(
      `${field} must be one of: ${AI_VENDORS.join(', ')} (or empty for the default)`,
    );
  }
  return value;
}

/**
 * The model NAME for this hook — free text on purpose.
 *
 * ⚠️ No allow-list: vendors ship new model ids constantly, and a hardcoded list
 *    would make the dashboard reject a model that works. An unknown id fails at
 *    the vendor with its own error, which is the honest place for it. What we
 *    DO enforce is shape: a trimmed non-empty string, or null for "use the
 *    vendor's family default".
 */
export function parseAiModel(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException('ai_model must be a string');
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 100) {
    throw new BadRequestException('ai_model must be 100 characters or fewer');
  }
  return trimmed;
}

/**
 * [FEAT-20260909-DSREASONING] DeepSeek's reasoning switch.
 *
 * `''` and `null` both normalise to `null`, which the transport reads as
 * "say nothing to the vendor". That is NOT the same as `'disabled'`: one leaves
 * the vendor's own default in force, the other is an instruction. Collapsing
 * them would make an OA that never opened the box send a field it never chose.
 */
/**
 * ⚠️ `field` names the column in the error text, defaulting to the main lane's.
 *    Each knob now has TWO columns — one per lane — and a message that always
 *    said the main one would send an operator to fix the wrong box. Same shape,
 *    and same reason, as `parseAiVendor` above.
 */
export const DEEPSEEK_THINKING = ['enabled', 'disabled'] as const;

/* MEASURED 09/09, not assumed: an effort sent alongside `type: 'disabled'` is
   ACCEPTED (200, no error) and then IGNORED — the reply comes back with no
   `reasoning_content`. So the pair is storable and harmless, and neither the
   parser nor the resolver refuses it; the operator simply gets no thinking.
   ⚠️ If a UI ever wants to warn about that combination, this is the fact to
   quote, and it came from a real call rather than from the documentation,
   which does not mention the interaction at all. */

export function parseDeepSeekThinking(
  value: unknown,
  field = 'deepseek_thinking',
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    !DEEPSEEK_THINKING.includes(value as (typeof DEEPSEEK_THINKING)[number])
  ) {
    throw new BadRequestException(
      `${field} must be one of: ${DEEPSEEK_THINKING.join(', ')} (or empty to say nothing)`,
    );
  }
  return value;
}

/**
 * [FEAT-20260909-DSREASONING] How hard to think, when thinking.
 *
 * 🔴 FOUR VALUES, AND `'medium'` IS HERE BECAUSE A LIVE CALL PUT IT HERE — the
 *    vendor's documentation lists only low/high/max. It was fired on 09/09
 *    against `deepseek-v4-flash` with a real key and answered 200 with
 *    `reasoning_content` populated, exactly like the three documented ones.
 *
 *    This is the shape the earlier draft was built for: the list is a named
 *    constant precisely so that a probe result is one word, not a refactor. It
 *    shipped short and grew on evidence, which is the opposite of shipping long
 *    on a guess. อ่าน doc แล้วยังต้องยิงจริงยืนยัน — doc ไม่ครบก็มี.
 *
 * ⚠️ Rejected at the WRITE, like `ai_vendor` and for the same reason: a value
 *    saved silently reads as "set" on the dashboard while the vendor ignores it.
 */
export const DEEPSEEK_REASONING_EFFORT = [
  'low',
  'medium',
  'high',
  'max',
] as const;

export function parseDeepSeekReasoningEffort(
  value: unknown,
  field = 'deepseek_reasoning_effort',
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    !DEEPSEEK_REASONING_EFFORT.includes(
      value as (typeof DEEPSEEK_REASONING_EFFORT)[number],
    )
  ) {
    throw new BadRequestException(
      `${field} must be one of: ${DEEPSEEK_REASONING_EFFORT.join(', ')} (or empty for none)`,
    );
  }
  return value;
}
