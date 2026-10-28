/**
 * ==== [FEAT-20260805-HANDOFF] START ====
 *
 * handoffService — calls the BE handoff-targets API (legacy-api).
 * A "handoff target" = a downstream destination (webhook / queue / adapter) that
 * receives an event (e.g. slip verification) so an external system can take over.
 *
 * Mirrors customToolService.ts: interfaces + normalize helpers + authFetch calls
 * via services/apiClient. Every route is gated by `handoff.manage` on the BE.
 *
 * ⚠️ Secret fields (auth_secret / auth_password / … / oauth_access_token): the BE
 * never returns the raw value — only `has_<field>` booleans. Empty input on edit
 * = keep existing (เว้นว่าง = ไม่แตะของเดิม), exactly like custom tools.
 *
 * revert: delete this file + pages/HandoffTargets.tsx + route in App.tsx.
 * ==== [FEAT-20260805-HANDOFF] ====
 */
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

/** scope binding — 1 OA (hook) row with its on/off state.
 *  enabled:false = OA kept in config but muted (ยังอยู่ในลิสต์ แต่ปิดใช้งาน) */
export interface HandoffBinding {
  hook_id: string;
  enabled: boolean;
}

/** one result rule — how to read pass/fail out of the downstream response.
 *  Same shape family as custom-tool result_rules. v1 UI edits these as JSON. */
export interface HandoffResultRule {
  path?: string;
  op?: 'eq' | 'neq' | 'in' | 'exists' | 'not_exists' | 'contains';
  value?: string;
  http_codes?: string;
  action?: 'success' | 'fail';
  failure_type?: '' | 'business' | 'config' | 'transient' | 'system';
  error_code?: string;
  message_path?: string;
}

/** gate conditions — when this target is allowed to fire at all */
export interface HandoffCondition {
  require_subject_success: boolean;
  require_verdict_tags: string[];
  allow_duplicate: boolean;
  allow_out_of_time: boolean;
  allow_success_not_match: boolean;   // account verified but not matched (5th case)
  allow_below_min_amount: boolean;
  min_amount: number;
}

export interface HandoffTarget {
  id: string;
  key: string;                    // IMMUTABLE after create · /^[a-z0-9_-]{1,64}$/
  name: string;
  adapter: string;                // default "generic_json"
  enabled: boolean;               // default false
  env_tag: 'dev' | 'prod';        // required
  subject_types: string[];        // default ["slip_verification"]
  endpoint_url: string;
  auth_mode: string;              // auth.mode — none|bearer|apikey|basic|hmac
  secret_source: 'own' | 'custom_tool'; // 'custom_tool' = key from firing hook's custom_tool.api_key
  timeout_ms: number;             // default 8000, max 8000
  action_type: number;            // 0-5, default 0 (see labels in the page)
  reply_type: number;             // 0-5, default 0 (reserved — not wired yet)
  match_type: number[];           // multi-select 0-5, default [] (reserved — not wired yet)
  flex_message_id?: string | null; // reserved
  scope: { bindings: HandoffBinding[] };  // empty bindings = "all OA"
  result_rules: HandoffResultRule[];
  condition: HandoffCondition;
  config: Record<string, any>;    // rendered from config-schema (empty today)
  // secret presence flags — BE never returns raw values (has_* only)
  has_auth_secret: boolean;
  has_auth_password: boolean;
  has_auth_client_secret: boolean;
  has_inbound_secret: boolean;
  has_inbound_password: boolean;
  has_oauth_access_token: boolean;
  created_by?: any;
  updated_by?: any;
  created_at?: string;
  updated_at?: string;
}

/** one handoff job row (history tab) — read-only view from GET /api/handoff/jobs.
 *  BE returns lean docs; we keep the shape loose (only what the tab shows). */
