/**
 * ==== [FEAT-20260729-CUSTOOL] START (branch: to_dev_auto เท่านั้น) ====
 *
 * customToolService — เรียก API ของตาราง custom_tools (BE: legacy-api)
 * ใช้กับเส้นทาง acme_category = false
 *
 * ทุกเส้นต้องมีสิทธิ์ custom_tools.manage (BE authorize ไว้แล้ว)
 * ไม่มีสิทธิ์ = 403 · เมนูฝั่ง FE ก็ซ่อนด้วย permission ตัวเดียวกัน
 *
 * ⚠️ password / api_key: BE ไม่เคยส่งค่าจริงกลับมา ส่งมาแค่ has_password /
 * has_api_key เป็น boolean → ฟอร์มเว้นว่าง = ไม่แตะของเดิม (ดู CustomTools.tsx)
 *
 * revert: ลบไฟล์นี้ + pages/CustomTools.tsx + route ใน App.tsx
 * ==== [FEAT-20260729-CUSTOOL] ====
 */
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

/** endpoint 1 เส้นใน tool — "รู้ตัวเอง" ว่าใช้ทำอะไร/ต้อง JWT ไหม/ยิงแบบไหน */
export interface CustomToolEndpoint {
  _id?: string;
  key: string;                    // ชื่อที่โค้ดใช้เรียก เช่น CUSTOMER_LOOKUP (ห้ามซ้ำใน tool)
  label?: string;                 // ชื่อไทยไว้โชว์
  purpose?: 'auth' | 'data' | 'write';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;                   // รองรับ {{line_user_id}} {{web_code}} ฯลฯ
  /** [FEAT-20260903-TOPUPPERPROVIDER] เส้นนี้ให้บริการ slip provider ตัวไหน
   *  '' / ไม่ใส่ = ทุกเจ้า (ค่าเดิมของทุก record — Swiftcheck ไม่ต้องตั้งอะไร)
   *  มีความหมายเฉพาะเส้น role `pay_topup` · walletpay ไม่แยกรายเจ้า (คำตัดสิน 03/09) */
  slip_provider?: string;
  require_jwt?: boolean;
  is_login?: boolean;             // เส้น login (มีได้ ≤1)
  is_refresh?: boolean;           // เส้น refresh — optional (มีได้ ≤1)
  is_profile?: boolean;           // เส้นโปรไฟล์ลูกค้า (มีได้ ≤1)
  request_type?: 'json' | 'form' | 'form-data';
  payload?: Record<string, any>;
  token_path?: string;            // อ่าน token จากตรงไหน เช่น data.access_token
  refresh_token_path?: string;
  // 3rd-party แต่ละเจ้าคืนโครงสร้างต่างกัน → ตั้ง path เองได้ ไม่ต้องแก้โค้ด
  profile_map?: { name?: string; phone?: string; code?: string };
  status?: boolean;
  // ==== [FEAT-20260729-EPROLE] START (branch to_dev_custom_adapter) ====
  // role = "หน้าที่" ของเส้น — BE หาเส้นด้วย role ก่อน แล้วค่อย fallback ชื่อ key
  // → ตั้งชื่อ key ตามปลายทางจริงได้อิสระ ไม่ต้องล็อกชื่อ CUSTOMER_*
  // ค่าว่าง = tool เก่า ทำงานแบบเดิม (หาด้วยชื่อ key) ไม่ต้อง migrate
  // revert: ลบ field นี้ + role/result_rules/result_map ใน normalizeEndpoint
  /**
   * [FEAT-20260809-PAYROLES] ต้องตรงกับ ENDPOINT_ROLES ฝั่ง BE
   * (custom-tool-normalize.ts) — role ที่ไม่อยู่ในลิสต์นั้น BE จะ coerce เป็น ''
   * ทิ้งเงียบ ๆ ตอนบันทึก. `site_rules` เคยขาดจาก type นี้ทั้งที่ BE รับมานานแล้ว
   * และ pay_topup/pay_walletpay ก็ขาดไปด้วย ทำให้ template ที่ตั้ง role พวกนี้
   * คอมไพล์ไม่ผ่าน. เพิ่ม role ใหม่ที่ BE = ต้องมาเพิ่มที่นี่ในการแก้ครั้งเดียวกัน.
   */
  role?:
    | ''
    | 'profile'
    | 'link'
    | 'edit'
    | 'unlink'
    | 'login'
    | 'refresh'
    | 'site_rules'
    | 'pay_topup'
    | 'pay_walletpay'
    | 'other';
  // ==== [FEAT-20260729-RESULTMAP] กติกาอ่านผลจาก body (ปลายทางที่ตอบ 200 เสมอ)
  // เรียงบนลงล่าง ข้อแรกที่ตรงชนะ · ตั้งแล้วไม่มีข้อไหนตรง = ล้มเหลว (LINK_UNKNOWN)
  // ไม่ตั้ง = ตัดสินจาก HTTP status เหมือนเดิม (ของเก่าไม่กระทบ)
  result_rules?: Array<{
    path?: string;                 // เช่น result.status
    op?: 'eq' | 'neq' | 'in' | 'exists' | 'not_exists' | 'contains';
    value?: string;
    http_codes?: string;           // เช่น "429,503" — กฎที่ดู HTTP status
    action?: 'success' | 'fail';
    failure_type?: '' | 'business' | 'config' | 'transient' | 'system';
    error_code?: string;           // รหัสกลางของเรา เช่น LINK_ACCOUNT_NOT_FOUND
    message_path?: string;         // path ของ error message ฝั่งปลายทาง (เก็บดิบไว้ดู)
  }>;
  // แปลผลของเส้น write กลับเป็นชื่อกลางของเรา (เช่น memberRef → member_id)
  result_map?: { member_id?: string; phone?: string; name?: string };
  // ==== [FEAT-20260729-EPROLE] END ====
  // ==== [FEAT-20260730-IDEMPOTENT] START — กันทำซ้ำเมื่อ timeout
  // timeout = "ไม่รู้ผล" ไม่ใช่ "ล้มเหลว" — แนบกุญแจไปด้วยแล้วยิงซ้ำได้ปลอดภัย
  // ⚠️ เปิดได้ต่อเมื่อ **ปลายทางรองรับ** เท่านั้น (ต้องถามเจ้าของ API ก่อน)
  // revert: ลบ field นี้ + block ใน normalizeEndpoint + UI ใน CustomTools.tsx
  idempotency?: {
    enabled?: boolean;
    location?: 'header' | 'body';   // ส่งเป็น header หรือแทรกเป็น field ใน body
    field?: string;                 // ชื่อ header/field ตามที่ปลายทางกำหนด
    retry_on_timeout?: number;      // ยิงซ้ำกี่ครั้งเมื่อไม่ได้คำตอบ (0-3)
  };
  // ==== [FEAT-20260730-IDEMPOTENT] END
}

