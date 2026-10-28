import { API_BASE_URL, handleApiResponse, authFetch } from '../apiClient';

export interface InsightSummary {
  total_tickets: number;
  avg_first_response_seconds: number;
  avg_handling_seconds: number;
  avg_total_resolution_seconds: number;
}

export interface CategoryDistributionItem {
  category: string;
  count: number;
}

export interface OaDistributionItem {
  line_oa_name: string;
  count: number;
}

export interface AgentLeaderboardItem {
  display_name: string;
  assigned_count: number;
  accepted_count: number;
  closed_count: number;
  transfer_count: number;
  auto_unassist_count: number;
  avg_handling_seconds: number;
}

export interface DailySummary {
  date: string;
  total_messaged: number;
  ai_handled: {
    count: number;
    by_category: { category: string; count: number }[];
  };
  ai_with_assist: { count: number };
  admin_handled: {
    count: number;
    by_category: { category: string; count: number }[];
  };
}


export interface InsightReportResponse {
  success: boolean;
  data: {
    presets: {
      custom_filter: InsightSummary;
      today: InsightSummary;
      this_week: InsightSummary;
      this_month: InsightSummary;
    };
    category_distribution: CategoryDistributionItem[];
    oa_distribution: OaDistributionItem[];
    agent_leaderboard: AgentLeaderboardItem[];
    daily_summary?: DailySummary;
  };
}

/**
 * [FEAT-20260820-REGINSIGHT] counts for the "Register data" card.
 * BE: GET /api/insight-reports/registrations — count-only (admin/member;
 * the legacy 'system' value is excluded server-side by owner order).
 * `data` is null when the caller has no OA access (scope: 'no_oa_access').
 */
export interface RegistrationInsights {
  admin: number;
  member: number;
  /**
   * [FEAT-20260821-REGBOTASSIST] an admin finished it, but the BOT had chased
   * this customer first (`config.follow_up.line.request_reg_at` is stamped).
   *
   * ⚠️ `admin` IS NARROWER THAN IT WAS. Before 21/08 it meant "an admin did
   * it"; it now means "an admin did it and nobody had chased them". The two
   * added together are the old number — worth knowing before comparing this
   * card against a figure written down earlier.
   */
  admin_bot_assisted: number;
  total: number;
}

export interface RegistrationInsightsResponse {
  success: boolean;
  data: RegistrationInsights | null;
  scope?: string;
}

export const insightReportService = {
  getTicketInsights: async (filters: {
    from?: string;
    to?: string;
    start_time?: string;
    end_time?: string;
    category?: string;
    line_oa_hook_id?: string;
    admin_user_id?: string;
  }): Promise<InsightReportResponse> => {
    const params = new URLSearchParams();
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    if (filters.start_time) params.append('start_time', filters.start_time);
    if (filters.end_time) params.append('end_time', filters.end_time);
    if (filters.category && filters.category !== 'all') params.append('category', filters.category);
    if (filters.line_oa_hook_id && filters.line_oa_hook_id !== 'all') params.append('line_oa_hook_id', filters.line_oa_hook_id);
    if (filters.admin_user_id && filters.admin_user_id !== 'all') params.append('admin_user_id', filters.admin_user_id);

    const response = await authFetch(`${API_BASE_URL}/api/insight-reports/tickets?${params.toString()}`, {
      method: 'GET',
    });

    return handleApiResponse<InsightReportResponse>(response, 'fetch ticket insights');
  },

  // [FEAT-20260820-REGINSIGHT] same param conventions as getTicketInsights:
  // skip falsy / 'all' values so the BE sees only real filters.
  getRegistrationInsights: async (filters: {
    from?: string;
    to?: string;
    line_oa_hook_id?: string | null;
  }): Promise<RegistrationInsightsResponse> => {
    const params = new URLSearchParams();
    if (filters.from) params.append('from', filters.from);
    if (filters.to) params.append('to', filters.to);
    if (filters.line_oa_hook_id && filters.line_oa_hook_id !== 'all') {
      params.append('line_oa_hook_id', filters.line_oa_hook_id);
    }

    const response = await authFetch(
      `${API_BASE_URL}/api/insight-reports/registrations?${params.toString()}`,
      { method: 'GET' },
    );

    return handleApiResponse<RegistrationInsightsResponse>(
      response,
      'fetch registration insights',
    );
  }
};
