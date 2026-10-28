/**
 * ==== [FEAT-20260729-CUSTOOL] START (branch: to_dev_auto เท่านั้น) ====
 *
 * หน้า Custom Tools — จัดการ "เครื่องมือ" ต่อ 3rd-party API
 * ใช้กับเส้นทาง acme_category = false
 *
 * ┌─── กฎเดียวที่ต้องจำ: 1 tool = 1 auth context ─────────────────────────┐
 * │  ปลายทางเดียวกัน + creds เดียวกัน → เส้นเดียวกัน ใส่เป็น endpoint เพิ่ม  │
 * │  คนละปลายทาง หรือ คนละ creds     → คนละ tool                        │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * ความสัมพันธ์กับ OA เก็บ "ทางเดียว" ที่ hook.custom_tool_id เท่านั้น
 * หน้านี้เลือก multi OA ได้ แต่ตอนเซฟ BE ไปเขียนที่ hook ให้ (ไม่มีสำเนา oa_ids)
 * → ไม่มีทางที่ 2 ที่จะขัดกันเอง ไม่ต้องมี resync
 *
 * สิทธิ์: ต้องมี custom_tools.manage (เมนู + API ใช้ตัวเดียวกัน)
 * ไม่มีสิทธิ์ = App.tsx เด้งออกก่อนถึงหน้านี้
 *
 * revert: ลบไฟล์นี้ + services/customToolService.ts + route ใน App.tsx
 * ==== [FEAT-20260729-CUSTOOL] ====
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, RefreshCw, Search, Trash2, Edit2, Loader2, X, Wrench, Link2,
  PlayCircle, CheckCircle2, XCircle, ChevronDown, Users, ClipboardPaste
} from 'lucide-react';

import {
  customToolService, CustomToolEntry, CustomToolEndpoint,
  // [FEAT-20260808-PAYCUSTOOL] สัญญาของหมวด payment + ค่าเริ่มต้นฝั่ง BE
  CustomToolPaymentConfig, PAYMENT_DEFAULTS,
} from '../../services/hook';
import { webhookService } from '../../services/hook';
// ตัวเลือก OA ต้องตามสิทธิ์ของ login เสมอ (เหมือนหน้า Dynamic Tags)
import { fetchVisibleGroups, filterVisibleHooks } from '../../services/admin';
// [FEAT-20260729-CUSTOOL] แกะ cURL → กรอกฟอร์มอัตโนมัติ (เหมือนวางใน Postman)
import { parseCurl, templatizePath } from '../../services/hook';
/* [FEAT-20260903-TOPUPPERPROVIDER] the provider list comes from the SERVER —
   there is no vendor list in this repository. revert: drop this import and the
   select it feeds. */
import { useFieldOptions } from '../../services/hook';
import { useCustomToolsPageQuery } from '../../services/hook/queries';
import { fieldOptionLabel } from '../../components/hook/form/fieldOptionLabel';
/* This page is otherwise hard-coded Thai, so it does not pull in i18n. The
   options carry an i18n KEY, and `fieldOptionLabel` needs a translator to turn
   it into words — so the page takes one here rather than rendering a raw key. */
import { useI18n } from '../../i18n';
import { ConfirmModal } from '../../components/modals';
import { SearchableSelect } from '../../components/common';
import { AlertModal } from '../../components/modals';
import { copyText } from '../../utils/copyText';
// [FEAT-20261016-TOOLMINT] mint bar + [FEAT-20261016-TAGBIND] ผูก tag — render nothing on shop-api
import { ToolMintBar, BindTagsButton, type ToolMintPreset } from '../../components/hook/custom-tools';

/**
 * [FEAT-20260729-CUSTOOL] ค่าเริ่มต้นของ profile_map — อิงโครงสร้างที่ demo-api ของเราคืน
 * กดปุ่ม "( ใช้ค่าเริ่มต้น )" แล้วค่าพวกนี้จะถูกเติมลงช่องจริง ให้เห็นแล้วแก้ต่อได้
 * (ปลายทางเจ้าอื่นโครงสร้างไม่เหมือนกัน → กดแล้วแก้ให้ตรงของจริงได้เลย)
 */
const DEFAULT_PROFILE_MAP = {
  name: 'data.profile.bank.account_name',
  phone: 'data.profile.phone',
  code: 'data.profile.member_id',
};

const EMPTY_ENDPOINT: CustomToolEndpoint = {
  key: '', label: '', purpose: 'data', method: 'GET', path: '',
  require_jwt: true, is_login: false, is_refresh: false, is_profile: false,
  request_type: 'json', payload: {},
  token_path: 'data.access_token', refresh_token_path: 'data.refresh_token',
  profile_map: { name: '', phone: '', code: '' },
  status: true,
  // [FEAT-20260729-EPROLE] (branch to_dev_custom_adapter) ค่าว่าง = ทำงานแบบเดิม
  role: '', result_rules: [], result_map: { member_id: '', phone: '', name: '' },
  // [FEAT-20260730-IDEMPOTENT] ปิดไว้เสมอจนกว่าจะยืนยันว่าปลายทางรองรับ
  idempotency: { enabled: false, location: 'header', field: 'Idempotency-Key', retry_on_timeout: 0 },
};

// ==== [FEAT-20260809-MINTCONST] START — every "mint" value the template buttons use ====
/**
 *
 * WHAT: the hosts, endpoint paths and endpoint literals that the template buttons stamp into
 * a NEW tool. They are SEED values — a starting point the operator edits afterwards — not
 * runtime config. At runtime the backend reads the saved tool row from the database and never
 * looks at anything here. ค่าพวกนี้ใช้ตอน "กดปุ่ม template" เท่านั้น ไม่ใช่ค่าที่ระบบใช้จริงตอนทำงาน
 *
 * WHY one place: a host or a path used to be repeated across several template functions, so
 * changing one meant hunting literals and the ones you missed drifted silently. One definition
 * means one edit, and the templates cannot disagree with each other.
 *
 * ⚠️⚠️ WHAT MUST NEVER GO HERE — credentials of any kind ⚠️⚠️
 * `api_key`, the HMAC secret, `web_code`, access tokens, anything credential-shaped.
 * This file is compiled into the JavaScript bundle that every browser downloads, so ANY value
 * placed here is PUBLIC — readable by anyone who opens devtools. The operator pastes the secret
 * into the form and the backend encrypts it; a secret must never be a default.
 * ห้ามใส่ key/secret ที่นี่เด็ดขาด — ค่าพวกนี้ติดไปกับ bundle ที่ browser โหลด = สาธารณะ
 * (`test/paymentToolReachable.ui.test.ts` guards this: it fails on a 32-hex literal or a
 * non-empty api_key anywhere in this block.)
 *
 * HOW TO CHANGE:
 *  · a HOST moved            → MINT_HOSTS
 *  · a PATH changed          → MINT_PATHS
 *  · the topup/walletpay LEG    → MINT_PAY_TOPUP_ENDPOINT / MINT_PAY_WALLETPAY_ENDPOINT (each is the
 *    single definition shared by its template AND the "+ เส้นเติมเงิน" button, so the two can
 *    never drift apart)
 *  ⚠️ the walletpay FILE FIELD NAME is not here — it is owned by the backend config
 *    (`payment.walletpay_file_field`, default 'slip'). Changing it here alone is not enough.
 */
const MINT_HOSTS = {
  /** internal demo API — only reachable by the hidden demo presets (SHOW_DEMO_PRESETS) */
  demo: 'https://dev-omnidesk-api.example.com/demo-api',
  /** the real Shop-API: profile / link / site-rules / validate-slip all live here */
  shopapi: 'https://api.example.com',
  /** walletpay — a DIFFERENT host, which is exactly why it needs its own tool.
   *  [FIX-20260812-WALLETPAYURL] old host → current host: the tested-working one
   *  (real payin hit answered HTTP 200 on 2026-08-11 — omnidesk-api
   *  todo/task/11082026/be_todo27_11082026.md; runtime DB tool already updated). */
  walletpay: 'https://api.walletpay.example.com',
} as const;

const MINT_PATHS = {
  /** customer profile + link share one path; the query string differs per template */
  shopapiCustomer: 'shop-api/v1/customer',
  shopapiSiteRules: 'shop-api/v1/site-rules',
  /** the topup leg — a sub-endpoint of the SAME Shop-API tool (same host, same HMAC secret) */
  shopapiValidateSlip: 'shop-api/v1/customer/validate-slip',
  /** `{{refId}}` is substituted at runtime with the statement reference being tried.
   *  ⚠️ do not rename that placeholder — the backend fills it by that exact name. */
  walletpayPayinSlip: 'api/v1/public/payin/{{refId}}/slip',
} as const;

/**
 * The topup leg. ONE definition, consumed by `shopapiForm()` and by the "+ เส้นเติมเงิน" button.
 * Every field here is load-bearing:
 *  · `role: 'pay_topup'`      — the BE finds this endpoint by ROLE only, never by KEY, and
 *                               silently coerces an unknown role to '' on save
 *  · `request_type:'form-data'` — it carries the slip IMAGE; json would drop the file part
 *  · `require_jwt: false`     — it authenticates by HMAC (X-Signature), unlike the other lines
 *  · `purpose: 'write'`       — it moves money, so it must not be auto-called on every message
 * A function, not a frozen object: each call must return a FRESH copy, or two endpoints added
 * in one session would share one object and edits to one would mutate the other.
 */
const MINT_PAY_TOPUP_ENDPOINT = (): CustomToolEndpoint => ({
  ...EMPTY_ENDPOINT, key: 'PAY_TOPUP', label: 'ตรวจสลิป/เติมเงิน (Shop-API v1)',
  purpose: 'write' as const, method: 'POST' as const,
  path: MINT_PATHS.shopapiValidateSlip,
  request_type: 'form-data' as const, require_jwt: false,
  role: 'pay_topup' as const,
});

/** The walletpay leg — same reasoning as above, on its own host. */
const MINT_PAY_WALLETPAY_ENDPOINT = (): CustomToolEndpoint => ({
  ...EMPTY_ENDPOINT, key: 'PAY_WALLETPAY', label: 'ส่งสลิปเข้า walletpay (payin)',
  purpose: 'write' as const, method: 'POST' as const,
  path: MINT_PATHS.walletpayPayinSlip,
  request_type: 'form-data' as const, require_jwt: false,
  role: 'pay_walletpay' as const,
});
// ==== [FEAT-20260809-MINTCONST] END

// ==== [FEAT-20260729-EPROLE] START — ตัวเลือก "หน้าที่" ของเส้น
// BE (customToolService.findByRole) หาเส้นด้วย role ก่อน แล้วค่อย fallback ชื่อ KEY
// → tool ใหม่ตั้งชื่อ KEY ตามปลายทางจริงได้อิสระ · tool เก่าไม่ตั้ง role ก็ใช้ได้เหมือนเดิม
// revert: ลบ block นี้ + dropdown role + ตัวแก้กฎอ่านผล ใน endpoint card
const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'หน้าที่: อิงชื่อ KEY (แบบเดิม)' },
  { value: 'login', label: 'login — เข้าสู่ระบบ' },
  { value: 'refresh', label: 'refresh — ต่ออายุ token' },
  { value: 'profile', label: 'profile — ดึงโปรไฟล์ลูกค้า' },
  { value: 'link', label: 'link — ผูกบัญชี (ลูกค้าลงทะเบียน)' },
  { value: 'edit', label: 'edit — แก้ไขการผูก (แอดมิน)' },
  { value: 'unlink', label: 'unlink — ถอนการผูก (แอดมิน)' },
  // [FEAT-20260802-SITERULESROLE] กติกา/ตั้งค่าระดับเว็บ — ไม่ผูกลูกค้า ทุกคนได้ก้อนเดียวกัน
  //   ระบบหาเส้นนี้ด้วย role (ไม่เดาจากชื่อ KEY) → ใช้กับก้อน site rules ที่ส่งเข้า AI + การ์ดใน panel
  { value: 'site_rules', label: 'site_rules — กติกา/ตั้งค่าของเว็บ' },
  /**
   * [FEAT-20260809-PAYROLES] เส้นของหมวด payment — ต้องเลือก role ตรงนี้เท่านั้น
   *
   * WHY: BE หาเส้น 2 ตัวนี้ด้วย **role** อย่างเดียว (`findRole(tool,'pay_topup')`
   * / `'pay_walletpay'`) ไม่ได้เดาจากชื่อ KEY เหมือน role อื่น ๆ. ก่อนหน้านี้
   * dropdown ไม่มี 2 ตัวนี้ให้เลือก → สร้าง payment tool จากหน้าเว็บไม่ได้เลย
   * ต้องไปแก้ DB มือ. ค่า `role` ที่ BE ยอมรับอยู่ใน ENDPOINT_ROLES
   * (custom-tool-normalize.ts) — ถ้าไม่อยู่ในนั้น BE จะ coerce เป็น '' ทิ้งเงียบ ๆ
   * ตอนบันทึก จึงต้องสะกดให้ตรงเป๊ะ.
   *
   * ⚠️ topup อยู่บน Shop-API tool เดิม (host เดียวกับ profile/link) ส่วน walletpay
   * อยู่คนละ host → ปกติ walletpay จะอยู่ใน tool แยกที่ผูกจากหน้า hook
   * (`walletpay_tool_status` + `walletpay_tool_id`) ไม่ได้อยู่ tool เดียวกัน.
   * revert: ลบ 2 บรรทัดนี้ (BE ยังรับ role เดิมได้ปกติ)
   */
  { value: 'pay_topup', label: 'pay_topup — ตรวจสลิป/เติมเงิน (validate-slip)' },
  { value: 'pay_walletpay', label: 'pay_walletpay — ส่งสลิปเข้า walletpay (payin)' },
  { value: 'other', label: 'other — อื่น ๆ' },
];

/** รหัส error กลางของระบบ — โค้ด/UI แตกกิ่งจากชุดนี้เท่านั้น (ตรงกับ BE CANONICAL_LINK_ERRORS) */
const CANONICAL_ERROR_CODES = [
  'LINK_INVALID_CREDENTIALS', 'LINK_ACCOUNT_NOT_FOUND', 'LINK_ALREADY_LINKED',
  'LINK_REJECTED_BY_VENDOR', 'LINK_VENDOR_UNAVAILABLE', 'LINK_TIMEOUT',
  'LINK_CONFIG_ERROR',
];

/** ตัวอย่างกฎอ่านผล — สำหรับปลายทางที่ตอบ HTTP 200 เสมอแล้วบอกผลใน body
 *  (กดแล้วแก้ path/ค่า ให้ตรงปลายทางจริง — เรียงบนลงล่าง ข้อแรกที่ตรงชนะ) */
const EXAMPLE_RESULT_RULES = () => ([
  { path: 'result.status', op: 'eq' as const, value: 'OK', http_codes: '', action: 'success' as const,
    failure_type: '' as const, error_code: '', message_path: '' },
  { path: 'result.errCode', op: 'eq' as const, value: '4001', http_codes: '', action: 'fail' as const,
    failure_type: 'business' as const, error_code: 'LINK_ACCOUNT_NOT_FOUND', message_path: 'result.errMsg' },
  { path: '', op: 'eq' as const, value: '', http_codes: '429,503', action: 'fail' as const,
    failure_type: 'transient' as const, error_code: 'LINK_VENDOR_UNAVAILABLE', message_path: '' },
]);
// ==== [FEAT-20260729-EPROLE] END

/** ชุด endpoint เริ่มต้น กดครั้งเดียวได้ครบเส้นที่ Customer-Link ต้องใช้ */
const PRESET_ENDPOINTS: CustomToolEndpoint[] = [
  { ...EMPTY_ENDPOINT, key: 'LOGIN', label: 'เข้าสู่ระบบ', purpose: 'auth', method: 'POST', path: 'auth/login', require_jwt: false, is_login: true },
  { ...EMPTY_ENDPOINT, key: 'REFRESH', label: 'ต่ออายุ token', purpose: 'auth', method: 'POST', path: 'auth/refresh', require_jwt: false, is_refresh: true },
  { ...EMPTY_ENDPOINT, key: 'CUSTOMER_LOOKUP', label: 'ดึงข้อมูลลูกค้า', purpose: 'data', method: 'GET', path: 'shop-api/v1/customer?line_user_id={{line_user_id}}', is_profile: true },
  { ...EMPTY_ENDPOINT, key: 'CUSTOMER_MATCH', label: 'ลิงก์บัญชี', purpose: 'write', method: 'POST', path: 'shop-api/v1/customer' },
  { ...EMPTY_ENDPOINT, key: 'CUSTOMER_UPDATE', label: 'แก้ไขการลิงก์', purpose: 'write', method: 'PATCH', path: 'shop-api/v1/customer' },
];

/**
 * [FEAT-20260729-CUSTOOL] ชุดค่า demo พร้อมใช้ — กดปุ่มเดียวได้ครบ
 * อิง demo-api v3 ของเราเอง (เส้นที่เทสผ่านแล้ว 46/46 ใน scratch_test_custom_tool.js)
 * ใช้ตอนอยากลองระบบเร็ว ๆ หรือเป็นตัวอย่างว่าต้องกรอกอะไรบ้าง — แก้ต่อได้ทุกช่อง
 *
 * ⚠️ base_url ชี้ dev-omnidesk-api (demo ภายใน) · ของจริงต้องเปลี่ยนเป็นปลายทางจริง
 */
const DEMO_BASE_URL = MINT_HOSTS.demo;   // [FEAT-20260809-MINTCONST]
const demoForm = () => ({
  name: 'Demo Shop-API (v3)',
  description: 'ชุดตัวอย่างจาก demo-api ภายใน — ใช้ลองระบบได้ทันที',
  base_url: DEMO_BASE_URL,
  // [FEAT-20260808-PAYCUSTOOL] ชุดสำเร็จรูปทุกชุดเป็นหมวด generic — ไม่ใช่ tool ตรวจสลิป
  category: 'generic' as 'generic' | 'payment' | 'walletpay',
  payment: emptyPayment(),
  auth_type: 'jwt_login' as 'jwt_login' | 'api_key' | 'basic' | 'none' | 'hmac_signature',
  username: 'demo',
  password: 'demo',
  api_key: '',
  api_key_header: 'Authorization',
  timeout_ms: 8000,
  status: true,
  endpoints: [
    // [FEAT-20260729-EPROLE] ใส่ role ให้ครบเป็นตัวอย่าง — v3 พูดภาษาเดียวกับเรา
    // อยู่แล้ว จึงไม่ต้องมี result_rules/payload template (ดูชุด v4 เทียบได้)
    { ...EMPTY_ENDPOINT, key: 'LOGIN', label: 'เข้าสู่ระบบ', purpose: 'auth' as const,
      method: 'POST' as const, path: 'auth/login', require_jwt: false, is_login: true, role: 'login' as const,
      payload: { username: '{{username}}', password: '{{password}}' } },
    { ...EMPTY_ENDPOINT, key: 'REFRESH', label: 'ต่ออายุ token', purpose: 'auth' as const,
      method: 'POST' as const, path: 'auth/refresh', require_jwt: false, is_refresh: true, role: 'refresh' as const },
    { ...EMPTY_ENDPOINT, key: 'CUSTOMER_LOOKUP', label: 'ดึงข้อมูลลูกค้า', purpose: 'data' as const,
      method: 'GET' as const, path: 'shop-api/v3/customer', require_jwt: true, is_profile: true, role: 'profile' as const,
      profile_map: { ...DEFAULT_PROFILE_MAP } },
    { ...EMPTY_ENDPOINT, key: 'CUSTOMER_MATCH', label: 'ลิงก์บัญชี', purpose: 'write' as const,
      method: 'POST' as const, path: 'shop-api/v3/link', require_jwt: true, role: 'link' as const },
    // ==== [FEAT-20260729-CLINKEDIT] START — เส้นที่ปุ่มแก้ไข/ถอนบนหน้า Ticket ใช้
    // ⚠️ CUSTOMER_UPDATE เดิมชี้ `shop-api/v3/link` ซึ่ง **ไม่มี PATCH** (มีแต่ POST)
    // → เส้นนั้นยิงแล้ว 404 มาตลอด แก้ให้ชี้ path ที่มีจริงคือ shop-api/v3/customer
    // CUSTOMER_EDIT / CUSTOMER_UNLINK เป็น key ใหม่ที่ adapter รู้จักแล้ว
    // (ดู OP_TO_ENDPOINT ใน customerLinkAdapter.js) — เพิ่ม/แก้ path ได้จากหน้านี้
    // โดยไม่ต้องแตะโค้ด BE เลย
    // role 'edit' ใส่ที่ CUSTOMER_EDIT ตัวเดียว (UPDATE เป็นเส้นเดิม ปล่อยหาแบบ key
    // ตามเดิม — role ห้ามซ้ำกันใน tool เดียว ไม่งั้นระบบจะหยิบเส้นแรกที่เจอ)
    // revert: ลบ 2 บรรทัด CUSTOMER_EDIT/CUSTOMER_UNLINK + คืน path เดิมของ UPDATE
    { ...EMPTY_ENDPOINT, key: 'CUSTOMER_UPDATE', label: 'แก้ไขการลิงก์', purpose: 'write' as const,
      method: 'PATCH' as const, path: 'shop-api/v3/customer', require_jwt: true },
    { ...EMPTY_ENDPOINT, key: 'CUSTOMER_EDIT', label: 'แก้ไขข้อมูล (แอดมิน)', purpose: 'write' as const,
      method: 'PATCH' as const, path: 'shop-api/v3/customer', require_jwt: true, role: 'edit' as const },
    { ...EMPTY_ENDPOINT, key: 'CUSTOMER_UNLINK', label: 'ถอนการผูก (แอดมิน)', purpose: 'write' as const,
      method: 'POST' as const, path: 'shop-api/v3/unlink', require_jwt: true, role: 'unlink' as const },
    // ==== [FEAT-20260729-CLINKEDIT] END
  ] as CustomToolEndpoint[],
});

/**
 * ==== [FEAT-20260729-EPROLE] START — ชุด demo v4 "ปลายทางที่พูดคนละภาษา"
 * โชว์ความสามารถใหม่ครบทุกตัวในชุดเดียว (ตรงกับ seed จริง src/utils/seedCustomToolV4.js
 * ฝั่ง BE ซึ่งเทสผ่านแล้ว 30/30 ใน scratch_test_v4adapter.js):
 *   - ชื่อ KEY ตามใจปลายทาง (V4_BIND) → ระบบหาเส้นด้วย "หน้าที่" (role)
 *   - body ชื่อ field คนละแบบ → payload template แปลงให้
 *   - HTTP 200 เสมอ + ผลอยู่ใน result.status OK/NG → result_rules ตัดสิน
 *   - token ซ่อนลึก → token_path ชี้ตำแหน่งได้
 * revert: ลบ demoFormV4 + ปุ่ม "ใช้ค่า demo (v4)" ใน header ของฟอร์ม
 */
