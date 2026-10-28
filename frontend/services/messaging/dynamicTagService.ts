import { DynamicTagEntry, DynamicTagFormData, DynamicTagListResponse } from '../../types';
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

const normalizeDynamicTag = (raw: any): DynamicTagEntry => ({
  id: raw?._id ?? raw?.id ?? '',
  tag: raw?.tag ?? '',
  value: raw?.value ?? '',
  detail: raw?.detail ?? '',
  status: !!raw?.status,
  type: raw?.type ?? 'system',
  sub_type: raw?.sub_type ?? '',
  ref_api_id: raw?.ref_api_id ?? '',
  hook_id: raw?.hook_id ?? '',
  group_id: raw?.group_id ?? '', // [FEAT-20260728-TAGSCOPE]
  hook_ids: Array.isArray(raw?.hook_ids) ? raw.hook_ids : [], // [FEAT-20260728-TAGSCOPE]
  group_ids: Array.isArray(raw?.group_ids) ? raw.group_ids : [], // [FEAT-20260728-TAGSCOPE]
  primary_credential_source: raw?.primary_credential_source ?? '', // [FEAT-20260728-TAGSCOPE]
  created_by: raw?.created_by ?? '',
  created_at: raw?.created_at ?? '',
  updated_at: raw?.updated_at ?? ''
});

