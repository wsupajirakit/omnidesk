/**
 * [FEAT-20260817-FORMDIFF] What the hook form is allowed to put on the wire.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `PUT /hook/:id` is a PARTIAL update: the API has a field whitelist and only
 * writes the members the body actually carries. The form, however, has always
 * posted its ENTIRE state — 83 fields — on every save, whether the operator
 * touched one box or none. That turns "rename an OA" into "overwrite the whole
 * document with whatever this browser tab happened to be holding", and it is
 * the root cause behind the credential wipe fixed on 17/08: a secret that never
 * loaded into the form was posted back as a blank and erased the stored value.
 *
 * The blank is now refused by the backend, so the credential case is safe. This
 * file closes the general case: build the payload exactly as before, then send
 * only the members whose value actually differs from what the form loaded.
 *
 * ฟอร์มเดิมส่งทุกช่องทุกครั้ง = กดเซฟชื่อ OA ก็ทับทั้งเอกสาร
 * ตอนนี้ส่งเฉพาะช่องที่ค่าต่างจากตอนโหลดจริง ๆ
 *
 * THE STANDARD THIS FOLLOWS (researched, not invented)
 * ----------------------------------------------------
 * RFC 7386 (JSON Merge Patch) — a member that is ABSENT from the patch leaves
 * the target untouched; `null` means "removal of existing values in the
 * target"; a member with a value means "the value is replaced". Omitting an
 * unchanged field is therefore the specified way to say "leave it alone", not
 * a trick. The sibling rule for secrets lives in `secretMask.ts`.
 *
 * TWO RULES THAT MUST NOT BE BROKEN
 * ---------------------------------
 * 1. The baseline is a snapshot of the POPULATED form, never of the raw API
 *    object. If the form never populated, current === baseline and the diff is
 *    EMPTY — so a form that failed to load can no longer overwrite anything.
 *    Diffing against the raw API object would do the opposite: everything would
 *    look changed and the whole document would be rewritten.
 * 2. Both sides go through `buildHookPayload`, so the diff compares NORMALISED
 *    values. Comparing raw form state instead would mark `'' → null` coercions
 *    and trimmed strings as edits on every single save.
 *
 * REVERT: hand `null` as the baseline to `diffHookPayload` and it returns the
 * full payload — i.e. exactly the pre-17/08 behaviour, with no other change.
 */
import { joinTrainingDoc, normalizeSuggestionText } from '../services/hook';
import { secretForSubmit } from './secretMask';

/** The three Training Doc boxes, as the form holds them. */
export interface TrainingDocBoxes {
  general: string;
  company: string;
  noProfile: string;
}

export type HookPayload = Record<string, any>;

/**
 * Builds the API payload from form state.
 *
 * Moved here VERBATIM from `HookFormModal.handleConfirmSubmit` so that the same
 * function can also be run over the baseline snapshot — the diff is only
 * trustworthy if both sides were normalised by identical code. Every coercion,
 * comment and key order below is as it was; nothing was "tidied" in the move.
 */
