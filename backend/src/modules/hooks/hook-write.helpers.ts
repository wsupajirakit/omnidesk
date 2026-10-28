/**
 * LIFTED — pending rewrite.
 *
 * Source: the module-level helpers of
 * legacy-api/src/controllers/hook/hookController.js (lines 53-724).
 *
 * These are the field normalisers every hook write path runs before touching
 * Mongo. They live in their own file rather than inside HooksService because
 * they are pure functions of a value — no models, no request, no user — which
 * makes them the one part of the write port that can be unit-tested directly.
 *
 * ⚠️ Each `throw` here reproduces a legacy message VERBATIM. The dashboard
 * renders `error` to the operator, and `diffContractValues` compares it by
 * value, so a reworded message is a failed parity run, not a nicer error.
 *
 * "Lifted" means the same logic expressed in typed code — there is no `any` and
 * no `@ts-ignore` here. TH comments are kept where legacy's own comment carried
 * the reason (ratio per R1).
 */

import { BadRequestException } from '@nestjs/common';

import { RAG_PROMPT_MODES, RAG_SEARCH_MODES } from '@/modules/rag';

/** A request body / hook document handled as an untyped bag of fields. */
export type FieldBag = Record<string, unknown>;

// hookController.js:36-38
const FAST_MODE_MIN = 0;
const FAST_MODE_MAX = 5;
/* [FEAT-20261016-DOC60K] owner 16/10: 60,000 for BOTH sites, one value ("60000 ทั้งสองใช้ค่าเดียวกัน")
   — legacy's 50,000 refused a loan doc of 50,183. Shared by create + edit, all three Training
   Document boxes. The dashboard already allows 100,000 (`services/hook/suggestionUtils.ts`). */
const SUGGESTION_TEXT_MAX_LENGTH = 60000;

/**
 * Flex card references validated as ObjectIds on every write.
 * The order decides which field name an error names first, so it is kept
 * identical to legacy (hookController.js:1242-1253).
 */
export const FLEX_FIELDS: readonly string[] = [
  'flex_success',
  'flex_fail',
  'flex_other',
  'flex_duplicate',
  'flex_not_found',
  'flex_min_amount',
  'flex_error',
  'flex_success_not_match',
  'flex_out_of_time',
  'flex_max_amount',
];

/** Whitelist for PATCH /hook/settings/bulk (hookController.js:2091). */
export const BULK_SETTING_FIELDS: readonly string[] = [
  'slip_check',
  'customer_link_enabled',
  'custom_tool_status',
];

/** Accepted values of `status_off_action` (hookController.js:1146). */
const STATUS_OFF_ACTIONS: readonly string[] = ['', 'reply', 'silent'];

/** Accepted values of `callback_action` (hookController.js:1221). */
const CALLBACK_ACTIONS: readonly string[] = ['all', 'none', 'success'];

/**
 * Block tags the Training Doc boxes must never store.
 *
 * The backend wraps each box at send time, so a tag living in the data would be
 * emitted twice — and it would break the "tag present == legacy row" test that
 * lets the migration be skipped. ผู้ใช้พิมพ์ tag เองในกล่อง = ถูกลบทิ้งเงียบ ๆ
 * โดยตั้งใจ (มันไม่ใช่เนื้อหา). Source: hookController.js:302-320.
 */
const DOC_BLOCK_TAGS: readonly string[] = [
  '[START_OF_BASIC_INFO]',
  '[END_OF_BASIC_INFO]',
  '[START_OF_COMPANY_INFO]',
  '[END_OF_COMPANY_INFO]',
  '[START_OF_NO_PROFILE_DATA]',
  '[END_OF_NO_PROFILE_DATA]',
];

/**
 * Phase A dual-write: keeps the channel-neutral hook fields in sync with their
 * legacy LINE-named counterparts on every create/update, so reads can be cut
 * over later with zero data gaps. Bidirectional — works whichever name the
 * caller sends. Source: hookController.js:53-66.
 */
export function mirrorHookChannelFields(obj: FieldBag): FieldBag {
  const pairs: [string, string][] = [
    ['line_oa_name', 'display_name'],
    ['line_url', 'oa_url'],
  ];
  for (const [oldName, newName] of pairs) {
    const hasOld = obj[oldName] !== undefined;
    const hasNew = obj[newName] !== undefined;
    if (hasOld && !hasNew) obj[newName] = obj[oldName];
    else if (hasNew && !hasOld) obj[oldName] = obj[newName];
  }
  return obj;
}

