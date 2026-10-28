// [REFACTOR-20260808-TYPESPLIT] Dynamic-tag domain.
import type { Pagination } from './common';

export interface DynamicTagEntry {
  id: string;
  tag: string;
  value: string;
  detail: string;
  status: boolean;
  type: 'api' | 'system';
  sub_type: string;
  ref_api_id?: string;
  hook_id?: string;
  // [FEAT-20260728-TAGSCOPE] scope 3 แบบ (XOR ฝั่ง BE): hook_id=OA เดี่ยว · group_id=ทั้งกลุ่ม ·
  // hook_ids=เลือกบางตัวในกลุ่ม (checkbox)
  group_id?: string;
  hook_ids?: string[];
  group_ids?: string[];
  primary_credential_source?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DynamicTagFormData {
  tag?: string;
  value: string;
  detail: string;
  status: boolean;
  type: 'api' | 'system';
  sub_type: string;
  ref_api_id?: string;
  hook_id?: string;
  // [FEAT-20260728-TAGSCOPE]
  group_id?: string | null;
  hook_ids?: string[];
  group_ids?: string[];
  primary_credential_source?: string | null;
}

export interface DynamicTagListResponse {
  data: DynamicTagEntry[];
  pagination: Pagination;
}