// ==== [FEAT-20260731-HMACAUTH] START — สูตรลายเซ็น (ทุกช่องไม่บังคับ)
// ไม่ส่งอะไรมาเลย = BE ใช้สูตรของ Shop-API ให้เอง
// ตัวแปรที่อ้างได้: {{web_code}} {{timestamp}} {{payload}} {{payload_sha256}}
//                  {{nonce}} {{method}} {{path}} {{url}} · {{signature}} (เฉพาะ headers)
// revert: ลบ interface นี้ + field hmac ใน CustomToolEntry/normalizeTool
export interface CustomToolHmac {
  algorithm?: string;
  encoding?: string;
  message?: string;
  headers?: Record<string, string>;
  timestamp_unit?: string;
  canonical_json?: boolean;
  web_code_field?: string;
}
// ==== [FEAT-20260731-HMACAUTH] END

// ==== [FEAT-20260808-PAYCUSTOOL] START — หมวด "payment" ของ custom tool
// WHAT: tool มี `category` เพิ่มมา — 'generic' = ของเดิมทุกตัว · 'payment' = tool ที่
//       ใช้ตรวจสลิป (statement → topup → walletpay) ซึ่งพก object `payment` มาด้วย
// WHY : แยกเป็น category แทนที่จะยัด field ใหม่เข้า tool ทุกตัว → tool เดิมไม่มีอะไรเปลี่ยน
//       ไม่ต้อง migrate และ UI ซ่อนช่องที่ไม่เกี่ยวออกไปได้ทั้งก้อน
// HOW : จะเพิ่ม knob ใหม่ ให้เพิ่มที่ CustomToolPaymentConfig + EMPTY_PAYMENT (ค่าเริ่มต้น)
//       + normalizePayment (ตอนอ่านกลับ) + UI ใน pages/hook/CustomTools.tsx
//
// ⚠️ สำคัญที่สุด: **BE ตัด key ที่ไม่อยู่ในลิสต์นี้ทิ้งเงียบ ๆ ตอนบันทึก**
//    ใส่ชื่อ field ผิดตัวเดียว = ค่าหายไปโดยไม่มี error ให้เห็น
//    → ห้ามคิด field ขึ้นมาเอง ต้องตรงกับสัญญาฝั่ง BE เป๊ะ ๆ
export interface CustomToolPaymentConfig {
  // ── กลุ่ม "การเชื่อมต่อ/การจับคู่" — บอกระบบว่าข้อมูลอยู่ตรงไหนของ response ──
  statement_tx_path: string;          // dot-path ไปยัง "รายการเดินบัญชี" ใน response
  statement_provider_code: string;    // กรองเฉพาะ provider นี้
  /** ⚠️ '' (ว่าง) = **ไม่กรองสถานะ** ไม่ใช่ "ใช้ค่าเริ่มต้น" — ห้ามแปลง '' เป็นค่า default */
  statement_status: string;
  walletpay_ref_id_field: string;        // ชื่อ field ที่ walletpay ใช้รับเลขอ้างอิง
  walletpay_ref_id_query_param: string;  // ชื่อ query param ของเลขอ้างอิง
  walletpay_file_field: string;          // ชื่อ field ที่ใช้แนบไฟล์สลิป
  topup_payload_path: string;         // '' = ส่งผลลัพธ์ verify ทั้งก้อน
  /** key = ชื่อ field ฝั่ง walletpay · value = dot-path ใน response ของ topup */
  topup_to_walletpay_map: Record<string, string>;

