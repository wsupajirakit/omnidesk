import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { ObjectImage, ObjectImageFormData, ObjectImageListResponse } from '../../types';

export const objectImageService = {
  listImages: async (params?: { page?: number; limit?: number; search?: string; category?: string; tag?: string }): Promise<ObjectImage[]> => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.search) query.append('image_id', params.search);
    if (params?.category) query.append('category', params.category);
    if (params?.tag) query.append('tag', params.tag);

    const response = await authFetch(`${API_BASE_URL}/api/object-images?${query.toString()}`, {
      method: 'GET'
    });
    const res = await handleApiResponse<any>(response, 'list object images');
    return res.data || res;
  },

  getImage: async (id: string): Promise<ObjectImage> => {
    const response = await authFetch(`${API_BASE_URL}/api/object-images/${id}`, {
      method: 'GET'
    });
    const res = await handleApiResponse<any>(response, 'get object image');
    return res.data || res;
  },

  createImage: async (data: ObjectImageFormData): Promise<ObjectImage> => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { image_id, ...payload } = data;
    const response = await authFetch(`${API_BASE_URL}/api/object-images`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return handleApiResponse<ObjectImage>(response, 'create object image');
  },

  updateImage: async (id: string, data: Partial<ObjectImageFormData>): Promise<ObjectImage> => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { image_id, ...payload } = data;
    const response = await authFetch(`${API_BASE_URL}/api/object-images/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return handleApiResponse<ObjectImage>(response, 'update object image');
  },

  deleteImage: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/object-images/${id}`, {
      method: 'DELETE'
    });
    await handleApiResponse<void>(response, 'delete object image');
  }
};
