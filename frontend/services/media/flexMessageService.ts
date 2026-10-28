import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { FlexMessageEntry, FlexMessageFormData, FlexMessageListResponse, FlexVarGuidelineRow, Pagination } from '../../types';

const normalizeFlexMessage = (raw: any): FlexMessageEntry => ({
  id: raw?._id ?? raw?.id ?? '',
  name: raw?.name ?? '',
  content_json: raw?.content_json ?? {},
  group_ids: Array.isArray(raw?.group_ids) ? raw.group_ids : (raw?.group_id ? [raw.group_id] : []),
  // [FEAT-20260801-FLEXTYPE] เดิมไม่ได้ map ตัวนี้ → เปิดแก้ flex ประเภท profile
  // แล้วฟอร์มตีเป็น slip (ตาราง+allowlist ผิดชุด) · เก่าไม่มีค่า = slip ตามเดิม
  flex_type: raw?.flex_type ?? 'slip',
  /* [FEAT-20260829-FLEXMENUTYPE] ⚠️ this map builds a NEW object field by field —
     a field missing HERE is silently dropped on the way back, the form re-opens
     blank, and the next save writes the blank over the real value. That is the
     `direct_ticket_on_reply` bug noted below, and this line is why it cannot
     happen to the menu sub-type. `?? null` on purpose: absent means "no
     sub-type", never a guessed 'main'. */
  flex_sub_type: raw?.flex_sub_type ?? null,
  /* [FEAT-20260829-FLEXMENUSLUG] ต้องอยู่ในแมพนี้ด้วยเหตุผลเดียวกับ flex_sub_type —
     ไม่ใส่ = ค่าหายตอนอ่านกลับ ฟอร์มเปิดมาว่าง แล้วเซฟรอบหน้าทับของจริง */
  flex_slug: raw?.flex_slug ?? null,
  // ⚠️ [FIX-20260802-SRCLOST2] ต้อง map 2 ตัวนี้ด้วย — เคยลืมแล้วเจ็บมาแล้ว
  //   BE คืนค่ามาถูกแล้ว แต่ตัว normalize สร้าง object ใหม่ทีละ field
  //   ไม่ใส่ = โดนตัดทิ้งตรงนี้ ฟอร์มเลยเปิดมาชิปว่าง (ดูเหมือน "deselect เอง")
  //   แล้วพอกดบันทึกซ้ำจะส่ง [] ไปทับของจริงใน DB = ข้อมูลหาย
  //   👉 เพิ่ม column ใหม่ให้การ์ดเมื่อไหร่ ต้องเพิ่มที่นี่ด้วยเสมอ
  source_role: raw?.source_role ?? null,                                  // [FEAT-20260802-FLEXSRC]
  source_roles: Array.isArray(raw?.source_roles) ? raw.source_roles : [], // [FEAT-20260802-FLEXNS]
  // [FEAT-20260802-FLEXTAG] ไม่มี = null → ตารางโชว์ "-" (ประเภทอื่นไม่มี tag)
  flex_tag: raw?.flex_tag ?? null,
  callback_detail: raw?.callback_detail ?? '',
  callback_tag: raw?.callback_tag ?? '',
  /* [FEAT-20260810-CARDTICKET] ต้องอยู่ที่นี่ตามคำเตือนข้างบน — เคยลืมแล้วเจอจริง
     2026-08-10: ติ๊ก + พิมพ์เหตุผล แล้วกดบันทึก ค่า "เข้า DB จริง" แต่ตัวนี้ตัดทิ้ง
     ตอนอ่านกลับ ⇒ ฟอร์มเปิดมาว่าง ดูเหมือน "FE ไม่เซฟ" และถ้ากดบันทึกซ้ำจะส่ง
     false/'' ไปทับของจริง = ปิด ticket ให้เงียบ ๆ โดยไม่มีใครรู้ */
  direct_ticket_on_reply: raw?.direct_ticket_on_reply === true,
  direct_ticket_text: raw?.direct_ticket_text ?? '',
  created_at: raw?.created_at,
  updated_at: raw?.updated_at
});

const normalizePagination = (parsed: any, fallbackPage: number, fallbackLimit: number, totalItems: number): Pagination => {
  const meta = parsed?.meta ?? parsed?.pagination ?? {};
  const total = meta?.total ?? totalItems;
  const limit = meta?.limit ?? fallbackLimit;
  const page = meta?.page ?? fallbackPage;
  return {
    page,
    limit,
    total,
    total_pages: meta?.total_pages ?? (limit ? Math.ceil(total / limit) : 1)
  };
};

