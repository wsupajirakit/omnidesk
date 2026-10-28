// [REFACTOR-20260808-TYPESPLIT] Webhook-log domain. Keeps its own inline pagination
// shape verbatim (it never referenced the shared Pagination type).

export interface WebhookLogEntry {
  _id: string;
  hook_id: string;
  hook_alias: string;
  channel: string;
  action_type: string;
  method: string;
  endpoint: string;
  status: string;
  http_status?: number;
  error_message?: string;
  payload_summary?: Record<string, any>;
  response_summary?: Record<string, any>;
  request_meta?: Record<string, any>;
  doc_id?: string;
  line_key_mask?: string;
  duration_ms?: number;
  retries?: number;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface WebhookLogListResponse {
  data: WebhookLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}
