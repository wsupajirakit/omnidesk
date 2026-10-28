import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, RefreshCw, ExternalLink } from 'lucide-react';
import { webhookService } from '../../../../services/hook';
import { groupService } from '../../../../services/admin';
import type { GroupEntry, HookData, HookQuotaResponse, HookFollowersResponse } from '../../../../types';
import { channelOf } from '../../../../config/channelRegistry';
import { HookTablePager } from '../../list/HookTablePager';
import { LineQuotaGauge } from './LineQuotaGauge';
import { useI18n, translateNow } from '../../../../i18n';

/**
 * ==== [FEAT-20260917-LINEQUOTATABLE] LINE OA Quota DataTable ==============
 *
 * Standalone render body for LINE OA message quota:
 * - Reusable inside WebhookList tab OR standalone embed (/hook-quota)
 * - 4 main columns: Site/Domain, Group, Alias, LINE Quota Gauge
 * - Server-side paged hooks + in-memory quota session cache
 * - Reuses HookTablePager on both top and bottom
 * - 5-minute Redis backend caching supported
 */

const PER_PAGE_OPTIONS = [10, 25, 50, 75, 100] as const;

interface Props {
  showHeaderCard?: boolean;
  search?: string;
  onSearchChange?: (val: string) => void;
  onRefresh?: (refreshFn: () => void) => void;
}

