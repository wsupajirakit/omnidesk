/**
 * [FEAT-20260811-PAYRESPEXAMPLES] Real provider response examples per payment
 * reply state — DISPLAY DATA for the hook-modal "eye" guide, served by the BE
 * central spec (`omnidesk-api src/modules/payment/payment-reply-response-examples.ts`).
 *
 * WHY A FETCH AND NOT A CONSTANT: the bodies used to be hardcoded in
 * `HookPaymentFlexBlock` (`REAL_RAW`) — that bloated the FE and drifted from the
 * BE captures the moment anyone added one. One source now; the FE only renders.
 * BE ไม่ได้ใช้ข้อมูลนี้ตัดสินอะไร — เสิร์ฟให้หน้า hook modal โชว์เท่านั้น.
 */
import { API_BASE_URL, handleApiResponse, authFetch } from '../apiClient';

export interface ReplyStateResponseExample {
  label: string;
  raw: string;
}

export const paymentReplyExamplesService = {
  getHookModalReplyStateResponseExamples: async (): Promise<
    Record<string, ReplyStateResponseExample[]>
  > => {
    const res = await authFetch(
      `${API_BASE_URL}/payment/hook-modal-reply-state-response-examples`,
    );
    const data = await handleApiResponse<{
      examples?: Record<string, ReplyStateResponseExample[]>;
    }>(res, 'load payment reply-state response examples');
    return data?.examples ?? {};
  },
};
