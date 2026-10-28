import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { RoleEntry } from '../../types';

export const roleService = {
  listRoles: async (): Promise<{ data: RoleEntry[] }> => {
    const response = await authFetch(`${API_BASE_URL}/api/roles`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'list roles');
    if (Array.isArray(parsed)) {
      return { data: parsed as RoleEntry[] };
    }
    return { data: parsed?.data ?? [] };
  }
};
