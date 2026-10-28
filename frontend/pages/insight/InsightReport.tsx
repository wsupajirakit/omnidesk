import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { 
  Search, 
  RefreshCw, 
  Calendar, 
  Clock, 
  ArrowUpDown, 
  ChevronLeft, 
  ChevronRight, 
  TrendingUp, 
  BarChart2, 
  Users, 
  Hourglass, 
  Activity,
  CheckCircle,
  XCircle,
  Inbox,
  HelpCircle,
  X,
  Download,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip as RechartsTooltip, 
  Cell, 
  PieChart, 
  Pie, 
  Legend as RechartsLegend,
  CartesianGrid
} from 'recharts';
import { insightReportService, InsightReportResponse, InsightSummary, DailySummary } from '../../services/insight';
import { webhookService } from '../../services/hook';
import { userService } from '../../services/admin';
import { configService } from '../../services/admin';
import { HookData } from '../../types';
import { AlertModal } from '../../components/modals';
import { useI18n } from '../../i18n';
import { SkeletonBlock } from '../../components/common';
// [UI-20260814-INSIGHTHOOKTABS] OA tab strip + its default-pick rule
import { HookTabsOverflow, pickDefaultHookId } from './HookTabsOverflow';
import { RegisterDataCard } from './RegisterDataCard';
import { categoryOptionsFor, useProviderTicketCategories } from '../../components/ticket-category';

// Category filter choices. The customer provider's set when it declares one
// ([FEAT-20261014-TICKETCATS], loan_v1); otherwise driven by the acme_category flag:
//   absent/false -> narrowed 2-category set
//   true -> legacy 4-category set (acme deployments)
const CATEGORIES_NARROW = [
  { value: 'Payment', labelTH: 'แจ้งฝาก', labelEN: 'Deposit Notice' },
  { value: 'Other', labelTH: 'อื่นๆ', labelEN: 'Other' }
];
const CATEGORIES_LEGACY = [
  { value: 'Payment', labelTH: 'ชำระค่างวด', labelEN: 'Payment' },
  { value: 'Collection', labelTH: 'ทวงถาม', labelEN: 'Collection' },
  { value: 'Loan', labelTH: 'สินเชื่อ', labelEN: 'Loan' },
  { value: 'Other', labelTH: 'อื่นๆ', labelEN: 'Other' }
];
const CATEGORIES = CATEGORIES_NARROW;

// Labels for categories that existing tickets may still carry. Charts and
// tables read from here so historical data keeps a readable name instead of
// falling back to a raw English value once it left the filter list.
const CATEGORY_LABELS = [
  ...CATEGORIES,
  { value: 'Collection', labelTH: 'ทวงถาม', labelEN: 'Collection' },
  { value: 'IT', labelTH: 'ไอที', labelEN: 'IT' },
  { value: 'Loan', labelTH: 'สินเชื่อ', labelEN: 'Loan' }
];

const formatDateTime = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
};

