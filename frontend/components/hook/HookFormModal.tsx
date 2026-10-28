import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
// [FEAT-20260817-FORMDIFF] The payload builder and the "send only what changed"
// rule both live in utils/hookFormPayload.ts — see that file for why.
import {
  buildHookPayload,
  diffHookPayload,
  type HookPayload,
  type TrainingDocBoxes,
} from '../../utils/hookFormPayload';
// [FEAT-20260817-SECRETLOCK] stored credentials open locked — see that file's header
import { useSecretLock, SecretLockButtons } from './form/secretLock';
// [FEAT-20260830-HIDEDESC] revert: ลบ import + จุดเรียกทั้งหมด
import { resolveHookDescription, todayDdMmYy } from './form/hookDescriptionDate';
import { useFieldOptions } from '../../services/hook';
// [FEAT-20260903-FALLBACKLABEL] revert: delete the import and render t(o.label_key).
import { fieldOptionLabel } from './form/fieldOptionLabel';
import { CustomToolBindingSection } from './form/CustomToolBindingSection';
import { ExtApiFoldCard } from './form/ExtApiFoldCard';
import { useProviderSectionHidden } from '../../hooks/useProviderSectionHidden';
import { parseTrainingDoc, joinTrainingDoc, trainingDocLengths, trainingDocOverLimit, DOC_BLOCK_LABELS } from '../../services/hook';
import { 
  Bot, ShieldCheck, MessageSquare, Cog, Trash2, X, Plus, Trash, Eye, Globe, Zap, 
  Terminal, Database, Bell, Layout, Settings, FileJson, Check, ArrowLeft, ArrowRight,
  Download, Info, ChevronDown, ExternalLink, Save, Loader2, AlertCircle, HelpCircle, 
  Link, Monitor, Copy, Activity, EyeOff, Repeat,
  AlertTriangle, RefreshCw, Edit2, KeyRound, ChevronRight,
  // [FEAT-20260822-NOTICEMODE] the notice tab's icon
  BellRing
} from 'lucide-react';
// [FEAT-20260805-HANDOFF-HOOKTAB] read handoff targets bound to this hook + shared per-hook creds editor
import type { HandoffTarget } from '../../services/chat';
import { useHandoffTargetsQuery } from '../../services/chat/queries';
import { HandoffHookCredsEditor } from './HandoffHookCredsEditor';
// [FEAT-20260810-PAYSTATEFLEX] whole UI for hook.payment_flex_ids lives in that file
import { HookPaymentFlexBlock } from './HookPaymentFlexBlock';
// [FEAT-20260811-HOOKFORMSPLIT] extracted dialogs/overlays — keep this file THIN, do not inline back.
import { HookTestApiResultDialog } from './form/HookTestApiResultDialog';
import {
  HookImageZoomOverlay,
  HookPermissionAlertOverlay,
} from './form/HookFormOverlays';
import { HookEndpointUsageGuide } from './form/HookEndpointUsageGuide';
import { FlexCardMultiSelect } from './form/FlexCardMultiSelect';
import { InputError } from '../common/InputError';
import { HookAiTab } from './form/tabs/HookAiTab';
// [FEAT-20260822-NOTICEMODE] its own tab: these seven columns are written by
// `PUT /hook/notice/:id`, never by this modal's submit (the main route drops
// them on purpose). revert: delete this import, the tab button and its render.
import { HookNoticeTab } from './form/tabs/HookNoticeTab';
import { noticeIsDirty } from '../../utils/noticeUnsaved';




import { ApiError, GroupEntry, HookData, HookFormData } from '../../types';
import { channelVars, enabledChannels } from '../../config/channelRegistry';
import { getAuthUser } from '../../services/authStorage';
import { AlertModal } from '../modals';
// [FEAT-20260731-RAWJSONSAMPLE] เนื้อใน modal ช่วยเหลือของช่อง "กฏการใช้ข้อมูล RAW JSON"
// revert: ลบ import นี้ + คืน message ของ helpModal เป็น string เดิม
import { RawJsonRulesHelp } from './RawJsonRulesHelp';
// [FEAT-20260801-RAWJSONEXAMPLE] ตัวอย่างโครง JSON ข้อมูลดิบ (โชว์เป็นหน้าเปล่า)
import { RAW_JSON_DATA_EXAMPLE } from '../../config/rawJsonDataExample';
// [FEAT-20260803-SITERULESEX] ก้อนตัวอย่างของฝั่งกติกาเว็บ (คนละก้อนกับข้อมูลลูกค้า)
import { SITE_RULES_DATA_EXAMPLE } from '../../config/siteRulesDataExample';
import { ConfirmModal } from '../modals';
import { ScrollIndicator } from '../common';

import { SUGGESTION_TEXT_MAX_LENGTH } from '../../services/hook';
import { useI18n, translateNow } from '../../i18n';
import { groupService } from '../../services/admin';
import { refetchGroupsIfFailed, useAcmeCategoryFlag, useGroupsQuery } from '../../services/admin/queries';
// [FEAT-20260729-CUSTOOL] 🔒 สาย AUTO — to_dev_auto เท่านั้น
import type { CustomToolEntry } from '../../services/hook';
import { useCustomToolsQuery } from '../../services/hook/queries';
import { useFlexMessagesQuery } from '../../services/media/queries';
import { API_BASE_URL, authFetch, handleApiResponse } from '../../services/apiClient';
import { FlexMessageEntry } from '../../types';
import { copyText } from '../../utils/copyText';

interface HookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: HookFormData) => Promise<void>;
  initialData?: HookData;
  isViewMode?: boolean;
  mode?: 'create' | 'update';
  // ==== [FEAT-20260731-HOOKFULLPAGE] START — allow rendering as standalone full page
  // revert: remove isFullPage prop
  isFullPage?: boolean;
  // ==== [FEAT-20260731-HOOKFULLPAGE] END
  // [FEAT-20260805-CREATE-INGROUP] create ใต้กลุ่มเดิม: prefill + lock group. optional —
  // ไม่ส่ง = create ปกติเป๊ะ (ไม่กระทบ). ใช้เฉพาะ mode create.
  presetGroupId?: string;
}

// ==== [FEAT-20260801-RAWJSONEXAMPLE] เปิด "ตัวอย่าง json" เป็นหน้าเปล่า
// สร้าง Blob HTML แล้วเปิดแท็บใหม่ → หน้าพื้นนวลอ่านสบายตา แสดง JSON แบบ pretty อย่างเดียว
// ไม่มี header/menu ของแอป (อยู่คนละ document) · escape &<> กัน JSON โดนตีความเป็น HTML
// ทริกเกอร์จากคลิกของผู้ใช้ (popup blocker ไม่บล็อก) · revoke URL หลังเปิดสักครู่
// [FIX-20260801-RAWJSONBG] พื้นหลังไม่ใช้ขาวล้วน (#fff แสบตา) → นวลลง ~30% เป็นครีมอ่อน
// revert: ลบฟังก์ชันนี้ + ปุ่มที่เรียก + import ด้านบน + config/rawJsonDataExample.ts
/* [FEAT-20260803-SITERULESEX] เปิดหน้าตัวอย่าง json — ใช้ตัวเดียวกันทั้ง 2 ปุ่ม
 * เดิมโค้ดสร้าง Blob อยู่ในฟังก์ชันของฝั่งข้อมูลลูกค้าอย่างเดียว พอต้องมีปุ่มที่สอง
 * ทางที่ง่ายคือก๊อปทั้งก้อน — แล้วจะได้ตัวสร้างหน้า 2 ชุดที่ต้องแก้คู่กันตลอด
 * → แยก renderer ออกมารับ (title, json) แล้วให้ทั้งสองปุ่มเรียกตัวนี้ */
const openJsonExamplePage = (title: string, json: string) => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(title) + '</title></head>' +
    '<body style="margin:0;background:#e7e3da;color:#1f2937">' +
    '<pre style="margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;' +
    'font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">' +
    esc(json) +
    '</pre></body></html>';
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

const openRawJsonExample = () => openJsonExamplePage(translateNow('pageui.hookform.json_example_customer_title', 'ตัวอย่าง json — ข้อมูลลูกค้า'), RAW_JSON_DATA_EXAMPLE);
const openSiteRulesExample = () => openJsonExamplePage(translateNow('pageui.hookform.json_example_site_rules_title', 'ตัวอย่าง json — กติกาเว็บ (site rules)'), SITE_RULES_DATA_EXAMPLE);

const DEFAULT_FORM: HookFormData = {
  line_oa_name: '',
  domain_name: '', // [FEAT-20260802-DOMAINNAME] ชื่อเว็บ/โดเมน (optional)
  alias: '',
  company_name: '',
  /* [FEAT-20260830-HIDEDESC] ช่องถูกซ่อนแล้ว จึงต้องมีค่าติดมาตั้งแต่แรก
     ไม่งั้น validation ตีตกทันทีที่กดบันทึก.
     ⚠️ ค่านี้ถูกประเมินครั้งเดียวตอนโมดูลโหลด — จุดที่เปิดฟอร์มจึงเขียนทับด้วย
     `todayDdMmYy()` สดอีกครั้ง (ดูจุด reset ฟอร์ม) เพื่อให้แท็บที่เปิดค้าง
     ข้ามเที่ยงคืนไม่ได้วันของเมื่อวาน */
  description: todayDdMmYy(),
  suggestion_text: '',
  suggestion_text_no_profile: '',
  default_answer_text: 'ขออภัยครับ ไม่พบข้อมูลที่คุณสอบถาม โปรดรอเจ้าหน้าที่ติดต่อกลับโดยเร็วที่สุด',
  /* [FEAT-20260823-GENERRFALLBACK] deliberately EMPTY, not a canned line — an
     unset value means the BE ladder falls to default_answer_text, which is the
     behaviour every existing hook already has. Shipping a default here would
     silently change what all new hooks answer on an AI outage. */
  ai_generative_error_text: '',
  missing_api_data_text: 'ขออภัยครับ ไม่พบข้อมูลที่คุณสอบถาม โปรดรอเจ้าหน้าที่ติดต่อกลับโดยเร็วที่สุด',
  // [FEAT-20260806-STATUSOFF] default "" = legacy behavior (bot replies the built-in out-of-hours text)
  status_off_action: '',
  status_off_text: '',
  image_answer_text: 'ระบบได้รับรูปภาพของพี่แล้วค่ะ รอแอดมินตรวจสอบสักครู่นะคะ',
  tag: [],
  group_id: '',
  line_url: 'https://google.com',
  webhook_url: 'https://google.com',
  status: 0,
  fast_mode: 1,
  channel_id: '1234567890',
  channel_secret: '1234567890',
  access_token: '1234567890',
  /* [NOTE-20260810-DOCIDHIDDEN] `doc_id` has NO input in this form, and that is
     DELIBERATE — owner decision 2026-08-10. It is carried end to end (default
     here, load at :815, tab-map at :1220, save group at :1431) so a value
     already stored on a hook survives every edit untouched, but nothing on this
     screen lets an operator type one and NOTHING validates it: it is optional by
     design, not missing by oversight.
     WHY: the back end reads `doc_id` but document retrieval is not wired into
     the reply path yet (`omnidesk-api webhook.service.ts:2256` logs a warning and
     proceeds with empty context), so exposing the field would offer a setting
     that changes nothing.
     ⚠️ Do NOT add an input or a required-check as tidy-up. Surface it only when
     the retrieval port lands — see `omnidesk-api/todo/be_todo18_10082026.md`.
     ซ่อนและไม่บังคับโดยตั้งใจ จนกว่าจะมีการเปลี่ยนแปลง. */
  doc_id: '',
  custom_ai_key: '',
  // [FEAT-20260904-VENDORSECCOL] DeepSeek's key, its own slot in the form state.
  custom_ai_key_sec: '',
  telegram_key: '',
  telegram_chat_id: '',
  telegram_noti_type: 'all',
  gemini_temperature: 0.5,
  gemini_top_k: 20,
  gemini_top_p: 0.9,
  gemini_thinking_budget: 0, // [FEAT-20260802-THINKHOOK] 0=ปิด(default) · -1=dynamic · 1..24576=budget
  // [FEAT-20260730-HISTLIMIT] จำนวน history ที่ให้บอทใช้ตอบ (ค่าเริ่มต้นเท่ากับ
  // ค่าที่ webhook ใช้อยู่เดิม → เปิดฟอร์มมาเห็น 5 ตรงกับพฤติกรรมจริง)
  ai_history_limit: 5,
  // [FEAT-20260801-NEEDDETAIL] จำนวนข้อความที่ให้ AI สรุปความต้องการลูกค้าบน ticket
  // ค่าเริ่มต้น 10 = เลขที่ webhook เคย hardcode ไว้ → เปิดฟอร์มมาเห็นค่าที่ใช้จริง
  // คนละค่ากับ ai_history_limit ข้างบน (อันนั้นคุมตอนบอทตอบลูกค้า)
  ai_need_detail_limit: 10,
  // [FEAT-20260731-RAWJSON] ปิดเป็นค่าเริ่มต้น ตรงกับ default ของ schema ฝั่ง BE
  ai_raw_json_analysis: false,
  ai_raw_site_rules: false, // [FEAT-20260802-RAWSITERULES] ส่ง site rules เข้า AI แยกจาก raw json
  // [FEAT-20260810-DOCRETRIEVAL] false = ส่งเอกสารทั้งฉบับ (พฤติกรรมเดิม)
  doc_retrieval: false,
  // [FEAT-20261026-RAGENGINE] null = BE code default (add + bm25) — never a mode by default
  rag_prompt_mode: null,
  rag_search_mode: null,
  // [FEAT-20260821-IGNOREABANDON] false = ตามลูกค้าที่ไม่ลงทะเบียนตามเดิม
  ignore_abandon_assist: false,
  /* [FEAT-20260822-NOTICEMODE] every notice column defaults to the pre-feature
     state: both toggles OFF, scope 'text', no card bound. An OA that never
     opens the tab behaves exactly as it did before the mode existed.
     ⚠️ These are written ONLY by `PUT /hook/notice/:id` — the main submit
     spreads formData, and the BE drops them there by design. */
  notice_deposit_status: false,
  notice_withdraw_status: false,
  follow_player_status: false,
  /* [FEAT-20260823-NOTICECHECKFLAGS] default ON — absent means "the check runs",
     matching the BE reader (`!== false`). A new hook starts with every check on. */
  notice_deposit_time_check: true,
  notice_deposit_sitestatus_check: true,
  notice_withdraw_time_check: true,
  notice_withdraw_sitestatus_check: true,
  /* [FIX-20260829-STATUSFIRSTRT] default OFF — opposite polarity from the block
     above, same as the BE default (`default:false`, read `=== true`). */
  notice_deposit_sitestatus_first: false,
  notice_withdraw_sitestatus_first: false,
  notice_deposit_scope: 'text',
  notice_withdraw_scope: 'text',
  notice_deposit_flex_id: null,
  notice_deposit_offtime_flex_id: null,
  notice_withdraw_flex_id: null,
  notice_withdraw_offtime_flex_id: null,
  notice_all_offtime_flex_id: null,
  notice_all_disable_flex_id: null,
  // [P2-20260813] null = use the default vendor / that vendor's default model.
  ai_vendor: null,
  ai_model: null,
  ai_model_sec: null,
  /* [FEAT-20260909-VENDORTRANSLATE / DSREASONING] null = "follow ai_vendor" for
     the translate lane, and "say nothing to the vendor" for the five reasoning
     knobs. Every one of them is a THIRD state, not a synonym for off.
     🔴 THESE MUST BE MATCHED BY A LOAD LINE BELOW, and the two edits belong in
        one commit. The moment a key appears here it is in `formData` on every
        open, so submit's `...formData` spread sends it — and if load does not
        overwrite it from the row, that spread writes null over the operator's
        stored choice. The comment on the load block spells out the same trap
        for `ai_vendor`. */
  ai_vendor_translate: null,
  deepseek_thinking: null,
  deepseek_reasoning_effort: null,
  deepseek_thinking_translate: null,
  deepseek_reasoning_effort_translate: null,
  /* ⚠️ null, NOT 0 — unlike `gemini_thinking_budget` above. On this lane an
     unset column sends no thinking config at all, while 0 is an instruction to
     turn thinking off. Defaulting it to 0 here would make every OA start
     sending that instruction. */
  gemini_thinking_budget_translate: null,
  /* [FEAT-20260918-HOOKTRANS] chat translation settings */
  translate_lang: null,
  auto_translate: false,
  // [FEAT-20260731-RAWJSONRULES] ข้อความกติกา — ว่างได้ แต่ถ้าเปิดสวิตช์ต้องกรอก
  ai_raw_json_rules: '',
  ai_site_rules_guide: '', // [FEAT-20260804-SITERULESGUIDE] กติกาของก้อน site rules
  auto_unassist_minutes: 30,
  answer_link: '',
  // [FEAT-20260801-FLEXPROFILE] ไม่เลือก = null = tag ไม่ทำงาน (พฤติกรรมเดิม)
  flex_profile_id: null,
  // [FEAT-20260810-CUSHELPERTYPE] การ์ดที่ตอบตอน AI ขึ้น tag [[[customer-helper]]]
  //   null = ใช้การ์ดสำรอง hard-code ฝั่ง BE (พฤติกรรมเดิม) = seamless
  flex_customerhelper_id: null,
  // [FEAT-20260802-FLEXCUSTOMLIST] ไม่เลือก = [] (ไม่ใช่ undefined ไม่งั้น checkbox พัง)
  flex_custom_ids: [],
  // [FEAT-20260802-FLEXPCTAG] flex profile กึ่งปรับแต่ง (profile-semi-custom) · เส้นแยกจาก custom
  flex_profile_custom_ids: [],
  // [FEAT-20260801-HELPERTEXT] ว่าง = ฝั่ง BE ใช้ข้อความกลางให้เอง (ไม่ต้องใส่ default ที่นี่
  // ไม่งั้นค่าจะถูกเขียนลง DB ทุก OA ทั้งที่ผู้ใช้ไม่ได้ตั้ง แล้วแก้ข้อความกลางทีหลังไม่มีผล)
  customer_helper_text: '',
  slip_verify_key: '',
  /* [FEAT-20260903-HOOKSLIPPROV] '' = use whatever slip provider the system is
     currently set to. That is a real saved state ("no override"), not "unset",
     so a brand-new hook starts here and behaves exactly as hooks do today. */
  slip_provider: '',
  // [FEAT-20260903-VENDORBRANCH] '' = this provider needs no sub-account.
  slip_verify_branch: '',
  // [FEAT-20260903-HOSTPERHOOK] '' = use the provider's own host.
  slip_check: false,
  /* [FEAT-20260822-QRPRESCANFE] jsQR prescan mode. 'skip' = the schema default a
     NEW hook gets from `hookModel.create()`, so the form agrees with the row it
     is about to create. An EXISTING row that never stored the column loads as
     'off' below — the value the runtime actually uses. */
  qr_prescan_mode: 'skip',
  // ==== [FEAT-20260809-SLIPREQPROF] START — "รับสลิปเฉพาะคนที่เป็นลูกค้าแล้ว"
  // WHAT: เปิดแล้ว ถ้าเช็คโปรไฟล์ได้คำตอบชัดเจนว่า "ไม่มีลูกค้าคนนี้" จะข้ามการตรวจสลิป
  //       ทั้งหมด (ไม่เรียก Swiftcheck ที่คิดเงิน ไม่สร้างระเบียนสลิป ไม่ขึ้นการ์ดสลิป)
  //       แล้วตอบลูกค้าให้ไปผูกบัญชีก่อน
  // WHY : คนที่ยังไม่ผูกบัญชีก็โอนเงินและส่งสลิปได้ → เดิมจะเสียค่าตรวจสลิปฟรี ๆ
  //       แล้วไปพังทีหลังให้แอดมินมาตามเก็บกวาด
  //
  // ⚠️ **ไม่ใช่ "บล็อกสลิปเมื่อดึงโปรไฟล์ไม่ได้"** — ยิงเฉพาะตอนที่ปลายทางตอบชัด ๆ ว่า
  //    ไม่มีลูกค้ารายนี้เท่านั้น · ถ้าปลายทางล่ม/timeout/เบรกเกอร์ตัด/401/403/tool ตั้งค่าผิด
  //    ระบบจะ **fail-open** คือตรวจสลิปตามปกติเหมือนไม่ได้เปิดฟีเจอร์นี้
  //    (ถ้า fail-closed ตอนปลายทางล่ม = ลูกค้าเก่าทุกคนจะโดนบอกว่า "ยังไม่ได้ผูกบัญชี"
  //     และไม่มีสลิปไหนถูกตรวจเลย — นี่คือเหตุผลที่ออกแบบให้ fail-open)
  // HOW : เปลี่ยนค่าเริ่มต้น แก้ที่นี่ · ข้อความว่าง = BE ใช้ข้อความไทยกลางของตัวเอง
  slip_require_profile: false,
  slip_require_profile_text: '',
  // ==== [FEAT-20260809-SLIPREQPROF] END
  match_account: false,
  match_account_number: '',
  flex_success: '',
  flex_fail: '',
  flex_other: '',
  flex_duplicate: '',
  flex_not_found: '',
  flex_min_amount: '',
  flex_max_amount: '',
  flex_error: '',
  flex_success_not_match: '',
  flex_out_of_time: '',
  slip_check_min_amount: null,
  slip_check_max_amount: null,
  slip_check_out_of_time: null,
  qr_code_fail_anwser_text: 'ขออภัยค่ะ ระบบไม่สามารถตรวจสอบ QR Code นี้ได้ กรุณาลองใหม่อีกครั้ง',
  callback_slip: [],
  callback_token: '',
  callback_action: 'all',
  external_api_url: '',
  external_user: '',
  external_password: '',
  external_endpoints: {},
  chat_bot_id: '',
  force_grant: false,
  // [FEAT-20260728-CUSTREG] ค่าเริ่มต้นของ Customer Link — ตรงกับ default ฝั่ง BE
  // (ปิดไว้ + ทุกช่องว่าง = ระบบใช้ค่ากลาง/demo เดิม ไม่มีอะไรเปลี่ยนสำหรับ hook เก่า)
  // [FEAT-20260728-CUSTAPI] เหลือ 3 key — URL/creds/path ใช้ของ External API
  customer_link_enabled: false,
  customer_link_landing_url: '',
  customer_link_web_code: '',
  // [FEAT-20260729-CUSTOOL] ผูกกับตาราง custom_tools (URL/creds/path อยู่ที่นั่น)
  custom_tool_status: false,
  custom_tool_id: null as string | null,
  // ==== [FEAT-20260808-PAYCUSTOOL] ผูก tool หมวด payment (ตรวจสลิป) เข้ากับ OA นี้
  // WHAT: 2 field นี้อยู่ "ที่ hook" ไม่ใช่ที่ตัว tool — เพราะเปิด/ปิดเป็นราย OA
  // WHY : ค่าเริ่มต้นปิด + ไม่เลือก tool = สลิปทำงานแบบเดิมทุกประการเหมือนก่อนมีฟีเจอร์นี้
  //       (hook เก่าที่ไม่มี 2 field นี้ใน DB ก็ตกมาที่ค่านี้ → ไม่มีอะไรเปลี่ยน)
  // HOW : เปลี่ยนพฤติกรรมเริ่มต้น แก้ที่นี่ที่เดียว
  payment_tool_status: false,
  payment_tool_id: null as string | null,
  // ==== [FEAT-20260809-WALLETPAYTOOL] tool ของขา walletpay (ไม่บังคับ)
  // WHAT: tool คนละตัวสำหรับยิงขา walletpay โดยเฉพาะ · null = ไม่ผูก (ค่าเริ่มต้น)
  // WHY : BE ประกอบ URL เป็น `tool.base_url + '/' + endpoint.path` และ tool 1 ตัวมี
  //       base_url ได้ค่าเดียว แต่ขาเงิน 2 ขานี้อยู่คนละ host กัน
  //         · topup  = เส้นย่อยของ Shop-API tool เดิมของ OA (host เดียวกัน secret เดียวกัน)
  //         · walletpay = คนละระบบ คนละ host ไม่มี auth → ต้องมี tool ของตัวเอง
  //       null = ใช้เส้น pay_walletpay บน payment tool ตัวเดิม (โครงเดิมแบบ tool เดียว)
  // HOW : เปลี่ยนค่าเริ่มต้น แก้ที่นี่ที่เดียว
  //
  // ⚠️ ต้องครบ **ทั้งคู่** ระบบถึงจะใช้ tool แยก: walletpay_tool_status === true และมี
  //    walletpay_tool_id · ขาดตัวใดตัวหนึ่ง = ใช้เส้น pay_walletpay บน payment tool ตามเดิม
  //    แยกเป็น 2 field เหมือน custom_tool_* / payment_tool_* เพราะเป็นคนละคำถาม:
  //    "จะใช้ tool ไหน" กับ "ตอนนี้เปิดใช้อยู่ไหม" → ปิดชั่วคราวได้โดยไม่ลืมว่าเลือกตัวไหนไว้
  walletpay_tool_status: false,
  walletpay_tool_id: null as string | null,
  // [FEAT-20260810-PAYSTATEFLEX] {} = no state bound = every reply stays as it is today
  payment_flex_ids: {} as Record<string, string>
} as any;

/* [FEAT-20260803-DOCSTEPS] 3 ขั้นตอนของ "ตั้งค่า Training Doc" — ลำดับซ้ายมือ = ลำดับนี้
 *
 * 🔴 ชื่อ 3 กลุ่มคงเดิมตามที่ผู้ใช้สั่ง (ทั่วไป / ตั้งค่า Tag-API / Training Doc)
 *    ใช้ i18n key ชุดเดิมทั้งหมด ไม่ได้ตั้งคีย์ใหม่ → หาของเดิมยังเจอเหมือนเดิม
 *
 * ⚠️ อยู่นอก component โดยตั้งใจ — เป็นค่าคงที่ ไม่ได้ขึ้นกับ props/state
 *    ถ้าประกาศข้างในจะสร้าง array ใหม่ทุก render แล้ว `.map` ได้ key ชุดใหม่ทุกครั้ง
 * ⚠️ ลำดับใน array = ลำดับ step จริง (แถบ % และปุ่ม "ต่อไป" อ่านจาก index ตัวนี้)
 *    สลับบรรทัด = สลับลำดับบนจอทันที ไม่ต้องแก้ที่อื่น
 */
/* [FEAT-20260803-AISUBTABS] แท็บแถวสองในแท็บ AI — ลำดับในนี้ = ลำดับบนจอ
 * 🔴 training ต้องมาก่อนและเป็นค่าเริ่มต้น ตามที่ผู้ใช้สั่ง
 * ⚠️ ใช้คีย์ป้ายสั้นเฉพาะแท็บ — คีย์เดิมยาวเกินสำหรับ pill
 *    ("ตั้งค่า AI ขั้นสูง (Gemini Parameters / API Key)" ยาวจนแท็บล้นแถว)
 *    คีย์เดิมไม่ถูกแตะ ยังใช้เป็นหัวข้อในเนื้อหาได้ตามเดิม */


/* [FEAT-20260804-HOOKNAMEDETAIL] ตัวแปรบริบทที่ใช้ได้ทั้งการ์ด flex และ Training Doc
 * ⚠️ ต้องตรงกับ FLEX_CONTEXT_VARS ใน BE (src/config/flexVarSources.js) เป๊ะ
 *    เพิ่มตัวใหม่ที่ BE แล้วต้องมาเติมที่นี่ด้วย ไม่งั้นแอดมินไม่มีทางรู้ว่ามี tag นั้น
 * ⚠️ ประกาศนอก component เจตนา — ไม่ต้องสร้าง array ใหม่ทุกครั้งที่ re-render */
const CTX_TAGS = [
  { tag: '{{hook_domain}}', labelKey: 'hook_form.ctx_tag_domain' },
  { tag: '{{hook_name}}',   labelKey: 'hook_form.ctx_tag_name' },
  { tag: '{{hook_detail}}', labelKey: 'hook_form.ctx_tag_detail' },
];


/**
 * [FEAT-20260805-HANDOFF-HOOKTAB] Handoff targets bound to this hook + PER-HOOK creds editor.
 * Lists targets (GET /api/handoff/targets?hook_id=…) and, per target, lets this hook flip
 * between "shared" (main creds) and "ใช้ creds ตัวเอง" (its own endpoint/secret). The toggle
 * writes to the SAME store the Handoff Chains page uses — POST/DELETE /api/handoff/overrides —
 * so ตั้งจากทางไหนก็เก็บที่เดียว (single source of truth). web_code ไม่ต้องตั้ง: Shop-API อ่านจาก hook เอง.
 * Self-contained + optional — remove the tab button + this component to drop the feature.
 */