export function buildHookPayload(
  formData: any,
  boxes: TrainingDocBoxes,
  opts: { isCreate: boolean },
): HookPayload {
  const telegramKeyTrimmed = String(formData.telegram_key ?? '').trim();
  const telegramChatIdTrimmed = String(formData.telegram_chat_id ?? '').trim();

  /* [REFACTOR-20260803-DOCBLOCK] 1 กล่อง = 1 field ไม่ต่อสตริงอีกแล้ว
     BE เป็นคนห่อ [START_OF_*]/[END_OF_*] ตอนส่ง Gemini -> DB เก็บเนื้อล้วน */
  const docPayload = joinTrainingDoc(boxes);

  return {
    ...formData,
    ...docPayload,
    custom_ai_key: String(formData.custom_ai_key ?? '').trim(),
    /* [FEAT-20260904-VENDORSECCOL] the second vendor's key, trimmed exactly like
       the first. The rest of the payload arrives through the `...formData`
       spread above, so a new plain field needs no line here — a CREDENTIAL does,
       because a stray space in an API key fails at the vendor with an unhelpful
       401. คีย์ต้อง trim เหมือนกันทั้งสองค่าย */
    custom_ai_key_sec: String(formData.custom_ai_key_sec ?? '').trim(),
    // [FIX-20260817-BLANKSECRET] telegram_key is masked on read, so a blank
    // here is ambiguous (cleared? never loaded?) — omit it and let the API
    // keep what it has. telegram_chat_id below is NOT masked, so its blank
    // is real and still clears.
    telegram_key: secretForSubmit(telegramKeyTrimmed),
    telegram_chat_id: telegramChatIdTrimmed ? telegramChatIdTrimmed : null,
    group_id: formData.group_id,
    status: opts.isCreate ? 0 : formData.status,
    gemini_temperature: Number(formData.gemini_temperature ?? 0.5),
    gemini_top_k: Number(formData.gemini_top_k ?? 20),
    gemini_top_p: Number(formData.gemini_top_p ?? 0.9),
    // [FEAT-20260802-THINKHOOK] ส่งค่าที่ valid เท่านั้น: -1 / 0 / 1..24576 (clamp กันพัง)
    gemini_thinking_budget: (() => {
      const n = Math.floor(Number(formData.gemini_thinking_budget ?? 0));
      if (n === -1 || n === 0) return n;
      return Number.isFinite(n) ? Math.max(1, Math.min(24576, n)) : 0;
    })(),
    auto_unassist_minutes:
      formData.auto_unassist_minutes === null || formData.auto_unassist_minutes === ('' as any)
        ? null
        : Number(formData.auto_unassist_minutes),
    answer_link: String(formData.answer_link ?? '').trim(),
    // [FEAT-20260801-FLEXPROFILE] ค่าว่าง -> null (ไม่ใช่สตริงว่าง) ให้ตรงกับ schema
    flex_profile_id: formData.flex_profile_id || null,
    // [FEAT-20260810-CUSHELPERTYPE] ไม่เลือก = null = BE ใช้การ์ดสำรอง
    flex_customerhelper_id: formData.flex_customerhelper_id || null,
    /* [P2-20260813] safety net: '' must never reach the API — the BE would
       reject it as an unknown vendor. The spread already carries the value.

       [MERGE-20260817] This pair is p2-only: dev has no per-hook AI vendor, so
       `buildHookPayload` arrived here without it when the builder was lifted out
       of HookFormModal verbatim. Kept at the same position it held in the inline
       payload so the key order the diff walks is unchanged. */
    ai_vendor: formData.ai_vendor || null,
    ai_model: formData.ai_model || null,
    ai_model_sec: formData.ai_model_sec || null,
    // [FEAT-20260802-FLEXCUSTOMLIST] ส่งเป็น array เสมอ (ไม่เลือก = [] ไม่ใช่ null)
    flex_custom_ids: formData.flex_custom_ids || [],
    // [FEAT-20260802-FLEXPCTAG] ส่ง array เสมอ (ไม่เลือก = [])
    flex_profile_custom_ids: formData.flex_profile_custom_ids || [],
    // [FEAT-20260801-HELPERTEXT] trim แล้วส่งเสมอ · ว่าง = BE ใช้ข้อความกลาง
    customer_helper_text: String(formData.customer_helper_text ?? '').trim(),
    slip_verify_key: String(formData.slip_verify_key ?? '').trim(),
    // ==== [FEAT-20260809-SLIPREQPROF] ส่ง 2 key นี้เสมอ
    // `!!` = boolean แท้ (ปิดสวิตช์แล้วกดบันทึกต้องมีผลจริงที่ DB)
    // ข้อความ trim แล้วส่งเสมอ · ว่าง = '' = BE ใช้ข้อความไทยกลางของมันเอง
    // ⚠️ ห้ามเติมข้อความ default ลงไปแทน '' — ถ้าเขียนค่าจริงลง DB ทุก OA
    //    วันหลังแก้ข้อความกลางที่ BE จะไม่มีผลกับ OA ที่ถูกเขียนค่าไปแล้ว
    //    (บทเรียนเดียวกับ customer_helper_text ด้านบน)
    slip_require_profile: !!formData.slip_require_profile,
    slip_require_profile_text: String(formData.slip_require_profile_text ?? '').trim(),
    match_account: !!formData.match_account,
    slip_check_min_amount:
      formData.slip_check_min_amount === null || formData.slip_check_min_amount === ('' as any)
        ? null
        : Number(formData.slip_check_min_amount),
    slip_check_max_amount:
      formData.slip_check_max_amount === null || formData.slip_check_max_amount === ('' as any)
        ? null
        : Number(formData.slip_check_max_amount),
    slip_check_out_of_time:
      formData.slip_check_out_of_time === null || formData.slip_check_out_of_time === ('' as any)
        ? null
        : Number(formData.slip_check_out_of_time),
    callback_slip: (formData.callback_slip || []).filter((url: string) => url.trim() !== ''),
    // [FEAT-20260728-CUSTREG] field customer_link_* ไปกับ ...formData อยู่แล้ว
    // [FEAT-20260728-CUSTAPI] ไม่มี timeout ให้ normalize อีกแล้ว (ถอนช่องออก)
    // เหลือแค่บังคับ enabled เป็น boolean แท้ ๆ กัน checkbox ส่ง undefined
    customer_link_enabled: !!formData.customer_link_enabled,
    // [FEAT-20260729-CUSTOOL] ส่ง 2 key นี้เสมอ — '' ต้องเป็น null (BE เป็น ObjectId)
    custom_tool_status: !!formData.custom_tool_status,
    custom_tool_id: formData.custom_tool_id || null,
    // [FEAT-20260808-PAYCUSTOOL] ส่ง 2 key นี้เสมอ — '' ต้องเป็น null (BE เป็น ObjectId)
    // ส่งทุกครั้งแม้ปิดอยู่ เพื่อให้ "ปิดสวิตช์แล้วกดบันทึก" มีผลจริงที่ DB
    payment_tool_status: !!formData.payment_tool_status,
    payment_tool_id: formData.payment_tool_id || null,
    // [FEAT-20260809-WALLETPAYTOOL] `|| null` สำคัญ — ช่อง select ที่ไม่ได้เลือกให้ค่า ''
    // ซึ่งต้องกลายเป็น null ก่อนถึง BE (ObjectId ว่างไม่ใช่ค่าที่ resolve ได้)
    // `!!` ให้เป็น boolean แท้เสมอ — BE อ่านด้วย `=== true` ดังนั้น 'false'/1/undefined
    // ต้องไม่มีทางหลุดไปเป็นค่าที่เปิดสวิตช์เงินได้
    walletpay_tool_status: !!formData.walletpay_tool_status,
    walletpay_tool_id: formData.walletpay_tool_id || null,
    // [FEAT-20260918-HOOKTRANS] chat translation settings
    translate_lang: formData.translate_lang || null,
    auto_translate: !!formData.auto_translate,
    // [FEAT-20261026-RAGENGINE] '' / undefined → null = the BE engine's code default
    rag_prompt_mode: formData.rag_prompt_mode || null,
    rag_search_mode: formData.rag_search_mode || null,
  };
}