/**
 * Drops the "keep the stored value" sentinel before it can overwrite a secret.
 *
 * The detail endpoint returns `__SECRET_KEPT__` in place of every configured
 * secret; the form posts it straight back. Encrypting the sentinel would
 * replace a real key with the literal string. Source: hookController.js:110-115.
 */
export function stripKeptSecrets(
  body: FieldBag,
  sensitiveFields: readonly string[],
  mask: string,
): void {
  for (const field of sensitiveFields) {
    if (body[field] === mask) delete body[field];
  }
}

/**
 * [FIX-20260817-MANGLEDMASK] Names every sensitive field whose submitted value
 * looks like a HAND-EDITED copy of the sentinel above.
 *
 * WHY: the strip is an exact match, so `__SECRET_K` (a char deleted),
 * `__SECRET_KEPT__ ` (a space typed) or `__SECRET_KEPT__x` sailed past it and
 * were encrypted and WRITTEN over the real credential — proven live on 17/08,
 * where exactly this destroyed demo-oa-three's channel_secret + access_token
 * (recovered from the audit trail). No real credential looks like the
 * placeholder, so the only safe answer is a loud 400 from the caller.
 *
 * Matches: any value containing `SECRET_KEPT`, or any value that is a prefix
 * of the sentinel (that is what deleting characters from the end produces).
 * The exact sentinel never reaches this check — stripKeptSecrets runs first.
 * ค่าที่หน้าตาเหมือน placeholder = ของพัง ห้ามเขียนทับของจริง
 *
 * revert: delete this function and its two call sites in hooks.service.ts.
 */
export function findMangledSentinels(
  body: FieldBag,
  sensitiveFields: readonly string[],
  mask: string,
): string[] {
  const out: string[] = [];
  for (const field of sensitiveFields) {
    const value = body[field];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.includes('SECRET_KEPT') || mask.startsWith(trimmed)) {
      out.push(field);
    }
  }
  return out;
}

/** `true` / `"true"` only — every other value is off. */
export function isTrueFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Legacy's `String(value)`, including the `"[object Object]"` it produces for a
 * non-primitive.
 *
 * That output is not a defect to fix in passing: an operator who posts an
 * object into a text field gets that literal stored today, and both backends
 * must agree on it or the value diff fails. Encapsulated here so the
 * `no-base-to-string` exemption is written down once, with its reason, instead
 * of being sprinkled over twenty call sites.
 */
export function legacyString(value: unknown): string {
  return String(value);
}

function stripDocBlockTags(text: string): string {
  let out = text;
  for (const tag of DOC_BLOCK_TAGS) out = out.split(tag).join('');
  // ยุบบรรทัดว่างที่เหลือจากการลบ tag — ไม่ทำ = save ซ้ำแล้วบรรทัดว่างสะสมไปเรื่อย ๆ
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

/** One normaliser for every Training Doc box (hookController.js:322-339). */
export function normalizeSuggestionField(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value === 'string' ? value : legacyString(value);
  const trimmed = stripDocBlockTags(raw).trim();
  if (trimmed.length > SUGGESTION_TEXT_MAX_LENGTH) {
    throw new BadRequestException(
      `${fieldName} must be ${SUGGESTION_TEXT_MAX_LENGTH} characters or less`,
    );
  }
  return trimmed;
}

export function parseFastModeInput(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const asNumber = Number(value);
  if (
    !Number.isInteger(asNumber) ||
    asNumber < FAST_MODE_MIN ||
    asNumber > FAST_MODE_MAX
  ) {
    throw new BadRequestException(
      `fast_mode must be an integer between ${FAST_MODE_MIN} and ${FAST_MODE_MAX}`,
    );
  }
  return asNumber;
}

export function normalizeMissingApiDataText(
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed =
    typeof value === 'string' ? value.trim() : legacyString(value).trim();
  if (!trimmed) {
    throw new BadRequestException(
      'missing_api_data_text is required and cannot be empty',
    );
  }
  return trimmed;
}

export function parseGeminiTemperature(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || num > 1) {
    throw new BadRequestException(
      'gemini_temperature must be a number between 0.0 and 1.0',
    );
  }
  return num;
}

