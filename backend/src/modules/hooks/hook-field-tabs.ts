/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/config/hookFieldTabs.js
 *
 * The single registry of "which hook field belongs to which form tab". Three
 * consumers read it: the clone endpoint (which fields to copy), the clone modal
 * (tab list + field counts), and the hook form (which tab holds a failed
 * field). It lives on the backend on purpose — when the map lived only in the
 * frontend, adding a field and forgetting to register it made clone skip that
 * field silently, with no error.
 *
 * Not yet split because it is consumed by the clone write path that has not
 * been ported. Splitting is unblocked once GET /hook/field-tabs and
 * POST /hook/:id/clone are both golden-green, at which point the ordering
 * guarantees below can be verified rather than assumed.
 *
 * ⚠️ Key insertion order is load-bearing: `fieldsForTabs` iterates the object
 * and the resulting array order reaches the client in `field-tabs.fields[]`.
 * Reordering these declarations changes the response.
 */

export interface CloneableTab {
  key: string;
  label_th: string;
  label_en: string;
}

/**
 * Tabs a clone may target.
 *
 * "General" and "Channel connection" are excluded deliberately — those hold the
 * hook's identity (alias, OA name, channel secret). Overwriting them kills the
 * destination hook.
 */
export const CLONEABLE_TABS: readonly CloneableTab[] = [
  { key: 'ai', label_th: 'AI & Responses', label_en: 'AI & Responses' },
  { key: 'slip', label_th: 'Slip Verification', label_en: 'Slip Verification' },
  { key: 'notifications', label_th: 'การแจ้งเตือน', label_en: 'Notifications' },
  { key: 'external_api', label_th: 'External API', label_en: 'External API' },
  // [FEAT-20260822-NOTICEMODE] appended LAST so the four legacy tabs keep
  // their positions in the field-tabs response. revert: delete this line.
  { key: 'notice', label_th: 'เตือนระบบ (Notice)', label_en: 'System Notice' },
];

/**
 * field -> tab. Lifted wholesale from the legacy form component; the two must
 * agree exactly.
 *
 * Note the absence of `suggestion_type`: it was listed once but does not exist
 * in the schema, so it inflated the "number of fields" shown to the operator
 * while copying nothing.
 */
