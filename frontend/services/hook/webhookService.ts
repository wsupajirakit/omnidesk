import { ApiResponse, HookData, HookFormData, HookQuotaResponse, HookFollowersResponse } from '../../types';
import { API_BASE_URL, handleApiResponse, authFetch } from '../apiClient';
import { normalizeSuggestionText } from './suggestionUtils';
// [FIX-20260817-BLANKSECRET] a blank masked secret is omitted, never nulled
import { secretForSubmit } from '../../utils/secretMask';

/**
 * [FEAT-20260817-HOOKLABELS] What `/hook/labels` returns — the six fields a
 * dropdown or hover card needs, nothing else. Kept here beside its only caller
 * rather than in `types/` so the slim contract and the fetch that uses it cannot
 * drift apart.
 */
export interface HookLabel {
  _id: string;
  alias: string | null;
  display_name: string | null;
  line_oa_name: string | null;
  company_name: string | null;
  status: number | null;
}

type ActorHeaders = {
  user_id?: string | number;
  username?: string;
  display_name?: string;
};

const buildActorHeaders = (actor?: ActorHeaders) => {
  if (!actor) return {};
  const headers: Record<string, string> = {};
  if (actor.user_id !== undefined && actor.user_id !== null && `${actor.user_id}` !== '') {
    headers['x-actor-user-id'] = String(actor.user_id);
  }
  if (actor.username) headers['x-actor-username'] = actor.username;
  if (actor.display_name) headers['x-actor-display-name'] = actor.display_name;
  return headers;
};

