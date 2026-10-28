// [REFACTOR-20260808-TYPESPLIT] Slip-verification domain.
import type { Member, Pagination } from './common';

export interface SlipVerificationEntry {
  id: string;
  transaction_date: string;
  api_status: string;
  trans_ref: string;
  sender_account_no: string;
  sender_account_name: string;
  sender_bank: string;
  receiver_account_no: string;
  receiver_account_name: string;
  receiver_bank: string;
  slip_type: string;
  amount: number;
  branch: string;
  raw_response?: any;
  metadata?: any;
  internal_content_id?: {
    _id: string;
    image_url: string;
    storage_type: string;
    image_type: string;
  } | null;
  line_user?: Member | null;
  raw_content?: any;
  external_data?: any;
  callback_response?: any;
  created_at: string;
  updated_at?: string;
}

export interface SlipVerificationFormData {
  transaction_date: string;
  api_status: string;
  trans_ref: string;
  sender_account_no: string;
  sender_account_name: string;
  sender_bank: string;
  receiver_account_no: string;
  receiver_account_name: string;
  receiver_bank: string;
  slip_type: string;
  amount: number;
  branch: string;
  raw_response?: any;
  metadata?: any;
}

export interface SlipVerificationListResponse {
  data: SlipVerificationEntry[];
  pagination: Pagination;
}