export const FIELD_TAB: Readonly<Record<string, string>> = {
  // ── AI & Responses ────────────────────────────────────────────────────
  suggestion_text: 'ai',
  suggestion_company_text: 'ai',
  suggestion_text_no_profile: 'ai',
  default_answer_text: 'ai',
  // [FIX-20260808-AIGENERROR] shown on the AI tab, next to default_answer_text.
  ai_generative_error_text: 'ai',
  missing_api_data_text: 'ai',
  // "OA is off" reply behaviour is a response setting, so it clones under AI.
  status_off_action: 'ai',
  status_off_text: 'ai',
  image_answer_text: 'ai',
  answer_link: 'ai',
  doc_id: 'ai',
  customer_helper_text: 'ai',
  flex_profile_id: 'ai',
  flex_custom_ids: 'ai',
  flex_profile_custom_ids: 'ai',
  gemini_temperature: 'ai',
  gemini_top_k: 'ai',
  gemini_top_p: 'ai',
  gemini_thinking_budget: 'ai',
  /* [P2-20260813] vendor + model live on the AI tab beside the knobs they
     shape. They are names, not credentials, so they stay in this map rather
     than the secrets one — see the clone loop, where copying ai_vendor drags
     custom_ai_key along, because a vendor without its key is an OA that
     answers nothing.
     ⚠️ Wording note: this comment deliberately avoids naming the secrets map,
     because `payment-flex-ids-persist.spec.ts` slices this file from the first
     occurrence of that identifier and asserts on what follows. Mentioning it
     up here moved that slice and turned an unrelated spec red. */
  ai_vendor: 'ai',
  ai_model: 'ai',
  /* [FEAT-20260904-VENDORSECCOL] the second vendor's MODEL sits here with the
     first one's — it is a name, not a credential. Its KEY (`custom_ai_key_sec`)
     is in the sensitive map below instead, exactly like `custom_ai_key`. */
  ai_model_sec: 'ai',
  /* [FEAT-20260909-VENDORTRANSLATE] which vendor answers TRANSLATION, chosen
     independently of the one above. A name, not a credential, so it belongs in
     this map. On the AI tab because the owner asked for it to be cloneable the
     ordinary way (09/09): chosen independently, and if it is ticked it travels,
     if it is not it stays behind.
     ⚠️ Placed BELOW the existing block on purpose — see the wording note above
     about a spec that slices this file by position. Adding this entry higher,
     or naming anything new above it, moves that slice. */
  ai_vendor_translate: 'ai',
  /* [FEAT-20260918-HOOKTRANS] chat translation settings */
  translate_lang: 'ai',
  auto_translate: 'ai',
  /* [FEAT-20261026-RAGENGINE] the retrieval switch and the engine's two modes, cloned with the
     AI tab like their siblings. `doc_retrieval` had been missing from this map since 10/08, so a
     clone silently dropped it — fixed here alongside the two new entries. */
  doc_retrieval: 'ai',
  rag_prompt_mode: 'ai',
  rag_search_mode: 'ai',
  /* [FEAT-20260909-DSREASONING] The reasoning knobs, five new entries. Settings,
     not credentials, so they belong in this map beside the Gemini knobs above.
     `gemini_thinking_budget` is NOT repeated here — it was registered long
     before this feature and listing it again would claim otherwise.
     Naming: no suffix = the main lane (reply + summary), `_translate` = the
     translate lane. See `hooks/ai-reasoning/reasoning-columns.ts`. */
  gemini_thinking_budget_translate: 'ai',
  deepseek_thinking: 'ai',
  deepseek_reasoning_effort: 'ai',
  deepseek_thinking_translate: 'ai',
  deepseek_reasoning_effort_translate: 'ai',
  ai_raw_json_analysis: 'ai',
  ai_raw_json_rules: 'ai',
  ai_raw_site_rules: 'ai',
  ai_site_rules_guide: 'ai',
  ai_history_limit: 'ai',
  ai_need_detail_limit: 'ai',
  /* [FEAT-20260821-IGNOREABANDON] on the AI tab because the owner asked for it
     to be CLONEABLE (20/08/2026: "ย้ายไปอยู่แท็บ ai จะได้ clone ได้"), and
     `CLONEABLE_TABS` above excludes General by design. ⚠️ `CLONEABLE_TABS` only
     says which tab may be TARGETED — this line is what makes the field travel.
     Without it a clone succeeds and copies nothing, with no error anywhere.
     revert: delete this line */
  ignore_abandon_assist: 'ai',
  // [FEAT-20260830-STABLEPROMPT] lives on the AI tab beside its siblings.
  ai_stable_prompt: 'ai',
  fast_mode: 'ai',

  // ── Slip Verification ─────────────────────────────────────────────────
  slip_check: 'slip',
  slip_require_profile: 'slip',
  slip_require_profile_text: 'slip',
  /* [FEAT-20260812-QRPRESCAN] revert: delete this line */
  qr_prescan_mode: 'slip',
  /* [FIX-20260812-HELPERMARKERLEAK] sits with missing_api_data_text on the AI tab.
     revert: delete this line */
  hook_text_reply_mode: 'ai',
  match_account: 'slip',
  match_account_number: 'slip',
  slip_check_min_amount: 'slip',
  slip_check_max_amount: 'slip',
  slip_check_out_of_time: 'slip',
  qr_code_fail_anwser_text: 'slip',
  callback_slip: 'slip',
  callback_token: 'slip',
  callback_action: 'slip',
  flex_success: 'slip',
  flex_fail: 'slip',
  flex_other: 'slip',
  flex_duplicate: 'slip',
  flex_not_found: 'slip',
  flex_min_amount: 'slip',
  flex_error: 'slip',
  flex_success_not_match: 'slip',
  flex_out_of_time: 'slip',
  /* [FEAT-20260810-PAYSTATEFLEX] the per-reply-state card map. Grouped with the
   * slip cards, not with the External API tab, because it IS card bindings —
   * `flex_type: 'slip'` ids, the same nature as the entries above — and not part
   * of the payment TOOL binding whose money risk that tab documents. Cloning it
   * copies which card answers which state; the cards themselves are global, so a
   * target hook can resolve the same ids. Omit it and clone silently leaves the
   * target on its old replies while the source looks configured.
   * revert: delete this line. */
  payment_flex_ids: 'slip',
  /* [FEAT-20260902-SLIPPROVIDER] which service verifies this hook's slips.
     Appended rather than inserted so no existing position in the client's field
     list moves. Omit this line and a slip-tab clone reports success and copies
     nothing — silently, which is the failure this whole file exists to prevent.
     ⚠️ It clones by default while the verify KEY is opt-in, so the two can be
     separated by a half-ticked clone; see the pairing note on the schema Prop.
     revert: delete this line. */
  slip_provider: 'slip',
  /* [FEAT-20260903-VENDORBRANCH] the hook's sub-account at its provider. Omit this
     line and a slip-tab clone reports success while leaving the branch behind,
     so the target hook keeps a provider name it cannot reach. Clones by default,
     same as the provider name and same half-ticked-clone hazard — which fails
     closed at the vendor rather than silently. revert: delete this line. */
  slip_verify_branch: 'slip',
  /* [FIX-20260903-HOSTNOTAFIELD] `slip_verify_base_url` was here and is gone on
     purpose — the host is not hook data, it is `provider.defaultBaseUrl`. A line
     added back here would make a removed field clonable again. */

  // ── Notifications ─────────────────────────────────────────────────────
  telegram_chat_id: 'notifications',
  telegram_noti_type: 'notifications',

  // ── External API ──────────────────────────────────────────────────────
  external_api_url: 'external_api',
  external_user: 'external_api',
  // A custom_tool binding is a pointer to a global tool definition, not a
  // secret itself, so it lives here rather than in SENSITIVE_FIELD.
  custom_tool_status: 'external_api',
  custom_tool_id: 'external_api',
  /**
   * [FEAT-20260808-PAYTOOL-P4] WHAT: the payment-tool binding, registered on the
   * same tab as its `custom_tool_*` siblings directly above.
   *
   * WHY THIS TAB, AND WHY NOT SENSITIVE_FIELD — this is a money switch, so the
   * choice is deliberate rather than copied blind:
   *   · Precedent: `custom_tool_status`/`custom_tool_id` are a plain
   *     `external_api` pair, cloned by default. `payment_tool_*` is a 1:1 mirror
   *     of that pair by schema design, so it follows the same rule.
   *   · A pointer to a global tool definition is not a credential — nothing
   *     here is an OA-specific secret, which is what SENSITIVE_FIELD guards.
   *   · ⚠️ Decisive: the two fields must move TOGETHER. SENSITIVE_FIELD is
   *     opt-in per field, so a half-tick would write `payment_tool_status:true`
   *     with `payment_tool_id:null` (or the reverse) — a half-bound OA whose
   *     kill switch reads ON while the runner finds no tool. Keeping both in
   *     FIELD_TAB means a clone either carries the whole binding or none of it.
   *
   * MONEY RISK, STATED PLAINLY: selecting the External API tab now copies
   * `payment_tool_status: true` onto every target OA in one request — a money
   * feature switched ON in bulk. เจตนาคือให้เหมือน custom_tool ทุกประการ.
   * That risk is held by the endpoint's existing gates, not by this map:
   * `confirm:true` is mandatory, group access is enforced per target,
   * cross-group needs `allow_cross_group`, and every target gets an audit row
   * listing the changed fields.
   *
   * HOW TO CHANGE LATER: to make the payment binding opt-in instead, move BOTH
   * lines to SENSITIVE_FIELD together (never one) — the operator then has to
   * tick both, and the pair can still arrive half-written unless the clone loop
   * is taught to bind them. To stop cloning it entirely, delete both lines.
   * revert: delete the two entries below.
   */
  payment_tool_status: 'external_api',
  payment_tool_id: 'external_api',
  // [WALLETPAYTOOL] clones WITH the payment binding — the two travel together, or a
  // cloned OA would point its walletpay leg at the wrong host.
  walletpay_tool_status: 'external_api',
  walletpay_tool_id: 'external_api',

  /* ── Notice mode ──────────────────────────────────────────────────────
   * [FEAT-20260822-NOTICEMODE] Owner, 22/08 round 4: cloneable — "ทำได้แต่ต้อง
   * ห้ามพังของเดิม proof test seamless เลือกไม่เลือกก็ได้". Registered at the
   * END of the map on purpose: insertion order reaches the client, so appending
   * leaves every existing tab's field list byte-identical and only the new
   * `notice` tab gains entries. The flex ids are ordinary card bindings — the
   * same global-card nature the per-reply-state card map documents up in the
   * slip section (naming that field HERE would move the slice a persistence
   * spec cuts at the credentials map and turn it red — same wording trap the
   * AI-pair note above records) — NOT credentials, so they live here and
   * clone by default with their tab.
   * A status and its card are a bound pair: the per-target drag in
   * `cloneHookSettings` keeps a field-pick from writing status-ON onto a
   * card-less OA (same hazard the PAYTOOL block above names).
   * revert: delete these seven lines + the `notice` CLONEABLE_TABS entry. */
  notice_deposit_status: 'notice',
  notice_deposit_scope: 'notice',
  notice_deposit_flex_id: 'notice',
  notice_withdraw_status: 'notice',
  notice_withdraw_scope: 'notice',
  /* [FEAT-20260823-NOTICECHECKFLAGS] the four wrap-flags live on the notice tab
     with everything they govern — clone's tab-pick carries them with the trio. */
  notice_deposit_time_check: 'notice',
  notice_deposit_sitestatus_check: 'notice',
  notice_withdraw_time_check: 'notice',
  notice_withdraw_sitestatus_check: 'notice',
  /* [FEAT-20260829-STATUSFIRST] same tab as everything they govern — clone's
     tab-pick copies them with the family; an old source row without the column
     clones to "off", which is the default. */
  notice_deposit_sitestatus_first: 'notice',
  notice_withdraw_sitestatus_first: 'notice',
  notice_withdraw_flex_id: 'notice',
  follow_player_status: 'notice',
  // [R2] the off-service-time and slip cards (cases A/C/E/F of the runtime
  // spec) — appended for the same order-preserving reason as the block above.
  // revert: delete these four lines with their @Prop siblings.
  notice_deposit_offtime_flex_id: 'notice',
  notice_withdraw_offtime_flex_id: 'notice',
  notice_all_offtime_flex_id: 'notice',
  notice_all_disable_flex_id: 'notice',
};

