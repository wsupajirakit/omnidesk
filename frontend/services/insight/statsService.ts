import { API_BASE_URL, handleApiResponse, authFetch } from '../apiClient';

export interface WebhookLogStatsResponse {
  data: Array<{
    type: string;
    count_success: number;
    count_failed: number;
    date?: string;
    day?: string;
    [key: string]: any;
  }>;
  summary?: {
    count_success: number;
    count_failed: number;
  };
}

export const statsService = {
  getStats: async (from: string, to: string): Promise<WebhookLogStatsResponse> => {
    const params = new URLSearchParams();
    params.append('from', from);
    params.append('to', to);

    const response = await authFetch(`${API_BASE_URL}/stats?${params.toString()}`, {
      method: 'GET',
    });

    return handleApiResponse<WebhookLogStatsResponse>(response, 'fetch stats');
  }
};