  // ── กลุ่ม "ข้อความตอบลูกค้า" — ทุกช่อง '' = ใช้ข้อความไทยเริ่มต้นของ BE ──
  reply_success_text: string;     // เติมเงินสำเร็จ (ครอบคลุมทั้ง topup และ walletpay)
  pending_reply_text: string;     // จับคู่ได้แล้ว แต่รอแอดมินยืนยัน
  no_match_reply_text: string;    // สลิปนี้ไม่ตรง — ลูกค้าได้ปุ่ม [ลองใหม่]
  review_reply_text: string;      // ไม่ทราบผล/หมดเวลา — ต้องให้คนดู
  not_found_reply_text: string;   // ไม่เจอรายการที่ตรงเลย — ลูกค้าส่งใหม่ได้
  /**
   * [FEAT-20260809-PAYNOTLINK] LINE ของลูกค้ายังไม่ได้ผูกกับบัญชีเว็บ
   * Shop-API ตอบ 404 CUSTOMER_NOT_LINKED · BE **ปล่อยสลิปคืน** ไม่ล็อกไว้รอแอดมินตรวจ
   * เพราะลูกค้าแก้เองได้ในไม่กี่วินาที (ผูกบัญชีแล้วส่งสลิปใหม่) ไม่ต้องรบกวนคน
   */
  not_linked_reply_text: string;
  reply_detail: string;           // บรรทัดรายละเอียดใต้ข้อความ (BE ใส่ "-" ให้ถ้าเว้นว่าง)
}