/**
 * Sensitive fields — copied only when the operator explicitly ticks them.
 *
 * These are an OA's keys and destinations, not ordinary settings. Overwriting
 * one by accident points the destination at the template's credentials, and the
 * damage is invisible: the system keeps working, just against the wrong
 * account. Absent from FIELD_TAB, so a normal clone never touches them.
 */
export const SENSITIVE_FIELD: Readonly<Record<string, string>> = {
  custom_ai_key: 'ai',
  /* [FEAT-20260904-VENDORSECCOL] DeepSeek's key — a SECOND, independent tick.
     Owner 04/09: "เอาคีย์ 1 ไหม เอาคีย์ 2 ไหม · ไม่เอาก็ไม่ทับ". Each vendor's key
     is opted into on its own; an unticked one leaves the target's value alone. */
  custom_ai_key_sec: 'ai',
  slip_verify_key: 'slip',
  telegram_key: 'notifications',
  external_password: 'external_api',
  external_endpoints: 'external_api',
  // web_code is the per-OA identity for the Shop-API HMAC handoff signature. It is
  // opt-in rather than never-clone because sharing it is sometimes intended —
  // the clone response returns a "sharing web_code with <OA>" warning so the
  // duplicate is a conscious act.
  customer_link_web_code: 'external_api',
};

