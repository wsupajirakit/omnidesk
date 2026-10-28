import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { HookQuotaResponse, HookFollowersResponse } from '../../../../types';
import { readQuota, fmt } from '../useHookQuota';
import { useI18n } from '../../../../i18n';

/**
 * ==== [FEAT-20260917-LINEQUOTAGAUGE] LINE OA message quota gauge cell =====
 *
 * Rules:
 * - percent <= 90% -> bg-blue-500 (sky/blue)
 * - percent > 90% -> bg-rose-500 (red)
 * - unlimited -> "ไม่จำกัด" (no percentage bar)
 * - followers -> "(ผู้ติดตามที่ยัง active: xxxx)"
 * - Dark mode compliant with clear contrast
 */

interface Props {
  data?: HookQuotaResponse | null;
  loading?: boolean;
  error?: string | null;
  followersData?: HookFollowersResponse | null;
  followersLoading?: boolean;
  onRetry?: () => void;
}

export const LineQuotaGauge: React.FC<Props> = ({
  data,
  loading = false,
  error = null,
  followersData,
  followersLoading = false,
  onRetry,
}) => {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex flex-col gap-1.5 py-1 min-w-[160px] max-w-[240px]">
        <div className="flex justify-between items-center text-xs text-slate-400 dark:text-slate-400">
          <span className="animate-pulse">{t('hook_quota.loading', 'กำลังโหลดโควต้า...')}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full w-1/3 bg-slate-300 dark:bg-slate-600 rounded-full animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs">
        <span className="text-rose-500 font-medium" title={error}>
          {t('hook_quota.error', 'โหลดไม่สำเร็จ')}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={t('common.retry', 'ลองใหม่')}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
    );
  }

  if (!data) {
    return <span className="text-xs text-slate-400">-</span>;
  }

  const q = readQuota(data);

  if (q.unlimited) {
    return (
      <div className="flex flex-col gap-0.5 py-1 min-w-[140px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            {t('hook_quota.unlimited', 'ไม่จำกัด')}
          </span>
          {followersLoading ? (
            <span className="text-[10px] text-slate-400 animate-pulse">...</span>
          ) : followersData?.targetedReaches !== null && followersData?.targetedReaches !== undefined ? (
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              ({t('hook_quota.active_followers', { count: fmt(followersData.targetedReaches) })})
            </span>
          ) : followersData?.followers !== null && followersData?.followers !== undefined ? (
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              ({t('hook_quota.active_followers', { count: fmt(followersData.followers) })})
            </span>
          ) : null}
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {fmt(q.used)} {t('hook_quota.sent_this_month', 'ข้อความส่งเดือนนี้')}
        </span>
      </div>
    );
  }

  const isDanger = q.percent > 90;

  return (
    <div className="flex flex-col gap-1 py-1 min-w-[160px] max-w-[280px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
          {fmt(q.used)}
          <span className="font-normal text-slate-500 dark:text-slate-400">
            /{q.limit === null ? '-' : fmt(q.limit)}
          </span>
          <span className="ml-1 text-[10px] font-normal text-slate-400">
            {t('hook_quota.used_label', 'ใช้ไปแล้ว')}
          </span>
        </span>
        <span
          className={`shrink-0 text-xs font-semibold ${
            isDanger
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-slate-700 dark:text-slate-300'
          }`}
        >
          {q.remaining === null ? '-' : `${t('hook_quota.remaining_label', 'เหลือ')} ${fmt(q.remaining)}`}
        </span>
      </div>

      <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isDanger ? 'bg-rose-500' : 'bg-blue-500'
          }`}
          style={{ width: `${q.percent}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        {followersLoading ? (
          <span className="text-[10px] text-slate-400 animate-pulse">
            {t('hook_quota.loading', 'กำลังโหลด...')}
          </span>
        ) : followersData?.targetedReaches !== null && followersData?.targetedReaches !== undefined ? (
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate" title={`${followersData.targetedReaches}`}>
            ({t('hook_quota.active_followers', { count: fmt(followersData.targetedReaches) })})
          </span>
        ) : followersData?.followers !== null && followersData?.followers !== undefined ? (
          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate" title={`${followersData.followers}`}>
            ({t('hook_quota.active_followers', { count: fmt(followersData.followers) })})
          </span>
        ) : (
          <span />
        )}
        <span
          className={`text-[10px] font-bold shrink-0 ${
            isDanger
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {q.percent}%
        </span>
      </div>
    </div>
  );
};

export default LineQuotaGauge;