export const LineQuotaTable: React.FC<Props> = ({
  showHeaderCard = true,
  search: externalSearch,
  onSearchChange: externalOnSearchChange,
  onRefresh,
}) => {
  const { t } = useI18n();

  const [internalSearch, setInternalSearch] = useState('');
  const isControlledSearch = externalSearch !== undefined;
  const search = isControlledSearch ? externalSearch : internalSearch;
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);

  const [hooks, setHooks] = useState<HookData[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);

  const [groups, setGroups] = useState<GroupEntry[]>([]);

  // In-memory quota cache per hookId: { data, loading, error }
  const [quotaMap, setQuotaMap] = useState<
    Record<
      string,
      {
        data?: HookQuotaResponse | null;
        loading: boolean;
        error?: string | null;
      }
    >
  >({});

  // In-memory followers cache per hookId: { data, loading, error }
  const [followersMap, setFollowersMap] = useState<
    Record<
      string,
      {
        data?: HookFollowersResponse | null;
        loading: boolean;
        error?: string | null;
      }
    >
  >({});

  // Debounce search by 350ms
  const searchTimerRef = useRef<number | null>(null);
  const handleSearchChange = (val: string) => {
    if (isControlledSearch) {
      externalOnSearchChange?.(val);
    } else {
      setInternalSearch(val);
    }
  };

  useEffect(() => {
    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      const next = (search || '').trim();
      setDebouncedSearch((prev) => {
        if (prev === next) return prev;
        setCurrentPage(1);
        return next;
      });
    }, 350);

    return () => {
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, [search]);

  // Load group dictionary for group name lookup
  useEffect(() => {
    let alive = true;
    groupService
      .listGroups({ limit: 100 })
      .then(({ data }) => {
        if (!alive) return;
        setGroups(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error('Failed to load groups for quota table:', err);
      });
    return () => {
      alive = false;
    };
  }, []);

  const groupNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      map.set(g._id, g.group_name);
    }
    return map;
  }, [groups]);

  const groupNameOf = useCallback(
    (hook: HookData): string => {
      const gId = typeof hook.group === 'string' ? hook.group : (hook.group as any)?._id;
      if (!gId) return '-';
      return groupNameMap.get(gId) || (hook.group as any)?.group_name || '-';
    },
    [groupNameMap],
  );

  // Fetch paginated hooks
  const fetchHooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await webhookService.getHooksPaged({
        page: currentPage,
        limit: itemsPerPage,
        keyword: debouncedSearch,
        status: 'all',
      });
      setHooks(res.data || []);
      setTotalItems(res.total || 0);
    } catch (err) {
      console.error('Failed to fetch hooks for quota table:', err);
      setHooks([]);
      setTotalItems(0);
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, debouncedSearch]);

  useEffect(() => {
    fetchHooks();
  }, [fetchHooks]);

  // In-flight and loaded tracking to avoid re-triggering loops
  const fetchingHooksRef = useRef<Set<string>>(new Set());
  const fetchingFollowersRef = useRef<Set<string>>(new Set());

  // Load quota for current page hooks with in-memory caching
  const loadQuotaForHook = useCallback(async (hookId: string, force = false) => {
    if (!force && fetchingHooksRef.current.has(hookId)) {
      return;
    }
    fetchingHooksRef.current.add(hookId);

    setQuotaMap((prev) => ({
      ...prev,
      [hookId]: { ...prev[hookId], loading: true, error: null },
    }));

    try {
      const res = await webhookService.getHookQuota(hookId);
      setQuotaMap((prev) => ({
        ...prev,
        [hookId]: { data: res, loading: false, error: null },
      }));
    } catch (err: any) {
      const message = err?.message || translateNow('pageui.hookform.load_failed', 'โหลดไม่สำเร็จ');
      setQuotaMap((prev) => ({
        ...prev,
        [hookId]: { data: null, loading: false, error: message },
      }));
    }
  }, []);

  // Load followers insight for current page hooks with in-memory caching
  const loadFollowersForHook = useCallback(async (hookId: string, force = false) => {
    if (!force && fetchingFollowersRef.current.has(hookId)) {
      return;
    }
    fetchingFollowersRef.current.add(hookId);

    setFollowersMap((prev) => ({
      ...prev,
      [hookId]: { ...prev[hookId], loading: true, error: null },
    }));

    try {
      const res = await webhookService.getHookFollowers(hookId);
      setFollowersMap((prev) => ({
        ...prev,
        [hookId]: { data: res, loading: false, error: null },
      }));
    } catch (err: any) {
      const message = err?.message || translateNow('pageui.hookform.load_failed', 'โหลดไม่สำเร็จ');
      setFollowersMap((prev) => ({
        ...prev,
        [hookId]: { data: null, loading: false, error: message },
      }));
    }
  }, []);

  useEffect(() => {
    if (!hooks || hooks.length === 0) return;
    hooks.forEach((hook) => {
      if (hook._id) {
        if (!fetchingHooksRef.current.has(hook._id)) {
          loadQuotaForHook(hook._id);
        }
        if (!fetchingFollowersRef.current.has(hook._id)) {
          loadFollowersForHook(hook._id);
        }
      }
    });
  }, [hooks, loadQuotaForHook, loadFollowersForHook]);

  const handleRefreshAll = useCallback(() => {
    fetchingHooksRef.current.clear();
    fetchingFollowersRef.current.clear();
    setQuotaMap({});
    setFollowersMap({});
    fetchHooks();
  }, [fetchHooks]);

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    onRefreshRef.current?.(handleRefreshAll);
  }, [handleRefreshAll]);

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  const totalLabel = t('hook_quota.total_items', {
    total: totalItems.toLocaleString(),
    defaultValue: `ทั้งหมด ${totalItems.toLocaleString()} รายการ`,
  });

  return (
    <div className="flex flex-col gap-6 w-full" data-testid="line-quota-table-container">
      {/* Header Search & Toolbar */}
      {showHeaderCard && (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-dark-800 p-4 rounded-xl border border-dark-700 shadow-lg">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {t('hook_quota.title', 'โควต้าข้อความ LINE')}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('hook_quota.note_push_only', 'นับเฉพาะข้อความที่ถูก push (ส่งโดยแอดมิน) · ข้อมูลไม่ realtime')}
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative group w-full sm:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="text-slate-400 group-focus-within:text-primary-500 transition-colors" size={18} />
              </div>
              <input
                type="text"
                placeholder={t('hook_quota.search_placeholder', 'ค้นหา OA...')}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 pr-4 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={loading}
              className="flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{t('common.refresh', 'รีเฟรช')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="bg-dark-800 rounded-xl border border-dark-700 shadow-xl overflow-hidden relative">
        {loading && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-primary-500/80 animate-pulse z-10" />
        )}

        {/* Top Pager */}
        <HookTablePager
          edge="top"
          itemsPerPage={itemsPerPage}
          onItemsPerPage={(n) => {
            setItemsPerPage(n);
            setCurrentPage(1);
          }}
          perPageOptions={PER_PAGE_OPTIONS}
          currentPage={currentPage}
          totalPages={totalPages}
          onPage={setCurrentPage}
          totalLabel={totalLabel}
        />

        {/* Table Body */}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-dark-900 border-b border-dark-700">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                  {t('hook_quota.col_site', 'เว็บ / โดเมน')}
                </th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap min-w-[240px]">
                  {t('hook_quota.col_quota', 'การใช้โควต้า')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700">
              {!loading && hooks.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-12 text-center text-slate-400">
                    {t('hook_quota.no_results', 'ไม่พบผลลัพธ์')}
                  </td>
                </tr>
              ) : (
                hooks.map((hook) => {
                  const quotaState = quotaMap[hook._id];
                  const followersState = followersMap[hook._id];
                  const channel = channelOf(hook.channel_type);

                  return (
                    <tr
                      key={hook._id}
                      className="hover:bg-dark-700/50 transition-colors"
                    >
                      {/* Column 1: เว็บ / โดเมน */}
                      <td className="px-6 py-4 min-w-[200px]">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[240px]"
                              title={hook.company_name || hook.line_oa_name}
                            >
                              {hook.company_name || hook.line_oa_name || '-'}
                            </span>
                            <span
                              className="w-5 h-5 rounded-full bg-[#06C755] text-white text-[8px] font-bold inline-flex items-center justify-center shrink-0 shadow-sm"
                              title={channel.label}
                            >
                              {channel.label}
                            </span>
                          </div>
                          {hook.domain_name && String(hook.domain_name).trim() ? (
                            <a
                              href={
                                /^https?:\/\//i.test(hook.domain_name)
                                  ? hook.domain_name
                                  : `https://${hook.domain_name}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary-500 hover:underline truncate max-w-[240px] inline-flex items-center gap-1 w-fit"
                              title={hook.domain_name}
                            >
                              <ExternalLink size={11} className="shrink-0" />
                              {hook.domain_name}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </div>
                      </td>

                      {/* Column 2: โควต้าข้อความ LINE (Gauge) */}
                      <td className="px-6 py-4 min-w-[240px]">
                        <LineQuotaGauge
                          data={quotaState?.data}
                          loading={quotaState?.loading}
                          error={quotaState?.error}
                          followersData={followersState?.data}
                          followersLoading={followersState?.loading}
                          onRetry={() => {
                            loadQuotaForHook(hook._id, true);
                            loadFollowersForHook(hook._id, true);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Pager */}
        <HookTablePager
          edge="bottom"
          itemsPerPage={itemsPerPage}
          onItemsPerPage={(n) => {
            setItemsPerPage(n);
            setCurrentPage(1);
          }}
          perPageOptions={PER_PAGE_OPTIONS}
          currentPage={currentPage}
          totalPages={totalPages}
          onPage={setCurrentPage}
          totalLabel={totalLabel}
        />
      </div>
    </div>
  );
};

export default LineQuotaTable;
