import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { SlipVerificationEntry, SlipVerificationFormData, SlipVerificationListResponse } from '../../types';

const normalizeSlip = (raw: any): SlipVerificationEntry => {
  return {
    id: raw?.id ?? raw?._id ?? '',
    transaction_date: raw?.transaction_date ?? '',
    api_status: raw?.api_status ?? '',
    trans_ref: raw?.trans_ref ?? '',
    sender_account_no: raw?.sender_account_no ?? '',
    sender_account_name: raw?.sender_account_name ?? '',
    sender_bank: raw?.sender_bank ?? '',
    receiver_account_no: raw?.receiver_account_no ?? '',
    receiver_account_name: raw?.receiver_account_name ?? '',
    receiver_bank: raw?.receiver_bank ?? '',
    slip_type: raw?.slip_type ?? '',
    amount: raw?.amount ?? 0,
    branch: raw?.branch ?? '',
    raw_response: raw?.raw_response,
    metadata: raw?.metadata,
    internal_content_id: raw?.internal_content_id ?? null,
    line_user: raw?.line_user ?? null,
    raw_content: raw?.raw_content,
    callback_response: raw?.callback_response,
    external_data: raw?.external_data,
    created_at: raw?.created_at ?? '',
    updated_at: raw?.updated_at
  };
};

export const slipVerificationService = {
  // [FEAT-20260817-SLIPDATERANGE] start_date/end_date = bare YYYY-MM-DD (Bangkok day);
  // the BE caps the window and owns the timezone — never convert to ISO here.
  listSlips: async (params: { page?: number; limit?: number; search?: string; api_status?: string; sort?: string; start_date?: string; end_date?: string } = {}): Promise<SlipVerificationListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 25));
    if (params.search) searchParams.append('search', params.search);
    if (params.api_status) searchParams.append('api_status', params.api_status);
    if (params.sort) searchParams.append('sort', params.sort);
    if (params.start_date) searchParams.append('start_date', params.start_date);
    if (params.end_date) searchParams.append('end_date', params.end_date);

    const response = await authFetch(`${API_BASE_URL}/api/slip-verifications?${searchParams.toString()}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'list slips');
    const data = Array.isArray(parsed?.data) ? parsed.data.map(normalizeSlip) : [];
    
    const meta = parsed?.meta || parsed?.pagination;
    
    return {
      data,
      pagination: {
        page: meta?.page ?? params.page ?? 1,
        limit: meta?.limit ?? params.limit ?? 25,
        total: meta?.total ?? data.length,
        total_pages: meta?.pages ?? meta?.total_pages ?? (meta?.total && meta?.limit ? Math.ceil(meta.total / meta.limit) : 1)
      }
    };
  },

  getSlip: async (id: string): Promise<{ data: SlipVerificationEntry }> => {
    const response = await authFetch(`${API_BASE_URL}/api/slip-verifications/${id}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'get slip');
    return { data: normalizeSlip(parsed?.data ?? parsed) };
  },

  createSlip: async (data: SlipVerificationFormData): Promise<SlipVerificationEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/slip-verifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'create slip');
    return normalizeSlip(parsed?.data ?? parsed);
  },

  updateSlip: async (id: string, data: Partial<SlipVerificationFormData>): Promise<SlipVerificationEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/slip-verifications/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'update slip');
    return normalizeSlip(parsed?.data ?? parsed);
  },

  deleteSlip: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/slip-verifications/${id}`, {
      method: 'DELETE'
    });
    if (response.status !== 204 && !response.ok) {
       await handleApiResponse(response, 'delete slip');
    }
  }
};
