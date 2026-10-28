// [REFACTOR-20260808-TYPESPLIT] Hook / OA (channel) domain — the biggest surface.
// Cross-module type refs are `import type` so nothing is emitted at runtime.
import type { Pagination } from './common';

export interface HookData {
  _id: string;
  channel_type?: string; // plan peppy A1.5 — "line" | "facebook" | ...; drives dynamic UI labels
  line_oa_name: string;
  alias: string;
  company_name: string;
  // The API field is `group`; `group_id` is only ever set by request payloads
  // the form builds, never by a response.
  group?: string | null;
  group_id?: string | null;
  description: string;
  doc_id?: string;
  custom_ai_key?: string;
  /** [FEAT-20260904-VENDORSECCOL] DeepSeek's key. `_sec` = the SECOND vendor's
   *  slot, not "secret" — both are secrets. Gemini keeps `custom_ai_key`. */
  custom_ai_key_sec?: string;
  telegram_key?: string | null;
  telegram_chat_id?: string | null;
  telegram_noti_type?: "all" | "text" | "image" | null;
  tag: string[];
  suggestion_text?: string;
  /* [REFACTOR-20260803-DOCBLOCK] Training Doc แยก 3 กล่อง 3 field
     หน้า list ต้องรู้จักด้วย เพราะเส้น toggle fast mode แนบกลับไปทั้งชุด */
  suggestion_company_text?: string;
  suggestion_text_no_profile?: string;
  default_answer_text?: string;
  /* [FEAT-20260823-GENERRFALLBACK] the OA's dedicated AI-outage line — wins
     over default_answer_text when the model call itself fails. */
  ai_generative_error_text?: string;
  missing_api_data_text?: string;
  // [FEAT-20260806-STATUSOFF] reply behavior when the OA is off (status===0) · optional · default=legacy
  status_off_action?: '' | 'reply' | 'silent';
  status_off_text?: string;
  image_answer_text?: string;
  line_url: string;
  webhook_url: string;
  status: number; // 1 = Active, 0 = Inactive
  fast_mode: number; // 1 = On, 0 = Off
  line_id?: string;
  line_secret?: string;
  line_key?: string;
  channel_id?: string; // plan peppy item 11 — the field HookFormModal now actually edits (line_id was write-only, never read anywhere)
  channel_secret?: string; // already the primary read for signature validation (line_secret is its deprecated fallback)
  access_token?: string; // already the primary read for the LINE API bearer token (line_key is its deprecated fallback)
  gemini_temperature?: number;
  gemini_top_k?: number;
  gemini_top_p?: number;
  gemini_thinking_budget?: number | null; // [FEAT-20260802-THINKHOOK] 0=ปิด · -1=dynamic · 1..24576=budget · null=ไม่ตั้ง
  // ==== [FIX-20260801-HOOKTYPES] ฟิลด์ที่ BE มีจริงแต่ type ไม่เคยประกาศ
  // ก่อนหน้านี้โปรเจกต์ไม่ได้ติดตั้ง @types/react → React.FC<Props> เป็น any
  // ทำให้ไม่มีใครฟ้องว่าอ่าน/เขียนฟิลด์ที่ type ไม่รู้จัก · พอติดตั้งแล้วโผล่มาทีเดียว 9 จุด
  // ⚠️ เป็นการ "ประกาศให้ตรงกับของจริง" เท่านั้น ไม่ได้เปลี่ยนพฤติกรรมสักบรรทัด
  //    (ตรวจกับ schema ฝั่ง BE: src/models/lineChatBotModel.js)
  ai_history_limit?: number | null;      // [FEAT-20260730-HISTLIMIT] 5-30 · null = 5
  ai_need_detail_limit?: number | null;  // [FEAT-20260801-NEEDDETAIL] 0 หรือ 5-30 · null = 10
  ai_raw_json_analysis?: boolean;        // [FEAT-20260731-RAWJSON] ส่ง JSON ดิบเข้า AI ไหม
  ai_raw_site_rules?: boolean;           // [FEAT-20260802-RAWSITERULES] ส่ง site rules เข้า AI (แยก) ไหม
  // [FEAT-20260810-DOCRETRIEVAL] false/absent = send the whole document (today's
  // behaviour); true = retrieve the matching passage first. Absent on every hook
  // that predates the feature, which is why it is optional here — seamless.
  doc_retrieval?: boolean;
  // [FEAT-20261026-RAGENGINE] the engine's per-OA modes — null/absent = the BE code default
  // (add + bm25), which is every hook that predates them. Values = BE RAG_*_MODES.
  rag_prompt_mode?: 'add' | 'replace' | null;
  rag_search_mode?: 'bm25' | 'hybrid' | null;
  // [FEAT-20260821-IGNOREABANDON] true = this OA never chases customers who
  // stop registering. Absent on every hook that predates the column, so it is
  // optional here and BE reads it as `=== true` — seamless.
  ignore_abandon_assist?: boolean;
  /** [P2-20260813] per-hook AI vendor; null = the default vendor. */
  ai_vendor?: 'gemini' | 'deepseek' | null;
  /**
   * [FEAT-20260909-VENDORTRANSLATE] Which vendor answers TRANSLATION for this OA.
   *
   * 🔴 null / absent does NOT mean "the system default vendor" — it means FOLLOW
   *    `ai_vendor`. Every hook written before this column reads as null, so
   *    translation keeps using whatever the OA already answers with: today's
   *    behaviour, unchanged. It is a second CHOICE, not a second default.
   * ⚠️ The type is TAKEN FROM `ai_vendor` instead of being written out again.
   *    The BE runs both columns through one `parseAiVendor`, so the two unions
   *    can never legitimately differ — and a copy would let a third vendor be
   *    added to one line and forgotten on the other with tsc none the wiser.
   *    (`aiVendorSingleTruth.value.test.ts` reads the `ai_vendor?:` line above
   *    as the FE's type truth; this line deliberately adds no second list.)
   */
  ai_vendor_translate?: HookData['ai_vendor'];
  /**
   * [FEAT-20260909-DSREASONING] The reasoning knobs, per vendor per lane.
   *
   * 🔴 `null` / absent means SAY NOTHING TO THE VENDOR — it is a third state,
   *    not a synonym for "off". `deepseek_thinking: 'disabled'` is an
   *    instruction to stop thinking; an absent column leaves the vendor's own
   *    default in force, which is what every hook written before today does.
   *    The form's first option is therefore "not set", and it writes null.
   *
   * ⚠️ `gemini_thinking_budget` (no suffix) is the MAIN lane's and predates all
   *    of this — it is declared further down and is untouched. Only its
   *    `_translate` twin is new.
   */
  deepseek_thinking?: 'enabled' | 'disabled' | null;
  deepseek_reasoning_effort?: 'low' | 'medium' | 'high' | 'max' | null;
  deepseek_thinking_translate?: HookData['deepseek_thinking'];
  deepseek_reasoning_effort_translate?: HookData['deepseek_reasoning_effort'];
  gemini_thinking_budget_translate?: number | null;
  /** [FEAT-20260918-HOOKTRANS] Default chat translation language for this OA. null = not set / default. */
  translate_lang?: string | null;
  /** [FEAT-20260918-HOOKTRANS] Whether automatic chat translation is enabled for this OA. */
  auto_translate?: boolean;
  /** [P2-20260813] per-hook model id; null = that vendor's family default. */
  ai_model?: string | null;
  /** [FEAT-20260904-VENDORSECCOL] DeepSeek's model id; null = the family
   *  default, which is `deepseek-v4-flash` since [FIX-20260909-DSMODELID]. */
  ai_model_sec?: string | null;
  domain_name?: string | null;           // [FEAT-20260802-DOMAINNAME] ชื่อเว็บ/โดเมนของ OA (optional)
  ai_raw_json_rules?: string;            // [FEAT-20260731-RAWJSONRULES] กติกาที่แอดมินเขียน
  ai_site_rules_guide?: string;          // [FEAT-20260804-SITERULESGUIDE] กติกาของก้อน site rules (ว่างได้)
  auto_unassist_minutes?: number;
  // [FEAT-20260801-HELPERTEXT] ข้อความคู่กับ quick reply ของ tag [[[customer-helper]]]
  customer_helper_text?: string;
  answer_link?: string;
  slip_verify_key?: string;
  /* [FEAT-20260903-HOOKSLIPPROV] Which slip provider verifies THIS OA's slips.
     It lives on the hook, not on the payment custom tool: the payment tool is
     unreachable while payment is switched off, and slip verification still runs
     for a payment-off hook — which is most of them. Optional because every hook
     written before this column simply has none, and '' / absent both mean "keep
     using the provider the system is set to right now" = today's behaviour.
     Plain text, NOT a credential — it is deliberately absent from secretMask /
     secretLock, so it renders and round-trips like any ordinary box. */
  slip_provider?: string;
  /** [FEAT-20260903-VENDORBRANCH] the OA's sub-account at its provider. `''` for
   *  providers that put no account in their endpoint. */
  slip_verify_branch?: string;
  /** [FEAT-20260903-HOSTPERHOOK] host ของ provider เฉพาะ hook นี้
   *  '' / ไม่ใส่ = ใช้ host ของ provider เอง (ค่าเดิมของทุก hook)
   *  BE รับเฉพาะ http(s):// — ค่าอื่นตกกลับไปใช้ของ provider ไม่ยิงตามที่พิมพ์ */
  slip_check?: boolean;
  /* [FEAT-20260822-QRPRESCANFE] jsQR prescan: does this OA look for a QR in an
     inbound image before spending a slip-verification call? Optional because an
     OA written before the column existed simply has none — and the runtime reads
     that absence as 'off' (`qr-prescan/index.ts` resolveQrPrescanMode), which is
     also what the form shows. ไม่มีค่า = ระบบอ่านเป็น 'off'. */
  qr_prescan_mode?: 'off' | 'log' | 'skip';
  // [FEAT-20260809-SLIPREQPROF] skip slip verification when the profile lookup gives an
  // explicit "no such customer" answer — no billed call, no slip record, no card.
  // ⚠️ NOT "block slips whenever the lookup fails": outage / timeout / breaker / 401 /
  // misconfig all FAIL OPEN and verify as normal. ปิดอยู่ = ทำงานเหมือนเดิมทุกอย่าง
  slip_require_profile?: boolean;
  // '' = BE ใช้ข้อความไทยกลางของตัวเอง (อย่าเขียนค่า default ลง DB)
  slip_require_profile_text?: string;
  match_account?: boolean;
  match_account_number?: string;
  // [FEAT-20260806-BULKSETTING] per-hook on/off flags surfaced for the bulk-method toggle
  customer_link_enabled?: boolean;
  custom_tool_status?: boolean;
  // [FEAT-20260808-PAYCUSTOOL] binding for the payment-category custom tool.
  // Lives on the hook (not the tool) because it is switched per OA.
  // ปิด/ไม่เลือก = สลิปทำงานแบบเดิมทุกอย่าง เหมือนตอนยังไม่มีฟีเจอร์นี้
  payment_tool_status?: boolean;
  payment_tool_id?: string | null;
  // [FEAT-20260809-WALLETPAYTOOL] optional second binding: the walletpay leg often lives on a
  // different host than topup, and one tool carries only one base_url.
  // Both are required for it to take effect — status === true AND a non-null id.
  // Either one missing = walletpay stays on the payment tool's own pay_walletpay endpoint,
  // so ไม่ตั้ง = ทำงานเหมือนเดิมทุกอย่าง ไม่ต้อง migrate
  walletpay_tool_status?: boolean;
  walletpay_tool_id?: string | null;
  // [FEAT-20260801-FLEXPROFILE] flex ที่ใช้ตอบ tag [[[flex_profile]]] · null = ไม่ใช้
  flex_profile_id?: string | null;
  /** [FEAT-20260810-CUSHELPERTYPE] การ์ด customer-helper · null = ใช้การ์ดสำรองฝั่ง BE */
  flex_customerhelper_id?: string | null;
  // [FEAT-20260802-FLEXCUSTOMLIST] flex ประเภท custom ที่ผูกไว้กับ OA นี้ · [] = ไม่เลือก
  flex_custom_ids?: string[];
  flex_profile_custom_ids?: string[];
  flex_success?: string | null;
  flex_fail?: string | null;
  flex_other?: string | null;
  flex_duplicate?: string | null;
  flex_not_found?: string | null;
  flex_min_amount?: string | null;
  flex_max_amount?: string | null;
  flex_error?: string | null;
  flex_success_not_match?: string | null;
  flex_out_of_time?: string | null;
  slip_check_min_amount?: number | null;
  slip_check_max_amount?: number | null;
  slip_check_out_of_time?: number | null;
  qr_code_fail_anwser_text?: string | null;
  callback_slip?: string[];
  callback_token?: string;
  callback_action?: "all" | "success" | "none";
  external_api_url?: string;
  external_user?: string;
  external_password?: string;
  external_endpoints?: Record<string, {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    request_type?: 'json' | 'form';
    sub_type?: string;
    require_jwt: boolean;


    is_login?: boolean;
    payload?: Record<string, any>;

  }>;
  created_at: string;
  updated_at: string;
  chat_bot_id?: string;
  __v?: number;
}

