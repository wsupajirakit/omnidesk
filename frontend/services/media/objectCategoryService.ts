import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { ObjectCategory, ObjectCategoryFormData, Pagination } from '../../types';

export const objectCategoryService = {
  listCategories: async (params?: { page?: number; limit?: number; search?: string }): Promise<ObjectCategory[]> => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.search) query.append('name', params.search); // Backend expects 'name' for filtering

    const response = await authFetch(`${API_BASE_URL}/api/object-categories?${query.toString()}`, {
      method: 'GET'
    });
    const res = await handleApiResponse<any>(response, 'list object categories');
    return res.data || res;
  },

  getCategory: async (id: string): Promise<ObjectCategory> => {
    const response = await authFetch(`${API_BASE_URL}/api/object-categories/${id}`, {
      method: 'GET'
    });
    const res = await handleApiResponse<any>(response, 'get object category');
    return res.data || res;
  },

  createCategory: async (data: ObjectCategoryFormData): Promise<ObjectCategory> => {
    const response = await authFetch(`${API_BASE_URL}/api/object-categories`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return handleApiResponse<ObjectCategory>(response, 'create object category');
  },

  updateCategory: async (id: string, data: ObjectCategoryFormData): Promise<ObjectCategory> => {
    const response = await authFetch(`${API_BASE_URL}/api/object-categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return handleApiResponse<ObjectCategory>(response, 'update object category');
  },

  deleteCategory: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/object-categories/${id}`, {
      method: 'DELETE'
    });
    await handleApiResponse<void>(response, 'delete object category');
  }
};