export const InsightReport: React.FC = () => {
  const { t, locale } = useI18n();
  const isThai = locale === 'th';

  const [loading, setLoading] = useState<boolean>(true);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [insights, setInsights] = useState<InsightReportResponse['data'] | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date>(() => new Date());
  
  // Filter Dropdown Lists
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [agents, setAgents] = useState<{ user_id: string; username: string; display_name: string }[]>([]);

  // acme_category: true = legacy 4-category filter set, else narrowed 2.
  const [acmeCategory, setAcmeCategory] = useState(false);
  /* [FEAT-20261014-TICKETCATS] provider set when declared (loan_v1); null = as before (shop-api). */
  const providerCats = useProviderTicketCategories();
  const categoryChoices = providerCats ? categoryOptionsFor(providerCats) : (acmeCategory ? CATEGORIES_LEGACY : CATEGORIES_NARROW);
  // the chart, the table and the export name categories exactly as the filter does on a provider site
  const categoryLabels = providerCats ? categoryOptionsFor(providerCats) : CATEGORY_LABELS;
  useEffect(() => {
    configService.listConfigs({ limit: 200 }).then(res => {
      const row = (res.data || []).find((c: any) => c.key === 'acme_category');
      const v = row?.value;
      setAcmeCategory(v === true || v === 1 || v === 'true');
    }).catch(() => { /* absent = narrowed default */ });
  }, []);

  // Filter Values
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  /* [UI-20260814-INSIGHTHOOKTABS] `null` = no hook could be picked (zero active
     hooks). Was `''`, which used to mean "All channels" — that tab is gone, so
     the type now says outright that there is nothing selected. Every read site
     uses `lineOaHookId || undefined`, so null behaves like the old '' did. */
  const [lineOaHookId, setLineOaHookId] = useState<string | null>(null);
  const [adminUserId, setAdminUserId] = useState<string>('');

  // Error Alert Modal
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error';
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });

  // Calculation Documentation Modal state
  const [showDocModal, setShowDocModal] = useState<boolean>(false);
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>({});
  const toggleRow = (key: string) => setCollapsedRows(prev => ({ ...prev, [key]: !prev[key] }));
  // [FEAT-20260820-REGINSIGHT] aiBarHover/aiBarLayout removed with the old
  // "AI Category Breakdown" card — RegisterDataCard owns its own state.

  // Leaderboard states
  const [leaderboardSearch, setLeaderboardSearch] = useState<string>('');
  const [leaderboardPage, setLeaderboardPage] = useState<number>(1);
  const [leaderboardLimit, setLeaderboardLimit] = useState<number>(10);
  const [sortKey, setSortKey] = useState<string>('accepted_count');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const showAlert = (title: string, message: string, type: 'success' | 'error') => {
    setAlertState({ isOpen: true, title, message, type });
  };

  // 1. Fetch Dropdown Lists on Mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [hooksData, agentsData] = await Promise.all([
          webhookService.getAllHooks(),
          userService.listUsersForAssign()
        ]);
        const hooksList = (hooksData || []).filter((h: any) => h.status === 1);
        setHooks(hooksList);
        setAgents(agentsData.data || []);
        /* [UI-20260814-INSIGHTHOOKTABS] default = FIRST HOOK ALPHABETICALLY.
           Was: most-recently-updated (`updated_at` desc), which made the landing
           OA change on its own whenever anyone edited a hook. Owner asked for
           alphabetical so the page opens on the same OA every time.
           No hooks → `null`, and the request simply omits line_oa_hook_id
           (`|| undefined`) exactly as the old empty-string path did — the page
           still loads instead of erroring. */
        const defaultHookId = pickDefaultHookId(hooksList);
        setLineOaHookId(defaultHookId);
        fetchInsights({ line_oa_hook_id: defaultHookId || undefined });
      } catch (err: any) {
        console.error('Failed to load filter metadata:', err);
      }
    };
    fetchMetadata();
  }, []);

  // 2. Fetch Insights Data
  const fetchInsights = useCallback(async (customFilters?: {
    from?: string;
    to?: string;
    start_time?: string;
    end_time?: string;
    category?: string;
    line_oa_hook_id?: string;
    admin_user_id?: string;
  }) => {
    setLoading(true);
    try {
      const activeFilters = customFilters || {
        from: from || undefined,
        to: to || undefined,
        start_time: startTime || undefined,
        end_time: endTime || undefined,
        category: category || undefined,
        line_oa_hook_id: lineOaHookId || undefined,
        admin_user_id: adminUserId || undefined
      };
      
      const res = await insightReportService.getTicketInsights(activeFilters);
      if (res.success && res.data) {
        setInsights(res.data);
        setLastFetchedAt(new Date());
      } else {
        throw new Error('Response unsuccessful');
      }
    } catch (err: any) {
      console.error(err);
      showAlert(
        t('assign_history.error_title') || 'Load Failed',
        err.message || 'Failed to load ticket insights.',
        'error'
      );
    } finally {
      setLoading(false);
    }
  }, [from, to, startTime, endTime, category, lineOaHookId, adminUserId, t]);

  // Initial fetch handled inside fetchMetadata after default hook is set

  // 3. Search and Reset actions
  const handleFilter = () => {
    if (from && to && from > to) {
      showAlert(
        isThai ? 'ตัวกรองไม่ถูกต้อง' : 'Invalid Filters',
        isThai ? 'วันเริ่มต้นห้ามมากกว่าวันสิ้นสุด' : 'Start date cannot be after end date',
        'error'
      );
      return;
    }
    setHasSearched(true);
    fetchInsights();
  };

  const handleReset = () => {
    // [FIX-20260820-INSIGHTRESET] '' was the dead "All channels" sentinel the
    // tab rework removed — after a Reset it left every tab unselected and the
    // refetch unscoped. Reset now lands on the same default tab first load
    // picks, and the refetch stays scoped to it.
    const defaultHookId = pickDefaultHookId(hooks);
    setFrom('');
    setTo('');
    setStartTime('');
    setEndTime('');
    setCategory('');
    setLineOaHookId(defaultHookId);
    setAdminUserId('');
    fetchInsights({
      from: undefined,
      to: undefined,
      start_time: undefined,
      end_time: undefined,
      category: undefined,
      line_oa_hook_id: defaultHookId ?? undefined,
      admin_user_id: undefined
    });
  };

  const handleExportExcel = () => {
    // 1. Get descriptive labels for filters
    const selectedCatObj = categoryLabels.find(c => c.value === category);
    const categoryLabel = selectedCatObj 
      ? (isThai ? selectedCatObj.labelTH : selectedCatObj.labelEN) 
      : (isThai ? 'ทุกหมวดหมู่' : 'All Categories');

    const selectedHookObj = hooks.find(h => h._id === lineOaHookId);
    const lineOaLabel = selectedHookObj 
      ? `${selectedHookObj.line_oa_name} ${selectedHookObj.company_name ? `(${selectedHookObj.company_name})` : ''}` 
      : (isThai ? 'ทุกช่องทาง' : 'All Channels');

    const selectedAgentObj = agents.find(a => a.user_id === adminUserId);
    const adminLabel = selectedAgentObj 
      ? (selectedAgentObj.display_name || selectedAgentObj.username) 
      : (isThai ? 'แอดมินทุกคน' : 'All Admins');

    const filterFromLabel = from || (isThai ? 'ไม่ได้ระบุ' : 'Not Specified');
    const filterStartTimeLabel = startTime || (isThai ? 'ไม่ได้ระบุ' : 'Not Specified');
    const filterToLabel = to || (isThai ? 'ไม่ได้ระบุ' : 'Not Specified');
    const filterEndTimeLabel = endTime || (isThai ? 'ไม่ได้ระบุ' : 'Not Specified');

    // 2. Prepare daily summary data
    const ds = insights?.daily_summary;
    const fmtDateExcel = (iso: string) => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
    const dsDateLabel = ds?.date ? fmtDateExcel(ds.date) : new Date().toLocaleDateString('th-TH');
    const dsTotalPie = (ds?.admin_handled.count ?? 0) + (ds?.ai_handled.count ?? 0);
    const dsAdminPct = dsTotalPie > 0 ? Math.round((ds?.admin_handled.count ?? 0) / dsTotalPie * 100) : 0;
    const dsAiPct = dsTotalPie > 0 ? Math.round((ds?.ai_handled.count ?? 0) / dsTotalPie * 100) : 0;

    // 4. Construct the HTML content for Excel (with spreadsheet MIME compatibility)
    let htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; }
  table { border-collapse: collapse; margin-bottom: 24px; width: 100%; max-width: 900px; }
  th { background-color: #0f172a; color: #ffffff; font-weight: bold; border: 1px solid #334155; padding: 10px; font-size: 13px; text-align: left; }
  td { border: 1px solid #e2e8f0; padding: 10px; color: #334155; font-size: 13px; }
  .title-cell { font-size: 18px; font-weight: bold; color: #0f172a; border: none; padding-bottom: 4px; }
  .subtitle-cell { font-size: 12px; color: #64748b; border: none; padding-bottom: 20px; }
  .section-title { font-size: 14px; font-weight: bold; color: #0284c7; background-color: #f0f9ff; padding: 10px; border: 1px solid #bae6fd; border-bottom: 2px solid #0284c7; }
  .section-title-green { font-size: 14px; font-weight: bold; color: #059669; background-color: #f0fdf4; padding: 10px; border: 1px solid #bbf7d0; border-bottom: 2px solid #059669; }
  .filter-label { font-weight: bold; background-color: #f8fafc; width: 180px; color: #475569; }
  .preset-row-header { font-weight: bold; background-color: #f8fafc; color: #1e293b; }
  .numeric { text-align: right; }
  .text-center { text-align: center; }
</style>
</head>
<body>
  <table>
    <tr>
      <td colspan="5" class="title-cell">${t('insight.title') || 'Ticket Insight Dashboard'}</td>
    </tr>
    <tr>
      <td colspan="5" class="subtitle-cell">${isThai ? 'ข้อมูลสรุปและการประเมินผลประสิทธิภาพ ณ วันที่' : 'Generated at'}: ${new Date().toLocaleString(isThai ? 'th-TH' : 'en-US')}</td>
    </tr>
  </table>

  <!-- สัดส่วนการตอบวันนี้ -->
  <table>
    <tr>
      <th colspan="3" class="section-title-green">${isThai ? 'สัดส่วนการตอบวันนี้' : 'Response Proportion Today'} (${dsDateLabel})</th>
    </tr>
    <tr>
      <th>${isThai ? 'ประเภท' : 'Type'}</th>
      <th class="numeric">${isThai ? 'จำนวน (คน)' : 'Count'}</th>
      <th class="numeric">${isThai ? 'สัดส่วน (%)' : 'Percentage (%)'}</th>
    </tr>
    <tr>
      <td>${isThai ? 'แอดมินตอบ' : 'Admin Handled'}</td>
      <td class="numeric">${(ds?.admin_handled.count ?? 0).toLocaleString()}</td>
      <td class="numeric">${dsAdminPct}%</td>
    </tr>
    <tr>
      <td>${isThai ? 'AI ตอบ' : 'AI Handled'}</td>
      <td class="numeric">${(ds?.ai_handled.count ?? 0).toLocaleString()}</td>
      <td class="numeric">${dsAiPct}%</td>
    </tr>
    <tr>
      <td style="font-weight:bold;">${isThai ? 'รวมทั้งหมด' : 'Total'}</td>
      <td class="numeric" style="font-weight:bold;">${dsTotalPie.toLocaleString()}</td>
      <td class="numeric" style="font-weight:bold;">100%</td>
    </tr>
  </table>

  <!-- หมวดหมู่ถามตอบของ AI วันนี้ -->
  <table>
    <tr>
      <th colspan="3" class="section-title-green">${isThai ? 'หมวดหมู่ถามตอบของ AI วันนี้' : 'AI Category Breakdown Today'} (${dsDateLabel})</th>
    </tr>
    <tr>
      <th>${isThai ? 'หมวดหมู่' : 'Category'}</th>
      <th class="numeric">${isThai ? 'จำนวน (คน)' : 'Count'}</th>
      <th class="numeric">${isThai ? 'สัดส่วน (%)' : 'Percentage (%)'}</th>
    </tr>
    ${!ds || ds.ai_handled.by_category.length === 0 ? `
      <tr><td colspan="3" class="text-center" style="color:#94a3b8;">${isThai ? 'ไม่มีข้อมูล' : 'No data'}</td></tr>
    ` : [...ds.ai_handled.by_category].sort((a,b) => b.count - a.count).map(item => {
      const aiTotal = ds.ai_handled.count || 1;
      const pct = ((item.count / aiTotal) * 100).toFixed(1);
      return `<tr><td>${item.category}</td><td class="numeric">${item.count.toLocaleString()}</td><td class="numeric">${pct}%</td></tr>`;
    }).join('')}
  </table>

  <!-- Filter Criteria Section -->
  <table>
    <tr>
      <th colspan="2" class="section-title">${isThai ? 'ตัวเลือกการกรองข้อมูล (Selected Filters)' : 'Selected Filters'}</th>
    </tr>
    <tr>
      <td class="filter-label">${t('insight.filter_start_date_time') || 'Start Date & Time'}</td>
      <td>${filterFromLabel} ${startTime ? `(${filterStartTimeLabel})` : ''}</td>
    </tr>
    <tr>
      <td class="filter-label">${t('insight.filter_end_date_time') || 'End Date & Time'}</td>
      <td>${filterToLabel} ${endTime ? `(${filterEndTimeLabel})` : ''}</td>
    </tr>
    <tr>
      <td class="filter-label">${t('insight.filter_category') || 'Category'}</td>
      <td>${categoryLabel}</td>
    </tr>
    <tr>
      <td class="filter-label">${t('insight.filter_channel') || 'Channel'}</td>
      <td>${lineOaLabel}</td>
    </tr>
    <tr>
      <td class="filter-label">${t('insight.filter_admin') || 'Admin Agent'}</td>
      <td>${adminLabel}</td>
    </tr>
  </table>

  <!-- Metrics Comparison Matrix Grid -->
  <table>
    <tr>
      <th colspan="5" class="section-title">${isThai ? 'ตารางสรุปตัวเลขภาพรวม (Metrics Summary Matrix)' : 'Metrics Summary Matrix'}</th>
    </tr>
    <tr>
      <th>${isThai ? 'ช่วงเวลา / ตัวกรอง' : 'Period / Filter'}</th>
      <th class="numeric">${t('insight.metric_total_tickets') || 'Total Tickets'}</th>
      <th class="numeric">${t('insight.metric_first_response') || 'Avg First Response'}</th>
      <th class="numeric">${t('insight.metric_handling_time') || 'Avg Handling'}</th>
      <th class="numeric">${t('insight.metric_resolution_time') || 'Avg Resolution'}</th>
    </tr>
    <tr>
      <td class="preset-row-header">${t('insight.preset_custom_filter') || 'Custom Filter'}${customFilterRangeText ? ` (${customFilterRangeText})` : ''}</td>
      <td class="numeric">${customMetrics.total_tickets.toLocaleString()}</td>
      <td class="numeric">${formatDuration(customMetrics.avg_first_response_seconds)}</td>
      <td class="numeric">${formatDuration(customMetrics.avg_handling_seconds)}</td>
      <td class="numeric">${formatDuration(customMetrics.avg_total_resolution_seconds)}</td>
    </tr>
    <tr>
      <td class="preset-row-header">${t('insight.preset_today') || 'Today'} (${todayRangeText})</td>
      <td class="numeric">${todayMetrics.total_tickets.toLocaleString()}</td>
      <td class="numeric">${formatDuration(todayMetrics.avg_first_response_seconds)}</td>
      <td class="numeric">${formatDuration(todayMetrics.avg_handling_seconds)}</td>
      <td class="numeric">${formatDuration(todayMetrics.avg_total_resolution_seconds)}</td>
    </tr>
    <tr>
      <td class="preset-row-header">${t('insight.preset_this_week') || 'This Week'} (${weekRangeText})</td>
      <td class="numeric">${weekMetrics.total_tickets.toLocaleString()}</td>
      <td class="numeric">${formatDuration(weekMetrics.avg_first_response_seconds)}</td>
      <td class="numeric">${formatDuration(weekMetrics.avg_handling_seconds)}</td>
      <td class="numeric">${formatDuration(weekMetrics.avg_total_resolution_seconds)}</td>
    </tr>
    <tr>
      <td class="preset-row-header">${t('insight.preset_this_month') || 'This Month'} (${monthRangeText})</td>
      <td class="numeric">${monthMetrics.total_tickets.toLocaleString()}</td>
      <td class="numeric">${formatDuration(monthMetrics.avg_first_response_seconds)}</td>
      <td class="numeric">${formatDuration(monthMetrics.avg_handling_seconds)}</td>
      <td class="numeric">${formatDuration(monthMetrics.avg_total_resolution_seconds)}</td>
    </tr>
  </table>

  <!-- Leaderboard -->
  <table>
    <tr>
      <th colspan="8" class="section-title">${t('insight.leaderboard_title') || 'Agent Performance Leaderboard'}</th>
    </tr>
    <tr>
      <th class="text-center">${t('insight.leaderboard_rank') || 'Rank'}</th>
      <th>${t('insight.leaderboard_name') || 'Agent Name'}</th>
      <th class="numeric">${t('insight.leaderboard_assigned') || 'Assigned'}</th>
      <th class="numeric">${t('insight.leaderboard_accepted') || 'Accepted'}</th>
      <th class="numeric">${t('insight.leaderboard_closed') || 'Closed'}</th>
      <th class="numeric">${t('insight.leaderboard_transferred') || 'Transferred'}</th>
      <th class="numeric">${t('insight.leaderboard_auto_unassisted') || 'Auto Unassisted'}</th>
      <th class="numeric">${t('insight.leaderboard_handling') || 'Avg Handling'}</th>
    </tr>
    ${processedLeaderboard.length === 0 ? `
      <tr><td colspan="8" class="text-center" style="color: #94a3b8;">${t('insight.no_data') || 'No data'}</td></tr>
    ` : processedLeaderboard.map((item, idx) => `
      <tr>
        <td class="text-center">#${idx + 1}</td>
        <td>${item.display_name}</td>
        <td class="numeric">${item.assigned_count.toLocaleString()}</td>
        <td class="numeric">${item.accepted_count.toLocaleString()}</td>
        <td class="numeric">${item.closed_count.toLocaleString()}</td>
        <td class="numeric">${item.transfer_count.toLocaleString()}</td>
        <td class="numeric">${item.auto_unassist_count.toLocaleString()}</td>
        <td class="numeric">${formatDuration(item.avg_handling_seconds)}</td>
      </tr>
    `).join('')}
  </table>
</body>
</html>
    `;

    // 4. Download Trigger
    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `ticket_insights_${dateStr}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Seconds formatter helper
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);

    if (h > 0) {
      return `${h}h ${m}m`;
    }
    if (m > 0) {
      return `${m}m ${s}s`;
    }
    return `${s}s`;
  };

  // Preset Summary Metrics
  const customMetrics = useMemo<InsightSummary>(() => {
    const defaultVal = {
      total_tickets: 0,
      avg_first_response_seconds: 0,
      avg_handling_seconds: 0,
      avg_total_resolution_seconds: 0
    };
    if (!hasSearched || !insights || !insights.presets) return defaultVal;
    return insights.presets.custom_filter || defaultVal;
  }, [insights, hasSearched]);

  const todayMetrics = useMemo<InsightSummary>(() => {
    const defaultVal = {
      total_tickets: 0,
      avg_first_response_seconds: 0,
      avg_handling_seconds: 0,
      avg_total_resolution_seconds: 0
    };
    if (!insights || !insights.presets) return defaultVal;
    return insights.presets.today || defaultVal;
  }, [insights]);

  const weekMetrics = useMemo<InsightSummary>(() => {
    const defaultVal = {
      total_tickets: 0,
      avg_first_response_seconds: 0,
      avg_handling_seconds: 0,
      avg_total_resolution_seconds: 0
    };
    if (!insights || !insights.presets) return defaultVal;
    return insights.presets.this_week || defaultVal;
  }, [insights]);

  const monthMetrics = useMemo<InsightSummary>(() => {
    const defaultVal = {
      total_tickets: 0,
      avg_first_response_seconds: 0,
      avg_handling_seconds: 0,
      avg_total_resolution_seconds: 0
    };
    if (!insights || !insights.presets) return defaultVal;
    return insights.presets.this_month || defaultVal;
  }, [insights]);

  // Date ranges formatting
  const todayRangeText = useMemo(() => {
    const start = new Date(lastFetchedAt);
    start.setHours(0, 0, 0, 0);
    const end = new Date(lastFetchedAt);
    end.setHours(23, 59, 59, 0);
    return `${formatDateTime(start)} to ${formatDateTime(end)}`;
  }, [lastFetchedAt]);

  const weekRangeText = useMemo(() => {
    const start = new Date(lastFetchedAt);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 0);

    return `${formatDateTime(start)} to ${formatDateTime(end)}`;
  }, [lastFetchedAt]);

  const monthRangeText = useMemo(() => {
    const start = new Date(lastFetchedAt);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setMonth(start.getMonth() + 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 0);

    return `${formatDateTime(start)} to ${formatDateTime(end)}`;
  }, [lastFetchedAt]);

  const customFilterRangeText = useMemo(() => {
    if (!from && !to && !startTime && !endTime) return null;

    let startStr = '';
    if (from) {
      const [year, month, day] = from.split('-').map(Number);
      const startD = new Date(year, month - 1, day);
      if (startTime) {
        const [h, m] = startTime.split(':').map(Number);
        startD.setHours(h, m, 0, 0);
      } else {
        startD.setHours(0, 0, 0, 0);
      }
      startStr = formatDateTime(startD);
    } else {
      startStr = 'Any time';
    }

    let endStr = '';
    if (to) {
      const [year, month, day] = to.split('-').map(Number);
      const endD = new Date(year, month - 1, day);
      if (endTime) {
        const [h, m] = endTime.split(':').map(Number);
        endD.setHours(h, m, 59, 0);
      } else {
        endD.setHours(23, 59, 59, 0);
      }
      endStr = formatDateTime(endD);
    } else {
      endStr = formatDateTime(lastFetchedAt);
    }

    return `${startStr} to ${endStr}`;
  }, [from, to, startTime, endTime, lastFetchedAt]);

  // Recharts Chart Data processing
  const categoryChartData = useMemo(() => {
    if (!insights?.category_distribution) return [];
    return insights.category_distribution.map(item => {
      const catConfig = categoryLabels.find(c => c.value === item.category);
      const name = catConfig ? (isThai ? catConfig.labelTH : catConfig.labelEN) : item.category;
      return {
        name,
        count: item.count
      };
    });
  }, [insights, isThai, providerCats]);

  const oaChartData = useMemo(() => {
    if (!insights?.oa_distribution) return [];
    return insights.oa_distribution.map(item => ({
      name: item.line_oa_name || (isThai ? 'ไม่ระบุ' : 'Unknown'),
      value: item.count
    }));
  }, [insights, isThai]);

  // Colors for Recharts cells
  const chartColors = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16','#a855f7','#22d3ee','#fb923c','#4ade80','#e879f9','#38bdf8','#fbbf24','#34d399','#f472b6'];

  // Leaderboard local search/sort/pagination logic
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
    setLeaderboardPage(1);
  };

  const processedLeaderboard = useMemo(() => {
    if (!insights?.agent_leaderboard) return [];

    let list = [...insights.agent_leaderboard];

    // Apply search filter
    if (leaderboardSearch) {
      const q = leaderboardSearch.toLowerCase();
      list = list.filter(item => 
        (item.display_name || '').toLowerCase().includes(q)
      );
    }

    // Apply sorting
    list.sort((a: any, b: any) => {
      const valA = a[sortKey] ?? 0;
      const valB = b[sortKey] ?? 0;

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [insights, leaderboardSearch, sortKey, sortDirection]);

  // Paginated chunk
  const paginatedLeaderboard = useMemo(() => {
    const startIndex = (leaderboardPage - 1) * leaderboardLimit;
    return processedLeaderboard.slice(startIndex, startIndex + leaderboardLimit);
  }, [processedLeaderboard, leaderboardPage, leaderboardLimit]);

  const totalLeaderboardPages = Math.ceil(processedLeaderboard.length / leaderboardLimit) || 1;

  // Custom tooltips for Recharts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-dark-800 border border-dark-700 p-3 rounded-lg shadow-xl text-xs">
          <p className="font-semibold text-slate-900 mb-1">{label}</p>
          <p className="text-primary-500 font-medium">
            {isThai ? 'จำนวนงาน' : 'Tickets'}: {payload[0].value}
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-dark-800 border border-dark-700 p-3 rounded-lg shadow-xl text-xs">
          <p className="font-semibold text-slate-900 mb-1">{payload[0].name}</p>
          <p className="text-primary-500 font-medium">
            {isThai ? 'งานทั้งหมด' : 'Total Tickets'}: {payload[0].value}
          </p>
        </div>
      );
    }
    return null;
  };

  // Progressive loading: cards keep their frame and only the number shimmers
  // while a refetch is in flight, so switching tabs/filters never blanks the page.
  const Metric = ({ pending, children }: { pending: boolean; children: React.ReactNode }) =>
    pending ? <SkeletonBlock className="h-7 w-20 mt-1" /> : <>{children}</>;

  return (
    <div className="flex flex-col gap-6">
      {/* 0. Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('insight.title') || 'Ticket Insight Dashboard'}</h2>
          <p className="text-sm text-slate-500">{t('insight.subtitle') || 'Statistics and performance metrics dashboard for support tickets'}</p>
        </div>
        {loading && <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />}
      </div>

      {/* OA Tabs — [UI-20260814-INSIGHTHOOKTABS]
          Owner, 14/08: tabs past 75% of the strip width collapse into a searchable
          select · the "All" tab is removed · default = first hook alphabetically.

          ⚠️ The click handler is byte-for-byte the old one apart from the hook id,
             so every other active filter (date range, time, category, admin) is
             still carried into the refetch. Dropping any of them here would reset
             the user's filters on a tab switch — silently, and only sometimes.
          revert: see the header of HookTabsOverflow.tsx */}
      <HookTabsOverflow
        hooks={hooks}
        value={lineOaHookId}
        searchPlaceholder={isThai ? 'ค้นหา OA...' : 'Search OA...'}
        onChange={(hookId) => {
          setLineOaHookId(hookId);
          fetchInsights({ from: from || undefined, to: to || undefined, start_time: startTime || undefined, end_time: endTime || undefined, category: category || undefined, line_oa_hook_id: hookId, admin_user_id: adminUserId || undefined });
        }}
      />

      {/* Daily Summary Section */}
      {(() => {
        const ds: DailySummary = insights?.daily_summary ?? {
          date: new Date().toISOString().slice(0, 10),
          total_messaged: 0,
          ai_handled: { count: 0, by_category: [] },
          ai_with_assist: { count: 0 },
          admin_handled: { count: 0, by_category: [] },
        };
        const aiSlices = ds.ai_handled.by_category.length > 0
          ? ds.ai_handled.by_category.map((item) => ({ name: `AI: ${item.category}`, value: item.count, color: '#10b981' }))
          : [{ name: t('insight.daily_ai_label'), value: ds.ai_handled.count, color: '#10b981' }];
        const pieData = [
          { name: t('insight.daily_admin_label'), value: ds.admin_handled.count, color: '#6366f1' },
          ...aiSlices,
        ];
        const totalPie = pieData.reduce((s, d) => s + d.value, 0);
        // center AI portion at right (0°): startAngle = 180 + (admin/total)*180
        const adminStartAngle = totalPie > 0 ? 180 + (ds.admin_handled.count / totalPie) * 180 : 90;
        const fmtDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
        const dateLabel = customFilterRangeText || fmtDate(ds.date);
        const totalAdminAi = ds.admin_handled.count + ds.ai_handled.count;
        const maxLabelLen = ds.ai_handled.by_category.reduce((max, d) => Math.max(max, d.category.length), 0);
        const yAxisW = Math.min(160, Math.max(80, maxLabelLen * 8));
        const rightMarginBar = Math.max(36, String(ds.ai_handled.by_category[0]?.count ?? 0).length * 8 + 8);
        const pieBasis = yAxisW > 100 ? '40%' : '50%';
        return (
          <div className="flex flex-col gap-4">
            {/* Row 1: Pie + Bar */}
            <div className="flex flex-col xl:flex-row gap-4">
              {/* Left: Pie chart */}
              <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-2xl p-5 shadow-md flex flex-col gap-3 flex-shrink-0" style={{ flexBasis: pieBasis }}>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-shrink-0">
                  <Users size={16} className="text-primary-500" />
                  {t('insight.daily_pie_title')}{` (${dateLabel})`}
                </h3>
                <div className="overflow-y-auto max-h-[420px]">
                <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
                  <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                    <div className="w-full h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%" cy="50%"
                            innerRadius="42%"
                            outerRadius="72%"
                            startAngle={adminStartAngle}
                            endAngle={adminStartAngle - 360}
                            paddingAngle={1.5}
                            dataKey="value"
                            strokeWidth={0}
                            label={({ cx, cy, midAngle, innerRadius, outerRadius: or, percent, value }: any) => {
                              if (percent < 0.08) return null;
                              const RADIAN = Math.PI / 180;
                              const r = innerRadius + (or - innerRadius) * 0.52;
                              const x = cx + r * Math.cos(-midAngle * RADIAN);
                              const y = cy + r * Math.sin(-midAngle * RADIAN);
                              return <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="700" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>{value}</text>;
                            }}
                            labelLine={false}
                          >
                            {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
                          </Pie>
                          <RechartsTooltip content={({ active, payload }) => active && payload?.length ? (
                            <div className="bg-white border border-slate-200 shadow-xl p-2.5 rounded-xl text-xs">
                              <p className="font-bold text-slate-800 mb-1">{payload[0].name}</p>
                              <p className="text-emerald-600 font-semibold">{payload[0].value} {t('pageui.insight.people_unit', 'คน')} ({totalPie > 0 ? Math.round((payload[0].value as number) / totalPie * 100) : 0}%)</p>
                            </div>
                          ) : null} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* % labels below pie */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#6366f1' }} />
                        <span className="text-xs font-bold" style={{ color: '#6366f1' }}>
                          {t('pageui.insight.admin_short', 'แอดมิน')} {totalPie > 0 ? Math.round(ds.admin_handled.count / totalPie * 100) : 0}%
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#10b981' }} />
                        <span className="text-xs font-bold" style={{ color: '#10b981' }}>
                          AI {totalPie > 0 ? Math.round(ds.ai_handled.count / totalPie * 100) : 0}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5 sm:w-[150px] flex-shrink-0 min-w-0">
                    <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: '#6366f1' }} />
                      <span className="text-xs text-indigo-700 flex-1 font-medium">{t('insight.daily_admin_label')}</span>
                      <span className="text-sm font-extrabold text-indigo-700 flex-shrink-0">{ds.admin_handled.count}</span>
                    </div>
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: '#10b981' }} />
                      <span className="text-xs text-emerald-700 flex-1 font-medium">{t('insight.daily_ai_label')}</span>
                      <span className="text-sm font-extrabold text-emerald-700 flex-shrink-0">{ds.ai_handled.count}</span>
                    </div>
                    <div className="border-t border-slate-100 my-0.5" />
                    <div className="flex items-center gap-2 px-3 py-1">
                      <span className="text-xs text-slate-400 flex-1">{t('insight.daily_total_messaged')}</span>
                      <span className="text-sm font-extrabold text-slate-700 flex-shrink-0">{totalAdminAi}</span>
                    </div>
                  </div>
                </div>
                </div>
              </div>

              {/* [FEAT-20260820-REGINSIGHT] Right: "Register data" card —
                  replaces the AI Category Breakdown chart (owner order 20/08).
                  Own file per anti-bloat §6.1; it scopes itself to the selected
                  OA tab and carries its own uncapped date-range filter. */}
              <RegisterDataCard hookId={lineOaHookId} />
            </div>

            {/* Row 2: 3 stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* total_messaged */}
              <div className="bg-dark-800 border border-sky-400/20 rounded-xl p-5 shadow-lg shadow-sky-400/5 hover:border-sky-400/40 transition-all relative overflow-hidden flex items-center justify-between group">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-sky-400 to-cyan-300 rounded-l-xl" />
                <div className="absolute inset-0 bg-gradient-to-br from-sky-400/5 to-transparent pointer-events-none" />
                <div className="relative z-10 pl-2">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">{t('insight.daily_messaged_today')}</p>
                  <h4 className="text-2xl font-extrabold text-sky-400"><Metric pending={loading}>{totalAdminAi.toLocaleString()}</Metric></h4>
                </div>
                <div className="relative z-10 p-2.5 rounded-lg bg-sky-400/10 text-sky-400 border border-sky-400/20 group-hover:scale-110 transition-transform duration-300">
                  <Inbox size={22} />
                </div>
              </div>

              {/* ai ticket */}
              <div className="bg-dark-800 border border-violet-500/20 rounded-xl p-5 shadow-lg shadow-violet-500/5 hover:border-violet-500/40 transition-all relative overflow-hidden flex items-center justify-between group">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-violet-500 to-purple-400 rounded-l-xl" />
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
                <div className="relative z-10 pl-2">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">{t('insight.daily_ticket_count')}</p>
                  <h4 className="text-2xl font-extrabold text-violet-500">
                    <Metric pending={loading}>{ds.admin_handled.count.toLocaleString()}</Metric>
                  </h4>
                </div>
                <div className="relative z-10 p-2.5 rounded-lg bg-violet-500/10 text-violet-500 border border-violet-500/20 group-hover:scale-110 transition-transform duration-300">
                  <Activity size={22} />
                </div>
              </div>

              {/* admin_handled.by_category summary */}
              <div className="bg-dark-800 border border-emerald-500/20 rounded-xl p-5 shadow-lg shadow-emerald-500/5 hover:border-emerald-500/40 transition-all relative overflow-hidden group flex flex-col">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-400 rounded-l-xl" />
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
                <div className="relative z-10 pl-2 flex flex-col min-h-0 flex-1">
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2 flex-shrink-0">{t('insight.daily_category_today')}</p>
                  <div className="flex flex-col gap-1 overflow-y-auto max-h-[120px] pr-1">
                    {ds.admin_handled.by_category.length === 0 ? (
                      <span className="text-xs text-slate-400">{t('insight.no_data_short')}</span>
                    ) : ds.admin_handled.by_category.map((item, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-600 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: chartColors[i % chartColors.length] }} />
                          {categoryLabels.find(c => c.value === item.category)?.[isThai ? 'labelTH' : 'labelEN'] ?? item.category}
                        </span>
                        <span className="text-xs font-bold text-emerald-600 flex-shrink-0">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Filter Form Panel */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 p-6 shadow-xl flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h3 className="text-md font-semibold text-slate-900 flex items-center gap-2 cursor-pointer select-none flex-1" onClick={() => toggleRow('filter')}>
            <Calendar size={18} className="text-primary-500" />
            {t('insight.filters') || 'Filters'}
            <span className="text-slate-400">{collapsedRows['filter'] ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</span>
          </h3>
          <button
            onClick={handleExportExcel}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white shadow-lg shadow-emerald-600/10 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
          >
            <Download size={14} />
            {t('insight.btn_export') || 'Export Excel'}
          </button>
          <button
            onClick={handleFilter}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} size={14} />
            {t('common.refresh') || 'Refresh'}
          </button>
        </div>

        {!collapsedRows['filter'] && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Start Date & Time */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">
              {t('insight.filter_start_date_time') || 'Start Date & Time'}
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  const val = e.target.value;
                  setFrom(val);
                  if (to && val && val > to) {
                    setTo(val);
                  }
                }}
                onClick={(e) => {
                  try { e.currentTarget.showPicker(); } catch (err) {}
                }}
                className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                onClick={(e) => {
                  try { e.currentTarget.showPicker(); } catch (err) {}
                }}
                className="w-32 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
              />
            </div>
          </div>

          {/* End Date & Time */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">
              {t('insight.filter_end_date_time') || 'End Date & Time'}
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  const val = e.target.value;
                  setTo(val);
                  if (from && val && val < from) {
                    setFrom(val);
                  }
                }}
                onClick={(e) => {
                  try { e.currentTarget.showPicker(); } catch (err) {}
                }}
                className="flex-1 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                onClick={(e) => {
                  try { e.currentTarget.showPicker(); } catch (err) {}
                }}
                className="w-32 bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all cursor-pointer"
              />
            </div>
          </div>

          {/* Category Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">{t('insight.filter_category') || 'Ticket Category'}</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
            >
              <option value="">{t('insight.all_categories') || 'All Categories'}</option>
              {categoryChoices.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {isThai ? cat.labelTH : cat.labelEN}
                </option>
              ))}
            </select>
          </div>

          {/* Admin Agent Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-500">{t('insight.filter_admin') || 'Admin Agent'}</label>
            <select
              value={adminUserId}
              onChange={(e) => setAdminUserId(e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
            >
              <option value="">{t('insight.all_admins') || 'All Admins'}</option>
              {agents.map((agent) => (
                <option key={agent.user_id} value={agent.user_id}>
                  {agent.display_name || agent.username}
                </option>
              ))}
            </select>
          </div>

          {/* Filter Action Buttons */}
          <div className="flex items-end gap-2">
            <button
              onClick={handleFilter}
              className="flex-1 bg-primary-600 hover:bg-primary-500 text-white font-medium text-sm px-4 py-2 rounded-lg shadow-lg shadow-primary-500/20 hover:scale-[1.03] transition-all cursor-pointer h-[38px] flex items-center justify-center gap-1"
            >
              <Search size={16} />
              {t('insight.btn_filter') || 'Filter'}
            </button>
            <button
              onClick={handleReset}
              className="flex-1 bg-dark-700 hover:bg-dark-600 text-slate-900 font-medium text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer h-[38px] flex items-center justify-center gap-1"
            >
              {t('insight.btn_reset') || 'Reset'}
            </button>
          </div>
        </div>}
      </div>

      {/* 3. Preset Context KPI summary cards */}
      <div className="flex flex-col gap-6">
        {/* Row 1: Custom Filter */}
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap cursor-pointer select-none" onClick={() => toggleRow('custom')}>
            <div className="h-4 w-1 bg-primary-500 rounded-full" />
            <span className="text-sm font-bold text-slate-900">
              {t('insight.preset_custom_filter') || 'Custom Filter'}
            </span>
            {customFilterRangeText && (
              <span className="text-xs text-slate-500 font-normal ml-2">
                ({customFilterRangeText})
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowDocModal(true); }}
              className="bg-orange-500/10 text-orange-500 border border-orange-500/30 rounded-full h-7 w-7 flex items-center justify-center transition-all duration-300 hover:bg-orange-500/35 hover:text-orange-400 active:scale-90 animate-help-glow cursor-pointer ml-2"
              title={isThai ? 'คำอธิบายสูตรการคำนวณและข้อมูลระบบ' : 'Calculation formulas & system documentation'}
            >
              <HelpCircle size={15} />
            </button>
            <span className="ml-auto text-slate-400">{collapsedRows['custom'] ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</span>
          </div>
          {!collapsedRows['custom'] && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Total Tickets */}
            <div className="bg-dark-800 border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-blue-500/5 hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none group-hover:from-blue-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_total_tickets') || 'Total Tickets'}
                </p>
                <h4 className="text-2xl font-extrabold text-blue-500">
                  <Metric pending={loading}>{customMetrics.total_tickets.toLocaleString()}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                <Inbox size={22} />
              </div>
            </div>

            {/* Avg First Response */}
            <div className="bg-dark-800 border border-pink-500/20 rounded-xl p-5 shadow-lg shadow-pink-500/5 hover:border-pink-500/40 hover:shadow-pink-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-pink-500 to-rose-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent pointer-events-none group-hover:from-pink-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_first_response') || 'Avg First Response'}
                </p>
                <h4 className="text-2xl font-extrabold text-pink-500">
                  <Metric pending={loading}>{formatDuration(customMetrics.avg_first_response_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-pink-500/10 text-pink-500 border border-pink-500/20 group-hover:scale-110 transition-transform duration-300">
                <Activity size={22} />
              </div>
            </div>

            {/* Avg Handling */}
            <div className="bg-dark-800 border border-emerald-500/20 rounded-xl p-5 shadow-lg shadow-emerald-500/5 hover:border-emerald-500/40 hover:shadow-emerald-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none group-hover:from-emerald-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_handling_time') || 'Avg Handling Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-emerald-500">
                  <Metric pending={loading}>{formatDuration(customMetrics.avg_handling_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 group-hover:scale-110 transition-transform duration-300">
                <Hourglass size={22} />
              </div>
            </div>

            {/* Avg Resolution */}
            <div className="bg-dark-800 border border-amber-500/20 rounded-xl p-5 shadow-lg shadow-amber-500/5 hover:border-amber-500/40 hover:shadow-amber-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-500 to-orange-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none group-hover:from-amber-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_resolution_time') || 'Avg Resolution Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-amber-500">
                  <Metric pending={loading}>{formatDuration(customMetrics.avg_total_resolution_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                <TrendingUp size={22} />
              </div>
            </div>
          </div>}
        </div>

        {/* Row 2: Today */}
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap cursor-pointer select-none" onClick={() => toggleRow('today')}>
            <div className="h-4 w-1 bg-blue-500 rounded-full" />
            <span className="text-sm font-bold text-slate-900">
              {t('insight.preset_today') || 'Today'}
            </span>
            <span className="text-xs text-slate-500 font-normal ml-2">
              ({todayRangeText})
            </span>
            <span className="ml-auto text-slate-400">{collapsedRows['today'] ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</span>
          </div>
          {!collapsedRows['today'] && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Total Tickets */}
            <div className="bg-dark-800 border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-blue-500/5 hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none group-hover:from-blue-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_total_tickets') || 'Total Tickets'}
                </p>
                <h4 className="text-2xl font-extrabold text-blue-500">
                  <Metric pending={loading}>{todayMetrics.total_tickets.toLocaleString()}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                <Inbox size={22} />
              </div>
            </div>

            {/* Avg First Response */}
            <div className="bg-dark-800 border border-pink-500/20 rounded-xl p-5 shadow-lg shadow-pink-500/5 hover:border-pink-500/40 hover:shadow-pink-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-pink-500 to-rose-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent pointer-events-none group-hover:from-pink-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_first_response') || 'Avg First Response'}
                </p>
                <h4 className="text-2xl font-extrabold text-pink-500">
                  <Metric pending={loading}>{formatDuration(todayMetrics.avg_first_response_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-pink-500/10 text-pink-500 border border-pink-500/20 group-hover:scale-110 transition-transform duration-300">
                <Activity size={22} />
              </div>
            </div>

            {/* Avg Handling */}
            <div className="bg-dark-800 border border-emerald-500/20 rounded-xl p-5 shadow-lg shadow-emerald-500/5 hover:border-emerald-500/40 hover:shadow-emerald-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none group-hover:from-emerald-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_handling_time') || 'Avg Handling Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-emerald-500">
                  <Metric pending={loading}>{formatDuration(todayMetrics.avg_handling_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 group-hover:scale-110 transition-transform duration-300">
                <Hourglass size={22} />
              </div>
            </div>

            {/* Avg Resolution */}
            <div className="bg-dark-800 border border-amber-500/20 rounded-xl p-5 shadow-lg shadow-amber-500/5 hover:border-amber-500/40 hover:shadow-amber-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-500 to-orange-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none group-hover:from-amber-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_resolution_time') || 'Avg Resolution Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-amber-500">
                  <Metric pending={loading}>{formatDuration(todayMetrics.avg_total_resolution_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                <TrendingUp size={22} />
              </div>
            </div>
          </div>}
        </div>

        {/* Row 3: This Week */}
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap cursor-pointer select-none" onClick={() => toggleRow('week')}>
            <div className="h-4 w-1 bg-pink-500 rounded-full" />
            <span className="text-sm font-bold text-slate-900">
              {t('insight.preset_this_week') || 'This Week'}
            </span>
            <span className="text-xs text-slate-500 font-normal ml-2">
              ({weekRangeText})
            </span>
            <span className="ml-auto text-slate-400">{collapsedRows['week'] ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</span>
          </div>
          {!collapsedRows['week'] && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Total Tickets */}
            <div className="bg-dark-800 border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-blue-500/5 hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none group-hover:from-blue-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_total_tickets') || 'Total Tickets'}
                </p>
                <h4 className="text-2xl font-extrabold text-blue-500">
                  <Metric pending={loading}>{weekMetrics.total_tickets.toLocaleString()}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                <Inbox size={22} />
              </div>
            </div>

            {/* Avg First Response */}
            <div className="bg-dark-800 border border-pink-500/20 rounded-xl p-5 shadow-lg shadow-pink-500/5 hover:border-pink-500/40 hover:shadow-pink-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-pink-500 to-rose-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent pointer-events-none group-hover:from-pink-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_first_response') || 'Avg First Response'}
                </p>
                <h4 className="text-2xl font-extrabold text-pink-500">
                  <Metric pending={loading}>{formatDuration(weekMetrics.avg_first_response_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-pink-500/10 text-pink-500 border border-pink-500/20 group-hover:scale-110 transition-transform duration-300">
                <Activity size={22} />
              </div>
            </div>

            {/* Avg Handling */}
            <div className="bg-dark-800 border border-emerald-500/20 rounded-xl p-5 shadow-lg shadow-emerald-500/5 hover:border-emerald-500/40 hover:shadow-emerald-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none group-hover:from-emerald-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_handling_time') || 'Avg Handling Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-emerald-500">
                  <Metric pending={loading}>{formatDuration(weekMetrics.avg_handling_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 group-hover:scale-110 transition-transform duration-300">
                <Hourglass size={22} />
              </div>
            </div>

            {/* Avg Resolution */}
            <div className="bg-dark-800 border border-amber-500/20 rounded-xl p-5 shadow-lg shadow-amber-500/5 hover:border-amber-500/40 hover:shadow-amber-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-500 to-orange-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none group-hover:from-amber-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_resolution_time') || 'Avg Resolution Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-amber-500">
                  <Metric pending={loading}>{formatDuration(weekMetrics.avg_total_resolution_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                <TrendingUp size={22} />
              </div>
            </div>
          </div>}
        </div>

        {/* Row 4: This Month */}
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap cursor-pointer select-none" onClick={() => toggleRow('month')}>
            <div className="h-4 w-1 bg-emerald-500 rounded-full" />
            <span className="text-sm font-bold text-slate-900">
              {t('insight.preset_this_month') || 'This Month'}
            </span>
            <span className="text-xs text-slate-500 font-normal ml-2">
              ({monthRangeText})
            </span>
            <span className="ml-auto text-slate-400">{collapsedRows['month'] ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</span>
          </div>
          {!collapsedRows['month'] && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Total Tickets */}
            <div className="bg-dark-800 border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-blue-500/5 hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none group-hover:from-blue-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_total_tickets') || 'Total Tickets'}
                </p>
                <h4 className="text-2xl font-extrabold text-blue-500">
                  <Metric pending={loading}>{monthMetrics.total_tickets.toLocaleString()}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                <Inbox size={22} />
              </div>
            </div>

            {/* Avg First Response */}
            <div className="bg-dark-800 border border-pink-500/20 rounded-xl p-5 shadow-lg shadow-pink-500/5 hover:border-pink-500/40 hover:shadow-pink-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-pink-500 to-rose-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent pointer-events-none group-hover:from-pink-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_first_response') || 'Avg First Response'}
                </p>
                <h4 className="text-2xl font-extrabold text-pink-500">
                  <Metric pending={loading}>{formatDuration(monthMetrics.avg_first_response_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-pink-500/10 text-pink-500 border border-pink-500/20 group-hover:scale-110 transition-transform duration-300">
                <Activity size={22} />
              </div>
            </div>

            {/* Avg Handling */}
            <div className="bg-dark-800 border border-emerald-500/20 rounded-xl p-5 shadow-lg shadow-emerald-500/5 hover:border-emerald-500/40 hover:shadow-emerald-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none group-hover:from-emerald-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_handling_time') || 'Avg Handling Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-emerald-500">
                  <Metric pending={loading}>{formatDuration(monthMetrics.avg_handling_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 group-hover:scale-110 transition-transform duration-300">
                <Hourglass size={22} />
              </div>
            </div>

            {/* Avg Resolution */}
            <div className="bg-dark-800 border border-amber-500/20 rounded-xl p-5 shadow-lg shadow-amber-500/5 hover:border-amber-500/40 hover:shadow-amber-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-500 to-orange-400 rounded-l-xl" />
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none group-hover:from-amber-500/10 transition-all duration-300" />
              <div className="relative z-10 pl-2">
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  {t('insight.metric_resolution_time') || 'Avg Resolution Time'}
                </p>
                <h4 className="text-2xl font-extrabold text-amber-500">
                  <Metric pending={loading}>{formatDuration(monthMetrics.avg_total_resolution_seconds)}</Metric>
                </h4>
              </div>
              <div className="relative z-10 p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                <TrendingUp size={22} />
              </div>
            </div>
          </div>}
        </div>
      </div>

      {/* 5. Charts Area */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 hidden">
        {/* Category Distribution Bar Chart */}
        <div className="bg-dark-800 border border-dark-700 p-6 rounded-xl shadow-xl xl:col-span-3 flex flex-col">
          <h3 className="text-md font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <BarChart2 size={18} className="text-primary-500" />
            {t('insight.chart_category_dist') || 'Category Distribution'}
          </h3>
          <div className="h-[300px] w-full mt-2">
            {categoryChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                {t('insight.no_data') || 'No data available'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChartData} layout="vertical" margin={{ left: 20, right: 20, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#1b2a52" opacity={0.3} />
                  <XAxis type="number" stroke="#97a7c6" fontSize={12} tickLine={false} />
                  <YAxis dataKey="name" type="category" stroke="#97a7c6" fontSize={11} width={100} tickLine={false} />
                  <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={20}>
                    {categoryChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* LINE OA Distribution Pie Chart */}
        <div className="bg-dark-800 border border-dark-700 p-6 rounded-xl shadow-xl xl:col-span-2 flex flex-col">
          <h3 className="text-md font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Users size={18} className="text-primary-500" />
            {t('insight.chart_oa_dist') || 'LINE OA Distribution'}
          </h3>
          <div className="h-[300px] w-full flex items-center justify-center mt-2">
            {oaChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                {t('insight.no_data') || 'No data available'}
              </div>
            ) : (
              <div className="w-full h-full flex flex-col sm:flex-row items-center justify-between">
                <div className="w-full sm:w-[55%] h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={oaChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {oaChartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<CustomPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full sm:w-[45%] flex flex-col gap-2 max-h-[250px] overflow-y-auto pl-4">
                  {oaChartData.map((entry, index) => {
                    const total = oaChartData.reduce((sum, item) => sum + item.value, 0);
                    const percentage = total > 0 ? Math.round((entry.value / total) * 100) : 0;
                    return (
                      <div key={entry.name} className="flex items-center gap-2 text-xs">
                        <span 
                          className="w-3 h-3 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: chartColors[index % chartColors.length] }} 
                        />
                        <span className="text-slate-600 truncate max-w-[100px]" title={entry.name}>
                          {entry.name}
                        </span>
                        <span className="text-slate-900 font-bold ml-auto">{entry.value} ({percentage}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6. Leaderboard Datatable */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden flex flex-col">
        {/* Table Header Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 p-6 border-b border-dark-700 bg-dark-900/50">
          <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleRow('leaderboard')}>
            <h3 className="text-md font-bold text-slate-900">{t('insight.leaderboard_title') || 'Agent Performance Leaderboard'}</h3>
            <span className="text-slate-400">{collapsedRows['leaderboard'] ? <ChevronDown size={20} /> : <ChevronUp size={20} />}</span>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
            {/* Search Input */}
            <div className="relative group w-full sm:w-64">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-slate-400 group-focus-within:text-primary-500 transition-colors" />
              </span>
              <input
                type="text"
                value={leaderboardSearch}
                onChange={(e) => {
                  setLeaderboardSearch(e.target.value);
                  setLeaderboardPage(1);
                }}
                placeholder={t('insight.search_agent') || 'Search agent name...'}
                className="pl-9 w-full bg-dark-900 border border-dark-600 rounded-lg py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            {/* Items Per Page */}
            <select
              value={leaderboardLimit}
              onChange={(e) => {
                setLeaderboardLimit(Number(e.target.value));
                setLeaderboardPage(1);
              }}
              className="bg-dark-900 border border-dark-600 rounded-lg px-2 py-1.5 text-xs text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all w-full sm:w-auto"
            >
              <option value={5}>5 {isThai ? 'แถว' : 'rows'}</option>
              <option value={10}>10 {isThai ? 'แถว' : 'rows'}</option>
              <option value={25}>25 {isThai ? 'แถว' : 'rows'}</option>
              <option value={50}>50 {isThai ? 'แถว' : 'rows'}</option>
            </select>
          </div>
        </div>

        {/* The Datatable */}
        {!collapsedRows['leaderboard'] && <><div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-16">
                  {t('insight.leaderboard_rank') || 'Rank'}
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors" onClick={() => handleSort('display_name')}>
                  <div className="flex items-center gap-1.5">
                    {t('insight.leaderboard_name') || 'Admin Name'}
                    <ArrowUpDown size={12} className="text-slate-400" />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors text-center" onClick={() => handleSort('accepted_count')}>
                  <div className="flex items-center justify-center gap-1.5">
                    {t('insight.leaderboard_accepted') || 'Accepted'}
                    <ArrowUpDown size={12} className="text-slate-400" />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors text-center" onClick={() => handleSort('closed_count')}>
                  <div className="flex items-center justify-center gap-1.5">
                    {t('insight.leaderboard_closed') || 'Closed'}
                    <ArrowUpDown size={12} className="text-slate-400" />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors text-center" onClick={() => handleSort('transfer_count')}>
                  <div className="flex items-center justify-center gap-1.5">
                    {t('insight.leaderboard_transferred') || 'Transferred'}
                    <ArrowUpDown size={12} className="text-slate-400" />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors text-center" onClick={() => handleSort('assigned_count')}>
                  <div className="flex items-center justify-center gap-1.5">
                    {t('insight.leaderboard_assigned') || 'Assigned'}
                    <ArrowUpDown size={12} className="text-slate-400" />
                  </div>
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors text-right" onClick={() => handleSort('avg_handling_seconds')}>
                  <div className="flex items-center justify-end gap-1.5">
                    {t('insight.leaderboard_handling') || 'Avg Handling'}
                    <ArrowUpDown size={12} className="text-slate-400" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {paginatedLeaderboard.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    {t('insight.no_data') || 'No data available'}
                  </td>
                </tr>
              ) : (
                paginatedLeaderboard.map((item, idx) => {
                  const rank = (leaderboardPage - 1) * leaderboardLimit + idx + 1;
                  return (
                    <tr key={item.display_name} className="transition-colors hover:bg-dark-700/50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-500">
                        #{rank}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900">
                        {item.display_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-500">
                          {item.accepted_count.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500">
                          {item.closed_count.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-center">
                        {item.transfer_count.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 text-center">
                        {item.assigned_count.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900 text-right">
                        {formatDuration(item.avg_handling_seconds)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Local Table Pagination Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-6 py-4 border-t border-dark-700 bg-dark-900/10">
          <span className="text-sm text-slate-500">
            {t('common.showing_total', { count: processedLeaderboard.length }) || `Total ${processedLeaderboard.length} items`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLeaderboardPage(prev => Math.max(1, prev - 1))}
              disabled={leaderboardPage === 1}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-slate-600">{leaderboardPage} / {totalLeaderboardPages}</span>
            <button
              onClick={() => setLeaderboardPage(prev => Math.min(totalLeaderboardPages, prev + 1))}
              disabled={leaderboardPage === totalLeaderboardPages}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        </>}
      </div>

      {/* 7. Error Alert Modal */}
      <AlertModal
        isOpen={alertState.isOpen}
        onClose={() => setAlertState(prev => ({ ...prev, isOpen: false }))}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
      />

      {/* 8. Documentation Modal */}
      {showDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-sm animate-modal-backdrop">
          <div className="bg-dark-800 border border-dark-700/80 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl shadow-orange-500/5 overflow-hidden animate-modal-content">
            
            {/* Modal Header */}
            <div className="relative p-6 border-b border-dark-700 flex items-center justify-between bg-dark-900/40">
              <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-orange-500 to-amber-400" />
              <div className="flex items-center gap-3 pl-2">
                <div className="p-2 rounded-lg bg-orange-500/10 text-orange-500 border border-orange-500/20">
                  <HelpCircle size={20} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 leading-tight">
                    {t('pageui.insight.doc_00', 'คำอธิบายสูตรการคำนวณและข้อมูลระบบ')}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t('pageui.insight.doc_01', 'รายละเอียดและหลักการคำนวณของแต่ละหมวดหมู่ข้อมูลในระบบ Insight Report')}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowDocModal(false)}
                className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-slate-900 hover:bg-dark-600 cursor-pointer transition-all active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-dark-700 scrollbar-track-transparent">
              
              {/* Section 1 */}
              <div className="bg-dark-900/30 border border-blue-500/10 rounded-xl p-5 relative overflow-hidden group">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500/50" />
                <h4 className="text-sm font-bold text-blue-500 flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/10 text-xs">1</span>
                  {t('pageui.insight.doc_02', 'สูตรการทำงานของหมวด Presets (Today, This Week, This Month)')}
                </h4>
                <div className="space-y-3 pl-7">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {t('pageui.insight.doc_03', 'หมวด presets ถูกออกแบบมาให้ข้อมูล ')}<strong className="text-slate-800">{t('pageui.insight.doc_04', '"ภาพรวมของระบบ"')}</strong>{t('pageui.insight.doc_05', ' ซึ่งจะไม่เปลี่ยนแปลงค่าตามตัวกรองที่กำหนดเอง (Custom Filter) ใดๆ ที่ผู้ใช้เลือก เพื่อให้มีตัวเลขตั้งต้นไว้เปรียบเทียบเสมอ โดยระบบหลังบ้านจะอิงตาม Timezone ')}<span className="font-mono bg-dark-700 px-1.5 py-0.5 rounded text-xs text-slate-700">Asia/Bangkok (GMT+7)</span>{t('pageui.insight.doc_06', ' และใช้เงื่อนไขการดึงข้อมูล (')}<span className="font-mono bg-dark-700 text-blue-500 px-1 py-0.5 rounded text-xs">$gte</span>{t('pageui.insight.doc_07', ') ดังนี้:')}
                  </p>
                  <ul className="space-y-2">
                    <li className="text-sm text-slate-600">
                      <span className="inline-block w-24 font-bold text-slate-800">{t('pageui.insight.doc_08', 'today (วันนี้):')}</span>{t('pageui.insight.doc_09', ' ค้นหารายการตั๋วทั้งหมดที่ ')}<code className="font-mono text-xs bg-dark-700 px-1 py-0.5 rounded text-pink-500">createdAt</code>{t('pageui.insight.doc_10', ' มีค่ามากกว่าหรือเท่ากับ (')}<code className="font-mono text-xs text-blue-500 bg-dark-700 px-1 py-0.5 rounded">$gte</code>{t('pageui.insight.doc_11', ') เวลา ')}<code className="font-mono text-xs text-slate-700">00:00:00</code>{t('pageui.insight.doc_12', ' ของวันนี้ จนถึงเวลาปัจจุบัน')}
                    </li>
                    <li className="text-sm text-slate-600">
                      <span className="inline-block w-24 font-bold text-slate-800">{t('pageui.insight.doc_13', 'this_week (สัปดาห์นี้):')}</span>{t('pageui.insight.doc_14', ' ค้นหารายการตั๋วทั้งหมดที่ ')}<code className="font-mono text-xs bg-dark-700 px-1 py-0.5 rounded text-pink-500">createdAt</code> &gt;= <code className="font-mono text-xs text-slate-700">00:00:00</code>{t('pageui.insight.doc_15', ' ของวันจันทร์ (ใช้ปลั๊กอิน ')}<code className="font-mono text-xs text-indigo-500 bg-dark-700 px-1 py-0.5 rounded">isoWeek</code>{t('pageui.insight.doc_16', ' เพื่อกำหนดให้วันจันทร์เป็นวันเริ่มต้นสัปดาห์) จนถึงเวลาปัจจุบัน')}
                    </li>
                    <li className="text-sm text-slate-600">
                      <span className="inline-block w-24 font-bold text-slate-800">{t('pageui.insight.doc_17', 'this_month (เดือนนี้):')}</span>{t('pageui.insight.doc_18', ' ค้นหารายการตั๋วทั้งหมดที่ ')}<code className="font-mono text-xs bg-dark-700 px-1 py-0.5 rounded text-pink-500">createdAt</code> &gt;= <code className="font-mono text-xs text-slate-700">00:00:00</code>{t('pageui.insight.doc_19', ' ของวันที่ 1 ประจำเดือนนี้ จนถึงเวลาปัจจุบัน')}
                    </li>
                  </ul>
                </div>
              </div>

              {/* Section 2 */}
              <div className="bg-dark-900/30 border border-pink-500/10 rounded-xl p-5 relative overflow-hidden group">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-pink-500/50" />
                <h4 className="text-sm font-bold text-pink-500 flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-pink-500/10 text-xs">2</span>
                  {t('pageui.insight.doc_20', 'หมวดตัวเลขภาพรวม (Overview Metrics)')}
                </h4>
                <div className="space-y-3 pl-7">
                  <p className="text-sm text-slate-600">
                    {t('pageui.insight.doc_21', 'ค่าเหล่านี้จะแสดงอยู่ใน presets และ custom_filter โดยมีสูตรการคิดคำนวณดังนี้:')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 bg-dark-900 rounded-lg border border-dark-700">
                      <span className="font-bold text-slate-800 text-xs block mb-1">{t('pageui.insight.doc_22', 'total_tickets (ตั๋วทั้งหมด)')}</span>
                      <p className="text-xs text-slate-500 leading-normal">
                        {t('pageui.insight.doc_23', 'ใช้คำสั่ง ')}<code className="font-mono text-cyan-500 bg-dark-700 px-1 rounded">$count</code>{t('pageui.insight.doc_24', ' นับจำนวนเอกสาร (Document) ในคอลเลกชัน tickets ตามเงื่อนไขเวลาหรือตัวกรองที่เลือก')}
                      </p>
                    </div>
                    <div className="p-3 bg-dark-900 rounded-lg border border-dark-700">
                      <span className="font-bold text-slate-800 text-xs block mb-1">{t('pageui.insight.doc_25', 'avg_first_response_seconds (ระยะเวลาตอบกลับแรกเฉลี่ย)')}</span>
                      <p className="text-xs text-slate-500 leading-normal">
                        {t('pageui.insight.doc_26', 'สูตร: ')}<code className="font-mono text-pink-500 bg-dark-700 px-1 rounded">{t('pageui.insight.doc_27', '(เวลาที่เริ่มรับงาน Accept ครั้งแรก) - (เวลาสร้างตั๋ว createdAt)')}</code>{t('pageui.insight.doc_28', ' นำผลลัพธ์ในหน่วยวินาทีของทุกตั๋วรวมกันเพื่อคำนวณหาค่าเฉลี่ย')}
                      </p>
                    </div>
                    <div className="p-3 bg-dark-900 rounded-lg border border-dark-700">
                      <span className="font-bold text-slate-800 text-xs block mb-1">{t('pageui.insight.doc_29', 'avg_handling_seconds (ระยะเวลาดำเนินการเฉลี่ย)')}</span>
                      <p className="text-xs text-slate-500 leading-normal">
                        {t('pageui.insight.doc_30', 'สูตร: ')}<code className="font-mono text-emerald-500 bg-dark-700 px-1 rounded">{t('pageui.insight.doc_31', '(เวลาปิดงาน Close) - (เวลาเริ่มรับงาน Accept ครั้งแรก)')}</code>
                        <br/>
                        <span className="text-[10px] text-amber-500 mt-1 block font-medium">
                          {t('pageui.insight.doc_32', '⚠️ กรณีพิเศษ (Fallback): หากปิดงานโดยไม่มีประวัติการกดรับงาน จะใช้สูตร (เวลาปิดงาน Close) - (เวลาสร้างตั๋ว createdAt) แทน')}
                        </span>
                      </p>
                    </div>
                    <div className="p-3 bg-dark-900 rounded-lg border border-dark-700">
                      <span className="font-bold text-slate-800 text-xs block mb-1">{t('pageui.insight.doc_33', 'avg_total_resolution_seconds (ระยะเวลาปิดงานเฉลี่ย)')}</span>
                      <p className="text-xs text-slate-500 leading-normal">
                        {t('pageui.insight.doc_34', 'สูตร: ')}<code className="font-mono text-purple-500 bg-dark-700 px-1 rounded">{t('pageui.insight.doc_35', '(เวลาการดำเนินการล่าสุด Last Action) - (เวลาการดำเนินการแรกสุด First Action)')}</code>{t('pageui.insight.doc_36', ' ของตั๋วแต่ละใบ แล้วนำมาคำนวณหาค่าเฉลี่ยทั้งหมด')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3 */}
              <div className="bg-dark-900/30 border border-purple-500/10 rounded-xl p-5 relative overflow-hidden group">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500/50" />
                <h4 className="text-sm font-bold text-purple-500 flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-500/10 text-xs">3</span>
                  {t('pageui.insight.doc_37', 'หมวดการกระจายตัว (Distributions)')}
                </h4>
                <div className="space-y-3 pl-7">
                  <ul className="space-y-3">
                    <li className="text-sm text-slate-600">
                      <span className="font-bold text-slate-800 block mb-1">{t('pageui.insight.doc_38', 'category_distribution (สัดส่วนตามหมวดหมู่):')}</span>
                      <p className="text-xs text-slate-500">
                        {t('pageui.insight.doc_39', 'นำตั๋วที่ตรงตามเงื่อนไขทั้งหมดมาจัดกลุ่ม (')}<code className="font-mono text-cyan-500 bg-dark-700 px-1 rounded">$group</code>{t('pageui.insight.doc_40', ') ตามฟิลด์ ')}<code className="font-mono text-slate-700 bg-dark-700 px-1 rounded">category</code>{t('pageui.insight.doc_41', ' และใช้คำสั่งหาผลรวม (')}<code className="font-mono text-cyan-500 bg-dark-700 px-1 rounded">$sum: 1</code>{t('pageui.insight.doc_42', ') เพื่อจัดอันดับจากมากไปน้อย')}
                      </p>
                    </li>
                    <li className="text-sm text-slate-600">
                      <span className="font-bold text-slate-800 block mb-1">{t('pageui.insight.doc_43', 'oa_distribution (สัดส่วนตาม Line OA):')}</span>
                      <p className="text-xs text-slate-500">
                        {t('pageui.insight.doc_44', 'จัดกลุ่มตาม ')}<code className="font-mono text-slate-700 bg-dark-700 px-1 rounded">line_oa_hook_id</code>{t('pageui.insight.doc_45', ' ของตั๋ว และใช้การเชื่อมโยงข้อมูล (')}<code className="font-mono text-cyan-500 bg-dark-700 px-1 rounded">$lookup</code>{t('pageui.insight.doc_46', ') ไปยังตาราง ')}<code className="font-mono text-slate-700 bg-dark-700 px-1 rounded">line_chat_bot</code>{t('pageui.insight.doc_47', ' เพื่อแปลงรหัสเป็นชื่อบัญชี LINE OA (')}<code className="font-mono text-slate-700">line_oa_name</code>{t('pageui.insight.doc_48', ') แล้วคำนวณยอดรวม')}
                      </p>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Section 4 */}
              <div className="bg-dark-900/30 border border-orange-500/10 rounded-xl p-5 relative overflow-hidden group">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500/50" />
                <h4 className="text-sm font-bold text-orange-500 flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/10 text-xs">4</span>
                  {t('pageui.insight.doc_49', 'หมวดจัดอันดับแอดมิน (Agent Leaderboard)')}
                </h4>
                <div className="space-y-3 pl-7">
                  <p className="text-sm text-slate-600">
                    {t('pageui.insight.doc_50', 'หมวดนี้จะ ')}<strong className="text-orange-500 font-bold">{t('pageui.insight.doc_51', 'ไม่ได้ดึงข้อมูลจากตารางตั๋วโดยตรง')}</strong>{t('pageui.insight.doc_52', ' แต่ดึงข้อมูลจากคอลเลกชัน ')}<span className="font-mono bg-dark-700 px-1.5 py-0.5 rounded text-xs text-pink-500">assign_histories</span>{t('pageui.insight.doc_53', ' (ประวัติการมอบหมายงานแอดมิน) แล้วนำมาจัดกลุ่มตาม ')}<span className="font-mono bg-dark-700 px-1.5 py-0.5 rounded text-xs text-slate-700">admin_user_id</span>:
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-normal">
                        <strong className="text-slate-800">{t('pageui.insight.doc_54', 'ชื่อแอดมิน (display_name):')}</strong>{t('pageui.insight.doc_55', ' ดึงจากตาราง ')}<code className="font-mono text-xs">admin_users</code>{t('pageui.insight.doc_56', ' (กรณีไม่มี Display Name จะใช้ username และกรณีที่บัญชีถูกลบไปแล้วจะแสดงเป็น "Unknown")')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-normal">
                        <strong className="text-slate-800">{t('pageui.insight.doc_57', 'ได้รับมอบหมาย (assigned_count):')}</strong>{t('pageui.insight.doc_58', ' คำนวณจากจำนวนครั้งที่สถานะการดำเนินการ (action) เป็น ')}<code className="font-mono text-xs bg-dark-700 px-1 rounded text-cyan-500">"assign"</code>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-normal">
                        <strong className="text-slate-800">{t('pageui.insight.doc_59', 'กดรับงาน (accepted_count):')}</strong>{t('pageui.insight.doc_60', ' คำนวณจากจำนวนครั้งที่สถานะการดำเนินการ (action) เป็น ')}<code className="font-mono text-xs bg-dark-700 px-1 rounded text-emerald-500">"accept"</code>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-normal">
                        <strong className="text-slate-800">{t('pageui.insight.doc_61', 'ปิดงานสำเร็จ (closed_count):')}</strong>{t('pageui.insight.doc_62', ' คำนวณจากจำนวนครั้งที่สถานะการดำเนินการ (action) เป็น ')}<code className="font-mono text-xs bg-dark-700 px-1 rounded text-pink-500">"close"</code>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-normal">
                        <strong className="text-slate-800">{t('pageui.insight.doc_63', 'โอนตั๋ว (transfer_count):')}</strong>{t('pageui.insight.doc_64', ' คำนวณจากจำนวนครั้งที่สถานะการดำเนินการ (action) เป็น ')}<code className="font-mono text-xs bg-dark-700 px-1 rounded text-purple-500">"transfer"</code>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-normal">
                        <strong className="text-slate-800">{t('pageui.insight.doc_65', 'ยกเลิกช่วยเหลือออโต้ (auto_unassist_count):')}</strong>{t('pageui.insight.doc_66', ' คำนวณจากจำนวนครั้งที่สถานะการดำเนินการ (action) เป็น ')}<code className="font-mono text-xs bg-dark-700 px-1 rounded text-rose-500">"auto_unassist"</code>{t('pageui.insight.doc_67', ' (เกิดขึ้นเมื่อไม่มีการตอบกลับจนหมดระยะเวลาที่กำหนด)')}
                      </p>
                    </div>
                    <div className="col-span-1 md:col-span-2 flex gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-2 flex-shrink-0" />
                      <p className="text-xs text-slate-600 leading-normal">
                        <strong className="text-slate-800">{t('pageui.insight.doc_68', 'ดำเนินการเฉลี่ย (avg_handling_seconds):')}</strong>{t('pageui.insight.doc_69', ' คำนวณเฉพาะรายการตั๋วที่แอดมินท่านนี้ดำเนินการปิดงาน โดยใช้สูตร: ')}<code className="font-mono text-xs bg-dark-700 px-1 rounded text-orange-500">{t('pageui.insight.doc_70', '(เวลาปิดงาน) - (เวลาเริ่มต้นรับงาน หรือ เวลาที่สร้างตั๋ว)')}</code>{t('pageui.insight.doc_71', ' และนำผลรวมของรายการทั้งหมดที่แอดมินท่านนี้ดำเนินการปิดงานสำเร็จมาหาค่าเฉลี่ย')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-dark-700 bg-dark-900/60 flex justify-end">
              <button
                onClick={() => setShowDocModal(false)}
                className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm cursor-pointer transition-colors shadow-lg shadow-orange-500/10 active:scale-95"
              >
                {t('pageui.insight.doc_72', 'ตกลง')}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Custom styles for animations */}
      <style>{`
        @keyframes helpGlow {
          0%, 100% {
            transform: translateY(0) scale(1);
            box-shadow: 0 0 6px rgba(249, 115, 22, 0.4), inset 0 0 4px rgba(249, 115, 22, 0.1);
          }
          50% {
            transform: translateY(-4px) scale(1.15);
            box-shadow: 0 0 16px rgba(249, 115, 22, 0.95), inset 0 0 8px rgba(249, 115, 22, 0.3);
          }
        }
        .animate-help-glow {
          animation: helpGlow 2s infinite ease-in-out;
        }
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalScaleIn {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-modal-backdrop {
          animation: modalFadeIn 0.2s ease-out forwards;
        }
        .animate-modal-content {
          animation: modalScaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>
    </div>
  );
};
