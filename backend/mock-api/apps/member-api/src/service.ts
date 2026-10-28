/**
 * Domain rules shared by v1 / v3 / legacy routes — one implementation, three wire formats.
 * Error codes are the ones the backend reads (`body.error.code`):
 *   CUSTOMER_NOT_LINKED (404) · WEB_CODE_NOT_ALLOWED (403) · MEMBER_NOT_FOUND (404)
 *   MEMBER_MISMATCH (422) · ALREADY_LINKED (409) · ACCOUNT_ALREADY_LINKED (409) · NOT_LINKED (404)
 */
import type { Account, MemberData } from './data.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
export const envelope = (e: ApiError) => ({ success: false, error: { code: e.code, message: e.message } });

export interface LinkInput { line_user_id: string; web_code: string; phone_number: string; first_name?: string | undefined; account_number?: string | undefined }

export class MemberService {
  constructor(private readonly data: MemberData) {}

  assertWebCode(webCode: string): void {
    if (!this.data.members.read().web_codes.includes(webCode)) throw new ApiError(403, 'WEB_CODE_NOT_ALLOWED', 'web_code is not registered');
  }

  linked(lineUserId: string, webCode: string): Account {
    this.assertWebCode(webCode);
    const a = this.data.members.read().accounts.find((x) => x.web_code === webCode && x.line_user_id === lineUserId);
    if (!a) throw new ApiError(404, 'CUSTOMER_NOT_LINKED', 'LINE นี้ยังไม่ผูกบัญชี');
    return a;
  }

  profile(lineUserId: string, webCode: string) {
    return { success: true, data: { profile: this.linked(lineUserId, webCode).profile } };
  }

  link(input: LinkInput) {
    this.assertWebCode(input.web_code);
    if (!input.first_name && !input.account_number) throw new ApiError(422, 'MEMBER_MISMATCH', 'first_name or account_number is required');
    return this.data.members.write((d) => {
      if (d.accounts.some((x) => x.web_code === input.web_code && x.line_user_id === input.line_user_id))
        throw new ApiError(409, 'ALREADY_LINKED', 'LINE นี้ผูกบัญชีแล้ว');
      const a = d.accounts.find((x) => x.web_code === input.web_code && x.phone_number === input.phone_number);
      if (!a) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'ไม่พบสมาชิกตามเบอร์โทรนี้');
      const nameOk = !input.first_name || a.first_name.toLowerCase() === input.first_name.trim().toLowerCase();
      const acctOk = !input.account_number || a.account_number === input.account_number.replace(/\D/g, '');
      if (!nameOk || !acctOk) throw new ApiError(422, 'MEMBER_MISMATCH', 'ข้อมูลไม่ตรงกับสมาชิก');
      if (a.line_user_id) throw new ApiError(409, 'ACCOUNT_ALREADY_LINKED', 'บัญชีนี้ผูกกับ LINE อื่นแล้ว');
      a.line_user_id = input.line_user_id;
      a.profile['line_user_id'] = input.line_user_id;
      return { success: true, data: { member_id: a.member_id, phone_number: a.phone_number, name: a.first_name } };
    });
  }

  edit(lineUserId: string, webCode: string, patch: { phone_number?: string | undefined; first_name?: string | undefined; account_number?: string | undefined }) {
    this.linked(lineUserId, webCode);
    return this.data.members.write((d) => {
      const a = d.accounts.find((x) => x.web_code === webCode && x.line_user_id === lineUserId);
      if (!a) throw new ApiError(404, 'CUSTOMER_NOT_LINKED', 'LINE นี้ยังไม่ผูกบัญชี');
      if (patch.phone_number) { a.phone_number = patch.phone_number; a.profile['phone'] = patch.phone_number; }
      if (patch.first_name) a.first_name = patch.first_name;
      if (patch.account_number) a.account_number = patch.account_number.replace(/\D/g, '');
      return { success: true, data: { member_id: a.member_id, phone_number: a.phone_number, name: a.first_name } };
    });
  }

  unlink(lineUserId: string, webCode: string) {
    this.assertWebCode(webCode);
    return this.data.members.write((d) => {
      const a = d.accounts.find((x) => x.web_code === webCode && x.line_user_id === lineUserId);
      if (!a) throw new ApiError(404, 'NOT_LINKED', 'LINE นี้ยังไม่ผูกบัญชี');
      a.line_user_id = null;
      a.profile['line_user_id'] = '';
      return { success: true, data: { member_id: a.member_id, unlinked: true } };
    });
  }

  siteRules(webCode: string) {
    this.assertWebCode(webCode);
    return { success: true, data: { shop: this.data.site.read().shop } };
  }

  /** validate-slip verdict, shaped like the live answer (`data.slip_status.{status,message,img_url}`). */
  topup(lineUserId: string, webCode: string, payload: string | undefined) {
    const a = this.linked(lineUserId, webCode);
    const env = parseEnvelope(payload);
    return this.data.members.write((d) => {
      const STATUS: Record<Account['topup_scenario'], [string, string]> = {
        success: ['success', 'เติมแต้มสำเร็จ'],
        reject: ['account-not-match', 'บัญชีผู้รับไม่ตรงบัญชีระบบ'],
        'member-not-match': ['member-not-match', 'ชื่อผู้โอนไม่ตรงกับสมาชิก'],
        fail: ['fail', 'ตรวจสลิปไม่ผ่าน'],
      };
      let [status, message] = STATUS[a.topup_scenario];
      if (env.transRef && d.used_trans_refs.includes(env.transRef)) [status, message] = ['duplicate', 'สลิปนี้ถูกใช้แล้ว'];
      else if (status === 'success' && env.transRef) d.used_trans_refs.push(env.transRef);
      return {
        success: true,
        data: {
          phone_number: a.phone_number,
          slip_status: { status, message, img_url: `https://images.example-crm.dev/slip/${env.transRef ?? 'unknown'}.jpg` },
          payload: { member_id: a.member_id, amount: env.amount, trans_ref: env.transRef },
        },
      };
    });
  }
}

/** The slip-check envelope the backend forwards in `payload` (JSON). Only transRef/amount are used. */
function parseEnvelope(payload: string | undefined): { transRef: string | null; amount: number | null } {
  if (!payload) return { transRef: null, amount: null };
  try {
    const p = JSON.parse(payload) as { data?: { transRef?: string; amountInSlip?: number; rawSlip?: { transRef?: string; amount?: { amount?: number } } } };
    const d = p.data ?? {};
    return { transRef: d.rawSlip?.transRef ?? d.transRef ?? null, amount: d.amountInSlip ?? d.rawSlip?.amount?.amount ?? null };
  } catch {
    return { transRef: null, amount: null };
  }
}