export interface HandoffJob {
  id: string;
  target_key: string;
  subject_type: string;
  subject_id?: string;
  hook_id?: string | null;
  status: string;                 // queued / sending / success / failed / …
  attempt?: number;
  result_meta?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/** one field in the dynamic config form (GET /config-schema · empty today) */
export interface HandoffConfigField {
  key: string;
  type: 'boolean' | 'number' | 'enum' | 'string';
  default?: any;
  label?: { th?: string; en?: string };
  options?: Array<{ value: any; label?: string }>;
  min?: number;
  max?: number;
}

const normalizeCondition = (c: any): HandoffCondition => ({
  require_subject_success: c?.require_subject_success === true,
  require_verdict_tags: Array.isArray(c?.require_verdict_tags) ? c.require_verdict_tags : [],
  allow_duplicate: c?.allow_duplicate === true,
  allow_out_of_time: c?.allow_out_of_time === true,
  allow_success_not_match: c?.allow_success_not_match === true,
  allow_below_min_amount: c?.allow_below_min_amount === true,
  min_amount: Number(c?.min_amount) || 0,
});

const normalizeTarget = (raw: any): HandoffTarget => ({
  id: raw?._id ?? raw?.id ?? '',
  key: raw?.key ?? '',
  name: raw?.name ?? '',
  adapter: raw?.adapter ?? 'generic_json',
  enabled: raw?.enabled === true,
  env_tag: raw?.env_tag === 'prod' ? 'prod' : 'dev',
  subject_types: Array.isArray(raw?.subject_types) && raw.subject_types.length
    ? raw.subject_types
    : ['slip_verification'],
  endpoint_url: raw?.endpoint_url ?? '',
  auth_mode: raw?.auth?.mode ?? 'none',
  secret_source: raw?.secret_source === 'custom_tool' ? 'custom_tool' : 'own',
  timeout_ms: Math.min(Number(raw?.timeout_ms) || 8000, 8000),
  action_type: Number(raw?.action_type) || 0,
  reply_type: Number(raw?.reply_type) || 0,
  match_type: Array.isArray(raw?.match_type) ? raw.match_type.map(Number) : [],
  flex_message_id: raw?.flex_message_id ?? null,
  scope: {
    bindings: Array.isArray(raw?.scope?.bindings)
      ? raw.scope.bindings.map((b: any) => ({
          hook_id: b?.hook_id ?? b?._id ?? '',
          enabled: b?.enabled !== false,
        }))
      : [],
  },
  result_rules: Array.isArray(raw?.result_rules) ? raw.result_rules : [],
  condition: normalizeCondition(raw?.condition),
  config: raw?.config && typeof raw.config === 'object' ? raw.config : {},
  // secret presence flags — BE sends only has_* (never raw values)
  has_auth_secret: !!raw?.has_auth_secret,
  has_auth_password: !!raw?.has_auth_password,
  has_auth_client_secret: !!raw?.has_auth_client_secret,
  has_inbound_secret: !!raw?.has_inbound_secret,
  has_inbound_password: !!raw?.has_inbound_password,
  has_oauth_access_token: !!raw?.has_oauth_access_token,
  created_by: raw?.created_by ?? null,
  updated_by: raw?.updated_by ?? null,
  created_at: raw?.created_at ?? '',
  updated_at: raw?.updated_at ?? '',
});

export const handoffService = {
  listTargets: async (
    params: { page?: number; limit?: number; search?: string; enabled?: boolean; hook_id?: string } = {}
  ): Promise<{ data: HandoffTarget[]; pagination: any }> => {
    const q = new URLSearchParams();
    q.append('page', String(params.page ?? 1));
    q.append('limit', String(params.limit ?? 25));
    if (params.search) q.append('search', params.search);
    if (params.enabled !== undefined) q.append('enabled', params.enabled ? 'true' : 'false');
    if (params.hook_id) q.append('hook_id', params.hook_id); // targets bound to a specific OA

    try {
      const res = await authFetch(`${API_BASE_URL}/api/handoff/targets?${q.toString()}`);
      if (res.status === 404) {
        return { data: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } };
      }
      const parsed = await handleApiResponse<any>(res, 'list handoff targets');
      const rows = Array.isArray(parsed?.data) ? parsed.data : [];
      return {
        data: rows.map(normalizeTarget),
        pagination: parsed?.pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
      };
    } catch (error) {
      console.error('Failed to list handoff targets:', error);
      return { data: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } };
    }
  },

  getTarget: async (id: string): Promise<HandoffTarget> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/targets/${id}`);
    const parsed = await handleApiResponse<any>(res, 'get handoff target');
    return normalizeTarget(parsed?.data ?? parsed);
  },

  createTarget: async (data: any): Promise<HandoffTarget> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/targets`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<any>(res, 'create handoff target');
    return normalizeTarget(parsed?.data ?? parsed);
  },

  /** partial update — send only changed fields (key is immutable, never sent) */
  updateTarget: async (id: string, data: any): Promise<HandoffTarget> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/targets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<any>(res, 'update handoff target');
    return normalizeTarget(parsed?.data ?? parsed);
  },

  /** soft delete */
  deleteTarget: async (id: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/targets/${id}`, { method: 'DELETE' });
    if (res.status === 204) return { success: true };
    return handleApiResponse<any>(res, 'delete handoff target');
  },

  /** handoff job history — read-only list (OA-scoped on BE). used by the ประวัติ tab. */
  listJobs: async (
    params: { page?: number; limit?: number; status?: string; target_key?: string; search?: string } = {}
  ): Promise<{ data: HandoffJob[]; pagination: any }> => {
    const q = new URLSearchParams();
    q.append('page', String(params.page ?? 1));
    q.append('limit', String(params.limit ?? 25));
    if (params.status) q.append('status', params.status);
    if (params.target_key) q.append('target_key', params.target_key);
    if (params.search) q.append('search', params.search);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/handoff/jobs?${q.toString()}`);
      if (res.status === 404) return { data: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } };
      const parsed = await handleApiResponse<any>(res, 'list handoff jobs');
      const rows = Array.isArray(parsed?.data) ? parsed.data : [];
      return {
        data: rows.map((r: any): HandoffJob => ({
          id: r?._id ?? r?.id ?? '',
          target_key: r?.target_key ?? '',
          subject_type: r?.subject_type ?? '',
          subject_id: r?.subject_id ?? '',
          hook_id: r?.hook_id ?? null,
          status: r?.status ?? '',
          attempt: Number(r?.attempt) || 0,
          result_meta: r?.result_meta && typeof r.result_meta === 'object' ? r.result_meta : {},
          created_at: r?.created_at ?? '',
          updated_at: r?.updated_at ?? '',
        })),
        pagination: parsed?.pagination ?? { page: 1, limit: 25, total: rows.length, pages: 1 },
      };
    } catch (error) {
      console.error('Failed to list handoff jobs:', error);
      return { data: [], pagination: { page: 1, limit: 25, total: 0, pages: 0 } };
    }
  },

  /** one job's full raw doc — for the history detail modal (GET /api/handoff/jobs/:id).
   *  returns the raw object as-is (all fields) so the modal can render everything. */
  getJob: async (id: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/jobs/${id}`);
    const parsed = await handleApiResponse<any>(res, 'get handoff job');
    return parsed?.data ?? parsed;
  },

  /** full raw result of one job — request we sent + response we got (handoff_results).
   *  gated by handoff.view_raw on BE; opening it writes an audit row. 404 = no result yet. */
  getJobResult: async (id: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/jobs/${id}/result`);
    if (res.status === 404) return null;   // not recorded yet (still queued / no response)
    const parsed = await handleApiResponse<any>(res, 'get handoff job result');
    return parsed?.data ?? parsed;
  },

  /** dynamic config schema — EMPTY today → page renders nothing (seamless) */
  getConfigSchema: async (): Promise<HandoffConfigField[]> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/handoff/config-schema`);
      if (res.status === 404) return [];
      const parsed = await handleApiResponse<any>(res, 'get handoff config schema');
      return Array.isArray(parsed?.data) ? parsed.data : [];
    } catch (error) {
      console.error('Failed to get handoff config schema:', error);
      return [];
    }
  },

  // ==== [FEAT-20260805-CHAIN] sequential chains + per-OA overrides + run history ====
  listChains: async (): Promise<HandoffChain[]> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/handoff/chains`);
      if (res.status === 404) return [];
      const parsed = await handleApiResponse<any>(res, 'list chains');
      return Array.isArray(parsed?.data) ? parsed.data : [];
    } catch (e) { console.error('list chains failed', e); return []; }
  },
  getChain: async (id: string): Promise<HandoffChain> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/chains/${id}`);
    const p = await handleApiResponse<any>(res, 'get chain');
    return p?.data ?? p;
  },
  createChain: async (data: any): Promise<HandoffChain> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/chains`, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
    const p = await handleApiResponse<any>(res, 'create chain');
    return p?.data ?? p;
  },
  updateChain: async (id: string, data: any): Promise<HandoffChain> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/chains/${id}`, { method: 'PUT', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
    const p = await handleApiResponse<any>(res, 'update chain');
    return p?.data ?? p;
  },
  deleteChain: async (id: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/chains/${id}`, { method: 'DELETE' });
    return handleApiResponse<any>(res, 'delete chain');
  },
  listOverrides: async (params: { hook_id?: string; target_key?: string } = {}): Promise<HandoffHookOverride[]> => {
    const q = new URLSearchParams();
    if (params.hook_id) q.append('hook_id', params.hook_id);
    if (params.target_key) q.append('target_key', params.target_key);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/handoff/overrides?${q.toString()}`);
      if (res.status === 404) return [];
      const p = await handleApiResponse<any>(res, 'list overrides');
      return Array.isArray(p?.data) ? p.data : [];
    } catch (e) { console.error('list overrides failed', e); return []; }
  },
  upsertOverride: async (data: any): Promise<HandoffHookOverride> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/overrides`, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
    const p = await handleApiResponse<any>(res, 'upsert override');
    return p?.data ?? p;
  },
  deleteOverride: async (id: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/overrides/${id}`, { method: 'DELETE' });
    return handleApiResponse<any>(res, 'delete override');
  },
  listChainRuns: async (params: { needs_review?: boolean; status?: string; chain_key?: string; slip_id?: string; search?: string; page?: number; limit?: number; from?: string; to?: string } = {}): Promise<{ data: HandoffChainRun[]; total: number; page: number; limit: number }> => {
    const q = new URLSearchParams();
    q.append('page', String(params.page ?? 1));
    q.append('limit', String(params.limit ?? 20));
    if (params.needs_review) q.append('needs_review', 'true');
    if (params.status) q.append('status', params.status);
    if (params.chain_key) q.append('chain_key', params.chain_key);
    if (params.slip_id) q.append('slip_id', params.slip_id);
    if (params.search) q.append('search', params.search);
    // [FEAT-20260809-DATERANGE] Bare YYYY-MM-DD, sent verbatim. The backend reads them as
    // Bangkok days and clamps a span wider than MAX_RANGE_DAYS; omitting both lists all.
    if (params.from) q.append('from', params.from);
    if (params.to) q.append('to', params.to);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/handoff/chain-runs?${q.toString()}`);
      if (res.status === 404) return { data: [], total: 0, page: 1, limit: 20 };
      const p = await handleApiResponse<any>(res, 'list chain runs');
      return { data: Array.isArray(p?.data) ? p.data : [], total: p?.total ?? 0, page: p?.page ?? 1, limit: p?.limit ?? 20 };
    } catch (e) { console.error('list chain runs failed', e); return { data: [], total: 0, page: 1, limit: 20 }; }
  },
  getChainRun: async (id: string): Promise<{ run: HandoffChainRun; steps: any[]; slip?: any }> => {
    const res = await authFetch(`${API_BASE_URL}/api/handoff/chain-runs/${id}`);
    const p = await handleApiResponse<any>(res, 'get chain run');
    return (p?.data ?? p) as { run: HandoffChainRun; steps: any[]; slip?: any };
  },
};

