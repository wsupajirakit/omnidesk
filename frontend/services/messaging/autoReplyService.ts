import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { AutoReplyEntry, AutoReplyFormData, AutoReplyListResponse } from '../../types';

const normalizeAutoReply = (raw: any): AutoReplyEntry => ({
  id: raw?.id ?? raw?._id ?? '',
  name: raw?.name ?? '',
  hook_ids: raw?.hook_ids ?? [],
  assign_group:
    raw?.assign_group?.id ??
    raw?.assign_group?._id ??
    raw?.assign_group ??
    raw?.assign_group_id ??
    null,
  keyword: raw?.keyword ?? '',
  mode: raw?.mode ?? 'reply',
  match_type: raw?.match_type ?? 'contains',
  response: raw?.response ?? { type: 'text', text: '' },
  priority: raw?.priority ?? 0,
  active: Boolean(raw?.active),
  created_by: raw?.created_by,
  updated_by: raw?.updated_by,
  created_at: raw?.created_at,
  updated_at: raw?.updated_at
});

export const autoReplyService = {
  listAutoReplies: async (params: { page?: number; limit?: number; active?: boolean; sort?: string } = {}): Promise<AutoReplyListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 10));
    if (params.active !== undefined) {
      searchParams.append('active', params.active ? 'true' : 'false');
    }
    if (params.sort) {
      searchParams.append('sort', params.sort);
    }

    const response = await authFetch(`${API_BASE_URL}/api/auto-replies?${searchParams.toString()}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'list auto replies');
    const data = Array.isArray(parsed?.data) ? parsed.data.map(normalizeAutoReply) : [];
    const total = parsed?.meta?.total ?? parsed?.pagination?.total ?? data.length;
    const limit = parsed?.meta?.limit ?? parsed?.pagination?.limit ?? params.limit ?? 10;
    return {
      data,
      pagination: {
        page: parsed?.meta?.page ?? parsed?.pagination?.page ?? params.page ?? 1,
        limit,
        total,
        total_pages: limit ? Math.ceil(total / limit) : 1
      }
    };
  },

  createAutoReply: async (data: AutoReplyFormData): Promise<AutoReplyEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/auto-replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'create auto reply');
    return normalizeAutoReply(parsed);
  },

  updateAutoReply: async (id: string, data: Partial<AutoReplyFormData>): Promise<AutoReplyEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/auto-replies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'update auto reply');
    return normalizeAutoReply(parsed);
  },

  updateAutoReplyActive: async (id: string, active: boolean): Promise<AutoReplyEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/auto-replies/${id}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    });

    const parsed = await handleApiResponse<any>(response, 'update auto reply active');
    return normalizeAutoReply(parsed);
  },

  deleteAutoReply: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/auto-replies/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.statusText}`);
    }
  }
};
