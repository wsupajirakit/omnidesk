// [REFACTOR-20260808-TYPESPLIT] Audit-log domain.
import type { Pagination } from './common';

export interface AuditActor {
  user_id: string;
  username: string;
  display_name?: string;
}

export interface AuditChangedField {
  field: string;
  from: any;
  to: any;
}

export interface AuditLog {
  _id: string;
  ref_id: string;
  hook_id?: string;
  parent?: string;
  action: string;
  changed_fields?: AuditChangedField[];
  actor: AuditActor;
  request_meta?: {
    request_id?: string;
    ip?: string;
    user_agent?: string;
  };
  note?: string;
  created_at: string;
}

export interface AuditLogCreatePayload {
  ref_id: string;
  hook_id?: string;
  parent?: string;
  action: string;
  changed_fields?: AuditChangedField[];
  actor?: AuditActor;
  request_meta?: {
    request_id?: string;
    ip?: string;
    user_agent?: string;
  };
  note?: string;
}

export interface AuditLogListResponse {
  data: AuditLog[];
  pagination: Pagination;
}