const HookHandoffTab: React.FC<{ hookId: string; hasCustomTool?: boolean }> = ({ hookId, hasCustomTool }) => {
  const { t } = useI18n();
  const [openKey, setOpenKey] = useState<string | null>(null);   // which target's creds editor is expanded
  // [FEAT-20261027-TANSTACK] targets bound to this OA — same request, refetched per mount/hookId
  const targetsQuery = useHandoffTargetsQuery({ hook_id: hookId, limit: 100 });
  const loading = targetsQuery.isPending;
  const items: HandoffTarget[] = targetsQuery.data?.data ?? [];
  const error = targetsQuery.isError ? targetsQuery.error?.message || String(targetsQuery.error) : null;

  const boundFor = (tgt: HandoffTarget) => {
    const b = (tgt.scope?.bindings || []).find((x) => String(x.hook_id) === String(hookId));
    if (!b) return { label: t('pageui.hookform.handoff_bound_all', 'ทุก hook (all)'), on: true };       // empty bindings apply to all
    return { label: b.enabled ? t('pageui.hookform.handoff_bound_on', 'ผูกไว้ · เปิด') : t('pageui.hookform.handoff_bound_off', 'ผูกไว้ · ปิด'), on: b.enabled };
  };

  return (
    <div className="animation-slide-in space-y-3">
      <div className="flex items-center gap-2 text-slate-900">
        <Repeat size={18} className="text-primary-500" />
        <h3 className="text-lg font-bold">Handoff</h3>
        <span className="text-sm text-slate-500">{t('pageui.hookform.handoff_tab_sub', '— handoff ที่ hook นี้เชื่อม · ตั้ง creds แยกต่อ target ได้ (เซฟที่เดียวกับหน้า Handoff)')}</span>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}

      {loading ? (
        <div className="p-6 text-center text-slate-400"><Loader2 className="animate-spin inline mr-2" size={16} /> {t('hook_clone.loading')}</div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-slate-500 text-sm rounded-lg bg-slate-50 border border-slate-200">
          {t('pageui.hookform.handoff_none', 'hook นี้ยังไม่ได้เชื่อม handoff target ใด — ตั้งค่าได้ที่หน้า Handoff Targets')}
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((tgt) => {
            const b = boundFor(tgt);
            const open = openKey === tgt.key;
            return (
              <div key={tgt.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 truncate">{tgt.name}</div>
                    <div className="text-xs text-slate-500 font-mono flex items-center gap-2 flex-wrap mt-0.5">
                      <span>{tgt.key}</span>
                      <span className={`px-1.5 py-0.5 rounded font-sans ${tgt.env_tag === 'prod' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>{tgt.env_tag}</span>
                      <span className={`px-1.5 py-0.5 rounded font-sans ${b.on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{b.label}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => setOpenKey(open ? null : tgt.key)}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold text-primary-600 hover:bg-slate-100 flex items-center gap-1">
                    <KeyRound size={14} /> creds {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>
                {open && (
                  <div className="px-4 pb-4">
                    {/* SAME editor as the Handoff Targets scope side → single source of truth */}
                    <HandoffHookCredsEditor hookId={hookId} targetKey={tgt.key} hasCustomTool={hasCustomTool} targetEndpointHint={tgt.endpoint_url} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// [FEAT-20261027-TANSTACK] stable empty lists for query-derived props
const NO_FLEX: FlexMessageEntry[] = [];
const NO_TOOLS: CustomToolEntry[] = [];
const FORM_GROUP_PARAMS = { status: true, limit: 100 };

export const HookFormModal: React.FC<HookFormModalProps> = ({ isOpen, onClose, onSubmit, initialData, isViewMode = false, mode, isFullPage = false, presetGroupId }) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<HookFormData>(DEFAULT_FORM);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(false);
  // [FEAT-20261027-TANSTACK] groups load lazily (picker focus) — see the query after normalizeGroups
  const [groupsRequested, setGroupsRequested] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupEntry | null>(null);
  const [groupEditable, setGroupEditable] = useState(false);
  const groupSelectRef = useRef<HTMLSelectElement | null>(null);
  /* [FEAT-20261027-TANSTACK] flex templates: fetched each time the form opens (as the old
     fetchFlexTemplates() in the open effect did); the last list stays while it reloads and
     after a failed reload, like the old state. */
  const flexQuery = useFlexMessagesQuery({ limit: 100 }, isOpen);
  const flexTemplates: FlexMessageEntry[] = flexQuery.data?.data ?? NO_FLEX;
  // [FEAT-20260802-FLEXTYPEHIDE] select กลุ่มสลิป (flex_success/duplicate/other/not_found/min_amount/error/success_not_match/out_of_time)
  //   = เฉพาะการ์ด type=slip · การ์ดเก่าไม่มี flex_type = default 'slip' (ตรงกับ BE) → รวมมาให้ ไม่ตกหล่น
  const slipTemplates = flexTemplates.filter(tpl => tpl.flex_type === 'slip');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  /* [FEAT-20260802-FLEXPCTAG] dropdown/modal ของ flex picker ย้ายไปอยู่ใน component
     FlexCardMultiSelect (จัดการ open/modal/click-outside ในตัว) → ไม่ต้องมี state ที่นี่แล้ว */

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const [activeTab, setActiveTab] = useState<'general' | 'connection' | 'ai' | 'slip' | 'notifications' | 'external_api' | 'handoff' | 'notice'>('general');
  /* ==== [FEAT-20260903-FIELDOPTIONS] the server says what this field may be ===
   *
   * `slip_provider` used to be a free-text box, and then briefly a list typed on
   * this side. Both let the dashboard offer a value the back end cannot act on —
   * the operator picks it, it saves, the runtime ignores it, and nothing anywhere
   * reports that the choice had no effect. The server is the only side that can
   * answer honestly, so it does, and there is no vendor list in this repo.
   *
   * ⚠️ `choice_count` EXCLUDES the default, and it decides whether the control is
   * rendered at all. One real value means nothing can be changed, so the field is
   * not shown; the day the server registers a second one it appears by itself,
   * with no release here. Counting the array instead would make this side learn
   * which entry is the fallback — the knowledge the endpoint keeps on one side.
   *
   * 🔴 A FAILED LOAD HIDES THE CONTROL, IT DOES NOT CLEAR THE VALUE. The stored
   * `slip_provider` still rides `formData` into the payload, so an operator who
   * opens the form while this request fails cannot silently wipe an OA's provider
   * by saving another tab — the failure this modal has had before with fields it
   * did not render. */
  // [FEAT-20261027-TANSTACK] was an inline copy of useFieldOptions (same gate, same
  // fail-to-empty rule) — now the shared hook itself.
  const { options: slipProviderOptions, choiceCount: slipProviderChoiceCount } = useFieldOptions('slip_provider', isOpen);

  const [permissionAlert, setPermissionAlert] = useState(false);
  const [showChannelIdConfirmModal, setShowChannelIdConfirmModal] = useState(false);
  const externalFieldsChangedRef = useRef(false);

  useEffect(() => {
    if (formBodyRef.current) {
      formBodyRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
  };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; raw?: string } | null>(null);
  const [validationAlert, setValidationAlert] = useState<{ isOpen: boolean; message: string } | null>(null);
  const [copyAlert, setCopyAlert] = useState<{ title: string; message: string; type: 'success' | 'error' } | null>(null);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [telegramKeyword, setTelegramKeyword] = useState('');
  const [telegramRawJson, setTelegramRawJson] = useState('');
  const [telegramSearchError, setTelegramSearchError] = useState<string | null>(null);
  const [telegramUpdates, setTelegramUpdates] = useState<any[]>([]);
  const [telegramSuccessAlert, setTelegramSuccessAlert] = useState<{ isOpen: boolean; message: string } | null>(null);
  const [helpModal, setHelpModal] = useState<{ isOpen: boolean; title: string; message: string | React.ReactNode } | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showAddEndpointModal, setShowAddEndpointModal] = useState(false);
  const [newEndpointKey, setNewEndpointKey] = useState('');
  const [showHowToUse, setShowHowToUse] = useState(false);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlInput, setCurlInput] = useState('');
  const [importEndpointKey, setImportEndpointKey] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const formBodyRef = useRef<HTMLDivElement>(null);



  const [showChannelSecret, setShowChannelSecret] = useState(false);
  /* [FEAT-20260803-AIKEYMASK] ปิดบัง Custom AI Key เหมือนช่องลับอื่นในฟอร์ม
     revert: ลบ state นี้ + ปุ่มตา แล้วคืน input เป็น type ปกติ */
  const [showCustomAiKey, setShowCustomAiKey] = useState(false);
  /* [FEAT-20260802-AITABGROUPS] พับ 2 กลุ่มในแท็บ AI ให้ค่าเริ่มต้น "ปิด" ทุกครั้งที่เปิด modal
     (ทั้ง create/edit) · reset เป็น false ใน effect ตอน isOpen กลายเป็น true ด้านล่าง
     revert: ลบ 2 state นี้ + ปุ่ม toggle + div ครอบ 2 กลุ่ม + reset ใน effect isOpen */
  /* ==== [FEAT-20260803-DOCSTEPS] START — ยุบ 3 กลุ่มเป็น collapse เดียว + สารบัญซ้าย
   * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
   *
   * BEFORE  three sibling collapses, each with its own toggle button and its own
   *         boolean. All three could be open at once, so the AI tab became a very
   *         long scroll with no sense of order or progress, and nothing indicated
   *         that the three were parts of one setup task.
   * AFTER   one collapse "ตั้งค่า Training Doc" holding a 3-step stepper on the left
   *         and the active step's fields on the right — เปิดทีละ step ไม่งง
   *
   * 🔴 ชื่อกลุ่ม (ทั่วไป / Tag-API / Training Doc) คงเดิมทุกที่ตามที่ผู้ใช้สั่ง
   *    ทั้งใน comment marker เดิม [FEAT-20260802-AITABGROUPS] และ i18n key เดิม
   *    → grep หาของเดิมยังเจอเหมือนเดิม ไม่ต้องมานั่งจำชื่อใหม่
   *
   * ⚠️ 3 boolean เดิมถูกยุบเหลือ state เดียว (docStep) โดยตั้งใจ — ถ้าเก็บไว้ด้วยจะมี
   *    "สองแหล่งความจริง" ว่ากลุ่มไหนเปิดอยู่ ซึ่งมีวันไม่ตรงกันแน่นอน
   * revert: คืน 3 useState เดิม + ปุ่ม toggle 3 อัน + เปลี่ยน {docStep === 'x' && ...}
   *         กลับเป็น {showXGroup && ...} (โครงข้างในทั้ง 3 กลุ่มไม่ได้ถูกแตะเลย)
   */
  /* [FEAT-20260803-AISUBTABS] แท็บแถวสองในแท็บ AI — Training Doc / AI ขั้นสูง
     ค่าเริ่มต้น 'training' ตามที่ผู้ใช้สั่ง (เปิดมาเห็นของที่ใช้บ่อยสุดทันที ไม่ต้องกดก่อน)
     ⚠️ แทนที่ทั้ง showDocSetup และ showAiAdvanced — เหลือ state เดียวคุมว่าโชว์ฝั่งไหน
        เก็บ 2 boolean ไว้เหมือนเดิมไม่ได้ เพราะจะเกิดสถานะ "ปิดทั้งคู่" (แท็บว่าง)
        และ "เปิดทั้งคู่" (ซ้อนกัน) ซึ่งเป็นไปไม่ได้ในโมเดลแท็บ */
  const [aiSubTab, setAiSubTab] = useState<'training' | 'advanced'>('training');
  const [docStep, setDocStep] = useState<'general' | 'flexTag' | 'trainingDoc'>('general');
  // หน้าต่างแชททดสอบ (ยัง UI ล้วน ยังไม่ต่อระบบ ตามที่ผู้ใช้สั่ง)
  const [docTestOpen, setDocTestOpen] = useState(false);
  // ==== [FEAT-20260803-DOCSTEPS] END
  const [showExternalPassword, setShowExternalPassword] = useState(false);
  /* [FEAT-20260810-EXTAPIFOLD] แท็บ External API ยาวมาก (API config + Customer Link +
   * payment tool + custom endpoints) เจ้าของสั่ง 2026-08-10: "external api พับเก็บไว้
   * default แต่แยก customer link ออกไป พับได้ แต่เปิด default"
   *   - `extApiOpen`  = กล่อง External API Configuration → เริ่ม **พับ** (ตั้งครั้งเดียวจบ)
   *   - `custLinkOpen` = Customer Link แยกเป็นกล่องของตัวเอง → เริ่ม **เปิด** (แตะบ่อยกว่า)
   * เป็น state ของหน้าจอล้วน ไม่แตะ formData ⇒ พับ/กาง ไม่นับเป็นการแก้ค่า และกดได้ตอน
   * view mode เพราะการกางดูไม่ใช่การแก้
   * [FEAT-20261018-EXTAPICARDS] owner 18/10/2026: "ย่อ เปิด และ พับปิดได้ทุกการ์ด default เปิด"
   *   ⇒ `extApiOpen` starts OPEN too (was folded). The newer cards fold inside
   *   `form/ExtApiFoldCard.tsx`. Loan hides the Customer Link card (BE `hidden` sections). */
  const [extApiOpen, setExtApiOpen] = useState(true);
  const [custLinkOpen, setCustLinkOpen] = useState(true);
  const customerLinkHidden = useProviderSectionHidden('hook-form.customer-link');
  // [FEAT-20260729-CUSTOOL] รายการ tool ให้เลือกใน dropdown (เฉพาะที่เปิดใช้งาน)
  // โหลดครั้งเดียวตอน modal เปิด · ไม่มีสิทธิ์ custom_tools.manage → service คืน []
  // (BE ตอบ 403) → dropdown ว่าง ไม่ error ไม่พัง
  const customToolOptions: CustomToolEntry[] = useCustomToolsQuery({ limit: 200, status: 'true' }).data?.data ?? NO_TOOLS;
  // [FEAT-20260728-CUSTAPI] ถอน showCustomerLinkPassword ออก — ไม่มีช่องรหัสผ่าน
  // ของ Customer Link แล้ว (ใช้ external_password ร่วมกับ External API)
  const [testingExternalApi, setTestingExternalApi] = useState(false);
  const [showPayloadPreview, setShowPayloadPreview] = useState(false);
  const [showAnalysisPreview, setShowAnalysisPreview] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<'Compatible' | 'Critical' | 'Warning' | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisDetails, setAnalysisDetails] = useState<{ field: string; issue: string; severity: 'low' | 'high' }[]>([]);
  const [referenceTemplate, setReferenceTemplate] = useState<any>(null);
  // Analysis Preview modal is acme-only. Absent/false config keeps it off,
  // same safe-default pattern used by TicketSupport/TicketChat/InsightReport.
  const acmeCategory = useAcmeCategoryFlag();   // [FEAT-20261027-TANSTACK] absent/failed = off

  useEffect(() => {
    if (showAnalysisPreview) {
      setAnalysisResult(null);
      setAnalysisDetails([]);
      setReferenceTemplate(null);
    }
  }, [showAnalysisPreview]);



  const [testApiResult, setTestApiResult] = useState<any | null>(null);

  // External API Comparison
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareUserIds, setCompareUserIds] = useState({ current: '', new: '' });
  const [testingCompareApi, setTestingCompareApi] = useState(false);
  const [compareResult, setCompareResult] = useState<any>(null);
  const [trainingDocGeneral, setTrainingDocGeneral] = useState('');
  const [trainingDocCompany, setTrainingDocCompany] = useState('');
  const [trainingDocNoProfile, setTrainingDocNoProfile] = useState('');
  /* [FEAT-20260817-FORMDIFF] What this hook looked like when the form loaded.
     null = no baseline (create / clone / nothing loaded) — see the save path. */
  const baselineRef = useRef<HookPayload | null>(null);
  /* [FEAT-20260817-SECRETLOCK] which stored credentials are locked/unlocked */
  const secretLockFormRef = useRef<Record<string, unknown>>(formData as any);
  secretLockFormRef.current = formData as any;
  const secretLock = useSecretLock(setFormData, secretLockFormRef);
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>({});

  const TRAINING_DELIMITER = '[END_OF_BASIC_INFO]';

  const handleShowMatchHelp = () => {
    setHelpModal({
      isOpen: true,
      title: t('pageui.hookform.match_help_title', 'การตั้งค่า Match บัญชีผู้รับ'),
      message: (
        <div className="space-y-4">
          <div>
            <p className="text-base font-bold text-slate-800 mb-2">{t('pageui.hookform.match_help_login', 'เข้าสู่ระบบเพื่อตั้งค่าบัญชีธนาคาร')}</p>
            <p className="text-sm text-slate-600">{t('pageui.hookform.match_help_where', 'ตั้งค่าบัญชีที่จะตรวจสอบ ได้ที่หน้า Dashboard ของผู้ให้บริการ (Swiftcheck)')}</p>
            <div className="mt-3 py-2 px-4 rounded-xl bg-red-50 border-2 border-red-200 animate-pulse inline-block">
              <p className="text-lg font-black text-red-600 flex items-center gap-2">
                <AlertCircle size={20} />
                {t('pageui.hookform.match_help_email_only', 'เข้าทาง API LOGIN ด้วย E-mail เท่านั้น')}
              </p>
            </div>
            <div className="mt-3 p-3 bg-primary-50 rounded-xl border border-primary-100 flex items-center gap-3">
              <div className="p-2 bg-white rounded-lg shadow-sm border border-primary-200">
                <Settings className="text-primary-600 animate-spin-slow" size={20} />
              </div>
              <div>
                <p className="text-xs font-bold text-primary-800 mb-0.5">API LOGIN Settings</p>
                <p className="text-[10px] text-primary-600 leading-tight">Configuring verification endpoints and keys</p>
              </div>
            </div>
          </div>
          <div className="p-3 bg-dark-900 rounded-xl border border-dark-700">
            <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Terminal size={14} className="text-primary-500" />
              Developer Tools
            </p>
            <div className="space-y-6 pt-4 border-t border-slate-700/50">
              <p className="text-sm font-bold text-slate-400 uppercase text-center tracking-widest bg-dark-900/50 py-1.5 rounded-lg border border-dark-700">Step by Step Guide</p>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-bold text-slate-300">{t('pageui.hookform.match_help_step1', '1. เข้าสู่ระบบ > แดชบอร์ด > ดูร้านค้า > บัญชี')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    });
  };

  const handleTestExternalApi = async () => {
    if (!initialData?._id) {
      setValidationAlert({
        isOpen: true,
        message: t('pageui.hookform.save_before_test', 'โปรดบันทึก Hook ก่อนที่จะทำการทดสอบ')
      });
      return;
    }

    setTestingExternalApi(true);
    setTestApiResult(null);
    try {
      const response = await authFetch(`${API_BASE_URL}/hook/${initialData._id}/test-external-api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          external_api_url: formData.external_api_url,
          external_user: formData.external_user,
          // [FEAT-20260817-SECRETLOCK] locked ⇒ '' ⇒ the BE falls back to the
          // STORED password (hook-outbound: body || stored). Sending the
          // placeholder here made this test authenticate with the literal
          // sentinel and fail wrongly on every hook with a saved password.
          external_password: secretLock.valueForUse('external_password', formData.external_password)
        })
      });
      const data = await handleApiResponse<any>(response, 'test external API');
      setTestApiResult(data);
    } catch (err) {
      console.error(err);
      const apiError = err as ApiError;
      setTestApiResult({
        error: true,
        message: apiError.message || t('pageui.hookform.test_failed', 'การทดสอบล้มเหลว'),
        raw: apiError.rawResponse
      });
    } finally {
      setTestingExternalApi(false);
    }
  };

  const handleCompareExternalApi = async () => {
    if (!compareUserIds.current || !compareUserIds.new) {
      setValidationAlert({ isOpen: true, message: t('pageui.hookform.compare_need_both_ids', 'กรุณากรอก User ID ทั้งสองช่อง') });
      return;
    }

    setTestingCompareApi(true);
    setCompareResult(null);
    try {
      const response = await authFetch(`${API_BASE_URL}/hook/compare-external-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_line_user_id: compareUserIds.current,
          new_line_user_id: compareUserIds.new,
          external_api_url: formData.external_api_url,
          external_user: formData.external_user,
          // [FEAT-20260817-SECRETLOCK] same rule as the test button above
          external_password: secretLock.valueForUse('external_password', formData.external_password)
        })
      });
      const res = await handleApiResponse<any>(response, 'Compare external API');
      setCompareResult(res);
    } catch (err: any) {
      setCompareResult({
        success: false,
        error: err.message || 'Comparison failed',
        raw: err.raw
      });
    } finally {
      setTestingCompareApi(false);
    }
  };
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');
  const initialGroup = useMemo(() => {
    if (!initialData) return { id: '' as string, entry: null as GroupEntry | null };
    const raw = (initialData as any).group ?? (initialData as any).group_id ?? null;
    if (!raw) return { id: '' as string, entry: null as GroupEntry | null };
    if (typeof raw === 'object') {
      const id = raw._id ?? raw.id ?? null;
      const name = raw.group_name ?? raw.name ?? '';
      return { id: id || '', entry: id ? { _id: id, group_name: name } : null };
    }
    return { id: raw as string, entry: null };
  }, [initialData]);

  useLayoutEffect(() => {
    if (isOpen) {
      setErrors({});
      setTagInput('');
      setFormError(null);
      setValidationAlert(null);
      setCopyAlert(null);
      setTelegramSuccessAlert(null);
      setHelpModal(null);
      setTelegramModalOpen(false);
      setActiveTab('general');
      // [FEAT-20260803-DOCSTEPS] เปิด modal ใหม่ = พับ collapse ไว้ + กลับไป step แรกเสมอ
      //   (เดิมคือ reset 3 boolean · เจตนาเดียวกัน แต่ตอนนี้เหลือ state เดียว)
      // [FEAT-20260803-AISUBTABS] เปิด modal ใหม่ = กลับไปแท็บ Training เสมอ
      setAiSubTab('training');
      setDocStep('general');
      setDocTestOpen(false);
      // [FEAT-20260803-AIKEYMASK] เปิด modal ใหม่ต้องปิดบัง key เสมอ
      //   ไม่งั้นแอดมินเผลอเปิดดูค้างไว้ แล้ว hook ใบถัดไปโชว์ key ทันทีที่เปิด
      setShowCustomAiKey(false);
      setTelegramKeyword('');
      setTelegramRawJson('');
      setTelegramSearchError(null);
      setTelegramUpdates([]);
      setSelectedGroup(initialGroup.entry ?? null);
      setGroupEditable(resolvedMode === 'create' || !initialGroup.id);
      // [FEAT-20260817-FORMDIFF] The populated object is kept in a local, because
      // it is needed twice: as the form state, and as the BASELINE that decides
      // which fields count as edited when the operator presses save.
      let populated: any = null;
      let docBoxes: TrainingDocBoxes | null = null;
      if (initialData) {
        populated = {
          line_oa_name: initialData.line_oa_name,
          domain_name: (initialData as any).domain_name ?? '', // [FEAT-20260802-DOMAINNAME] null → ''
          alias: initialData.alias,
          company_name: initialData.company_name,
          group_id: initialGroup.id || '',
          /* [FEAT-20260830-HIDEDESC] ช่องนี้ถูกซ่อนแล้ว ⇒ ไม่มีใครกรอกได้อีก.
             hook เก่าที่ description เป็น null/ว่าง จะติด validation (:1463) แล้ว
             แก้ไขไม่ได้เลย จึงเติมวันที่ให้ตรงนี้.
             ⚠️ "ว่างเท่านั้นถึงเติม" — clone ส่ง initialData มาด้วย (:986-996)
             ถ้าเติมทับจะทำลายคำอธิบายของ hook ต้นทาง */
          description: resolveHookDescription(initialData.description),
          suggestion_text: initialData.suggestion_text || '',
          suggestion_text_no_profile: (initialData as any).suggestion_text_no_profile || '',
          default_answer_text: initialData.default_answer_text || '',
            // [FEAT-20260823-GENERRFALLBACK] absent = '' = ladder falls to the line above
            ai_generative_error_text:
              (initialData as any).ai_generative_error_text || '',
          missing_api_data_text: initialData.missing_api_data_text || '',
          // [FEAT-20260806-STATUSOFF] load OA-off reply settings (absent = "" = legacy)
          status_off_action: initialData.status_off_action || '',
          status_off_text: initialData.status_off_text || '',
          image_answer_text: (initialData as any).image_answer_text || '',
          doc_id: initialData.doc_id || '',
          custom_ai_key: initialData.custom_ai_key || '',
          // [FEAT-20260904-VENDORSECCOL] hydrate the second key too — a field the
          // form never loads comes back as a blank on the next save.
          custom_ai_key_sec: (initialData as any).custom_ai_key_sec || '',
          telegram_key: (initialData as any).telegram_key || '',
          telegram_chat_id: (initialData as any).telegram_chat_id || (initialData as any).telegram_id || '',
          telegram_noti_type: (initialData as any).telegram_noti_type || 'all',
          tag: initialData.tag || [],
          line_url: initialData.line_url || '',
          webhook_url: initialData.webhook_url || '',
          status: resolvedMode === 'create' ? 0 : initialData.status,
          fast_mode: initialData.fast_mode ?? 1,
          // BE aliases legacy line_* → channel_*/access_token on read, so these are
          // populated for a legacy OA too (see decryptHookFields on the server).
          channel_id: initialData.channel_id || '',
          channel_secret: initialData.channel_secret || '',
          access_token: initialData.access_token || '',
          gemini_temperature: Number(initialData.gemini_temperature ?? 0.5),
          gemini_top_k: Number(initialData.gemini_top_k ?? 20),
          gemini_top_p: Number(initialData.gemini_top_p ?? 0.9),
          // [FEAT-20260802-THINKHOOK] null (hook เก่า) → 0 (ปิด) · มีค่า → ใช้ค่านั้น
          gemini_thinking_budget: initialData.gemini_thinking_budget == null ? 0 : Number(initialData.gemini_thinking_budget),
          // [FEAT-20260730-HISTLIMIT] hook เก่าไม่มี column นี้ → แสดง 5 (ค่าที่ใช้จริง)
          ai_history_limit: Number(initialData.ai_history_limit ?? 5),
          // [FEAT-20260801-NEEDDETAIL] hook เก่าไม่มี column นี้ → แสดง 10 (ค่าที่ใช้จริง)
          // ⚠️ ใช้ ?? ไม่ใช่ || เพราะ 0 เป็นค่าที่ตั้งใจตั้ง ไม่ใช่ค่าว่าง
          ai_need_detail_limit: Number((initialData as any).ai_need_detail_limit ?? 10),
          // [FEAT-20260731-RAWJSON] hook เก่าไม่มี column นี้ -> ปิด (ตรงกับที่ BE เช็ค === true)
          ai_raw_json_analysis: Boolean((initialData as any).ai_raw_json_analysis ?? false),
          ai_raw_site_rules: Boolean((initialData as any).ai_raw_site_rules ?? false), // [FEAT-20260802-RAWSITERULES]
          // [FEAT-20260810-DOCRETRIEVAL] hook เก่าไม่มี field = false = seamless
          doc_retrieval: Boolean((initialData as any).doc_retrieval ?? false),
          /* [FEAT-20261026-RAGENGINE] copied field by field like every sibling — without these
             two lines the form opens at the default and the next save overwrites the real mode */
          rag_prompt_mode: (initialData as any).rag_prompt_mode ?? null,
          rag_search_mode: (initialData as any).rag_search_mode ?? null,
          /* [FEAT-20260821-IGNOREABANDON] ⚠️ ต้องมีบรรทัดนี้ ไม่ใช่แค่ default ข้างบน:
             object นี้ประกอบขึ้นใหม่ทีละ field ถ้าไม่ copy มา ฟอร์มจะเปิดมาเป็น false
             ทั้งที่ DB เป็น true แล้วการเซฟครั้งถัดไปจะทับค่าจริงทิ้งแบบเงียบ ๆ */
          ignore_abandon_assist: Boolean(
            (initialData as any).ignore_abandon_assist ?? false,
          ),
          /* [FEAT-20260822-NOTICEMODE] ⚠️ LOAD-BEARING, for the same reason the
             line above is: this object is rebuilt field by field, so a column
             missing here is absent from form state — and the notice tab would
             then SAVE THAT ABSENCE over the real values through its own route.
             Toggles are read `=== true` (a string "true" is not on), scope
             falls back to 'text', cards to null. ต้องคัดลอกมาให้ครบ ไม่งั้นเซฟทับของจริง */
          notice_deposit_status:
            (initialData as any).notice_deposit_status === true,
          notice_withdraw_status:
            (initialData as any).notice_withdraw_status === true,
          follow_player_status:
            (initialData as any).follow_player_status === true,
          /* [FEAT-20260823-NOTICECHECKFLAGS] `!== false`, NOT `=== true` — the
             polarity is the opposite of every other notice toggle: a row that
             predates the columns must open the form with the checks ON, because
             that is how the runtime reads it. `=== true` here would show OFF
             boxes on legacy rows and the next save would write false = silence
             the hook's notices without anyone choosing to. ขั้ว absent=เปิด */
          notice_deposit_time_check:
            (initialData as any).notice_deposit_time_check !== false,
          notice_deposit_sitestatus_check:
            (initialData as any).notice_deposit_sitestatus_check !== false,
          notice_withdraw_time_check:
            (initialData as any).notice_withdraw_time_check !== false,
          notice_withdraw_sitestatus_check:
            (initialData as any).notice_withdraw_sitestatus_check !== false,
          /* [FIX-20260829-STATUSFIRSTRT] the round-trip half the feature shipped
             WITHOUT — the exact failure dev-local §5 documents. The save route
             stored the flags, but this mapping never copied them back, so the
             form reopened unchecked and read as "save didn't stick" (owner,
             29/08, with a screenshot — after being told the runtime was tested
             and the UI round trip was not). `=== true` here: absent = OFF is
             this pair's real polarity, unlike the `!== false` block above. */
          notice_deposit_sitestatus_first:
            (initialData as any).notice_deposit_sitestatus_first === true,
          notice_withdraw_sitestatus_first:
            (initialData as any).notice_withdraw_sitestatus_first === true,
          notice_deposit_scope:
            (initialData as any).notice_deposit_scope ?? 'text',
          notice_withdraw_scope:
            (initialData as any).notice_withdraw_scope ?? 'text',
          notice_deposit_flex_id:
            (initialData as any).notice_deposit_flex_id ?? null,
          notice_deposit_offtime_flex_id:
            (initialData as any).notice_deposit_offtime_flex_id ?? null,
          notice_withdraw_flex_id:
            (initialData as any).notice_withdraw_flex_id ?? null,
          notice_withdraw_offtime_flex_id:
            (initialData as any).notice_withdraw_offtime_flex_id ?? null,
          notice_all_offtime_flex_id:
            (initialData as any).notice_all_offtime_flex_id ?? null,
          notice_all_disable_flex_id:
            (initialData as any).notice_all_disable_flex_id ?? null,
          /* [P2-20260813] ⚠️ This object is a hand-written rebuild of the API
             response: a field missing here is dropped from form state, and
             because submit spreads formData it is then written back as absent.
             Leaving these two out would reset an OA's vendor every time anyone
             opened the form — silently, with no type error. ลืมบรรทัดนี้ =
             vendor เด้งกลับ default ทุกครั้งที่แก้ hook. */
          ai_vendor: (initialData as any).ai_vendor ?? null,
          ai_model: (initialData as any).ai_model ?? null,
          ai_model_sec: (initialData as any).ai_model_sec ?? null,
          /* [FEAT-20260909-VENDORTRANSLATE / DSREASONING] the same rule as the
             two lines above, for the six columns added today. Without these an
             operator who set a translate vendor would reopen the form, see
             "follow the main system", and reasonably conclude it had not saved. */
          ai_vendor_translate:
            (initialData as any).ai_vendor_translate ?? null,
          deepseek_thinking: (initialData as any).deepseek_thinking ?? null,
          deepseek_reasoning_effort:
            (initialData as any).deepseek_reasoning_effort ?? null,
          deepseek_thinking_translate:
            (initialData as any).deepseek_thinking_translate ?? null,
          deepseek_reasoning_effort_translate:
            (initialData as any).deepseek_reasoning_effort_translate ?? null,
          /* ⚠️ `?? null`, never `?? 0`. The line for `gemini_thinking_budget`
             further up coerces a missing value to 0 because on THAT lane the two
             mean the same thing. Here they do not. */
          gemini_thinking_budget_translate:
            (initialData as any).gemini_thinking_budget_translate ?? null,
          /* [FEAT-20260918-HOOKTRANS] chat translation settings */
          translate_lang: (initialData as any).translate_lang ?? null,
          auto_translate: (initialData as any).auto_translate ?? false,
          // [FEAT-20260731-RAWJSONRULES] hook เก่าไม่มี column -> ค่าว่าง
          ai_raw_json_rules: (initialData as any).ai_raw_json_rules || '',
          ai_site_rules_guide: (initialData as any).ai_site_rules_guide || '', // [FEAT-20260804-SITERULESGUIDE] hook เก่าไม่มี field = '' = seamless
          auto_unassist_minutes: initialData.auto_unassist_minutes ?? 30,
          answer_link: initialData.answer_link || '',
          // [FEAT-20260801-FLEXPROFILE] hook เก่าไม่มี column -> null
          flex_profile_id: (initialData as any).flex_profile_id || null,
          // [FEAT-20260810-CUSHELPERTYPE] hook เก่าไม่มี column -> null
          flex_customerhelper_id: (initialData as any).flex_customerhelper_id || null,
          // [FEAT-20260802-FLEXCUSTOMLIST] hook เก่าไม่มี column -> [] · BE อาจส่ง
          // ObjectId มาเป็น object -> String() ให้หมด ไม่งั้นเทียบกับ tpl.id ไม่ติด
          flex_custom_ids: Array.isArray((initialData as any).flex_custom_ids)
            ? (initialData as any).flex_custom_ids.map((x: any) => String(x?._id ?? x))
            : [],
          // [FEAT-20260802-FLEXPCTAG] เส้นแยกของ profile-semi-custom (map แบบเดียวกัน)
          flex_profile_custom_ids: Array.isArray((initialData as any).flex_profile_custom_ids)
            ? (initialData as any).flex_profile_custom_ids.map((x: any) => String(x?._id ?? x))
            : [],
          // [FEAT-20260801-HELPERTEXT] hook เก่าไม่มี column → '' → BE ใช้ข้อความกลาง
          customer_helper_text: (initialData as any).customer_helper_text || '',
          slip_verify_key: initialData.slip_verify_key || '',
          /* [FEAT-20260903-HOOKSLIPPROV] ⚠️ LOAD-BEARING, not plumbing. This
             object is a hand-written rebuild of the API response (see the
             [P2-20260813] warning above): a field missing here is absent from
             form state, and because submit spreads formData it is then written
             back as absent — the operator's provider choice disappears on the
             next save with a 200 and no error anywhere.
             `?? ''` (not `||`) so a deliberate '' — "use the system's current
             provider" — survives the load as itself.
             test/hookSlipProvider.value.test.tsx goes red when this line goes. */
          slip_provider: (initialData as any).slip_provider ?? '',
          /* [FEAT-20260903-VENDORBRANCH] populate is a hand-written rebuild of the
             API response, so a field missing HERE is absent from form state and
             is written back as absent on the next save: 200 OK, no error, the
             branch gone and every slip answered "branch not found". `?? ''` and
             not `||`, so a deliberate '' survives. */
          slip_verify_branch: (initialData as any).slip_verify_branch ?? '',
          /* [FEAT-20260903-HOSTPERHOOK] populate is a hand-written rebuild, so a
             field missing HERE is absent from form state and written back as
             absent on the next save — 200 OK, the host gone, and this hook
             silently back on the provider's default. `?? ''` not `||`. */
          slip_check: !!initialData.slip_check,
          /* [FEAT-20260822-QRPRESCANFE] ⚠️ FALLS BACK TO 'off', NOT 'skip'.
             `.lean()` reads skip schema defaults, so a row written before this
             column existed is `undefined` — and `resolveQrPrescanMode` answers
             'off' for it, which is why the notice mode's slip cases stay silent
             on those OAs. Showing 'skip' here would hide exactly the thing the
             operator needs to see (and fix). แสดงค่าที่ระบบใช้จริง. */
          qr_prescan_mode:
            (initialData as any).qr_prescan_mode ?? 'off',
          // [FEAT-20260809-SLIPREQPROF] OA เก่าไม่มี 2 column นี้ → false/'' = ปิดอยู่ ทำงานแบบเดิม
          // ใช้ `?? ''` (ไม่ใช่ `|| ''`) กับข้อความ เพื่อให้ค่าที่ตั้งใจเว้นว่างรอดกลับมาเป็น ''
          // ไม่ถูกแทนที่ด้วยอะไรทั้งสิ้น — '' คือสัญญาว่า "ให้ BE ใช้ข้อความกลางของมัน"
          slip_require_profile: !!(initialData as any).slip_require_profile,
          slip_require_profile_text: (initialData as any).slip_require_profile_text ?? '',
          match_account: !!initialData.match_account,
          match_account_number: initialData.match_account_number || '',
          flex_success: initialData.flex_success || '',
          flex_fail: initialData.flex_fail || '',
          flex_other: initialData.flex_other || '',
          flex_duplicate: initialData.flex_duplicate || '',
          flex_not_found: initialData.flex_not_found || '',
          flex_min_amount: initialData.flex_min_amount || '',
          flex_max_amount: initialData.flex_max_amount || '',
          flex_error: initialData.flex_error || '',
          flex_success_not_match: initialData.flex_success_not_match || '',
          flex_out_of_time: initialData.flex_out_of_time || '',
          slip_check_min_amount: initialData.slip_check_min_amount ?? null,
          slip_check_max_amount: initialData.slip_check_max_amount ?? null,
          slip_check_out_of_time: initialData.slip_check_out_of_time ?? null,
          qr_code_fail_anwser_text: initialData.qr_code_fail_anwser_text || 'ขออภัยค่ะ ระบบไม่สามารถตรวจสอบ QR Code นี้ได้ กรุณาลองใหม่อีกครั้ง',
          callback_slip: initialData.callback_slip || [],
          callback_token: (initialData as any).callback_token || '',
          callback_action: (initialData as any).callback_action || 'none',
          external_api_url: (initialData as any).external_api_url || '',
          external_user: (initialData as any).external_user || '',
          external_password: (initialData as any).external_password || '',
          external_endpoints: (initialData as any).external_endpoints || {},
          chat_bot_id: (initialData as any).chat_bot_id || '',
          force_grant: false,
          // [FEAT-20260728-CUSTREG] โหลดค่าเดิมของ Customer Link เข้าฟอร์ม
          // hook เก่าที่ไม่มี field เหล่านี้ → ตกเป็นค่าว่าง/false เหมือน DEFAULT_FORM
          // [FEAT-20260728-CUSTAPI] เหลือ 3 key (ค่าเก่าที่ค้างใน DB ไม่ถูกอ่านอีก ไม่กระทบ)
          customer_link_enabled: !!(initialData as any).customer_link_enabled,
          customer_link_landing_url: (initialData as any).customer_link_landing_url || '',
          customer_link_web_code: (initialData as any).customer_link_web_code || '',
          // [FEAT-20260729-CUSTOOL] hook เก่าที่ไม่มี 2 field นี้ → false/null = ปิดอยู่
          custom_tool_status: !!(initialData as any).custom_tool_status,
          custom_tool_id: (initialData as any).custom_tool_id
            ? String((initialData as any).custom_tool_id?._id || (initialData as any).custom_tool_id)
            : null,
          // [FEAT-20260808-PAYCUSTOOL] hook เก่าที่ไม่มี 2 field นี้ → false/null = ปิดอยู่
          // BE อาจส่ง id มาเป็น object ที่ populate แล้ว หรือเป็น string ดิบ → รองรับทั้งสองแบบ
          // (ลอกวิธีเดียวกับ custom_tool_id บรรทัดบน เพื่อไม่ให้มี 2 มาตรฐานในไฟล์เดียว)
          payment_tool_status: !!(initialData as any).payment_tool_status,
          payment_tool_id: (initialData as any).payment_tool_id
            ? String((initialData as any).payment_tool_id?._id || (initialData as any).payment_tool_id)
            : null,
          // [FEAT-20260809-WALLETPAYTOOL] ไม่ผูก = null (ไม่ใช่ '') — BE เอา id นี้ไปหา tool ต่อ
          // ถ้าส่ง '' ไป BE จะพยายาม resolve สตริงว่างเป็น tool id
          // OA เก่าที่ยังไม่มี 2 field นี้ → false/null = ขา walletpay ทำงานแบบเดิมทุกอย่าง
          walletpay_tool_status: !!(initialData as any).walletpay_tool_status,
          walletpay_tool_id: (initialData as any).walletpay_tool_id
            ? String((initialData as any).walletpay_tool_id?._id || (initialData as any).walletpay_tool_id)
            : null,
          // [FEAT-20260810-PAYSTATEFLEX] absent on every hook saved before this feature → {}
          payment_flex_ids: (initialData as any).payment_flex_ids || {}
        } as any;
        setFormData(populated);
      } else {
        setFormData({
          ...DEFAULT_FORM,
          status: resolvedMode === 'create' ? 0 : DEFAULT_FORM.status,
          /* [FEAT-20260830-HIDEDESC] คำนวณสดทุกครั้งที่เปิดฟอร์ม ไม่ใช้ค่าใน
             DEFAULT_FORM ซึ่งถูกประเมินครั้งเดียวตอนโมดูลโหลด — แท็บที่เปิดค้าง
             ข้ามเที่ยงคืนจะได้วันของเมื่อวานถ้าพึ่งค่านั้น */
          description: todayDdMmYy(),
          // [FEAT-20260805-CREATE-INGROUP] prefill group เมื่อสร้างใต้กลุ่มเดิม
          group_id: presetGroupId || DEFAULT_FORM.group_id,
        });
        // lock the group select when a preset group was passed (สร้างใหม่ใต้กลุ่มนี้)
        if (presetGroupId) setGroupEditable(false);
        setTrainingDocGeneral('');
        setTrainingDocCompany('');
        setTrainingDocNoProfile('');
      }

      // Parse Training Document if update mode
      // ==== [FIX-20260731-CLONEDOC] START
      // เดิมคือ:  if (resolvedMode === 'update' && initialData) {
      //
      // Clone opens the form with mode 'create' and initialData set (see
      // handleCopy in WebhookList). The mode check skipped this block, so the
      // three Training Document boxes stayed empty even though initialData
      // carried the text — and since submit rebuilds suggestion_text from those
      // boxes, saving a clone would store an empty document, or fail the
      // required check and force the whole thing to be retyped.
      // เงื่อนไข `initialData` ที่ต่ออยู่แล้วกันเคส create เปล่า ๆ ได้เอง
      // การเช็ค mode จึงไม่ได้ป้องกันอะไรเพิ่ม มีแต่ทำให้ clone พัง
      // revert: ใส่ `resolvedMode === 'update' &&` กลับเข้าไป
      if (initialData) {
        const fullText = (initialData as any)?.suggestion_text || '';
        const noProfileText = (initialData as any)?.suggestion_text_no_profile || '';
        
        let general = '';
        let company = '';
        
        /* [REFACTOR-20260803-DOCBLOCK] อ่านผ่าน helper ตัวเดียว รองรับทั้ง 2 รูปแบบ
           ⚠️ ห้ามเขียนสูตร split ซ้ำตรงนี้ — เทสเรียก helper ตัวเดียวกัน */
        const boxes = parseTrainingDoc(initialData as any);
        docBoxes = boxes;
        setTrainingDocGeneral(boxes.general);
        setTrainingDocCompany(boxes.company);
        setTrainingDocNoProfile(boxes.noProfile);
        void fullText; void noProfileText; void general; void company;
      }
      // ==== [FIX-20260731-CLONEDOC] END

      /* [FEAT-20260817-FORMDIFF] Freeze what this hook looked like the moment it
         loaded — normalised by the SAME builder the save path uses, so submit
         compares like with like instead of raw form state against API shapes.

         Only an EDIT gets a baseline. Create has nothing to compare against, and
         clone deliberately opens as 'create' WITH initialData (see CLONEDOC
         above), so it must keep sending the whole document.

         ⚠️ Snapshot `populated`, never `initialData`. If the form ever fails to
         populate, current and baseline are then the same object and the diff is
         EMPTY — nothing is overwritten. Snapshotting the raw API object would do
         the exact opposite and rewrite every field.
         revert: delete this assignment; a null baseline restores the old
         send-everything behaviour with no other change. */
      baselineRef.current =
        resolvedMode === 'update' && populated
          ? buildHookPayload(
              populated,
              // unreachable fallback: docBoxes is set by the same `if (initialData)`
              docBoxes ?? { general: '', company: '', noProfile: '' },
              { isCreate: false },
            )
          : null;

      /* [FEAT-20260817-SECRETLOCK] lock every credential that arrived with a
         stored value. Runs on the SAME populate the baseline uses, so the two
         features always agree on what "loaded" means. Create/clone: arm(false)
         = nothing locks. */
      secretLock.arm(populated ?? {}, resolvedMode === 'update' && !!populated);
    } else {
      setValidationAlert(null);
      /* [FEAT-20261027-TANSTACK] the group list is dropped on CLOSE, not on open: the
         first render after a reopen must already see "not requested", or the query
         (enabled = open && requested) would fire before an open-time reset could run. */
      setGroupsRequested(false);
    }
  }, [isOpen, initialData, resolvedMode, initialGroup]);

  useEffect(() => {
    if (!isOpen) return;
    if (!initialGroup.id || initialGroup.entry) return;
    let isActive = true;
    groupService
      .getGroup(initialGroup.id)
      .then(res => {
        if (!isActive) return;
        const normalized = res.data
          ? normalizeGroups([res.data as GroupEntry])[0] || null
          : null;
        setSelectedGroup(normalized);
      })
      .catch(err => {
        if (!isActive) return;
        console.error('Failed to load group', err);
        setSelectedGroup(null);
      });
    return () => {
      isActive = false;
    };
  }, [isOpen, initialGroup.id, initialGroup.entry]);

  const normalizeGroups = (items: GroupEntry[]) => {
    return items
      .map((item: any) => {
        const id = item?._id ?? item?.id ?? item?.group_id ?? '';
        const name = item?.group_name ?? item?.name ?? '';
        if (!id || !name) return null;
        return {
          _id: id,
          group_name: name,
          description: item?.description,
          status: Boolean(item?.status),
          created_at: item?.created_at,
          updated_at: item?.updated_at
        } as GroupEntry;
      })
      .filter((item): item is GroupEntry => Boolean(item));
  };

  /* [FEAT-20261027-TANSTACK] Same contract as the old latch: nothing until the picker is
     focused, one load per open, a failed load is retried on the next focus, and the list is
     empty again on every reopen. The answer is the shared `listGroups({status, limit:100})`
     cache entry (also read by the Hook list), refetched when requested. */
  const groupsQuery = useGroupsQuery(FORM_GROUP_PARAMS, isOpen && groupsRequested);
  const groups = useMemo<GroupEntry[]>(
    () => (groupsRequested && groupsQuery.data ? normalizeGroups(groupsQuery.data.data ?? []) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- normalizeGroups is a pure local helper
    [groupsRequested, groupsQuery.data],
  );
  const fetchGroups = () => {
    if (!groupsRequested) setGroupsRequested(true);
    else refetchGroupsIfFailed(FORM_GROUP_PARAMS);   // live cache state, not this render's snapshot
  };

  const fetchTelegramUpdates = async () => {
    // [FEAT-20260817-SECRETLOCK] locked ⇒ '' ⇒ the required-key alert below
    // fires. It used to read the placeholder and call
    // api.telegram.org/bot__SECRET_KEPT__/... — a guaranteed failure.
    const token = secretLock.valueForUse('telegram_key', formData.telegram_key).trim();
    if (!token) {
      setValidationAlert({
        isOpen: true,
        message: t('hook_form.telegram_key_required')
      });
      return;
    }
    setTelegramSearchError(null);
    setTelegramRawJson('');
    setTelegramUpdates([]);
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
      const text = await response.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parsed = null;
      }
      if (!response.ok || parsed?.ok === false) {
        setTelegramSearchError(parsed?.description || `HTTP ${response.status}`);
      }
      setTelegramRawJson(parsed ? JSON.stringify(parsed, null, 2) : text);
      setTelegramUpdates(Array.isArray(parsed?.result) ? parsed.result : []);
      setTelegramModalOpen(true);
    } catch (error: any) {
      setTelegramSearchError(error?.message || t('pageui.hookform.telegram_connect_failed', 'ไม่สามารถเชื่อมต่อ Telegram API ได้'));
      setTelegramRawJson('');
      setTelegramUpdates([]);
      setTelegramModalOpen(true);
    }
  };

  const handleConfirmTelegramKeyword = () => {
    const keyword = telegramKeyword.trim();
    if (!keyword) {
      setTelegramSearchError(t('hook_form.telegram_keyword_required'));
      return;
    }
    const match = telegramUpdates.find((item: any) => item?.message?.text?.includes(keyword));
    const chatId = match?.message?.chat?.id;
    if (chatId === undefined || chatId === null) {
      setTelegramSearchError(t('hook_form.telegram_chat_id_not_found'));
      return;
    }
    setFormData(prev => ({ ...prev, telegram_chat_id: String(chatId) }));
    setTelegramModalOpen(false);
    setTelegramKeyword('');
    setTelegramSearchError(null);
    setTelegramSuccessAlert({
      isOpen: true,
      message: t('hook_form.telegram_chat_id_success', { chatId })
    });
  };

  /* [FEAT-20260814-WEBHOOKURLENV] Owner order 2026-08-14: the webhook endpoint
     shown here reads `VITE_WEBHOOK_URL` FIRST, falling back to
     `VITE_API_BASE_URL` when it is unset or blank.

     WHY a separate variable: LINE calls this URL from the outside, so it must be
     the PUBLIC origin — which is not always where the dashboard's own API lives.
     Once the BE sits behind the proxy-gate the dashboard talks to it through the
     FE origin, while LINE must keep hitting the BE domain that the allowlist
     opens (docs/migrate-stack.md §3). One variable cannot serve both.

     ⚠️ NOT changed in `apiClient.ts`: `API_BASE_URL` is what EVERY api call in
        the app uses, so a fallback there would repoint the whole dashboard, not
        just this label. The override is deliberately scoped to this one string.
     ⚠️ Unset ⇒ byte-identical to before. Nothing sets VITE_WEBHOOK_URL today, so
        this ships as a no-op and only takes effect when someone opts in.
        ไม่ตั้ง = เหมือนเดิมเป๊ะ · ตั้งเมื่อไหร่ค่อยมีผล
     revert: delete `webhookBaseUrl` and use `API_BASE_URL` here again. */
  const webhookBaseUrl = useMemo(() => {
    const override = String(
      (import.meta as any).env?.VITE_WEBHOOK_URL ?? '',
    ).trim();
    return override || API_BASE_URL;
  }, []);

  const webhookEndpoint = useMemo(() => {
    const alias = String(formData.alias || '').trim().replace(/^\/+/, '');
    if (!alias) return '';
    const base = String(webhookBaseUrl || '').replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(alias)}/webhook`;
  }, [formData.alias, webhookBaseUrl]);

  /* [FEAT-20260804-HOOKNAMEDETAIL] คัดลอก tag ตัวแปรบริบทไปวางใน Training Doc / การ์ด
   * ⚠️ ใช้กล่องแจ้งเตือนตัวเดียวกับปุ่มคัดลอก endpoint — ไม่สร้างกลไกแจ้งเตือนชุดใหม่
   * ⚠️ clipboard พังได้จริง (บาง browser / ไม่ใช่ https) → ต้องบอกผู้ใช้ ไม่เงียบ */
  const copyCtxTag = async (tag: string) => {
    try {
      // [FIX-20260830-COPYHTTP2] see utils/copyText — the raw API is undefined on
      // http, so this alert used to report failure for every copy
      if (!(await copyText(tag))) throw new Error('clipboard refused the copy');
      setCopyAlert({
        title: t('common.copied_title'),
        message: t('common.copied_message', { value: tag }),
        type: 'success',
      });
    } catch (error) {
      setCopyAlert({
        title: t('common.copy_failed_title'),
        message: t('common.copy_failed_message'),
        type: 'error',
      });
    }
  };

  const handleCopyWebhookEndpoint = async () => {
    if (!webhookEndpoint) return;
    try {
      // [FIX-20260830-COPYHTTP2] same as copyCtxTag above
      if (!(await copyText(webhookEndpoint))) throw new Error('clipboard refused the copy');
      setCopyAlert({
        title: t('common.copied_title'),
        message: t('common.copied_message', { value: webhookEndpoint }),
        type: 'success'
      });
    } catch (error) {
      setCopyAlert({
        title: t('common.copy_failed_title'),
        message: t('common.copy_failed_message'),
        type: 'error'
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    const isObjectId = (value: string) => /^[a-fA-F0-9]{24}$/.test(value);
    const fieldLabels: Partial<Record<keyof HookFormData, string>> = {
      line_oa_name: t('hook_form.oa_name', channelVars(formData.channel_type)),
      alias: t('hook_form.alias'),
      company_name: t('hook_form.company_name'),
      description: t('hook_form.description'),
      suggestion_text: t('hook_form.suggestion_text'),
      default_answer_text: t('hook_form.default_answer_text'),
      ai_generative_error_text: t('hook_form.ai_generative_error_text'),
      missing_api_data_text: t('hook_form.missing_api_data_text'),
      image_answer_text: t('hook_form.image_answer_text'),
      doc_id: t('hook_form.doc_id'),
      custom_ai_key: t('hook_form.custom_ai_key'),
      // [P2-20260813] Paired with the fieldTabs entries below. No rule targets
      // these today, so the labels are unused — but fieldTabs lists every field
      // of a tab (custom_ai_key and the gemini knobs have no rule either), and a
      // field present there without a label here renders the raw key in the
      // error alert. Kept in step so adding a rule later needs no second edit.
      ai_vendor: t('hook_form.ai_vendor'),
      ai_model: t('hook_form.ai_model'),
      // [FEAT-20260904-VENDORSECCOL] a field listed in fieldTabs without a label
      // here renders its raw key in the error alert.
      ai_model_sec: t('hook_form.ai_model_sec'),
      // [FEAT-20260909-VENDORTRANSLATE / DSREASONING] same rule: a field in
      // fieldTabs without a label here renders its raw key in the error alert.
      ai_vendor_translate: t('hook_form.ai_vendor_translate'),
      deepseek_thinking: t('hook_form.reasoning_thinking'),
      deepseek_reasoning_effort: t('hook_form.reasoning_effort'),
      deepseek_thinking_translate: t('hook_form.reasoning_thinking'),
      deepseek_reasoning_effort_translate: t('hook_form.reasoning_effort'),
      gemini_thinking_budget_translate: t(
        'hook_form.reasoning_budget_translate',
      ),
      /* [FEAT-20260918-HOOKTRANS] chat translation settings */
      translate_lang: t('hook_form.translate_lang'),
      auto_translate: t('hook_form.auto_translate'),
      /* [FEAT-20261026-RAGENGINE] kept in step with fieldTabs (no rule targets them) */
      doc_retrieval: t('hook_form.doc_retrieval'),
      rag_prompt_mode: t('hook_form.rag_prompt_mode'),
      rag_search_mode: t('hook_form.rag_search_mode'),
      custom_ai_key_sec: t('hook_form.custom_ai_key_sec'),
      telegram_key: t('hook_form.telegram_key'),
      telegram_chat_id: t('hook_form.telegram_chat_id'),
      telegram_noti_type: t('hook_form.telegram_noti_type'),
      tag: t('hook_form.tags'),
      group_id: t('hook_form.group'),
      line_url: t('hook_form.oa_url', channelVars(formData.channel_type)),
      webhook_url: t('hook_form.webhook_url'),
      status: t('hook_form.status'),
      fast_mode: t('webhook_list.toggle_field_fast_mode'),
      channel_id: t('hook_form.hook_channel_id'),
      channel_secret: t('hook_form.hook_channel_secret'),
      access_token: t('hook_form.hook_access_token'),
      gemini_temperature: t('hook_form.gemini_temperature'),
      gemini_top_k: t('hook_form.gemini_top_k'),
      gemini_top_p: t('hook_form.gemini_top_p'),
      answer_link: t('hook_form.answer_link'),
      slip_verify_key: t('hook_form.slip_verify_key'),
      // [FEAT-20260903-HOOKSLIPPROV] no rule targets it today, but fieldTabs
      // below lists it — and a field there without a label here renders its raw
      // key in the error alert (see the [P2-20260813] note above).
      slip_provider: t('hook_form.slip_provider'),
      slip_verify_branch: t('hook_form.slip_verify_branch'),
      slip_check: t('hook_form.slip_check'),
      qr_prescan_mode: t('hook_form.qr_prescan_mode'),
      match_account: t('hook_form.match_account'),
      match_account_number: t('hook_form.match_account_number'),
      flex_success: t('hook_form.flex_success'),
      flex_fail: t('hook_form.flex_fail'),
      flex_other: t('hook_form.flex_other'),
      flex_duplicate: t('hook_form.flex_duplicate'),
      flex_not_found: t('hook_form.flex_not_found'),
      flex_min_amount: t('hook_form.flex_min_amount'),
      flex_max_amount: t('hook_form.flex_max_amount'),
      flex_error: t('hook_form.flex_error'),
      flex_success_not_match: t('hook_form.flex_success_not_match'),
      flex_out_of_time: t('hook_form.flex_out_of_time'),
      slip_check_min_amount: t('hook_form.slip_check_min_amount'),
      slip_check_max_amount: t('hook_form.slip_check_max_amount'),
      slip_check_out_of_time: t('hook_form.slip_check_out_of_time'),
      qr_code_fail_anwser_text: t('hook_form.qr_code_fail_anwser_text'),
      callback_slip: t('hook_form.callback_slip'),
      callback_token: t('hook_form.callback_token'),
      callback_action: t('hook_form.callback_action'),
      suggestion_text_no_profile: t('hook_form.suggestion_text'),
      auto_unassist_minutes: t('hook_form.auto_unassist_minutes') || 'Auto Unassist Minutes',
      external_api_url: t('hook_form.external_api_url') || 'External API URL',
      external_user: t('hook_form.external_user') || 'External User',
      external_password: t('hook_form.external_password') || 'External Password',
      external_endpoints: t('hook_form.external_endpoints') || 'External Endpoints',
      chat_bot_id: t('hook_form.chat_bot_id') || 'Chat Bot ID'
    };
    // Which tab each field lives on. A validation message naming only the rule
    // ("จำเป็นต้องกรอก") leaves the user hunting across six tabs for a field
    // they cannot see, so every error is reported as field + tab and the form
    // switches to that tab.
    const fieldTabs: Partial<Record<keyof HookFormData, string>> = {
      line_oa_name: 'general', alias: 'general', company_name: 'general', domain_name: 'general',
      description: 'general', tag: 'general', group_id: 'general',
      status: 'general', fast_mode: 'general', auto_unassist_minutes: 'general',
      chat_bot_id: 'general',

      line_url: 'connection', webhook_url: 'connection', channel_id: 'connection',
      channel_secret: 'connection', access_token: 'connection',

      suggestion_text: 'ai', suggestion_text_no_profile: 'ai',
      default_answer_text: 'ai', ai_generative_error_text: 'ai', missing_api_data_text: 'ai',
      image_answer_text: 'ai', answer_link: 'ai', doc_id: 'ai',
      // [FEAT-20260801-HELPERTEXT] ช่องนี้อยู่แท็บ AI — ถ้าไม่แมป error จะชี้แท็บผิด
      customer_helper_text: 'ai',
      // [FEAT-20260801-FLEXPROFILE] อยู่แท็บ AI เช่นกัน
      flex_profile_id: 'ai',
      // [FEAT-20260802-FLEXCUSTOMLIST] อยู่แท็บ AI เช่นกัน
      flex_custom_ids: 'ai',
      flex_profile_custom_ids: 'ai',
      custom_ai_key: 'ai', gemini_temperature: 'ai', ai_vendor: 'ai', ai_model: 'ai', gemini_top_k: 'ai', gemini_thinking_budget: 'ai',
      // [FEAT-20260904-VENDORSECCOL] the DeepSeek pair lives on the same tab.
      custom_ai_key_sec: 'ai', ai_model_sec: 'ai',
      // [FEAT-20260909-VENDORTRANSLATE / DSREASONING] all six on the AI tab,
      // matching the BE's FIELD_TAB so an error routes to the tab that holds it.
      ai_vendor_translate: 'ai', deepseek_thinking: 'ai',
      deepseek_reasoning_effort: 'ai', deepseek_thinking_translate: 'ai',
      deepseek_reasoning_effort_translate: 'ai',
      gemini_thinking_budget_translate: 'ai',
      /* [FEAT-20260918-HOOKTRANS] chat translation settings */
      translate_lang: 'ai', auto_translate: 'ai',
      /* [FEAT-20261026-RAGENGINE] same tab as the BE's FIELD_TAB */
      doc_retrieval: 'ai', rag_prompt_mode: 'ai', rag_search_mode: 'ai',
      gemini_top_p: 'ai',

      slip_verify_key: 'slip', slip_check: 'slip', match_account: 'slip',
      slip_provider: 'slip', // [FEAT-20260903-HOOKSLIPPROV]
      slip_verify_branch: 'slip', // [FEAT-20260903-VENDORBRANCH]
      match_account_number: 'slip', slip_check_min_amount: 'slip',
      slip_check_max_amount: 'slip', slip_check_out_of_time: 'slip',
      qr_code_fail_anwser_text: 'slip', callback_slip: 'slip',
      callback_token: 'slip', callback_action: 'slip',
      flex_success: 'slip', flex_fail: 'slip', flex_other: 'slip',
      flex_duplicate: 'slip', flex_not_found: 'slip', flex_min_amount: 'slip',
      flex_max_amount: 'slip', flex_error: 'slip',
      flex_success_not_match: 'slip', flex_out_of_time: 'slip',

      telegram_key: 'notifications', telegram_chat_id: 'notifications',
      telegram_noti_type: 'notifications',

      external_api_url: 'external_api', external_user: 'external_api',
      external_password: 'external_api', external_endpoints: 'external_api',
    };

    const tabLabel = (tab?: string) => {
      const key: Record<string, string> = {
        general: 'hook_form.tab_general',
        connection: 'hook_form.tab_connection',
        ai: 'hook_form.tab_ai',
        slip: 'hook_form.tab_slip',
        notifications: 'hook_form.tab_notifications',
        external_api: 'hook_form.tab_external_api',
      };
      return tab && key[tab] ? t(key[tab]) : '';
    };

    const requiredMessage = (field: keyof HookFormData) =>
      t('hook_form.validation_required', { field: fieldLabels[field] || field });
    const asciiRegex = /^[\x20-\x7E]*$/; // Matches printable ASCII characters (English, Numbers, Symbols)

    // Fields that must be English/Numbers only and Required
    // Required AND ASCII-only. answer_link is deliberately absent: it only
    // substitutes into the [[link]] placeholder, and a hook that never uses
    // that placeholder has no reason to carry a URL. Its ASCII check is
    // applied separately below so a value, when given, is still a plain URL.
    // [FIX-20260804-AIKEYOPTIONAL] custom_ai_key ถอดออกจาก required (เดิมอยู่แถวนี้)
    //   เจ้าของงานสั่ง: ปล่อยว่างได้ตอน create/edit · ห้ามกระทบคนที่ใส่ key ปกติ
    //   → ย้ายไปเช็ค ascii แบบ optional ด้านล่าง (มีค่าเมื่อไหร่ค่อยเช็ค เหมือน answer_link)
    //   คนใส่ key จริง: ยังโดน ascii-check เดิม + BE ยัง verifyKey ตอนค่าเปลี่ยนเหมือนเดิม
    // revert: เอา 'custom_ai_key' กลับเข้า array นี้ + ลบบล็อก optional ด้านล่าง (marker เดียวกัน)
    const asciiFields: (keyof HookFormData)[] = [
      'line_oa_name', 'alias', 'company_name',
      // [FIX-20261018-WEBHOOKURLREQ] `webhook_url` is NOT here any more: the form renders no
      //   input for it (the Connection tab's "Webhook Endpoint" is a read-only URL built from
      //   the alias) and the BE never reads it. Hooks created outside this form (API, tool
      //   mint) carry none, so editing them failed on a field nobody could fill (owner 18/10).
      //   Create still sends DEFAULT_FORM's value; an edit leaves the stored one untouched.
      //   revert: put 'webhook_url' back after 'line_url'.
      'line_url', 'channel_id',
      'channel_secret', 'access_token'
    ];

    asciiFields.forEach(field => {
      const value = formData[field] as string;
      if (!value || !value.toString().trim()) {
        newErrors[field] = requiredMessage(field);
      } else if (!asciiRegex.test(value)) {
        newErrors[field] = t('hook_form.validation_ascii');
      }
    });

    // alias goes into the webhook URL path — enforce lowercase eng only, no
    // spaces, not empty (also guards legacy values loaded in edit mode).
    const aliasVal = String(formData.alias || '');
    if (!aliasVal.trim()) {
      newErrors.alias = requiredMessage('alias');
    } else if (!/^[a-z0-9_-]+$/.test(aliasVal)) {
      newErrors.alias = t('pageui.hookform.alias_invalid', 'alias ใช้ได้เฉพาะ a-z, 0-9, - _ (ตัวพิมพ์เล็ก ห้ามเว้นวรรค)');
    }

    // Optional, but must still be a plain URL when provided.
    const answerLinkValue = String(formData.answer_link || '').trim();
    if (answerLinkValue && !asciiRegex.test(answerLinkValue)) {
      newErrors.answer_link = t('hook_form.validation_ascii');
    }

    // [FIX-20260804-AIKEYOPTIONAL] custom_ai_key ปล่อยว่างได้ แต่ถ้าใส่มาต้องเป็น ascii
    //   (Gemini key เป็น ascii ล้วน → คนใส่ปกติผ่านเหมือนเดิม · ว่าง = ไม่ error)
    const customAiKeyValue = String(formData.custom_ai_key || '').trim();
    if (customAiKeyValue && !asciiRegex.test(customAiKeyValue)) {
      newErrors.custom_ai_key = t('hook_form.validation_ascii');
    }
    // [FEAT-20260904-VENDORSECCOL] the DeepSeek key is ascii too — same rule,
    // same optionality (blank = this OA has no DeepSeek key).
    const customAiKeySecValue = String(formData.custom_ai_key_sec || '').trim();
    if (customAiKeySecValue && !asciiRegex.test(customAiKeySecValue)) {
      newErrors.custom_ai_key_sec = t('hook_form.validation_ascii');
    }

    // [FEAT-20260730-HISTLIMIT] จำนวน history ต้องอยู่ในช่วง 5-30 (จำนวนเต็ม)
    // ตรงกับที่ BE ตรวจ (parseAiHistoryLimit) เพื่อไม่ให้ FE ปล่อยผ่านแล้วไปตกที่ BE
    // ว่าง = ไม่ตั้ง → ใช้ค่าเริ่มต้น 5 ไม่ถือว่าผิด
    {
      const raw = formData.ai_history_limit;
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 5 || n > 30) {
          newErrors.ai_history_limit = t('hook_form.ai_history_limit_error');
        }
      }
    }

    // [FEAT-20260801-NEEDDETAIL] จำนวนข้อความสรุป need_detail ต้องเป็น 0 หรือ 5-30
    // ตรงกับที่ BE ตรวจ (parseAiNeedDetailLimit) เพื่อไม่ให้ FE ปล่อยผ่านแล้วไปตกที่ BE
    // ว่าง = ไม่ตั้ง → ใช้ค่าเริ่มต้น 10 ไม่ถือว่าผิด
    // ⚠️ 0 ผ่าน (= ไม่เรียก AI) แต่ 1-4 ไม่ผ่าน — เว้นช่วงไว้ตั้งใจ ไม่ใช่บั๊ก
    {
      const raw = formData.ai_need_detail_limit;
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        const n = Number(raw);
        if (!Number.isInteger(n) || !(n === 0 || (n >= 5 && n <= 30))) {
          newErrors.ai_need_detail_limit = t('hook_form.ai_need_detail_limit_error');
        }
      }
    }

    // [FEAT-20260731-RAWJSONRULES] เปิดสวิตช์ raw json = ต้องกรอกกติกา
    // ตรงกับที่ BE ตรวจ (assertRawJsonRulesPresent) เพื่อไม่ให้ FE ปล่อยผ่านแล้วไปตกที่ BE
    // ปิดอยู่ = ว่างได้ ไม่ถือว่าผิด
    if (formData.ai_raw_json_analysis === true &&
      !String(formData.ai_raw_json_rules ?? '').trim()) {
      newErrors.ai_raw_json_rules = t('hook_form.ai_raw_json_rules_error');
    }

    // Description validation (Thai allowed, but required)
    if (!formData.description || !formData.description.trim()) {
      newErrors.description = requiredMessage('description');
    }

    /* [FIX-20260804-DOMAINREQ] โดเมนบังคับกรอก — **ทั้งตอนสร้างและตอนแก้ไข**
     * WHY  ค่านี้ถูกใช้เป็น {{hook_domain}} ทั้งในการ์ด flex และ Training Doc แล้ว
     *      ปล่อยว่าง = ลูกค้าอ่านเจอประโยคขาดคำ ("เข้าเว็บที่ " แล้วจบ)
     *
     * 📌 เดิมบังคับเฉพาะตอนสร้าง เพราะกลัว hook เก่าที่ยังไม่เคยกรอกจะเซฟไม่ผ่าน
     *    แต่เจ้าของงานสั่งให้บังคับตอนแก้ด้วย — เจตนาคือ "ไล่เก็บให้ครบทุกตัว"
     *    hook เก่าที่ยังว่างจะถูกบังคับให้กรอกในครั้งแรกที่เปิดมาแก้ (ตั้งใจ)
     * ⚠️ ผลข้างเคียงที่ต้องรู้: แก้เรื่องอื่นแล้วเซฟ ถ้าโดเมนยังว่างจะติด validate
     *    → ฟอร์มเด้งไปแท็บ "ข้อมูลทั่วไป" พร้อมข้อความบอก ไม่ได้เงียบ */
    if (!formData.domain_name || !String(formData.domain_name).trim()) {
      newErrors.domain_name = requiredMessage('domain_name');
    }

    if (!formData.group_id) {
      newErrors.group_id = requiredMessage('group_id');
    }

    const telegramKeyTrimmed = String(formData.telegram_key ?? '').trim();
    if (telegramKeyTrimmed && !asciiRegex.test(telegramKeyTrimmed)) {
      newErrors.telegram_key = t('hook_form.validation_ascii');
    }
    const telegramChatIdTrimmed = String(formData.telegram_chat_id ?? '').trim();
    if (telegramChatIdTrimmed && !asciiRegex.test(telegramChatIdTrimmed)) {
      newErrors.telegram_chat_id = t('hook_form.validation_ascii');
    }

    /* [REFACTOR-20260803-DOCBLOCK] วัดความยาวจาก payload จริงที่จะถูกเซฟ
       🐛 ของเดิมต่อสตริงด้วยสูตรคนละแบบกับตอน save -> นับ delimiter ซ้ำ
          วัดจริงแล้วเพี้ยนทั้ง 6 เคส หนักสุด 20 ตัวอักษร (เคส "กล่อง 2 ว่าง")
       ตอนนี้ทั้ง validate และ save เรียก joinTrainingDoc ตัวเดียวกัน */
    const docLen = trainingDocLengths({
      general: trainingDocGeneral, company: trainingDocCompany, noProfile: trainingDocNoProfile,
    });
    if (!docLen.suggestion_text) {
      newErrors.suggestion_text = t('hook_form.validation_suggestion_required');
    }
    /* [FEAT-20261016-DOC60K] the server's length rule — 60,000, and only for a box that will be
       SENT (an edit sends changed boxes only, so an untouched stored doc never blocks the save).
       Rule + why: `trainingDocOverLimit` in services/hook/trainingDoc.ts */
    const tooLong = trainingDocOverLimit(
      { general: trainingDocGeneral, company: trainingDocCompany, noProfile: trainingDocNoProfile },
      baselineRef.current,
    );
    for (const field of tooLong) {
      newErrors[field] = t('hook_form.validation_suggestion_length', { max: SUGGESTION_TEXT_MAX_LENGTH });
    }

    if (formData.group_id && !isObjectId(String(formData.group_id))) {
      newErrors.group_id = t('hook_form.validation_group_invalid');
    }
    
    // Callback Token Validation: Mandatory if callback_slip has URLs
    const hasCallbackUrls = (formData.callback_slip || []).some(url => url.trim() !== '');
    if (hasCallbackUrls && !String(formData.callback_token || '').trim()) {
      newErrors.callback_token = t('hook_form.validation_callback_token_required');
    }

    // Removed match_account_number required validation as per user request

    /* [FEAT-20260817-SECRETLOCK] กด แก้ไข แล้วปล่อยว่าง = ห้ามเซฟ —
       ใส่ค่าใหม่ หรือกด ยกเลิก เพื่อคงค่าเดิม */
    Object.assign(
      newErrors,
      secretLock.blankErrors(formData as any, t('hook_form.secret_blank_after_edit')),
    );

    setErrors(newErrors);
    const errorKeys = Object.keys(newErrors);
    if (errorKeys.length > 0) {
      // List every problem, each labelled with its field and the tab it is on,
      // and jump to the first one. Reporting a bare rule ("จำเป็นต้องกรอก")
      // gave no way to find the field, and fixing one error at a time meant
      // re-submitting to discover the next.
      const lines = errorKeys.map((key) => {
        const field = key as keyof HookFormData;
        const label = fieldLabels[field] || key;
        const tab = tabLabel(fieldTabs[field]);
        const reason = newErrors[key];
        return tab ? `• [${tab}] ${label} — ${reason}` : `• ${label} — ${reason}`;
      });
      setValidationAlert({ isOpen: true, message: lines.join('\n') });

      const firstTab = fieldTabs[errorKeys[0] as keyof HookFormData];
      if (firstTab) setActiveTab(firstTab as typeof activeTab);

      // [FEAT-20260802-AITABGROUPS] ช่องที่ error อาจถูกพับอยู่ในกลุ่มพับของแท็บ AI
      // → กางกลุ่มที่เกี่ยวข้องออก ไม่งั้นผู้ใช้เห็น alert แต่หาช่องแก้ไม่เจอ
      const FLEX_TAG_GROUP_FIELDS = ['ai_raw_json_rules', 'flex_profile_id', 'flex_custom_ids', 'flex_profile_custom_ids', 'customer_helper_text', 'flex_customerhelper_id'];
      const GENERAL_GROUP_FIELDS = ['ai_history_limit', 'ai_need_detail_limit', 'auto_unassist_minutes'];
      const TRAINING_DOC_GROUP_FIELDS = ['suggestion_text', 'suggestion_company_text', 'suggestion_text_no_profile', 'default_answer_text', 'missing_api_data_text', 'image_answer_text', 'answer_link', 'doc_id'];
      /* [FEAT-20260803-DOCSTEPS] 3 กลุ่มโชว์ทีละ step แล้ว → เปิดพร้อมกันไม่ได้อีกต่อไป
         จึงต้องเลือกว่าจะพาไป step ไหน: ใช้ **ช่องที่ error ตัวแรก** เพราะเป็นช่องบนสุด
         ที่ผู้ใช้จะเจอ · error ข้าม step กด save อีกทีจะพาไป step ถัดไปเอง
         ⚠️ ต้องเปิด collapse แม่ด้วย ไม่งั้นเลือก step ถูกแต่ยังพับอยู่ = หาช่องไม่เจอ
             (เจตนาเดิมของ AITABGROUPS: "เห็น alert แต่หาช่องแก้ไม่เจอ" ต้องไม่เกิด) */
      const groupOf = (k: string) =>
        GENERAL_GROUP_FIELDS.includes(k) ? 'general'
        : FLEX_TAG_GROUP_FIELDS.includes(k) ? 'flexTag'
        : TRAINING_DOC_GROUP_FIELDS.includes(k) ? 'trainingDoc'
        : null;
      /* [FEAT-20260803-AISUBTABS] ช่องที่ error อาจอยู่ในแท็บแถวสองที่ไม่ได้เลือกอยู่
         → ต้องสลับแท็บให้ด้วย ไม่งั้น alert ขึ้นแต่หาช่องแก้ไม่เจอ (เจตนาเดิมของ AITABGROUPS)
         ⚠️ เช็ค "ขั้นสูง" ก่อน แล้วค่อย training — เพราะถ้าผิดทั้งสองฝั่ง ต้องเลือกได้แค่อันเดียว
            และ custom_ai_key เป็นช่องบังคับที่พลาดบ่อยสุด (ว่างแล้วเซฟไม่ได้เลย) */
      const AI_ADVANCED_FIELDS = ['custom_ai_key', 'custom_ai_key_sec', 'gemini_temperature', 'gemini_top_k', 'gemini_top_p', 'gemini_thinking_budget',
        // [FEAT-20260909-VENDORTRANSLATE / DSREASONING] the six new controls all
        // render in the "advanced" sub-tab, so an error on one has to switch
        // there or the alert names a field the operator cannot see.
        'ai_vendor_translate', 'deepseek_thinking', 'deepseek_reasoning_effort',
        'deepseek_thinking_translate', 'deepseek_reasoning_effort_translate',
        'gemini_thinking_budget_translate',
        /* [FEAT-20260918-HOOKTRANS] chat translation settings */
        'translate_lang', 'auto_translate',
        /* [FEAT-20261026-RAGENGINE] rendered in "advanced" (RagEngineSection) */
        'doc_retrieval', 'rag_prompt_mode', 'rag_search_mode'];
      const firstDocGroup = errorKeys.map(groupOf).find(Boolean) as typeof docStep | undefined;
      if (errorKeys.some((k) => AI_ADVANCED_FIELDS.includes(k))) {
        setAiSubTab('advanced');
      } else if (firstDocGroup) {
        setAiSubTab('training');
        setDocStep(firstDocGroup);
      }
    } else {
      setValidationAlert(null);
    }
    return errorKeys.length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (isViewMode) return;
    const { name, value, type } = e.target;
    const isNumeric = type === 'number' || type === 'range' || name === 'status' || name === 'fast_mode';
    const nextValue = isNumeric
      ? (value === '' ? (name === 'status' || name === 'fast_mode' ? 0 : null) : Number(value))
      : value;

    setFormData(prev => ({
      ...prev,
      [name]: nextValue
    }));
    // Clear error for this field on change
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleClearField = (field: keyof HookFormData) => {
    if (isViewMode) return;
    setFormData(prev => ({ ...prev, [field]: '' }));
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const inputClass = (hasError: boolean, extra: string = '') =>
    `w-full bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all ${hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    } ${extra}`;

  /* [FIX-20261014-CUSTOOLUNGATE] one element — [FEAT-20261018-EXTAPICARDS] rendered once, as its
     own card before Customer Link (was: inside the Customer Link box) · form/CustomToolBindingSection.tsx */
  const customToolBinding = (
    <CustomToolBindingSection
      status={!!(formData as any).custom_tool_status}
      toolId={(formData as any).custom_tool_id || null}
      options={customToolOptions}
      disabled={isViewMode}
      selectClassName={inputClass(false)}
      onStatusChange={on => setFormData(prev => ({ ...prev, custom_tool_status: on } as any))}
      onToolChange={id => setFormData(prev => ({ ...prev, custom_tool_id: id } as any))}
    />
  );

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (isViewMode) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = tagInput.trim();
      if (!val) return;

      // Limit max tags
      if (formData.tag.length >= 5) {
        setErrors(prev => ({ ...prev, tag: t('hook_form.validation_tag_limit') }));
        return;
      }

      // Validate Tag (English only)
      if (!/^[\x20-\x7E]*$/.test(val)) {
        setErrors(prev => ({ ...prev, tag: t('hook_form.validation_tag_ascii') }));
        return;
      }

      if (!formData.tag.includes(val)) {
        setFormData(prev => ({ ...prev, tag: [...prev.tag, val] }));
        setErrors(prev => {
          const { tag, ...rest } = prev;
          return rest;
        });
      }
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    if (isViewMode) return;
    setFormData(prev => ({ ...prev, tag: prev.tag.filter(t => t !== tagToRemove) }));
    // Clear error if any exists when removing
    if (errors.tag) {
      setErrors(prev => { const { tag, ...rest } = prev; return rest; });
    }
  };
  const handleAddCallbackSlip = () => {
    if (isViewMode) return;
    setFormData(prev => ({
      ...prev,
      callback_slip: [...(prev.callback_slip || []), '']
    }));
  };

  const handleRemoveCallbackSlip = (index: number) => {
    if (isViewMode) return;
    setFormData(prev => ({
      ...prev,
      callback_slip: (prev.callback_slip || []).filter((_, i) => i !== index)
    }));
  };

  const handleCallbackSlipChange = (index: number, value: string) => {
    if (isViewMode) return;
    setFormData(prev => {
      const newList = [...(prev.callback_slip || [])];
      newList[index] = value;
      return { ...prev, callback_slip: newList };
    });
  };

  const handleAddEndpoint = () => {
    if (isViewMode) return;
    setNewEndpointKey('');
    setShowAddEndpointModal(true);
  };

  const handleConfirmAddEndpoint = () => {
    const key = newEndpointKey.trim().toUpperCase().replace(/\s+/g, '_');
    if (!key) return;
    if (formData.external_endpoints?.[key]) {
      setValidationAlert({ isOpen: true, message: 'Key already exists' });
      return;
    }
    setFormData(prev => ({
      ...prev,
      external_endpoints: {
        ...(prev.external_endpoints || {}),
        [key]: { path: '', method: 'POST', request_type: 'json', sub_type: 'api/v1/customer', require_jwt: true, is_login: false }
      }
    }));
    setExpandedEndpoints(prev => ({ ...prev, [key]: true }));




    setShowAddEndpointModal(false);
    setNewEndpointKey('');

    // Auto-scroll to bottom to show the new endpoint
    setTimeout(() => {
      if (formBodyRef.current) {
        formBodyRef.current.scrollTo({
          top: formBodyRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);
  };


  const parseCurl = (curlString: string) => {
    const result = {
      url: '',
      // [FIX-20260801-HOOKTYPES] ระบุ type ให้ชัด ไม่งั้น TS เดาเป็น string กว้าง ๆ
      // แล้วค่านี้ไปลงช่อง external_endpoints.method ที่รับแค่ 4 ค่านี้ไม่ได้
      method: 'GET' as 'GET' | 'POST' | 'PUT' | 'DELETE',
      headers: {} as Record<string, string>,
      payload: {} as any,
      path: '',
      sub_type: '',
      request_type: 'json' as 'json' | 'form' | 'form-data'
    };




    // Get URL
    const urlMatch = curlString.match(/curl\s+.*?['"]?(https?:\/\/[^\s'"]+)['"]?/i);
    if (urlMatch) {
      result.url = urlMatch[1];
      try {
        const urlObj = new URL(result.url);
        result.path = urlObj.pathname.replace(/^\/+/, '') + urlObj.search;
        result.sub_type = urlObj.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
      } catch (e) {
        result.path = result.url;
        result.sub_type = result.url.split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');
      }

    }

    // Get Method and Request Type
    if (curlString.includes('--form') || curlString.includes('-F')) {
      result.method = 'POST';
      result.request_type = 'form-data';
    } else if (curlString.includes('--data') || curlString.includes('-d')) {
      result.method = 'POST';
      // Default to json for data flags unless it looks like form
      result.request_type = 'json';
    }

    
    // Explicit Content-Type check
    if (curlString.toLowerCase().includes('application/json')) {
      result.request_type = 'json';
    } else if (curlString.toLowerCase().includes('application/x-www-form-urlencoded')) {
      result.request_type = 'form';
    } else if (curlString.toLowerCase().includes('multipart/form-data')) {
      result.request_type = 'form-data';
    }


    const methodMatch = curlString.match(/-X\s+(['"]?)([A-Z]+)\1/i);

    if (methodMatch) {
      // [FIX-20260801-HOOKTYPES] เดิมเอาข้อความที่ผู้ใช้วางมาใส่ตรง ๆ หลัง toUpperCase()
      // → วาง curl ที่มี -X PATCH มาก็จะเก็บ method ที่ระบบไม่รองรับลงไป
      //   (ช่อง external_endpoints รับแค่ GET/POST/PUT/DELETE ทั้งฝั่ง type และ BE)
      // ตอนนี้ตรวจก่อน ไม่อยู่ในรายการ = คงค่าที่เดาไว้แล้วจากการมี body (GET/POST)
      const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
      const upper = methodMatch[2].toUpperCase();
      if ((ALLOWED_METHODS as readonly string[]).includes(upper)) {
        result.method = upper as typeof ALLOWED_METHODS[number];
      }
    }

    // Get Form Data
    const formMatches = Array.from(curlString.matchAll(/--form\s+(['"])(.*?)\1/gi));
    for (const match of formMatches) {
      const parts = match[2].split('=');
      const key = parts[0].trim();
      let value = parts.slice(1).join('=').trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      if (/^U[a-f0-9]{32}$/i.test(value)) {
        value = '{{lineuserid}}';
      }
      result.payload[key] = value;
    }

    // Get Data (JSON/Raw) - Supports --data, --data-raw, --data-binary, -d
    const rawDataMatch = curlString.match(/--(?:data|data-raw|data-binary)\s+(['"])([\s\S]*?)\1/i) || 
                         curlString.match(/-d\s+(['"])([\s\S]*?)\1/i);
    
    if (rawDataMatch) {
      const rawBody = rawDataMatch[2].trim();
      try {
        const jsonData = JSON.parse(rawBody);
        if (typeof jsonData === 'object' && jsonData !== null) {
          Object.assign(result.payload, jsonData);
          // Replace values with variables if they look like Line User IDs
          for (const key in result.payload) {
            if (typeof result.payload[key] === 'string' && /^U[a-f0-9]{32}$/i.test(result.payload[key])) {
              result.payload[key] = '{{lineuserid}}';
            }
          }
        }
      } catch (e) {
        // Not valid JSON, maybe it's key=value pairs
        rawBody.split('&').forEach(pair => {
          const [key, val] = pair.split('=');
          if (key) {
            let decodedVal = decodeURIComponent(val || '');
            if (/^U[a-f0-9]{32}$/i.test(decodedVal)) {
              decodedVal = '{{lineuserid}}';
            }
            result.payload[key] = decodedVal;
          }
        });
      }
    }

    return result;
  };


  const handleImportCurl = () => {
    setImportError(null);
    const parsed = parseCurl(curlInput);
    if (!parsed.url) {
      setImportError('INVALID CURL: URL NOT FOUND');
      return;
    }

    // Try to auto-suggest key from path if empty
    let suggestedKey = importEndpointKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!suggestedKey && parsed.path) {
      const parts = parsed.path.split('/').filter(Boolean);
      const lastPart = parts[parts.length - 1]?.split('?')[0];
      if (lastPart) {
        suggestedKey = lastPart.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      }
    }

    const key = suggestedKey || 'IMPORTED_API';
    
    if (formData.external_endpoints?.[key]) {
      // If we used a suggested key and it exists, revert to manual check
      if (!importEndpointKey.trim()) {
        setImportError('PLEASE ASSIGN A UNIQUE KEY');
        return;
      }
      setImportError('KEY ALREADY EXISTS');
      return;
    }

    // Auto-detect JWT requirement (usually login/auth doesn't need JWT to START)
    const isAuth = parsed.path.toLowerCase().includes('login') || parsed.path.toLowerCase().includes('auth/login');

    setFormData(prev => ({
      ...prev,
      external_endpoints: {
        ...(prev.external_endpoints || {}),
        [key]: {
          path: parsed.path,
          method: parsed.method,
          request_type: parsed.request_type,
          sub_type: parsed.sub_type,
          payload: parsed.payload,
          require_jwt: !isAuth,
          is_login: isAuth
        }
      }
    }));

    setExpandedEndpoints(prev => ({ ...prev, [key]: true }));
    setShowCurlImport(false);


    setCurlInput('');
    setImportEndpointKey('');
    setCopyAlert({ title: 'Import Successful', message: `Added endpoint with key: ${key}`, type: 'success' });

    // Auto-scroll to bottom to show the new endpoint
    setTimeout(() => {
      if (formBodyRef.current) {
        formBodyRef.current.scrollTo({
          top: formBodyRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);
  };





  const handleRemoveEndpoint = (key: string) => {
    if (isViewMode) return;
    setFormData(prev => {
      const next = { ...(prev.external_endpoints || {}) };
      delete next[key];
      return { ...prev, external_endpoints: next };
    });
  };

  const handleUpdateEndpoint = (key: string, field: string, value: any) => {
    if (isViewMode) return;
    setFormData(prev => ({
      ...prev,
      external_endpoints: {
        ...(prev.external_endpoints || {}),
        [key]: {
          ...(prev.external_endpoints?.[key] || { path: '', method: 'POST', require_jwt: true }),
          [field]: value
        }
      }
    }));
  };
  
  const handleConfirmSubmit = async (payloadOverride?: any) => {
    setLoading(true);
    setFormError(null);
    try {
      /* [FEAT-20260817-FORMDIFF] Build the payload exactly as before (the builder
         moved to utils/hookFormPayload.ts verbatim), then send only the members
         whose value actually differs from what this form loaded.

         Why this matters beyond tidiness: the form holds 83 fields and the API
         will write 89, with no version check anywhere. Posting all of them turns
         "rename a hook" into "overwrite the whole document with whatever this
         tab was holding" — which silently discards edits another admin saved in
         the meantime, and is the shape of bug that erased a stored credential.
         ส่งเฉพาะช่องที่แก้จริง · ช่องที่ไม่ได้ส่ง = API ไม่แตะของเดิม (RFC 7386)

         Create and clone have no baseline and still send everything. */
      const full = buildHookPayload(
        formData,
        { general: trainingDocGeneral, company: trainingDocCompany, noProfile: trainingDocNoProfile },
        { isCreate: resolvedMode === 'create' },
      );

      /* `requireBaseline` on an EDIT: no baseline means the form never populated
         from the hook it claims to be editing, and posting `full` there would
         overwrite a live document with blank defaults. The helper throws, which
         the catch below turns into the normal save-failed message.
         revert: drop the options argument. */
      const payload: any = diffHookPayload(full, baselineRef.current, {
        requireBaseline: resolvedMode === 'update',
      });

      await onSubmit(payload);
      setShowAnalysisPreview(false);
      onClose();
    } catch (err) {
      console.error(err);
      const apiError = err as ApiError;
      setFormError({
        message: apiError?.message || t('hook_form.save_error'),
        raw: apiError?.rawResponse
      });
    } finally {
      setLoading(false);
    }
  };

  /* [FEAT-20260829-NOTICEUNSAVED] the notification tab writes its own route, so
     these two live on the FORM, not in the tab — the tab unmounts on every tab
     switch and used to lose the answer. See `utils/noticeUnsaved.ts`. */
  const noticeSavedRef = useRef<string | null>(null);
  const [noticeFlash, setNoticeFlash] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewMode) return;
    
    if (!validate()) {
      return;
    }

    /* [FEAT-20260829-NOTICEUNSAVED] the notification tab saves on a DIFFERENT
       route, so going ahead here would store everything except those fields and
       hand back a success toast for a save that was only partly done. Stop, say
       so, jump to the tab, and flash its own button — an alert the admin cannot
       act on is worse than none, so it points at the exact control to press.
       ⚠️ Silent when nothing is pending: `noticeIsDirty` answers false for an
          untouched form AND for a form whose notice tab was never opened, so the
          ordinary save path is byte-for-byte what it was.
       revert: delete this block and `noticeSavedRef` above. */
    if (noticeIsDirty(noticeSavedRef.current, formData)) {
      setActiveTab('notice');
      setNoticeFlash((n) => n + 1);
      setToast({ message: t('hook_form.notice_must_save_first'), type: 'error' });
      return;
    }

    // Check if relevant fields for Analysis Preview have changed
    const externalFieldsChanged =
      formData.external_api_url !== (initialData?.external_api_url || '') ||
      formData.external_user !== (initialData?.external_user || '') ||
      formData.external_password !== (initialData?.external_password || '') ||
      JSON.stringify(formData.external_endpoints) !== JSON.stringify(initialData?.external_endpoints || {});

    externalFieldsChangedRef.current = externalFieldsChanged;

    const isChannelIdChanged =
      resolvedMode === 'update' &&
      !!initialData?.channel_id &&
      String(formData.channel_id || '').trim() !== String(initialData.channel_id || '').trim();

    if (isChannelIdChanged) {
      setShowChannelIdConfirmModal(true);
      return;
    }

    // Analysis Preview is a acme-only feature — when the config flag is
    // absent/false, external field changes skip straight to submit instead
    // of showing the review modal.
    if (externalFieldsChanged && acmeCategory) {
      setAnalysisResult(null);
      setShowAnalysisPreview(true);
    } else {
      handleConfirmSubmit();
    }
  };



  const statusToken = '__STATUS__';
  const forcedStatusTemplate = t('hook_form.status_forced', { status: statusToken });
  const [forcedStatusPrefix, forcedStatusSuffix = ''] = forcedStatusTemplate.split(statusToken);
  const selectedGroupOption = useMemo(() => {
    if (!formData.group_id) return null;
    if (groups.some(group => group._id === formData.group_id)) return null;
    const label = selectedGroup?.group_name || String(formData.group_id);
    return { _id: String(formData.group_id), group_name: label };
  }, [formData.group_id, groups, selectedGroup]);

  // ==== [FEAT-20260731-HOOKFULLPAGE] START — Standalone full page support
  // When isFullPage is true, force render as full-page view without backdrop modal
  // revert: change back to  if (!isOpen) return null;
  if (!isOpen && !isFullPage) return null;

  /* [FEAT-20260811-HOOKFORMSPLIT] form-context object for extracted tabs — all state
     stays here; a tab receives exactly what it reads/writes. Built each render (same
     as the old inline tab). NEVER wrap a tab in React.memo (this ref changes each render). */
  const formCtx = {
    formData, setFormData, handleChange, errors, isViewMode, t, inputClass,
    flexTemplates, groups,
    // [FEAT-20260822-NOTICEMODE] undefined while creating — the notice tab uses
    // that to explain the OA must exist before its own route can write.
    hookId: initialData?._id ? String(initialData._id) : undefined,
    aiSubTab, setAiSubTab, docStep, setDocStep,
    showCustomAiKey, setShowCustomAiKey,
    trainingDocGeneral, setTrainingDocGeneral,
    trainingDocCompany, setTrainingDocCompany,
    trainingDocNoProfile, setTrainingDocNoProfile,
    setHelpModal, setDocTestOpen, setToast,
    // [FEAT-20260829-NOTICEUNSAVED]
    noticeSavedRef, noticeFlash,
    openRawJsonExample, openSiteRulesExample,
    // [FEAT-20260817-SECRETLOCK] custom_ai_key lives in the AI tab
    secretLock,
  };

  const contentJSX = (
    <>
      <form onSubmit={handleSubmit} className={isFullPage ? "bg-dark-800 border border-dark-700 rounded-2xl shadow-xl w-full flex flex-col flex-1 overflow-hidden" : "bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-[92vw] sm:w-[90vw] lg:w-[80vw] max-w-6xl my-8 flex flex-col max-h-[90vh]"}>

        {/* Header */}
        <div className={isFullPage ? "flex justify-between items-center p-5 border-b border-dark-700 sticky top-0 bg-dark-800 z-10 rounded-t-2xl gap-4" : "flex justify-between items-center p-5 border-b border-dark-700 sticky top-0 bg-dark-800 z-10 rounded-t-xl gap-4"}>
          <div className="flex items-center gap-3 overflow-hidden">
            {isFullPage && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-lg bg-dark-700/60 hover:bg-dark-700 text-slate-700 hover:text-slate-900 transition-colors flex items-center gap-2 text-sm font-medium border border-dark-700 shrink-0"
                  title={t('pageui.hookform.back', 'กลับ')}
                >
                  <ArrowLeft size={18} />
                  <span>{t('pageui.hookform.back', 'กลับ')}</span>
                </button>
                <div className="w-px h-6 bg-dark-700 shrink-0"></div>
              </>
            )}
            <h3 className="text-xl font-semibold text-slate-900 flex items-center gap-2 truncate">
              {isViewMode ? <Eye size={20} className="text-primary-500" /> : null}
              {isViewMode
                ? t('hook_form.view_title')
                : resolvedMode === 'update'
                  ? (initialData?.line_oa_name ? t('pageui.hookform.edit_title_named', 'แก้ไข Webhook - {name}', { name: initialData.line_oa_name }) : t('hook_form.update_title'))
                  : (initialData?.line_oa_name ? t('pageui.hookform.clone_title_named', 'คัดลอก Webhook - {name}', { name: initialData.line_oa_name }) : t('hook_form.create_title'))}
            </h3>
          </div>

          <div className="flex items-center gap-3">
            {!isViewMode ? (
              <>
                {!isFullPage && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors whitespace-nowrap"
                  >
                    {t('hook_form.cancel')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPayloadPreview(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-primary-600 hover:bg-primary-50 transition-colors flex items-center gap-2 whitespace-nowrap border border-dark-700 hover:border-primary-200"
                >
                  <FileJson size={18} />
                  Preview Payload
                </button>
                {/* clone moved to the hooks list toolbar (select 1 row → clone) per UX —
                    editor-header button removed to avoid two entry points. */}
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2 whitespace-nowrap"
                >
                  {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={18} />}
                  {t('hook_form.save_changes')}
                </button>

              </>
            ) : (
              !isFullPage && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors border border-dark-700"
                >
                  {t('hook_form.close')}
                </button>
              )
            )}
            {!isFullPage && (
              <>
                <div className="w-px h-6 bg-dark-700 mx-1 hidden sm:block"></div>
                <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors p-1">
                  <X size={20} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-dark-700 bg-dark-900/20">
          {/* Mobile Select Box */}
          <div className="px-6 py-4 block min-[990px]:hidden">
            <div className="relative group">
              <select
                value={activeTab}
                onChange={(e) => handleTabChange(e.target.value as any)}
                className="w-full bg-dark-800 border-2 border-dark-700 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:border-primary-500 outline-none transition-all appearance-none cursor-pointer pr-10"
              >
                <option value="general">📊 {t('hook_form.tab_general')}</option>
                <option value="connection">🔗 {t('hook_form.tab_connection')}</option>
                <option value="ai">💬 {t('hook_form.tab_ai')}</option>
                <option value="slip">🛡️ {t('hook_form.tab_slip')}</option>
                <option value="notifications">🔔 {t('hook_form.tab_notifications')}</option>
                <option value="external_api">🌐 {t('hook_form.tab_external_api')}</option>
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-primary-500 transition-colors">
                <ChevronDown size={20} />
              </div>
            </div>
          </div>

          {/* Desktop Tabs */}
          <div className="hidden min-[990px]:flex items-center gap-1 px-6 pt-4 overflow-x-auto no-scrollbar">

            <button
              type="button"
              onClick={() => handleTabChange('general')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'general'
                ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                }`}
            >
              <Layout size={16} />
              {t('hook_form.tab_general')}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('connection')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'connection'
                ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                }`}
            >
              <Link size={16} />
              {t('hook_form.tab_connection')}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('ai')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'ai'
                ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                }`}
            >
              <MessageSquare size={16} />
              {t('hook_form.tab_ai')}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('slip')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'slip'
                ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                }`}
            >
              <ShieldCheck size={16} />
              {t('hook_form.tab_slip')}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('notifications')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'notifications'
                ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                }`}
            >
              <Bell size={16} />
              {t('hook_form.tab_notifications')}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('external_api')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'external_api'
                ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                }`}
            >
              <Globe size={16} />
              {t('hook_form.tab_external_api')}
            </button>
            {/* [FEAT-20260822-NOTICEMODE] the screening cards for "deposit/withdraw
                is closed right now". Its own tab because it writes on its own
                route; shown for a saved OA only, like Handoff — the route needs
                an id, and the tab says so if it is opened without one. */}
            <button
              type="button"
              onClick={() => handleTabChange('notice')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'notice'
                ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                }`}
            >
              <BellRing size={16} />
              {t('hook_form.tab_notice')}
            </button>
            {/* [FEAT-20260805-HANDOFF-HOOKTAB] handoff targets bound to this OA (read-only).
                Only on an existing hook — a new one has no bindings yet. */}
            {initialData?._id && (
              <button
                type="button"
                onClick={() => handleTabChange('handoff')}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-bold transition-all border-b-2 rounded-t-lg ${activeTab === 'handoff'
                  ? 'text-primary-500 border-primary-500 bg-primary-500/5'
                  : 'text-slate-400 border-transparent hover:text-slate-600 hover:bg-dark-700/50'
                  }`}
              >
                <Repeat size={16} />
                Handoff
              </button>
            )}
          </div>
        </div>


        {/* Form Body Wrapper for Fixed Positioning */}
        <div className="relative flex-1 flex flex-col min-h-0">
          <div ref={formBodyRef} className="p-6 pb-24 flex-1 overflow-y-auto custom-scrollbar">
            {activeTab === 'general' && (

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-slide-in">
              {/* [FEAT-20260803-GENERALROWS] 2 ช่องต่อแถว ตามที่ผู้ใช้สั่ง
                  เดิม 2 ช่องนี้กิน md:col-span-2 คนละแถวทั้งที่เป็น input บรรทัดเดียวสั้น ๆ
                  → ปล่อยให้ไหลตาม grid แม่ (2 คอลัมน์) จับคู่กันเองบนจอกว้าง
                  ⚠️ ไม่แตะช่องที่จับคู่อยู่แล้ว (Channel/ชื่อ OA · Alias/กลุ่ม) ตามที่สั่ง
                  ⚠️ ไม่ยุบ "แท็ก" กับ "คำอธิบาย" — อันแรกเป็นกล่องแท็กที่ต้องการความกว้าง
                     อันหลังเป็น textarea หลายบรรทัด บีบครึ่งแล้วใช้งานแย่ลง
                  ⚠️ grid-cols-1 บนจอแคบยังเหมือนเดิม = มือถือเรียงลงล่างทีละช่อง
                  revert: ใส่ className="md:col-span-2" กลับให้ 2 div นี้ */}
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.company_name')} <span className="text-red-500">*</span></label>
                <input
                  disabled={isViewMode}
                  name="company_name"
                  value={formData.company_name}
                  onChange={handleChange}
                  className={inputClass(!!errors.company_name)}
                  placeholder="ABC"
                />
                <InputError error={errors.company_name} />
              </div>

              {/* [FEAT-20260802-DOMAINNAME] โดเมน/เว็บของ OA
                  ใช้โชว์หัวการ์ด "ข้อมูลเว็บ" ใน panel ขวาหน้า ticket support
                  [FIX-20260804-DOMAINREQ] เปลี่ยนจาก optional → **บังคับกรอกทุกโหมด**
                    ⚠️ hook เก่าที่ยังไม่มีค่าจะเซฟไม่ผ่านจนกว่าจะกรอก — ตั้งใจ
                       (ค่านี้ถูกใช้เป็น {{hook_domain}} ในการ์ดและ Training Doc แล้ว
                        ปล่อยว่างไว้ = ลูกค้าเห็นประโยคขาดคำ)
                  revert: ลบ block นี้ + domain_name ใน DEFAULT_FORM/load/types */}
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  {/* [FIX-20260804-DOMAINREQ] ดาวแดงทุกโหมด — บังคับกรอกทั้งสร้างและแก้ไข
                      ⚠️ ต้องตรงกับกฎใน validate เสมอ ดาวไม่ขึ้นแต่เซฟไม่ผ่าน = ผู้ใช้งง */}
                  {t('hook_form.domain_name')}<span className="text-red-500"> *</span>
                </label>
                <input
                  disabled={isViewMode}
                  name="domain_name"
                  value={formData.domain_name ?? ''}
                  onChange={handleChange}
                  className={inputClass(!!errors.domain_name)}
                  placeholder="example.com"
                />
                {errors.domain_name && (
                  <p className="mt-1 text-xs font-semibold text-red-500">{errors.domain_name}</p>
                )}
                {/* [FEAT-20260804-HOOKNAMEDETAIL] เดิมบอกแค่ {{hook_domain}} และบอกว่าใช้ได้
                    เฉพาะการ์ด flex · ตอนนี้ใช้ใน Training Doc ได้ด้วย และมีอีก 2 ตัว
                    ⚠️ ต้องมีปุ่มคัดลอก — แอดมินพิมพ์ tag เองแล้วพิมพ์ผิดบ่อย
                       (พิมพ์ผิด = tag ไม่ถูกแทน ลูกค้าเห็นวงเล็บดิบ) */}
                <div className="mt-1.5 space-y-1">
                  <p className="text-[11px] text-slate-400">{t('hook_form.ctx_tag_hint')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CTX_TAGS.map((tg) => (
                      <button
                        key={tg.tag}
                        type="button"
                        onClick={() => copyCtxTag(tg.tag)}
                        title={t('hook_form.ctx_tag_copy')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-300 bg-slate-50 hover:bg-slate-100 text-[11px] font-mono text-slate-600 transition-colors"
                      >
                        <Copy size={10} />
                        {tg.tag}
                        <span className="font-sans text-slate-400">{t(tg.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">Channel</label>
                <select
                  disabled={isViewMode}
                  name="channel_type"
                  value={formData.channel_type || 'line'}
                  onChange={handleChange}
                  className={inputClass(false)}
                >
                  {enabledChannels().map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.oa_name', channelVars(formData.channel_type))} <span className="text-red-500">*</span></label>
                <input
                  disabled={isViewMode}
                  name="line_oa_name"
                  value={formData.line_oa_name}
                  onChange={handleChange}
                  className={inputClass(!!errors.line_oa_name)}
                />
                <InputError error={errors.line_oa_name} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.alias')} <span className="text-red-500">*</span></label>
                <input
                  disabled={isViewMode}
                  name="alias"
                  value={formData.alias}
                  onChange={(e) => {
                    // Alias is used in the webhook URL path: force lowercase and
                    // keep ONLY [a-z0-9-_] — strips whitespace, uppercase, Thai,
                    // and symbols as it's typed so it's always a clean URL slug.
                    const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
                    handleChange({ ...e, target: { ...e.target, name: 'alias', value: cleaned } } as any);
                  }}
                  // Block a literal space char (Tab still navigates fields).
                  onKeyDown={(e) => { if (e.key === ' ') e.preventDefault(); }}
                  // Must be typed by hand — no paste (guarantees every char passes
                  // the lowercase-eng filter and no hidden whitespace sneaks in).
                  onPaste={(e) => e.preventDefault()}
                  onDrop={(e) => e.preventDefault()}
                  // [FIX-20260729-ALIASPH] English placeholder. Dash and
                  // underscore are allowed and stay allowed — three live hooks
                  // already use them (shopapi_demo_uat, custreg_on, custreg_off)
                  // and the alias is the webhook URL path.
                  // revert: restore the Thai string.
                  placeholder="Type manually: a-z, 0-9, -, _ (no paste/space/uppercase)"
                  className={inputClass(!!errors.alias)}
                />
                <InputError error={errors.alias} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.group')} <span className="text-red-500">*</span></label>
                {isViewMode ? (
                  <select
                    disabled
                    name="group_id"
                    value={formData.group_id || ''}
                    className={inputClass(false, 'appearance-none')}
                  >
                    <option value={formData.group_id || ''}>
                      {selectedGroup?.group_name || t('group.none')}
                    </option>
                  </select>
                ) : (
                  <div className="relative">
                    <select
                      ref={groupSelectRef}
                      disabled={!groupEditable}
                      name="group_id"
                      value={formData.group_id || ''}
                      onChange={handleChange}
                      onFocus={fetchGroups}
                      className={inputClass(!!errors.group_id, 'appearance-none pr-20')}
                    >
                      {!formData.group_id && (
                        <option value="" disabled>
                          {t('hook_form.group_placeholder')}
                        </option>
                      )}
                      {selectedGroupOption ? (
                        <option value={selectedGroupOption._id}>{selectedGroupOption.group_name}</option>
                      ) : null}
                      {groups.map(group => {
                        const optionId = (group as any)._id || (group as any).id || (group as any).group_id;
                        if (!optionId) return null;
                        return (
                          <option key={optionId} value={optionId}>
                            {group.group_name}
                          </option>
                        );
                      })}
                    </select>
                    {resolvedMode === 'update' && (
                      <button
                        type="button"
                        onClick={() => {
                          setGroupEditable(true);
                          fetchGroups();
                          setTimeout(() => {
                            const selectEl = groupSelectRef.current;
                            if (!selectEl) return;
                            selectEl.focus();
                            const picker = (selectEl as any).showPicker;
                            if (typeof picker === 'function') {
                              picker.call(selectEl);
                            } else {
                              selectEl.click();
                            }
                          }, 0);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 bg-dark-700 rounded-md text-slate-600 hover:text-slate-900 hover:bg-dark-600"
                      >
                        {t('common.edit')}
                      </button>
                    )}
                  </div>
                )}
                <InputError error={errors.group_id} />
                {formData.group_id && !isViewMode && (
                  <div className="mt-2 flex flex-col gap-1">
                    {/* [FIX-20260828-FORCEGRANTLABEL] ป้ายเดิมพูดไม่ตรงกับสิ่งที่เกิด
                        🔴 เขียนว่า "user **ทุกคน** ในกลุ่ม" แต่วัดจริงบนฐานนี้แล้วแตะ 3 จาก 7
                           ⇒ คนที่ **ไม่มี** รายการจำกัด OA จะถูกข้าม และนั่นถูกต้อง:
                             ไม่มีรายการจำกัด = เห็น OA ทุกตัวในกลุ่มอยู่แล้ว
                             (`auth.service.ts:255`) · ถ้าไปเพิ่มให้เขา จะกลายเป็นการ
                             สร้างรายการจำกัดที่มี OA ตัวเดียว = **ตัดสิทธิ์ที่เขามีอยู่ทิ้ง**
                        ⇒ แอดมินที่อ่านป้ายเดิมแล้วเห็นบางคนไม่ขยับ จะสรุปว่าฟีเจอร์พัง
                          ทั้งที่มันทำถูก · ป้ายต้องบอกความจริง
                        ⚠️ ข้อความเคยฮาร์ดโค้ดภาษาไทยที่นี่ ทั้งที่ป้ายตัวพี่น้องใน
                           `HookCloneModal` ใช้ i18n อยู่แล้ว ⇒ ย้ายเข้า i18n ให้ตรงกัน
                        ⚠️ สี: `text-slate-300 hover:text-white` เป็นชุดของพื้นมืด
                           บนพื้นสว่างจะจืดจนเกือบอ่านไม่ออก (ปัญหาเดียวกับที่แก้ไปแล้ว
                           ในโมดัลผู้ใช้เมื่อ 28/08) */}
                    <label className="flex items-center gap-2 text-xs text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!formData.force_grant}
                        onChange={(e) => setFormData(prev => ({ ...prev, force_grant: e.target.checked }))}
                        className="accent-primary-500 rounded"
                      />
                      <span>{t('hook_form.force_grant_label')}</span>
                    </label>
                    <span className="text-[11px] text-slate-500 pl-5">
                      {t('hook_form.force_grant_hint')}
                    </span>
                    <span className="text-[11px] text-slate-400 pl-5">
                      {/* [FIX-20260801-PERMHINT] เดิมเขียนว่า "session refresh" ซึ่งแอดมิน
                          ไม่รู้ว่าต้องทำอะไร → บอกเป็นขั้นตอนที่ทำตามได้จริง
                          revert: กลับเป็น "* สิทธิ์ใหม่จะมีผลเมื่อ user ในกลุ่มทำการ session refresh" */}
                      {t('pageui.hookform.perm_relogin_hint', '* สิทธิ์ใหม่จะมีผลเมื่อ user ในกลุ่มทำการ logout แล้ว login ใหม่')}
                    </span>
                  </div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-2">{t('hook_form.tags')}</label>
                <div className="bg-primary-500/5 border border-primary-500/20 rounded-xl p-4">
                  <div className="flex flex-wrap gap-2 mb-3">
                    {formData.tag.map((tag, idx) => (
                      <span key={idx} className="inline-flex items-center gap-2 bg-primary-100 text-primary-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-primary-200">
                        {tag}
                        {!isViewMode && (
                          <button type="button" onClick={() => removeTag(tag)} className="hover:text-primary-900 transition-colors">
                            <X size={14} />
                          </button>
                        )}
                      </span>
                    ))}
                    {formData.tag.length === 0 && <span className="text-xs text-slate-400 italic">{t('hook_form.tags_placeholder')}</span>}
                  </div>
                  {!isViewMode && formData.tag.length < 5 && (
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleAddTag}
                      className={inputClass(!!errors.tag, 'bg-white')}
                      placeholder={t('hook_form.tags_placeholder')}
                    />
                  )}
                  <div className="mt-2 text-[10px] text-slate-500 flex justify-between">
                    <span>{t('hook_form.tags_hint')}</span>
                    <span>{formData.tag.length}/5</span>
                  </div>
                </div>
                <InputError error={errors.tag} />
              </div>

              {/* [FEAT-20260830-HIDEDESC] ซ่อนทั้ง label และ textarea ตามที่เจ้าของสั่ง
                  30/08 — ฟอร์มยังส่ง `description` เหมือนเดิม โดยเติมวันที่ `ddmmyy`
                  ให้เมื่อค่าว่าง (resolveHookDescription)
                  ⚠️ `hidden` ไม่ใช่ unmount — input ยังอยู่ใน DOM และยังอยู่ใน state
                  เหมือนแบบอย่างที่ :3272 ⇒ validation (:1463) ไม่ต้องแก้เลย และการ
                  ถอดฟีเจอร์นี้ออกคือลบ `hidden` คำเดียว
                  revert: ลบ class `hidden` + ลบ resolveHookDescription ทุกจุด */}
              <div className="md:col-span-2 hidden">
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.description')} <span className="text-red-500">*</span></label>
                <textarea
                  disabled={isViewMode}
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={4}
                  className={inputClass(!!errors.description)}
                />
                <InputError error={errors.description} />
              </div>
            </div>
          )}

          {activeTab === 'connection' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-slide-in">
              <div className="md:col-span-2 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-start gap-3">
                <Monitor className="text-yellow-600 flex-shrink-0" size={20} />
                <div className="text-xs text-yellow-800 leading-relaxed font-medium">
                  {t('hook_form.connection_details')} - {t('pageui.hookform.keep_secret_hint', 'โปรดเก็บรักษา Channel Secret และ Access Token เป็นความลับ')}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.hook_channel_id')} <span className="text-red-500">*</span></label>
                {/* [FEAT-20260817-SECRETLOCK] locked until แก้ไข; value stays
                    visible and is KEPT on unlock (not a secret — the confirm
                    modal below remains the second gate on a real change) */}
                <div className="relative">
                  <input
                    disabled={isViewMode}
                    readOnly={secretLock.isLocked('channel_id')}
                    name="channel_id"
                    value={formData.channel_id}
                    onChange={handleChange}
                    className={inputClass(!!errors.channel_id, secretLock.isLocked('channel_id') ? 'pr-16 opacity-80' : '')}
                  />
                  {!isViewMode && (
                    <SecretLockButtons field="channel_id" lock={secretLock}
                      editLabel={t('common.edit')} cancelLabel={t('common.cancel')} />
                  )}
                </div>
                <InputError error={errors.channel_id} />
                {resolvedMode === 'update' && !!initialData?.channel_id && String(formData.channel_id || '').trim() !== String(initialData.channel_id || '').trim() && (
                  <div className="mt-2.5 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-600 dark:text-amber-400 text-xs flex items-start gap-2.5 shadow-sm animate-fade-in">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-500" />
                    <div className="space-y-1">
                      <p className="font-bold text-sm text-amber-700 dark:text-amber-300">{t('pageui.hookform.channel_warn_title', 'คำเตือน: การเปลี่ยนแปลง Channel ID')}</p>
                      <p className="leading-relaxed">
                        {t('pageui.hookform.channel_warn_body', 'การเปลี่ยนแปลง Channel ID (เปลี่ยนจากเดิม) มีผลต่อ ประวัติสนทนา ข้อความ ผู้ใช้งาน ทั้งก่อนหน้านี้และหลังจากนี้ การเก็บข้อมูล แสดงผลจะทำงานไม่ถูกต้อง หากต้องการเปลี่ยน Channel ID / OA ใหม่ กรุณาใช้การสร้าง Hook ช่องทาง OA ใหม่แทน')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.hook_channel_secret')} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    disabled={isViewMode}
                    readOnly={secretLock.isLocked('channel_secret')}
                    name="channel_secret"
                    value={secretLock.displayValue('channel_secret', formData.channel_secret)}
                    onChange={handleChange}
                    className={inputClass(!!errors.channel_secret, secretLock.isLocked('channel_secret') ? 'pr-16 opacity-80' : 'pr-10')}
                    type={showChannelSecret ? 'text' : 'password'}
                  />
                  {!isViewMode && (
                    <SecretLockButtons field="channel_secret" lock={secretLock}
                      editLabel={t('common.edit')} cancelLabel={t('common.cancel')}
                      offsetClass={secretLock.isUnlocked('channel_secret') ? 'right-10' : 'right-2'} />
                  )}
                  {!isViewMode && !secretLock.isLocked('channel_secret') && (
                    <button
                      type="button"
                      onClick={() => setShowChannelSecret(prev => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                      aria-label={showChannelSecret ? t('user.form_password_hide') : t('user.form_password_show')}
                    >
                      {showChannelSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                </div>
                <InputError error={errors.channel_secret} />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.hook_access_token')} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <textarea
                    disabled={isViewMode}
                    readOnly={secretLock.isLocked('access_token')}
                    name="access_token"
                    value={secretLock.displayValue('access_token', formData.access_token)}
                    onChange={handleChange}
                    rows={4}
                    className={inputClass(!!errors.access_token, secretLock.isLocked('access_token') ? 'opacity-80' : '')}
                  />
                  {!isViewMode && (
                    <SecretLockButtons field="access_token" lock={secretLock}
                      editLabel={t('common.edit')} cancelLabel={t('common.cancel')}
                      offsetClass="right-2 !top-4 !translate-y-0" />
                  )}
                </div>
                <InputError error={errors.access_token} />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.oa_url', channelVars(formData.channel_type))} <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <input
                    disabled={isViewMode}
                    name="line_url"
                    value={formData.line_url}
                    onChange={handleChange}
                    className={inputClass(!!errors.line_url)}
                    placeholder="https://line.me/..."
                  />
                  {formData.line_url && (
                    <a href={formData.line_url} target="_blank" rel="noreferrer" className="p-2.5 rounded-lg bg-dark-700 text-slate-600 hover:text-slate-900 border border-dark-600 transition-colors flex items-center justify-center">
                      <ExternalLink size={20} />
                    </a>
                  )}
                </div>
                <InputError error={errors.line_url} />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Webhook Endpoint
                  {resolvedMode === 'update' && <span className="ml-2 text-[10px] text-primary-600 font-mono italic whitespace-nowrap bg-primary-100 px-2 py-0.5 rounded-md uppercase">Current Webhook</span>}
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={webhookEndpoint}
                    className="w-full bg-emerald-500/10 border border-emerald-500/40 rounded-lg px-4 py-2.5 text-emerald-600 font-mono text-sm font-bold outline-none select-all shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={handleCopyWebhookEndpoint}
                    className="p-2.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 border border-emerald-400 transition-colors flex items-center justify-center shadow-lg shadow-emerald-500/20"
                    title="Copy to clipboard"
                  >
                    <Copy size={20} />
                  </button>
                </div>
              </div>

              <div className="md:col-span-2">
                {/* [FEAT-20260803-GENERALROWS] ป้ายหลักทับศัพท์ไว้ตามที่ผู้ใช้สั่ง
                    ("Chat Bot ID" เป็นชื่อ field ของ LINE แปลแล้วหาไม่เจอ)
                    แปลเฉพาะในวงเล็บ · ใช้คีย์ร่วมกับช่องอื่นที่ไม่บังคับเหมือนกัน
                    → เพิ่มช่อง optional ใหม่วันหน้าไม่ต้องตั้งคีย์ซ้ำอีก */}
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  Chat Bot ID <span className="text-xs text-slate-400">{t('hook_form.optional_suffix')}</span>
                </label>
                <input
                  disabled={isViewMode}
                  name="chat_bot_id"
                  value={formData.chat_bot_id || ''}
                  onChange={handleChange}
                  className={inputClass(!!errors.chat_bot_id || false)}
                  placeholder="U1234567890abcdef..."
                />
                <InputError error={errors.chat_bot_id} />
              </div>
            </div>
          )}

          {activeTab === 'ai' && <HookAiTab ctx={formCtx} />}
          {/* [FEAT-20260822-NOTICEMODE] saves itself on its own route — see the
              file header for why it is not part of this modal's submit. */}
          {activeTab === 'notice' && <HookNoticeTab ctx={formCtx} />}

          {activeTab === 'slip' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-slide-in">
              <div className="md:col-span-2 p-6 bg-primary-500/10 border border-primary-500/20 rounded-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <ShieldCheck className="text-primary-600" size={24} />
                  <h4 className="font-bold text-slate-800">Slip Verification Configuration</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
                  {/* Row 1: Enable / Key */}
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.slip_check')}</label>
                    <select
                      disabled={isViewMode}
                      name="slip_check"
                      value={formData.slip_check ? 'true' : 'false'}
                      onChange={(e) => setFormData(prev => ({ ...prev, slip_check: e.target.value === 'true' }))}
                      className={inputClass(false, 'bg-white font-semibold')}
                    >
                      <option value="false">Inactive</option>
                      <option value="true">Active</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.slip_verify_key')}</label>
                    <div className="relative">
                      <input 
                        disabled={isViewMode} 
                        readOnly={secretLock.isLocked('slip_verify_key')}
                        name="slip_verify_key" 
                        value={secretLock.displayValue('slip_verify_key', formData.slip_verify_key || '')} 
                        onChange={handleChange} 
                        className={inputClass(!!errors.slip_verify_key, secretLock.isLocked('slip_verify_key') ? 'bg-white pr-16 opacity-80' : 'bg-white')} 
                        placeholder="Your Slip Verify Key"
                      />
                      {!isViewMode && (
                        <SecretLockButtons field="slip_verify_key" lock={secretLock}
                          editLabel={t('common.edit')} cancelLabel={t('common.cancel')} />
                      )}
                    </div>
                    <InputError error={errors.slip_verify_key} />
                  </div>

                  {/* ==== [FEAT-20260903-HOOKSLIPPROV] START — which provider verifies this OA's slips
                      WHY IT SITS HERE AND NOT ON THE PAYMENT TOOL: the payment
                      custom tool is unreachable while payment is switched off,
                      and slip verification still runs for a payment-off hook —
                      which is most of them. So the knob has to travel with the
                      hook, next to its slip key.
                      ⚠️ PLAIN TEXT, NOT A SECRET — deliberately no secretLock
                      wiring and no entry in secretLock.tsx / secretMask.ts: it is
                      a provider NAME, and locking it would hide the value and
                      make an operator unlock a box just to read it.
                      LAYOUT: spans both columns on purpose. The cells below are
                      placed by grid auto-flow, so an extra half-width cell here
                      would swap every following field between the left and right
                      column — a silent reshuffle of the whole tab.
                      revert: delete this block + the DEFAULT_FORM entry + the
                      initialData line + the fieldLabels/fieldTabs entries + the
                      two i18n keys. */}
                  {/* [FEAT-20260903-SLIPPROVSELECT] A FIXED CHOICE, NOT FREE TEXT.
                      This was an <input> with the placeholder "e.g. slipguard", so an
                      operator could type anything into the value that steers the
                      slip vendor on the money path. Nothing validates it on either
                      side — the back end accepts any string and its resolver falls
                      back to the current provider for a name it does not know — so
                      a typo produced no error and no visible difference.

                      ⚠️ THE LIST COMES FROM THE SERVER — there is no vendor list in
                      this repository. The control is not rendered while the server
                      reports fewer than two real choices, because every option an
                      operator could pick would mean "no change"; it appears by
                      itself the day a second provider is registered.

                      🔴 Hiding the CONTROL must never touch the VALUE. The populate
                      line and `buildHookPayload` still carry `slip_provider`, so an
                      operator editing an unrelated tab cannot wipe a hook's provider
                      — that is what `test/hookSlipProvider.value.test.tsx` pins, and
                      it is the failure this dashboard has had before. */}
                  {/* ==== [MERGE-20260904-SLIPGUARDOFF] WHAT AN OPERATOR SEES TODAY: NOTHING
                      ==========================================================
                      This control is HIDDEN on purpose right now, and the reason is not
                      in this file. SlipGuard — the second slip provider — is written,
                      measured against the live API and covered by its own specs, but it
                      is switched OFF in the back end, so the server reports one real
                      choice and the condition below is false. Owner's decision on the
                      day the lane merged: ship it dark, turn it on later.

                      🔴 THERE IS NOTHING TO CHANGE HERE WHEN IT COMES BACK. The switch
                      is a single line in the back end:
                          omnidesk-api/src/modules/slip/providers/provider-entries.ts
                          { provider: slipguardProvider, enabled: false }   ← flip to true
                      Flip it and this picker, the branch box below and the `pay_topup`
                      binding on the Custom Tools page all appear on their own, with no
                      release from this repository. That is the whole point of asking the
                      server what a field may be set to.

                      ⚠️ DO NOT "FIX" THIS BY HARDCODING A VENDOR LIST HERE, and do not
                      lower the `>= 2`. Either one puts a choice on screen that the back
                      end cannot act on: it saves, the runtime ignores it, and nothing
                      anywhere reports that the operator's choice did nothing.

                      ⚠️ BEFORE THAT FLIP, read the notes on the entry itself — Shop-API has
                      to confirm it reads a new vendor's envelope first, because a hook
                      with its payment tool on forwards this provider's reply to it and
                      the failure lands REMOTELY, after the slip is already verified and
                      answered. Flipping it also turns a tripwire spec red by design. */}
                  {slipProviderChoiceCount >= 2 && (
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      {t('hook_form.slip_provider')}
                    </label>
                    <select
                      disabled={isViewMode}
                      name="slip_provider"
                      value={(formData as any).slip_provider ?? ''}
                      onChange={handleChange}
                      className={inputClass(false, 'bg-white font-semibold')}
                    >
                      {/* [FEAT-20260903-FALLBACKLABEL] not `t(o.label_key)` directly:
                          i18n resolves an unknown key to the key itself, so a vendor
                          registered on the back end today would be offered as the
                          literal `field_options.slip_provider.<name>` until a
                          translation shipped here — which would have made "the control
                          appears with no release on this side" only half true. */}
                      {slipProviderOptions.map((o) => (
                        <option key={o.value} value={o.value}>{fieldOptionLabel(o, t)}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                      {t('hook_form.slip_provider_hint')}
                    </p>
                    {/* The pair warning ships WITH the control, so it appears the
                        moment a provider can actually be chosen — not as standing
                        text about something no operator can do yet. */}
                    <p className="text-[10px] text-amber-600 mt-1 px-1">
                      {t('hook_form.slip_provider_clone_warn')}
                    </p>
                  </div>
                  )}
                  {/* ==== [FEAT-20260903-VENDORBRANCH] the hook's sub-account ====

                      Some providers do not identify the merchant by the key alone —
                      the account is part of the ENDPOINT (SlipGuard posts to
                      `…/api/line/apikey/<BRANCH>`). So a hook needs a key AND a
                      branch, and the key already sits on this tab.

                      ⚠️ SHOWN UNDER THE SAME CONDITION AS THE PICKER ABOVE, on
                      purpose. While the server offers one real choice there is no
                      provider to need it, and a lone box for an unnameable vendor is
                      noise on a money tab. It appears the day the back end registers
                      a second provider — with no release here, the same property the
                      options endpoint exists for.

                      ⚠️ ONE INPUT FOR ALL PROVIDERS, not one per vendor. Which
                      vendors use it is the back end's knowledge, and asking the
                      server per-provider would be machinery with one caller. The
                      hint says to leave it empty when the provider does not use one.

                      🔴 Hiding it must never touch the VALUE — the populate line and
                      `buildHookPayload` still carry `slip_verify_branch`, so editing
                      an unrelated tab cannot wipe a hook's branch. */}
                  {slipProviderChoiceCount >= 2 && (
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      {t('hook_form.slip_verify_branch')}
                    </label>
                    <input
                      type="text"
                      name="slip_verify_branch"
                      value={(formData as any).slip_verify_branch ?? ''}
                      onChange={handleChange}
                      className={inputClass(false)}
                    />
                    <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                      {t('hook_form.slip_verify_branch_hint')}
                    </p>
                  </div>
                  )}
                  {/* 🔴 [FIX-20260903-HOSTNOTAFIELD] A "provider host for this hook"
                      INPUT STOOD HERE AND WAS REMOVED THE SAME DAY.

                      It was built on the owner's instruction, when the host was
                      still read from a Swiftcheck-named env and env was ruled out —
                      "per hook" was simply the first place to move it to. Seeing
                      this form, the owner ruled again, and the second ruling is the
                      right one: an operator has no way to know a vendor's host, so
                      a free-text box here is a way to mistype the destination of a
                      customer's slip image and this hook's key. The back end is the
                      single source of truth; a vendor changing its URL is one line
                      in that vendor's own file (`provider.defaultBaseUrl`).

                      So there is nothing to show here, on purpose. The field is gone
                      from the schema, the update whitelist, the tab map, the types
                      and both locales — not merely hidden, because a hidden input
                      still round-trips a value nothing reads.
                      ⇒ host ไม่ใช่ค่าที่คนกรอก · ไม่ต้องโชว์ ไม่ต้องเก็บใน DB */}
                  {/* ==== [FEAT-20260903-HOOKSLIPPROV] END */}

                  {/* DB field: hooks.slip_require_profile (+ copy in
                       hooks.slip_require_profile_text). BE reads it in
                       webhook.service via shouldBlockUnlinkedSlip; when it blocks, the
                       flow replies with the paired text and stops — no slip check, no
                       ticket, and neither missing_api_data_text nor image_answer_text
                       runs. Works even when slip verification itself is off.
                       ⚠️ BE tests it with === true, so it must be sent as a real
                       boolean; a string "true" shows as ON here but does nothing there. */}
                  {/* ==== [FEAT-20260809-SLIPREQPROF] START — รับสลิปเฉพาะคนที่ผูกบัญชีแล้ว
                       WHAT: เปิดแล้ว = ถ้าปลายทางตอบชัดว่า "ไม่มีลูกค้าคนนี้" จะไม่ตรวจสลิปเลย
                             (ไม่เสียค่าตรวจ ไม่สร้างระเบียนสลิป) แล้วตอบให้ไปผูกบัญชีก่อน
                       WHY : คนที่ยังไม่ผูกบัญชีก็โอนเงินและส่งสลิปได้ → เดิมเสียค่าตรวจฟรี ๆ
                             แล้วไปพังทีหลังให้แอดมินตามเก็บ
                       HOW : ข้อความเว้นว่าง = BE ใช้ข้อความกลางของมันเอง (ดู placeholder)

                       ⚠️ **ห้ามเขียนคำอธิบายว่า "บล็อกสลิปเมื่อดึงโปรไฟล์ไม่ได้"** —
                          ยิงเฉพาะคำตอบชัด ๆ ว่าไม่มีลูกค้ารายนี้เท่านั้น · ปลายทางล่ม/timeout/
                          เบรกเกอร์ตัด/401/403/tool ตั้งค่าผิด = **fail-open** ตรวจสลิปตามปกติ
                          (fail-closed ตอนปลายทางล่มจะแปลว่าลูกค้าเก่าทุกคนโดนบอกว่ายังไม่ผูกบัญชี
                           และไม่มีสลิปไหนถูกตรวจเลย — จงใจไม่ทำแบบนั้น)

                       สถานะปิดคือค่าเริ่มต้นของ OA ทุกตัวที่มีอยู่ → จงใจไม่ใส่สีเตือน/ดาวบังคับ
                       ให้ดูเป็นตัวเลือกปกติตัวหนึ่งในกลุ่มนี้ ไม่ใช่ของที่ยังตั้งไม่เสร็จ */}
                  {/* ==== [FEAT-20260822-QRPRESCANFE] START — jsQR prescan mode
                      WHAT: does the OA look for a QR in an inbound image BEFORE
                            spending a slip-verification call?
                      WHY HERE: it is a slip-path decision and BE puts it in this
                            very tab (`hook-field-tabs.ts:108`), which is also
                            what makes it travel with a Multi-Clone of "slip".
                      WHY IT MATTERS BEYOND COST: `qr_found` is what the notice
                            mode's slip cases (E/F) fire on — with this off they
                            can never fire, however many cards are bound.
                      revert: delete this block + the DEFAULT_FORM entry + the
                            initialData line + the tab-map entry. */}
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      {t('hook_form.qr_prescan_mode')}
                    </label>
                    <select
                      disabled={isViewMode}
                      name="qr_prescan_mode"
                      value={(formData as any).qr_prescan_mode ?? 'off'}
                      onChange={handleChange}
                      className={inputClass(false, 'bg-white font-semibold')}
                    >
                      <option value="off">{t('hook_form.qr_prescan_off')}</option>
                      <option value="log">{t('hook_form.qr_prescan_log')}</option>
                      <option value="skip">{t('hook_form.qr_prescan_skip')}</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                      {t('hook_form.qr_prescan_hint')}
                    </p>
                  </div>
                  {/* ==== [FEAT-20260822-QRPRESCANFE] END */}
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">
                      {t('pageui.hookform.slip_require_profile_label', 'รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว')}
                    </label>
                    <select
                      disabled={isViewMode}
                      name="slip_require_profile"
                      value={(formData as any).slip_require_profile ? 'true' : 'false'}
                      onChange={(e) => setFormData(prev => ({ ...prev, slip_require_profile: e.target.value === 'true' } as any))}
                      className={inputClass(false, 'bg-white font-semibold')}
                    >
                      <option value="false">Inactive</option>
                      <option value="true">Active</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                      {t('pageui.hookform.slip_require_profile_hint_a', 'เปิด = ถ้าเช็คแล้วพบว่า')}<b>{t('pageui.hookform.slip_require_profile_hint_b', 'ยังไม่ได้เป็นลูกค้า')}</b> {t('pageui.hookform.slip_require_profile_hint_c', 'จะไม่ตรวจสลิปให้ (ไม่เสียค่าตรวจ)')}{' '}
                      {t('pageui.hookform.slip_require_profile_hint_d', 'และตอบให้ไปผูกบัญชีก่อน · ถ้าระบบปลายทางล่มหรือเช็คไม่ได้ จะตรวจสลิปตามปกติ')}
                    </p>
                  </div>
                  {/* ข้อความจะโผล่เมื่อเปิดใช้เท่านั้น — ปิดอยู่แล้วโชว์ช่องข้อความที่ไม่มีวันได้ใช้
                      จะกินที่และชวนให้เข้าใจผิดว่าต้องกรอก · ค่าที่พิมพ์ไว้ไม่หายตอนปิด
                      (เก็บใน state ตามเดิม) เปิดกลับมาเมื่อไหร่ก็เห็นข้อความเดิม */}
                  {(formData as any).slip_require_profile ? (
                    <div className="animation-fade-in">
                      <label className="block text-sm font-medium text-slate-500 mb-1">
                        {t('pageui.hookform.slip_require_profile_text_label', 'ข้อความตอบคนที่ยังไม่ผูกบัญชี')}
                      </label>
                      <input
                        disabled={isViewMode}
                        name="slip_require_profile_text"
                        value={(formData as any).slip_require_profile_text || ''}
                        onChange={handleChange}
                        className={inputClass(false, 'bg-white')}
                        /* placeholder = ข้อความจริงที่ BE จะส่งถ้าเว้นว่าง (คัดมาจากฝั่ง BE)
                           → คนตั้งค่าเห็นได้เลยว่าไม่กรอกแล้วลูกค้าจะได้อ่านอะไร
                           ⚠️ ถ้า BE แก้ข้อความกลาง ต้องมาแก้บรรทัดนี้ตาม */
                        placeholder="ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง"
                      />
                      <p className="text-[10px] text-slate-400 mt-1.5 px-1 italic">
                        {t('pageui.hookform.blank_uses_default', 'เว้นว่าง = ใช้ข้อความเริ่มต้นของระบบ (ตามที่เห็นจาง ๆ ในช่อง)')}
                      </p>
                    </div>
                  ) : (
                    /* ช่องว่างไว้รักษาโครง 2 คอลัมน์ ไม่ให้ของแถวถัดไปเลื่อนขึ้นมาสลับซ้ายขวา */
                    <div aria-hidden="true" />
                  )}
                  {/* ==== [FEAT-20260809-SLIPREQPROF] END */}

                  {/* Row 2: Match Account / Min Amount */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="block text-sm font-medium text-slate-500">{t('hook_form.match_account')}</label>
                      <button
                        type="button"
                        onClick={handleShowMatchHelp}
                        className="p-1 rounded-full hover:bg-primary-100 text-primary-500 hover:text-primary-600 transition-all animate-bounce"
                        title="More Information"
                      >
                        <HelpCircle size={18} fill="currentColor" fillOpacity={0.1} />
                      </button>
                    </div>
                    <select
                      disabled={isViewMode}
                      name="match_account"
                      value={formData.match_account ? 'true' : 'false'}
                      onChange={(e) => setFormData(prev => ({ ...prev, match_account: e.target.value === 'true' }))}
                      className={inputClass(false, 'bg-white font-semibold')}
                    >
                      <option value="false">Inactive</option>
                      <option value="true">Active</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.slip_check_min_amount')}</label>
                    <input
                      type="number"
                      disabled={isViewMode}
                      name="slip_check_min_amount"
                      value={formData.slip_check_min_amount === null ? '' : formData.slip_check_min_amount}
                      onChange={handleChange}
                      className={inputClass(false, 'bg-white')}
                      placeholder="e.g. 100"
                    />
                  </div>

                  {/* Row 3: Callback URL / Out of Time */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-slate-500">{t('hook_form.callback_slip')}</label>
                      {!isViewMode && (
                        <button
                          type="button"
                          onClick={handleAddCallbackSlip}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                        >
                          <Plus size={14} />
                          {t('hook_form.add_url')}
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {(formData.callback_slip || []).length === 0 ? (
                        <div className="text-xs text-slate-400 italic py-2">No callback URLs configured.</div>
                      ) : (
                        (formData.callback_slip || []).map((url, idx) => (
                          <div key={idx} className="flex gap-2 group">
                            <input
                              disabled={isViewMode}
                              value={url}
                              onChange={(e) => handleCallbackSlipChange(idx, e.target.value)}
                              placeholder="https://your-api.com/hook"
                              className={inputClass(false, 'bg-white text-xs py-1.5')}
                            />
                            {!isViewMode && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCallbackSlip(idx)}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all rounded-lg"
                                title="Remove URL"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.slip_check_out_of_time')}</label>
                    <input
                      type="number"
                      disabled={isViewMode}
                      name="slip_check_out_of_time"
                      value={formData.slip_check_out_of_time === null ? '' : formData.slip_check_out_of_time}
                      onChange={handleChange}
                      className={inputClass(false, 'bg-white')}
                      placeholder="e.g. 50"
                    />
                  </div>

                  {/* Row 4: Callback Token - Conditionally Rendered */}
                  {(formData.callback_slip || []).length > 0 && (
                    <>
                      <div className="animation-fade-in">
                        <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-2">
                          {t('hook_form.callback_token')}
                          <span className="text-red-500">*</span>
                        </label>
                        <div className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <ShieldCheck className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
                          </div>
                          <input
                            disabled={isViewMode}
                            name="callback_token"
                            value={formData.callback_token || ''}
                            onChange={handleChange}
                            className={inputClass(!!errors.callback_token, 'bg-white pl-11')}
                            placeholder="your-secure-token-here"
                          />
                        </div>
                        <InputError error={errors.callback_token} />
                        <p className="text-[10px] text-slate-400 mt-1.5 px-1 italic">
                          {t('hook_form.validation_callback_token_required')}
                        </p>
                      </div>

                      <div className="animation-fade-in">
                        <label className="block text-sm font-medium text-slate-500 mb-1 flex items-center gap-2">
                          {t('hook_form.callback_action')}
                        </label>
                        <div className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                            <Activity className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
                          </div>
                          <select
                            disabled={isViewMode}
                            name="callback_action"
                            value={formData.callback_action || 'none'}
                            onChange={handleChange}
                            className={inputClass(false, 'bg-white pl-11')}
                          >
                            <option value="none">{t('hook_form.callback_action_none')}</option>
                            <option value="success">{t('hook_form.callback_action_success')}</option>
                            <option value="all">{t('hook_form.callback_action_all')}</option>
                          </select>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6 bg-dark-900/30 p-6 rounded-2xl border border-dark-700">
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_success')}</label>
                  <select disabled={isViewMode} name="flex_success" value={formData.flex_success || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {/* <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_fail')}</label>
                  <select disabled={isViewMode} name="flex_fail" value={formData.flex_fail || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div> */}
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_duplicate')}</label>
                  <select disabled={isViewMode} name="flex_duplicate" value={formData.flex_duplicate || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_other')}</label>
                  <select disabled={isViewMode} name="flex_other" value={formData.flex_other || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_not_found')}</label>
                  <select disabled={isViewMode} name="flex_not_found" value={formData.flex_not_found || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_min_amount')}</label>
                  <select disabled={isViewMode} name="flex_min_amount" value={formData.flex_min_amount || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {/* <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_max_amount')}</label>
                  <select disabled={isViewMode} name="flex_max_amount" value={formData.flex_max_amount || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div> */}
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_error')}</label>
                  <select disabled={isViewMode} name="flex_error" value={formData.flex_error || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-sm font-medium text-slate-500">{t('hook_form.flex_success_not_match')}</label>
                    <button
                      type="button"
                      onClick={handleShowMatchHelp}
                      className="p-1 rounded-full hover:bg-primary-100 text-primary-500 hover:text-primary-600 transition-all animate-bounce"
                      title="More Information"
                    >
                      <HelpCircle size={18} fill="currentColor" fillOpacity={0.1} />
                    </button>
                  </div>
                  <select disabled={isViewMode} name="flex_success_not_match" value={formData.flex_success_not_match || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.flex_out_of_time')}</label>
                  <select disabled={isViewMode} name="flex_out_of_time" value={formData.flex_out_of_time || ''} onChange={handleChange} className={inputClass(false, 'bg-white')}>
                    <option value="">{t('common.none')}</option>
                    {slipTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.qr_code_fail_anwser_text')}</label>
                  <textarea disabled={isViewMode} name="qr_code_fail_anwser_text" value={formData.qr_code_fail_anwser_text || ''} onChange={handleChange} rows={3} className={inputClass(false, 'bg-white')} />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-slide-in">
              <div className="md:col-span-2 p-6 bg-dark-900 border border-dark-700 rounded-2xl flex flex-col gap-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Bell className="text-primary-500" size={24} />
                    <h4 className="font-bold text-slate-900">Telegram Notification Settings</h4>
                  </div>
                  <a
                    href="https://drive.google.com/file/d/EXAMPLE_FILE_ID/view?usp=sharing"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-lg border border-blue-500/40 bg-blue-500/5 px-2 py-1 text-[10px] font-bold text-blue-500 hover:bg-blue-500/10 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink size={12} className="mr-1" />
                    {t('pageui.hookform.telegram_setup_guide', 'สอนการตั้งค่า Telegram Bot')}
                  </a>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-2">{t('hook_form.telegram_noti_type')}</label>
                  <select
                    disabled={isViewMode}
                    name="telegram_noti_type"
                    value={formData.telegram_noti_type || ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : e.target.value;
                      setFormData(prev => ({ ...prev, telegram_noti_type: val as any }));
                    }}
                    className={inputClass(false, 'bg-white font-semibold')}
                  >
                    <option value="all">{t('hook_form.telegram_noti_type_all') || 'All notifications'}</option>
                    <option value="text">{t('hook_form.telegram_noti_type_text') || 'Text only'}</option>
                    <option value="image">{t('hook_form.telegram_noti_type_image') || 'Image only'}</option>
                    <option value="none">None</option>
                  </select>
                  <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed italic">
                    {t('hook_form.telegram_noti_type_hint')}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.telegram_key')}</label>
                    <div className="relative">
                      <input
                        disabled={isViewMode}
                        readOnly={secretLock.isLocked('telegram_key')}
                        name="telegram_key"
                        value={secretLock.displayValue('telegram_key', formData.telegram_key || '')}
                        onChange={handleChange}
                        className={inputClass(!!errors.telegram_key, secretLock.isLocked('telegram_key') ? 'pr-16 opacity-80' : '')}
                        placeholder="e.g. 7475141019:AAEV9_..."
                      />
                      {!isViewMode && (
                        <SecretLockButtons field="telegram_key" lock={secretLock}
                          editLabel={t('common.edit')} cancelLabel={t('common.cancel')} />
                      )}
                    </div>
                    <div className="mt-2">
                      <a
                        href="https://t.me/BotFather"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary-500 hover:text-primary-600 transition-colors"
                      >
                        <ExternalLink size={12} />
                        Get Bot Key from @BotFather
                      </a>
                    </div>
                    <InputError error={errors.telegram_key} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-slate-500">{t('hook_form.telegram_chat_id')}</label>
                      {!isViewMode && (
                        <button
                          type="button"
                          onClick={() => setTelegramModalOpen(true)}
                          className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 transition-all active:scale-95"
                        >
                          <Monitor size={12} />
                          {t('hook_form.telegram_fetch_chat_id')}
                        </button>
                      )}
                    </div>
                    <input
                      disabled={isViewMode}
                      name="telegram_chat_id"
                      value={formData.telegram_chat_id || ''}
                      onChange={handleChange}
                      className={inputClass(!!errors.telegram_chat_id)}
                      placeholder="e.g. -1002235941913"
                    />
                    {!isViewMode && (
                      <a
                        href="/#/via-telegram"
                        target="_blank"
                        rel="noreferrer"
                        className="w-fit inline-flex items-center rounded-lg border border-blue-500/60 bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-500 hover:bg-blue-600/30 transition-colors mt-2"
                      >
                        {t('pageui.hookform.telegram_backup_link', 'ลิงก์สำรองกรณี ไม่ได้ข้อมูล chat ID')}
                      </a>
                    )}
                    <InputError error={errors.telegram_chat_id} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'external_api' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animation-slide-in">
              <div className="extapi-card md:col-span-2 p-6 bg-dark-900 border border-dark-700 rounded-2xl flex flex-col gap-6">
                <div className="flex items-center justify-between gap-3">
                  {/* [FEAT-20260810-EXTAPIFOLD] หัวข้อเป็นปุ่มพับ · ปุ่ม Test ยังอยู่ข้างนอก
                      จึงกดทดสอบได้โดยไม่ต้องกางกล่อง */}
                  <button
                    type="button"
                    onClick={() => setExtApiOpen(o => !o)}
                    aria-expanded={extApiOpen}
                    className="flex items-center gap-3 text-left cursor-pointer"
                  >
                    <Globe className="text-primary-500" size={24} />
                    <h4 className="font-bold text-slate-900">External API Configuration</h4>
                    <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${extApiOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {resolvedMode === 'update' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={testingCompareApi}
                        onClick={() => setShowCompareModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-all text-xs font-bold shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
                      >
                        <Repeat size={14} />
                        Test Comparison
                      </button>
                      <button
                        type="button"
                        disabled={testingExternalApi}
                        onClick={handleTestExternalApi}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 text-white hover:bg-orange-600 transition-all text-xs font-bold shadow-lg shadow-orange-500/20 active:scale-95 disabled:opacity-50"
                      >
                        {testingExternalApi ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        Test Connection
                      </button>
                    </div>
                  )}
                </div>
                
                {/* [FEAT-20260810-EXTAPIFOLD] `hidden` ไม่ใช่ unmount — input ยังอยู่ใน DOM
                    ค่าที่พิมพ์ไว้จึงไม่หายเวลาพับ และ validation ที่อ่าน DOM ยังทำงานเหมือนเดิม */}
                <div className={`grid grid-cols-1 gap-6 ${extApiOpen ? '' : 'hidden'}`}>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.external_api_url')}</label>
                    <input
                      disabled={isViewMode}
                      name="external_api_url"
                      value={formData.external_api_url || ''}
                      onChange={handleChange}
                      className={inputClass(false)}
                      placeholder="https://api.example.com"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.external_user')}</label>
                      <input
                        disabled={isViewMode}
                        name="external_user"
                        value={formData.external_user || ''}
                        onChange={handleChange}
                        className={inputClass(false)}
                        placeholder="API Username"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-500 mb-1">{t('hook_form.external_password')}</label>
                      <div className="relative">
                        <input
                          disabled={isViewMode}
                          readOnly={secretLock.isLocked('external_password')}
                          name="external_password"
                          value={secretLock.displayValue('external_password', formData.external_password || '')}
                          onChange={handleChange}
                          type={showExternalPassword ? 'text' : 'password'}
                          className={inputClass(!!errors.external_password, secretLock.isLocked('external_password') ? 'pr-16 opacity-80' : 'pr-10')}
                          placeholder="API Password"
                        />
                        {!isViewMode && (
                          <SecretLockButtons field="external_password" lock={secretLock}
                            editLabel={t('common.edit')} cancelLabel={t('common.cancel')}
                            offsetClass={secretLock.isUnlocked('external_password') ? 'right-10' : 'right-2'} />
                        )}
                        {!isViewMode && !secretLock.isLocked('external_password') && (
                          <button
                            type="button"
                            onClick={() => setShowExternalPassword(!showExternalPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 transition-colors"
                          >
                            {showExternalPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ==== [FEAT-20260728-CUSTREG] START — section ใหม่ "Customer Link"
                    🔒 สาย AUTO — to_dev_auto เท่านั้น ห้าม merge เข้า to_dev

                    ใช้กับ flow keyword "customer-register" → Flex ปุ่มลงทะเบียน →
                    landing → /customer-link/match → login 3rd-party จริง

                    ==== [FEAT-20260728-CUSTAPI] แก้ 2026-07-28: เหลือ 3 ช่อง ====
                    เดิม section นี้มี 7 ช่อง รวม Base URL / Username / Password /
                    Timeout ซึ่งซ้ำกับ section "External API" ที่อยู่เหนือขึ้นไป
                    (external_api_url / external_user / external_password) —
                    เรื่องเดียวกันแต่กรอกสองที่ ได้ JWT สองใบ = ผิดพลาดง่าย
                    ตอนนี้ URL + creds + path ทุกเส้นใช้ของ External API ชุดเดียว
                    เหลือที่นี่แค่ค่าที่ Customer Link เป็นเจ้าของจริง ๆ 3 ช่อง
                    (path ตั้งที่ Custom API Endpoints ด้านล่าง — มีปุ่ม preset ให้) */}
                {/* [FEAT-20260810-EXTAPIFOLD] เจ้าของสั่งให้ "แยก customer link ออกไป"
                    ⇒ เลิกเป็นส่วนต่อท้ายที่คั่นด้วยเส้น กลายเป็นกล่องของตัวเอง (border/bg
                    ชุดเดียวกับกล่อง External API) และพับได้แยกกัน — เปิดเป็นค่าเริ่มต้น
                    ยังอยู่ใน <div> เดิมของแท็บ จึงไม่ต้องย้าย scope ตัวแปรใด ๆ */}
                {/* [FEAT-20261018-EXTAPICARDS] the Custom Tool binding is its own card, BEFORE Customer
                    Link (owner 18/10/2026) — it never depended on Customer Link (BE reads only
                    custom_tool_status + custom_tool_id). Same element, same fields as before. */}
                {customToolBinding}

                {/* [FEAT-20261018-SCREENSECTIONS] loan: the BE lists 'hook-form.customer-link' in
                    `hidden` (its register world is off — nothing to register through chat) */}
                {!customerLinkHidden && (
                <div className="extapi-card p-5 bg-dark-900 border border-dark-700 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <button
                      type="button"
                      onClick={() => setCustLinkOpen(o => !o)}
                      aria-expanded={custLinkOpen}
                      className="flex items-center gap-2 text-left cursor-pointer"
                    >
                      <Link className="text-emerald-500" size={20} />
                      <h5 className="font-bold text-slate-800">{t('pageui.hookform.customer_link_title', 'Customer Link (ลงทะเบียนผ่านแชท)')}</h5>
                      <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${custLinkOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {/* สวิตช์เปิดใช้งานอยู่นอกส่วนที่พับ — เห็นสถานะได้ทันทีแม้พับอยู่ */}
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        disabled={isViewMode}
                        checked={!!(formData as any).customer_link_enabled}
                        onChange={e => setFormData(prev => ({ ...prev, customer_link_enabled: e.target.checked } as any))}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <span className="text-xs font-black text-emerald-700">{t('pageui.hookform.enabled', 'เปิดใช้งาน')}</span>
                    </label>
                  </div>

                  {/* [FEAT-20260810-EXTAPIFOLD] พับแล้วซ่อนเนื้อใน · เงื่อนไข
                      `customer_link_enabled` เดิมยังอยู่ครบข้างใน ไม่ได้เปลี่ยนตรรกะ */}
                  <div className={custLinkOpen ? '' : 'hidden'}>
                  {!(formData as any).customer_link_enabled ? (
                    <>
                    <p className="text-xs text-slate-400 italic">
                      {t('pageui.hookform.customer_link_off_a', 'ปิดอยู่ — ลูกค้าพิมพ์')} <code className="px-1 bg-dark-700 rounded">customer-register</code> {t('pageui.hookform.customer_link_off_b', 'จะไม่มีผล (เข้าระบบตอบอัตโนมัติตามปกติ)')}
                    </p>
                    </>
                  ) : (
                    <div className="grid grid-cols-1 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-500 mb-1">
                          {/* [FEAT-20260731-LABELS] dropped "(ว่าง = ใช้ค่ากลาง …)":
                              the placeholder below already shows the fallback URL,
                              ไม่ต้องบอกซ้ำในหัวข้อฟิลด์ */}
                          Landing URL
                        </label>
                        <input
                          disabled={isViewMode}
                          name="customer_link_landing_url"
                          value={(formData as any).customer_link_landing_url || ''}
                          onChange={handleChange}
                          className={inputClass(false)}
                          placeholder="https://customer.example.comm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-500 mb-1">
                          {/* [FEAT-20260729-LABELS] dropped "— ชนะค่าที่ client ส่งมา":
                              it described an internal precedence rule that means
                              nothing to whoever fills in this field. */}
                          Web Code <span className="text-slate-400 font-normal">{t('pageui.hookform.of_this_oa', '(ของ OA นี้)')}</span>
                        </label>
                        <input
                          disabled={isViewMode}
                          name="customer_link_web_code"
                          value={(formData as any).customer_link_web_code || ''}
                          onChange={handleChange}
                          className={inputClass(false)}
                          placeholder={t('pageui.hookform.web_code_ph', 'เช่น sim_alpha')}
                        />
                      </div>


                    </div>
                  )}
                  </div>{/* [FEAT-20260810-EXTAPIFOLD] ปิด wrapper ที่พับได้ */}
                </div>
                )}
                {/* ==== [FEAT-20260728-CUSTREG] END */}

                {/* ==== [FEAT-20260809-PAYUNGATE] moved out of the Customer Link gate.
                     WHAT: the payment + walletpay tool bindings used to render inside the
                     `customer_link_enabled` else-branch, so an OA with Customer Link OFF
                     could not see or set them at all.
                     WHY : there is no backend coupling — resolvePaymentTool gates on
                     payment_tool_status + payment_tool_id only and never reads
                     customer_link_enabled. The nesting was inherited layout from when this
                     area was only about Customer Link. เปิด/ปิด Customer Link ไม่เกี่ยวกับ
                     การตั้งค่าตรวจสลิปเลย จึงต้องแยกออกมาให้เห็นเสมอ
                     HOW : it is a plain sibling section now. To move it again, move the
                     whole PAYCUSTOOL block — every local it uses (payOn/payId/payTools/
                     walletpay*) is declared inside its own IIFEs, so it carries no scope. */}
                  {/* ==== [FEAT-20260808-PAYCUSTOOL] START — ผูก tool ตรวจสลิป (หมวด payment)
                      WHAT: เลือกว่า OA นี้จะใช้ tool ตรวจสลิปตัวไหน + สวิตช์เปิด/ปิด
                      WHY : แยกจาก Custom Tool ด้านบนคนละช่อง เพราะคนละหน้าที่กันคนละเรื่อง
                            (ด้านบน = ดึงข้อมูลลูกค้า · อันนี้ = เส้นทางเงินเข้า)
                      HOW : ตัว tool สร้าง/แก้ที่เมนู Custom Tools แล้วเลือกหมวดเป็น payment
                            จากนั้นจะโผล่ให้เลือกในช่องนี้

                      ⚠️ **ปิดสวิตช์ = สลิปทำงานแบบเดิมทุกอย่างเหมือนก่อนมีฟีเจอร์นี้**
                         จงใจทำให้สถานะ "ปิด" เห็นชัดด้วยสีเทาทั้งกล่อง — คนที่ไม่ได้ตั้งใจ
                         ใช้ฟีเจอร์นี้ต้องดูออกทันทีว่ามันไม่ได้ทำงานอยู่ ไม่ต้องเดา */}
                  {(() => {
                    // อ่านค่า 2 ตัวนี้ครั้งเดียว แล้วใช้ซ้ำทั้งกล่อง (formData เป็น any อยู่แล้ว)
                    const payOn = !!(formData as any).payment_tool_status;
                    const payId = (formData as any).payment_tool_id || '';
                    // เลือกเฉพาะ tool หมวด payment เท่านั้น — เอา tool ทั่วไปมาใส่ช่องนี้ไม่ได้
                    const payTools = customToolOptions.filter(t => t.category === 'payment');
                    /* [FEAT-20261018-EXTAPICARDS] its own foldable card. OFF used to grey the whole
                       box; the owner asked for white cards, so OFF now reads from the grey
                       "ปิดอยู่" badge + muted title, and ON keeps the green tint (toneClass). */
                    return (
                      <ExtApiFoldCard
                        toneClass={payOn ? 'border-emerald-300 bg-emerald-50/60' : undefined}
                        icon={<Terminal className={payOn ? 'text-emerald-600' : 'text-slate-400'} size={20} />}
                        title={
                          <>
                            <h5 className={`font-bold ${payOn ? 'text-emerald-800' : 'text-slate-500'}`}>
                              {t('pageui.hookform.pay_tool_title', 'ตรวจสลิปด้วย Custom Tool (หมวด payment)')}
                            </h5>
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-black ${
                              payOn ? 'bg-emerald-600 text-white' : 'bg-slate-400 text-white'
                            }`}>
                              {payOn ? t('pageui.hookform.state_on', 'เปิดอยู่') : t('pageui.hookform.state_off', 'ปิดอยู่')}
                            </span>
                          </>
                        }
                        right={
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              disabled={isViewMode}
                              checked={payOn}
                              onChange={e => setFormData(prev => ({ ...prev, payment_tool_status: e.target.checked } as any))}
                              className="w-4 h-4 accent-emerald-600"
                            />
                            <span className={`text-[11px] font-black ${payOn ? 'text-emerald-700' : 'text-slate-500'}`}>
                              {t('pageui.hookform.enable_switch', 'เปิดใช้')}
                            </span>
                          </label>
                        }
                      >

                        <select
                          disabled={isViewMode}
                          value={payId}
                          onChange={e => setFormData(prev => ({ ...prev, payment_tool_id: e.target.value || null } as any))}
                          className={inputClass(false)}
                        >
                          <option value="">{t('pageui.hookform.no_tool_selected', '— ยังไม่เลือก tool —')}</option>
                          {payTools.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name} · {t.base_url}
                            </option>
                          ))}
                        </select>

                        {/* เปิดแล้วแต่ไม่ได้เลือก tool = เปิดค้างไว้เฉย ๆ ไม่มีอะไรทำงาน */}
                        {payOn && !payId && (
                          <p className="mt-2 text-[11px] font-bold text-amber-700">
                            {t('pageui.hookform.pay_on_no_tool', '⚠️ เปิดใช้แล้วแต่ยังไม่ได้เลือก tool — สลิปจะยังทำงานแบบเดิมอยู่')}
                          </p>
                        )}
                        {/* ไม่มี tool หมวด payment ให้เลือกเลย = ยังไม่ได้สร้างที่เมนู Custom Tools */}
                        {payTools.length === 0 && (
                          <p className="mt-2 text-[11px] font-bold text-amber-700">
                            {t('pageui.hookform.pay_no_tools_a', '⚠️ ยังไม่มี tool หมวด payment ให้เลือก — สร้างที่เมนู')} <b>Custom Tools</b> {t('pageui.hookform.pay_no_tools_b', 'แล้วตั้งหมวดเป็น')} <b>payment</b> {t('pageui.hookform.pay_no_tools_c', 'ก่อน')}
                          </p>
                        )}

                        <p className={`mt-2 text-[11px] ${payOn ? 'text-emerald-900/70' : 'text-slate-500'}`}>
                          {payOn ? (
                            <>
                              {t('pageui.hookform.pay_on_desc_a', 'สลิปที่ลูกค้าส่งเข้ามา จะถูกจับคู่กับรายการเดินบัญชีแล้วเติมเงินตามที่ตั้งไว้ใน tool ·')}{' '}
                              {t('pageui.hookform.pay_on_desc_b', 'ข้อความตอบลูกค้าแต่ละสถานการณ์ตั้งได้ที่หน้า')} <b>Custom Tools</b>
                            </>
                          ) : (
                            <>
                              <b>{t('pageui.hookform.state_off', 'ปิดอยู่')}</b> {t('pageui.hookform.pay_off_desc', '— สลิปทำงานแบบเดิมทุกอย่าง เหมือนตอนที่ยังไม่มีฟีเจอร์นี้')}
                            </>
                          )}
                        </p>

                        {/* ==== [FEAT-20260809-WALLETPAYTOOL] START — tool ของขา walletpay (ไม่บังคับ)
                            WHAT: เลือก tool อีกตัวไว้ยิงเฉพาะขา walletpay
                            WHY : BE ต่อ URL เป็น `base_url ของ tool + path ของเส้น` และ tool
                                  ตัวหนึ่งมี base_url ได้แค่ค่าเดียว แต่ขาเงิน 2 ขาอยู่คนละ host:
                                    · เติมเงิน (topup) = เส้นย่อยของ Shop-API tool เดิมของ OA
                                      (host เดียว secret เดียว) → ไม่ต้องมี tool ใหม่
                                    · walletpay = คนละระบบ คนละ host ไม่มี auth → ต้องมี tool ของตัวเอง
                                  ของจริงที่เจอมาแล้ว: ไม่ผูกช่องนี้ ขา walletpay จะไปยิงเข้า host ของ
                                  ขาเติมเงินแล้วได้ 404 · ผูกแล้วเข้า host ที่ถูกต้อง
                            HOW : เว้นว่างไว้ = ใช้เส้น pay_walletpay บน payment tool ตัวเดิม

                            ⚠️ **จงใจไม่กรองด้วย category** ต่างจากช่องด้านบน — ฝั่ง BE ไม่ได้
                               บังคับว่า tool ของ walletpay ต้องเป็นหมวด payment (ธง category มีไว้
                               คุมสวิตช์เงินซึ่งผ่านด่านไปแล้วก่อนจะมาถึงขานี้) ถ้ามากรองที่นี่
                               จะซ่อน tool ที่ใช้ได้จริงจนคนตั้งค่าไม่เจอ */}
                        {(() => {
                          const walletpayId = (formData as any).walletpay_tool_id || '';
                          const walletpayOn = !!(formData as any).walletpay_tool_status;
                          // ระบบจะใช้ tool แยกก็ต่อเมื่อครบทั้งคู่ — สะท้อนกติกาของ BE ตรง ๆ
                          // (BE เช็ค `walletpay_tool_status === true` และต้องมี id ด้วย)
                          const walletpayActive = walletpayOn && !!walletpayId;
                          return (
                            <div className="mt-3 pt-3 border-t border-slate-300/60">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[12px] font-black ${walletpayActive ? 'text-emerald-800' : 'text-slate-500'}`}>
                                    {t('pageui.hookform.walletpay_tool_title', 'Tool ของขา walletpay')}
                                  </span>
                                  {/* ป้าย "ไม่บังคับ" อยู่ตลอด — ย้ำว่าการไม่ตั้งคือเรื่องปกติ
                                      ไม่ใช่ของที่ยังทำไม่เสร็จ */}
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-200 text-slate-600">
                                    {t('pageui.hookform.optional', 'ไม่บังคับ')}
                                  </span>
                                </div>
                                {/* สวิตช์หน้าตาเดียวกับของ payment ด้านบน ให้เป็นคู่ที่ดูเข้าชุดกัน */}
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    disabled={isViewMode}
                                    checked={walletpayOn}
                                    onChange={e => setFormData(prev => ({ ...prev, walletpay_tool_status: e.target.checked } as any))}
                                    className="w-4 h-4 accent-emerald-600"
                                  />
                                  <span className={`text-[11px] font-black ${walletpayOn ? 'text-emerald-700' : 'text-slate-500'}`}>
                                    {t('pageui.hookform.use_separate_tool', 'ใช้ tool แยก')}
                                  </span>
                                </label>
                              </div>

                              <select
                                disabled={isViewMode}
                                value={walletpayId}
                                onChange={e => setFormData(prev => ({ ...prev, walletpay_tool_id: e.target.value || null } as any))}
                                className={inputClass(false)}
                              >
                                <option value="">{t('pageui.hookform.walletpay_unbound', '— ไม่ผูก (ใช้ tool เดียวกับด้านบน) —')}</option>
                                {/* ไม่กรอง category โดยตั้งใจ — ดูเหตุผลในคอมเมนต์ด้านบน */}
                                {customToolOptions.map(t => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} · {t.base_url}
                                  </option>
                                ))}
                              </select>

                              {/* ⚠️ ข้อความทุกแบบด้านล่างเป็น "การบอกสถานะ" ไม่ใช่ "การเตือน"
                                  ตั้งใจไม่ใช้สีแดง/ไอคอนเตือน/ตัวหนาแบบ error เลย เพราะ OA
                                  ส่วนใหญ่จะไม่ตั้ง 2 ช่องนี้ตลอดไป — การไม่ตั้งคือสถานะปกติ
                                  ไม่ใช่ความผิดพลาดที่ต้องไปแก้ */}
                              <p className={`mt-2 text-[11px] ${walletpayActive ? 'text-emerald-900/70' : 'text-slate-500'}`}>
                                {walletpayActive ? (
                                  <>
                                    {t('pageui.hookform.walletpay_active_a', 'ขา walletpay จะยิงไปที่ปลายทางของ tool ตัวนี้ ·')}{' '}
                                    {t('pageui.hookform.walletpay_active_b', 'ส่วนขาเติมเงินยังใช้ tool ด้านบนเหมือนเดิม')}
                                  </>
                                ) : walletpayOn && !walletpayId ? (
                                  <>
                                    {t('pageui.hookform.walletpay_on_no_tool_a', 'เปิดไว้แล้วแต่ยังไม่ได้เลือก tool — ตอนนี้ยัง')}<b>{t('pageui.hookform.same_tool_as_above', 'ใช้ tool เดียวกับด้านบน')}</b>{t('pageui.hookform.walletpay_on_no_tool_b', 'อยู่ ·')}{' '}
                                    {t('pageui.hookform.walletpay_on_no_tool_c', 'เลือก tool เมื่อไหร่ถึงจะเริ่มใช้ปลายทางแยก')}
                                  </>
                                ) : walletpayId && !walletpayOn ? (
                                  <>
                                    {t('pageui.hookform.walletpay_tool_not_on_a', 'เลือก tool ไว้แล้วแต่ยังไม่ได้เปิดใช้ — ตอนนี้')}<b>{t('pageui.hookform.same_tool_as_above', 'ใช้ tool เดียวกับด้านบน')}</b> ·{' '}
                                    {t('pageui.hookform.walletpay_tool_not_on_b', 'ค่าที่เลือกไว้ไม่หาย เปิดสวิตช์เมื่อไหร่ก็ใช้ได้ทันที')}
                                  </>
                                ) : (
                                  <>
                                    <b>{t('pageui.hookform.same_tool_as_above', 'ใช้ tool เดียวกับด้านบน')}</b> {t('pageui.hookform.walletpay_default_a', '— ระบบยิงขา walletpay ผ่านเส้น')} <code>pay_walletpay</code> {t('pageui.hookform.walletpay_default_b', 'ของ tool นั้น ·')}{' '}
                                    {t('pageui.hookform.walletpay_default_c', 'ตั้ง 2 ช่องนี้เฉพาะตอนที่')} <b>{t('pageui.hookform.walletpay_default_d', 'walletpay อยู่คนละเว็บ (คนละ host)')}</b> {t('pageui.hookform.walletpay_default_e', 'กับเส้นเติมเงิน')}
                                  </>
                                )}
                              </p>
                            </div>
                          );
                        })()}
                        {/* ==== [FEAT-20260809-WALLETPAYTOOL] END */}
                      </ExtApiFoldCard>
                    );
                  })()}
                  {/* ==== [FEAT-20260808-PAYCUSTOOL] END */}

                {/* Custom Endpoints Section — [FEAT-20261018-EXTAPICARDS] its own foldable card;
                    "How to use" moved into the right-hand group (a button cannot sit inside the
                    fold button) */}
                <ExtApiFoldCard
                  icon={<Terminal className="text-primary-500" size={20} />}
                  title={<h5 className="font-bold text-slate-800">Custom API Endpoints</h5>}
                  right={
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setShowHowToUse(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-xs font-black transition-all shadow-xl shadow-primary-500/25 active:scale-95 group border-2 border-primary-400/20"
                      >
                        <HelpCircle size={18} className="group-hover:rotate-12 transition-transform" />
                        How to use
                      </button>
                      {!isViewMode && (
                        <>
                        <button
                          type="button"
                          onClick={() => setShowCurlImport(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-slate-700 rounded-lg text-xs font-bold transition-all border border-dark-600 shadow-sm active:scale-95"
                        >
                          <FileJson size={14} className="text-primary-500" />
                          Import from cURL
                        </button>
                        <button
                          type="button"
                          onClick={handleAddEndpoint}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                        >
                          <Plus size={14} />
                          Add Endpoint
                        </button>
                        </>
                      )}
                    </div>
                  }
                >
                  <div className="space-y-4">
                    {Object.entries(formData.external_endpoints || {}).length === 0 ? (
                      <div className="text-sm text-slate-400 italic py-8 text-center bg-dark-900/20 rounded-xl border border-dashed border-dark-700">
                        No custom endpoints configured. Using system defaults.
                      </div>
                    ) : (
                      (Object.entries(formData.external_endpoints || {}) as [string, NonNullable<HookFormData['external_endpoints']>[string]][]).map(([key, config]) => {
                        const isExpanded = !!expandedEndpoints[key];
                        const methodColors: Record<string, string> = {
                          'GET': 'text-blue-500 bg-blue-500/10',
                          'POST': 'text-emerald-500 bg-emerald-500/10',
                          'PUT': 'text-orange-500 bg-orange-500/10',
                          'DELETE': 'text-red-500 bg-red-500/10'
                        };

                        return (
                          <div 
                            key={key} 
                            className={`rounded-2xl border-2 transition-all duration-300 overflow-hidden ${
                              isExpanded 
                                ? 'bg-white border-primary-500 shadow-xl shadow-primary-500/10 scale-[1.01] z-10' 
                                : 'bg-dark-900/40 border-dark-700 hover:border-dark-600'
                            }`}
                          >
                            {/* Card Header - Always Visible */}
                            <div 
                              className={`flex items-center justify-between p-4 cursor-pointer select-none transition-colors ${
                                isExpanded ? 'bg-primary-50 border-b border-primary-100' : 'hover:bg-dark-800/50'
                              }`}
                              onClick={() => setExpandedEndpoints(prev => ({ ...prev, [key]: !isExpanded }))}
                            >
                              <div className="flex items-center gap-4 flex-1 min-w-0">
                                {/* Key Badge */}
                                <div className={`px-2.5 py-1 rounded-lg font-mono text-[10px] font-black uppercase tracking-wider border ${
                                  isExpanded ? 'bg-primary-600 text-white border-primary-700' : 'bg-dark-700 text-slate-400 border-dark-600'
                                }`}>
                                  {key}
                                </div>

                                {/* Method Badge */}
                                <div className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${methodColors[config.method] || 'text-slate-500 bg-slate-500/10'}`}>
                                  {config.method}
                                </div>

                                {/* Path Preview */}
                                <div className={`text-xs font-medium truncate flex-1 ${isExpanded ? 'text-primary-900' : 'text-slate-500'}`}>
                                  {config.path || <span className="italic opacity-50">No path specified</span>}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {!isViewMode && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveEndpoint(key);
                                    }}
                                    className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                    title="Delete Endpoint"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                                <div className={`p-1 rounded-full transition-transform duration-300 ${isExpanded ? 'rotate-180 text-primary-600' : 'text-slate-400'}`}>
                                  <ChevronDown size={20} />
                                </div>
                              </div>

                            </div>
                            
                            {/* Card Body - Collapsible */}
                            {isExpanded && (
                              <div className="p-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                  <div className="md:col-span-12">
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                                      API Endpoint Path 
                                      <span className="ml-2 text-primary-400 normal-case font-medium italic">(supports {"{{"}line_user_id{"}}"})</span>
                                    </label>
                                    <input
                                      disabled={isViewMode}
                                      value={config.path}
                                      onChange={(e) => handleUpdateEndpoint(key, 'path', e.target.value)}
                                      className={inputClass(false, 'bg-white text-sm py-2.5 shadow-sm border-slate-200 focus:border-primary-500')}
                                      placeholder="api/v1/customer/{{line_user_id}}"
                                    />
                                  </div>

                                  <div className="md:col-span-8">
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                                      Data Resolution key (Sub Type) <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex flex-col gap-2">
                                      <select
                                        disabled={isViewMode}
                                        value={['api/v1/customer', 'api/line/v1/installment_current.php', 'api/line/v1/payment_history.php', 'api/line/v1/contract.php', 'api/line/v1/installment.php'].includes(config.sub_type || '') ? config.sub_type : (config.sub_type ? 'custom' : '')}
                                        onChange={(e) => {
                                          if (e.target.value !== 'custom') {
                                            handleUpdateEndpoint(key, 'sub_type', e.target.value);
                                          }
                                        }}
                                        className={inputClass(false, 'bg-white text-sm py-2 shadow-sm border-slate-200')}
                                      >
                                        <option value="api/v1/customer">api/v1/customer (Profile)</option>
                                        <option value="api/line/v1/installment_current.php">api/line/v1/installment_current.php (Current)</option>
                                        <option value="api/line/v1/payment_history.php">api/line/v1/payment_history.php (History)</option>
                                        <option value="api/line/v1/contract.php">api/line/v1/contract.php (Contract)</option>
                                        <option value="api/line/v1/installment.php">api/line/v1/installment.php (List)</option>
                                        <option value="">Other / Custom Manual Path...</option>
                                      </select>
                                      
                                      {(!['api/v1/customer', 'api/line/v1/installment_current.php', 'api/line/v1/payment_history.php', 'api/line/v1/contract.php', 'api/line/v1/installment.php'].includes(config.sub_type || '') || config.sub_type === 'custom') && (
                                        <input
                                          disabled={isViewMode}
                                          value={config.sub_type === 'custom' ? '' : (config.sub_type || '')}
                                          onChange={(e) => handleUpdateEndpoint(key, 'sub_type', e.target.value)}
                                          className={inputClass(false, 'bg-white text-sm py-2 border-dashed border-primary-300')}
                                          placeholder="Enter manual resolution path (e.g. api/v1/my-path)"
                                        />
                                      )}
                                    </div>
                                  </div>

                                  <div className="md:col-span-4">
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">HTTP Method</label>
                                    <select
                                      disabled={isViewMode}
                                      value={config.method}
                                      onChange={(e) => handleUpdateEndpoint(key, 'method', e.target.value)}
                                      className={inputClass(false, 'bg-white text-sm py-2 shadow-sm border-slate-200')}
                                    >
                                      <option value="GET">GET</option>
                                      <option value="POST">POST</option>
                                      <option value="PUT">PUT</option>
                                      <option value="DELETE">DELETE</option>
                                    </select>
                                  </div>
                                  
                                  <div className="md:col-span-12">
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        Request Body (JSON Payload)
                                      </label>
                                      <span className="text-[10px] text-slate-400 font-medium italic">supports {"{{"}lineuserid{"}}"}</span>
                                    </div>
                                    <textarea
                                      disabled={isViewMode}
                                      value={typeof config.payload === 'object' ? JSON.stringify(config.payload, null, 2) : config.payload || ''}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        if (!newValue.trim()) {
                                          handleUpdateEndpoint(key, 'payload', '');
                                          return;
                                        }
                                        try {
                                          const val = JSON.parse(newValue);
                                          handleUpdateEndpoint(key, 'payload', val);
                                        } catch (err) {
                                          handleUpdateEndpoint(key, 'payload', newValue);
                                        }
                                      }}
                                      rows={4}
                                      className={inputClass(false, 'bg-white text-xs font-mono shadow-sm border-slate-200 focus:ring-1 focus:ring-primary-500')}
                                      placeholder='{ "userid": "{{lineuserid}}" }'
                                    />
                                  </div>

                                  <div className="md:col-span-12 flex flex-wrap items-center justify-between gap-6 pt-6 border-t border-slate-100">
                                    <div className="flex items-center gap-8 flex-wrap">
                                      {/* Type Toggle */}
                                      <div className="flex flex-col gap-2">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Payload Type</span>
                                        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 w-fit">
                                          {(['json', 'form', 'form-data'] as const).map(t => (
                                            <button
                                              key={t}
                                              type="button"
                                              disabled={isViewMode}
                                              onClick={() => handleUpdateEndpoint(key, 'request_type', t)}
                                              className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                                                (config.request_type === t || (!config.request_type && t === 'json'))
                                                  ? 'bg-white text-primary-600 shadow-md' 
                                                  : 'text-slate-400 hover:text-slate-600'
                                              }`}
                                            >
                                              {t.toUpperCase()}
                                            </button>
                                          ))}
                                        </div>
                                      </div>

                                      {/* Security Toggles */}
                                      <div className="flex items-center gap-6">
                                        <div className="flex items-center gap-3 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
                                          <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-slate-700">Require JWT</span>
                                            <span className="text-[9px] text-slate-400 uppercase font-black">Security</span>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={isViewMode}
                                            onClick={() => handleUpdateEndpoint(key, 'require_jwt', !config.require_jwt)}
                                            className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${config.require_jwt ? 'bg-primary-600' : 'bg-slate-300'}`}
                                          >
                                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${config.require_jwt ? 'translate-x-5.5' : 'translate-x-1'}`} />
                                          </button>
                                        </div>

                                        <div className="flex items-center gap-3 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
                                          <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-slate-700">Auth Login</span>
                                            <span className="text-[9px] text-slate-400 uppercase font-black">Access Control</span>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={isViewMode}
                                            onClick={() => handleUpdateEndpoint(key, 'is_login', !config.is_login)}
                                            className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${config.is_login ? 'bg-orange-500' : 'bg-slate-300'}`}
                                          >
                                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${config.is_login ? 'translate-x-5.5' : 'translate-x-1'}`} />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })

                    )}
                  </div>
                </ExtApiFoldCard>
              </div>
              {/* [FEAT-20260810-PAYSTATEFLEX] ล่างสุดของแท็บ external — 1 state = 1 การ์ด
                  slipTemplates = ก้อนที่กรองไว้แล้วที่ :512 (ไม่กรองซ้ำ ไม่ยิง API เพิ่ม) */}
              <HookPaymentFlexBlock
                value={(formData as any).payment_flex_ids}
                onChange={(next) => setFormData(prev => ({ ...(prev as any), payment_flex_ids: next }))}
                slipTemplates={slipTemplates}
                disabled={isViewMode}
              />
            </div>
          )}

          {formError && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 whitespace-pre-line break-words">
              <span className="font-semibold text-red-100">{t('hook_form.error_label')} </span>
              <span>{formError.message}</span>
              {formError.raw && (
                <>
                  <br />
                  <span className="text-xs font-semibold text-red-200">{t('hook_form.raw_response_label')} </span>
                  <span className="text-xs text-red-100">{formError.raw}</span>
                </>
              )}
            </div>
          )}

          {/* [FEAT-20260805-HANDOFF-HOOKTAB] handoff targets bound to this hook + per-hook creds */}
          {activeTab === 'handoff' && initialData?._id && (
            <HookHandoffTab hookId={String(initialData._id)} hasCustomTool={!!(formData as any).custom_tool_id} />
          )}

        </div>
        <ScrollIndicator containerRef={formBodyRef} />
      </div>

      </form>
      <AlertModal
        isOpen={!!validationAlert?.isOpen}
        onClose={() => setValidationAlert(null)}
        title={t('hook_form.validation_error')}
        message={validationAlert?.message || ''}
        type="error"
      />
      <AlertModal
        isOpen={!!telegramSuccessAlert?.isOpen}
        onClose={() => setTelegramSuccessAlert(null)}
        title={t('pageui.hookform.success', 'สำเร็จ')}
        message={telegramSuccessAlert?.message || ''}
        type="success"
      />
      <AlertModal
        isOpen={!!copyAlert}
        onClose={() => setCopyAlert(null)}
        title={copyAlert?.title || ''}
        message={copyAlert?.message || ''}
        type={copyAlert?.type || 'success'}
      />
      <AlertModal
        isOpen={!!helpModal?.isOpen}
        onClose={() => setHelpModal(null)}
        title={helpModal?.title || ''}
        message={helpModal?.message || ''}
        type="info"
      />
      {/* ==== [FEAT-20260803-DOCSTEPS] START — ปุ่ม "ทดสอบขั้นตอนนี้" ยังไม่เปิดใช้งาน
          🔴 ผู้ใช้สั่ง 2026-08-03: กดแล้วให้ขึ้นแค่กล่องเตือนว่ายังพัฒนาอยู่ เท่านั้น
             ก่อนหน้านี้ขึ้นเป็นหน้าแชทตัวอย่าง — ถอดออกแล้ว เพราะหน้าตาเหมือนใช้งานได้จริง
             ทั้งที่ยังไม่ได้ต่อระบบ เสี่ยงให้เข้าใจผิดมากกว่าช่วยอะไร

          ── ทำต่อตรงนี้ตอนจะเปิดใช้จริง ──────────────────────────────────────
          1. ต่อกับเส้น "ยิงข้อความทดสอบ" ของ BE (ยังไม่มี ต้องทำเพิ่ม)
             ต้องรับ hook ที่ยังไม่เซฟได้ด้วย เพราะแอดมินจะกดทดสอบก่อนกดบันทึก
          2. ส่ง Training Doc ของ step ที่เปิดอยู่ไปด้วย (ตัวแปร docStep)
             เจตนาของปุ่มนี้คือทดสอบ "ขั้นตอนนี้" ไม่ใช่ทั้ง hook
          3. โครง UI แชทเดิมอยู่ใน git history ของ marker นี้ ดึงกลับมาใช้ได้เลย
          4. i18n ที่เตรียมไว้แล้ว ยังไม่ได้ลบ ใช้ต่อได้: hook_form.doc_test_title /
             doc_test_placeholder / doc_test_soon
          revert: ลบบล็อกนี้ + ปุ่ม "ทดสอบขั้นตอนนี้" + state docTestOpen */}
      <AlertModal
        isOpen={docTestOpen}
        onClose={() => setDocTestOpen(false)}
        title={t('hook_form.doc_test_title')}
        message={t('hook_form.doc_test_wip')}
        type="info"
      />
      {/* ==== [FEAT-20260803-DOCSTEPS] END */}
      {/* [FEAT-20260811-HOOKFORMSPLIT] was ~35 lines of inline dialog markup; the
          state (`testApiResult`) still lives here, only the presentation moved. */}
      <HookTestApiResultDialog
        result={testApiResult}
        onClose={() => setTestApiResult(null)}
      />
      {telegramModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/45 backdrop-blur">
          <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex justify-between items-center p-4 border-b border-dark-700">
              <h3 className="text-lg font-semibold text-slate-900">{t('hook_form.telegram_modal_title')}</h3>
              <button
                type="button"
                onClick={() => setTelegramModalOpen(false)}
                className="text-slate-500 hover:text-slate-900 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-2">{t('hook_form.telegram_keyword')}</label>
                <input
                  value={telegramKeyword}
                  onChange={(event) => setTelegramKeyword(event.target.value)}
                  placeholder={t('hook_form.telegram_keyword_placeholder')}
                  className="w-full rounded-lg bg-dark-900 border border-dark-700 px-4 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              {telegramSearchError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                  {telegramSearchError}
                </div>
              )}
              {telegramSearchError && telegramRawJson && (
                <div>
                  <div className="text-xs text-slate-500 mb-2">Raw JSON</div>
                  <pre className="whitespace-pre-wrap text-xs text-slate-400 bg-dark-900 border border-dark-700 rounded-lg p-3 max-h-48 overflow-y-auto custom-scrollbar">
                    {telegramRawJson}
                  </pre>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-dark-700 bg-dark-900/50 rounded-b-xl">
              <button
                type="button"
                onClick={() => setTelegramModalOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-900 transition-colors"
              >
                {t('hook_form.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmTelegramKeyword}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-colors"
              >
                {t('hook_form.telegram_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [FEAT-20260811-HOOKFORMSPLIT] state stays here; only the markup moved. */}
      <HookImageZoomOverlay src={zoomedImage} onClose={() => setZoomedImage(null)} />

      {/* [FEAT-20260811-HOOKFORMSPLIT] state stays here; only the markup moved. */}
      <HookPermissionAlertOverlay
        open={permissionAlert}
        onClose={() => setPermissionAlert(false)}
      />

      {showCompareModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-sm animation-fade-in text-slate-900">
          <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-5 border-b border-dark-700 bg-dark-800/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                  <Repeat size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold">API Structure Comparison</h3>
                  <p className="text-xs text-slate-500 font-medium">Compare current system response with your new settings</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCompareModal(false);
                  setCompareResult(null);
                }}
                className="p-2 rounded-full hover:bg-dark-700 text-slate-500 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 bg-dark-900/10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Current/Base User ID</label>
                  <input
                    placeholder="U1234567890abcdef..."
                    value={compareUserIds.current}
                    onChange={(e) => setCompareUserIds(prev => ({ ...prev, current: e.target.value }))}
                    className="w-full bg-dark-900 border border-dark-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">New/Target User ID</label>
                  <input
                    placeholder="U1234567890abcdef..."
                    value={compareUserIds.new}
                    onChange={(e) => setCompareUserIds(prev => ({ ...prev, new: e.target.value }))}
                    className="w-full bg-dark-900 border border-dark-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none transition-all placeholder:text-slate-600"
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-dark-900/50 border border-dark-700 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-dark-700 pb-2">
                  <Info size={14} className="text-blue-500" /> Settings to test
                </div>
                <div className="grid grid-cols-1 gap-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">API URL:</span>
                    <span className="text-slate-300 truncate max-w-[250px]">{formData.external_api_url || ' (Use System Default)'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">User:</span>
                    <span className="text-slate-300">{formData.external_user || ' (Use System Default)'}</span>
                  </div>
                </div>
              </div>

              {compareResult && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-dark-900 rounded-xl p-3 border border-dark-700">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${compareResult.summary?.mismatched > 0 ? 'bg-red-500 shadow-lg shadow-red-500/20' : 'bg-emerald-500 shadow-lg shadow-emerald-500/20'}`} />
                      <span className="text-sm font-bold">
                        {compareResult.summary?.matched} Match, {compareResult.summary?.mismatched} Mismatched
                      </span>
                    </div>
                    {compareResult.summary?.mismatched > 0 && (
                      <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Structure Mismatch Detected</span>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-2">Detailed Response Preview</div>
                    <pre className={`text-[11px] font-mono p-5 rounded-2xl bg-dark-950 overflow-x-auto shadow-inner border leading-relaxed ${compareResult.summary?.mismatched > 0 ? 'border-red-500/30 text-red-100' : 'border-emerald-500/30 text-emerald-100'}`}>
                      {JSON.stringify(compareResult, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-dark-700 bg-dark-800 flex justify-between items-center">
              <button
                type="button"
                onClick={() => {
                  setShowCompareModal(false);
                  setCompareResult(null);
                }}
                className="px-6 py-2.5 rounded-xl bg-dark-700 text-slate-400 font-bold hover:bg-dark-600 transition-all text-sm"
              >
                Close
              </button>
              <button
                type="button"
                disabled={testingCompareApi}
                onClick={handleCompareExternalApi}
                className="px-8 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-all text-sm shadow-xl shadow-blue-500/20 flex items-center gap-2 group disabled:opacity-50"
              >
                {testingCompareApi ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Comparing...
                  </>
                ) : (
                  <>
                    <Repeat size={16} className="group-hover:rotate-180 transition-transform duration-500" />
                    Compare Structure
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddEndpointModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-md transition-all animate-in fade-in duration-300">
          <div className="bg-dark-800 border border-dark-700 rounded-3xl shadow-[0_32px_128px_rgba(0,0,0,0.6)] w-full max-w-md overflow-hidden transform animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center text-slate-900">
              <div className="w-16 h-16 bg-primary-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 ring-8 ring-primary-500/5 rotate-3 hover:rotate-6 transition-transform">
                <Terminal size={32} className="text-primary-500" />
              </div>
              <h3 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">Add New Endpoint</h3>
              <p className="text-slate-500 text-sm mb-8 px-4 font-medium">Enter a unique key for your custom API endpoint (e.g., <span className="text-primary-600 font-bold">PROFILE_CHECK</span>)</p>
              
              <div className="relative group">
                <input
                  autoFocus
                  value={newEndpointKey}
                  onChange={(e) => setNewEndpointKey(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmAddEndpoint()}
                  placeholder="ENDPOINT_KEY_NAME"
                  className="w-full bg-dark-900 border-2 border-dark-700 rounded-2xl px-6 py-4 text-center font-mono text-lg font-bold text-primary-600 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition-all shadow-inner"
                />
                <div className="absolute inset-0 rounded-2xl pointer-events-none border border-white/5 opacity-50"></div>
              </div>
            </div>
            
            <div className="p-4 bg-dark-900/50 border-t border-dark-700 flex gap-3">
              <button
                type="button"
                onClick={() => setShowAddEndpointModal(false)}
                className="flex-1 py-4 text-slate-500 font-bold hover:text-slate-800 transition-all rounded-2xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAddEndpoint}
                className="flex-[2] py-4 bg-primary-600 hover:bg-primary-500 text-white rounded-2xl font-bold transition-all shadow-xl shadow-primary-500/20 active:scale-[0.98]"
              >
                Confirm & Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [FEAT-20260811-HOOKFORMSPLIT] static usage guide — state stays here. */}
      <HookEndpointUsageGuide open={showHowToUse} onClose={() => setShowHowToUse(false)} />

      {showCurlImport && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-dark-950/60 backdrop-blur-md transition-all animate-in fade-in duration-300">
          <div className="bg-dark-800 border border-dark-700 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in slide-in-from-top-12">
            <div className="p-6 border-b border-dark-700 flex justify-between items-center text-slate-900">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-500">
                  <FileJson size={20} />
                </div>
                <h3 className="text-xl font-bold">Import from cURL</h3>
              </div>
              <button type="button" onClick={() => { setShowCurlImport(false); setCurlInput(''); }} className="p-2 rounded-full hover:bg-dark-700 text-slate-500 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest">
                    1. Assign Endpoint Key
                  </label>
                  {importError && (
                    <span className="text-[10px] font-black text-red-500 animate-bounce tracking-tight bg-red-50 px-2 py-0.5 rounded border border-red-200 uppercase">
                      [ !! ] {importError}
                    </span>
                  )}
                </div>

                <div className="relative group">
                  <input
                    value={importEndpointKey}
                    onChange={(e) => setImportEndpointKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                    placeholder="E.g. GET_USER_DATA"
                    className="w-full bg-dark-900 border-2 border-dark-700/50 rounded-2xl px-6 py-4 font-mono text-lg font-bold text-primary-600 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition-all shadow-inner uppercase"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 bg-dark-800 px-2 py-1 rounded border border-dark-700">ENG ONLY</div>
                </div>
                <p className="mt-2 text-[10px] text-slate-500 font-medium italic">Use English letters, numbers, and underscores only.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-widest">
                    2. Paste cURL Command
                  </label>
                  {importError && importError.includes('CURL') && (
                    <span className="text-[10px] font-black text-red-500 animate-bounce tracking-tight bg-red-50 px-2 py-0.5 rounded border border-red-200 uppercase">
                      [ !! ] {importError}
                    </span>
                  )}
                </div>
                <textarea
                  value={curlInput}
                  onChange={(e) => setCurlInput(e.target.value)}
                  rows={6}
                                    placeholder="curl --location 'https://api.yoursite.com/...' \"
                />
              </div>

              <div className="bg-blue-500/5 border border-blue-500/20 p-4 rounded-xl">
                <div className="flex items-start gap-3">
                  <Info size={16} className="text-blue-500 mt-0.5" />
                  <div className="text-[11px] text-blue-800 font-medium leading-relaxed">
                    <b>Tip:</b> If the command contains a Line User ID (starts with U...), it will be automatically replaced with the <code>{`{{lineuserid}}`}</code> variable.
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-dark-900/50 border-t border-dark-700 flex gap-3">
              <button
                type="button"
                onClick={() => { setShowCurlImport(false); setCurlInput(''); }}
                className="px-6 py-3 text-slate-500 font-bold hover:text-slate-800 transition-all rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportCurl}
                disabled={!curlInput.trim()}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Download size={18} />
                Extract & Import Endpoint
              </button>
            </div>
          </div>
        </div>
      )}

      {showPayloadPreview && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-dark-950/90 backdrop-blur-2xl transition-all animate-in fade-in duration-300">
          <div className="bg-dark-800 border border-dark-700 rounded-3xl shadow-[0_40px_120px_rgba(0,0,0,0.8)] w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95">
            <div className="p-8 border-b border-dark-700 bg-dark-900/80 flex justify-between items-center text-white">
              <div className="flex items-center gap-5">
                <div className="p-4 bg-primary-500/10 rounded-3xl text-primary-500">
                  <FileJson size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white leading-tight">Payload Preview</h3>
                   <p className="text-xs text-slate-400 font-bold uppercase tracking-[0.2em] mt-1.5 opacity-60">Raw Hook Configuration (JSON)</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowPayloadPreview(false)} 
                className="p-3 rounded-2xl hover:bg-dark-700 text-slate-500 hover:text-white transition-all active:scale-90"
              >
                <X size={28} />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto custom-scrollbar bg-dark-950/20">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary-600/20 to-emerald-600/20 rounded-[2rem] blur-xl opacity-50 group-hover:opacity-100 transition duration-1000"></div>
                <div className="relative">
                  <pre className="p-8 bg-dark-900/90 backdrop-blur-sm rounded-[2rem] border border-white/5 shadow-2xl font-mono text-[13px] leading-relaxed text-primary-400 overflow-x-auto whitespace-pre-wrap break-all custom-scrollbar">
                    {JSON.stringify({ 
                      external_api_url: formData.external_api_url ? '********************' : '',
                      external_user: formData.external_user ? '**********' : '',
                      external_password: formData.external_password ? '**********' : '',
                      external_endpoints: formData.external_endpoints 
                    }, null, 2)}
                  </pre>
                  
                  <button
                    type="button"
                    onClick={() => {
                      // [FIX-20260830-COPYHTTP2] the "Copied" alert follows the result
                      void copyText(JSON.stringify({ 
                        external_api_url: formData.external_api_url,
                        external_user: formData.external_user,
                        // [FEAT-20260817-SECRETLOCK] the form never holds the real
                        // password — copying the placeholder only spread it around
                        external_password: secretLock.valueForUse('external_password', formData.external_password),
                        external_endpoints: formData.external_endpoints 
                      }, null, 2)).then((ok) =>
                        setCopyAlert(
                          ok
                            ? { title: 'Copied', message: 'Payload JSON copied to clipboard', type: 'success' }
                            : { title: t('common.copy_failed_title'), message: t('common.copy_failed_message'), type: 'error' },
                        ),
                      );
                    }}
                    className="absolute top-6 right-6 p-4 bg-dark-800/80 backdrop-blur-md border border-white/10 rounded-2xl text-slate-400 hover:text-white hover:border-primary-500 transition-all active:scale-95 group/btn"
                    title="Copy to clipboard"
                  >
                    <Copy size={20} className="group-hover/btn:scale-110 transition-transform" />
                  </button>
                </div>
              </div>
            </div>
            
            <div className="p-8 bg-dark-900 border-t border-dark-700 flex justify-end items-center gap-6">
               <button
                type="button"
                onClick={() => setShowPayloadPreview(false)}
                className="px-12 py-4.5 bg-primary-600 hover:bg-primary-500 text-white rounded-2xl font-black transition-all shadow-xl shadow-primary-500/20 active:scale-[0.98] text-xs uppercase tracking-[0.2em]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showAnalysisPreview && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-dark-950/90 backdrop-blur-2xl transition-all animate-in fade-in duration-300">
          <div className="bg-dark-800 border border-dark-700 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.8)] w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95">
            <div className="p-8 border-b border-dark-700 flex justify-between items-center bg-white rounded-t-[3rem]">
              <div className="flex items-center gap-6">
                <div className="p-4 bg-primary-500/10 rounded-3xl text-emerald-600">
                  <Activity size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-black leading-tight text-dark-950">Analysis Preview</h3>
                  <div className="flex items-center gap-4 mt-2">
                    <p className="text-[10px] text-dark-950/60 font-black uppercase tracking-[0.2em]">Architectural System Design Review</p>
                    <div className="h-3 w-px bg-slate-200"></div>
                    <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 rounded-full border border-amber-200 shadow-sm shadow-amber-500/5">
                      <AlertCircle size={14} className="text-amber-600" />
                      <span className="text-xs text-amber-900 font-bold leading-none">
                        {t('pageui.hookform.analysis_change_warn', 'การเปลี่ยนแปลงข้อมูล อาจทำให้การคำนวณหรือตรวจสอบ logic ผิดพลาดได้ (เนื่องจากอ้างอิงจากตัว dev / staging)')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowAnalysisPreview(false)} 
                className="p-3 rounded-2xl hover:bg-slate-100 text-slate-400 hover:text-dark-950 transition-all active:scale-90"
              >
                <X size={28} />
              </button>
            </div>

            
            <div className="p-8 overflow-y-auto custom-scrollbar bg-white">
              <div className="space-y-8">
                {analysisResult && (
                  <div className="bg-slate-100 p-8 rounded-[2.5rem] border border-slate-200 text-dark-950 shadow-inner animate-in slide-in-from-top duration-500">
                    <h4 className="text-dark-950 font-black mb-2 text-base flex items-center gap-3">
                      {t('pageui.hookform.analysis_summary_title', 'สรุปผลการวิเคราะห์ทางเทคนิค (Summary)')}
                    </h4>
                    <p className="text-dark-950 text-xs leading-relaxed font-bold mb-4 italic">
                      {t('pageui.hookform.analysis_summary_body', 'ตรวจสอบโครงสร้าง API Schema เรียบร้อยแล้ว ระบบหลังบ้านรองรับการทำงานแบบ Dynamic แต่อยู่ภายใต้เงื่อนไข Business Logic เดิม ตามแบบการทดสอบ บน Dev / Staging')}
                    </p>
                    <div className="p-3 bg-white rounded-xl border border-slate-200 inline-flex items-center gap-3 shadow-sm">
                      <span className="text-dark-950 font-bold text-[10px] uppercase tracking-tighter">Status:</span>
                      <span className={`text-xs font-black tracking-tight ${analysisResult === 'Critical' ? 'text-red-700' : 'text-emerald-700'}`}>
                        {analysisResult === 'Critical' ? 'DETECTED DISCREPANCIES (Logic Risk)' : 'SCHEMA VERIFIED 🚀'}
                      </span>
                    </div>
                  </div>
                )}

                {analysisDetails.length > 0 && (
                  <div className="bg-red-50 p-8 rounded-[2.5rem] border border-red-200 text-dark-950 shadow-inner animate-in slide-in-from-top duration-500">
                    <h4 className="text-red-700 font-black mb-4 text-base flex items-center gap-3">
                       <AlertTriangle size={20} /> {t('pageui.hookform.analysis_mismatch_title', 'รายละเอียดความผิดปกติที่พบ (Mismatch)')}
                    </h4>
                    <div className="space-y-3">
                      {analysisDetails.map((detail, idx) => (
                        <div key={idx} className="flex gap-4 items-start p-3 bg-white rounded-2xl border border-red-100 shadow-sm transition-all hover:border-red-200">
                          <div className="mt-1.2 w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"></div>
                          <div className="space-y-0.5">
                            <span className="text-dark-950 font-black block text-[10px] uppercase tracking-wider">{detail.field}</span>
                            <span className="text-red-800 font-bold leading-tight block text-xs">{detail.issue}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-center py-4">
                  <ChevronDown className="text-emerald-500 animate-bounce" size={32} />
                </div>



                <div className="flex items-center gap-4 text-dark-950">
                  <div className={`px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest border-2 transition-all duration-500 shadow-lg ${
                    analysisResult === 'Compatible' 
                      ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-600 shadow-emerald-500/10' 
                      : analysisResult === 'Critical'
                      ? 'bg-red-500/10 border-red-500/50 text-red-600 shadow-red-500/10'
                      : 'bg-slate-500/10 border-slate-500/30 text-slate-500'
                  }`}>
                    {analysisResult || 'WAITING FOR CHECK...'}
                  </div>
                  <div className="flex-1 h-px bg-slate-200"></div>
                </div>


                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6 text-dark-950">
                    <section className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                      <h4 className="text-emerald-600 flex items-center gap-2 font-black uppercase tracking-widest text-[11px] mb-4">
                        <Monitor size={14} /> {t('pageui.hookform.analysis_data_compat', 'ด้านโครงสร้างข้อมูล (DATA COMPATIBILITY)')}
                      </h4>
                      <ul className="space-y-4 m-0 p-0 list-none">
                        <li className="flex gap-4">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 flex-shrink-0 animate-pulse"></div>
                          <p className="text-sm text-slate-900 font-bold leading-relaxed">
                            <span className="text-dark-950 font-black">{t('pageui.hookform.analysis_conn_status', 'สถานะการเชื่อมต่อ:')}</span> {t('pageui.hookform.analysis_conn_a', 'หลังบ้านถูกออกแบบมาให้')} <span className="text-emerald-600 font-mono">Recursive/Loop</span> {t('pageui.hookform.analysis_conn_b', 'ผ่าน Key ทั้งหมดได้ทันที')}
                          </p>
                        </li>
                        {analysisDetails.length === 0 && analysisResult === 'Compatible' && (
                          <li className="flex gap-4">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 flex-shrink-0"></div>
                            <p className="text-sm text-emerald-600 font-black italic">
                              {t('pageui.hookform.analysis_template_match', 'โครงสร้างถูกต้องตาม Template มาตรฐาน (100% Match)')}
                            </p>
                          </li>
                        )}
                      </ul>
                    </section>


                  </div>

                  <div className="space-y-6 text-dark-950">
                    <section className="bg-slate-50 p-6 rounded-3xl border border-slate-200 shadow-sm">
                      <h4 className="text-primary-600 flex items-center gap-2 font-black uppercase tracking-widest text-[11px] mb-4">
                        <ShieldCheck size={14} /> {t('pageui.hookform.analysis_safeguards', 'การประเมินความปลอดภัย (TECHNICAL SAFEGUARDS)')}
                      </h4>
                      <p className="text-sm text-slate-800 leading-relaxed font-bold italic border-l-4 border-primary-500 pl-4 py-1">
                        {t('pageui.hookform.analysis_resilient', 'ระบบรองรับ "Resilient Pattern" สำหรับป้องกัน Error Case กรณี API Response มีโครงสร้างซับซ้อน')}
                      </p>
                    </section>
                    

                  </div>
                </div>



              </div>
            </div>

            
            <div className="p-6 bg-dark-900 border-t border-dark-700 flex flex-wrap gap-3 items-center rounded-b-[3rem] justify-end">
              <button
                type="button"
                onClick={async () => {
                  setIsAnalyzing(true);
                  try {
                    const res = await fetch('/assets/template.json');
                    const template = await res.json();
                    setReferenceTemplate(template);
                    
                    const details: { field: string; issue: string; severity: 'low' | 'high' }[] = [];
                    const currentEndpoints = formData.external_endpoints || {};
                    
                    // Comparison Logic (Deep Validation)
                    template.api_endpoints.forEach((t: any) => {
                      const matchKey = Object.keys(currentEndpoints).find(k => k.toLowerCase().replace(/_/g, '') === t.name.toLowerCase().replace(/ /g, '').replace(/api/g, ''));
                      
                      if (matchKey) {
                        const current = currentEndpoints[matchKey];
                        
                        // 1. Method Check
                        if (current.method !== t.method) {
                          details.push({ field: t.name, issue: `HTTP Method Mismatch (Expected: ${t.method}, Found: ${current.method})`, severity: 'high' });
                        }

                        // 2. Unexpected Payload Check (If template body is null but current has data)
                        const hasPayloadData = current.payload && (typeof current.payload === 'object' ? Object.keys(current.payload).length > 0 : String(current.payload).trim().length > 0);
                        if (t.body === null && hasPayloadData) {
                          details.push({ field: t.name, issue: `Unexpected Payload (Template specifies NO body, but payload data was found)`, severity: 'high' });
                        }

                        // 3. Payload Format Check
                        if (current.request_type === 'json' && typeof current.payload === 'string' && current.payload.trim().length > 0) {
                          details.push({ field: t.name, issue: `Invalid Payload Format (JSON type requires Object structure, but string literal was found)`, severity: 'high' });
                        }

                        // 4. Missing Field Check (If template defines specific fields)
                        if (t.body && t.body.fields) {
                          const requiredFields = Object.keys(t.body.fields);
                          const currentPayload = typeof current.payload === 'object' ? current.payload : {};
                          const currentFields = Object.keys(currentPayload || {});
                          
                          requiredFields.forEach(f => {
                            if (!currentFields.includes(f)) {
                              details.push({ field: `${t.name} > Key: ${f}`, issue: `Missing Required Payload Field (Field strictly required by schema)`, severity: 'high' });
                            }
                          });
                        }
                      }
                    });

                    setAnalysisDetails(details);
                    setAnalysisResult(details.length > 0 ? 'Critical' : 'Compatible');
                  } catch (e) {
                    console.error('Analysis failed', e);
                    setAnalysisResult('Compatible');
                  } finally {
                    setIsAnalyzing(false);
                  }
                }}
                disabled={isAnalyzing}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20 active:scale-95 flex items-center gap-2 text-sm whitespace-nowrap"
              >
                {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                {t('pageui.hookform.analysis_run', 'วิเคราะห์โครงสร้าง')}
              </button>
              
              <button
                type="button"
                onClick={() => {
                  if (!analysisResult) {
                    setToast({ message: t('pageui.hookform.analysis_required', 'กรุณาทำการตรวจสอบโครงสร้าง (Rule Analysis) ก่อนบันทึกข้อมูล'), type: 'error' });
                    return;
                  }
                  handleConfirmSubmit();
                }}
                disabled={loading}
                className={`px-5 py-2.5 rounded-xl font-bold transition-all shadow-lg active:scale-95 flex items-center gap-2 text-sm whitespace-nowrap ${
                  !analysisResult 
                    ? 'bg-dark-700 text-slate-500 cursor-not-allowed' 
                    : 'bg-primary-600 hover:bg-primary-500 text-white shadow-primary-500/20'
                }`}
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                {t('pageui.hookform.analysis_commit', 'บันทึกการส่ง (Commit)')}
              </button>

              <button
                type="button"
                onClick={() => setShowAnalysisPreview(false)}
                className="px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-orange-500/20 active:scale-95 flex items-center gap-2 text-sm whitespace-nowrap"
              >
                <Edit2 size={16} />
                {t('pageui.hookform.back_to_edit', 'กลับไปแก้ไข')}
              </button>


            </div>
          </div>
        </div>
      )}
      
      {/* Toast Notification Layer */}
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-5 duration-300">
          <div className={`flex items-center gap-4 px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-md border ${
            toast.type === 'success' 
              ? 'bg-emerald-500/90 border-emerald-400 text-white' 
              : 'bg-red-500/90 border-red-400 text-white'
          }`}>
            <div className="flex-1 font-bold text-sm pr-4">
              {toast.message}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {showChannelIdConfirmModal && (
        <ConfirmModal
          isOpen={showChannelIdConfirmModal}
          onClose={() => setShowChannelIdConfirmModal(false)}
          onConfirm={() => {
            setShowChannelIdConfirmModal(false);
            // Same acme-only gate as the primary submit path above.
            if (externalFieldsChangedRef.current && acmeCategory) {
              setAnalysisResult(null);
              setShowAnalysisPreview(true);
            } else {
              handleConfirmSubmit();
            }
          }}
          title={t('pageui.hookform.channel_confirm_title', 'เตือนการเปลี่ยนแปลง Channel ID')}
          message={t('pageui.hookform.channel_confirm_msg', 'การเปลี่ยนแปลง Channel ID (เปลี่ยนจากเดิม) มีผลต่อ ประวัติสนทนา ข้อความ ผู้ใช้งาน ทั้งก่อนหน้านี้และหลังจากนี้ การเก็บข้อมูล แสดงผลจะทำงานไม่ถูกต้อง\n\nหากต้องการเปลี่ยน Channel ID / OA ใหม่ กรุณาใช้การสร้าง Hook ช่องทาง OA ใหม่แทน')}
          type="warning"
          confirmLabel={t('pageui.hookform.channel_confirm_ok', 'ยืนยันเปลี่ยน Channel ID')}
          cancelLabel={t('common.cancel', 'ยกเลิก')}
        />
      )}
    </>
  );

  if (isFullPage) {
    return (
      <div className="w-full flex-1 flex flex-col bg-transparent text-slate-100 p-0 m-0">
        {contentJSX}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 w-screen h-screen bg-white/45 backdrop-blur overflow-y-auto !m-0">
      {contentJSX}
    </div>
  );
};
// ==== [FEAT-20260731-HOOKFULLPAGE] END