const demoFormV4 = () => ({
  name: 'Demo Shop-API (v4)',
  description: 'ปลายทางจำลองที่ตอบคนละรูปแบบกับระบบเรา — โชว์ role + payload template + กฎอ่านผล',
  base_url: DEMO_BASE_URL,
  // [FEAT-20260808-PAYCUSTOOL] ชุด demo เป็นหมวด generic เหมือนเดิม
  category: 'generic' as 'generic' | 'payment' | 'walletpay',
  payment: emptyPayment(),
  auth_type: 'jwt_login' as 'jwt_login' | 'api_key' | 'basic' | 'none' | 'hmac_signature',
  username: 'demo',
  password: 'demo',
  api_key: '',
  api_key_header: 'Authorization',
  timeout_ms: 8000,
  status: true,
  endpoints: [
    { ...EMPTY_ENDPOINT, key: 'V4_SIGNIN', label: 'เข้าสู่ระบบ (v4)', purpose: 'auth' as const,
      method: 'POST' as const, path: 'shop-api/v4/auth', require_jwt: false, is_login: true, role: 'login' as const,
      payload: { user: '{{username}}', pass: '{{password}}' },
      token_path: 'result.payload.session.jwt' },
    { ...EMPTY_ENDPOINT, key: 'V4_FETCH', label: 'ดึงข้อมูลลูกค้า (v4)', purpose: 'data' as const,
      method: 'GET' as const, path: 'shop-api/v4/member?uid={{line_user_id}}&site={{web_code}}',
      require_jwt: true, is_profile: true, role: 'profile' as const,
      profile_map: {
        name: 'result.payload.profileFull.profile.bank.account_name',
        phone: 'result.payload.profileFull.profile.phone',
        code: 'result.payload.profileFull.profile.member_id',
      },
      result_rules: [
        { path: 'result.status', op: 'eq' as const, value: 'OK', http_codes: '', action: 'success' as const, failure_type: '' as const, error_code: '', message_path: '' },
        { path: 'result.errCode', op: 'eq' as const, value: '4004', http_codes: '', action: 'fail' as const, failure_type: 'business' as const, error_code: 'LINK_ACCOUNT_NOT_FOUND', message_path: 'result.errMsg' },
      ] },
    { ...EMPTY_ENDPOINT, key: 'V4_BIND', label: 'ผูกบัญชี (v4)', purpose: 'write' as const,
      method: 'POST' as const, path: 'shop-api/v4/member/bind', require_jwt: true, role: 'link' as const,
      // [FEAT-20260730-IDEMPOTENT] เจ้านี้รองรับกุญแจกันทำซ้ำ ในชื่อ header ของตัวเอง
      idempotency: { enabled: true, location: 'header' as const, field: 'x-req-token', retry_on_timeout: 1 },
      payload: { uid: '{{channel_user_id}}', site: '{{web_code}}', mobileNo: '{{phone_number}}',
        custName: '{{first_name}}', acctNo: '{{account_number}}' },
      result_rules: [
        { path: 'result.status', op: 'eq' as const, value: 'OK', http_codes: '', action: 'success' as const, failure_type: '' as const, error_code: '', message_path: '' },
        { path: 'result.errCode', op: 'eq' as const, value: '4001', http_codes: '', action: 'fail' as const, failure_type: 'business' as const, error_code: 'LINK_ACCOUNT_NOT_FOUND', message_path: 'result.errMsg' },
        { path: 'result.errCode', op: 'eq' as const, value: '4009', http_codes: '', action: 'fail' as const, failure_type: 'business' as const, error_code: 'LINK_ALREADY_LINKED', message_path: 'result.errMsg' },
        { path: 'result.errCode', op: 'eq' as const, value: '5000', http_codes: '', action: 'fail' as const, failure_type: 'transient' as const, error_code: 'LINK_VENDOR_UNAVAILABLE', message_path: 'result.errMsg' },
      ],
      result_map: { member_id: 'result.payload.memberRef', phone: 'result.payload.mobileNo', name: 'result.payload.custName' } },
    { ...EMPTY_ENDPOINT, key: 'V4_REBIND', label: 'แก้ไขการผูก (v4)', purpose: 'write' as const,
      method: 'PATCH' as const, path: 'shop-api/v4/member/bind', require_jwt: true, role: 'edit' as const,
      // [FEAT-20260730-IDEMPOTENT] เจ้านี้รองรับกุญแจกันทำซ้ำ ในชื่อ header ของตัวเอง
      idempotency: { enabled: true, location: 'header' as const, field: 'x-req-token', retry_on_timeout: 1 },
      payload: { uid: '{{channel_user_id}}', site: '{{web_code}}', mobileNo: '{{phone_number}}',
        custName: '{{first_name}}', acctNo: '{{account_number}}' },
      result_rules: [
        { path: 'result.status', op: 'eq' as const, value: 'OK', http_codes: '', action: 'success' as const, failure_type: '' as const, error_code: '', message_path: '' },
        { path: 'result.errCode', op: 'in' as const, value: '4001,4004', http_codes: '', action: 'fail' as const, failure_type: 'business' as const, error_code: 'LINK_ACCOUNT_NOT_FOUND', message_path: 'result.errMsg' },
        { path: 'result.errCode', op: 'eq' as const, value: '5000', http_codes: '', action: 'fail' as const, failure_type: 'transient' as const, error_code: 'LINK_VENDOR_UNAVAILABLE', message_path: 'result.errMsg' },
      ],
      result_map: { member_id: 'result.payload.memberRef', phone: 'result.payload.mobileNo', name: 'result.payload.custName' } },
    { ...EMPTY_ENDPOINT, key: 'V4_UNBIND', label: 'ถอนการผูก (v4)', purpose: 'write' as const,
      method: 'POST' as const, path: 'shop-api/v4/member/unbind', require_jwt: true, role: 'unlink' as const,
      // [FEAT-20260730-IDEMPOTENT] เจ้านี้รองรับกุญแจกันทำซ้ำ ในชื่อ header ของตัวเอง
      idempotency: { enabled: true, location: 'header' as const, field: 'x-req-token', retry_on_timeout: 1 },
      payload: { mobileNo: '{{phone_number}}', site: '{{web_code}}' },
      result_rules: [
        { path: 'result.status', op: 'eq' as const, value: 'OK', http_codes: '', action: 'success' as const, failure_type: '' as const, error_code: '', message_path: '' },
        { path: 'result.errCode', op: 'in' as const, value: '4001,4004', http_codes: '', action: 'fail' as const, failure_type: 'business' as const, error_code: 'LINK_ACCOUNT_NOT_FOUND', message_path: 'result.errMsg' },
      ] },
  ] as CustomToolEndpoint[],
});
// ==== [FEAT-20260729-EPROLE] END

/**
 * ==== [FEAT-20260801-SHOPAPITEMPLATE] START — ชุดค่า Shop-API ตัวจริง (กดปุ่มเดียวได้ครบ)
 * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
 *
 * ผู้ใช้สั่ง: "ซ่อนปุ่ม demo / demo v4 · เพิ่ม 'ใช้ข้อมูล template' ใส่ข้อมูล shop-api ให้เลย"
 *
 * ค่าทุกตัวตรงกับ seeder ฝั่ง BE (`src/utils/seedCustomToolShopapiV1.js`) เป๊ะ —
 * ตั้งจากหน้านี้ หรือ seed จาก CLI ก็ได้ผลเหมือนกัน (ยืนยันด้วยเทส)
 *
 * ⚠️ Secret Key **ไม่ใส่มาให้** โดยตั้งใจ — ห้ามฝัง shared secret ไว้ในโค้ด FE
 *    เพราะ bundle ถูกดาวน์โหลดไปที่เครื่องผู้ใช้ทุกคน (ใครเปิด devtools ก็เห็น)
 *    ผู้ใช้ต้องวางเองในช่อง Secret Key
 *
 * ⚠️ **ไม่มีเส้นแก้ไข/ถอนการผูก** — ยิงทดสอบแล้วปลายทางตอบ 404 ทุก method
 *    (PATCH/PUT/DELETE /shop-api/v1/customer · /customer/unlink · /unlink)
 *    จึงไม่ใส่มาให้ ถ้าใส่ไปจะกลายเป็นเส้นที่ยิงแล้ว 404 ตลอด
 *
 * revert: ลบ shopapiForm + ปุ่ม "ใช้ข้อมูล template (Shop-API)" แล้วเอาปุ่ม demo กลับมา
 */
/** ปุ่มชุด demo (v3/v4) — ซ่อนตามที่ผู้ใช้สั่ง แต่โค้ดยังอยู่ครบ เปิดกลับได้ทันที */
const SHOW_DEMO_PRESETS = false;

const SHOPAPI_BASE_URL = MINT_HOSTS.shopapi;   // [FEAT-20260809-MINTCONST]
const shopapiForm = () => ({
  name: 'Shop-API v1 (ของจริง)',
  description: 'Shop-API ตัวจริง — เซ็นด้วยลายเซ็น HMAC ไม่มี login/token · 4 เส้น (โปรไฟล์/ผูกบัญชี/กฎร้าน/ตรวจสลิป)',
  base_url: SHOPAPI_BASE_URL,
  /**
   * [FEAT-20260809-SHOPAPIPAYTEMPLATE] template นี้เป็นหมวด **payment** แล้ว
   *
   * WHY: เส้น topup (`shop-api/v1/customer/validate-slip`) เป็น **เส้นลูกของ Shop-API
   * ตัวเดียวกันนี้** — host เดียวกัน secret เดียวกัน วางอยู่ข้าง ๆ
   * `shop-api/v1/customer` จึงไม่ต้องสร้าง tool ใหม่ซ้ำอีกตัว. ของเดิมตั้งเป็น
   * generic + payment ว่าง คนกดปุ่ม template จึงได้ tool ที่ยังเติมเงินไม่ได้
   * ต้องมาเพิ่มเส้น + สลับหมวดเองทีหลัง.
   *
   * ⚠️ walletpay is deliberately NOT in this template. It sits on a different host,
   * and a tool carries exactly ONE `base_url`, so the two legs cannot share a
   * tool — bind walletpay separately on the hook (`walletpay_tool_status` +
   * `walletpay_tool_id`) using its own template button. ต้องแยก tool คนละ host.
   *
   * The `payment` block uses defaults throughout, which already match the BE's
   * own defaults, so the tool works immediately with nothing else to fill in.
   * Every field stays editable afterwards.
   * HOW TO CHANGE: to get the old generic template back, set `'generic'` here
   * and delete the PAY_TOPUP endpoint below.
   */
  category: 'payment' as 'generic' | 'payment' | 'walletpay',
  payment: emptyPayment(),
  auth_type: 'hmac_signature' as const,
  username: '',
  password: '',
  api_key: '',            // ← ผู้ใช้วาง Secret Key เอง (ห้าม hardcode ใน FE)
  api_key_header: 'Authorization',
  timeout_ms: 8000,
  status: true,
  endpoints: [
    { ...EMPTY_ENDPOINT, key: 'CUSTOMER_PROFILE', label: 'ดึงโปรไฟล์ลูกค้า (Shop-API v1)',
      purpose: 'data' as const, method: 'GET' as const,
      path: `${MINT_PATHS.shopapiCustomer}?line_user_id={{line_user_id}}&web_code={{web_code}}`,
      require_jwt: true, is_profile: true, role: 'profile' as const,
      // path ยืนยันกับ response จริงแล้วว่ามีค่าอยู่จริงทั้งสองตัว
      // `code` ปล่อยว่าง — ปลายทางไม่มีรหัสสมาชิกใน response (ใส่มั่วจะได้ค่าว่าง
      // แล้วไล่เหตุยากกว่าเดิม)
      profile_map: { name: 'data.profile.bank.account_name', phone: 'data.profile.phone', code: '' } },
    { ...EMPTY_ENDPOINT, key: 'CUSTOMER_LINK', label: 'ผูกบัญชีลูกค้า (Shop-API v1)',
      purpose: 'write' as const, method: 'POST' as const, path: MINT_PATHS.shopapiCustomer,
      require_jwt: true, role: 'link' as const,
      payload: {
        line_user_id: '{{channel_user_id}}',
        web_code: '{{web_code}}',
        phone_number: '{{phone_number}}',
        first_name: '{{first_name}}',
        account_number: '{{account_number}}',
      } },
    { ...EMPTY_ENDPOINT, key: 'SITE_RULES', label: 'กฎเกณฑ์ของร้าน (Shop-API v1)',
      purpose: 'data' as const, method: 'GET' as const,
      path: `${MINT_PATHS.shopapiSiteRules}?web_code={{web_code}}`, require_jwt: true },
    /**
     * [FEAT-20260809-SHOPAPIPAYTEMPLATE] เส้น topup — "ลูก" ของ Shop-API ตัวเดียวกัน
     *
     * ยืนยันกับปลายทางจริงแล้ว (2026-08-09): ยิงแล้วได้ HTTP 200 และเซิร์ฟเวอร์
     * รับลายเซ็น HMAC ของเรา.
     *
     * ⚠️ ค่าที่ตั้งไว้แต่ละตัวมีเหตุผล ห้ามเปลี่ยนโดยไม่รู้ผล:
     *  · `role: 'pay_topup'` — BE หาเส้นนี้ด้วย **role** เท่านั้น ไม่ได้เดาจาก
     *    ชื่อ KEY. ตั้งผิด/ไม่ตั้ง = ระบบหาเส้นไม่เจอ แล้วปล่อยสลิปทิ้งเงียบ ๆ
     *  · `request_type: 'form-data'` — ต้องแนบ **ไฟล์ภาพสลิป** ไปด้วย จะเป็น
     *    json ไม่ได้
     *  · `require_jwt: false` — เส้นนี้ยืนยันตัวตนด้วย HMAC (X-Signature) ไม่ใช่
     *    JWT ต่างจาก 3 เส้นข้างบน
     *  · `purpose: 'write'` — เป็นเส้นที่ทำให้เงินเข้า ไม่ใช่เส้นอ่านข้อมูล
     *    จึงต้องไม่ถูกเรียกอัตโนมัติตอนลูกค้าทัก
     */
    MINT_PAY_TOPUP_ENDPOINT(),
  ] as CustomToolEndpoint[],
});
// ==== [FEAT-20260801-SHOPAPITEMPLATE] END

/**
 * ==== [FEAT-20260809-WALLETPAYTEMPLATE] START — template ของ walletpay (tool แยก)
 *
 * WHAT: กดปุ่ม "ใช้ข้อมูล template (walletpay)" แล้วได้ tool สำหรับขา walletpay ครบ
 * เหลือแค่ตรวจ host ให้ตรงของจริง แล้วไปผูกที่หน้า OA ช่อง walletpay
 * (`walletpay_tool_status` + `walletpay_tool_id`).
 *
 * WHY เป็น tool แยก ไม่รวมกับ Shop-API: BE ประกอบ URL เป็น
 * `tool.base_url + '/' + endpoint.path` — tool หนึ่งตัวมี `base_url` ได้ค่าเดียว
 * แต่ topup อยู่บน Shop-API ส่วน walletpay อยู่คนละ host **จึงยัดรวมกันไม่ได้**
 * (เคยลองแล้ว: ขา walletpay ยิงไปโดน host ของ topup แล้ว 404 ทุกครั้ง)
 *
 * [FIX-20260812-WALLETPAYURL] HOST NOW CONFIRMED WORKING. The old `rn4-api` host
 * answered 404 on every path (evidence: BE repo
 * `log_error/walletpay-endpoint-blocked-2026-08-09.md`); the fix was the host, not
 * the path — `api.walletpay.example.com` accepted a REAL payin slip with HTTP 200
 * on 2026-08-11 (BE repo `todo/task/11082026/be_todo27_11082026.md`, run
 * 6a7ab00d…). MINT_HOSTS.walletpay now carries that tested host, so this button
 * mints a ready-to-use tool like the Shop-API one. ปุ่มนี้ใช้ host ที่เทสผ่านจริงแล้ว.
 *
 * NO AUTH: the payin endpoint requires none — `refId` is the only secret in that
 * exchange — hence `auth_type:'none'` and `require_jwt:false`.
 *
 * HOW TO CHANGE: the host → WALLETPAY_BASE_URL · the path or the file field → the
 * PAY_WALLETPAY endpoint below. The file field name is owned by the BE config
 * (`payment.walletpay_file_field`, default `'slip'`), so change it there too.
 */
const WALLETPAY_BASE_URL = MINT_HOSTS.walletpay;   // [FEAT-20260809-MINTCONST]
const walletpayForm = () => ({
  name: 'walletpay (payin slip)',
  description: 'walletpay — ส่งภาพสลิปเข้า payin ด้วย refId จากรายการเดินบัญชี · คนละ host กับ Shop-API · ไม่ต้องยืนยันตัวตน',
  base_url: WALLETPAY_BASE_URL,
  /* [FEAT-20260815-WALLETPAYCAT] `'walletpay'` — เดิมตั้ง `'generic'` ตอนที่ยังไม่มีหมวดนี้
     ค่านี้เป็นแค่ค่าตั้งต้นในฟอร์ม: ตัวตัดสินจริงคือ `derivedCategory` ที่คำนวณจาก
     เส้น (template นี้ใส่ pay_walletpay ให้อยู่แล้ว) และ BE คำนวณซ้ำอีกชั้นด้วย
     `deriveCategory` ตอนบันทึก · ตั้งให้ตรงตั้งแต่แรกเพื่อไม่ให้หน้าจอโชว์
     'generic' ค้างอยู่หนึ่งจังหวะก่อนกดเซฟ
     ⚠️ ไม่กระทบ Shop-API: template นั้นแยกกันคนละก้อน และยังเป็น 'payment' */
  category: 'walletpay' as 'generic' | 'payment' | 'walletpay',
  payment: emptyPayment(),
  auth_type: 'none' as const,
  username: '',
  password: '',
  api_key: '',
  api_key_header: 'Authorization',
  timeout_ms: 15000,
  status: true,
  endpoints: [
    /**
     * `{{refId}}` ถูกแทนค่าตอนรันด้วยเลขอ้างอิงของ statement ที่กำลังลอง
     * (BE: `_walletpayBody` ใส่ `refId` ลงตัวแปร) — ห้ามเปลี่ยนชื่อตัวแปรนี้
     * `request_type: 'form-data'` เพราะต้องแนบภาพสลิป
     * `purpose: 'write'` เพราะเป็นเส้นที่ทำให้เงินเข้า ไม่ใช่เส้นอ่านข้อมูล
     */
    MINT_PAY_WALLETPAY_ENDPOINT(),
  ] as CustomToolEndpoint[],
});
// ==== [FEAT-20260809-WALLETPAYTEMPLATE] END

/**
 * ==== [FEAT-20260808-PAYCUSTOOL] START — หมวด "payment" (ตรวจสลิป → เติมเงิน)
 * 🔒 สาย dev-handoff
 *
 * WHAT: custom tool มี "หมวด" เพิ่มมา 2 แบบ
 *        · generic — tool ทุกตัวที่มีอยู่เดิม ไม่มีอะไรเปลี่ยน
 *        · payment — tool ที่ใช้เส้นทางสลิป: อ่านรายการเดินบัญชี (statement)
 *                    → เติมเงิน (topup) → ส่งต่อ walletpay
 * WHY : ค่าที่หมวด payment ต้องใช้ (path ของรายการ, ชื่อ field ของ walletpay, ข้อความตอบลูกค้า)
 *       ไม่เกี่ยวกับ tool ทั่วไปเลย ถ้ายัดรวมกันฟอร์มจะรกและคนกรอกผิดง่าย
 *       → เลือกหมวดก่อน แล้วค่อยโผล่เฉพาะช่องที่หมวดนั้นใช้จริง
 * HOW : เพิ่ม/แก้ช่อง → แก้ที่ PAYMENT_CONNECTION_FIELDS (กลุ่มเชื่อมต่อ) หรือ
 *       PAYMENT_REPLY_FIELDS (กลุ่มข้อความ) ที่เดียว UI สร้างช่องให้เอง
 *       ส่วนชื่อ key ต้องตรงกับ CustomToolPaymentConfig ใน customToolService.ts เป๊ะ ๆ
 *
 * ⚠️ BE **ตัด key ที่ไม่รู้จักทิ้งเงียบ ๆ** ตอนบันทึก — ตั้งชื่อ key ผิด = ค่าหายไปโดยไม่ฟ้อง
 *
 * revert: ลบบล็อกนี้ + ตัวเลือกหมวดในฟอร์ม + ส่วน payment ในฟังก์ชัน save/openEdit
 */

/* [FIX-20260810-CATFROMROLE] CATEGORY_OPTIONS ถูกลบ — ไม่มี dropdown ให้เลือกหมวดแล้ว
   หมวดคำนวณจากหน้าที่ของเส้น (ดู `derivedCategory`) ป้ายที่ใช้แสดงผลย้ายไปเขียน
   ตรงจุดแสดงผลจุดเดียว revert: เอา const นี้กลับมาพร้อม SearchableSelect ในฟอร์ม */

/**
 * WHERE TO EDIT WHAT — ช่องกลุ่ม "การเชื่อมต่อ & การจับคู่"
 * key      = ชื่อ field ที่ส่งขึ้น BE (ห้ามพิมพ์ผิด — BE ตัดทิ้งเงียบ)
 * label    = หัวช่อง
 * hint     = คำอธิบายให้คนหน้างานเข้าใจว่าช่องนี้ทำอะไร
 * mono     = แสดงเป็นฟอนต์ monospace ไหม (ช่องที่เป็น path/ชื่อ field ควรเป็น true)
 */
const PAYMENT_CONNECTION_FIELDS: Array<{
  key: keyof CustomToolPaymentConfig; label: string; hint: string; mono?: boolean;
}> = [
  {
    key: 'statement_tx_path', label: 'ตำแหน่งรายการเดินบัญชี (statement)', mono: true,
    hint: 'ระบบเดินตาม path นี้ใน response เพื่อหา "รายการฝากเงิน" ที่จะเอามาจับคู่กับสลิป · ตั้งผิด = หาไม่เจอสักรายการ',
  },
  {
    key: 'statement_provider_code', label: 'รหัสผู้ให้บริการที่จะเอามาจับคู่', mono: true,
    hint: 'เอาเฉพาะรายการที่มาจากผู้ให้บริการนี้ · กันสลิปไปจับคู่กับรายการของช่องทางอื่น',
  },
  {
    key: 'statement_status', label: 'กรองเฉพาะรายการที่สถานะนี้', mono: true,
    // ⚠️ จุดที่พลาดง่ายที่สุดของหน้านี้ — ย้ำใน hint ให้เห็นตั้งแต่ยังไม่กรอก
    hint: 'เอาเฉพาะรายการที่สถานะตรงกับค่านี้ · เว้นว่าง = ไม่กรองสถานะ (เอาทุกสถานะมาจับคู่)',
  },
  {
    key: 'walletpay_ref_id_field', label: 'ชื่อ field เลขอ้างอิงที่ส่งให้ walletpay', mono: true,
    hint: 'ตอนส่งต่อให้ walletpay ระบบจะใส่เลขอ้างอิงของสลิปลงใน field ชื่อนี้ · ต้องตรงกับที่ walletpay ฝั่งนั้นรับ',
  },
  {
    key: 'walletpay_ref_id_query_param', label: 'ชื่อ query param ของเลขอ้างอิง', mono: true,
    hint: 'ชื่อพารามิเตอร์บน URL ที่ใช้ส่งเลขอ้างอิง (คนละที่กับ field ในเนื้อ request)',
  },
  {
    key: 'walletpay_file_field', label: 'ชื่อ field ที่ใช้แนบไฟล์สลิป', mono: true,
    hint: 'ชื่อช่องที่ walletpay ใช้รับ "รูปสลิป" · ตั้งผิด = ส่งไปแล้วปลายทางบอกว่าไม่มีไฟล์แนบ',
  },
  {
    key: 'topup_payload_path', label: 'ตำแหน่งข้อมูลที่ส่งต่อจากผลเติมเงิน', mono: true,
    hint: 'เจาะเอาเฉพาะบางส่วนของผลลัพธ์เติมเงินไปใช้ต่อ · เว้นว่าง = ส่งผลลัพธ์ทั้งก้อน',
  },
];