export interface ApiResponse {
  data: HookData[];
  pagination: Pagination;
}

export interface HookFormData {
  channel_type?: string; // plan peppy A1.5
  line_oa_name: string;
  alias: string;
  company_name: string;
  group_id: string;
  force_grant?: boolean;
  description: string;
  doc_id?: string;
  custom_ai_key?: string;
  /** [FEAT-20260904-VENDORSECCOL] DeepSeek's key. `_sec` = the SECOND vendor's
   *  slot, not "secret" — both are secrets. Gemini keeps `custom_ai_key`. */
  custom_ai_key_sec?: string;
  telegram_key?: string | null;
  telegram_chat_id?: string | null;
  telegram_noti_type?: "all" | "text" | "image" | null;
  tag: string[];
  line_url: string;
  webhook_url: string;
  suggestion_text?: string;
  /* [REFACTOR-20260803-DOCBLOCK] 1 กล่อง = 1 field · เก็บเนื้อล้วนไม่มี tag
     BE ห่อ [START_OF_*]/[END_OF_*] ให้ตอนส่ง Gemini */
  suggestion_company_text?: string;
  suggestion_text_no_profile?: string;
  default_answer_text?: string;
  /* [FEAT-20260823-GENERRFALLBACK] the OA's dedicated AI-outage line — wins
     over default_answer_text when the model call itself fails. */
  ai_generative_error_text?: string;
  missing_api_data_text?: string;
  // [FEAT-20260806-STATUSOFF] reply behavior when the OA is off (status===0) · optional · default=legacy
  status_off_action?: '' | 'reply' | 'silent';
  status_off_text?: string;
  image_answer_text?: string;
  status: number;
  fast_mode: number;
  channel_id: string; // plan peppy item 11 — rebound from the dead line_id (form used to edit a field nothing ever read)
  channel_secret: string; // rebound from the deprecated line_secret fallback
  access_token: string; // rebound from the deprecated line_key fallback
  gemini_temperature?: number;
  gemini_top_k?: number;
  gemini_top_p?: number;
  gemini_thinking_budget?: number | null; // [FEAT-20260802-THINKHOOK] 0=ปิด · -1=dynamic · 1..24576=budget · null=ไม่ตั้ง
  // ==== [FIX-20260801-HOOKTYPES] ฟิลด์ที่ BE มีจริงแต่ type ไม่เคยประกาศ
  // ก่อนหน้านี้โปรเจกต์ไม่ได้ติดตั้ง @types/react → React.FC<Props> เป็น any
  // ทำให้ไม่มีใครฟ้องว่าอ่าน/เขียนฟิลด์ที่ type ไม่รู้จัก · พอติดตั้งแล้วโผล่มาทีเดียว 9 จุด
  // ⚠️ เป็นการ "ประกาศให้ตรงกับของจริง" เท่านั้น ไม่ได้เปลี่ยนพฤติกรรมสักบรรทัด
  //    (ตรวจกับ schema ฝั่ง BE: src/models/lineChatBotModel.js)
  ai_history_limit?: number | null;      // [FEAT-20260730-HISTLIMIT] 5-30 · null = 5
  ai_need_detail_limit?: number | null;  // [FEAT-20260801-NEEDDETAIL] 0 หรือ 5-30 · null = 10
  ai_raw_json_analysis?: boolean;        // [FEAT-20260731-RAWJSON] ส่ง JSON ดิบเข้า AI ไหม
  ai_raw_site_rules?: boolean;           // [FEAT-20260802-RAWSITERULES] ส่ง site rules เข้า AI (แยก) ไหม
  // [FEAT-20260810-DOCRETRIEVAL] false/absent = send the whole document (today's
  // behaviour); true = retrieve the matching passage first. Absent on every hook
  // that predates the feature, which is why it is optional here — seamless.
  doc_retrieval?: boolean;
  // [FEAT-20261026-RAGENGINE] the engine's per-OA modes — null/absent = the BE code default
  // (add + bm25), which is every hook that predates them. Values = BE RAG_*_MODES.
  rag_prompt_mode?: 'add' | 'replace' | null;
  rag_search_mode?: 'bm25' | 'hybrid' | null;
  // [FEAT-20260821-IGNOREABANDON] true = this OA never chases customers who
  // stop registering. Absent on every hook that predates the column, so it is
  // optional here and BE reads it as `=== true` — seamless.
  ignore_abandon_assist?: boolean;
  /** [P2-20260813] per-hook AI vendor; null = the default vendor. */
  ai_vendor?: 'gemini' | 'deepseek' | null;
  /** [P2-20260813] per-hook model id; null = that vendor's family default. */
  ai_model?: string | null;
  /** [FEAT-20260904-VENDORSECCOL] DeepSeek's model id; null = the family
   *  default, which is `deepseek-v4-flash` since [FIX-20260909-DSMODELID]. */
  ai_model_sec?: string | null;
  /**
   * [FEAT-20260909-VENDORTRANSLATE / DSREASONING] the six columns added 09/09.
   *
   * ⚠️ DECLARED ON `HookFormData` AS WELL AS `HookData`, AND THE COMPILER IS
   *    WHY. The form's label and tab registries are typed
   *    `Partial<Record<keyof HookFormData, string>>`, so a field the form can
   *    write but this interface does not name is a compile error rather than a
   *    field that quietly renders its raw key in an error alert. Adding them to
   *    `HookData` alone left exactly that gap, and tsc named both lines.
   *
   * 🔴 Each is a THIRD state: null means "follow the main vendor" for the
   *    translate lane and "say nothing" for the reasoning knobs — never "off".
   */
  ai_vendor_translate?: HookFormData['ai_vendor'];
  deepseek_thinking?: 'enabled' | 'disabled' | null;
  deepseek_reasoning_effort?: 'low' | 'medium' | 'high' | 'max' | null;
  deepseek_thinking_translate?: HookFormData['deepseek_thinking'];
  deepseek_reasoning_effort_translate?: HookFormData['deepseek_reasoning_effort'];
  /** ⚠️ null, not 0 — unlike `gemini_thinking_budget`. See `AiReasoningFields`. */
  gemini_thinking_budget_translate?: number | null;
  /** [FEAT-20260918-HOOKTRANS] Default chat translation language for this OA. null = not set / default. */
  translate_lang?: string | null;
  /** [FEAT-20260918-HOOKTRANS] Whether automatic chat translation is enabled for this OA. */
  auto_translate?: boolean;
  domain_name?: string | null;           // [FEAT-20260802-DOMAINNAME] ชื่อเว็บ/โดเมนของ OA (optional)
  ai_raw_json_rules?: string;            // [FEAT-20260731-RAWJSONRULES] กติกาที่แอดมินเขียน
  ai_site_rules_guide?: string;          // [FEAT-20260804-SITERULESGUIDE] กติกาของก้อน site rules (ว่างได้)
  auto_unassist_minutes?: number;
  // [FEAT-20260801-HELPERTEXT] ข้อความคู่กับ quick reply ของ tag [[[customer-helper]]]
  customer_helper_text?: string;
  answer_link?: string;
  slip_verify_key?: string;
  /* [FEAT-20260903-HOOKSLIPPROV] Which slip provider verifies THIS OA's slips.
     It lives on the hook, not on the payment custom tool: the payment tool is
     unreachable while payment is switched off, and slip verification still runs
     for a payment-off hook — which is most of them. Optional because every hook
     written before this column simply has none, and '' / absent both mean "keep
     using the provider the system is set to right now" = today's behaviour.
     Plain text, NOT a credential — it is deliberately absent from secretMask /
     secretLock, so it renders and round-trips like any ordinary box. */
  slip_provider?: string;
  /** [FEAT-20260903-VENDORBRANCH] the OA's sub-account at its provider. `''` for
   *  providers that put no account in their endpoint. */
  slip_verify_branch?: string;
  /** [FEAT-20260903-HOSTPERHOOK] host ของ provider เฉพาะ hook นี้
   *  '' / ไม่ใส่ = ใช้ host ของ provider เอง (ค่าเดิมของทุก hook)
   *  BE รับเฉพาะ http(s):// — ค่าอื่นตกกลับไปใช้ของ provider ไม่ยิงตามที่พิมพ์ */
  slip_check?: boolean;
  /* [FEAT-20260822-QRPRESCANFE] jsQR prescan: does this OA look for a QR in an
     inbound image before spending a slip-verification call? Optional because an
     OA written before the column existed simply has none — and the runtime reads
     that absence as 'off' (`qr-prescan/index.ts` resolveQrPrescanMode), which is
     also what the form shows. ไม่มีค่า = ระบบอ่านเป็น 'off'. */
  qr_prescan_mode?: 'off' | 'log' | 'skip';
  // [FEAT-20260809-SLIPREQPROF] skip slip verification when the profile lookup gives an
  // explicit "no such customer" answer — no billed call, no slip record, no card.
  // ⚠️ NOT "block slips whenever the lookup fails": outage / timeout / breaker / 401 /
  // misconfig all FAIL OPEN and verify as normal. ปิดอยู่ = ทำงานเหมือนเดิมทุกอย่าง
  slip_require_profile?: boolean;
  // '' = BE ใช้ข้อความไทยกลางของตัวเอง (อย่าเขียนค่า default ลง DB)
  slip_require_profile_text?: string;
  match_account?: boolean;
  match_account_number?: string;
  // [FEAT-20260806-BULKSETTING] per-hook on/off flags surfaced for the bulk-method toggle
  customer_link_enabled?: boolean;
  custom_tool_status?: boolean;
  // [FEAT-20260808-PAYCUSTOOL] binding for the payment-category custom tool.
  // Lives on the hook (not the tool) because it is switched per OA.
  // ปิด/ไม่เลือก = สลิปทำงานแบบเดิมทุกอย่าง เหมือนตอนยังไม่มีฟีเจอร์นี้
  payment_tool_status?: boolean;
  payment_tool_id?: string | null;
  // [FEAT-20260809-WALLETPAYTOOL] optional second binding: the walletpay leg often lives on a
  // different host than topup, and one tool carries only one base_url.
  // Both are required for it to take effect — status === true AND a non-null id.
  // Either one missing = walletpay stays on the payment tool's own pay_walletpay endpoint,
  // so ไม่ตั้ง = ทำงานเหมือนเดิมทุกอย่าง ไม่ต้อง migrate
  walletpay_tool_status?: boolean;
  walletpay_tool_id?: string | null;
  // [FEAT-20260801-FLEXPROFILE] flex ที่ใช้ตอบ tag [[[flex_profile]]] · null = ไม่ใช้
  flex_profile_id?: string | null;
  /** [FEAT-20260810-CUSHELPERTYPE] การ์ด customer-helper · null = ใช้การ์ดสำรองฝั่ง BE */
  flex_customerhelper_id?: string | null;
  // [FEAT-20260802-FLEXCUSTOMLIST] flex ประเภท custom ที่ผูกไว้กับ OA นี้ · [] = ไม่เลือก
  flex_custom_ids?: string[];
  flex_profile_custom_ids?: string[];
  flex_success?: string | null;
  flex_fail?: string | null;
  flex_other?: string | null;
  flex_duplicate?: string | null;
  flex_not_found?: string | null;
  flex_min_amount?: string | null;
  flex_max_amount?: string | null;
  flex_error?: string | null;
  flex_success_not_match?: string | null;
  flex_out_of_time?: string | null;
  slip_check_min_amount?: number | null;
  slip_check_max_amount?: number | null;
  slip_check_out_of_time?: number | null;
  qr_code_fail_anwser_text?: string | null;
  callback_slip?: string[];
  callback_token?: string;
  callback_action?: "all" | "success" | "none";
  external_api_url?: string;
  external_user?: string;
  external_password?: string;
  external_endpoints?: Record<string, {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    request_type?: 'json' | 'form' | 'form-data';
    sub_type?: string;
    require_jwt: boolean;
    is_login?: boolean;
    payload?: any;
  }>;
  chat_bot_id?: string;
}