export const dynamicTagService = {
  // [FEAT-20260728-TAGSCOPE] + scope_group_id = ทุก tag ที่มีผลภายใต้กลุ่ม (กลุ่ม + ราย OA สมาชิก)
  /* [FEAT-20260803-DYTAGFILTER] รายชื่อ path ที่มีอยู่จริง + จำนวนของแต่ละอัน
     ⚠️ ไม่ hard-code รายชื่อ — endpoint key มาจาก custom tool ของแต่ละ environment
     ล้มเหลว → คืน [] แล้ว dropdown จะไม่โผล่ (หน้าเดิมยังใช้ได้ ไม่พัง) */
  listSubTypes: async (): Promise<{ sub_type: string; label: string; count: number }[]> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/dynamic-tags/sub-types`);
      if (!res.ok) return [];
      const json = await res.json().catch(() => null);
      return json?.success ? (json.data || []) : [];
    } catch { return []; }
  },

  listDynamicTags: async (params: { page?: number; limit?: number; tag?: string; hook_id?: string; scope_group_id?: string; sub_type?: string } = {}): Promise<DynamicTagListResponse> => {
    const query = new URLSearchParams();
    query.append('page', String(params.page ?? 1));
    query.append('limit', String(params.limit ?? 10));
    if (params.tag) query.append('tag', params.tag);
    if (params.hook_id) query.append('hook_id', params.hook_id);
    if (params.scope_group_id) query.append('scope_group_id', params.scope_group_id); // [FEAT-20260728-TAGSCOPE]
    // [FEAT-20260803-DYTAGFILTER] กรองตาม path (ชื่อ endpoint ของ custom tool)
    if (params.sub_type) query.append('sub_type', params.sub_type);

    try {
      const response = await authFetch(`${API_BASE_URL}/api/dynamic-tags?${query.toString()}`);
      
      // If we get a 404, we treat it as an empty list per user requirement
      if (response.status === 404) {
        return {
          data: [],
          pagination: { page: params.page ?? 1, limit: params.limit ?? 10, total: 0, total_pages: 0 }
        };
      }

      const parsed = await handleApiResponse<any>(response, 'list dynamic tags');
      const rawData = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
      const data = rawData.map(normalizeDynamicTag);
      
      const total = parsed?.pagination?.total ?? 
                    parsed?.total ?? 
                    parsed?.total_records ?? 
                    parsed?.total_count ?? 
                    parsed?.count ?? 
                    rawData.length;

      const pagination = parsed?.pagination ?? {
        page: parsed?.page ?? params.page ?? 1,
        limit: parsed?.limit ?? params.limit ?? 10,
        total: total,
      };

      if (!pagination.total_pages && pagination.total !== undefined) {
        pagination.total_pages = Math.ceil(pagination.total / (pagination.limit || 10)) || 1;
      }
      
      return {
        data,
        pagination: {
          ...pagination,
          total_pages: pagination.total_pages || 1
        }
      };
    } catch (error) {
      console.error('Failed to list dynamic tags:', error);
      // Return empty list on error to avoid breaking UI
      return {
        data: [],
        pagination: { page: params.page ?? 1, limit: params.limit ?? 10, total: 0, total_pages: 0 }
      };
    }
  },

  createDynamicTag: async (data: DynamicTagFormData): Promise<DynamicTagEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/dynamic-tags`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' }
    });
    const parsed = await handleApiResponse<any>(response, 'create dynamic tag');
    return normalizeDynamicTag(parsed?.data ?? parsed);
  },

  // ==== [FEAT-20260801-BULKTAGSCOPE] แก้ขอบเขต (กลุ่ม/OA) หลาย tag พร้อมกัน
  // เส้นนี้รับ **เฉพาะฝั่งกลุ่ม** ฟิลด์อื่นของ tag ถูกเมินฝั่ง BE แม้ส่งไปก็ตาม
  // ⚠️ เป็นการ "แทนที่" ไม่ใช่รวมกับของเดิม — UI เตือนก่อนกดยืนยันแล้ว
  // revert: ลบเมธอดนี้ + จุดเรียกใน DynamicTagList.tsx
  bulkUpdateScope: async (
    tagIds: string[],
    groupIds: string[],
    hookIds: string[]
  ): Promise<{ success: boolean; matched: number; modified: number; tags: string[] }> => {
    const response = await authFetch(`${API_BASE_URL}/api/dynamic-tags/bulk-scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_ids: tagIds, group_ids: groupIds, hook_ids: hookIds }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // BE ตอบเหตุผลมาเป็นข้อความไทยอยู่แล้ว (เช่น "ต้องเลือกอย่างน้อย 1 กลุ่ม…")
      // ส่งต่อให้ผู้ใช้เห็นตรง ๆ ดีกว่ายุบเป็น error กลาง ๆ ที่ทำอะไรต่อไม่ได้
      throw new Error(body?.error || 'bulk tag scope update failed');
    }
    return body;
  },

  updateDynamicTag: async (id: string, data: Partial<DynamicTagFormData>): Promise<DynamicTagEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/dynamic-tags/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' }
    });
    const parsed = await handleApiResponse<any>(response, 'update dynamic tag');
    return normalizeDynamicTag(parsed?.data ?? parsed);
  },

  deleteDynamicTag: async (id: string): Promise<{ success: boolean; message?: string }> => {
    const response = await authFetch(`${API_BASE_URL}/api/dynamic-tags/${id}`, {
      method: 'DELETE'
    });
    return handleApiResponse<{ success: boolean; message?: string }>(response, 'delete dynamic tag');
  },

  /**
   * [FIX-20260729-DYTAGTOOL] เพิ่ม primaryCredId
   * แท็ก 1 ใบใช้ได้หลาย OA/ทั้งกลุ่ม → ตอนพรีวิวต้องบอกว่ายืม credential ของ OA
   * ตัวไหนมายิง = ช่อง "PRIMARY CREDENTIAL SOURCE" ในฟอร์ม
   * ไม่ส่ง = ใช้ hook ใน URL (โหมด "เฉพาะ OA" ซึ่งเป็น OA นั้นอยู่แล้ว) = เดิมเป๊ะ
   * BE จะ resolve เองว่า OA นั้นเป็นสาย custom tool หรือ external_endpoints เดิม
   */
  loginHook: async (hookId: string, primaryCredId?: string | null): Promise<{ token: string; response: any }> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${hookId}/test-external-api`, {
      method: 'POST',
      body: JSON.stringify(primaryCredId ? { primary_credential_source: primaryCredId } : {}),
      headers: { 'Content-Type': 'application/json' }
    });
    const parsed = await handleApiResponse<any>(response, 'login hook');
    return {
      token: parsed?.token || null,
      response: parsed?.response || parsed
    };
  },

  /**
   * [FIX-20260729-DYTAGTOOL] รายการ path ให้ dropdown "Sub Type"
   * รองรับทั้ง OA เส้นเดิม (external_endpoints) และ OA สาย custom tool
   * BE คืนแค่ key/method/path — ไม่มี credential
   * ใช้สิทธิ์ dynamic_tags.manage ชุดเดียวกับหน้านี้ (ไม่ต้องมี custom_tools.manage)
   */
  getTagEndpoints: async (
    hookId: string
  ): Promise<{ source: string; tool_name: string; endpoints: any[]; warning?: string }> => {
    try {
      const response = await authFetch(`${API_BASE_URL}/hook/${hookId}/tag-endpoints`);
      const parsed = await handleApiResponse<any>(response, 'get tag endpoints');
      return {
        source: parsed?.source || 'hook',
        tool_name: parsed?.tool_name || '',
        endpoints: Array.isArray(parsed?.endpoints) ? parsed.endpoints : [],
        warning: parsed?.warning,
      };
    } catch (error) {
      // BE เก่ายังไม่มี route นี้ → อย่าทำให้ฟอร์มพัง ปล่อยให้ fallback ไปทางเดิม
      console.error('Failed to get tag endpoints:', error);
      return { source: 'hook', tool_name: '', endpoints: [] };
    }
  },

  testExternalEndpoint: async (hookId: string, endpointKey: string, lineUserId: string, token: string, additionalData: any = {}): Promise<any> => {
    const response = await authFetch(`${API_BASE_URL}/hook/${hookId}/execute-external-endpoint`, {
      method: 'POST',
      body: JSON.stringify({
        endpoint_key: endpointKey,
        line_user_id: lineUserId,
        token: token,
        additional_data: additionalData
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    return handleApiResponse<any>(response, 'test external endpoint');
  }
};