export function parseGeminiTopP(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || num > 1) {
    throw new BadRequestException(
      'gemini_top_p must be a number between 0.0 and 1.0',
    );
  }
  return num;
}

export function parseGeminiTopK(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) {
    throw new BadRequestException('gemini_top_k must be an integer >= 1');
  }
  return num;
}

/** -1 dynamic · 0 off · 1..24576 budget. null/"" clears (ragEngine then turns it off). */
export function parseGeminiThinkingBudget(
  value: unknown,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || !(num === -1 || (num >= 0 && num <= 24576))) {
    throw new BadRequestException(
      'gemini_thinking_budget must be -1 (dynamic), 0 (off), or 1..24576',
    );
  }
  return num;
}

/**
 * 5-30. ต่ำกว่า 5 ไม่รับ เพราะบริบทน้อยเกินจนบอทตอบไม่ต่อเนื่อง.
 * null/"" clears the value back to the webhook default.
 */
export function parseAiHistoryLimit(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 5 || num > 30) {
    throw new BadRequestException(
      'ai_history_limit must be an integer between 5 and 30',
    );
  }
  return num;
}

/**
 * 0 or 5-30. 0 is not "off" — it means "use the customer's latest message
 * instead of calling the AI". 1-4 ไม่รับ (บริบทน้อยเกินจนสรุปไม่ได้ความ) —
 * เว้นช่วงไว้ตั้งใจ ไม่ใช่บั๊ก.
 */
export function parseAiNeedDetailLimit(
  value: unknown,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = Number(value);
  const inRange = num === 0 || (num >= 5 && num <= 30);
  if (!Number.isInteger(num) || !inRange) {
    throw new BadRequestException(
      'ai_need_detail_limit must be 0 or an integer between 5 and 30',
    );
  }
  return num;
}

/**
 * Accepts the shapes an HTML form and a JSON client actually send: real
 * booleans, "true"/"false", and 1/0. Anything else is refused rather than
 * coerced — a silent truthy cast would turn the switch ON, the one direction a
 * mistake must never go. Empty/null = off, so the value can be cleared.
 */
function parseBooleanFlag(value: unknown, fieldName: string): boolean {
  if (value === null || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  throw new BadRequestException(`${fieldName} must be a boolean`);
}

export function parseAiRawJsonAnalysis(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return parseBooleanFlag(value, 'ai_raw_json_analysis');
}

export function parseAiRawSiteRules(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return parseBooleanFlag(value, 'ai_raw_site_rules');
}

/**
 * [FEAT-20260810-DOCRETRIEVAL] Per-OA Training-Document retrieval switch.
 *
 * Same shape as the sibling above so the write path treats it identically:
 * `undefined` leaves the stored value untouched, anything else is coerced by the
 * shared flag parser. Absent on an existing hook ⇒ the schema default `false`
 * ⇒ today's behaviour. ไม่ส่งมา = ไม่แตะของเดิม.
 */
export function parseDocRetrieval(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return parseBooleanFlag(value, 'doc_retrieval');
}

/**
 * [FEAT-20261026-RAGENGINE] One of the engine's allowed values, or null (= the code default).
 * Unknown strings are REFUSED rather than coerced — a typo must never land on a paid search.
 * ค่าที่ไม่รู้จัก = 400 · ว่าง/null = ใช้ค่าเริ่มต้น
 */
function parseOneOf(
  value: unknown,
  allowed: readonly string[],
  fieldName: string,
): string | null {
  if (value === null || value === '') return null;
  if (typeof value === 'string' && allowed.includes(value.trim()))
    return value.trim();
  throw new BadRequestException(
    `${fieldName} must be one of: ${allowed.join(', ')}`,
  );
}

export function parseRagPromptMode(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return parseOneOf(value, RAG_PROMPT_MODES, 'rag_prompt_mode');
}

export function parseRagSearchMode(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return parseOneOf(value, RAG_SEARCH_MODES, 'rag_search_mode');
}

/** [FEAT-20260830-STABLEPROMPT] `undefined` = field not mentioned ⇒ row keeps
 * what it has — same as every sibling.
 *
 * [FIX-20260830-STABLEPOLARITY] ⚠️ POLARITY IS INVERTED vs the siblings, on
 * purpose. Since the default flip, `false` is the per-OA EMERGENCY OPT-OUT —
 * the one direction a silent mistake must never go. parseBooleanFlag maps
 * null/'' to false ("cleared = off"), which for THIS flag would let a client
 * sending null/"" silently opt an OA out with a 200. So here cleared means
 * "back to the default" = true. Explicit opt-out requires a literal
 * false/'false'/0. revert: return parseBooleanFlag(...) for every value.
 * เคลียร์ค่า = กลับ default (เปิด) · ปิดต้องตั้งใจพิมพ์ false เท่านั้น. */
export function parseAiStablePrompt(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return true;
  return parseBooleanFlag(value, 'ai_stable_prompt');
}

/**
 * [FEAT-20260821-IGNOREABANDON] same contract as its siblings: `undefined`
 * means the caller did not mention the field, so the row keeps what it has.
 * `null` / `''` mean the operator cleared it ⇒ false. Anything else that is not
 * a recognised boolean is a 400 rather than a silent `false`.
 * revert: delete this function and its two call sites in `hooks.service.ts`.
 */
export function parseIgnoreAbandonAssist(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return parseBooleanFlag(value, 'ignore_abandon_assist');
}

function parseAiRulesText(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') {
    throw new BadRequestException(`${fieldName} must be a string`);
  }
  return value.trim();
}