/**
 * ค่าเริ่มต้นของฝั่ง BE — ใช้ 2 ที่: (1) เติมให้ tool ใหม่ (2) เป็น placeholder ในช่องกรอก
 * WHERE TO EDIT WHAT: แก้ค่าตรงนี้ที่เดียว แล้วทั้งฟอร์มกับ placeholder เปลี่ยนตาม
 * ⚠️ statement_status: ค่านี้เป็นแค่ "ค่าตั้งต้นตอนสร้างใหม่" — ถ้าผู้ใช้ลบจนว่าง
 *    ต้องเซฟเป็น '' ตามที่ผู้ใช้ตั้งใจ (= ปิดการกรองสถานะ)
 */
export const PAYMENT_DEFAULTS: CustomToolPaymentConfig = {
  statement_tx_path: 'data.profile.transaction',
  statement_provider_code: 'walletpay',
  statement_status: 'waiting-deposit',
  walletpay_ref_id_field: 'ref_id',
  walletpay_ref_id_query_param: 'refid',
  walletpay_file_field: 'slip',
  topup_payload_path: '',
  topup_to_walletpay_map: {},
  reply_success_text: '',
  pending_reply_text: '',
  no_match_reply_text: '',
  review_reply_text: '',
  not_found_reply_text: '',
  not_linked_reply_text: '',   // [FEAT-20260809-PAYNOTLINK]
  reply_detail: '',
};

/**
 * อ่านค่า payment ที่ BE ส่งกลับมา ให้เป็นรูปที่ฟอร์มใช้ได้เสมอ (ไม่มี undefined)
 * ⚠️ statement_status ใช้ `?? default` **ไม่ใช่** `|| default` — เพราะ '' ที่ผู้ใช้ตั้งใจ
 *    ต้องรอดกลับมาเป็น '' ถ้าใช้ `||` จะถูกเด้งกลับเป็น 'waiting-deposit' ทุกครั้งที่เปิดฟอร์ม
 *    (ช่องอื่นใช้ ?? เหมือนกันหมดเพื่อความสม่ำเสมอ)
 */
const normalizePayment = (p: any): CustomToolPaymentConfig => ({
  statement_tx_path: p?.statement_tx_path ?? PAYMENT_DEFAULTS.statement_tx_path,
  statement_provider_code: p?.statement_provider_code ?? PAYMENT_DEFAULTS.statement_provider_code,
  statement_status: p?.statement_status ?? PAYMENT_DEFAULTS.statement_status,
  walletpay_ref_id_field: p?.walletpay_ref_id_field ?? PAYMENT_DEFAULTS.walletpay_ref_id_field,
  walletpay_ref_id_query_param: p?.walletpay_ref_id_query_param ?? PAYMENT_DEFAULTS.walletpay_ref_id_query_param,
  walletpay_file_field: p?.walletpay_file_field ?? PAYMENT_DEFAULTS.walletpay_file_field,
  topup_payload_path: p?.topup_payload_path ?? PAYMENT_DEFAULTS.topup_payload_path,
  topup_to_walletpay_map:
    p?.topup_to_walletpay_map && typeof p.topup_to_walletpay_map === 'object' && !Array.isArray(p.topup_to_walletpay_map)
      ? { ...p.topup_to_walletpay_map }
      : {},
  reply_success_text: p?.reply_success_text ?? '',
  pending_reply_text: p?.pending_reply_text ?? '',
  no_match_reply_text: p?.no_match_reply_text ?? '',
  review_reply_text: p?.review_reply_text ?? '',
  not_found_reply_text: p?.not_found_reply_text ?? '',
  not_linked_reply_text: p?.not_linked_reply_text ?? '',   // [FEAT-20260809-PAYNOTLINK]
  reply_detail: p?.reply_detail ?? '',
});
// ==== [FEAT-20260808-PAYCUSTOOL] END

