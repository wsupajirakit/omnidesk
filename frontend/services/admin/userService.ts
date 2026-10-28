import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { UserEntry, UserFormData, UserListResponse, BulkCloneUserRow, BulkCloneUsersResponse } from '../../types';

const normalizeUser = (raw: any): UserEntry => {
  return {
    id: raw?.id ?? raw?._id ?? '',
    username: raw?.username ?? '',
    display_name: raw?.display_name ?? '',
    email: raw?.email ?? '',
    phone: raw?.phone ?? '',
    role: raw?.role,
    role_id: raw?.role_id ?? raw?.role?.id,
    groups: raw?.groups ?? [],
    permissions: raw?.permissions ?? [],
    allowed_hooks: raw?.allowed_hooks ?? null,
    active: raw?.active ?? false,
    last_login: raw?.last_login ?? null,
    created_at: raw?.created_at,
    updated_at: raw?.updated_at
  };
};

export const userService = {
  listUsers: async (params: { page?: number; limit?: number } = {}): Promise<UserListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 25));

    const response = await authFetch(`${API_BASE_URL}/api/users?${searchParams.toString()}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'list users');
    const data = Array.isArray(parsed?.data) ? parsed.data.map(normalizeUser) : [];
    return {
      data,
      pagination: {
        page: parsed?.meta?.page ?? parsed?.pagination?.page ?? params.page ?? 1,
        limit: parsed?.meta?.limit ?? parsed?.pagination?.limit ?? params.limit ?? 25,
        total: parsed?.meta?.total ?? parsed?.pagination?.total ?? data.length,
        total_pages:
          parsed?.meta?.total && parsed?.meta?.limit
            ? Math.ceil(parsed.meta.total / parsed.meta.limit)
            : parsed?.pagination?.total_pages ?? 1
      }
    };
  },

  listUsersForAssign: async (): Promise<{ data: { user_id: string; username: string; display_name: string }[] }> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/list-for-assign`, {
      method: 'GET'
    });
    return handleApiResponse<{ data: { user_id: string; username: string; display_name: string }[] }>(response, 'list users for assign');
  },

  getUser: async (id: string): Promise<{ data: UserEntry }> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'get user');
    return { data: normalizeUser(parsed?.data ?? parsed) };
  },

  createUser: async (data: UserFormData): Promise<UserEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    return handleApiResponse<UserEntry>(response, 'create user');
  },

  // Create several users sharing a source user's role, groups and permissions.
  // Only identity is per row; access always comes from the source, server-side.
  bulkCloneUsers: async (
    sourceId: string,
    users: BulkCloneUserRow[]
  ): Promise<BulkCloneUsersResponse> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/${sourceId}/bulk-clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users })
    });

    return handleApiResponse<BulkCloneUsersResponse>(response, 'bulk clone users');
  },

  // ==== [FEAT-20260729-BULKUI] START — set permissions on several users at once
  // 🔒 AUTO track — to_dev_auto branch only
  //
  // Reads the body itself instead of going through handleApiResponse, because a
  // 403 from this endpoint carries a `blocked` array naming the users it
  // refused and why. handleApiResponse would collapse that into a generic
  // message, leaving the operator with "some users failed" and no idea which.
  // The array is attached to the thrown error so the page can list the names.
  //
  // revert: delete this method and its caller in pages/Users.tsx.
  bulkUpdatePermissions: async (
    userIds: string[],
    permissions: string[]
  ): Promise<{ success: boolean; matched: number; modified: number; usernames: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/bulk-permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_ids: userIds, permissions })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk permission update failed');
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },
  // ==== [FEAT-20260729-BULKUI] END

  // ==== [FEAT-20260729-BULKSTATUS] START — enable/disable several users at once
  // Same error shape as bulkUpdatePermissions above: the API answers 403 with a
  // `blocked` array naming who could not be changed, and that list is surfaced
  // in the UI rather than collapsed into one generic failure.
  // revert: delete this method and its call site in Users.tsx.
  bulkUpdateActive: async (
    userIds: string[],
    active: boolean
  ): Promise<{ success: boolean; matched: number; modified: number; usernames: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/bulk-active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_ids: userIds, active })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk status update failed');
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },
  // ==== [FEAT-20260729-BULKSTATUS] END

  updateUser: async (id: string, data: Partial<UserFormData>): Promise<UserEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    return handleApiResponse<UserEntry>(response, 'update user');
  },

  deleteUser: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.statusText}`);
    }
  },

  changePassword: async (payload: { old_password: string; password: string }): Promise<{ message?: string }> => {
    const response = await authFetch(`${API_BASE_URL}/api/users/change-password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return handleApiResponse<{ message?: string }>(response, 'change password');
  }
};