export function parseAiRawJsonRules(value: unknown): string | undefined {
  return parseAiRulesText(value, 'ai_raw_json_rules');
}

export function parseAiSiteRulesGuide(value: unknown): string | undefined {
  return parseAiRulesText(value, 'ai_site_rules_guide');
}

/**
 * Switch on = rules required.
 *
 * Checked against the MERGED state, not the request body: an update can carry
 * either field on its own, so turning the switch on while rules already exist
 * is fine, and blanking the rules on a hook whose switch is already on is not.
 */
export function assertRawJsonRulesPresent(
  mergedEnabled: unknown,
  mergedRules: unknown,
): void {
  if (mergedEnabled !== true) return;
  if (legacyString(mergedRules ?? '').trim()) return;
  throw new BadRequestException(
    'ai_raw_json_rules is required when ai_raw_json_analysis is enabled',
  );
}

export function parseCallbackSlip(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((url) =>
        typeof url === 'string' ? url.trim() : legacyString(url).trim(),
      )
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

/** `null` / `""` / `0` / `"0"` all mean "no threshold", not zero. */
export function parseAmountOrNull(value: unknown): number | null {
  return value === '' || value === null || value === 0 || value === '0'
    ? null
    : Number(value);
}

/** Trims a string, stringifying anything else first (legacy's `String(v).trim()`). */
export function trimToString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : legacyString(value).trim();
}

/** Trims only real strings; other types pass through untouched. */
export function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Unknown action collapses to `""`, matching legacy's enum guard. */
export function normalizeStatusOffAction(value: unknown): string {
  return STATUS_OFF_ACTIONS.includes(value as string) ? (value as string) : '';
}

export function normalizeStatusOffText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Returns the normalised action, or `undefined` when it is not one of the three
 * known values — legacy then leaves the field untouched rather than rejecting.
 */
export function normalizeCallbackAction(value: unknown): string | undefined {
  const val = legacyString(value).trim().toLowerCase();
  return CALLBACK_ACTIONS.includes(val) ? val : undefined;
}

export function normalizeCallbackToken(value: unknown): string {
  return value === null || value === '' ? '' : legacyString(value).trim();
}

/** `status` must be exactly 0 or 1 — used by both status endpoints. */
export function parseStatusFlag(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || (normalized !== 0 && normalized !== 1)) {
    throw new BadRequestException('status must be 0 or 1');
  }
  return normalized;
}

/**
 * Masks a secret before it reaches the audit log.
 *
 * audit log อ่านได้จากหน้าเว็บ — เก็บค่าดิบ = key รั่วผ่านหน้าประวัติ. The log
 * still has to say a field CHANGED, so the marker is kept and only the value
 * goes. Source: hookController.js:3403-3414.
 */
export function maskForAudit(
  field: string,
  value: unknown,
  secretKeys: ReadonlySet<string>,
): unknown {
  if (!secretKeys.has(field)) return value;
  if (value === null || value === undefined || value === '') return '';
  // external_endpoints เป็น object — บอกแค่จำนวนรายการ ไม่โชว์ url/คีย์
  if (typeof value === 'object') {
    return `[${Object.keys(value).length} endpoint(s) — ซ่อนค่า]`;
  }
  return '********';
}
