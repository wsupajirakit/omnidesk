// [REFACTOR-20260808-TYPESPLIT] Flat split of the former monolithic types.ts.
// Shared primitives + cross-domain entities live here so every other module can
// import them without a cycle. Behavior-identical: pure type declarations only,
// re-exported through the types.ts barrel — ไม่มี import path ไหนเปลี่ยนเลย.

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  // [PERF-20260821-TICKETCURSOR] present only on cursor-mode responses.
  has_more?: boolean;
  next_cursor?: string | null;
}

export interface ApiError extends Error {
  rawResponse?: string;
}

export type ReplyMatchType = 'exact' | 'contains' | 'regex' | 'loose' | 'fuzzy';
export type MessageType = 'text' | 'image' | 'flex' | 'media';

export interface Member {
  _id: string;
  line_user_id: string;
  display_name: string;
  nickname: string;
  picture_url: string;
  status_message: string;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}
