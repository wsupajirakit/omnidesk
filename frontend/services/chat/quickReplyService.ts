import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

// One canned "ตอบด่วน" message inside a category.
export interface QuickReply {
  _id: string;
  category_id: string;
  text: string;
  order?: number;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface QuickReplyCategory {
  _id: string;
  name: string;
  order?: number;
  created_by_name?: string | null;
  created_at?: string;
  replies: QuickReply[];
}

// Global quick-reply store, shared across all admins. Used by BOTH the composer
// panel (pick → insert into the draft, not sent) and the settings modal (CRUD).
export const quickReplyService = {
  list: async (): Promise<{ success: boolean; data: { categories: QuickReplyCategory[] } }> => {
    const res = await authFetch(`${API_BASE_URL}/api/quick-replies`);
    return handleApiResponse(res, 'list quick replies');
  },

  // ── categories ──
  createCategory: async (name: string): Promise<{ success: boolean; data: QuickReplyCategory }> => {
    const res = await authFetch(`${API_BASE_URL}/api/quick-reply-categories`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    return handleApiResponse(res, 'create category');
  },
  updateCategory: async (id: string, name: string): Promise<{ success: boolean; data: QuickReplyCategory }> => {
    const res = await authFetch(`${API_BASE_URL}/api/quick-reply-categories/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    return handleApiResponse(res, 'update category');
  },
  deleteCategory: async (id: string): Promise<{ success: boolean }> => {
    const res = await authFetch(`${API_BASE_URL}/api/quick-reply-categories/${id}`, { method: 'DELETE' });
    return handleApiResponse(res, 'delete category');
  },

  // ── replies ──
  createReply: async (categoryId: string, text: string): Promise<{ success: boolean; data: QuickReply }> => {
    const res = await authFetch(`${API_BASE_URL}/api/quick-replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category_id: categoryId, text }),
    });
    return handleApiResponse(res, 'create reply');
  },
  updateReply: async (id: string, text: string): Promise<{ success: boolean; data: QuickReply }> => {
    const res = await authFetch(`${API_BASE_URL}/api/quick-replies/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    return handleApiResponse(res, 'update reply');
  },
  deleteReply: async (id: string): Promise<{ success: boolean }> => {
    const res = await authFetch(`${API_BASE_URL}/api/quick-replies/${id}`, { method: 'DELETE' });
    return handleApiResponse(res, 'delete reply');
  },
};