// ==== [FEAT-20260805-CHAIN] chain types ====
export interface HandoffChainStep {
  order: number;
  target_key: string;
  enabled?: boolean;
  is_payment?: boolean;
  on_true?: 'continue' | 'stop' | 'reply';
  on_false?: 'continue' | 'stop' | 'reply';
}
export interface HandoffChain {
  _id?: string;
  key: string;
  name?: string;
  enabled?: boolean;
  env_tag: 'dev' | 'prod';
  subject_types?: string[];
  scope?: { bindings?: { hook_id: string; enabled?: boolean }[] };
  steps?: HandoffChainStep[];
  statement?: { path?: string; start_index?: number };
  created_at?: string;
}
// per-hook endpoint/creds override. `enabled` = "use OWN creds" (off/no-row = share main).
// web_code is NOT here — Shop-API reads it from the hook (customer_link_web_code), not overridable.
export interface HandoffHookOverride {
  _id?: string;
  hook_id: string;
  target_key: string;
  endpoint_url?: string;
  auth_mode?: string;
  secret_source?: 'own' | 'custom_tool';   // 'custom_tool' = share the hook's custom_tool.api_key
  enabled?: boolean;
  has_auth_secret?: boolean;
  has_auth_password?: boolean;
}
export interface HandoffChainRun {
  _id: string;
  chain_key: string;
  member_user_id?: string;
  // [FEAT-20260806-RAWTX] joined member profile (null if member not found)
  member?: { record_id?: string; line_user_id?: string; display_name?: string; full_name?: string; phone_number?: string } | null;
  slip_record_id?: string;
  status: string;
  cursor?: number;
  needs_review?: boolean;
  raw_transaction?: any;   // whole transaction snapshot at chain start (RUN level)
  hook_id?: string;
  started_at?: string;
  created_at?: string;
  ended_at?: string;
}
// ==== [FEAT-20260805-HANDOFF] END ====
