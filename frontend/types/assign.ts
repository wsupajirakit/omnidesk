// [REFACTOR-20260808-TYPESPLIT] Assign-history / ticket-handoff domain.
import type { Pagination } from './common';

export interface AssignHistoryEntry {
  _id: string;
  chat_room_id: string | null;
  chat_room_data: {
    _id: string;
    line_user_id: string;
    // [FIX-20260801-HOOKTYPES] BE populate ข้อมูลสมาชิกมาให้ที่ฟิลด์นี้
    // (หน้า AssignHistory อ่าน full_name / display_name / phone_number จากมัน
    //  ด้วย cast `as any` มาตลอด เพราะ type ไม่เคยประกาศ) · ประกาศให้ตรงของจริง
    user_id?: {
      _id?: string;
      full_name?: string;
      display_name?: string;
      phone_number?: string;
      [k: string]: any;
    } | string | null;
    channel_id?: string;
    status: string;
    unread_count?: number;
    last_message?: {
      text?: string;
      sender_type?: string;
      timestamp?: string;
    };
    assist_status?: boolean;
    last_assist_changed_at?: string;
    recently_assisted_at?: string | null;
    assign_to?: string | null;
    created_at?: string;
    updated_at?: string;
  } | null;
  assign_to: string | null;
  assign_to_data: {
    _id: string;
    username: string;
    display_name: string;
    email?: string;
    role?: string;
  } | null;
  changed_by_id: string | null;
  changed_by_data: {
    _id: string;
    username: string;
    display_name: string;
    email?: string;
    role?: string;
  } | null;
  ticket_id?: string | null;
  action?: 'accept' | 'edit' | 'close' | 'reopen_by_admin' | null;
  created_at: string;
}

export interface AssignHistoryListResponse {
  success: boolean;
  data: AssignHistoryEntry[];
  pagination: Pagination;
}
