import { AuditLogCreatePayload, AuditLogListResponse, AuditActor } from '../../types';
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { getAuthUser } from '../authStorage';

const buildActor = (): AuditActor | undefined => {
  const user = getAuthUser();
  if (!user) return undefined;
  return {
    user_id: user.id,
    username: user.username,
    display_name: user.display_name,
  };
};

export const auditService = {
  createHookAuditLog: async (payload: AuditLogCreatePayload): Promise<void> => {
    const actor = payload.actor ?? buildActor();
    const payloadWithActor = actor ? { ...payload, actor } : payload;

    const tryPost = async (body: any) => {
      const response = await authFetch(`${API_BASE_URL}/audit/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response;
    };

    const response = await tryPost(payloadWithActor);
    if (response.ok) return;

    const status = response.status;
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.message || `Audit Error: ${status}`;

    // Retry without actor/request_meta for stricter backends (non-breaking change).
    if ([400, 401, 403, 404, 409, 422].includes(status)) {
      const minimal = {
        ref_id: payload.ref_id,
        hook_id: payload.hook_id,
        parent: payload.parent,
        action: payload.action,
        changed_fields: payload.changed_fields,
        note: payload.note,
      };
      const retry = await tryPost(minimal);
      if (retry.ok) return;
      const retryStatus = retry.status;
      const retryError = await retry.json().catch(() => ({}));
      throw new Error(retryError.message || message || `Audit Error: ${retryStatus}`);
    }

    throw new Error(message);
  },

  listHookAuditLogs: async (params: {
    page?: number;
    limit?: number;
    parent?: string;
    ref_id?: string;
    hook_id?: string;
    action?: string;
    actor_user_id?: string;
    from?: string;
    to?: string;
    sort?: string;
  }): Promise<AuditLogListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 20));
    if (params.parent) searchParams.append('parent', params.parent);
    if (params.ref_id) searchParams.append('ref_id', params.ref_id);
    if (params.hook_id) searchParams.append('hook_id', params.hook_id);
    if (params.action) searchParams.append('action', params.action);
    if (params.actor_user_id) searchParams.append('actor_user_id', params.actor_user_id);
    if (params.from) searchParams.append('from', params.from);
    if (params.to) searchParams.append('to', params.to);
    searchParams.append('sort', params.sort ?? 'created_at:desc');

    const response = await authFetch(`${API_BASE_URL}/audit/logs?${searchParams.toString()}`, {
      method: 'GET',
    });

    return handleApiResponse<AuditLogListResponse>(response, 'list audit logs');
  },

  getAuditLog: async (auditLogId: string): Promise<{ data: any }> => {
    const response = await authFetch(`${API_BASE_URL}/audit/logs/${encodeURIComponent(auditLogId)}`, {
      method: 'GET',
    });
    return handleApiResponse<{ data: any }>(response, 'fetch audit log');
  }
};