/**
 * Never copied, under any circumstances — the hook's identity. Overwriting any
 * of these stops the destination receiving messages immediately.
 *
 * This is a second layer on top of FIELD_TAB: even if one of these were later
 * added to a tab by mistake, this set still blocks it.
 */
export const NEVER_CLONE: ReadonlySet<string> = new Set([
  '_id',
  '__v',
  'alias',
  'line_oa_name',
  'company_name',
  'domain_name',
  'channel_secret',
  'access_token',
  'webhook_url',
  'channel_type',
  'group',
  'group_ids',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'deleted_at',
  'status',
  'tags',
  'description',
  // System-written data, not settings.
  'raw_profile_data',
  'profile_data_updated_at',
  'raw_site_rules_data',
  'site_rules_updated_at',
]);

/**
 * Translation keys per field, so the modal can expand a tab and show the same
 * labels the form uses.
 *
 * Only fields whose form label does NOT follow `hook_form.<field>` are listed;
 * each was read off the real form rather than guessed, because a
 * self-invented label makes the expanded list unrecognisable to the operator.
 */
const FIELD_LABEL_KEY: Readonly<Record<string, string>> = {
  /* [FIX-20260910-DOCLABELS] 🔴 THREE COLUMNS, THREE LABELS. All three used to
     point at `hook_form.suggestion_text` ("Training Document"), so the clone
     modal listed the same words three times and an operator ticking one of them
     could not tell which box they were copying.
     The form has always had a distinct label for each; these now point at the
     same three, which is what `label_key` exists for ("ตรงกับฟอร์มจริง").
     ⚠️ AND ONLY TWO OF THEM REACH THE MODEL. `prompt-context.util.ts`
        (`DOC_BLOCKS`) sends BASIC_INFO and COMPANY_INFO; the no-profile box was
        dropped from the prompt by owner order on 13/08 and the column was kept
        only so the dashboard keeps loading and saving it. Its label says so now
        — a box that looks identical to two live ones but goes nowhere is the
        kind of thing an operator fills in for a month before anyone notices. */
  suggestion_text: 'hook_form.training_doc_general',
  suggestion_company_text: 'hook_form.training_doc_company',
  suggestion_text_no_profile: 'hook_form.training_doc_no_profile',
  flex_custom_ids: 'hook_form.flex_custom_label',
  /* [FIX-20260910-DOCLABELS] was `hook_form.flex_profile_id`, the label of a
     DIFFERENT field (`flex_profile_id`) — so the clone list printed that one
     heading twice. `hook_form.flex_pc_label` is the label the form really puts
     on this multi-select ("flex profile กึ่งปรับแต่ง"). */
  flex_profile_custom_ids: 'hook_form.flex_pc_label',
  gemini_thinking_budget: 'hook_form.thinking_label',
  ai_raw_site_rules: 'hook_form.site_rules_to_ai',
  fast_mode: 'webhook_list.toggle_field_fast_mode',
  status_off_action: 'hook_form.status_off_action',
  status_off_text: 'hook_form.status_off_text',
  custom_tool_id: 'hook_clone.field_custom_tool_id',
  custom_tool_status: 'hook_clone.field_custom_tool_status',
  // [FEAT-20260808-PAYTOOL-P4] Same `hook_clone.*` treatment as the custom_tool
  // pair above: the form has no `hook_form.payment_tool_*` label, so the default
  // `hook_form.<field>` fallback would render an untranslated key in the clone
  // modal's expanded field list. revert: delete these two lines.
  payment_tool_id: 'hook_clone.field_payment_tool_id',
  walletpay_tool_status: 'hook_clone.field_walletpay_tool_status',
  walletpay_tool_id: 'hook_clone.field_walletpay_tool_id',
  payment_tool_status: 'hook_clone.field_payment_tool_status',
  customer_link_web_code: 'hook_clone.field_web_code',

  /* [FIX-20260910-DOCLABELS] the rest of the fields that had NO dashboard label
     at all and printed their raw key in the clone list. Every one below was read
     off the real form, never invented — the file location is on each line so the
     next reader can check rather than trust:
       · slip_require_profile / _text  HookFormModal.tsx ~3176 / ~3199 — the form
         hardcodes those two Thai labels, so there was no `hook_form.*` key to
         reuse and one had to exist somewhere.
       · payment_/walletpay_tool_*        HookFormModal.tsx ~3846 / ~3932 — the box
         titles. The BE already pointed at `hook_clone.field_*`; the keys were
         simply never added on the dashboard side, which is the same bug wearing
         a different hat.
       · notice_*                      HookNoticeTab.tsx ~380 — 🔴 the form uses
         ONE shared label for each pair (`hook_form.notice_time_check` …) and
         relies on a SECTION HEADING to say which side it belongs to. A flat
         clone list has no headings, so pointing all six at the shared keys would
         print three identical pairs — the same "เหมารวม" the Training Document
         boxes had. The side is folded into the label instead.
       · ai_stable_prompt              no control anywhere in the form (grep is
         empty on the dashboard); it is a BE flag read as `!== false`. Its label
         says exactly that rather than pretending a box exists. */
  slip_require_profile: 'hook_clone.field_slip_require_profile',
  slip_require_profile_text: 'hook_clone.field_slip_require_profile_text',
  payment_flex_ids: 'hook_form.payflex_title',
  notice_deposit_time_check: 'hook_clone.field_notice_deposit_time_check',
  notice_deposit_sitestatus_check:
    'hook_clone.field_notice_deposit_sitestatus_check',
  notice_deposit_sitestatus_first:
    'hook_clone.field_notice_deposit_sitestatus_first',
  notice_withdraw_time_check: 'hook_clone.field_notice_withdraw_time_check',
  notice_withdraw_sitestatus_check:
    'hook_clone.field_notice_withdraw_sitestatus_check',
  notice_withdraw_sitestatus_first:
    'hook_clone.field_notice_withdraw_sitestatus_first',
  ai_stable_prompt: 'hook_clone.field_ai_stable_prompt',
};

/** Translation key for a field; falls back to the regular pattern. */
export function labelKeyOf(field: string): string {
  return FIELD_LABEL_KEY[field] ?? `hook_form.${field}`;
}

/**
 * Fields a clone would actually write for the selected tabs.
 *
 * @param tabs           tab keys the operator ticked
 * @param includeSecrets whether the "include sensitive values" box is ticked
 */
export function fieldsForTabs(
  tabs: readonly string[],
  includeSecrets = false,
): string[] {
  const want = new Set(tabs.filter(Boolean));
  const out: string[] = [];
  for (const [field, tab] of Object.entries(FIELD_TAB)) {
    if (want.has(tab) && !NEVER_CLONE.has(field)) out.push(field);
  }
  if (includeSecrets) {
    for (const [field, tab] of Object.entries(SENSITIVE_FIELD)) {
      if (want.has(tab) && !NEVER_CLONE.has(field)) out.push(field);
    }
  }
  return out;
}