export interface CustomToolEntry {
  id: string;
  name: string;
  description: string;
  base_url: string;
  // [FEAT-20260808-PAYCUSTOOL] tool เดิมที่ BE ยังไม่ได้ตั้ง category ให้ = 'generic'
  /* [FEAT-20260815-WALLETPAYCAT] `'walletpay'` — ต้องตรงกับ `TOOL_CATEGORIES` ฝั่ง BE
     (`custom-tool-normalize.ts`) · tool ที่มีเฉพาะเส้น pay_walletpay จะได้หมวดนี้
     และผูกกับ hook คนละช่อง (`walletpay_tool_id`) กับหมวด payment */
  category: 'generic' | 'payment' | 'walletpay';
  /** มีค่าเมื่อ category === 'payment' เท่านั้น (tool generic เป็น undefined) */
  payment?: CustomToolPaymentConfig;
  // [FEAT-20260731-HMACAUTH] hmac_signature = ปลายทางไม่มี login/token
  // แต่ให้เซ็นทุก request ด้วย shared secret (Shop-API ตัวจริง)
  auth_type: 'jwt_login' | 'api_key' | 'basic' | 'none' | 'hmac_signature';
  /** [FEAT-20260731-HMACAUTH] สูตรเซ็น — ไม่ตั้ง = ใช้ค่าเริ่มต้น (สูตรของ Shop-API) */
  hmac?: CustomToolHmac;
  username: string;
  has_password: boolean;          // BE ไม่ส่งค่าจริง — บอกแค่ตั้งไว้แล้วไหม
  has_api_key: boolean;
  api_key_header: string;
  timeout_ms: number;
  status: boolean;
  endpoints: CustomToolEndpoint[];
  created_by?: any;
  updated_by?: any;
  created_at?: string;
  updated_at?: string;
}

export interface CustomToolUsage {
  count: number;
  active: number;
  hooks: Array<{
    _id: string;
    alias?: string;
    name?: string;
    line_oa_name?: string;
    group?: { name?: string };
    custom_tool_status?: boolean;
  }>;
}

const normalizeEndpoint = (e: any): CustomToolEndpoint => ({
  _id: e?._id,
  key: e?.key ?? '',
  label: e?.label ?? '',
  purpose: e?.purpose ?? 'data',
  method: (e?.method ?? 'GET') as CustomToolEndpoint['method'],
  path: e?.path ?? '',
  /* [FIX-20261014-SLIPPROVROUNDTRIP] carried back, or the form reopens blank and the next save
     posts '' over the operator's binding (BE accepts and stores this field). '' = every provider. */
  slip_provider: e?.slip_provider ?? '',
  require_jwt: e?.require_jwt !== false,
  is_login: !!e?.is_login,
  is_refresh: !!e?.is_refresh,
  is_profile: !!e?.is_profile,
  request_type: e?.request_type ?? 'json',
  payload: e?.payload ?? {},
  token_path: e?.token_path ?? 'data.access_token',
  refresh_token_path: e?.refresh_token_path ?? 'data.refresh_token',
  profile_map: {
    name: e?.profile_map?.name ?? '',
    phone: e?.profile_map?.phone ?? '',
    code: e?.profile_map?.code ?? '',
  },
  status: e?.status !== false,
  // [FEAT-20260729-EPROLE] additive — ของเก่าไม่มี field พวกนี้ก็ได้ค่าว่างปลอดภัย
  role: e?.role ?? '',
  result_rules: Array.isArray(e?.result_rules) ? e.result_rules : [],
  result_map: {
    member_id: e?.result_map?.member_id ?? '',
    phone: e?.result_map?.phone ?? '',
    name: e?.result_map?.name ?? '',
  },
  // [FEAT-20260730-IDEMPOTENT] ปิดเป็นค่าเริ่มต้น — tool เดิมไม่มี field นี้ก็ปลอดภัย
  idempotency: {
    enabled: e?.idempotency?.enabled === true,
    location: e?.idempotency?.location === 'body' ? 'body' : 'header',
    field: e?.idempotency?.field ?? 'Idempotency-Key',
    retry_on_timeout: Number(e?.idempotency?.retry_on_timeout) || 0,
  },
});

