import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { GroupEntry, GroupFormData, GroupListResponse, Pagination } from '../../types';

const normalizeGroup = (raw: any): GroupEntry => ({
  _id: raw?._id ?? raw?.id ?? raw?.group_id ?? '',
  group_name: raw?.group_name ?? raw?.name ?? '',
  description: raw?.description ?? '',
  status: raw?.status ?? raw?.active ?? false,
  created_at: raw?.created_at,
  updated_at: raw?.updated_at
});

const normalizePagination = (parsed: any, fallbackPage: number, fallbackLimit: number, totalItems: number): Pagination => {
  const meta = parsed?.meta ?? parsed?.pagination ?? {};
  const total = meta?.total ?? totalItems;
  const limit = meta?.limit ?? fallbackLimit;
  const page = meta?.page ?? fallbackPage;
  return {
    page,
    limit,
    total,
    total_pages: meta?.total_pages ?? (limit ? Math.ceil(total / limit) : 1)
  };
};

export const groupService = {
  // [FIX-20260817-GROUPSEARCH] `group_name` is a server-side, case-insensitive
  // contains-match the BE has always supported (groups.service.ts:123-128). The
  // page used to filter client-side, which made the pager count rows it was not
  // showing.
  /**
   * [FEAT-20260817-GROUPBULKSTATUS] Turn many groups on or off in ONE request.
   *
   * All-or-nothing on the server: if any id is out of reach the whole batch is
   * refused with 403 and the message names the groups, so the operator knows
   * which tick to remove. Shaped after `bulkUpdateHookStatus` in
   * `services/hook/webhookService.ts` — same verb, same body, same reasoning.
   */
  bulkUpdateGroupStatus: async (
    ids: string[],
    status: boolean,
  ): Promise<{
    success: boolean;
    matched: number;
    modified: number;
    unchanged: number;
    missing: string[];
    changed?: string[];
  }> => {
    const response = await authFetch(`${API_BASE_URL}/api/groups/status/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || body?.message || 'bulk status update failed');
    }
    return body;
  },

  listGroups: async (params: { page?: number; limit?: number; status?: boolean; group_name?: string } = {}): Promise<GroupListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 25));
    if (params.status !== undefined) {
      searchParams.append('status', params.status ? 'true' : 'false');
    }
    if (params.group_name) {
      searchParams.append('group_name', params.group_name);
    }

    const response = await authFetch(`${API_BASE_URL}/api/groups?${searchParams.toString()}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'list groups');
    const rawData = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
    const data = rawData.map(normalizeGroup);
    return {
      data,
      pagination: normalizePagination(parsed, params.page ?? 1, params.limit ?? 25, data.length)
    };
  },

  getGroup: async (id: string): Promise<{ data: GroupEntry }> => {
    const response = await authFetch(`${API_BASE_URL}/api/groups/${id}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'get group');
    return { data: normalizeGroup(parsed?.data ?? parsed) };
  },

  createGroup: async (data: GroupFormData): Promise<GroupEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'create group');
    return normalizeGroup(parsed?.data ?? parsed);
  },

  updateGroup: async (id: string, data: Partial<GroupFormData>): Promise<GroupEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'update group');
    return normalizeGroup(parsed?.data ?? parsed);
  },

  deleteGroup: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/groups/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.statusText}`);
    }
  }
};