export const webhookService = {
  /**
   * Fetch paginated hooks (Server-side)
   */
  getHooks: async (page: number = 1, limit: number = 10, search: string = ''): Promise<ApiResponse> => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    params.append('sort', 'created_at:desc');

    if (search) {
      params.append('keyword', search);
    }

    const response = await authFetch(`${API_BASE_URL}/hook?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    return handleApiResponse<ApiResponse>(response, 'fetch hooks');
  },

  /**
   * [FEAT-20260817-HOOKLABELS] The OA LABELS only — use this whenever a screen just
   * needs a name in a dropdown or a hover card.
   *
   * Measured on the dev database: one hook document is **105.7 KB** (89 KB of it AI
   * prompt text), so `getAllHooks()` ships **376.8 KB for six OAs**. This endpoint
   * returns ~1 KB for the same rows, with the same group scoping.
   *
   * `getAllHooks()` stays exactly as it is — 11 pages still call it, and several
   * genuinely need whole hooks. Move a page over only after checking which fields
   * it reads. หน้าไหนใช้แค่ชื่อ ให้ย้ายมาใช้ตัวนี้.
   */
  getHookLabels: async (): Promise<HookLabel[]> => {
    const response = await authFetch(`${API_BASE_URL}/hook/labels`, {
      method: 'GET',
    });
    const parsed = await handleApiResponse<{ data?: HookLabel[] }>(
      response,
      'list hook labels',
    );
    return Array.isArray(parsed?.data) ? parsed.data : [];
  },

  /**
   * Fetch ALL hooks for Client-side search/sort/pagination
   */
  getAllHooks: async (): Promise<HookData[]> => {
    const params = new URLSearchParams();
    // ==== [FIX-20260729-HOOKLIMIT] 1000 -> 300
    // 🔒 AUTO track — to_dev_auto branch only
    //
    // Asking for 1000 was misleading: the BE used to cap this at 100
    // (`Math.min(parseInt(req.query.limit) || 10, 100)`), so the extra zero never
    // fetched anything — it just told every reader of this file that we pull a
    // thousand rows on pages that display a single OA.
    //
    // 300 is now the real number on both sides (the BE cap was raised to match —
    // see [FIX-20260729-HOOKLIMIT] in hookController.js). Keep the two in sync:
    // asking for more than the BE cap silently returns the cap, which is exactly
    // the confusion this change removes.
    //
    // ⚠️ ถ้าวันหนึ่ง OA เกิน 300 ตัว หน้าที่เรียกเมธอดนี้จะเห็นไม่ครบ — ตอนนั้นต้องย้ายไป
    //    server-side paging เหมือนที่ WebhookList ทำแล้ว (ดู FIX-20260728-HOOKPAGE)
    //    ไม่ใช่ดันเลขขึ้นเรื่อย ๆ
    // revert: change '300' back to '1000' here and restore the BE cap to 100
    params.append('limit', '300');

    const response = await authFetch(`${API_BASE_URL}/hook?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });

    const parsed = await handleApiResponse<{ data: HookData[] }>(response, 'fetch hooks');
    return parsed.data || [];
  },

  getAllHooksForDashboard: async (): Promise<HookData[]> => {
    return webhookService.getAllHooks();
  },

  // ==== [FIX-20260728-HOOKPAGE] START — เมธอดนี้เพิ่มใหม่ทั้งหมด
  // ที่มา: หน้า hook (WebhookList) เดิมเรียก getAllHooks() = /hook?limit=1000
  // ดึงมาทั้งก้อนทุกครั้ง แล้ว search/filter/แบ่งหน้า "ฝั่ง client" ทั้งหมด
  // หน้านั้น poll ซ้ำทุก 20 วิ ด้วย → BE ต้อง decrypt 8 ฟิลด์ × ทุก row
  // ทิ้งเปล่า ๆ ตลอดเวลา ทั้งที่ผู้ใช้เห็นแค่ 10 แถว
  //
  // เมธอดนี้ยิงเฉพาะหน้าที่ดู และส่ง filter ไปให้ BE ทำ (BE รองรับแล้ว:
  // keyword/tag/status/fast_mode/group/sort — ดู [FIX-20260728-HOOKPAGE]
  // ใน hookController.js)
  //
  // *** ไม่แตะ getAllHooks() เดิม *** เพราะมี caller อื่นอีก 13 จุด
  // (dropdown เลือก OA, Dashboard, InsightReport ฯลฯ) ที่ต้องได้ทั้งหมดจริง
  // ถ้าไปแก้ตัวเดิมจะพังเป็นแถบ
  //
  // trim keyword ก่อนส่ง: ของเดิมไม่ trim ทำให้พิมพ์ "  acme  " แล้วหาไม่เจอ
  // อะไรเลย (เจอจาก parity test ฝั่ง BE) — trim ทั้งสองฝั่งให้ตรงกัน
  //
  // revert: ลบบล็อกนี้ทั้งก้อน (ไม่มีใครเรียกนอกจาก WebhookList ที่ revert คู่กัน)
  getHooksPaged: async (params: {
    page?: number;
    limit?: number;
    keyword?: string;
    status?: 'all' | 'active' | 'inactive';
    fast_mode?: number | 'all';
    group?: string;
    tag?: string;
    sort?: string;
  } = {}): Promise<{ data: HookData[]; total: number }> => {
    const qs = new URLSearchParams();
    qs.append('page', String(params.page ?? 1));
    qs.append('limit', String(params.limit ?? 10));
    qs.append('sort', params.sort ?? 'created_at:desc');

    const keyword = (params.keyword ?? '').trim();
    if (keyword) qs.append('keyword', keyword);
    // status: BE รับ 1/0 — 'all' คือไม่ส่ง (ไม่กรอง)
    if (params.status === 'active') qs.append('status', '1');
    if (params.status === 'inactive') qs.append('status', '0');
    if (params.fast_mode !== undefined && params.fast_mode !== 'all') {
      qs.append('fast_mode', String(params.fast_mode));
    }
    if (params.group && params.group !== 'all') qs.append('group', params.group);
    if (params.tag && params.tag !== 'all') qs.append('tag', params.tag);

    const response = await authFetch(`${API_BASE_URL}/hook?${qs.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const parsed = await handleApiResponse<{
      data: HookData[];
      pagination?: { total?: number };
    }>(response, 'fetch hooks');

    return {
      data: parsed.data || [],
      total: parsed.pagination?.total ?? (parsed.data?.length || 0),
    };
  },

  // ดึง tag ทั้งหมดสำหรับ dropdown ตัวกรอง — เดิมสร้างจาก allHooks ทั้ง 1000 ตัว
  // พอเปลี่ยนเป็น server-side paging แล้ว FE เห็นแค่ 10 แถว ถ้าไม่มีตัวนี้
  // dropdown จะเหลือแค่ tag ในหน้าปัจจุบัน = พฤติกรรมเปลี่ยน (ห้าม)
  // BE ใช้ distinct() ไม่ต้องดึง document และไม่ decrypt อะไรเลย
  getHookTags: async (): Promise<string[]> => {
    const response = await authFetch(`${API_BASE_URL}/hook/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await handleApiResponse<{ data: string[] }>(response, 'fetch hook tags');
    return parsed.data || [];
  },
  // ==== [FIX-20260728-HOOKPAGE] END

  /**
   * Server-side proxy for the hook's LINE bot profile picture.
   * Security fix (plan peppy, 2026-07-10): replaces a direct browser-side
   * call to api.line.me that sent the hook's raw access token as a Bearer
   * header. The backend now holds the token; only the picture URL comes back.
   */
  getHookBotInfo: async (hookId: string): Promise<{ pictureUrl: string | null }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${hookId}/bot-info`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    return handleApiResponse<{ pictureUrl: string | null }>(response, 'fetch hook bot info');
  },

  /**
   * [FEAT-20260815-LINEQUOTA] The OA's monthly LINE message allowance.
   *
   * Server-side proxy, exactly like `getHookBotInfo` above and for the same
   * reason: the hook's channel access token stays in the backend. It calls
   * LINE's two quota endpoints and returns them already paired —
   * `GET /v2/bot/message/quota` and `/quota/consumption`
   * (BE: hooks.service.ts `getHookQuota`).
   *
   * ⚠️ `quota.type === 'none'` means UNLIMITED, not zero — an account with no
   *    cap returns no `value` at all. Rendering it as 0/0 would tell the
   *    operator they are out of messages when they can send freely. `remaining`
   *    is null in that case because the backend cannot subtract from infinity.
   *
   * ⚠️ The number counts PUSH-type messages only (push/multicast/broadcast).
   *    Replies to an inbound message are free and never appear here, so this is
   *    "what the bot spent reaching out", not "every message the OA sent".
   */
  getHookQuota: async (hookId: string): Promise<HookQuotaResponse> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${hookId}/quota`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    return handleApiResponse<HookQuotaResponse>(response, 'fetch hook quota');
  },

  /**
   * [FEAT-20260917-INSIGHTFOLLOWERS] LINE followers & targeted reaches insight proxy
   * (BE: hooks.service.ts `getHookFollowers`).
   */
  getHookFollowers: async (hookId: string): Promise<HookFollowersResponse> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${hookId}/insight/followers`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    return handleApiResponse<HookFollowersResponse>(response, 'fetch hook followers insight');
  },

  getHooksByGroup: async (groupId: string): Promise<HookData[]> => {
    const response = await authFetch(`${API_BASE_URL}/hook/group/${groupId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    const parsed = await handleApiResponse<any>(response, 'fetch hooks by group');
    return parsed?.data ?? [];
  },

  getHookById: async (id: string): Promise<HookData> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    const parsed = await handleApiResponse<any>(response, 'fetch hook');
    return (parsed?.data ?? parsed) as HookData;
  },

  createHook: async (data: HookFormData): Promise<HookData> => {
    const { group_id, force_grant, ...rest } = data;
    const telegramKeyTrimmed = String(data.telegram_key ?? '').trim();
    const telegramChatIdTrimmed = String(data.telegram_chat_id ?? '').trim();
    const payload: Record<string, any> = {
      ...rest,
      force_grant: !!force_grant,
      suggestion_text: normalizeSuggestionText(data.suggestion_text),
      telegram_key: telegramKeyTrimmed ? telegramKeyTrimmed : null,
      telegram_chat_id: telegramChatIdTrimmed ? telegramChatIdTrimmed : null
    };
    if (group_id) {
      payload.group = group_id;
    }
    const response = await authFetch(`${API_BASE_URL}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return handleApiResponse<HookData>(response, 'create webhook');
  },

  /**
   * [FEAT-20260818-CLONEFULL] Copy Item — สร้าง OA ใหม่ "จากต้นทาง"
   *
   * payload เหมือน createHook ทุกอย่าง (ค่าที่กรอกในฟอร์ม) ต่างกันแค่ปลายทางเป็น
   * `POST /hook/:sourceId/duplicate` ⇒ BE คัดลอกค่าที่ฟอร์มไม่มีในมือให้เอง:
   * creds (ถูก mask ตอน GET จึงคัดลอกจากฝั่งนี้ไม่ได้เลย) + ข้อมูลที่ระบบดึงมาเก็บ
   * (`raw_site_rules_data`, `site_rules_updated_at`)
   *
   * ค่าที่ผู้ใช้พิมพ์/สลับในฟอร์มยังชนะเสมอ — BE เติมเฉพาะช่องที่ว่าง
   * ห้ามส่ง creds จากฝั่งนี้เพื่อ "ช่วย" คัดลอก: ค่าจริงไม่เคยมาถึงเบราว์เซอร์ตั้งแต่ต้น
   */
  duplicateHook: async (sourceId: string, data: HookFormData): Promise<HookData> => {
    const { group_id, force_grant, ...rest } = data;
    const telegramKeyTrimmed = String(data.telegram_key ?? '').trim();
    const telegramChatIdTrimmed = String(data.telegram_chat_id ?? '').trim();
    const payload: Record<string, any> = {
      ...rest,
      force_grant: !!force_grant,
      suggestion_text: normalizeSuggestionText(data.suggestion_text),
      telegram_key: telegramKeyTrimmed ? telegramKeyTrimmed : null,
      telegram_chat_id: telegramChatIdTrimmed ? telegramChatIdTrimmed : null
    };
    if (group_id) {
      payload.group = group_id;
    }
    const response = await authFetch(`${API_BASE_URL}/hook/${sourceId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return handleApiResponse<HookData>(response, 'duplicate webhook');
  },

  updateHook: async (id: string, data: Partial<HookFormData>): Promise<HookData> => {
    const { group_id, force_grant, ...rest } = data;
    const telegramKeyTrimmed = data.telegram_key !== undefined ? String(data.telegram_key ?? '').trim() : undefined;
    const telegramChatIdTrimmed = data.telegram_chat_id !== undefined ? String(data.telegram_chat_id ?? '').trim() : undefined;
    const payload: Record<string, any> = {
      ...rest,
      // [FIX-20260817-BLANKSECRET] see utils/secretMask.ts — a blank masked
      // secret is omitted, never nulled, so an unloaded form cannot erase it.
      telegram_key: secretForSubmit(telegramKeyTrimmed),
      telegram_chat_id: telegramChatIdTrimmed !== undefined ? (telegramChatIdTrimmed ? telegramChatIdTrimmed : null) : undefined
    };
    if (force_grant !== undefined) {
      payload.force_grant = force_grant;
    }
    if (group_id) {
      payload.group = group_id;
    }
    if (data.suggestion_text !== undefined) {
      payload.suggestion_text = normalizeSuggestionText(data.suggestion_text);
    }
    const response = await authFetch(`${API_BASE_URL}/hook/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return handleApiResponse<HookData>(response, 'update webhook');
  },

  // ==== [FEAT-20260729-BULKSTATUS] START — enable/disable several OAs at once
  // A separate endpoint from updateHookStatus below, which stays exactly as it
  // is because the per-row toggle still calls it. The API validates every id
  // before writing any of them and answers 403 with a `blocked` array naming the
  // OAs outside the caller's groups.
  // revert: delete this method, its call site in WebhookList.tsx, and the BE
  //         route + controller carrying the same marker.
  bulkUpdateHookStatus: async (
    ids: string[],
    status: number
  ): Promise<{ success: boolean; matched: number; modified: number; aliases: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/status/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk status update failed');
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },
  // ==== [FEAT-20260729-BULKSTATUS] END

  // ==== [FEAT-20260806-BULKSETTING] START — toggle ONE per-hook boolean across many OAs
  // Sibling of bulkUpdateHookStatus above; hits the additive PATCH /hook/settings/bulk.
  // `field` is validated server-side against a whitelist (slip_check /
  // customer_link_enabled / custom_tool_status) and 403 carries a `blocked` array like
  // the status endpoint. revert: delete this method + its call site + the BE marker.
  bulkUpdateHookSetting: async (
    ids: string[],
    field: 'slip_check' | 'customer_link_enabled' | 'custom_tool_status',
    value: boolean
  ): Promise<{ success: boolean; field: string; matched: number; modified: number; aliases: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/settings/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, field, value })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk setting update failed');
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },
  // [FEAT-20260821-BULKABANDON] switch the abandon chase on/off for many OAs at once.
  // WHY : `ignore_abandon_assist` = "this OA does not chase customers who were asked to
  //       register and went quiet". Without this an operator with 50 OAs had to open the
  //       edit form for each one; the BE route has existed since 21/08 and nothing called it.
  // WHY ITS OWN ROUTE and not `/hook/settings/bulk`: adding the field to
  //       `BULK_SETTING_FIELDS` would change a 400 message that `hook-write.golden-spec`
  //       compares with legacy byte for byte, and legacy has never heard of this field —
  //       every hook-write golden case would disagree for ever. Reason written out at
  //       `omnidesk-api/src/modules/hooks/hooks.service.ts:2790-2814`.
  // HOW : `value` MUST be a real boolean — the BE rejects non-booleans (`:2828`) because the
  //       STRING "false" is truthy in JS and would silence the chase on every OA someone
  //       was trying to switch back on.
  // revert: delete this method + the abandon entry in BulkMethodModal's METHODS.
  bulkUpdateHookAbandon: async (
    ids: string[],
    value: boolean
  ): Promise<{ success: boolean; matched: number; modified: number; aliases: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/abandon/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, value: !!value })
    });
  
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk abandon update failed');
      // same shape as the payment sibling: the API names the OAs it refused (403 blocked[]),
      // and the operator has to fix each one by name.
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },
  
  /**
   * [FEAT-20260828-BULKAI] ตั้ง AI vendor และ/หรือ model ให้หลาย OA พร้อมกัน
   *
   * 🔴 เส้นของตัวเอง (`PATCH /hook/ai/bulk`) ไม่ใช่ `settings/bulk` — เส้นนั้นรับ
   *    เฉพาะ boolean เพราะทุก method ที่อยู่หลังมันเป็นสวิตช์ on/off · การไปคลาย
   *    ด่านนั้นให้รับสตริงคือการคลายการตรวจให้ทั้ง 6 method พร้อมกัน
   *
   * 🔴 ส่งเฉพาะช่องที่ถูกติ๊ก — ช่องที่ไม่ได้ติ๊ก **ต้องไม่อยู่ใน body เลย**
   *    ฝั่ง BE แยก `undefined` (ไม่ได้ติ๊ก อย่าไปยุ่ง) ออกจาก `null` (ติ๊กแล้วเลือก
   *    ค่าเริ่มต้น) ⇒ ส่ง `null` มาทั้งที่ไม่ได้ติ๊ก = ไปล้างค่าเดิมของ OA ทิ้ง
   *    โดยไม่มีใครสั่ง · นี่คือเหตุผลที่สร้าง object ทีละคีย์แทนการส่งทั้งก้อน
   */
  bulkUpdateHookAi: async (
    ids: string[],
    fields: { ai_vendor?: string | null; ai_model?: string | null }
  ): Promise<{ success: boolean; matched: number; modified: number; aliases: string[] }> => {
    const payload: Record<string, unknown> = { ids };
    if ('ai_vendor' in fields) payload.ai_vendor = fields.ai_vendor ?? null;
    if ('ai_model' in fields) payload.ai_model = fields.ai_model ?? null;

    const response = await authFetch(`${API_BASE_URL}/hook/ai/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk AI update failed');
      // สัญญาเดียวกับพี่น้องทุกตัว: API บอกชื่อ OA ที่ปฏิเสธมาใน blocked[]
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },

  // ==== [FEAT-20260822-NOTICEMODE] START — the notice settings mode (its own routes)
  // WHY ITS OWN ROUTES: the notice columns are deliberately NOT in `ALLOWED_UPDATES`
  //   nor `BULK_SETTING_FIELDS` — both echo into 400 texts that golden specs compare
  //   with legacy byte for byte, and legacy has never heard of these fields. So the
  //   main `PUT /hook/:id` DROPS them silently by design, and this pair of methods is
  //   the ONLY way the dashboard may write them. เขียนได้ทางนี้ทางเดียว.
  // D6 GATE (owner): a notice toggle cannot be ON without every card that side needs
  //   — judged on the state the write would LEAVE. The BE answers 400 (per OA) or 403
  //   with `blocked[]` (bulk); the form warns first, this is the backstop.
  // revert: delete these two methods + the notice tab that calls them.
  updateHookNotice: async (
    id: string,
    fields: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const response = await authFetch(`${API_BASE_URL}/hook/notice/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      // the raw bag on purpose: the BE does its own `typeof` guards, because the
      // global pipe would turn the STRING "false" into `true` before any validator.
      body: JSON.stringify(fields)
    });
    return handleApiResponse(response, 'update notice settings');
  },

  bulkUpdateHookNotice: async (
    ids: string[],
    fields: Record<string, unknown>
  ): Promise<{ success: boolean; matched: number; modified: number; aliases: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/notice/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, fields })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk notice update failed');
      // same shape as the abandon/payment siblings: the API names the OAs it
      // refused and why, and the operator fixes each one by name.
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },
  // ==== [FEAT-20260822-NOTICEMODE] END

  // ==== [FEAT-20260806-BULKSETTING] END

  // ==== [FEAT-20260809-BULKPAYMENT] START — flip payment_tool_status across many OAs
  // Sibling of bulkUpdateHookSetting above, but its OWN endpoint (PATCH /hook/payment/bulk)
  // because turning payment ON is validated, which the generic settings route does not do.
  //
  // WHAT: ON  -> the BE checks EVERY target first (bound tool present, still exists, enabled,
  //              category 'payment'). If ANY target fails it refuses the WHOLE batch with 403
  //              + `blocked: [{alias, reason}]` and writes NOTHING — all-or-nothing.
  //       OFF -> no validation at all. A kill switch has to work even on a broken OA.
  // WHY : money. Half-applying a batch would leave some OAs live and some not, with no record
  //       of which. เปิดเงินต้องพร้อมทุกตัว ปิดต้องปิดได้เสมอ
  // HOW : `value` MUST be a real boolean — the BE rejects non-booleans on purpose, because the
  //       STRING "false" is truthy in JS and would silently ENABLE the OAs someone meant to
  //       kill. Callers pass a boolean; never forward a form string here.
  // revert: delete this method + the payment entry in BulkMethodModal's METHODS.
  bulkUpdateHookPayment: async (
    ids: string[],
    value: boolean
  ): Promise<{ success: boolean; matched: number; modified: number; aliases: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/payment/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // `!!value` is belt-and-braces: the signature already says boolean, but this is the one
      // place where a stray truthy string would turn payment ON for every listed OA.
      body: JSON.stringify({ ids, value: !!value })
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = new Error(body?.error || 'bulk payment update failed');
      // Carry `blocked` onto the error so the caller can name the OAs it refused and why —
      // dropping it would reduce a precise, actionable 403 to a generic failure toast.
      if (Array.isArray(body?.blocked)) err.blocked = body.blocked;
      throw err;
    }
    return body;
  },
  // ==== [FEAT-20260809-BULKPAYMENT] END

  /* ==== [FEAT-20260804-HOOKCLONE] คัดลอกการตั้งค่าจาก OA ต้นแบบ → OA อื่น ====
   * 🔒 สาย AUTO — to_dev_auto / to_prod_auto
   * ⭐ รายชื่อแท็บ/field ดึงจาก BE เสมอ ห้าม hardcode ฝั่งนี้ —
   *    เพิ่ม field ใหม่วันหน้าแล้วลืมแก้ FE = โมดัลบอกจำนวนช่องผิดให้ผู้ใช้
   * revert: ลบ 2 เมธอดนี้ + HookCloneModal.tsx + ปุ่มใน WebhookList
   */
  getHookFieldTabs: async (): Promise<{
    tabs: Array<{
      key: string;
      label_th: string;
      label_en: string;
      field_count: number;
      sensitive_fields: string[];
    }>;
  }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/field-tabs`);
    return handleApiResponse(response, 'load hook field tabs');
  },

  cloneHookSettings: async (
    sourceId: string,
    payload: { target_ids: string[]; tabs: string[]; fields?: string[]; include_secrets?: string[]; allow_cross_group?: boolean; provision_handoff?: boolean; force_grant?: boolean }
  ): Promise<{
    source: { hook_id: string; alias: string };
    tabs: string[];
    included_secrets: string[];
    // [FEAT-20260822-CLONEFIELDS] the exact list the BE applied
    fields_applied?: string[];
    total: number;
    success: number;
    failed: number;
    results: Array<{
      hook_id: string;
      ok: boolean;
      changed?: number;
      alias?: string;
      reason?: string;
      /* [FIX-20260822-NOTICEHARDEN] BE may explain a refusal in words — today
         only the notice card gate does (`notice_cards_incomplete`), which
         names the side that is missing its card. Optional on purpose: every
         other reason has none, and the modal falls back to the reason key. */
      detail?: string;
      // [FEAT-20260806-CHAIN] warnings surfaced to the operator after a clone
      web_code_shared_with?: string; // source OA name when web_code was copied (conscious share)
      slip_provider_held_without_key?: boolean; // [FEAT-20261016-SLIPGUARDLOAN] provider not moved — its key was not ticked
      handoff?: { chains: string[]; targets: string[]; warnings: string[] };
    }>;
  }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${sourceId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // ⚠️ confirm ส่งจากที่นี่ที่เดียว — BE ปฏิเสธถ้าไม่มี (กันยิงพลาด)
      body: JSON.stringify({ ...payload, confirm: true }),
    });
    return handleApiResponse(response, 'clone hook settings');
  },
  // ==== [FEAT-20260804-HOOKCLONE] END

  updateHookStatus: async (id: string, status: number): Promise<{ message?: string }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });

    return handleApiResponse<{ message?: string }>(response, 'update webhook status');
  },

  deleteHook: async (id: string, actor?: ActorHeaders): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${id}`, {
      method: 'DELETE',
      headers: {
        ...buildActorHeaders(actor),
      },
    });
    if (!response.ok) throw new Error(`Failed to delete: ${response.statusText}`);
  },

  /**
   * Bulk Delete Hooks
   */
  deleteHooks: async (ids: string[], actor?: ActorHeaders): Promise<void> => {
    // Process deletes in parallel
    await Promise.all(ids.map(id => 
      authFetch(`${API_BASE_URL}/hook/${id}`, {
        method: 'DELETE',
        headers: {
          ...buildActorHeaders(actor),
        },
      })
    ));
  }
};