const normalizeTool = (raw: any): CustomToolEntry => ({
  id: raw?._id ?? raw?.id ?? '',
  name: raw?.name ?? '',
  description: raw?.description ?? '',
  base_url: raw?.base_url ?? '',
  /* ==== [NOTE-20260902-WALLETPAYCATDROP] these two lines do not know 'walletpay' ====
   *
   * WHAT THEY DO to a tool the BE stores as `category: 'walletpay'`: it reads back
   * as `'generic'` with `payment: undefined`, so the whole payment block is
   * dropped on read. The edit form then fills the defaults, and saving posts a
   * defaults-only block — resetting EVERY knob on that tool, not one. The block
   * is collapsed by default for walletpay, so nobody watching the screen sees it.
   *
   * ⚠️ NOT HAPPENING TODAY, and the measurement matters more than the reasoning:
   * on the working database `custom_tools` holds 294 rows with no category at
   * all, 3 `payment` and 1 `generic` — and ZERO `walletpay`. So this branch has
   * never been taken. An earlier version of this note claimed the reset was
   * already occurring on every save; that was wrong and is corrected here.
   *
   * 🔴 BUT IT IS ARMED, and an ordinary save is the trigger. The BE recomputes
   * the category from the endpoint roles on update and writes it when it differs
   * (`custom-tools.service.ts`, `deriveCategory`). Two stored tools have only a
   * `pay_walletpay` role and are stored as `generic` / `payment`, so both would be
   * rewritten to `'walletpay'` the next time anyone saves them from this dashboard —
   * and from that moment their payment block is dropped on every read. One hook
   * is already using a separate walletpay tool (`walletpay_tool_status: true`).
   *
   * NOT FIXED HERE, deliberately: it is pre-existing, it is not what this branch
   * is for, and the fix changes what an operator's saves do to their own stored
   * settings. Owner's call. The fix itself is small — accept `'walletpay'` in both
   * lines — but it needs its own test and its own decision.
   *
   * ⇒ CONSEQUENCE FOR THIS BRANCH: `slip_provider` is protected on
   * `category: 'payment'` tools only. A walletpay tool loses it with everything
   * else. */
  // [FEAT-20260808-PAYCUSTOOL] tool เดิมไม่มี field นี้ → 'generic' = ทำงานเหมือนเดิมทุกอย่าง
  category: raw?.category === 'payment' ? 'payment' : 'generic',
  // แปลง payment เฉพาะ tool ที่เป็นหมวด payment จริง ๆ — ของ generic ปล่อย undefined
  // ไม่ให้มี object เปล่าติดไปกับ payload ตอนเซฟ
  payment: raw?.category === 'payment' ? normalizePayment(raw?.payment) : undefined,
  auth_type: raw?.auth_type ?? 'jwt_login',
  // [FEAT-20260731-HMACAUTH] ไม่มีค่า = ปล่อย undefined ให้ BE ใช้ค่าเริ่มต้น
  hmac: raw?.hmac ?? undefined,
  username: raw?.username ?? '',
  has_password: !!raw?.has_password,
  has_api_key: !!raw?.has_api_key,
  api_key_header: raw?.api_key_header ?? 'Authorization',
  timeout_ms: Number(raw?.timeout_ms) || 8000,
  status: raw?.status !== false,
  endpoints: Array.isArray(raw?.endpoints) ? raw.endpoints.map(normalizeEndpoint) : [],
  created_by: raw?.created_by ?? null,
  updated_by: raw?.updated_by ?? null,
  created_at: raw?.created_at ?? '',
  updated_at: raw?.updated_at ?? '',
});