/**
 * WHERE TO EDIT WHAT — ช่องกลุ่ม "ข้อความตอบลูกค้า"
 * ทุกช่องเว้นว่างได้ · เว้นว่าง = BE ใช้ข้อความไทยเริ่มต้นของตัวเอง
 * `fallback` = ข้อความจริงที่ BE จะส่งเมื่อเว้นว่าง — โชว์เป็น placeholder ให้คนเห็น
 *              "ถ้าไม่กรอก ลูกค้าจะได้อ่านอะไร" ก่อนตัดสินใจว่าจะเขียนทับไหม
 *
 * ⚠️ ข้อความใน `fallback` **คัดลอกมาจาก REPLY_STATE_DEFAULTS ฝั่ง BE**
 *    → เป็น "เอกสารบอกสัญญาของ BE" ไม่ใช่แหล่งความจริงที่สอง — FE ไม่เคยส่งค่าพวกนี้
 *      ขึ้นไป ช่องที่เว้นว่างถูกส่งเป็น '' แล้ว BE เป็นคนเลือกข้อความเอง
 *    → **ถ้า BE แก้ข้อความเริ่มต้นเมื่อไหร่ ต้องมาแก้ลิสต์นี้ตาม** ไม่งั้น placeholder
 *      จะโกหกคนใช้ (โชว์ข้อความเก่าที่ลูกค้าไม่ได้รับแล้ว)
 * HOW : เพิ่ม/ลบสถานะ → แก้ที่ลิสต์นี้ที่เดียว UI สร้างช่องให้เอง
 *       แต่ `key` ต้องมีอยู่จริงใน CustomToolPaymentConfig ด้วย (TS จะฟ้องถ้าพิมพ์ผิด)
 */
const PAYMENT_REPLY_FIELDS: Array<{
  key: keyof CustomToolPaymentConfig; label: string; hint: string; fallback: string;
}> = [
  {
    key: 'reply_success_text', label: 'เติมเงินสำเร็จ',
    hint: 'ส่งเมื่อเงินเข้าบัญชีลูกค้าแล้วจริง ๆ (ครอบคลุมทั้งกรณีเติมผ่าน topup และผ่าน walletpay)',
    fallback: 'กำลังดำเนินรายการ กำลังอัพเดทเครดิต',
  },
  {
    key: 'pending_reply_text', label: 'รอแอดมินยืนยัน',
    hint: 'ระบบจับคู่สลิปได้แล้ว แต่ยังต้องให้แอดมินกดยืนยันก่อนเงินจะเข้า',
    fallback: 'กำลังดำเนินการเติมเงิน',
  },
  {
    key: 'no_match_reply_text', label: 'สลิปไม่ตรงกับรายการ',
    hint: 'สลิปใบนี้จับคู่กับรายการไม่ได้ · ลูกค้าจะเห็นปุ่ม [ลองใหม่] ต่อท้ายข้อความนี้',
    fallback: 'ไม่พบรายการที่ตรงกับสลิปนี้ กรุณากด "ลองใหม่" เพื่อตรวจสอบรายการถัดไป',
  },
  {
    key: 'review_reply_text', label: 'ต้องให้คนตรวจสอบ',
    hint: 'กรณีไม่ทราบผลหรือหมดเวลารอ · ยังไม่ตัดสินว่าสำเร็จหรือล้มเหลว ต้องมีคนเข้าไปดู',
    fallback: 'ไม่สามารถดำเนินรายการอัตโนมัติได้ กรุณาลองใหม่อีกครั้งหรือติดต่อแอดมิน',
  },
  {
    key: 'not_found_reply_text', label: 'ไม่พบรายการที่ตรงเลย',
    hint: 'ไม่เจอรายการเดินบัญชีที่ตรงกับสลิปนี้สักรายการ · ลูกค้าส่งสลิปใหม่ได้',
    fallback: 'ไม่สามารถตรวจสอบยอดเงินได้',
  },
  {
    // [FEAT-20260809-PAYNOTLINK] สถานะที่ 7 — ลูกค้ายังไม่ได้ผูกบัญชี
    // จุดต่างที่ต้องบอกคนตั้งค่าให้ชัด: สถานะนี้ระบบ "ปล่อยสลิปคืน" ไม่ล็อกไว้รอแอดมิน
    // เพราะลูกค้าแก้เองได้เลย → ข้อความควรบอกวิธีแก้ ไม่ใช่บอกให้รอ
    key: 'not_linked_reply_text', label: 'ยังไม่ได้ผูกบัญชี',
    hint: 'LINE ของลูกค้ายังไม่ได้ผูกกับบัญชีเว็บ · ระบบไม่ล็อกสลิปไว้ ลูกค้าผูกบัญชีแล้วส่งสลิปใบเดิมใหม่ได้ทันที',
    fallback: 'ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง',
  },
  {
    key: 'reply_detail', label: 'บรรทัดรายละเอียดเพิ่มเติม',
    hint: 'บรรทัดเสริมที่ต่อท้ายข้อความด้านบน · เว้นว่าง = ระบบใส่ "-" ให้',
    fallback: '-',
  },
];

/** ค่าเริ่มต้นของ payment ตอนสร้าง tool ใหม่ — ยืมค่าจากฝั่ง service ที่เดียว ไม่พิมพ์ซ้ำ */
const emptyPayment = (): CustomToolPaymentConfig => ({
  ...PAYMENT_DEFAULTS,
  topup_to_walletpay_map: {},   // object ต้อง clone ใหม่ ไม่งั้นทุกฟอร์มจะแชร์ก้อนเดียวกัน
});
// ==== [FEAT-20260808-PAYCUSTOOL] END

const emptyForm = () => ({
  name: '', description: '', base_url: '',
  // [FEAT-20260808-PAYCUSTOOL] tool ใหม่เริ่มที่ generic เสมอ = พฤติกรรมเดิม
  category: 'generic' as 'generic' | 'payment' | 'walletpay',
  payment: emptyPayment(),
  auth_type: 'jwt_login' as 'jwt_login' | 'api_key' | 'basic' | 'none' | 'hmac_signature', username: '', password: '', api_key: '',
  api_key_header: 'Authorization', timeout_ms: 8000, status: true,
  endpoints: [] as CustomToolEndpoint[],
});

const PURPOSE_STYLE: Record<string, string> = {
  auth: 'bg-amber-100 text-amber-700',
  data: 'bg-sky-100 text-sky-700',
  write: 'bg-emerald-100 text-emerald-700',
};