/**
 * Deep value equality for the shapes this payload holds.
 *
 * `!==` is not enough: `tag`, `callback_slip`, `flex_custom_ids` and
 * `payment_flex_ids` are rebuilt on every render, so an identity comparison
 * would report them as edited on every save and the diff would achieve nothing.
 * Two NaNs count as equal — `Number(undefined)` yields NaN on both sides of an
 * untouched numeric box, and that is not an edit either.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      sameValue((a as any)[k], (b as any)[k]),
  );
}

/**
 * Keeps only the members whose value differs from the baseline.
 *
 * - `baseline === null` ⇒ there is nothing to compare against (create, clone,
 *   or a form that never populated) and the FULL payload is returned.
 * - `requireBaseline` makes that case an ERROR instead. An EDIT must always
 *   have a baseline; if it does not, the form is holding blank defaults for a
 *   hook it never loaded, and sending them would overwrite a live document with
 *   emptiness. Refusing is the only safe answer — a save that cannot be trusted
 *   must not be silently attempted. แก้ไขโดยไม่มี baseline = ห้ามส่ง
 * - a member already `undefined` stays out, so `secretForSubmit`'s "omit this"
 *   decision is preserved rather than being re-read as a change.
 *
 * ผลลัพธ์ = เฉพาะช่องที่ต่างจริง · ช่องที่ไม่อยู่ในผล = API ไม่แตะของเดิม (RFC 7386)
 */
export function diffHookPayload(
  current: HookPayload,
  baseline: HookPayload | null,
  opts: { requireBaseline?: boolean } = {},
): HookPayload {
  if (!baseline) {
    if (opts.requireBaseline) {
      throw new Error('hook form: refusing to save an edit that never loaded');
    }
    return { ...current };
  }
  const out: HookPayload = {};
  for (const key of Object.keys(current)) {
    const value = current[key];
    if (value === undefined) continue;
    if (!sameValue(value, baseline[key])) out[key] = value;
  }
  return out;
}

/**
 * The last normalisation before the payload reaches `webhookService`.
 *
 * Both save screens (`WebhookList` as a modal, `HookFormPage` as a full page)
 * used to hold an identical copy of this block, and both copies re-asserted a
 * handful of members UNCONDITIONALLY. That was harmless while the form posted
 * every field, and became dangerous the moment it started posting only the
 * edited ones: `normalizeSuggestionText(undefined)` would resurrect an omitted
 * training document as `''` and write a blank over the stored text.
 *
 * So every rule here is guarded by "did the form actually send this member?".
 * ช่องไหนฟอร์มไม่ได้ส่งมา = อย่าไปสร้างมันขึ้นมาใหม่
 *
 * `telegram_key` additionally moves from `'' → null` to `'' → omitted`. On the
 * wire this changes nothing (`webhookService` already converted that null back
 * to an omission), but it removes a trap: the null was one refactor away from
 * reaching the API and clearing a key nobody touched.
 */
export function normalizeHookSubmission(
  data: HookPayload,
  opts: { isCreate: boolean },
): HookPayload {
  const sent = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined;

  const out: HookPayload = { ...data };

  if (sent('suggestion_text')) out.suggestion_text = normalizeSuggestionText(data.suggestion_text);
  if (sent('custom_ai_key')) out.custom_ai_key = String(data.custom_ai_key ?? '').trim();
  // [FEAT-20260904-VENDORSECCOL] same normalisation on the PUT diff path.
  if (sent('custom_ai_key_sec'))
    out.custom_ai_key_sec = String(data.custom_ai_key_sec ?? '').trim();
  if (sent('telegram_key')) out.telegram_key = secretForSubmit(data.telegram_key);
  if (sent('telegram_chat_id')) {
    const chatId = String(data.telegram_chat_id ?? '').trim();
    out.telegram_chat_id = chatId ? chatId : null;
  }
  // Create always stores a disabled hook; an edit keeps whatever the form sent.
  if (opts.isCreate) out.status = 0;

  // A member left `undefined` is an omission, not a value — drop it so nothing
  // downstream can mistake it for one.
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}
