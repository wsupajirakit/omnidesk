import { API_BASE_URL, handleApiResponse, authFetch } from '../apiClient';
import { WebhookLogEntry, WebhookLogListResponse } from '../../types';

export const webhookLogService = {
  getLogs: async (
    page: number = 1,
    limit: number = 20,
    status?: string
  ): Promise<WebhookLogListResponse> => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', 'created_at:desc');
    if (status && status !== 'all') {
      params.append('status', status);
    }

    const response = await authFetch(`${API_BASE_URL}/webhook/logs?${params.toString()}`, {
      method: 'GET',
    });

    return handleApiResponse<WebhookLogListResponse>(response, 'fetch webhook logs');
  },
  getLogsWithFilters: async (filters: {
    page?: number;
    limit?: number;
    status?: string;
    channel?: string;
    action_type?: string;
    // [FEAT-20260801-LOGSOURCE] กรองด้วย request_meta.<key> = <value>
    // BE รองรับ meta_key/meta_value อยู่แล้ว (webhookLogService.js) — ไม่ต้องเพิ่มเส้นใหม่
    // ใช้กับ source เพื่อแยก "ปุ่ม refresh" (manual_refresh) ออกจาก webhook (webhook_prefetch)
    meta_key?: string;
    meta_value?: string;
    // [FEAT-20260809-DATERANGE] Bare YYYY-MM-DD. The backend reads these as Bangkok days
    // and clamps a span wider than its MAX_RANGE_DAYS. Omit both to list unfiltered.
    from?: string;
    to?: string;
    /* [FEAT-20260828-LOGSEARCH] ค้นชื่อ OA หรือ id ของ job
       ⚠️ ขั้นต่ำ 4 ตัวอักษรบังคับที่ BE (`webhook-log.service.ts`) — ฝั่งนี้แค่ไม่ยิง
          คำที่สั้นกว่านั้นเพื่อไม่ให้ยิงถี่ ๆ ระหว่างพิมพ์ ไม่ใช่ตัวบังคับกฎ */
    search?: string;
  }): Promise<WebhookLogListResponse> => {
    const {
      page = 1,
      limit = 20,
      status,
      channel,
      action_type,
      meta_key,
      meta_value,
      from,
      to,
      search
    } = filters;
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', 'created_at:desc');
    if (status && status !== 'all') {
      params.append('status', status);
    }
    /* [FEAT-20260828-LOGSEARCH] ตัดช่องว่างก่อนวัดความยาว — เว้นวรรคล้วนไม่ใช่คำค้น */
    const needle = (search ?? '').trim();
    if (needle.length >= 4) {
      params.append('search', needle);
    }
    // [FEAT-20260801-LOGSOURCE] ส่งคู่กันเท่านั้น — ส่งมาข้างเดียว BE จะข้ามให้อยู่แล้ว
    if (meta_key && meta_value) {
      params.append('meta_key', meta_key);
      params.append('meta_value', meta_value);
    }
    if (channel) {
      params.append('channel', channel);
    }
    if (action_type) {
      params.append('action_type', action_type);
    }
    // [FEAT-20260809-DATERANGE] Sent verbatim — no ISO conversion here on purpose.
    if (from) params.append('from', from);
    if (to) params.append('to', to);

    const response = await authFetch(`${API_BASE_URL}/webhook/logs?${params.toString()}`, {
      method: 'GET',
    });

    return handleApiResponse<WebhookLogListResponse>(response, 'fetch webhook logs');
  },

  getLogDetail: async (id: string): Promise<WebhookLogEntry> => {
    const response = await authFetch(`${API_BASE_URL}/webhook/logs/${encodeURIComponent(id)}`, {
      method: 'GET',
    });

    return handleApiResponse<WebhookLogEntry>(response, 'fetch webhook log detail');
  }
};