export const CustomTools: React.FC = () => {
  /* [FEAT-20260903-TOPUPPERPROVIDER] which slip providers a `pay_topup` line may
     be bound to. The SERVER answers, so this page holds no vendor names, and
     `choiceCount` (which excludes the default) decides whether the control is
     rendered at all — while one provider is registered there is nothing to bind
     to and the column stays off the row. */
  const slipProviders = useFieldOptions('slip_provider');
  const { t } = useI18n();
  /* [FEAT-20261022-I18NPAGESEN] labels use `tx` — several handlers and rows name a tool `t` */
  const tx = t;
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // [FEAT-20260816-WALLETPAYFOLD] walletpay-category tools fold the slip-settings block
  // by default — presentation ONLY: values stay bound, saved and stored exactly as
  // before. Why: at RUNTIME these knobs are read from the PAYMENT tool only
  // (payment-runner.service.ts readCfg — verified 16/08), so on a walletpay tool the
  // box is stored-but-unread; the owner asked to fold it out of the way.
  // revert: delete this state + the [FEAT-20260816-WALLETPAYFOLD] blocks below.
  const [showWalletpayPayBlock, setShowWalletpayPayBlock] = useState(false);

  /* [FIX-20260810-CATFROMROLE] หมวดของ tool = ผลลัพธ์ของ "หน้าที่" ที่ตั้งไว้บนเส้น
     ไม่ใช่ค่าที่กรอกแยก · ต้องตรงกับ deriveCategory ฝั่ง BE
     (`custom-tool-normalize.ts`) ซึ่งเป็นตัวตัดสินจริงตอนบันทึก
     ⚠️ เส้นที่ปิดอยู่ (status=false) ก็ยังนับ — เหมือนฝั่ง BE เพราะการปิดเส้น
        ชั่วคราวไม่ควรทำให้ tool หลุดจาก OA ที่ผูกไว้
     revert: ลบ derivedCategory แล้วกลับไปใช้ form.category ทุกจุด */
  /* [FEAT-20260815-WALLETPAYCAT] walletpay เป็นหมวดของตัวเอง — ต้องตรงกับ
     `deriveCategory` ฝั่ง BE (`custom-tool-normalize.ts`) ซึ่งเป็นตัวตัดสินจริง
     ตอนบันทึก · ถ้าสองฝั่งคิดคนละแบบ หน้าจอจะโชว์หมวดหนึ่งแต่ฐานเก็บอีกหมวด

     กฎ: มี pay_topup → payment (Shop-API v1 — ประตูเดียวเข้า money path ที่
          `payment-runner.service.ts` gate ไว้) · ไม่มี topup แต่มี pay_walletpay
          → walletpay · ไม่มีทั้งคู่ → generic
     ⚠️ tool ที่มีทั้งสองเส้นยังเป็น payment — เป็นรูปแบบ tool เดียวจบแบบเดิม
        ที่ runner ยังรองรับอยู่ */
  const derivedCategory: 'generic' | 'payment' | 'walletpay' = form.endpoints.some(
    (e) => e.role === 'pay_topup',
  )
    ? 'payment'
    : form.endpoints.some((e) => e.role === 'pay_walletpay')
      ? 'walletpay'
      : 'generic';

  const [confirmDelete, setConfirmDelete] = useState<CustomToolEntry | null>(null);
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);

  // ── เลือก OA ──
  const [assignFor, setAssignFor] = useState<CustomToolEntry | null>(null);
  const [allHooks, setAllHooks] = useState<any[]>([]);
  const [pickedHooks, setPickedHooks] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);


  // [FEAT-20260729-CUSTOOL] เลือก OA ได้ในฟอร์มเลย (เดิมต้องไปกดปุ่มลิงก์ในตารางทีหลัง = งง)
  const [formHooks, setFormHooks] = useState<string[]>([]);
  // ช่องวาง cURL — แยก 2 ระดับ: main (ตัว tool) กับ ราย endpoint
  const [curlMain, setCurlMain] = useState('');
  const [curlFor, setCurlFor] = useState<number | null>(null); // index ของ endpoint ที่กำลังวาง
  const [curlPath, setCurlPath] = useState('');
  const [curlMsg, setCurlMsg] = useState<string | null>(null);
  // [FEAT-20260729-CUSTOOL] ปุ่ม ? อธิบายทั้งหน้าแบบภาษาคน
  const [showHelp, setShowHelp] = useState(false);
  // [FEAT-20260729-EPROLE] เปิด/ปิดกล่อง "กฎอ่านผลจาก body" รายเส้น (ค่าเริ่มต้นพับไว้
  // ไม่รกฟอร์มของคนที่ไม่ใช้ — เส้นที่มีกฎอยู่แล้วจะโชว์จำนวนบนปุ่ม)
  const [rulesOpen, setRulesOpen] = useState<Record<number, boolean>>({});
  // [FEAT-20260729-CUSTOOL] ทดสอบรายเส้นในฟอร์ม + โชว์ JSON ที่ปลายทางคืนมาจริง
  const [epTesting, setEpTesting] = useState<number | null>(null);
  const [epResult, setEpResult] = useState<Record<number, any>>({});

  // ── ผลการเทส ──
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any | null>(null);

  // ==== [FEAT-20260729-CUSTOOLUX] START — toast + pagination
  // 🔒 สาย AUTO — to_dev_auto เท่านั้น
  //
  // toast: เดิมสำเร็จแล้วเงียบสนิท (ปิด modal เฉย ๆ) ไม่รู้ว่าบันทึกติดไหม
  // ส่วนที่พลาดใช้ AlertModal ซึ่งต้องกดปิด — งานที่ทำบ่อยอย่างบันทึก/ลบ/ลิงก์ OA
  // ควรบอกผลแล้วหายไปเอง · ใช้รูปแบบเดียวกับ DynamicTagPreviewModal (เข้าชุดกัน)
  //
  // pagination: เดิม `limit: 100` ดึงมาทีเดียวทั้งหมดแล้วไม่มีตัวแบ่งหน้าเลย
  // → tool เกิน 100 ตัวจะหายเงียบ ๆ โดยไม่มีอะไรบอก · BE รองรับ page/limit อยู่แล้ว
  // revert: ลบ state 4 ตัวนี้ + แถบ pagination ใต้ตาราง + กลับ load() เป็น limit 100
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const notify = useCallback((ok: boolean, message: string) => {
    setToast({ ok, message });
    setTimeout(() => setToast(null), ok ? 2600 : 4200);
  }, []);

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  // ==== [FEAT-20260729-CUSTOOLUX] END

  /* ==== [FEAT-20261027-TANSTACK] the tool table through TanStack Query ===========
   * Same requests as before: one list page + one getUsage per row, refetched on every
   * page/search/perPage change and after every save (load = refetch). `loading` is
   * `isFetching`, because the old load() showed the spinner row on EVERY load,
   * including the refresh after an action. Rows survive a failed reload (lastGood).
   * revert: restore this file from tag ckpt-before-tanstack-demo-26102026. */
  const pageQuery = useCustomToolsPageQuery({ page, limit: perPage, search });
  const lastGood = useRef<{ items: CustomToolEntry[]; total: number; usage: Record<string, number> }>({ items: [], total: 0, usage: {} });
  if (pageQuery.data) lastGood.current = pageQuery.data;
  const { items, total, usage: usageMap } = lastGood.current;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const loading = pageQuery.isFetching;
  const { refetch: refetchPage } = pageQuery;
  const load = useCallback(async () => { await refetchPage(); }, [refetchPage]);

  // เปลี่ยนคำค้น/จำนวนต่อหน้า → กลับหน้าแรก (ไม่งั้นค้างหน้า 5 ของผลลัพธ์ที่มี 2 หน้า)
  useEffect(() => { setPage(1); }, [search, perPage]);


  // โหลด OA ทั้งหมดตามสิทธิ์ (ใช้ตอนเลือก multi OA)
  useEffect(() => {
    (async () => {
      try {
        const groups = await fetchVisibleGroups();
        const lists = await Promise.all(
          groups.map((g) => webhookService.getHooksByGroup(g._id).catch(() => []))
        );
        const merged: any[] = [];
        const seen = new Set<string>();
        lists.flat().forEach((h: any) => {
          const id = h?._id || h?.id;
          if (id && !seen.has(id)) { seen.add(id); merged.push(h); }
        });
        setAllHooks(filterVisibleHooks(merged));
      } catch {
        setAllHooks([]);
      }
    })();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormHooks([]);
    setCurlMain(''); setCurlPath(''); setCurlFor(null); setCurlMsg(null);
    setShowWalletpayPayBlock(false); // [FEAT-20260816-WALLETPAYFOLD] เปิดฟอร์มใหม่ = พับเสมอ
    setShowForm(true);
  };

  /* [FEAT-20261016-TOOLMINT] a company whose env is incomplete: the create form opens with the
     server's skeleton (name · base URL · endpoints) — the admin types the rest and saves as usual */
  const openCreateFromPreset = (p: ToolMintPreset) => {
    openCreate();
    setForm({ ...emptyForm(), ...p, endpoints: p.endpoints.map((e) => ({ ...EMPTY_ENDPOINT, ...(e as Partial<CustomToolEndpoint>) })) });
  };

  const openEdit = (t: CustomToolEntry) => {
    setEditingId(t.id);
    setForm({
      name: t.name, description: t.description, base_url: t.base_url,
      // ==== [FEAT-20260808-PAYCUSTOOL] หมวด + ค่า payment ของ tool เดิม
      // tool generic ไม่มี t.payment → เติมค่าเริ่มต้นไว้ให้ เพื่อที่ถ้าคนสลับหมวดเป็น
      // payment กลางคัน ฟอร์มจะมีค่าตั้งต้นให้แก้ทันที (ไม่ใช่ช่องว่างทั้งแผง)
      // ⚠️ ถ้ามีค่าเดิมอยู่แล้วต้องใช้ของเดิมทั้งดุ้น — ห้าม merge ทับด้วย default
      //    เพราะ statement_status ที่ผู้ใช้ตั้งใจเว้นว่าง ('') จะโดน default เขียนทับ
      category: t.category,
      payment: t.payment ? { ...t.payment, topup_to_walletpay_map: { ...t.payment.topup_to_walletpay_map } } : emptyPayment(),
      auth_type: t.auth_type as any, username: t.username,
      // เว้นว่างเสมอ — ไม่กรอก = ไม่แตะของเดิม (BE ไม่เคยส่งค่าจริงมา)
      password: '', api_key: '',
      api_key_header: t.api_key_header, timeout_ms: t.timeout_ms,
      status: t.status, endpoints: t.endpoints.map((e) => ({ ...e })),
    });
    // [FEAT-20260729-CUSTOOL] ดึง OA ที่ลิงก์อยู่มาแสดงในฟอร์ม (เลือกไว้ให้เลย)
    // ==== [FIX-20260811-CUSTOOLVIS] checkbox OA ที่ผูกอยู่หายเอง — เหตุ + ทางแก้ ====
    // เหตุ: `formHooks` (OA ที่ผูก tool) มาจาก getUsage ซึ่ง **ไม่ผ่าน** visibleGroups
    //   filter · แต่ `allHooks` (list ที่ render) ผ่าน filterVisibleHooks (:754).
    //   checkbox จะติ๊กก็ต่อเมื่อ id อยู่ทั้งใน formHooks AND allHooks (:2225-2226).
    //   ⇒ OA ที่ผูกไว้แต่ไม่อยู่ในกลุ่มที่แอดมินเห็น → header นับได้ (1/7) แต่ 0 ติ๊ก
    //   ⇒ แอดมินต้องมาติ๊กใหม่ทุกครั้ง · และถ้า save ทั้งที่ว่าง assign() (REPLACE) จะ
    //   **ถอด binding ของ OA ที่มองไม่เห็นทิ้ง** — อันตราย (เจ้าของแจ้ง 2026-08-11).
    // แก้: merge OA ที่ getUsage คืนมา (bound จริง) แต่หายไปจาก allHooks กลับเข้า render
    //   list — getUsage คืน _id/alias/name/line_oa_name/group/custom_tool_status ครบพอ
    //   render ได้ · ไม่แตะ BE · ไม่แตะ filterVisibleHooks (allHooks เดิมยังกรองเหมือนเดิม)
    // revert: ลบ merge block เหลือ setFormHooks(u.hooks.map(h=>h._id)) บรรทัดเดียว
    customToolService.getUsage(t.id)
      .then((u) => {
        setFormHooks(u.hooks.map((h) => h._id));
        // เติม OA ที่ผูกอยู่แต่ยังไม่อยู่ใน allHooks (โดน visibility filter) ให้ render ได้
        setAllHooks((prev) => {
          const have = new Set(prev.map((h: any) => h._id || h.id));
          const missing = (u.hooks || []).filter((h: any) => !have.has(h._id));
          return missing.length ? [...prev, ...missing] : prev;
        });
      })
      .catch(() => setFormHooks([]));
    setCurlMain(''); setCurlPath(''); setCurlFor(null); setCurlMsg(null);
    setShowWalletpayPayBlock(false); // [FEAT-20260816-WALLETPAYFOLD] เปิดฟอร์มใหม่ = พับเสมอ
    setShowForm(true);
  };

  /**
   * [FEAT-20260808-PAYCUSTOOL] แก้ค่าใน form.payment ทีละช่อง
   * WHY: เขียน setForm({...form, payment:{...form.payment, x}}) ซ้ำทุกช่องแล้วพลาดง่าย
   *      (ลืม spread ก้อนเดิม = ค่าช่องอื่นหายทั้งแผง) → รวบไว้ที่เดียว
   * ⚠️ ค่าที่ส่งเข้ามาถูกเก็บตรง ๆ ไม่มีการ trim / เติมค่า default ให้
   *    เพราะช่องว่างของบางช่อง (statement_status) เป็นค่าที่มีความหมายในตัวมันเอง
   */
  const setPay = (patch: Partial<CustomToolPaymentConfig>) => {
    setForm((f) => ({ ...f, payment: { ...f.payment, ...patch } }));
  };

  const setEp = (idx: number, patch: Partial<CustomToolEndpoint>) => {
    setForm((f) => ({
      ...f,
      endpoints: f.endpoints.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    }));
  };

  /** ธง is_login/is_refresh/is_profile มีได้ ≤1 → เลือกตัวใหม่ต้องปลดตัวเก่า
   *  (BE validate ซ้ำอีกชั้น แต่กันไว้ที่ UI ให้ผู้ใช้เห็นทันที) */
  const setExclusiveFlag = (idx: number, flag: 'is_login' | 'is_refresh' | 'is_profile', v: boolean) => {
    setForm((f) => ({
      ...f,
      endpoints: f.endpoints.map((e, i) => ({
        ...e,
        [flag]: i === idx ? v : (v ? false : e[flag]),
      })),
    }));
  };

  // ==== [FEAT-20260729-CUSTOOL] วาง cURL แล้วกรอกให้อัตโนมัติ (แบบ Postman) ====
  // เจตนา: กรอกเฉพาะที่มั่นใจ · อะไรที่เดาไม่ได้ (key, ธง is_login/is_profile)
  // ปล่อยว่างให้คนกรอก/เลือกเอง — เดาผิดแล้วเงียบอันตรายกว่าปล่อยว่าง

  /** ระดับ tool: เอา base_url + creds (ถ้าเป็นเส้น login จะได้ user/pass มาด้วย) */
  const applyCurlMain = () => {
    const r = parseCurl(curlMain);
    if (r.errors.length && !r.origin) { setCurlMsg('✗ ' + r.errors.join(' · ')); return; }

    const filled: string[] = [];
    setForm((f) => {
      const next = { ...f };
      if (r.origin) { next.base_url = r.origin; filled.push('Base URL'); }
      if (r.username) { next.username = r.username; filled.push('Username'); }
      if (r.password) { next.password = r.password; filled.push('Password'); }
      return next;
    });

    // มี path ติดมาด้วย → เสนอเป็น endpoint ใหม่ให้เลย (คนค่อยตั้ง key/ธงเอง)
    if (r.path) {
      setForm((f) => ({
        ...f,
        endpoints: [...f.endpoints, {
          ...EMPTY_ENDPOINT,
          method: r.method as CustomToolEndpoint['method'],
          path: templatizePath(r.path),
          require_jwt: r.hasBearer,
          request_type: r.requestType,
          payload: r.body || {},
        }],
      }));
      filled.push('+1 endpoint');
    }
    setCurlMsg(filled.length ? '✓ ' + tx('pageui.hook.curl.filled', 'กรอกให้แล้ว: {fields} — ตั้ง KEY กับเลือกธงเองนะ', { fields: filled.join(' · ') }) : '✗ ' + tx('pageui.hook.curl.nothing', 'ไม่มีอะไรให้กรอก'));
    setCurlMain('');
  };

  /** ระดับ endpoint: เอา method + path + body + เดาว่าใช้ JWT ไหม (ไม่แตะ base_url) */
  const applyCurlPath = (idx: number) => {
    const r = parseCurl(curlPath);
    if (r.errors.length && !r.path) { setCurlMsg('✗ ' + r.errors.join(' · ')); return; }

    setEp(idx, {
      method: r.method as CustomToolEndpoint['method'],
      path: templatizePath(r.path),
      require_jwt: r.hasBearer,
      request_type: r.requestType,
      ...(r.body ? { payload: r.body } : {}),
    });

    // เตือนถ้า origin ไม่ตรงกับ Base URL ที่ตั้งไว้ (คนละปลายทาง = ควรแยก tool)
    const warn = r.origin && form.base_url && r.origin.replace(/\/+$/, '') !== form.base_url.replace(/\/+$/, '')
      ? ` ⚠️ ${tx('pageui.hook.curl.origin_mismatch', 'origin ({origin}) ไม่ตรงกับ Base URL — ถ้าคนละปลายทางควรแยกเป็นอีก tool', { origin: r.origin })}`
      : '';
    setCurlMsg('✓ ' + tx('pageui.hook.curl.filled_line', 'กรอกเส้นที่ {n} แล้ว ({method} {path})', { n: idx + 1, method: r.method, path: r.path }) + warn);
    setCurlPath('');
    setCurlFor(null);
  };
  // ==== [FEAT-20260729-CUSTOOL] END ====

  /**
   * [FEAT-20260729-CUSTOOL] ทดสอบ "เส้นนี้" แล้วโชว์ JSON ที่ได้กลับมา
   * ใช้ config สดจากฟอร์ม (ยังไม่ต้องบันทึก) → กรอกแล้วลองได้เลย
   * ประโยชน์: เห็นโครงสร้าง response จริง → ตั้ง profile_map / sub_type ของ
   * แท็กไดนามิกได้ถูกตัว ไม่ต้องเดา
   */
  const testEndpoint = async (idx: number) => {
    const ep = form.endpoints[idx];
    if (!form.base_url.trim()) { setAlert({ title: tx('pageui.hook.test.cannot_yet', 'ยังทดสอบไม่ได้'), message: tx('pageui.hook.test.need_base_url', 'กรอก Base URL ก่อน') }); return; }
    if (!ep.key.trim() || !ep.path.trim()) { setAlert({ title: tx('pageui.hook.test.cannot_yet', 'ยังทดสอบไม่ได้'), message: tx('pageui.hook.test.need_key_path', 'กรอก KEY และ path ของเส้นนี้ก่อน') }); return; }

    setEpTesting(idx);
    setEpResult((p) => ({ ...p, [idx]: null }));
    try {
      const r = await customToolService.testDraft({ ...form, id: editingId || undefined }, ep.key);
      // หา step ของเส้นนี้ (ตัวสุดท้ายคือ endpoint ที่ขอ · ตัวแรกคือ login)
      const mine = (r.steps || []).find((st: any) => st.key === ep.key) || (r.steps || []).slice(-1)[0];
      const loginStep = (r.steps || []).find((st: any) => st.key !== ep.key);
      setEpResult((p) => ({ ...p, [idx]: { ...r, mine, loginStep } }));
    } catch (e: any) {
      setEpResult((p) => ({ ...p, [idx]: { ok: false, message: e?.message || tx('pageui.hook.test.failed', 'ทดสอบไม่สำเร็จ') } }));
    } finally {
      setEpTesting(null);
    }
  };

  const validateForm = (): string | null => {
    if (!form.name.trim()) return tx('pageui.hook.val.need_name', 'กรุณากรอกชื่อ tool');
    if (!form.base_url.trim()) return tx('pageui.hook.val.need_base_url', 'กรุณากรอก Base URL');
    const keys = form.endpoints.map((e) => e.key.trim().toUpperCase()).filter(Boolean);
    if (keys.length !== new Set(keys).size) return tx('pageui.hook.val.dup_key', 'มี key ของ endpoint ซ้ำกัน');
    if (form.endpoints.some((e) => !e.key.trim() || !e.path.trim())) {
      return tx('pageui.hook.val.need_key_path', 'endpoint ทุกเส้นต้องมี key และ path');
    }
    if (form.endpoints.filter((e) => e.is_login).length > 1) return tx('pageui.hook.val.one_login', 'เลือก "เส้น login" ได้แค่ 1 เส้น');
    if (form.endpoints.filter((e) => e.is_refresh).length > 1) return tx('pageui.hook.val.one_refresh', 'เลือก "เส้น refresh" ได้แค่ 1 เส้น');
    if (form.endpoints.filter((e) => e.is_profile).length > 1) return tx('pageui.hook.val.one_profile', 'เลือก "เส้นโปรไฟล์" ได้แค่ 1 เส้น');
    // [FEAT-20260729-EPROLE] role ซ้ำ = ระบบหยิบเส้นแรกที่เจอ อีกเส้นเงียบหาย — กันตั้งแต่ตอนเซฟ
    // ('' = ไม่ระบุ กับ 'other' ซ้ำได้ เพราะไม่ถูกใช้หาเส้น)
    {
      const roles = form.endpoints
        .filter((e) => e.status !== false)
        .map((e) => e.role || '')
        .filter((r) => r && r !== 'other');
      const dupRole = roles.find((r, i) => roles.indexOf(r) !== i);
      if (dupRole) return tx('pageui.hook.val.dup_role', 'มีเส้นที่ตั้ง "หน้าที่" ซ้ำกัน ({role}) — หน้าที่ละ 1 เส้นเท่านั้น', { role: dupRole });
    }
    if (form.auth_type === 'jwt_login' && form.endpoints.some((e) => e.require_jwt) &&
        !form.endpoints.some((e) => e.is_login)) {
      return tx('pageui.hook.val.jwt_needs_login', 'auth แบบ JWT ต้องมี 1 เส้นที่เลือก "เส้น login"');
    }
    return null;
  };

  const save = async () => {
    const err = validateForm();
    if (err) { setAlert({ title: tx('pageui.hook.val.title', 'ตรวจสอบข้อมูล'), message: err }); return; }

    // ==== [FIX-20260729-NOPROFILEFLAG] START — เตือนเมื่อ "ไม่มีเส้นโปรไฟล์"
    // 🔒 สาย AUTO — to_dev_auto เท่านั้น
    //
    // เคสจริงที่เจอ (2026-07-29): tool ตั้งครบ 5 เส้น ยิงได้ 200 ข้อมูลครบ
    // แต่ panel หน้า Ticket ขึ้น N/A ตลอด เพราะ **ไม่มีเส้นไหนติ๊ก "เส้นโปรไฟล์"**
    // → BE หาเส้นโปรไฟล์จากธงนี้ ไม่เจอก็คืน N/A ทั้งชุด (เงียบ ไล่เหตุยากมาก)
    //
    // เดิม validate ตรวจแค่ "ห้ามเกิน 1 เส้น" แต่ไม่เคยเตือนตอน "ไม่มีสักเส้น"
    // ที่นี่จงใจ **ไม่บล็อกการบันทึก** เพราะ tool ที่ใช้กับแท็กไดนามิกอย่างเดียว
    // (ไม่ต้องโชว์บน panel) ไม่จำเป็นต้องมีเส้นโปรไฟล์จริง ๆ — แค่ถามให้แน่ใจ
    // revert: ลบบล็อก START→END นี้
    const hasDataLine = form.endpoints.some(
      (e) => e.status !== false && !e.is_login && !e.is_refresh && e.purpose === 'data'
    );
    if (hasDataLine && !form.endpoints.some((e) => e.is_profile)) {
      const goOn = window.confirm(
        tx('pageui.hook.no_profile_confirm',
          'ยังไม่ได้เลือก "เส้นโปรไฟล์" สักเส้น\n\n' +
          'ผลที่จะเกิด: หน้า Ticket Support จะขึ้น "ยังไม่มีข้อมูลสมาชิกจาก API" ' +
          'และชื่อ/เบอร์/รหัส จะเป็น N/A ถึงแม้ปลายทางจะตอบข้อมูลครบก็ตาม\n\n' +
          '(ถ้าใช้ tool นี้กับแท็กไดนามิกอย่างเดียว ไม่ต้องโชว์บน panel — กดตกลงได้เลย)\n\n' +
          'บันทึกต่อไหม?')
      );
      if (!goOn) return;
    }
    // ==== [FIX-20260729-NOPROFILEFLAG] END

    setSaving(true);
    try {
      const payload: any = { ...form };
      // ไม่กรอก = ไม่แตะของเดิม (ตอนแก้ไข)
      if (editingId && !payload.password) delete payload.password;
      if (editingId && !payload.api_key) delete payload.api_key;

      // ==== [FEAT-20260808-PAYCUSTOOL] START — ส่งก้อน payment เฉพาะหมวด payment
      // WHAT: หมวด generic ตัด key `payment` ออกจาก payload ไปเลย
      // WHY : ฟอร์มเก็บค่า payment ไว้ตลอด (เผื่อคนสลับหมวดไปมาแล้วค่าไม่หาย)
      //       แต่ tool ที่ไม่ใช่หมวด payment ไม่ควรมีก้อนนี้ค้างอยู่ใน DB
      // HOW : เพิ่มหมวดใหม่ในอนาคต → เพิ่มเงื่อนไขตัด/ส่งก้อนของหมวดนั้นตรงนี้
      //
      // ⚠️ ห้ามใส่ `|| ค่า default` ให้ช่องไหนตรงนี้ โดยเฉพาะ statement_status
      //    ที่ '' = "ไม่กรองสถานะ" ซึ่งเป็นค่าที่ผู้ใช้ตั้งใจ ไม่ใช่ค่าที่ลืมกรอก
      //    ส่งขึ้นไปตรง ๆ ตามที่กรอกเท่านั้น
      // [FIX-20260810-CATFROMROLE] ส่งหมวดที่คำนวณจากหน้าที่ของเส้น ไม่ใช่ค่าที่
      // เคยเก็บไว้ใน form — BE คำนวณซ้ำเองอยู่แล้ว (deriveCategory) ตรงนี้ส่งให้
      // ตรงกันเพื่อไม่ให้ payload กับผลลัพธ์จริงต่างกัน
      payload.category = derivedCategory;
      /* [FEAT-20260815-WALLETPAYCAT] walletpay ก็ถือ payment block เหมือนกัน —
         มันคือที่อยู่ของ walletpay_ref_id_field / walletpay_file_field /
         statement_status ที่ขา walletpay อ่านจริง · ถ้าลบทิ้งที่นี่ ค่าที่แอดมิน
         เพิ่งตั้งจะหายทั้งก้อนตอนกดบันทึก (BE ก็รับทั้งสองหมวดแล้วเช่นกัน —
         `CATEGORIES_WITH_PAYMENT_BLOCK`) */
      if (payload.category !== 'payment' && payload.category !== 'walletpay') {
        delete payload.payment;
      } else {
        // แถวในตารางแปลงค่าที่ยังไม่ได้ตั้งชื่อ field = แถวที่กดเพิ่มไว้แต่ยังไม่ได้กรอก
        // → ตัดทิ้งตอนบันทึก ไม่ให้ key ว่างหลุดขึ้นไปที่ BE
        const cleanedMap: Record<string, string> = {};
        Object.entries(form.payment.topup_to_walletpay_map).forEach(([k, v]) => {
          if (String(k).trim()) cleanedMap[String(k).trim()] = String(v ?? '');
        });
        payload.payment = { ...form.payment, topup_to_walletpay_map: cleanedMap };
      }
      // ==== [FEAT-20260808-PAYCUSTOOL] END

      let toolId = editingId;
      if (editingId) {
        await customToolService.updateCustomTool(editingId, payload);
      } else {
        const created = await customToolService.createCustomTool(payload);
        toolId = created.id;
      }

      // [FEAT-20260729-CUSTOOL] ลิงก์ OA ที่เลือกไว้ในฟอร์ม (เขียนที่ hook.custom_tool_id)
      // ทำหลังเซฟ tool เพราะตอน create ต้องรู้ id ก่อน
      // activate=true → เปิดสวิตช์ custom tool ให้ OA ที่เลือกใหม่เลย
      if (toolId) {
        try {
          await customToolService.assignOAs(toolId, formHooks, true);
        } catch (e: any) {
          // เซฟ tool สำเร็จแล้ว แค่ลิงก์ OA ไม่ผ่าน → บอกให้ชัด ไม่กลืนเงียบ
          setAlert({ title: tx('pageui.hook.save.oa_link_failed', 'บันทึก tool แล้ว แต่ลิงก์ OA ไม่สำเร็จ'), message: e?.message || tx('pageui.hook.save.oa_link_retry', 'ลองลิงก์ใหม่จากปุ่มลิงก์ในตาราง') });
        }
      }

      setShowForm(false);
      // [FEAT-20260729-CUSTOOLUX] เดิมสำเร็จแล้วเงียบ — ปิด modal เฉย ๆ ไม่รู้ว่าติดไหม
      notify(true, editingId ? tx('pageui.hook.save.saved', 'บันทึก "{name}" แล้ว', { name: form.name }) : tx('pageui.hook.save.created', 'สร้าง "{name}" แล้ว', { name: form.name }));
      await load();
    } catch (e: any) {
      setAlert({ title: tx('pageui.hook.save.failed', 'บันทึกไม่สำเร็จ'), message: e?.message || tx('pageui.hook.error_generic', 'เกิดข้อผิดพลาด') });
      notify(false, tx('pageui.hook.save.failed', 'บันทึกไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const name = confirmDelete.name;
    try {
      await customToolService.deleteCustomTool(confirmDelete.id);
      setConfirmDelete(null);
      notify(true, tx('pageui.hook.delete.done', 'ลบ "{name}" แล้ว', { name }));
      await load();
    } catch (e: any) {
      setConfirmDelete(null);
      setAlert({ title: tx('pageui.hook.delete.failed', 'ลบไม่สำเร็จ'), message: e?.message || tx('pageui.hook.delete.in_use', 'ยังมี OA ใช้ tool นี้อยู่') });
      notify(false, tx('pageui.hook.delete.failed', 'ลบไม่สำเร็จ'));
    }
  };

  const runTest = async (t: CustomToolEntry) => {
    setTesting(t.id);
    setTestResult(null);
    try {
      const profileEp = t.endpoints.find((e) => e.is_profile);
      const r = await customToolService.testCustomTool(t.id, profileEp?.key);
      setTestResult({ tool: t.name, ...r });
    } catch (e: any) {
      setTestResult({ tool: t.name, ok: false, message: e?.message || tx('pageui.hook.test.failed_short', 'เทสไม่สำเร็จ') });
    } finally {
      setTesting(null);
    }
  };

  const openAssign = async (t: CustomToolEntry) => {
    const usage = await customToolService.getUsage(t.id);
    setPickedHooks(usage.hooks.map((h) => h._id));
    setAssignFor(t);
  };

  const saveAssign = async () => {
    if (!assignFor) return;
    setAssignSaving(true);
    try {
      await customToolService.assignOAs(assignFor.id, pickedHooks, true);
      const n = pickedHooks.length;
      setAssignFor(null);
      notify(true, n > 0 ? tx('pageui.hook.assign.linked', 'ลิงก์ {n} OA กับ "{name}" แล้ว', { n, name: assignFor.name }) : tx('pageui.hook.assign.unlinked_all', 'ยกเลิกการลิงก์ OA ทั้งหมดแล้ว'));
      await load();
    } catch (e: any) {
      setAlert({ title: tx('pageui.hook.save.failed', 'บันทึกไม่สำเร็จ'), message: e?.message || tx('pageui.hook.error_generic', 'เกิดข้อผิดพลาด') });
      notify(false, tx('pageui.hook.assign.failed', 'ลิงก์ OA ไม่สำเร็จ'));
    } finally {
      setAssignSaving(false);
    }
  };

  const filtered = useMemo(() => items, [items]);

  return (
    <div className="p-6 space-y-6">
      {/* ── header card (theme เดียวกับ Handoff History / Webhook Logs) ── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-dark-800 border border-dark-700 rounded-xl px-4 py-4 shadow-lg shadow-black/20">
        <div className="flex items-center gap-2">
          <Wrench className="text-indigo-600" size={22} />
          <div>
            <p className="text-sm text-slate-500">3rd-party API · credential</p>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold text-slate-900">Custom Tools</h3>
              <button type="button" onClick={() => setShowHelp(true)} title={tx('pageui.hook.help_btn_title', 'นี่คืออะไร ใช้ยังไง')}
                className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs font-black hover:bg-indigo-600 hover:text-white transition-colors">?</button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tx('pageui.hook.search_ph', 'ค้นหาชื่อ / URL')}
              className="pl-9 pr-3 py-2 text-sm rounded-lg border border-dark-600 bg-dark-800 text-slate-900 w-56 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button onClick={load} className="p-2 border border-dark-600 bg-dark-800 rounded-lg hover:bg-dark-700 text-slate-600">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700"
          >
            <Plus size={16} /> {tx('pageui.hook.create_btn', 'สร้าง Tool')}
          </button>
        </div>
      </div>

      <ToolMintBar existingNames={items.map((t) => t.name)} onPrefill={openCreateFromPreset} onMinted={load} />

      {/* ── table ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-bold">{tx('pageui.hook.col.name', 'ชื่อ')}</th>
                <th className="text-left px-4 py-3 font-bold">{tx('pageui.hook.col.destination', 'ปลายทาง')}</th>
                <th className="text-left px-4 py-3 font-bold">Auth</th>
                {/* [FEAT-20260729-CUSTOOL] หัวคอลัมน์: "เส้น" -> "path" (คำเดียวกับที่ใช้ในฟอร์ม) */}
                <th className="text-center px-4 py-3 font-bold">path</th>
                <th className="text-center px-4 py-3 font-bold">{tx('pageui.hook.col.oa_using', 'OA ที่ใช้')}</th>
                <th className="text-center px-4 py-3 font-bold">{tx('pageui.hook.col.status', 'สถานะ')}</th>
                <th className="text-right px-4 py-3 font-bold">{tx('pageui.hook.col.manage', 'จัดการ')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 className="animate-spin inline mr-2" size={16} /> {tx('pageui.hook.loading', 'กำลังโหลด…')}
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {tx('pageui.hook.empty', 'ยังไม่มี tool — กด "สร้าง Tool" เพื่อเริ่ม')}
                </td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">{t.name}</span>
                      {/* [FEAT-20260808-PAYCUSTOOL] ป้ายหมวด — ติดเฉพาะ tool สายตรวจสลิป
                          tool generic ไม่ต้องมีป้าย เพื่อให้ตารางหน้าตาเหมือนเดิมสำหรับคนที่ไม่ใช้ฟีเจอร์นี้ */}
                      {/* [FEAT-20260815-WALLETPAYCAT] walletpay ได้ป้ายของตัวเอง คนละสี
                          เพื่อให้เห็นจากตารางได้ทันทีว่า tool ไหนทำหน้าที่อะไร */}
                      {t.category === 'payment' && (
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-black bg-emerald-100 text-emerald-700">
                          payment
                        </span>
                      )}
                      {t.category === 'walletpay' && (
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-black bg-indigo-100 text-indigo-700">
                          walletpay
                        </span>
                      )}
                    </div>
                    {t.description && <div className="text-xs text-slate-400">{t.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 font-mono max-w-[240px] truncate">{t.base_url}</td>
                  <td className="px-4 py-3 text-xs">{t.auth_type}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-bold">{t.endpoints.length}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => openAssign(t)}
                      className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 rounded text-xs font-bold hover:bg-indigo-100"
                    >
                      {usageMap[t.id] ?? 0} OA
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.status ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                      {t.status ? tx('pageui.hook.status_on', 'เปิด') : tx('pageui.hook.status_off', 'ปิด')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <BindTagsButton toolId={t.id} />
                      <button onClick={() => runTest(t)} disabled={testing === t.id}
                        title={tx('pageui.hook.row.test_title', 'ทดสอบการเชื่อมต่อ (ยิงจริง)')}
                        className="p-1.5 rounded hover:bg-emerald-50 text-emerald-600">
                        {testing === t.id ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
                      </button>
                      <button onClick={() => openAssign(t)} title={tx('pageui.hook.row.link_oa', 'ลิงก์ OA')}
                        className="p-1.5 rounded hover:bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"><Link2 size={15} /></button>
                      <button onClick={() => openEdit(t)} title={tx('pageui.hook.row.edit', 'แก้ไข')}
                        className="p-1.5 rounded hover:bg-sky-50 text-sky-600"><Edit2 size={15} /></button>
                      <button onClick={() => setConfirmDelete(t)} title={tx('pageui.hook.row.delete', 'ลบ')}
                        className="p-1.5 rounded hover:bg-rose-50 text-rose-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ==== [FEAT-20260729-CUSTOOLUX] แถบแบ่งหน้า — เดิมดึงมา 100 ตัวรวดเดียว
             แล้วไม่มีตัวแบ่งหน้าเลย tool ตัวที่ 101 ขึ้นไปจะหายเงียบ ๆ
             BE รองรับ page/limit อยู่แล้ว แค่ FE ไม่เคยส่งไป */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 text-[13px]">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <span>{tx('pageui.hook.pager.show', 'แสดง')}</span>
            <select
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
              className="px-2 py-1 border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800 font-bold"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>{tx('pageui.hook.pager.per_page', 'ต่อหน้า')}</span>
            <span className="ml-2">
              {total === 0 ? tx('pageui.hook.pager.none', 'ไม่มีรายการ') : tx('pageui.hook.pager.total', 'ทั้งหมด {n} รายการ', { n: total })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-600 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {tx('pageui.hook.pager.prev', 'ก่อนหน้า')}
            </button>
            <span className="text-slate-500 dark:text-slate-400">{tx('pageui.hook.pager.page_of', 'หน้า {page} / {total}', { page, total: totalPages })}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1 rounded border border-slate-200 dark:border-slate-600 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {tx('pageui.hook.pager.next', 'ถัดไป')}
            </button>
          </div>
        </div>
      </div>

      {/* ==== [FEAT-20260729-CUSTOOLUX] toast — บอกผลแล้วหายเอง
           สำเร็จ 2.6 วิ · พลาด 4.2 วิ (ให้เวลาอ่านนานกว่า) */}
      {toast && (
        <div
          className={`fixed top-24 left-1/2 -translate-x-1/2 z-[120] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200 ${
            toast.ok
              ? 'bg-emerald-600 border-emerald-400/30 text-white'
              : 'bg-rose-600 border-rose-400/30 text-white'
          }`}
        >
          {toast.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          <span className="text-sm font-bold">{toast.message}</span>
        </div>
      )}

      {/* ── ผลการเทส ── */}
      {testResult && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              {testResult.ok ? <CheckCircle2 className="text-emerald-600" size={18} /> : <XCircle className="text-rose-600" size={18} />}
              {tx('pageui.hook.test.result_title', 'ผลการทดสอบ:')} {testResult.tool}
            </h3>
            <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
          </div>
          {testResult.message && <p className="text-sm text-slate-600 mb-2">{testResult.message}</p>}
          <div className="space-y-1">
            {(testResult.steps || []).map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono bg-slate-50 rounded px-2 py-1.5">
                {s.ok ? <CheckCircle2 className="text-emerald-600 shrink-0" size={14} /> : <XCircle className="text-rose-600 shrink-0" size={14} />}
                <span className="font-bold">{s.key}</span>
                <span className="text-slate-400">{s.method}</span>
                <span className="text-slate-500 truncate flex-1">{s.url}</span>
                <span className="text-slate-400">{s.status} · {s.duration_ms}ms</span>
                {!s.ok && <span className="text-rose-600">{s.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ฟอร์ม tool ──
          [FEAT-20260729-CUSTOOL] z-[80]: navbar (App.tsx sticky z-50) เคยทับหัว modal
          เพราะ z เท่ากันแล้ว navbar มาทีหลังใน DOM — ยกเหนือตามมาตรฐาน HookFormModal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-[80] flex items-start justify-center overflow-y-auto p-6">
          {/* [FEAT-20260729-CUSTOOL] กว้างขึ้น 35% (896px -> 1210px) ตารางเส้นจะได้ไม่อึดอัด */}
            <div className="bg-white rounded-2xl w-full max-w-[1210px] my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-black text-slate-800">{editingId ? tx('pageui.hook.form.edit_title', 'แก้ไข Custom Tool') : tx('pageui.hook.form.create_title', 'สร้าง Custom Tool')}</h2>
              <div className="flex items-center gap-2">
                {/* ==== [FEAT-20260801-SHOPAPITEMPLATE] START
                     ผู้ใช้สั่ง "ซ่อนปุ่ม demo / demo v4 · เพิ่มใช้ข้อมูล template ใส่ข้อมูล shop-api ให้เลย"
                     ⚠️ **ซ่อน ไม่ได้ลบ** — demoForm()/demoFormV4() ยังอยู่ครบในไฟล์
                        เอากลับมาใช้เมื่อไหร่ก็แค่เปิด block ที่ซ่อนไว้ด้านล่าง
                        (ตัว demo-api ฝั่ง BE ก็ยังอยู่เหมือนเดิม ไม่ได้แตะ)
                     revert: เปลี่ยน SHOW_DEMO_PRESETS เป็น true แล้วลบปุ่ม Shop-API */}
                {SHOW_DEMO_PRESETS && (
                <>
                <button type="button"
                  onClick={() => {
                    if (editingId && !window.confirm(tx('pageui.hook.tpl.confirm_demo', 'ทับค่าทั้งหมดด้วยชุด demo ใช่ไหม? (ของเดิมจะหาย)'))) return;
                    setForm(demoForm());
                    setCurlMsg('✓ ' + tx('pageui.hook.tpl.done_demo', 'ใส่ค่า demo ครบแล้ว — กดทดสอบรายเส้นดูได้เลย'));
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-400/40 rounded-lg hover:bg-indigo-100">
                  {tx('pageui.hook.tpl.btn_demo', 'ใช้ค่า demo (ครบพร้อมใช้)')}
                </button>
                <button type="button"
                  onClick={() => {
                    if (editingId && !window.confirm(tx('pageui.hook.tpl.confirm_demo_v4', 'ทับค่าทั้งหมดด้วยชุด demo v4 ใช่ไหม? (ของเดิมจะหาย)'))) return;
                    setForm(demoFormV4());
                    setCurlMsg('✓ ' + tx('pageui.hook.tpl.done_demo_v4', 'ใส่ค่า demo v4 แล้ว — ชุดนี้ปลายทางตอบคนละรูปแบบ ดู "หน้าที่" + "กฎอ่านผล" ของแต่ละเส้นได้เลย'));
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100">
                  {tx('pageui.hook.tpl.btn_demo_v4', 'ใช้ค่า demo (v4 ภาษาต่าง)')}
                </button>
                </>
                )}
                {/* ชุดค่า Shop-API ตัวจริง — กดแล้วได้ครบทุกช่อง เหลือแค่วาง Secret Key */}
                <button type="button"
                  onClick={() => {
                    if (editingId && !window.confirm(tx('pageui.hook.tpl.confirm_shopapi', 'ทับค่าทั้งหมดด้วย template Shop-API ใช่ไหม? (ของเดิมจะหาย)'))) return;
                    setForm(shopapiForm());
                    setCurlMsg('✓ ' + tx('pageui.hook.tpl.done_shopapi', 'ใส่ template Shop-API แล้ว — เหลือวาง Secret Key ช่องเดียว แล้วกดทดสอบรายเส้นได้เลย'));
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/40 rounded-lg hover:bg-emerald-100">
                  {tx('pageui.hook.tpl.btn_shopapi', 'ใช้ข้อมูล template (Shop-API)')}
                </button>
                {/* ==== [FEAT-20260801-SHOPAPITEMPLATE] END */}
                {/* ==== [FEAT-20260809-WALLETPAYTEMPLATE] START
                     ปุ่ม template ของ walletpay — **คนละ tool กับ Shop-API**
                     WHY แยก: walletpay อยู่คนละ host และ tool หนึ่งตัวมี base_url ได้ค่าเดียว
                     (BE: url = base_url + '/' + path) จึงยัดรวมกับ Shop-API ไม่ได้
                     แนวคิดเดียวกับปุ่ม Shop-API: กดแล้วได้ครบ เหลือแค่ตรวจ host ให้ตรงของจริง
                     revert: ลบปุ่มนี้ + walletpayForm() */}
                <button type="button"
                  onClick={() => {
                    if (editingId && !window.confirm(tx('pageui.hook.tpl.confirm_walletpay', 'ทับค่าทั้งหมดด้วย template walletpay ใช่ไหม? (ของเดิมจะหาย)'))) return;
                    setForm(walletpayForm());
                    setCurlMsg('✓ ' + tx('pageui.hook.tpl.done_walletpay', 'ใส่ template walletpay แล้ว — ตรวจ host ให้ตรงของจริง แล้วผูก tool นี้ที่หน้า OA (ช่อง walletpay)'));
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/15 border border-sky-200 dark:border-sky-400/40 rounded-lg hover:bg-sky-100">
                  {tx('pageui.hook.tpl.btn_walletpay', 'ใช้ข้อมูล template (walletpay)')}
                </button>
                {/* ==== [FEAT-20260809-WALLETPAYTEMPLATE] END */}
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
              </div>
            </div>

            <div className="p-6 space-y-5 max-h-[76vh] overflow-y-auto">
              {/* ==== [FEAT-20260729-CUSTOOL] วาง cURL แล้วกรอกให้อัตโนมัติ ==== */}
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-400/40 bg-indigo-50 dark:bg-indigo-500/15/50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <ClipboardPaste size={15} className="text-indigo-600 dark:text-indigo-300" />
                  <span className="text-sm font-black text-indigo-800">{tx('pageui.hook.curl.box_title', 'วาง cURL จาก Postman (ไม่บังคับ)')}</span>
                </div>
                <div className="flex gap-2">
                  <textarea
                    value={curlMain}
                    onChange={(e) => setCurlMain(e.target.value)}
                    rows={2}
                    placeholder={"curl --location 'https://api.example.com/shop-api/v3/customer?line_user_id=U123' \\\n--header 'Authorization: Bearer ...'"}
                    className="flex-1 px-2 py-1.5 text-[13px] font-mono border border-indigo-200 dark:border-indigo-400/40 rounded resize-y"
                  />
                  <button type="button" onClick={applyCurlMain} disabled={!curlMain.trim()}
                    className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-40 whitespace-nowrap self-start">
                    {tx('pageui.hook.curl.fill_btn', 'กรอกให้')}
                  </button>
                </div>
                <p className="mt-1.5 text-[13px] text-indigo-900/70">
                  {tx('pageui.hook.curl.gets', 'ได้:')} <b>Base URL</b> · <b>Username/Password</b> {tx('pageui.hook.curl.gets_rest', '(ถ้าเป็นเส้น login) · เพิ่ม endpoint ให้ 1 เส้นถ้ามี path · ค่า')}{' '}
                  <code>line_user_id</code>/<code>web_code</code> {tx('pageui.hook.curl.gets_tags', 'จะถูกแปลงเป็น')} <code>{'{{...}}'}</code> {tx('pageui.hook.curl.gets_auto', 'ให้อัตโนมัติ ·')}
                  <b>{tx('pageui.hook.curl.gets_manual', 'KEY กับธง login/profile ต้องตั้งเอง')}</b>
                </p>
                {curlMsg && (
                  <p className={`mt-1.5 text-[13px] font-bold ${curlMsg.startsWith('✓') ? 'text-emerald-700' : 'text-rose-600'}`}>{curlMsg}</p>
                )}
              </div>

              {/* ข้อมูลหลัก */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">{tx('pageui.hook.form.name_label', 'ชื่อ Tool *')}</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={tx('pageui.hook.form.name_ph', 'เช่น Shop-API dev (v3)')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">{tx('pageui.hook.form.desc_label', 'คำอธิบาย')}</label>
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>

              {/* ==== [FIX-20260810-CATFROMROLE] หมวดคำนวณจาก "หน้าที่" ของเส้น ====
                   WHAT: เดิมเป็น dropdown ให้เลือกเอง ตอนนี้เป็นป้ายแสดงผลอย่างเดียว
                         มีเส้นหน้าที่ pay_topup/pay_walletpay ⇒ payment · ไม่มี ⇒ generic
                   WHY : dropdown "หน้าที่ KEY" ให้เลือก pay_topup ได้ทุก tool อยู่แล้ว
                         แต่ตัวรันเช็คที่ category (payment-runner.service.ts:532)
                         ⇒ เลือกหน้าที่แล้วลืมสลับหมวด = เส้นนั้นเงียบ ไม่มี error
                         สองช่องบอกเรื่องเดียวกันแล้วขัดกันเองได้ ⇒ เหลือแหล่งเดียว
                   ⚠️ BE คำนวณซ้ำเองตอนบันทึก (deriveCategory) — ตรงนี้เป็นแค่การ
                      แสดงผลให้ตรงกัน ไม่ใช่ตัวตัดสิน ต่อให้ยิง API ตรงก็ได้ค่าเดียวกัน
                   revert: เอา SearchableSelect + CATEGORY_OPTIONS กลับมา แล้วให้
                      submit ส่ง form.category ขึ้นไปเหมือนเดิม */}
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1">{tx('pageui.hook.form.category_label', 'หมวดของ Tool')}</label>
                <div className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-600">
                  {/* [FEAT-20260815-WALLETPAYCAT] walletpay แยกป้ายของตัวเอง เพราะมันผูก
                      กับ hook คนละช่อง (`walletpay_tool_id`) กับ payment
                      (`payment_tool_id`) · ป้ายเดียวกันทำให้แยกไม่ออกว่าตัวไหน
                      ทำหน้าที่อะไร ซึ่งเป็นที่มาของเคส OA หลุดเมื่อ 15/08 */}
                  {derivedCategory === 'payment'
                    ? tx('pageui.hook.form.cat_payment', 'payment — ตรวจสลิป / เติมเงิน (topup)')
                    : derivedCategory === 'walletpay'
                      ? tx('pageui.hook.form.cat_walletpay', 'walletpay — ส่งสลิปเข้า payin (ขาสำรอง)')
                      : tx('pageui.hook.form.cat_generic', 'generic — tool ทั่วไป (แบบเดิม)')}
                </div>
                <p className="text-[13px] text-slate-400 mt-1">
                  {/* [FIX-20260815-WALLETPAYBLOCKHIDDEN] walletpay เคยตกลงไปที่ประโยค else
                      (“tool ทั่วไป — ตั้งหน้าที่เส้นเป็น … หมวดจะเปลี่ยนเป็น payment ให้เอง”)
                      ซึ่งอ่านแล้วขัดกับความจริง: หมวดถูกตั้งอัตโนมัติไปแล้วจาก `pay_walletpay`
                      พอบอกว่าเป็น tool ทั่วไป แอดมินจะนึกว่ายังตั้งไม่สำเร็จ ⇒ แยกเคสให้ตรง */}
                  {derivedCategory === 'payment' ? (
                    <>
                      <b className="text-emerald-700">{tx('pageui.hook.form.cat_auto', 'หมวดตั้งอัตโนมัติ')}</b> {tx('pageui.hook.form.cat_because', '— เพราะมีเส้นหน้าที่')} <code>pay_topup</code>/<code>pay_walletpay</code> {tx('pageui.hook.form.cat_pay_rest', 'อยู่ · เส้นอื่น (โปรไฟล์ / ผูกบัญชี / กฏร้าน)')} <b>{tx('pageui.hook.form.cat_pay_same', 'ยังทำงานเหมือนเดิมทุกอย่าง')}</b>
                    </>
                  ) : derivedCategory === 'walletpay' ? (
                    <>
                      <b className="text-indigo-700">{tx('pageui.hook.form.cat_auto', 'หมวดตั้งอัตโนมัติ')}</b> {tx('pageui.hook.form.cat_because', '— เพราะมีเส้นหน้าที่')} <code>pay_walletpay</code> {tx('pageui.hook.form.cat_but_no', 'แต่ไม่มี')} <code>pay_topup</code>
                      {tx('pageui.hook.form.cat_wp_bind', '· ผูกกับ hook คนละช่องกับ payment (')}<code>walletpay_tool_id</code>{tx('pageui.hook.form.cat_wp_share', ') จึงถือ OA ร่วมกันได้')}
                    </>
                  ) : (
                    <>{tx('pageui.hook.form.cat_generic_a', 'tool ทั่วไป — ตั้งหน้าที่เส้นเป็น')} <code>pay_topup</code> {tx('pageui.hook.form.cat_generic_or', 'หรือ')} <code>pay_walletpay</code> {tx('pageui.hook.form.cat_generic_b', 'เมื่อไหร่ หมวดจะเปลี่ยนเป็น payment ให้เอง')}</>
                  )}
                </p>
              </div>
              {/* ==== [FIX-20260810-CATFROMROLE] END */}

              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1">Base URL *</label>
                <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  placeholder={tx('pageui.hook.form.base_url_ph', 'https://api.example.com  (ไม่ต้องมี / ปิดท้าย)')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                {/* [FEAT-20260729-CUSTOOL] บอกกติกา / ให้ชัด กันกรอกแล้วได้ // หรือขาด / */}
                <p className="text-[13px] text-slate-400 mt-1">
                  {tx('pageui.hook.form.base_url_hint_a', 'path ของแต่ละเส้นจะต่อท้าย URL นี้ · ระบบใส่')} <code>/</code> {tx('pageui.hook.form.base_url_hint_b', 'คั่นให้เอง')}
                  {form.base_url.endsWith('/') && (
                    <span className="text-amber-600 font-bold"> · {tx('pageui.hook.form.base_url_trailing', 'มี / ปิดท้าย — ระบบตัดให้ ไม่ต้องกังวล')}</span>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">Auth</label>
                  {/* [FEAT-20260806-SEARCHSELECT] searchable dropdown */}
                  <SearchableSelect value={form.auth_type} onChange={(v) => setForm({ ...form, auth_type: v as any })}
                    options={[
                      { value: 'jwt_login', label: tx('pageui.hook.auth.jwt_login', 'JWT (login ก่อน)') },
                      { value: 'api_key', label: 'API Key' },
                      { value: 'basic', label: 'Basic' },
                      { value: 'hmac_signature', label: tx('pageui.hook.auth.hmac', 'ลายเซ็น HMAC (ไม่มี login)') },
                      { value: 'none', label: tx('pageui.hook.auth.none', 'ไม่มี') },
                    ]} />
                </div>
                {/* [FEAT-20260731-HMACAUTH] auth แบบลายเซ็น **ไม่ใช้ username/password เลย**
                    ซ่อนไว้เพื่อไม่ให้เข้าใจผิดว่าต้องกรอก — auth แบบอื่นยังเห็นเหมือนเดิมทุกตัว
                    (ค่าใน state ไม่ถูกล้าง สลับ auth กลับไปกลับมาข้อมูลไม่หาย)
                    revert: เอา 2 ก้อนนี้ออกจากเงื่อนไข ให้โชว์ตลอดเหมือนเดิม */}
                {form.auth_type !== 'hmac_signature' && (
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">Username</label>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                )}
                {form.auth_type !== 'hmac_signature' && (
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">
                    Password {editingId && <span className="text-slate-400 font-normal">{tx('pageui.hook.form.keep_blank', '(เว้น = ไม่เปลี่ยน)')}</span>}
                  </label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                )}
                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1">Timeout (ms)</label>
                  <input type="number" value={form.timeout_ms}
                    onChange={(e) => setForm({ ...form, timeout_ms: Number(e.target.value) || 8000 })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>

              {form.auth_type === 'api_key' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">
                      API Key {editingId && <span className="text-slate-400 font-normal">{tx('pageui.hook.form.keep_blank', '(เว้น = ไม่เปลี่ยน)')}</span>}
                    </label>
                    <input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">Header</label>
                    <input value={form.api_key_header} onChange={(e) => setForm({ ...form, api_key_header: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                  </div>
                </div>
              )}

              {/* ==== [FEAT-20260731-HMACAUTH] START — ช่องกรอก Secret Key
                   ใช้ช่อง `api_key` ตัวเดียวกับ auth แบบ API Key เพราะ BE เข้ารหัส
                   ช่องนั้นตอนบันทึกอยู่แล้ว และมีกติกา "เว้น = ไม่เปลี่ยน" ครบแล้ว
                   **ไม่โชว์ช่อง Header** เพราะ HMAC กำหนด header เองจากสูตร
                   revert: ลบ block นี้ทั้งก้อน */}
              {form.auth_type === 'hmac_signature' && (
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-1">
                      Secret Key {editingId && <span className="text-slate-400 font-normal">{tx('pageui.hook.form.keep_blank', '(เว้น = ไม่เปลี่ยน)')}</span>}
                    </label>
                    <input type="password" autoComplete="new-password"
                      value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                      placeholder={tx('pageui.hook.hmac.secret_ph', 'วาง shared secret ของปลายทาง')}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
                  </div>
                  <p className="text-[13px] text-slate-500 leading-relaxed">
                    {tx('pageui.hook.hmac.signs', 'ระบบเซ็นทุก request ให้เอง — แนบ')} <code className="font-mono">X-Timestamp</code> +{' '}
                    <code className="font-mono">X-Signature</code> · <b>{tx('pageui.hook.hmac.no_user_pass', 'ไม่ต้องกรอก username/password')}</b> ·{' '}
                    <code className="font-mono">web_code</code> {tx('pageui.hook.hmac.web_code_from', 'อ่านจาก query/body ที่ส่งอยู่แล้ว')}
                    <br />
                    {tx('pageui.hook.hmac.formula', 'สูตรเริ่มต้น:')} <code className="font-mono">HMAC-SHA256(secret, web_code + timestamp + payload)</code> {tx('pageui.hook.hmac.formula_rest', '→ hex · timestamp เป็นวินาที · เซ็นบน JSON ที่เรียง key แล้ว')}
                    <br />
                    <span className="text-amber-600 dark:text-amber-400">
                      {tx('pageui.hook.hmac.clock_warn', '⚠️ ปลายทางยอมให้เวลาคลาดได้ ±5 นาที — ถ้าเครื่องเซิร์ฟเวอร์เวลาเพี้ยนจะได้ 401 ทุกครั้ง')}
                    </span>
                  </p>
                </div>
              )}
              {/* ==== [FEAT-20260731-HMACAUTH] END */}

              {/* ==== [FEAT-20260808-PAYCUSTOOL] START — ส่วนตั้งค่าหมวด payment
                   โผล่เฉพาะตอนเลือกหมวด payment · หมวด generic ไม่เห็นอะไรเลย (ฟอร์มเดิมเป๊ะ)

                   WHERE TO EDIT WHAT (แผนที่ของส่วนนี้)
                   ├─ กลุ่ม 1 "การเชื่อมต่อ & การจับคู่" → แก้รายการช่องที่ PAYMENT_CONNECTION_FIELDS
                   ├─ กลุ่ม 2 "ตารางแปลงค่าไป walletpay"  → topup_to_walletpay_map (ตัวแก้แบบแถว key/value)
                   └─ กลุ่ม 3 "ข้อความตอบลูกค้า"        → แก้รายการช่องที่ PAYMENT_REPLY_FIELDS

                   ⚠️ ชื่อ key ทุกตัวต้องตรงกับสัญญาฝั่ง BE — key ที่ BE ไม่รู้จักจะถูกตัดทิ้ง
                      เงียบ ๆ ตอนบันทึก (ไม่มี error) ค่าที่กรอกจะหายไปเฉย ๆ */}
              {/* [FIX-20260815-WALLETPAYBLOCKHIDDEN] เดิมเช็ค `=== 'payment'` ล้วน ⇒ พอเพิ่ม
                  หมวดที่สาม (walletpay) ทั้งบล็อกนี้หายไปจากฟอร์ม: แอดมินเปลี่ยนหมวดเป็น walletpay
                  แล้วเมนู "ตั้งค่าการตรวจสลิป" ก็หายทั้งก้อน (เจ้าของแจ้ง 15/08/2026 — "menu
                  หน้าตั้งค่าการตรวจสอบของ walletpay หาย")

                  นี่เป็น regression ของงานเพิ่มหมวด walletpay เอง ไม่ใช่ของเดิม — จุดอื่นถูกอัปเป็น
                  สามหมวดหมดแล้ว (`derivedCategory`, badge, payload guard ที่ :1027 ซึ่งเก็บ
                  `payload.payment` ไว้ให้ walletpay ด้วย) เหลือเงื่อนไขแสดงผลตรงนี้ที่ตกหล่น
                  ⇒ ฟอร์มซ่อนช่องที่ตัว guard ตั้งใจจะส่ง = ตั้งค่าไม่ได้ทั้งที่ระบบรองรับ

                  ทำไมต้องโผล่ทั้งสองหมวด: ช่องในบล็อกนี้ (statement_*, walletpay_ref_id_field,
                  walletpay_file_field) เป็น "ที่อยู่" ของค่าที่ขา walletpay ใช้ — ฝั่ง BE ก็รับทั้ง
                  สองหมวดผ่าน `CATEGORIES_WITH_PAYMENT_BLOCK` แล้ว FE จึงต้องแสดงให้ตรงกัน

                  ⚠️ ข้อเท็จจริงที่ต้องรู้ก่อนแก้ต่อ (ตรวจจาก DB จริง 15/08/2026): ตอน RUNTIME
                  ค่าเหล่านี้ถูกอ่านจาก **payment tool** เท่านั้น —
                  `payment-runner.service.ts:1062` เรียก `readCfg(tool)` โดย `tool` คือ payment
                  tool ส่วน walletpay tool ให้แค่ base_url + endpoint ⇒ ค่าที่กรอกในหน้าของ tool
                  หมวด walletpay จะถูกบันทึกลง DB จริง แต่ยังไม่มีใครอ่าน. เปิดให้เห็นตรงนี้เพื่อ
                  ไม่ให้ฟอร์มขัดกับ guard — ไม่ใช่การเปลี่ยนว่า BE อ่านจากไหน (ห้ามแก้ money path)

                  revert: เปลี่ยนกลับเป็น `derivedCategory === 'payment'` แล้วหมวด walletpay จะซ่อน
                  บล็อกนี้อีกครั้ง (ค่าที่เคยบันทึกไว้ยังอยู่ใน DB ไม่ถูกลบ) */}
              {(derivedCategory === 'payment' || derivedCategory === 'walletpay') && (
                <div className="border-t border-slate-200 pt-4 space-y-4">
                  {/* [FEAT-20260816-WALLETPAYFOLD] walletpay: header becomes a fold toggle.
                      payment: header unchanged, block always visible (ห้ามพัง). */}
                  <div>
                    {derivedCategory === 'walletpay' ? (
                      <button
                        type="button"
                        onClick={() => setShowWalletpayPayBlock((v) => !v)}
                        className="w-full text-left group"
                      >
                        <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                          <span className={`transition-transform ${showWalletpayPayBlock ? 'rotate-90' : ''}`}>▸</span>
                          {tx('pageui.hook.pay.title', 'ตั้งค่าการตรวจสลิป (หมวด {cat})', { cat: derivedCategory })}
                          <span className="text-[11px] font-normal px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                            {tx('pageui.hook.pay.folded', 'พับไว้ — tool หมวด walletpay ไม่ได้ใช้ค่าชุดนี้ตอน runtime')}
                          </span>
                        </h3>
                        <p className="text-[13px] text-slate-400">
                          {tx('pageui.hook.pay.folded_note', 'ระบบอ่านค่าชุดนี้จาก payment tool (Shop-API) เท่านั้น · ค่าที่เคยบันทึกไว้ยังอยู่ครบ · คลิกเพื่อ')}{showWalletpayPayBlock ? tx('pageui.hook.pay.fold', 'พับเก็บ') : tx('pageui.hook.pay.unfold', 'เปิดดู/แก้')}
                        </p>
                      </button>
                    ) : (
                      <>
                        <h3 className="font-bold text-slate-800 text-base">
                          {tx('pageui.hook.pay.title', 'ตั้งค่าการตรวจสลิป (หมวด {cat})', { cat: derivedCategory })}
                        </h3>
                        <p className="text-[13px] text-slate-400">
                          {tx('pageui.hook.pay.intro', 'บอกระบบว่า “ข้อมูลอยู่ตรงไหน” และ “จะตอบลูกค้าว่าอะไร” ในแต่ละสถานการณ์ · ทุกช่องมีค่าเริ่มต้นให้แล้ว ถ้าปลายทางเป็นแบบมาตรฐานแทบไม่ต้องแก้อะไรเลย')}
                        </p>
                      </>
                    )}
                  </div>
                  {/* [FEAT-20260816-WALLETPAYFOLD] the whole body hides ONLY when
                      walletpay + folded — payment renders exactly as before. */}
                  {(derivedCategory !== 'walletpay' || showWalletpayPayBlock) && (
                    <>

                  {/* ── กลุ่ม 1: การเชื่อมต่อ & การจับคู่ ── */}
                  <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4">
                    <p className="text-sm font-black text-sky-900 mb-3">
                      {tx('pageui.hook.pay.grp_connection', 'การเชื่อมต่อ & การจับคู่')}
                      <span className="font-normal text-sky-800/70"> — {tx('pageui.hook.pay.grp_connection_sub', 'path และชื่อ field ที่ใช้คุยกับปลายทาง')}</span>
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {PAYMENT_CONNECTION_FIELDS.map((f) => {
                        // ช่อง "กรองสถานะ" มีกติกาพิเศษ: ว่าง = ปิดการกรอง (ไม่ใช่ลืมกรอก)
                        // จึงย้ำด้วยป้ายสีให้เห็นทันทีที่ช่องว่าง ไม่ต้องอ่าน hint ก่อน
                        const isStatus = f.key === 'statement_status';
                        const value = String(form.payment[f.key] ?? '');
                        return (
                          <div key={f.key}>
                            <label className="block text-sm font-bold text-slate-600 mb-1">{tx(`pageui.hook.paycfg.${f.key}.label`, f.label)}</label>
                            <input
                              value={value}
                              onChange={(e) => setPay({ [f.key]: e.target.value } as any)}
                              placeholder={String(PAYMENT_DEFAULTS[f.key] ?? '') || tx('pageui.hook.pay.may_be_blank', '(เว้นว่างได้)')}
                              className={`w-full px-3 py-2 text-sm border rounded-lg ${f.mono ? 'font-mono' : ''} ${
                                isStatus && value === ''
                                  ? 'border-amber-300 bg-amber-50'
                                  : 'border-slate-200'
                              }`}
                            />
                            <p className="text-[13px] text-slate-400 mt-1">{tx(`pageui.hook.paycfg.${f.key}.hint`, f.hint)}</p>
                            {isStatus && value === '' && (
                              <p className="text-[13px] font-bold text-amber-700 mt-0.5">
                                {tx('pageui.hook.pay.status_blank', 'เว้นว่างอยู่ =')} <b>{tx('pageui.hook.pay.status_no_filter', 'ไม่กรองสถานะ')}</b> {tx('pageui.hook.pay.status_blank_rest', '— ระบบจะเอารายการทุกสถานะมาจับคู่กับสลิป')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── กลุ่ม 2: ตารางแปลงค่าจากผลเติมเงิน → walletpay ──
                       WHAT: บอกว่า field ของ walletpay แต่ละตัว ให้ไปหยิบค่าจากตรงไหนของผลลัพธ์ topup
                       WHY : ปลายทางแต่ละเจ้าเรียกชื่อ field ไม่เหมือนกัน → ให้ตั้งเองได้ ไม่ต้องแก้โค้ด
                       HOW : กด "+ เพิ่มแถว" · แถวที่ชื่อ field ว่างจะถูกข้ามตอนบันทึก */}
                  <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-black text-violet-900">
                        {tx('pageui.hook.pay.grp_map', 'ตารางแปลงค่าไป walletpay')}
                        <span className="font-normal text-violet-800/70"> — {tx('pageui.hook.pay.grp_map_sub', 'ไม่ใส่ก็ได้ ถ้าปลายทางใช้ชื่อเดียวกันอยู่แล้ว')}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          // ใช้ key ว่างเป็น "แถวใหม่" — มีได้ทีละแถวเดียวเพราะ object key ซ้ำไม่ได้
                          if ('' in form.payment.topup_to_walletpay_map) return;
                          setPay({ topup_to_walletpay_map: { ...form.payment.topup_to_walletpay_map, '': '' } });
                        }}
                        className="text-[13px] font-bold text-violet-700 hover:text-violet-900"
                      >
                        {tx('pageui.hook.pay.add_row', '+ เพิ่มแถว')}
                      </button>
                    </div>

                    {Object.keys(form.payment.topup_to_walletpay_map).length === 0 ? (
                      <p className="text-[13px] text-violet-800/60">
                        {tx('pageui.hook.pay.no_rows', 'ยังไม่มีแถว — ระบบจะส่งค่าไป walletpay ตามชื่อ field เดิมที่ได้จากผลเติมเงิน')}
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {Object.entries(form.payment.topup_to_walletpay_map).map(([k, v], ri) => (
                          <div key={ri} className="flex items-center gap-2 flex-wrap text-[13px]">
                            <input
                              value={k}
                              onChange={(e) => {
                                // เปลี่ยนชื่อ key ต้องสร้าง object ใหม่ทั้งก้อนเพื่อ "รักษาลำดับแถว"
                                // ไม่งั้นแถวที่แก้ชื่อจะกระโดดไปท้ายตารางระหว่างพิมพ์ = สับสนมาก
                                const nextKey = e.target.value;
                                const rebuilt: Record<string, string> = {};
                                Object.entries(form.payment.topup_to_walletpay_map).forEach(([ok, ov], oi) => {
                                  if (oi === ri) rebuilt[nextKey] = ov;
                                  else rebuilt[ok] = ov;
                                });
                                setPay({ topup_to_walletpay_map: rebuilt });
                              }}
                              placeholder={tx('pageui.hook.pay.map_key_ph', 'ชื่อ field ฝั่ง walletpay')}
                              className="w-52 px-2 py-1 font-mono border border-slate-200 rounded"
                            />
                            <span className="text-violet-500 font-bold">←</span>
                            <input
                              value={v}
                              onChange={(e) => setPay({
                                topup_to_walletpay_map: { ...form.payment.topup_to_walletpay_map, [k]: e.target.value },
                              })}
                              placeholder={tx('pageui.hook.pay.map_val_ph', 'path ในผลลัพธ์ topup เช่น data.amount')}
                              className="flex-1 min-w-[200px] px-2 py-1 font-mono border border-slate-200 rounded"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const rest = { ...form.payment.topup_to_walletpay_map };
                                delete rest[k];
                                setPay({ topup_to_walletpay_map: rest });
                              }}
                              className="p-1 text-rose-500 hover:bg-rose-50 rounded"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[13px] text-slate-400 mt-2">
                      {tx('pageui.hook.pay.map_read', 'อ่านว่า “field ของ walletpay ทางซ้าย ← เอาค่ามาจาก path ทางขวา” · แถวที่เว้นชื่อ field ไว้จะไม่ถูกบันทึก')}
                    </p>
                  </div>

                  {/* ── กลุ่ม 3: ข้อความตอบลูกค้าแต่ละสถานการณ์ ──
                       WHAT: ข้อความที่ลูกค้าจะได้รับ แยกตามผลการตรวจสลิป
                       WHY : ร้านแต่ละที่มีน้ำเสียง/เงื่อนไขไม่เหมือนกัน → ให้แก้เองได้จากหน้านี้
                       HOW : เว้นว่าง = ใช้ข้อความเริ่มต้นของระบบ (ดูตัวอย่างในช่องสีจาง ๆ) */}
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                    <p className="text-sm font-black text-emerald-900 mb-1">
                      {tx('pageui.hook.pay.grp_reply', 'ข้อความตอบลูกค้า')}
                      <span className="font-normal text-emerald-800/70"> — {tx('pageui.hook.pay.grp_reply_sub', 'เว้นว่างทุกช่องได้ ระบบมีข้อความไทยเริ่มต้นให้อยู่แล้ว')}</span>
                    </p>
                    <p className="text-[13px] text-emerald-900/60 mb-3">
                      {tx('pageui.hook.pay.reply_note', 'ช่องที่เว้นว่าง จะแสดงข้อความเริ่มต้นเป็นตัวอย่างจาง ๆ ในช่อง — เห็นได้เลยว่าถ้าไม่กรอกลูกค้าจะได้อ่านอะไร')}
                    </p>
                    <div className="space-y-3">
                      {PAYMENT_REPLY_FIELDS.map((f) => (
                        <div key={f.key}>
                          <label className="block text-sm font-bold text-slate-600 mb-1">{tx(`pageui.hook.paycfg.${f.key}.label`, f.label)}</label>
                          <textarea
                            rows={2}
                            value={String(form.payment[f.key] ?? '')}
                            onChange={(e) => setPay({ [f.key]: e.target.value } as any)}
                            placeholder={f.fallback}
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-y"
                          />
                          <p className="text-[13px] text-slate-400 mt-1">{tx(`pageui.hook.paycfg.${f.key}.hint`, f.hint)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* [FEAT-20260816-WALLETPAYFOLD] END of the foldable body */}
                    </>
                  )}
                </div>
              )}
              {/* ==== [FEAT-20260808-PAYCUSTOOL] END */}

              {/* ── endpoints ── */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-slate-800 text-base">Endpoints ({form.endpoints.length})</h3>
                    <p className="text-[13px] text-slate-400">
                      {tx('pageui.hook.ep.intro', 'ใส่กี่เส้นก็ได้ (installment / points / promotions …) · path ซ้ำได้ถ้าคนละ method · key ห้ามซ้ำ ·')}
                      <b>{tx('pageui.hook.ep.intro_flags', 'ธง login/refresh/โปรไฟล์ เลือกเฉพาะเส้นที่ใช่ ที่เหลือไม่ต้องเลือก')}</b>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {form.endpoints.length === 0 && (
                      <button type="button" onClick={() => setForm({ ...form, endpoints: PRESET_ENDPOINTS.map((e) => ({ ...e })) })}
                        className="text-sm font-bold text-indigo-600 dark:text-indigo-300 hover:underline">{tx('pageui.hook.ep.use_preset', 'ใช้ชุดเริ่มต้น')}</button>
                    )}
                    <button type="button" onClick={() => setForm({ ...form, endpoints: [...form.endpoints, { ...EMPTY_ENDPOINT }] })}
                      className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-sm font-bold hover:bg-slate-200">
                      <Plus size={13} /> {tx('pageui.hook.ep.add', 'เพิ่มเส้น')}
                    </button>
                    {/* ==== [FEAT-20260809-ADDTOPUPLINE] START — append the topup leg in one click
                        WHAT: adds the PAY_TOPUP endpoint, pre-filled, to the endpoints already there.
                        WHY : an operator with an existing Shop-API tool otherwise has to add
                              validate-slip by hand and get five fields exactly right — including
                              `role`, which the BE matches on and silently coerces to '' if wrong.
                              ADDITIVE on purpose, unlike the template buttons: it appends instead
                              of replacing the form, so a tool keeps its other endpoints.
                              ต่างจากปุ่ม template ตรงที่ปุ่มนี้ไม่ได้ล้างของเดิมทิ้ง
                        HOW : the endpoint literal is MINT_PAY_TOPUP_ENDPOINT() — the SAME definition
                              shopapiForm() uses, so the button and the template can never drift.

                        [FIX-20260810-TOPUPBTNALWAYS] Owner order 2026-08-10: show the button for
                        EVERY category. It used to render only when `form.category === 'payment'`,
                        which reads as a missing feature on the exact tool that needs it most — an
                        existing Shop-API tool the operator is extending. They open it, see no button,
                        and hand-type five fields; the category gate was invisible from here because
                        the selector is a separate control further up the form.
                        ⚠️ The BE still only looks for `pay_topup` on a PAYMENT tool, so the line is
                           inert until the category is switched. The hint below the button says so
                           rather than hiding the control — a visible warning beats a missing button.
                        revert: wrap this button in `{form.category === 'payment' && (...)}` again */}
                    <button type="button"
                      onClick={() => {
                        // A duplicate KEY is invalid (the header says "key ห้ามซ้ำ") and validateForm
                        // refuses to save with one, so appending a second PAY_TOPUP would just plant
                        // an error for the operator to find. REFUSE and explain — replacing silently
                        // could discard edits they made on purpose.
                        const existing = form.endpoints.find((e) => e.role === 'pay_topup' || e.key === 'PAY_TOPUP');
                        if (existing) {
                          setAlert({
                            title: tx('pageui.hook.topup.exists_title', 'มีเส้นเติมเงินอยู่แล้ว'),
                            message: tx('pageui.hook.topup.exists_msg', 'tool นี้มีเส้น "{key}" ที่ทำหน้าที่เติมเงิน (pay_topup) อยู่แล้ว — ' +
                              'ใส่ซ้ำไม่ได้เพราะ KEY ห้ามซ้ำกัน · ถ้าอยากได้ค่าเริ่มต้นกลับมา ให้ลบเส้นเดิมก่อนแล้วค่อยกดปุ่มนี้ใหม่', { key: existing.key || 'PAY_TOPUP' }),
                          });
                          return;
                        }
                        setForm({ ...form, endpoints: [...form.endpoints, MINT_PAY_TOPUP_ENDPOINT()] });
                        /* [FIX-20260810-CATFROMROLE] คำเตือน "อย่าลืมสลับหมวด" ถูกถอดออก
                           เพราะไม่จริงอีกแล้ว — เส้นนี้มี role `pay_topup` ⇒ หมวดกลาย
                           เป็น payment ให้เองทันทีที่กดบันทึก ไม่มีขั้นตอนที่ต้องจำ
                           (เดิมบล็อกนี้ setAlert เตือนให้ไปสลับ dropdown ที่ตอนนี้ไม่มีแล้ว)
                           revert: เอา setAlert เดิมกลับมาพร้อม dropdown หมวด */
                      }}
                      title={tx('pageui.hook.topup.btn_title', 'เพิ่มเส้นตรวจสลิป/เติมเงิน (shop-api/v1/customer/validate-slip) แบบกรอกค่าให้ครบแล้ว')}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-sm font-bold hover:bg-emerald-200">
                      <Plus size={13} /> {tx('pageui.hook.topup.btn', 'เส้นเติมเงิน (topup)')}
                    </button>
                    {/* ==== [FEAT-20260809-ADDTOPUPLINE] END */}
                  </div>
                </div>

                <div className="space-y-3">
                  {form.endpoints.map((ep, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
                      <div className="flex items-center gap-2 mb-2">
                        <input value={ep.key} onChange={(e) => setEp(idx, { key: e.target.value.toUpperCase() })}
                          placeholder="KEY" className="w-44 px-2 py-1 text-sm font-bold font-mono border border-slate-200 rounded" />
                        <select value={ep.method} onChange={(e) => setEp(idx, { method: e.target.value as any })}
                          className="px-2 py-1 text-sm border border-slate-200 rounded">
                          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                        </select>
                        {/* [FEAT-20260729-CUSTOOL] ไม่ต้องมี / นำหน้า — ระบบตัดให้อยู่แล้ว */}
                        <input value={ep.path} onChange={(e) => setEp(idx, { path: e.target.value })}
                          placeholder={tx('pageui.hook.ep.path_ph', 'shop-api/v1/customer?line_user_id={{line_user_id}}  (ไม่ต้องมี / นำหน้า)')}
                          className="flex-1 px-2 py-1 text-sm font-mono border border-slate-200 rounded" />
                        <button type="button" title={tx('pageui.hook.ep.curl_title', 'วาง cURL เฉพาะเส้นนี้')}
                          onClick={() => { setCurlFor(curlFor === idx ? null : idx); setCurlPath(''); }}
                          className={`p-1 rounded ${curlFor === idx ? 'bg-indigo-600 text-white' : 'text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:bg-indigo-500/15'}`}>
                          <ClipboardPaste size={13} />
                        </button>
                        {/* [FEAT-20260729-CUSTOOL] ทดสอบเส้นนี้แล้วดู JSON ที่ปลายทางคืนมาจริง
                            ใช้ config สดจากฟอร์ม — ยังไม่ต้องบันทึกก็ลองได้ */}
                        <button type="button" title={tx('pageui.hook.ep.test_title', 'ทดสอบเส้นนี้ (ยิงจริง) แล้วดู JSON')}
                          onClick={() => testEndpoint(idx)} disabled={epTesting !== null}
                          className="p-1 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-40">
                          {epTesting === idx ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                        </button>
                        <span className={`px-1.5 py-0.5 rounded text-[12px] font-bold ${PURPOSE_STYLE[ep.purpose || 'data']}`}>
                          {ep.purpose}
                        </span>
                        <button type="button" onClick={() => setForm({ ...form, endpoints: form.endpoints.filter((_, i) => i !== idx) })}
                          className="p-1 text-rose-500 hover:bg-rose-50 rounded"><Trash2 size={13} /></button>
                      </div>

                      {/* [FEAT-20260729-CUSTOOL] เตือนตอนตั้งค่าขัดกันเอง — เส้นโปรไฟล์ต้องเป็น data
                          ไม่งั้นระบบจะไม่ดึงเส้นนี้เลย (auth/write ถูกข้ามตอน pre-fetch) */}
                      {ep.is_profile && ep.purpose !== 'data' && (
                        <p className="mb-2 text-[13px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          {tx('pageui.hook.ep.profile_purpose_warn', '⚠️ เลือก "เส้นโปรไฟล์" ไว้ แต่ตั้งหน้าที่เป็น "{purpose}" — ต้องเป็น', { purpose: ep.purpose })} <b>data</b> {tx('pageui.hook.ep.profile_purpose_warn_b', 'เท่านั้น ระบบถึงจะดึงข้อมูลมาให้')}
                        </p>
                      )}
                      {ep.is_profile && !ep.require_jwt && form.auth_type === 'jwt_login' && (
                        <p className="mb-2 text-[13px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                          {tx('pageui.hook.ep.jwt_warn', '⚠️ เส้นนี้ไม่ได้เลือก "ใช้ JWT" ทั้งที่ Auth เป็น JWT — ปลายทางอาจตอบ 401')}
                        </p>
                      )}

                      {curlFor === idx && (
                        <div className="mb-2 p-2 bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-400/40 rounded">
                          <div className="flex gap-2">
                            <textarea value={curlPath} onChange={(e) => setCurlPath(e.target.value)} rows={2}
                              placeholder={tx('pageui.hook.ep.curl_ph', 'วาง cURL ของเส้นนี้ — ได้ method + path + body + เดาว่าต้องใช้ JWT ไหม (ไม่แตะ Base URL)')}
                              className="flex-1 px-2 py-1 text-[13px] font-mono border border-indigo-200 dark:border-indigo-400/40 rounded resize-y" />
                            <button type="button" onClick={() => applyCurlPath(idx)} disabled={!curlPath.trim()}
                              className="px-2 py-1 bg-indigo-600 text-white text-[13px] font-bold rounded disabled:opacity-40 self-start whitespace-nowrap">
                              {tx('pageui.hook.ep.fill_line', 'กรอกเส้นนี้')}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-3 flex-wrap text-[13px]">
                        <input value={ep.label} onChange={(e) => setEp(idx, { label: e.target.value })}
                          placeholder={tx('pageui.hook.ep.label_ph', 'ชื่อไทย')} className="w-36 px-2 py-1 border border-slate-200 rounded" />
                        {/* [FEAT-20260729-CUSTOOL] อธิบายในตัวเลือกเลย — เดิมเห็นแค่ auth/data/write แล้วงง
                            สำคัญ: เส้น "อ่านข้อมูล" เท่านั้นที่ถูกดึงอัตโนมัติตอนลูกค้าทัก
                            ถ้าตั้งเส้นเขียนเป็น data จะกลายเป็นแก้ข้อมูลปลายทางทุกครั้งที่มีข้อความเข้า */}
                        <select value={ep.purpose} onChange={(e) => setEp(idx, { purpose: e.target.value as any })}
                          className="px-2 py-1 border border-slate-200 rounded" title={tx('pageui.hook.ep.purpose_title', 'เส้นนี้ทำหน้าที่อะไร')}>
                          <option value="data">{tx('pageui.hook.ep.purpose_data', 'data — อ่านข้อมูล (ดึงอัตโนมัติตอนลูกค้าทัก)')}</option>
                          <option value="write">{tx('pageui.hook.ep.purpose_write', 'write — เขียน/แก้ข้อมูล (ยิงเมื่อสั่งเท่านั้น)')}</option>
                          <option value="auth">{tx('pageui.hook.ep.purpose_auth', 'auth — เกี่ยวกับ token (login/refresh)')}</option>
                        </select>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={ep.require_jwt} onChange={(e) => setEp(idx, { require_jwt: e.target.checked })} />
                          {tx('pageui.hook.ep.use_jwt', 'ใช้ JWT')}
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer text-amber-700 font-bold">
                          <input type="checkbox" checked={ep.is_login} onChange={(e) => setExclusiveFlag(idx, 'is_login', e.target.checked)} />
                          {tx('pageui.hook.ep.login_line', 'เส้น login')}
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer text-amber-700">
                          <input type="checkbox" checked={ep.is_refresh} onChange={(e) => setExclusiveFlag(idx, 'is_refresh', e.target.checked)} />
                          {tx('pageui.hook.ep.refresh_line', 'เส้น refresh')}
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer text-sky-700 font-bold">
                          <input type="checkbox" checked={ep.is_profile} onChange={(e) => setExclusiveFlag(idx, 'is_profile', e.target.checked)} />
                          {tx('pageui.hook.ep.profile_line', 'เส้นโปรไฟล์')}
                        </label>
                        <select value={ep.request_type} onChange={(e) => setEp(idx, { request_type: e.target.value as any })}
                          className="px-2 py-1 border border-slate-200 rounded">
                          <option value="json">json</option>
                          <option value="form">form</option>
                          <option value="form-data">form-data</option>
                        </select>
                        {/* ==== [FEAT-20260729-EPROLE] START — "หน้าที่" ของเส้น
                            ระบบหาเส้นด้วยหน้าที่ก่อนชื่อ KEY → เปลี่ยนชื่อ KEY ตามปลายทางจริง
                            ได้อิสระ · ไม่เลือก = หาแบบเดิม (ชื่อ KEY มาตรฐาน) ของเก่าไม่กระทบ */}
                        <select value={ep.role || ''} onChange={(e) => setEp(idx, { role: e.target.value as any })}
                          className={`px-2 py-1 border rounded ${ep.role ? 'border-violet-300 bg-violet-50 text-violet-800 font-bold' : 'border-slate-200'}`}
                          title={tx('pageui.hook.ep.role_title', 'เส้นนี้ทำหน้าที่มาตรฐานตัวไหน — ระบบใช้หาเส้นก่อนชื่อ KEY')}>
                          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{tx(`pageui.hook.role.${o.value || 'by_key'}`, o.label)}</option>)}
                        </select>
                        {/* ==== [FEAT-20260903-TOPUPPERPROVIDER] ผูกเส้นนี้กับ provider ตัวไหน
                            `shop-api/v1/customer/validate-slip` เขียนไว้สำหรับ Swiftcheck ⇒ เจ้าที่สอง
                            อาจต้องใช้ path ของตัวเองบน Shop-API · ไม่เลือก = ใช้ได้ทุกเจ้า
                            (ค่าเดิมของทุกเส้น — Swiftcheck ไม่ต้องตั้งอะไรเลย)

                            เงื่อนไขการโชว์ 2 ชั้น และตั้งใจทั้งคู่:
                              · เฉพาะ role `pay_topup` — walletpay ไม่แยกรายเจ้า (คำตัดสิน 03/09)
                              · เฉพาะเมื่อ server บอกว่ามีตัวเลือกจริง ≥ 2 — มีเจ้าเดียวก็ไม่มีอะไรให้ผูก
                            ⇒ วันที่ register เจ้าที่สอง ช่องนี้โผล่เอง ไม่ต้อง deploy FE */}
                        {/* [MERGE-20260904-SLIPGUARDOFF] HIDDEN TODAY, and not because of
                            this page. SlipGuard is written and tested but switched off in
                            the back end (`slip/providers/provider-entries.ts`,
                            `enabled: false`), so the server reports one real choice and
                            the second condition below is false. Flip that one line and
                            this control returns on its own — nothing here changes.
                            The same note, in full, sits on the picker in
                            `components/hook/HookFormModal.tsx`. */}
                        {ep.role === 'pay_topup' && slipProviders.choiceCount >= 2 && (
                        <select value={(ep as any).slip_provider || ''}
                          onChange={(e) => setEp(idx, { slip_provider: e.target.value } as any)}
                          className={`px-2 py-1 border rounded ${(ep as any).slip_provider ? 'border-emerald-300 bg-emerald-50 text-emerald-800 font-bold' : 'border-slate-200'}`}
                          title={tx('pageui.hook.ep.slip_provider_title', 'เส้นนี้ให้บริการ slip provider ตัวไหน — ไม่เลือก = ทุกเจ้า')}>
                          {slipProviders.options.map((o) => (
                            <option key={o.value} value={o.value}>{fieldOptionLabel(o, t)}</option>
                          ))}
                        </select>
                        )}
                        {/* [FEAT-20260802-EPCACHE] cache ผลลัพธ์กี่วินาที (ข้อมูลระดับเว็บที่เปลี่ยนช้า)
                            ว่าง/0 = ไม่ cache = ยิงทุกครั้ง (เดิม) · ห้ามตั้งกับเส้นโปรไฟล์ (BE ตีกลับ)
                            แชร์ข้าม OA ที่ web_code เดียวกัน → 10 OA ยิงครั้งเดียว */}
                        <input
                          type="number" min={0} max={86400} step={60}
                          value={(ep as any).cache_ttl_sec ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = v === '' ? null : Math.max(0, Math.min(86400, parseInt(v, 10) || 0));
                            setEp(idx, { cache_ttl_sec: n } as any);
                          }}
                          placeholder={tx('pageui.hook.ep.cache_ph', 'cache (วินาที)')}
                          disabled={!!ep.is_profile || ep.role === 'profile'}
                          title={ep.is_profile || ep.role === 'profile'
                            ? tx('pageui.hook.ep.cache_profile_no', 'เส้นโปรไฟล์ห้าม cache — ข้อมูลต่อลูกค้าต้องสดเสมอ')
                            : tx('pageui.hook.ep.cache_title', 'cache ผลลัพธ์กี่วินาที · ว่าง/0 = ไม่ cache · เช่น 1800 = 30 นาที')}
                          className={`w-32 px-2 py-1 border rounded disabled:opacity-40 disabled:cursor-not-allowed ${
                            Number((ep as any).cache_ttl_sec) > 0
                              ? 'border-amber-300 bg-amber-50 text-amber-800 font-bold'
                              : 'border-slate-200'
                          }`}
                        />
                        <button type="button"
                          onClick={() => setRulesOpen((p) => ({ ...p, [idx]: !p[idx] }))}
                          className={`px-2 py-1 rounded border font-bold ${
                            (ep.result_rules?.length || 0) > 0 || ep.idempotency?.enabled
                              ? 'border-violet-300 bg-violet-50 text-violet-800'
                              : 'border-slate-200 text-slate-500 hover:bg-slate-100'
                          }`}
                          title={tx('pageui.hook.rules.btn_title', 'ปลายทางที่ตอบ HTTP 200 เสมอ ต้องอ่านผลจาก body — ตั้งกฎที่นี่ · รวมถึงการกันทำซ้ำเมื่อ timeout')}>
                          {/* [FEAT-20260730-IDEMPOTENT] ป้ายบอกด้วยว่าเปิดกันทำซ้ำไว้ (🔁) */}
                          {tx('pageui.hook.rules.btn', 'กฎอ่านผล')}{(ep.result_rules?.length || 0) > 0 ? ` (${ep.result_rules!.length})` : ''}
                          {ep.idempotency?.enabled ? ' 🔁' : ''} {rulesOpen[idx] ? '▴' : '▾'}
                        </button>
                        {/* ==== [FEAT-20260729-EPROLE] END */}
                      </div>

                      {/* ==== [FEAT-20260729-EPROLE] START — ตัวแก้ "กฎอ่านผลจาก body" + "แปลงผลลัพธ์"
                          ใช้กับปลายทางที่ HTTP status เชื่อไม่ได้ (ตอบ 200 แม้ล้มเหลว)
                          เรียงบนลงล่าง ข้อแรกที่ตรงชนะ · ตั้งกฎแล้วไม่มีข้อไหนตรง = ระบบถือว่า
                          "ล้มเหลว" เสมอ (fail-closed) เพื่อไม่ให้รหัสใหม่ของปลายทางหลุดเป็นสำเร็จ */}
                      {rulesOpen[idx] && (
                        <div className="mt-2 p-2 bg-violet-50/60 rounded border border-violet-200">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[13px] font-bold text-violet-900">
                              {tx('pageui.hook.rules.title', 'กฎอ่านผลจาก body')} <span className="font-normal text-violet-700">{tx('pageui.hook.rules.title_sub', '(เรียงบนลงล่าง — ข้อแรกที่ตรงชนะ · ไม่ตั้ง = ตัดสินจาก HTTP status แบบเดิม)')}</span>
                            </p>
                            <div className="flex gap-2">
                              {(ep.result_rules?.length || 0) === 0 && (
                                <button type="button"
                                  onClick={() => setEp(idx, { result_rules: EXAMPLE_RESULT_RULES() })}
                                  className="text-[13px] font-bold text-violet-700 hover:text-violet-900 underline underline-offset-2">
                                  {tx('pageui.hook.rules.use_example', '( ใช้ตัวอย่าง — แก้ให้ตรงปลายทางจริง )')}
                                </button>
                              )}
                              <button type="button"
                                onClick={() => setEp(idx, {
                                  result_rules: [...(ep.result_rules || []), {
                                    path: '', op: 'eq', value: '', http_codes: '', action: 'fail',
                                    failure_type: 'business', error_code: '', message_path: '',
                                  }],
                                })}
                                className="text-[13px] font-bold text-violet-700 hover:text-violet-900">
                                {tx('pageui.hook.rules.add', '+ เพิ่มกฎ')}
                              </button>
                            </div>
                          </div>

                          {(ep.result_rules || []).map((r, ri) => {
                            const setRule = (patch: any) => {
                              const next = [...(ep.result_rules || [])];
                              next[ri] = { ...next[ri], ...patch };
                              setEp(idx, { result_rules: next });
                            };
                            return (
                              <div key={ri} className="flex items-center gap-1.5 flex-wrap mb-1.5 p-1.5 bg-white rounded border border-violet-100 text-[13px]">
                                <span className="font-mono font-bold text-violet-400">{ri + 1}.</span>
                                <input value={r.path || ''} onChange={(e) => setRule({ path: e.target.value })}
                                  placeholder={tx('pageui.hook.rules.path_ph', 'path เช่น result.status')}
                                  className="w-40 px-1.5 py-0.5 font-mono border border-slate-200 rounded" />
                                <select value={r.op || 'eq'} onChange={(e) => setRule({ op: e.target.value })}
                                  className="px-1 py-0.5 border border-slate-200 rounded">
                                  {['eq', 'neq', 'in', 'contains', 'exists', 'not_exists'].map((o) => <option key={o}>{o}</option>)}
                                </select>
                                {!['exists', 'not_exists'].includes(r.op || 'eq') && (
                                  <input value={r.value || ''} onChange={(e) => setRule({ value: e.target.value })}
                                    placeholder={r.op === 'in' ? tx('pageui.hook.rules.value_in_ph', 'ค่า เช่น 4001,4004') : tx('pageui.hook.rules.value_ph', 'ค่า เช่น OK')}
                                    className="w-28 px-1.5 py-0.5 font-mono border border-slate-200 rounded" />
                                )}
                                <input value={r.http_codes || ''} onChange={(e) => setRule({ http_codes: e.target.value })}
                                  placeholder={tx('pageui.hook.rules.http_ph', 'HTTP (เช่น 429,503)')} title={tx('pageui.hook.rules.http_title', 'ตั้งแล้วกฎนี้ดู HTTP status ด้วย — เว้นว่างได้')}
                                  className="w-28 px-1.5 py-0.5 font-mono border border-slate-200 rounded" />
                                <select value={r.action || 'fail'} onChange={(e) => setRule({ action: e.target.value })}
                                  className={`px-1 py-0.5 border rounded font-bold ${r.action === 'success' ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-rose-700 border-rose-200 bg-rose-50'}`}>
                                  <option value="success">{tx('pageui.hook.rules.act_success', '= สำเร็จ')}</option>
                                  <option value="fail">{tx('pageui.hook.rules.act_fail', '= ล้มเหลว')}</option>
                                </select>
                                {r.action !== 'success' && (
                                  <>
                                    <input value={r.error_code || ''} onChange={(e) => setRule({ error_code: e.target.value.toUpperCase() })}
                                      list={`canon-codes-${idx}-${ri}`} placeholder={tx('pageui.hook.rules.code_ph', 'รหัสกลาง เช่น LINK_ACCOUNT_NOT_FOUND')}
                                      className="w-56 px-1.5 py-0.5 font-mono border border-slate-200 rounded" />
                                    <datalist id={`canon-codes-${idx}-${ri}`}>
                                      {CANONICAL_ERROR_CODES.map((c) => <option key={c} value={c} />)}
                                    </datalist>
                                    <select value={r.failure_type || 'business'} onChange={(e) => setRule({ failure_type: e.target.value })}
                                      title={tx('pageui.hook.rules.ftype_title', 'ประเภทความล้มเหลว — transient = ลองซ้ำได้')}
                                      className="px-1 py-0.5 border border-slate-200 rounded">
                                      <option value="business">{tx('pageui.hook.rules.ftype_business', 'business (ข้อมูลไม่ตรง)')}</option>
                                      <option value="transient">{tx('pageui.hook.rules.ftype_transient', 'transient (ลองใหม่ได้)')}</option>
                                      <option value="config">{tx('pageui.hook.rules.ftype_config', 'config (ตั้งค่าผิด)')}</option>
                                      <option value="system">system</option>
                                    </select>
                                    <input value={r.message_path || ''} onChange={(e) => setRule({ message_path: e.target.value })}
                                      placeholder={tx('pageui.hook.rules.msg_ph', 'path ข้อความ เช่น result.errMsg')} title={tx('pageui.hook.rules.msg_title', 'เก็บข้อความดิบของปลายทางไว้ดูใน log')}
                                      className="w-44 px-1.5 py-0.5 font-mono border border-slate-200 rounded" />
                                  </>
                                )}
                                <button type="button"
                                  onClick={() => setEp(idx, { result_rules: (ep.result_rules || []).filter((_, i) => i !== ri) })}
                                  className="p-0.5 text-rose-500 hover:bg-rose-50 rounded ml-auto"><Trash2 size={12} /></button>
                              </div>
                            );
                          })}

                          {(ep.result_rules?.length || 0) > 0 && (
                            <p className="text-[12px] text-violet-800/80 mt-1">
                              {tx('pageui.hook.rules.warn_a', '⚠️ ตั้งกฎแล้ว "ไม่มีข้อไหนตรง" = ระบบถือว่า')}<b>{tx('pageui.hook.rules.warn_fail', 'ล้มเหลว')}</b>{tx('pageui.hook.rules.warn_b', 'เสมอ (กันปลายทางเพิ่มรหัสใหม่แล้วหลุดเป็นสำเร็จ) — ควรมีกฎ "= สำเร็จ" อย่างน้อย 1 ข้อเสมอ')}
                            </p>
                          )}

                          {/* ==== [FEAT-20260730-IDEMPOTENT] START — กันทำซ้ำเมื่อ timeout (เฉพาะเส้นเขียน)
                              timeout = "ไม่รู้ผล" ไม่ใช่ "ล้มเหลว" — ปลายทางอาจทำไปแล้วแต่คำตอบมาไม่ถึง
                              แนบกุญแจไปด้วย → ยิงซ้ำแล้วปลายทางไม่ทำซ้ำ ส่งผลเดิมกลับมา
                              revert: ลบ block นี้ */}
                          {ep.purpose === 'write' && (
                            <div className="mt-2 pt-2 border-t border-violet-200">
                              <label className="flex items-center gap-1.5 cursor-pointer mb-1">
                                <input type="checkbox" checked={ep.idempotency?.enabled === true}
                                  onChange={(e) => setEp(idx, {
                                    idempotency: {
                                      ...ep.idempotency,
                                      enabled: e.target.checked,
                                      // เปิดครั้งแรกให้ retry 1 ครั้งเป็นค่าตั้งต้นที่สมเหตุผล
                                      retry_on_timeout: e.target.checked
                                        ? (ep.idempotency?.retry_on_timeout || 1) : 0,
                                    },
                                  })} />
                                <span className="text-[13px] font-bold text-violet-900">
                                  {tx('pageui.hook.idem.title', 'กันทำซ้ำเมื่อ timeout (idempotency)')}
                                </span>
                              </label>
                              <p className="text-[12px] text-violet-800/80 mb-1.5">
                                {tx('pageui.hook.idem.desc', 'timeout ไม่ได้แปลว่าล้มเหลว — ปลายทางอาจทำไปแล้วแต่คำตอบมาไม่ถึงเรา เปิดแล้วระบบจะแนบ "กุญแจ" ไปกับคำขอ และยิงซ้ำให้อัตโนมัติเมื่อไม่ได้คำตอบ')}
                              </p>
                              {ep.idempotency?.enabled && (
                                <>
                                  <p className="text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1.5">
                                    {tx('pageui.hook.idem.warn_a', '⚠️ เปิดได้ต่อเมื่อ')} <b>{tx('pageui.hook.idem.warn_supported', 'ปลายทางรองรับกุญแจนี้จริง')}</b> {tx('pageui.hook.idem.warn_b', '— ถ้าเขาไม่รองรับ การยิงซ้ำจะกลายเป็นการ')}<b>{tx('pageui.hook.idem.warn_dup', 'ทำซ้ำจริง')}</b> {tx('pageui.hook.idem.warn_c', '(ผูกซ้ำ/ย้ายซ้ำ) ต้องยืนยันกับเจ้าของ API ก่อน')}
                                  </p>
                                  <div className="flex items-center gap-2 flex-wrap text-[13px]">
                                    <select value={ep.idempotency?.location || 'header'}
                                      onChange={(e) => setEp(idx, { idempotency: { ...ep.idempotency, location: e.target.value as any } })}
                                      className="px-1.5 py-1 border border-violet-200 rounded">
                                      <option value="header">{tx('pageui.hook.idem.loc_header', 'ส่งเป็น header')}</option>
                                      <option value="body">{tx('pageui.hook.idem.loc_body', 'แทรกใน body')}</option>
                                    </select>
                                    <input value={ep.idempotency?.field || ''}
                                      onChange={(e) => setEp(idx, { idempotency: { ...ep.idempotency, field: e.target.value } })}
                                      placeholder={tx('pageui.hook.idem.field_ph', 'ชื่อ field เช่น Idempotency-Key')}
                                      title={tx('pageui.hook.idem.field_title', 'ชื่อตามที่ปลายทางกำหนด — ไม่มีมาตรฐานกลาง แต่ละเจ้าใช้ไม่เหมือนกัน')}
                                      className="flex-1 min-w-[180px] px-2 py-1 font-mono border border-violet-200 rounded" />
                                    <label className="flex items-center gap-1.5">
                                      <span className="text-slate-600">{tx('pageui.hook.idem.retry_label', 'ยิงซ้ำเมื่อไม่ได้คำตอบ')}</span>
                                      <select value={ep.idempotency?.retry_on_timeout ?? 0}
                                        onChange={(e) => setEp(idx, { idempotency: { ...ep.idempotency, retry_on_timeout: Number(e.target.value) } })}
                                        className="px-1.5 py-1 border border-violet-200 rounded">
                                        <option value={0}>{tx('pageui.hook.idem.retry_0', 'ไม่ยิงซ้ำ (ส่งกุญแจอย่างเดียว)')}</option>
                                        <option value={1}>{tx('pageui.hook.idem.retry_n', '{n} ครั้ง', { n: 1 })}</option>
                                        <option value={2}>{tx('pageui.hook.idem.retry_n', '{n} ครั้ง', { n: 2 })}</option>
                                        <option value={3}>{tx('pageui.hook.idem.retry_n', '{n} ครั้ง', { n: 3 })}</option>
                                      </select>
                                    </label>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                          {/* ==== [FEAT-20260730-IDEMPOTENT] END */}

                          {/* แปลงผลลัพธ์ (เฉพาะเส้นเขียน) — ชื่อ field ของปลายทาง → ชื่อกลางของเรา */}
                          {ep.purpose === 'write' && (
                            <div className="mt-2 pt-2 border-t border-violet-200">
                              <p className="text-[13px] font-bold text-violet-900 mb-1">
                                {tx('pageui.hook.rmap.title', 'แปลงผลลัพธ์')} <span className="font-normal text-violet-700">{tx('pageui.hook.rmap.title_sub', '(ตำแหน่งค่าใน response ของปลายทาง — เว้นว่างได้)')}</span>
                              </p>
                              <div className="flex items-center gap-2 flex-wrap text-[13px]">
                                <input value={ep.result_map?.member_id || ''}
                                  onChange={(e) => setEp(idx, { result_map: { ...ep.result_map, member_id: e.target.value } })}
                                  placeholder={tx('pageui.hook.rmap.member_ph', 'รหัสสมาชิก: result.payload.memberRef')}
                                  className="flex-1 min-w-[200px] px-2 py-1 font-mono border border-violet-200 rounded" />
                                <input value={ep.result_map?.phone || ''}
                                  onChange={(e) => setEp(idx, { result_map: { ...ep.result_map, phone: e.target.value } })}
                                  placeholder={tx('pageui.hook.rmap.phone_ph', 'เบอร์: result.payload.mobileNo')}
                                  className="flex-1 min-w-[160px] px-2 py-1 font-mono border border-violet-200 rounded" />
                                <input value={ep.result_map?.name || ''}
                                  onChange={(e) => setEp(idx, { result_map: { ...ep.result_map, name: e.target.value } })}
                                  placeholder={tx('pageui.hook.rmap.name_ph', 'ชื่อ: result.payload.custName')}
                                  className="flex-1 min-w-[160px] px-2 py-1 font-mono border border-violet-200 rounded" />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {/* ==== [FEAT-20260729-EPROLE] END */}

                      {/* token_path — เฉพาะเส้น auth */}
                      {(ep.is_login || ep.is_refresh) && (
                        <div className="mt-2 flex items-center gap-2 text-[13px]">
                          <span className="text-slate-500 font-bold">{tx('pageui.hook.ep.token_from', 'อ่าน token จาก:')}</span>
                          <input value={ep.token_path} onChange={(e) => setEp(idx, { token_path: e.target.value })}
                            placeholder="data.access_token"
                            className="w-48 px-2 py-1 font-mono border border-slate-200 rounded" />
                          <input value={ep.refresh_token_path} onChange={(e) => setEp(idx, { refresh_token_path: e.target.value })}
                            placeholder="data.refresh_token"
                            className="w-48 px-2 py-1 font-mono border border-slate-200 rounded" />
                        </div>
                      )}

                      {/* profile_map — เฉพาะเส้นโปรไฟล์ (3rd-party คืนโครงสร้างต่างกัน) */}
                      {/* ==== [FEAT-20260729-CUSTOOL] preview JSON จากการยิงจริง ==== */}
                      {epResult[idx] && (
                        <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden">
                          <div className={`flex items-center gap-2 px-2 py-1.5 text-[13px] font-bold ${
                            epResult[idx].mine?.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                          }`}>
                            {epResult[idx].mine?.ok
                              ? <CheckCircle2 size={13} className="shrink-0" />
                              : <XCircle size={13} className="shrink-0" />}
                            <span>{epResult[idx].mine?.ok ? tx('pageui.hook.eptest.ok', 'ยิงสำเร็จ') : tx('pageui.hook.eptest.failed', 'ยิงไม่สำเร็จ')}</span>
                            {epResult[idx].mine?.status != null && (
                              <span className="px-1.5 py-0.5 rounded bg-white/70 font-mono">HTTP {epResult[idx].mine.status}</span>
                            )}
                            {epResult[idx].mine?.duration_ms != null && (
                              <span className="opacity-70">{epResult[idx].mine.duration_ms}ms</span>
                            )}
                            {epResult[idx].loginStep && (
                              <span className={`px-1.5 py-0.5 rounded ${epResult[idx].loginStep.ok ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                                login {epResult[idx].loginStep.ok ? tx('pageui.hook.eptest.login_pass', 'ผ่าน') : tx('pageui.hook.eptest.login_fail', 'ไม่ผ่าน')}
                              </span>
                            )}
                            <button type="button" onClick={() => setEpResult((p) => ({ ...p, [idx]: null }))}
                              className="ml-auto opacity-60 hover:opacity-100"><X size={12} /></button>
                          </div>

                          {epResult[idx].mine?.url && (
                            <div className="px-2 py-1 bg-slate-50 border-b border-slate-200 text-[12px] font-mono text-slate-500 truncate">
                              {epResult[idx].mine.method} {epResult[idx].mine.url}
                            </div>
                          )}

                          {(epResult[idx].mine?.message && !epResult[idx].mine?.ok) && (
                            <p className="px-2 py-1.5 text-[13px] text-rose-700 bg-rose-50/60">{epResult[idx].mine.message}</p>
                          )}
                          {epResult[idx].message && !epResult[idx].mine && (
                            <p className="px-2 py-1.5 text-[13px] text-rose-700 bg-rose-50/60">{epResult[idx].message}</p>
                          )}

                          {epResult[idx].mine?.response !== undefined && (
                            <>
                              <div className="flex items-center justify-between px-2 py-1 bg-slate-100 text-[12px] font-bold text-slate-600">
                                <span>{tx('pageui.hook.eptest.json_title', 'JSON ที่ปลายทางคืนมา')}</span>
                                <button type="button"
                                  // [FIX-20260830-COPYHTTP2] see utils/copyText
                                  onClick={() => { void copyText(JSON.stringify(epResult[idx].mine.response, null, 2)); }}
                                  className="hover:text-indigo-600 dark:text-indigo-300">{tx('pageui.hook.eptest.copy', 'คัดลอก')}</button>
                              </div>
                              <pre className="max-h-56 overflow-auto bg-slate-900 text-slate-100 text-[12px] leading-relaxed p-2 m-0 font-mono">
{JSON.stringify(epResult[idx].mine.response, null, 2)}
                              </pre>
                              {ep.is_profile && (
                                <p className="px-2 py-1.5 text-[12px] text-sky-800 bg-sky-50">
                                  {tx('pageui.hook.eptest.profile_hint', 'ดูจาก JSON ข้างบนแล้วกรอก "แปลงข้อมูลโปรไฟล์" ให้ตรงตำแหน่งจริง เช่น')}
                                  <code className="mx-1 px-1 bg-white rounded">data.profile.phone</code>
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {ep.is_profile && (
                        <div className="mt-2 p-2 bg-sky-50 rounded border border-sky-100">
                          {/* [FEAT-20260729-CUSTOOL] ปุ่มเติมค่าเริ่มต้นลง input จริง
                              เดิมเขียนว่า "เว้นว่าง = เดาให้อัตโนมัติ" ซึ่งคนไม่รู้ว่าค่าที่เดาคืออะไร
                              → ให้กดแล้วเห็นค่าจริงในช่องเลย แก้ต่อได้ทันที */}
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[13px] font-bold text-sky-800">{tx('pageui.hook.pmap.title', 'แปลงข้อมูลโปรไฟล์')}</p>
                            <button type="button"
                              onClick={() => setEp(idx, { profile_map: { ...DEFAULT_PROFILE_MAP } })}
                              className="text-[13px] font-bold text-sky-700 hover:text-sky-900 underline underline-offset-2">
                              {tx('pageui.hook.pmap.use_default', '( ใช้ค่าเริ่มต้น )')}
                            </button>
                          </div>
                          {/* [FEAT-20260729-CUSTOOL] บอกให้ชัดว่าใช้กับอะไร กันกรอกเผื่อโดยไม่จำเป็น */}
                          <p className="text-[13px] text-sky-900/70 mb-1.5">
                            {tx('pageui.hook.pmap.hint_a', 'ใช้โชว์')} <b>{tx('pageui.hook.pmap.hint_b', 'ชื่อ/เบอร์/รหัส บนหัวแชทหน้า Ticket Support')}</b> {tx('pageui.hook.pmap.hint_c', 'เท่านั้น · ถ้าจะเอาไปใช้กับ')} <b>{tx('pageui.hook.pmap.hint_d', 'แท็กไดนามิก ไม่ต้องกรอกช่องนี้')}</b> {tx('pageui.hook.pmap.hint_e', '(แท็กอ่านข้อมูลดิบจาก KEY ของเส้นนี้ได้เลย)')}
                          </p>
                          <div className="flex items-center gap-2 text-[13px] flex-wrap">
                            <input value={ep.profile_map?.name}
                              onChange={(e) => setEp(idx, { profile_map: { ...ep.profile_map, name: e.target.value } })}
                              placeholder={tx('pageui.hook.pmap.name_ph', 'ชื่อ: data.profile.bank.account_name')}
                              className="flex-1 min-w-[200px] px-2 py-1 font-mono border border-sky-200 rounded" />
                            <input value={ep.profile_map?.phone}
                              onChange={(e) => setEp(idx, { profile_map: { ...ep.profile_map, phone: e.target.value } })}
                              placeholder={tx('pageui.hook.pmap.phone_ph', 'เบอร์: data.profile.phone')}
                              className="flex-1 min-w-[160px] px-2 py-1 font-mono border border-sky-200 rounded" />
                            <input value={ep.profile_map?.code}
                              onChange={(e) => setEp(idx, { profile_map: { ...ep.profile_map, code: e.target.value } })}
                              placeholder={tx('pageui.hook.pmap.code_ph', 'รหัส: data.profile.member_id')}
                              className="flex-1 min-w-[160px] px-2 py-1 font-mono border border-sky-200 rounded" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ==== [FEAT-20260729-CUSTOOL] เลือก OA ในฟอร์มเลย ====
                  เดิมต้องเซฟก่อนแล้วไปกดปุ่ม 🔗 ในตารางอีกที = คนใหม่หาไม่เจอ
                  รายชื่อ OA มาตามสิทธิ์ของ login (fetchVisibleGroups + filterVisibleHooks) */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-indigo-600 dark:text-indigo-300" />
                    <h3 className="font-bold text-slate-800 text-base">{tx('pageui.hook.oas.title', 'OA ที่ใช้ tool นี้ ({n}/{total})', { n: formHooks.length, total: allHooks.length })}</h3>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <button type="button" onClick={() => setFormHooks(allHooks.map((h) => h._id || h.id))}
                      className="font-bold text-indigo-600 dark:text-indigo-300 hover:underline">{tx('pageui.hook.oas.select_all', 'เลือกทั้งหมด')}</button>
                    <button type="button" onClick={() => setFormHooks([])}
                      className="font-bold text-slate-500 hover:underline">{tx('pageui.hook.oas.clear_all', 'ยกเลิกทั้งหมด')}</button>
                  </div>
                </div>

                <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {allHooks.length === 0 ? (
                    <p className="p-3 text-center text-sm text-slate-400">{tx('pageui.hook.oas.none_allowed', 'ไม่มี OA ที่คุณมีสิทธิ์')}</p>
                  ) : allHooks.map((h) => {
                    const id = h._id || h.id;
                    const on = formHooks.includes(id);
                    return (
                      <label key={id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={on}
                          onChange={(e) => setFormHooks((p) => e.target.checked ? [...p, id] : p.filter((x) => x !== id))}
                          className="w-4 h-4 accent-indigo-600" />
                        <span className="text-sm text-slate-700">{h.alias || h.line_oa_name || h.name}</span>
                        {h.group?.name && (
                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[12px] font-bold">{h.group.name}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[13px] text-slate-400">
                  {tx('pageui.hook.oas.note', 'เลือกแล้วบันทึก = เปิดใช้ tool ให้ OA นั้นทันที · เอาออก = OA นั้นเลิกใช้')}
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.status} onChange={(e) => setForm({ ...form, status: e.target.checked })}
                  className="w-4 h-4 accent-emerald-600" />
                <span className="text-sm font-bold text-slate-700">{tx('pageui.hook.form.enabled', 'เปิดใช้งาน')}</span>
                <span className="text-sm text-slate-400">{tx('pageui.hook.form.enabled_note', '(ปิด = ทุก OA ที่ใช้ tool นี้หยุดทันที)')}</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg">{tx('pageui.hook.cancel', 'ยกเลิก')}</button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin inline" /> : tx('pageui.hook.save_btn', 'บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── เลือก multi OA ── */}
      {assignFor && (
        <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 className="font-black text-slate-800 flex items-center gap-2">
                  <Users size={18} className="text-indigo-600 dark:text-indigo-300" /> {tx('pageui.hook.assign.title', 'ลิงก์ OA กับ "{name}"', { name: assignFor.name })}
                </h2>
                <p className="text-xs text-slate-500">{tx('pageui.hook.assign.sub', 'เลือก OA ที่จะใช้ tool นี้ · เอาออก = เลิกใช้')}</p>
              </div>
              <button onClick={() => setAssignFor(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between mb-2 text-xs">
                <span className="font-bold text-slate-600">{tx('pageui.hook.assign.picked', 'เลือกแล้ว {n}/{total}', { n: pickedHooks.length, total: allHooks.length })}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPickedHooks(allHooks.map((h) => h._id || h.id))}
                    className="font-bold text-indigo-600 dark:text-indigo-300 hover:underline">{tx('pageui.hook.oas.select_all', 'เลือกทั้งหมด')}</button>
                  <button onClick={() => setPickedHooks([])}
                    className="font-bold text-slate-500 hover:underline">{tx('pageui.hook.oas.clear_all', 'ยกเลิกทั้งหมด')}</button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {allHooks.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-400">{tx('pageui.hook.oas.none_allowed', 'ไม่มี OA ที่คุณมีสิทธิ์')}</p>
                ) : allHooks.map((h) => {
                  const id = h._id || h.id;
                  const on = pickedHooks.includes(id);
                  return (
                    <label key={id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on}
                        onChange={(e) => setPickedHooks((p) => e.target.checked ? [...p, id] : p.filter((x) => x !== id))}
                        className="w-4 h-4 accent-indigo-600" />
                      <span className="text-sm text-slate-700">{h.alias || h.line_oa_name || h.name}</span>
                      {h.group?.name && (
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold">
                          {h.group.name}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {tx('pageui.hook.assign.note', 'บันทึกแล้วระบบจะเปิดสวิตช์ custom tool ให้ OA ที่เลือกใหม่อัตโนมัติ')}
              </p>
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
              <button onClick={() => setAssignFor(null)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg">{tx('pageui.hook.cancel', 'ยกเลิก')}</button>
              <button onClick={saveAssign} disabled={assignSaving}
                className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {assignSaving ? <Loader2 size={15} className="animate-spin inline" /> : tx('pageui.hook.save_btn', 'บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={true}
          title={tx('pageui.hook.delete.title', 'ลบ Custom Tool')}
          message={tx('pageui.hook.delete.msg', 'ลบ "{name}" ใช่ไหม? (ลบแบบ soft delete — กู้คืนได้จาก DB)', { name: confirmDelete.name })}
          type="danger"
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {/* ==== [FEAT-20260729-CUSTOOL] ปุ่ม ? — อธิบายทุกอย่างแบบภาษาคน ====
          เขียนให้คนที่ไม่เคยเห็นระบบนี้อ่านแล้วทำเองได้ ไม่ใช้ศัพท์เทคนิคเกินจำเป็น */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6" onClick={() => setShowHelp(false)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <h2 className="font-black text-slate-800 flex items-center gap-2">
                <Wrench size={18} className="text-indigo-600 dark:text-indigo-300" /> {tx('pageui.hook.help.title', 'Custom Tools คืออะไร ใช้ยังไง')}
              </h2>
              <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-5 text-sm text-slate-700 leading-relaxed">
              <section>
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.what_h', 'มันคืออะไร')}</h3>
                <p>
                  {tx('pageui.hook.help.what_p', 'ที่เก็บ "วิธีคุยกับ API ของเจ้าอื่น" — เก็บไว้ที่เดียวว่าปลายทางอยู่ที่ไหน ใช้รหัสอะไรเข้าระบบ และมีเส้นทางอะไรให้เรียกบ้าง แล้วให้ OA หลายตัวมาใช้ร่วมกันได้')}
                </p>
              </section>

              <section className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <h3 className="font-black text-amber-900 mb-1">{tx('pageui.hook.help.rule_h', 'กฎข้อเดียวที่ต้องจำ')}</h3>
                <p className="text-amber-900/90">
                  <b>{tx('pageui.hook.help.rule_b', '1 tool = 1 ปลายทาง + 1 ชุดรหัส')}</b><br />
                  {tx('pageui.hook.help.rule_same', 'ปลายทางเดียวกัน รหัสเดียวกัน → ใส่เป็นเส้นเพิ่มใน tool เดิม')}<br />
                  {tx('pageui.hook.help.rule_diff', 'คนละปลายทาง หรือคนละรหัส → สร้าง tool ใหม่แยก')}
                </p>
              </section>

              <section>
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.ep_h', 'Endpoint = เส้นทางที่จะเรียก')}</h3>
                <p className="mb-2">
                  {tx('pageui.hook.help.ep_a', 'ใส่ได้')} <b>{tx('pageui.hook.help.ep_b', 'ไม่จำกัดจำนวน')}</b> {tx('pageui.hook.help.ep_c', 'ไม่ใช่แค่โปรไฟล์ลูกค้า — จะเป็นยอดผ่อน แต้มสะสม โปรโมชั่น ประวัติจ่ายเงิน หรืออะไรก็ได้ที่ปลายทางมีให้')}
                </p>
                <div className="bg-slate-50 rounded p-2 font-mono text-[11px] space-y-0.5">
                  <div>INSTALLMENT&nbsp;&nbsp;&nbsp;&nbsp; GET&nbsp; shop-api/v3/installment</div>
                  <div>POINTS&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; GET&nbsp; shop-api/v3/points</div>
                  <div>PROMOTIONS&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; GET&nbsp; shop-api/v3/promotions</div>
                </div>
                <p className="mt-2">
                  <b>KEY</b> {tx('pageui.hook.help.key_p', 'คือชื่อที่เราตั้งเองเพื่อเรียกใช้เส้นนั้น (ห้ามซ้ำกันใน tool เดียว) ตั้งชื่ออะไรก็ได้ ระบบไม่ได้บังคับชื่อไว้ล่วงหน้า')}
                </p>
              </section>

              <section>
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.purpose_h', 'ช่อง "ทำหน้าที่อะไร" ต่างกันยังไง')}</h3>
                <ul className="space-y-1.5">
                  <li>
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-sky-100 text-sky-700">data</span>
                    {' '}<b>{tx('pageui.hook.help.p_data_b', 'อ่านข้อมูล')}</b> {tx('pageui.hook.help.p_data', '— ระบบจะดึงให้อัตโนมัติทุกครั้งที่ลูกค้าทักเข้ามา แล้วเอาไปใช้ในแท็กไดนามิกได้เลย')}
                  </li>
                  <li>
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-700">write</span>
                    {' '}<b>{tx('pageui.hook.help.p_write_b', 'เขียน/แก้ข้อมูล')}</b> {tx('pageui.hook.help.p_write', '— ยิงเฉพาะตอนที่มีคำสั่งจริง ๆ')}
                    <span className="text-rose-600 font-bold"> {tx('pageui.hook.help.p_write_never', 'ห้ามตั้งเป็น data เด็ดขาด')}</span>
                    {' '}{tx('pageui.hook.help.p_write_why', 'ไม่งั้นจะกลายเป็นแก้ข้อมูลปลายทางทุกครั้งที่ลูกค้าทัก')}
                  </li>
                  <li>
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">auth</span>
                    {' '}<b>{tx('pageui.hook.help.p_auth_b', 'เรื่อง token')}</b> {tx('pageui.hook.help.p_auth', '— เส้นเข้าสู่ระบบกับต่ออายุ token ไม่ใช่เส้นดึงข้อมูล')}
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.flags_h', 'ธง 3 อันข้างเส้น (เลือกเฉพาะเส้นที่ใช่)')}</h3>
                <ul className="space-y-1">
                  <li><b>{tx('pageui.hook.help.f_login_b', 'เส้น login')}</b> {tx('pageui.hook.help.f_login', '— เส้นที่เอารหัสไปแลก token · มีได้เส้นเดียว · ถ้าเลือก Auth เป็น JWT ต้องมี')}</li>
                  <li><b>{tx('pageui.hook.help.f_refresh_b', 'เส้น refresh')}</b> {tx('pageui.hook.help.f_refresh', '— เส้นต่ออายุ token ·')} <b>{tx('pageui.hook.help.f_refresh_opt', 'ไม่มีก็ได้')}</b> {tx('pageui.hook.help.f_refresh_rest', 'ไม่มีระบบจะ login ใหม่ให้เอง')}</li>
                  <li><b>{tx('pageui.hook.help.f_profile_b', 'เส้นโปรไฟล์')}</b> {tx('pageui.hook.help.f_profile', '— บอกว่าจะเอา')} <b>{tx('pageui.hook.help.f_profile_what', 'ชื่อ/เบอร์/รหัสลูกค้า')}</b> {tx('pageui.hook.help.f_profile_rest', 'มาจากเส้นไหน เพื่อไปโชว์บนหัวแชท · มีได้เส้นเดียว ·')} <b>{tx('pageui.hook.help.f_profile_opt', 'ไม่เลือกเลยก็ได้')}</b> {tx('pageui.hook.help.f_profile_end', 'เส้นอื่นยังทำงานปกติ')}</li>
                </ul>
                <p className="mt-1.5 text-slate-500">
                  {tx('pageui.hook.help.f_rest', 'เส้นอื่น ๆ ที่เหลือ (ยอดผ่อน แต้ม โปรโมชั่น)')} <b>{tx('pageui.hook.help.f_rest_b', 'ไม่ต้องเลือกอะไรเลย')}</b> {tx('pageui.hook.help.f_rest_c', 'ใส่ KEY กับ path พอ')}
                </p>
              </section>

              <section>
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.pmap_h', 'ตอนเลือก "เส้นโปรไฟล์" จะมีช่องเพิ่มมา')}</h3>
                <p>
                  {tx('pageui.hook.help.pmap_p', 'เพราะปลายทางแต่ละเจ้าเก็บชื่อ/เบอร์ไว้คนละที่ ให้ใส่ตำแหน่งของค่าลงไป เช่น')}
                  <code className="mx-1 px-1 bg-slate-100 rounded text-[11px]">data.profile.phone</code>
                  <b>{tx('pageui.hook.help.pmap_blank', 'เว้นว่างได้')}</b> {tx('pageui.hook.help.pmap_guess', '— ระบบจะเดาจากรูปแบบที่เจอบ่อยให้เอง')}
                </p>
              </section>

              <section>
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.url_h', 'เรื่อง URL กับ path')}</h3>
                <ul className="space-y-1">
                  <li><b>Base URL</b> {tx('pageui.hook.help.url_base', 'ใส่แค่ชื่อเว็บ เช่น')} <code className="px-1 bg-slate-100 rounded text-[11px]">https://api.example.com</code> {tx('pageui.hook.help.url_base_end', 'ไม่ต้องมี / ปิดท้าย')}</li>
                  <li><b>path</b> {tx('pageui.hook.help.url_path', 'ใส่ส่วนที่เหลือ ไม่ต้องมี / นำหน้า — ระบบใส่ให้เอง (ใส่มาก็ตัดให้ ไม่พัง)')}</li>
                  <li>{tx('pageui.hook.help.url_var', 'ค่าที่เปลี่ยนตามลูกค้าให้ใช้')} <code className="px-1 bg-slate-100 rounded text-[11px]">{'{{line_user_id}}'}</code> {tx('pageui.hook.help.url_var_end', 'ระบบจะแทนค่าจริงให้ตอนยิง')}</li>
                </ul>
              </section>

              <section className="rounded-lg bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-400/40 p-3">
                <h3 className="font-black text-indigo-900 mb-1">{tx('pageui.hook.help.curl_h', 'ทางลัด: วาง cURL')}</h3>
                <p className="text-indigo-900/90">
                  {tx('pageui.hook.help.curl_p', 'ถ้ามีคำสั่ง cURL จาก Postman อยู่แล้ว วางลงช่องด้านบนของฟอร์มได้เลย ระบบจะกรอก URL / รหัส / เส้นทาง ให้อัตโนมัติ · ปุ่มวางที่อยู่ข้างแต่ละเส้น จะกรอกเฉพาะเส้นนั้น ไม่ไปยุ่งกับ Base URL')}<br />
                  <b>{tx('pageui.hook.help.curl_b', 'แต่ KEY กับธงต่าง ๆ ต้องตั้งเอง')}</b> {tx('pageui.hook.help.curl_why', 'เพราะระบบเดาแทนไม่ได้')}
                </p>
              </section>

              <section>
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.btn_h', 'ปุ่มในตาราง')}</h3>
                <ul className="space-y-1">
                  <li><b>{tx('pageui.hook.help.btn_test_b', '▶ ทดสอบ')}</b> {tx('pageui.hook.help.btn_test', '— ยิงจริงออกไปปลายทาง ดูว่าเข้าสู่ระบบผ่านไหม เส้นเรียกได้ไหม')}</li>
                  <li><b>{tx('pageui.hook.help.btn_link_b', '🔗 ลิงก์ OA')}</b> {tx('pageui.hook.help.btn_link', '— เลือกว่า OA ไหนใช้ tool นี้ (ทำในฟอร์มตอนสร้าง/แก้ไขก็ได้)')}</li>
                  <li><b>{tx('pageui.hook.help.btn_del_b', '🗑 ลบ')}</b> {tx('pageui.hook.help.btn_del', '— ลบแบบกู้คืนได้ · ถ้ายังมี OA ใช้อยู่ระบบจะไม่ให้ลบ')}</li>
                </ul>
              </section>

              <section className="rounded-lg bg-slate-100 p-3">
                <h3 className="font-black text-slate-900 mb-1">{tx('pageui.hook.help.why_h', 'ทำไมแก้ tool ที่เดียวแล้วทุก OA เปลี่ยนตาม')}</h3>
                <p>
                  {tx('pageui.hook.help.why_p', 'เพราะ OA ทุกตัวชี้มาที่ tool เดียวกัน — เปลี่ยน URL หรือรหัสที่นี่ที่เดียว OA ทั้งหมดที่ใช้อยู่จะเปลี่ยนตามทันที และเข้าสู่ระบบแค่ครั้งเดียวใช้ร่วมกันทุกตัว (ปิดสวิตช์ "เปิดใช้งาน" = OA ทุกตัวที่ใช้ tool นี้หยุดพร้อมกัน)')}
                </p>
              </section>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end sticky bottom-0 bg-white">
              <button onClick={() => setShowHelp(false)}
                className="px-4 py-2 text-sm bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700">{tx('pageui.hook.help.got_it', 'เข้าใจแล้ว')}</button>
            </div>
          </div>
        </div>
      )}

      {alert && (
        <AlertModal isOpen={true} title={alert.title} message={alert.message} onClose={() => setAlert(null)} />
      )}
    </div>
  );
};
// ==== [FEAT-20260729-CUSTOOL] END ====
