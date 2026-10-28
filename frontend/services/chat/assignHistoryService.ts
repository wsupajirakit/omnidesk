import { API_BASE_URL, handleApiResponse, authFetch } from '../apiClient';
import { AssignHistoryListResponse } from '../../types';

export const assignHistoryService = {
  getAssignHistories: async (filters: {
    page?: number;
    limit?: number;
    chat_room_id?: string;
    ticket_id?: string;
    assign_to?: string;
    changed_by_id?: string;
    action?: string;
    /* [FEAT-20260817-ASSIGNDATERANGE] bare YYYY-MM-DD (Bangkok day) — the BE caps
       the window at 3 days and owns the timezone conversion. */
    from?: string;
    to?: string;
  }): Promise<AssignHistoryListResponse> => {
    const {
      page = 1,
      limit = 20,
      chat_room_id,
      ticket_id,
      assign_to,
      changed_by_id,
      action,
      from,
      to,
    } = filters;

    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());

    if (chat_room_id) {
      params.append('chat_room_id', chat_room_id);
    }
    if (ticket_id) {
      params.append('ticket_id', ticket_id);
    }
    if (assign_to && assign_to !== 'all') {
      params.append('assign_to', assign_to);
    }
    if (changed_by_id && changed_by_id !== 'all') {
      params.append('changed_by_id', changed_by_id);
    }
    if (action && action !== 'all') {
      params.append('action', action);
    }
    if (from) {
      params.append('from', from);
    }
    if (to) {
      params.append('to', to);
    }

    const response = await authFetch(`${API_BASE_URL}/api/assign-histories?${params.toString()}`, {
      method: 'GET',
    });

    const result = await handleApiResponse<AssignHistoryListResponse>(response, 'fetch assignment histories');
    if (result?.pagination && !result.pagination.total_pages && result.pagination.total != null) {
      result.pagination.total_pages = Math.ceil(result.pagination.total / (result.pagination.limit || limit)) || 1;
    }
    return result;
  },

  createAssignHistory: async (data: {
    ticket_id: string;
    chat_room_id: string;
    assign_to: string | null;
    changed_by_id: string;
    action: 'accept' | 'edit' | 'close' | 'claim' | 'transfer' | 'reopen_by_admin';
  }): Promise<any> => {
    const response = await authFetch(`${API_BASE_URL}/api/assign-histories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    return handleApiResponse<any>(response, 'create assignment history');
  }
};
