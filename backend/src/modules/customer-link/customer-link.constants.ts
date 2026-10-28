/**
 * Fixed responses and tunables for the customer-link module.
 *
 * Every string here is copied VERBATIM from
 * `legacy-api/src/customer-link/controllers/customerLinkController.js` and
 * `.../adapter/customerLinkAdapter.js`. They are customer-facing copy that the
 * landing page (a separate repo, `example-org/customer-landing`) branches on
 * by `error.code`, so a reworded message is a broken screen — do not "improve"
 * any of them.
 */

/** Shape every customer-link handler resolves to before it is serialised. */
export interface LinkResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: LinkError;
}

export interface LinkError {
  code: string;
  message: string;
  failure_type?: string;
  outcome_unknown?: boolean;
  retried?: number;
  log_id?: string;
}

/** How long a minted landing link stays usable — legacy controller line 61. */
export const LINK_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Admin tokens (mode=edit/register) expire sooner than customer ones because
 * they grant the power to edit someone else's linkage — legacy line 66.
 */
export const ADMIN_TOKEN_TTL_MS = 15 * 60 * 1000;

export const INVALID_LINK_TOKEN: LinkResult = {
  ok: false,
  status: 400,
  error: {
    code: 'CUSTOMER_LINK_INVALID_LINK_TOKEN',
    message: 'ลิงก์ไม่ถูกต้อง กรุณาเปิดลิงก์จากแชทอีกครั้ง',
  },
};

/**
 * Expiry gets its own code, separate from a bad token: the customer did nothing
 * wrong, they just came back too late, and the UI should say exactly that.
 */
export const EXPIRED_LINK_TOKEN: LinkResult = {
  ok: false,
  status: 400,
  error: {
    code: 'CUSTOMER_LINK_EXPIRED_LINK',
    message: 'ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่จากแชท',
  },
};

/** Rejects a customer token replayed at an admin-only route. */
export const NOT_ADMIN_TOKEN: LinkResult = {
  ok: false,
  status: 403,
  error: {
    code: 'CUSTOMER_LINK_NOT_ADMIN_TOKEN',
    message:
      'ลิงก์นี้ไม่ใช่ลิงก์สำหรับแอดมิน กรุณากดปุ่มจากหน้า Ticket อีกครั้ง',
  },
};

/**
 * Canonical link error copy — legacy `customToolService.CANONICAL_LINK_ERRORS`.
 * Used when an endpoint's `result_rules` produced a verdict code but no vendor
 * message to show the customer.
 */
export const CANONICAL_LINK_ERRORS: Record<string, string> = {
  LINK_OK: 'สำเร็จ',
  LINK_INVALID_CREDENTIALS: 'ข้อมูลยืนยันตัวตนไม่ถูกต้อง',
  LINK_ACCOUNT_NOT_FOUND: 'ไม่พบบัญชีที่ตรงกับข้อมูลนี้',
  LINK_ALREADY_LINKED: 'บัญชีนี้ถูกผูกไว้แล้ว',
  LINK_REJECTED_BY_VENDOR: 'ปลายทางปฏิเสธคำขอ',
  LINK_VENDOR_UNAVAILABLE: 'ปลายทางไม่พร้อมใช้งานชั่วคราว',
  LINK_TIMEOUT: 'หมดเวลารอปลายทาง (ผลลัพธ์ไม่แน่นอน)',
  LINK_CONFIG_ERROR: 'ตั้งค่าเชื่อมต่อไม่ถูกต้อง',
  LINK_UNKNOWN: 'ปลายทางตอบด้วยรหัสที่ระบบยังไม่รู้จัก',
};

/** adapter op → endpoint key in `custom_tools` (legacy OP_TO_ENDPOINT). */
export const OP_TO_ENDPOINT: Record<string, string> = {
  lookup: 'CUSTOMER_LOOKUP',
  match: 'CUSTOMER_MATCH',
  update: 'CUSTOMER_UPDATE',
  edit: 'CUSTOMER_EDIT',
  unlink: 'CUSTOMER_UNLINK',
};

/** adapter op → endpoint role; the key above is only the fallback. */
export const OP_TO_ROLE: Record<string, string> = {
  lookup: 'profile',
  match: 'link',
  update: 'edit',
  edit: 'edit',
  unlink: 'unlink',
};

/** role → fallback endpoint key, for `/admin/capabilities` (legacy describeRoles). */
export const ROLE_FALLBACK_KEY: Record<string, string> = {
  profile: 'CUSTOMER_LOOKUP',
  link: 'CUSTOMER_MATCH',
  edit: 'CUSTOMER_EDIT',
  unlink: 'CUSTOMER_UNLINK',
  login: 'LOGIN',
  refresh: 'REFRESH',
};

/** The four roles `/admin/capabilities` reports on, in legacy's order. */
export const CAPABILITY_ROLES = ['profile', 'link', 'edit', 'unlink'] as const;