export const customToolService = {
  listCustomTools: async (
    params: { page?: number; limit?: number; search?: string; status?: string } = {}
  ): Promise<{ data: CustomToolEntry[]; pagination: any }> => {
    const q = new URLSearchParams();
    q.append('page', String(params.page ?? 1));
    q.append('limit', String(params.limit ?? 25));
    if (params.search) q.append('search', params.search);
    if (params.status) q.append('status', params.status);

    try {
      const res = await authFetch(`${API_BASE_URL}/api/custom-tools?${q.toString()}`);
      if (res.status === 404) {
        return { data: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } };
      }
      const parsed = await handleApiResponse<any>(res, 'list custom tools');
      const rows = Array.isArray(parsed?.data) ? parsed.data : [];
      return {
        data: rows.map(normalizeTool),
        pagination: parsed?.pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
      };
    } catch (error) {
      console.error('Failed to list custom tools:', error);
      return { data: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } };
    }
  },

  getCustomTool: async (id: string): Promise<CustomToolEntry> => {
    const res = await authFetch(`${API_BASE_URL}/api/custom-tools/${id}`);
    const parsed = await handleApiResponse<any>(res, 'get custom tool');
    return normalizeTool(parsed?.data ?? parsed);
  },

  createCustomTool: async (data: any): Promise<CustomToolEntry> => {
    const res = await authFetch(`${API_BASE_URL}/api/custom-tools`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<any>(res, 'create custom tool');
    return normalizeTool(parsed?.data ?? parsed);
  },

  updateCustomTool: async (id: string, data: any): Promise<CustomToolEntry> => {
    const res = await authFetch(`${API_BASE_URL}/api/custom-tools/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<any>(res, 'update custom tool');
    return normalizeTool(parsed?.data ?? parsed);
  },

  /** soft delete — BE บล็อกถ้ายังมี OA ใช้อยู่ (คืน 400 + รายชื่อ) */
  deleteCustomTool: async (id: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/custom-tools/${id}`, { method: 'DELETE' });
    if (res.status === 204) return { success: true };
    return handleApiResponse<any>(res, 'delete custom tool');
  },

  /** ยิงจริงออกไปปลายทาง (login + endpoint ที่เลือก) — ไม่เขียน token ลูกค้าจริง */
  testCustomTool: async (id: string, endpointKey?: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/custom-tools/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ endpoint_key: endpointKey || null }),
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<any>(res, 'test custom tool');
    return parsed?.data ?? parsed;
  },

  /**
   * [FEAT-20260729-CUSTOOL] ทดสอบ config ที่ยัง "ไม่ได้บันทึก" (ตอนกรอกฟอร์ม)
   * ส่ง config สดไปทั้งก้อน → BE ยิงจริงแล้วคืน JSON ดิบมาให้ดู
   * ไม่แตะ DB · token ในผลลัพธ์ถูกปิดบังจากฝั่ง BE แล้ว
   */
  testDraft: async (draft: any, endpointKey?: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/custom-tools/test-draft`, {
      method: 'POST',
      body: JSON.stringify({ ...draft, endpoint_key: endpointKey || null }),
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<any>(res, 'test draft custom tool');
    return parsed?.data ?? parsed;
  },

  /** "tool นี้มี OA ไหนใช้บ้าง" — BE query จาก hooks (ไม่มีสำเนา oa_ids) */
  getUsage: async (id: string): Promise<CustomToolUsage> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/custom-tools/${id}/usage`);
      const parsed = await handleApiResponse<any>(res, 'get custom tool usage');
      const d = parsed?.data ?? parsed;
      return { count: d?.count ?? 0, active: d?.active ?? 0, hooks: d?.hooks ?? [] };
    } catch (error) {
      console.error('Failed to get usage:', error);
      return { count: 0, active: 0, hooks: [] };
    }
  },

  /**
   * ติ๊ก multi OA จากหน้า Custom Tools
   * BE จะไปเขียน hook.custom_tool_id ให้ทีละตัว (ยังเก็บทางเดียว ไม่ denormalize)
   */
  assignOAs: async (id: string, hookIds: string[], activate = false): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/custom-tools/${id}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ hook_ids: hookIds, activate }),
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<any>(res, 'assign custom tool');
    return parsed?.data ?? parsed;
  },
};
// ==== [FEAT-20260729-CUSTOOL] END ====
