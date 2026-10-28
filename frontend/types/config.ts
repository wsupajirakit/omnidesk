// [REFACTOR-20260808-TYPESPLIT] System-config domain.
import type { Pagination } from './common';

export interface SystemConfigEntry {
  _id: string;
  key: string;
  // Stored per-config: most are strings, but boolean flags (e.g.
  // ai_sum_category, acme_category) are persisted as real booleans.
  value: string | boolean | number;
  flag: number; // 1/0
  type?: string;
  detail?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SystemConfigFormData {
  key: string;
  value: string;
  flag: number;
  type?: string;
  detail?: string;
}

export interface SystemConfigListResponse {
  data: SystemConfigEntry[];
  pagination: Pagination;
}
