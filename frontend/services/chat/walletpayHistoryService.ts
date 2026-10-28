/**
 * ==== [FEAT-20260816-WALLETPAYCARD] WalletPay result feed for the ticket panel ====
 *
 * ONE read-only call behind the "ผลตรวจ WalletPay" card:
 *   GET /api/chat/member/:lineUserId/walletpay-history?page=&limit=
 *
 * The BE masks every id-shaped value BEFORE it answers (≈70% hidden), and the
 * card masks again when it renders the raw modal — two independent layers, so a
 * gap in either one still leaves the value covered. ฝั่ง BE ปิดมาแล้ว หน้าเว็บปิดซ้ำ.
 *
 * ⚠️ NEVER THROWS. The BE already answers an empty page instead of an error, and
 * this adds the second net for transport failures: a dead network yields an
 * empty page, so the card shows "ไม่มีรายการ" and the ticket screen is unaffected.
 * การ์ดนี้พังได้ แต่ห้ามลากหน้า ticket พังไปด้วย.
 *
 * revert: delete this file + its line in `services/chat/index.ts` + the
 *         `components/member/walletpay/` folder.
 */
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

export interface WalletpayHistoryRow {
  id: string;
  /** ISO string, or null when the stored row had no timestamp */
  at: string | null;
  /** 'TRUE' | 'FALSE' | 'TIMEOUT' as recorded by the runner */
  outcome: string;
  reason: string;
  review_reason: string;
  http_status: number | null;
  /** refId — readable on purpose (an admin pastes it into walletpay's console) */
  ref: string;
  /** [FEAT-20260816-WALLETPAYSTMT] the deposit row this leg fired against */
  statement_id: string;
  statement_amount: number | null;
  /** [FEAT-20260816-WALLETPAYTRACE] where to find this event in the handoff log */
  run_id: string;
  job_ref: string;
  target: string;
  /** masked request + response + context — what the ⓘ modal shows */
  raw: unknown;
}

export interface WalletpayHistoryPage {
  rows: WalletpayHistoryRow[];
  page: number;
  limit: number;
  total: number;
  has_next: boolean;
}

const emptyPage = (page: number, limit: number): WalletpayHistoryPage => ({
  rows: [],
  page,
  limit,
  total: 0,
  has_next: false,
});

export const walletpayHistoryService = {
  /**
   * @param lineUserId the member's LINE id (the panel already holds it)
   * @param page 1-based
   * @param limit rows per page (BE clamps to 1..50)
   */
  async list(
    lineUserId: string,
    page = 1,
    limit = 10,
  ): Promise<WalletpayHistoryPage> {
    if (!lineUserId) return emptyPage(page, limit);
    try {
      const res = await authFetch(
        `${API_BASE_URL}/api/chat/member/${encodeURIComponent(lineUserId)}/walletpay-history?page=${page}&limit=${limit}`,
      );
      const data = (await handleApiResponse(
        res,
        'โหลดผลตรวจ WalletPay',
      )) as Partial<WalletpayHistoryPage>;
      return {
        rows: Array.isArray(data?.rows) ? data.rows : [],
        page: Number(data?.page) || page,
        limit: Number(data?.limit) || limit,
        total: Number(data?.total) || 0,
        has_next: data?.has_next === true,
      };
    } catch {
      return emptyPage(page, limit);
    }
  },
};