export const flexMessageService = {
  listFlexMessages: async (params: { page?: number; limit?: number; name?: string; group_id?: string; flex_type?: string; tab?: string } = {}): Promise<FlexMessageListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 25));
    if (params.name) searchParams.append('name', params.name);
    if (params.group_id) searchParams.append('group_id', params.group_id);
    // [FEAT-20260801-FLEXPROFILE] ไม่ส่ง = ได้ทุกประเภทเหมือนเดิม (seamless)
    if (params.flex_type) searchParams.append('flex_type', params.flex_type);
    /* [FEAT-20260829-FLEXMENUTYPE] `tab=menu` / `tab=normal`. NOT SENT = the URL
       is byte-identical to today, so every existing caller is untouched. The
       server decides what "normal" excludes; the dashboard only names the tab. */
    if (params.tab) searchParams.append('tab', params.tab);

    const response = await authFetch(`${API_BASE_URL}/api/flex-messages?${searchParams.toString()}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'list flex messages');
    const rawData = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
    const data = rawData.map(normalizeFlexMessage);
    
    return {
      data,
      pagination: normalizePagination(parsed, params.page ?? 1, params.limit ?? 25, data.length)
    };
  },

  getFlexMessage: async (id: string): Promise<FlexMessageEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/flex-messages/${id}`, {
      method: 'GET'
    });
    const parsed = await handleApiResponse<any>(response, 'get flex message');
    return normalizeFlexMessage(parsed?.data ?? parsed);
  },

  createFlexMessage: async (data: FlexMessageFormData): Promise<FlexMessageEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/flex-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const parsed = await handleApiResponse<any>(response, 'create flex message');
    return normalizeFlexMessage(parsed?.data ?? parsed);
  },

  updateFlexMessage: async (id: string, data: Partial<FlexMessageFormData>): Promise<FlexMessageEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/flex-messages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const parsed = await handleApiResponse<any>(response, 'update flex message');
    return normalizeFlexMessage(parsed?.data ?? parsed);
  },

  // ==== [FEAT-20260802-FLEXVARAPI] ตารางตัวแปรของ flex ประเภท normal/profile/custom
  // ⚠️ BE เป็นเจ้าของสเปกที่เดียว (src/config/flexVarSpec.js) — ตัวเดียวกับที่ webhook
  //    ใช้แทนค่าจริงตอนส่งการ์ด · FE จึงไม่ถือตารางของตัวเองอีกแล้ว ไม่มีทางดริฟต์
  // ⚠️ ประเภท slip ไม่ได้มาจากเส้นนี้ ยังใช้ตารางเดิมในฟอร์ม (ตัวแปรสลิปคนละเส้น)
  // revert: ลบเมธอดนี้ + จุดเรียกในฟอร์ม + endpoint ฝั่ง BE
  // [FEAT-20260802-FLEXNS] รับได้หลายแหล่ง (array) — BE ติด source_role/source_label มาให้ทุกแถว
  //   ไม่ส่ง = profile อย่างเดียว = ชุดเดิมเป๊ะ
  getVariableGuidelines: async (flexType: string, sources?: string[] | string | null): Promise<FlexVarGuidelineRow[]> => {
    const list = Array.isArray(sources) ? sources.filter(Boolean) : (sources ? [sources] : []);
    const q = `flex_type=${encodeURIComponent(flexType)}` + (list.length ? `&source=${encodeURIComponent(list.join(','))}` : '');
    const response = await authFetch(
      `${API_BASE_URL}/api/flex-messages/variables?${q}`,
      { method: 'GET' }
    );
    const parsed = await handleApiResponse<any>(response, 'get flex variables');
    const rows = parsed?.data?.rows ?? parsed?.rows ?? [];
    return Array.isArray(rows) ? rows : [];
  },

  /**
   * ==== [FEAT-20260830-FLEXBULKGROUPS] replace the group scope of many cards ====
   *
   * 🔗 CROSS-REPO. The endpoint is `POST /api/flex-messages/bulk-groups` in
   * `omnidesk-api` (src/modules/content/flex-messages.controller.ts). BE decides:
   * it re-checks the caller's group scope on the read AND on every write, and a
   * card the caller may not see comes back in `skipped` rather than as an error.
   * Deploy BE first — with FE alone this call is a 404.
   *
   * ⚠️ REPLACE, not merge: `group_ids` becomes exactly what is sent. The dialog
   * says so before the operator can confirm.
   *
   * WHY `handleApiResponse` AND NOT THE HAND-ROLLED ERROR PATH the users bulk
   * methods use: those bypass it to keep a `blocked[]` array off the 403, and
   * pay for it by also skipping the 401 auto-logout. This endpoint reports
   * per-card outcomes in its 200 body instead, so there is nothing to rescue
   * from the error path and the shared handler stays in place.
   *
   * revert: delete this method and its caller in pages/content/FlexMessageList.tsx.
   */
  bulkUpdateGroups: async (
    flexIds: string[],
    groupIds: string[]
  ): Promise<{ success: boolean; matched: number; modified: number; group_ids: string[]; updated: { id: string; name: string }[]; skipped: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/api/flex-messages/bulk-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flex_ids: flexIds, group_ids: groupIds })
    });
    const parsed = await handleApiResponse<any>(response, 'bulk update flex groups');
    const body = parsed?.data ?? parsed;
    return {
      success: body?.success === true,
      matched: body?.matched ?? 0,
      modified: body?.modified ?? 0,
      group_ids: Array.isArray(body?.group_ids) ? body.group_ids : [],
      updated: Array.isArray(body?.updated) ? body.updated : [],
      skipped: Array.isArray(body?.skipped) ? body.skipped : []
    };
  },

  deleteFlexMessage: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/flex-messages/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.statusText}`);
    }
  }
};
