// [REFACTOR-20260808-TYPESPLIT] Access-control domain: groups, users, roles.
import type { Pagination } from './common';

export interface GroupEntry {
  _id: string;
  // [FIX-20260801-HOOKTYPES] BE ส่งมาทั้ง id และ _id แล้วแต่ endpoint
  // โค้ดอ่านทั้งสองแบบอยู่แล้ว (`x.id || x._id`) · type แค่ไม่เคยพูดถึง
  id?: string;
  group_name: string;
  description?: string;
  // dropdown บางที่ประกอบแค่ { _id, group_name } → ทำให้ optional ตามของจริง
  status?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface GroupFormData {
  group_name: string;
  description?: string;
  status: boolean;
}

export interface GroupListResponse {
  data: GroupEntry[];
  pagination: Pagination;
}

export interface UserEntry {
  id: string;
  // [FIX-20260801-HOOKTYPES] BE ส่งมาทั้ง id และ _id แล้วแต่ endpoint
  // โค้ดอ่านทั้งสองแบบอยู่แล้ว (`x.id || x._id`) · type แค่ไม่เคยพูดถึง
  _id?: string;
  username: string;
  display_name: string;
  email?: string;
  phone?: string;
  role?: {
    id: string;
    name: string;
  };
  role_id?: string;
  groups?: Array<{ id: string; group_name: string }>;
  permissions?: string[];
  allowed_hooks?: string[] | null;
  active?: boolean;
  last_login?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface UserFormData {
  username: string;
  password?: string;
  display_name: string;
  email?: string;
  phone?: string;
  role_id?: string;
  groups: string[];
  permissions: string[];
  allowed_hooks?: string[];
  active: boolean;
}

/** One row of a bulk clone: identity only — role, groups and permissions are
 *  taken from the source user by the server and cannot be set per row. */
export interface BulkCloneUserRow {
  username: string;
  password: string;
  display_name?: string;
  email?: string;
  phone?: string;
}

export interface BulkCloneUsersResponse {
  created: number;
  source: { id: string; username: string };
  users: UserEntry[];
}

/** Per-row failure returned by the API when a batch is rejected. */
export interface BulkCloneUserError {
  index: number;
  username?: string;
  field?: string;
  error: string;
}

export interface UserListResponse {
  data: UserEntry[];
  pagination: Pagination;
}

export interface RoleEntry {
  id: string;
  name: string;
  permissions: string[];
}