/**
 * [FEAT-20260815-LINEQUOTA] What `GET /hook/:id/quota` answers.
 *
 * Mirrors LINE's own two payloads, kept SEPARATE rather than flattened so the
 * shape stays recognisable against LINE's docs when this is next read:
 *   · quota       — `GET /v2/bot/message/quota`
 *   · consumption — `GET /v2/bot/message/quota/consumption`
 * The backend adds `remaining` because it already holds both halves
 * (BE: hooks.service.ts `getHookQuota`).
 *
 * ⚠️ `type: 'none'` = UNLIMITED. There is no `value` then, and `remaining` is
 *    null — the UI must say "unlimited", never 0.
 * ⚠️ Nothing here is a secret: no token, no channel id. That is deliberate —
 *    the access token never leaves the backend.
 */
export interface HookQuotaResponse {
  quota: { type: 'limited' | 'none'; value?: number };
  consumption: { totalUsage: number };
  /** limit − used, floored at 0; null when the plan is unlimited or unreadable. */
  remaining: number | null;
}

/**
 * [FEAT-20260917-INSIGHTFOLLOWERS] What `GET /hook/:id/insight/followers` answers.
 * Proxies LINE Messaging API's follower statistics (followers, targetedReaches, blocks).
 */
export interface HookFollowersResponse {
  status: 'ready' | 'unready' | 'unavailable' | string;
  followers: number | null;
  targetedReaches: number | null;
  blocks: number | null;
}

