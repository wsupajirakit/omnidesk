import React, { useEffect, useMemo, useState } from 'react';
import { webhookService } from '../../services/hook';
import { statsService } from '../../services/insight';
import { insightReportService, InsightReportResponse, InsightSummary } from '../../services/insight';
import { HookData } from '../../types';
import { Activity, Server, Calendar, Clock, Inbox, Hourglass, TrendingUp } from 'lucide-react';
import { useI18n } from '../../i18n';
import { SkeletonBlock } from '../../components/common';
import { getStoredAuth } from '../../services/authStorage';

// [FEAT-20260804-DASHPERM] สิทธิ์ดูการ์ดสถิติใน dashboard
//   ไม่มีสิทธิ์นี้ = เข้าหน้าได้แต่เห็นแค่นาฬิกา (ไม่โหลด/ไม่โชว์การ์ด) · superadmin/`*` ผ่านเสมอ
//   เป็น key อิสระ ไม่ seed — แอดมินติ๊กให้เองที่ฟอร์มผู้ใช้ (ดู UserFormModal KNOWN_PERMISSIONS)
const DASH_STATS_PERM = 'dashboard.stats.view';

const formatDateTime = (date: Date): string => {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
};


export const Dashboard: React.FC = () => {
  const { t, locale } = useI18n();
  // [FEAT-20260804-DASHPERM] ผู้ใช้เห็นการ์ดสถิติได้ไหม (superadmin/`*`/system.manage ผ่านเสมอ)
  const canViewStats = useMemo(() => {
    const perms = getStoredAuth()?.permissions || [];
    return perms.includes(DASH_STATS_PERM) || perms.includes('system.manage') || perms.includes('*');
  }, []);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [statsFailed, setStatsFailed] = useState(false);
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [stats, setStats] = useState<{
    summary: { success: number; fail: number };
    daily: Array<{ date: string; success: number; fail: number }>;
  }>({ summary: { success: 0, fail: 0 }, daily: [] });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [insights, setInsights] = useState<InsightReportResponse['data'] | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date>(() => new Date());

  useEffect(() => {
    // [FEAT-20260804-DASHPERM] ไม่มีสิทธิ์ดูการ์ด = ไม่ต้องยิง endpoint สถิติ (กันโหลดเปล่า)
    if (!canViewStats) { setInsightsLoading(false); return; }
    const fetchInsights = async () => {
      try {
        const res = await insightReportService.getTicketInsights({});
        if (res.success && res.data) {
          setInsights(res.data);
          setLastFetchedAt(new Date());
        }
      } catch (error) {
        console.error("Failed to load ticket insights for dashboard", error);
      } finally {
        setInsightsLoading(false);
      }
    };
    fetchInsights();
  }, [canViewStats]);


  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await webhookService.getAllHooksForDashboard();
        setHooks(data);
      } catch (error) {
        console.error("Failed to load dashboard data", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const to = new Date();
        to.setHours(0, 0, 0, 0);
        const from = new Date(to);
        from.setDate(from.getDate() - 13);
        const format = (date: Date) => date.toISOString().slice(0, 10);
        const data = await statsService.getStats(format(from), format(to));
        const webhookStats = data.data.filter(item => item.type === 'webhooklog');
        setStats({
          summary: {
            success: data.summary?.count_success ?? 0,
            fail: data.summary?.count_failed ?? 0
          },
          daily: webhookStats
            .filter(item => item.date)
            .map(item => ({
              date: item.date as string,
              success: item.count_success ?? 0,
              fail: item.count_failed ?? 0
            }))
        });
      } catch (error) {
        setStatsFailed(true);
        console.error("Failed to load webhook stats for dashboard", error);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // --- Calculations ---
  const totalHooks = hooks.length;
  const activeHooks = hooks.filter(h => h.status === 1).length;

  const isThai = locale === 'th';
  const formatDateLong = (date: Date) => {
    if (isThai) {
      const thMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
      ];
      const day = String(date.getDate()).padStart(2, '0');
      const month = thMonths[date.getMonth()];
      const year = date.getFullYear() + 543;
      return `${day} ${month} ${year}`;
    }
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(date);
  };

  const formatTime = (date: Date, withSeconds: boolean) => (
    new Intl.DateTimeFormat(isThai ? 'th-TH' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {})
    }).format(date)
  );

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

  // Process tags

  const webhookLogSeries = useMemo(() => {
    const days = 14;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const series = Array.from({ length: days }, (_, idx) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (days - 1 - idx));
      return {
        date,
        success: 0,
        fail: 0
      };
    });
    const dailyMap = new Map<string, { date: string; success: number; fail: number }>(stats.daily.map(item => [item.date, item]));
    series.forEach(item => {
      const key = item.date.toISOString().slice(0, 10);
      const daily = dailyMap.get(key);
      item.success = daily?.success ?? 0;
      item.fail = daily?.fail ?? 0;
    });
    return series;
  }, [stats, now]);

  const chartWidth = 640;
  const chartHeight = 220;
  const chartPadding = { top: 18, right: 16, bottom: 36, left: 36 };
  const successValues = webhookLogSeries.map(d => d.success);
  const failValues = webhookLogSeries.map(d => d.fail);
  const totalSuccess = stats.summary.success;
  const totalFail = stats.summary.fail;
  const maxValueRaw = Math.max(...successValues, ...failValues, 1);
  const maxValue = Math.max(1, Math.ceil(maxValueRaw * 1.1));
  const formatShortDate = (date: Date) =>
    new Intl.DateTimeFormat(isThai ? 'th-TH' : 'en-US', {
      day: '2-digit',
      month: 'short'
    }).format(date);
  const chartDates = webhookLogSeries.map(item => item.date);
  const makeSmoothPath = (values: number[]) => {
    if (values.length === 0) return '';
    const points = values.map((value, idx) => {
      const x = chartPadding.left + (idx / (values.length - 1)) * (chartWidth - chartPadding.left - chartPadding.right);
      const y = chartPadding.top + (1 - value / maxValue) * (chartHeight - chartPadding.top - chartPadding.bottom);
      return { x, y };
    });
    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y}`;
    }
    const midPoint = (p1: { x: number; y: number }, p2: { x: number; y: number }) => ({
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2
    });
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const mid = midPoint(points[i], points[i + 1]);
      d += ` Q ${points[i].x} ${points[i].y} ${mid.x} ${mid.y}`;
    }
    d += ` T ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return d;
  };
  const yTicks = [0, Math.round(maxValue / 2), maxValue];

  // Progressive loading: the page frame renders immediately and each metric
  // fills in as its own request resolves, instead of blocking the whole screen
  // behind the slowest of the three (hooks / stats / insights).
  // `Metric` shows a shimmer in place of just the number while its data is in
  // flight, so card layout never shifts.
  const Metric = ({ pending, children }: { pending: boolean; children: React.ReactNode }) =>
    pending ? <SkeletonBlock className="h-7 w-20 mt-1" /> : <>{children}</>;

  const glowMap: Record<string, string> = {
    'bg-blue-500': 'rgba(59, 130, 246, 0.46)',
    'bg-emerald-500': 'rgba(16, 185, 129, 0.46)',
    'bg-pink-500': 'rgba(236, 72, 153, 0.46)',
    'bg-orange-500': 'rgba(249, 115, 22, 0.46)'
  };

  const StatCard = ({ title, value, icon: Icon, color, subtext }: any) => (
    <div className="bg-dark-800 p-6 rounded-2xl border border-dark-700 shadow-xl relative overflow-hidden group hover:border-dark-600 transition-all">
      <div className="grid grid-cols-[2fr_1fr] items-start gap-3 mb-4">
        <div className="min-w-0">
           <p className="text-slate-500 text-sm font-medium mb-1 truncate">{title}</p>
           <h3 className="text-3xl font-bold text-slate-900 whitespace-nowrap text-[clamp(15px,2.04vw,25px)] overflow-hidden text-ellipsis">{value}</h3>
        </div>
        <div className="flex justify-end">
          <div
            className={`p-3 rounded-lg bg-dark-900 ${color.replace('bg-', 'text-')}`}
            style={{ boxShadow: `0 0 25px ${glowMap[color] ?? 'rgba(255,255,255,0.15)'}` }}
          >
            <Icon size={24} />
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500">{subtext}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">{t('dashboard.title')}</h1>

      {/* [FEAT-20260804-DASHPERM] ไม่มีสิทธิ์ดูการ์ด → เห็นแค่นาฬิกา (เหมือนตอนยังไม่มี hook)
          revert: เอา `!canViewStats ||` ออกจากเงื่อนไข */}
      {!canViewStats || (!loading && totalHooks === 0) ? (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="bg-dark-800 border border-dark-700 rounded-3xl shadow-xl px-8 py-10 text-center">
            <div className="text-5xl font-bold text-slate-900 tracking-tight">
              {formatTime(now, true)}
            </div>
            <div className="mt-2 text-sm text-slate-500">
              {formatDateLong(now)}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Stats Grid - Hidden for now */}
          {/*
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <StatCard 
              title={t('dashboard.total_channels')}
              value={totalHooks} 
              icon={Server} 
              color="bg-blue-500"
              subtext={t('dashboard.registered_webhooks')}
            />
            <StatCard 
              title={t('dashboard.active_status')} 
              value={activeHooks} 
              icon={Activity} 
              color="bg-emerald-500"
              subtext={t('dashboard.availability', { percent: ((activeHooks / totalHooks || 0) * 100).toFixed(1) })}
            />
            <StatCard
              title={t('dashboard.calendar')}
              value={formatDateLong(now)}
              icon={Calendar}
              color="bg-pink-500"
              subtext={t('dashboard.today')}
            />
            <StatCard
              title={t('dashboard.clock')}
              value={formatTime(now, false)}
              icon={Clock}
              color="bg-orange-500"
              subtext={t('dashboard.local_time')}
            />
          </div>
          */}

          {/* Ticket Preset KPI rows */}
          <div className="flex flex-col gap-6 mb-2">
            {/* Row 1: Today */}
            <div>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="h-4 w-1 bg-blue-500 rounded-full" />
                <span className="text-sm font-bold text-slate-900">
                  {t('insight.preset_today') || 'Today'}
                </span>
                <span className="text-xs text-slate-500 font-normal ml-2">
                  ({todayRangeText})
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Total Tickets */}
                <div className="bg-dark-800 border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-blue-500/5 hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-400 rounded-l-xl" />
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none group-hover:from-blue-500/10 transition-all duration-300" />
                  <div className="relative z-10 pl-2">
                    <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                      {t('insight.metric_total_tickets') || 'Total Tickets'}
                    </p>
                    <h4 className="text-2xl font-extrabold text-blue-500">
                      <Metric pending={insightsLoading}>{todayMetrics.total_tickets.toLocaleString()}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(todayMetrics.avg_first_response_seconds)}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(todayMetrics.avg_handling_seconds)}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(todayMetrics.avg_total_resolution_seconds)}</Metric>
                    </h4>
                  </div>
                  <div className="relative z-10 p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                    <TrendingUp size={22} />
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: This Week */}
            <div>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="h-4 w-1 bg-pink-500 rounded-full" />
                <span className="text-sm font-bold text-slate-900">
                  {t('insight.preset_this_week') || 'This Week'}
                </span>
                <span className="text-xs text-slate-500 font-normal ml-2">
                  ({weekRangeText})
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Total Tickets */}
                <div className="bg-dark-800 border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-blue-500/5 hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-400 rounded-l-xl" />
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none group-hover:from-blue-500/10 transition-all duration-300" />
                  <div className="relative z-10 pl-2">
                    <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                      {t('insight.metric_total_tickets') || 'Total Tickets'}
                    </p>
                    <h4 className="text-2xl font-extrabold text-blue-500">
                      <Metric pending={insightsLoading}>{weekMetrics.total_tickets.toLocaleString()}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(weekMetrics.avg_first_response_seconds)}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(weekMetrics.avg_handling_seconds)}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(weekMetrics.avg_total_resolution_seconds)}</Metric>
                    </h4>
                  </div>
                  <div className="relative z-10 p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                    <TrendingUp size={22} />
                  </div>
                </div>
              </div>
            </div>

            {/* Row 3: This Month */}
            <div>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className="h-4 w-1 bg-emerald-500 rounded-full" />
                <span className="text-sm font-bold text-slate-900">
                  {t('insight.preset_this_month') || 'This Month'}
                </span>
                <span className="text-xs text-slate-500 font-normal ml-2">
                  ({monthRangeText})
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {/* Total Tickets */}
                <div className="bg-dark-800 border border-blue-500/20 rounded-xl p-5 shadow-lg shadow-blue-500/5 hover:border-blue-500/40 hover:shadow-blue-500/10 transition-all hover:scale-[1.02] relative overflow-hidden flex items-center justify-between group">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 to-cyan-400 rounded-l-xl" />
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none group-hover:from-blue-500/10 transition-all duration-300" />
                  <div className="relative z-10 pl-2">
                    <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                      {t('insight.metric_total_tickets') || 'Total Tickets'}
                    </p>
                    <h4 className="text-2xl font-extrabold text-blue-500">
                      <Metric pending={insightsLoading}>{monthMetrics.total_tickets.toLocaleString()}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(monthMetrics.avg_first_response_seconds)}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(monthMetrics.avg_handling_seconds)}</Metric>
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
                      <Metric pending={insightsLoading}>{formatDuration(monthMetrics.avg_total_resolution_seconds)}</Metric>
                    </h4>
                  </div>
                  <div className="relative z-10 p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 group-hover:scale-110 transition-transform duration-300">
                    <TrendingUp size={22} />
                  </div>
                </div>
              </div>
            </div>
          </div>


          {/*
          {!statsFailed && (
            <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-xl p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-500">{t('dashboard.webhook_stats_title')}</p>
                  <h2 className="text-xl font-semibold text-slate-900">{t('dashboard.webhook_stats_subtitle')}</h2>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    {t('dashboard.webhook_stats_success')} ({totalSuccess})
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                    {t('dashboard.webhook_stats_failed')} ({totalFail})
                  </div>
                </div>
              </div>

              <div className="mt-6 overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full min-w-[640px]"
                  aria-label={t('dashboard.webhook_stats_aria')}
                  role="img"
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <rect
                    x={chartPadding.left}
                    y={chartPadding.top}
                    width={chartWidth - chartPadding.left - chartPadding.right}
                    height={chartHeight - chartPadding.top - chartPadding.bottom}
                    fill="transparent"
                    onMouseMove={(event) => {
                      const svg = event.currentTarget.ownerSVGElement;
                      if (!svg) return;
                      const rect = svg.getBoundingClientRect();
                      const relativeX = event.clientX - rect.left - chartPadding.left;
                      const width = chartWidth - chartPadding.left - chartPadding.right;
                      const ratio = Math.min(1, Math.max(0, relativeX / width));
                      const index = Math.round(ratio * (chartDates.length - 1));
                      setHoverIndex(index);
                    }}
                  />
                  {yTicks.map((tick, idx) => {
                    const y = chartPadding.top + (1 - tick / maxValue) * (chartHeight - chartPadding.top - chartPadding.bottom);
                    return (
                      <g key={`grid-${tick}`}>
                        <line
                          x1={chartPadding.left}
                          y1={y}
                          x2={chartWidth - chartPadding.right}
                          y2={y}
                          stroke="currentColor"
                          className="text-slate-500"
                          opacity={0.35}
                        />
                        <text
                          x={chartPadding.left - 10}
                          y={y + 4}
                          textAnchor="end"
                          className="fill-current text-slate-500 text-[10px]"
                        >
                          {tick}
                        </text>
                      </g>
                    );
                  })}

                  <path
                    d={makeSmoothPath(successValues)}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={makeSmoothPath(failValues)}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {hoverIndex !== null && (
                    <g>
                      <line
                        x1={chartPadding.left + (hoverIndex / (chartDates.length - 1)) * (chartWidth - chartPadding.left - chartPadding.right)}
                        y1={chartPadding.top}
                        x2={chartPadding.left + (hoverIndex / (chartDates.length - 1)) * (chartWidth - chartPadding.left - chartPadding.right)}
                        y2={chartHeight - chartPadding.bottom}
                        stroke="currentColor"
                        className="text-slate-500"
                        opacity={0.35}
                      />
                      <circle
                        cx={chartPadding.left + (hoverIndex / (chartDates.length - 1)) * (chartWidth - chartPadding.left - chartPadding.right)}
                        cy={chartPadding.top + (1 - successValues[hoverIndex] / maxValue) * (chartHeight - chartPadding.top - chartPadding.bottom)}
                        r={4}
                        fill="#22c55e"
                        stroke="#0f172a"
                        strokeWidth={1}
                      />
                      <circle
                        cx={chartPadding.left + (hoverIndex / (chartDates.length - 1)) * (chartWidth - chartPadding.left - chartPadding.right)}
                        cy={chartPadding.top + (1 - failValues[hoverIndex] / maxValue) * (chartHeight - chartPadding.top - chartPadding.bottom)}
                        r={3.5}
                        fill="#ef4444"
                        stroke="#0f172a"
                        strokeWidth={1}
                      />
                    </g>
                  )}

                  {chartDates.map((date, idx) => {
                    const x = chartPadding.left + (idx / (chartDates.length - 1)) * (chartWidth - chartPadding.left - chartPadding.right);
                    return (
                      <text
                        key={`x-${idx}`}
                        x={x}
                        y={chartHeight - 10}
                        textAnchor="middle"
                        className="fill-current text-slate-500 text-[10px]"
                      >
                        {formatShortDate(date)}
                      </text>
                    );
                  })}
                </svg>
                {hoverIndex !== null && (
                  <div className="relative">
                    <div
                      className="absolute -top-52 left-0 bg-dark-900 border border-dark-700 rounded-lg px-3 py-2 text-xs text-slate-500 shadow-lg"
                      style={{
                        transform: `translateX(${(hoverIndex / (chartDates.length - 1)) * 100}%) translateX(-50%)`,
                        minWidth: 120
                      }}
                    >
                      <div className="text-slate-900 text-xs font-semibold">
                        {formatShortDate(chartDates[hoverIndex])}
                      </div>
                      <div className="mt-1 text-emerald-500">
                        {t('dashboard.webhook_stats_success')}: {successValues[hoverIndex]}
                      </div>
                      <div className="text-red-500">
                        {t('dashboard.webhook_stats_failed')}: {failValues[hoverIndex]}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          */}
        </>
      )}
    </div>
  );
};
