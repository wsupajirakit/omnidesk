import { SystemConfigFormData, SystemConfigListResponse, SystemConfigEntry } from '../../types';
import { API_BASE_URL, handleApiResponse, authFetch } from '../apiClient';

export const configService = {
  listConfigs: async (params: { page?: number; limit?: number; key_prefix?: string; type?: string; flag?: string | number } = {}): Promise<SystemConfigListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 20));
    if (params.key_prefix) searchParams.append('key_prefix', params.key_prefix);
    if (params.type) searchParams.append('type', params.type);
    if (params.flag !== undefined) searchParams.append('flag', String(params.flag));

    const response = await authFetch(`${API_BASE_URL}/configs?${searchParams.toString()}`, {
      method: 'GET',
    });

    return handleApiResponse<SystemConfigListResponse>(response, 'list configs');
  },

  getConfig: async (id: string): Promise<{ data: SystemConfigEntry }> => {
    const response = await authFetch(`${API_BASE_URL}/config/${id}`, {
      method: 'GET',
    });

    return handleApiResponse<{ data: SystemConfigEntry }>(response, 'get config');
  },

  createConfig: async (data: SystemConfigFormData): Promise<SystemConfigEntry> => {
    const response = await authFetch(`${API_BASE_URL}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    return handleApiResponse<SystemConfigEntry>(response, 'create config');
  },

  updateConfig: async (id: string, data: Partial<SystemConfigFormData>): Promise<SystemConfigEntry> => {
    const response = await authFetch(`${API_BASE_URL}/config/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    return handleApiResponse<SystemConfigEntry>(response, 'update config');
  },

  deleteConfig: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/config/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete: ${response.statusText}`);
  },

  testExternalApi: async (creds: { baseUrl: string; username?: string; password?: string }): Promise<any> => {
    const params = new URLSearchParams({
      baseUrl: creds.baseUrl,
      ...(creds.username && { username: creds.username }),
      ...(creds.password && { password: creds.password })
    });
    
    const response = await authFetch(`${API_BASE_URL}/config/test-external-api?${params.toString()}`, {
      method: 'GET',
    });

    return handleApiResponse<any>(response, 'test external api');
  },

  testCustomConfig: async (payload: any): Promise<any> => {
    const response = await authFetch(`${API_BASE_URL}/config/test-custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    return handleApiResponse<any>(response, 'test custom config');
  }
};
