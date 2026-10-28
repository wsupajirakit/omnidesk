import React, { useEffect, useState } from 'react';
import { X, Loader2, Info, AlertTriangle, ExternalLink } from 'lucide-react';
import { WebhookLogEntry, HookFollowersResponse } from '../../types';
import { webhookLogService, webhookService } from '../../services/hook';
import { useHookQuota, readQuota, fmt } from '../hook/quota/useHookQuota';
import { useI18n } from '../../i18n';

interface WebhookLogDetailModalProps {
  isOpen: boolean;
  logId?: string;
  onClose: () => void;
}

export const WebhookLogDetailModal: React.FC<WebhookLogDetailModalProps> = ({ isOpen, logId, onClose }) => {
  const { t } = useI18n();
  const [log, setLog] = useState<WebhookLogEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [followersData, setFollowersData] = useState<HookFollowersResponse | null>(null);
  const [followersLoading, setFollowersLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !logId) {
      setLog(null);
      setError(null);
      setFollowersData(null);
      return;
    }

    const fetchLog = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await webhookLogService.getLogDetail(logId);
        setLog(data);
      } catch (err: any) {
        setError(err?.message || t('webhook_log_detail.load_failed'));
      } finally {
        setLoading(false);
      }
    };

    fetchLog();
  }, [isOpen, logId]);

  const rawErrorMessage = log?.data?.error_message || log?.error_message || '';
  const isQuota429 =
    log?.data?.http_status === 429 ||
    log?.http_status === 429 ||
    /429/i.test(rawErrorMessage) ||
    /monthly limit/i.test(rawErrorMessage) ||
    /quota/i.test(rawErrorMessage);

  const hookId = log?.data?.hook_id || log?.hook_id || null;
  const { data: quotaData, loading: quotaLoading } = useHookQuota(hookId, isOpen && !!isQuota429 && !!hookId);
  const q = readQuota(quotaData);
  const hookAlias = log?.data?.hook_alias || log?.hook_alias || '';

  useEffect(() => {
    if (!isOpen || !isQuota429 || !hookId) {
      setFollowersData(null);
      return;
    }

    let isMounted = true;
    setFollowersLoading(true);

    webhookService
      .getHookFollowers(hookId)
      .then((res) => {
        if (isMounted) setFollowersData(res);
      })
      .catch((err) => {
        console.warn('Failed to fetch hook followers insight:', err);
        if (isMounted) setFollowersData(null);
      })
      .finally(() => {
        if (isMounted) setFollowersLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, isQuota429, hookId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/45 backdrop-blur overflow-y-auto">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-700">
          <div className="flex items-center gap-2 text-slate-900 flex-wrap">
            <Info size={20} className="text-primary-400 shrink-0" />
            <h3 className="text-lg font-semibold">{t('webhook_log_detail.title')}</h3>
            {hookAlias && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-500/10 text-primary-700 border border-primary-500/30 dark:bg-primary-950/40 dark:text-primary-300">
                <span className="text-slate-500 dark:text-slate-400 font-normal">Hook (OA):</span>
                <span>{hookAlias}</span>
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
  
          {loading && (
            <div className="flex items-center justify-center py-8 text-slate-500 gap-2">
              <Loader2 size={20} className="animate-spin" />
              <span>Loading...</span>
            </div>
          )}

          {log && !loading && (
            <div className="flex flex-col gap-3 text-sm text-slate-700">
              {rawErrorMessage && (
                <DetailSection label={t('webhook_log_detail.keyword')}>
                  <div className="flex flex-col gap-2.5">
                    <p className="text-sm text-slate-700 whitespace-pre-wrap font-mono text-xs">{rawErrorMessage}</p>
                    
                    {isQuota429 && (
                      <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 dark:bg-amber-950/40 p-3.5 flex flex-col gap-2 text-amber-900 dark:text-amber-200">
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={17} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="flex flex-col gap-1 text-xs">
                            <p className="font-bold text-amber-800 dark:text-amber-300 leading-snug">
                              {t('webhook_log_detail.quota_insufficient')}
                            </p>
                            
                            {followersLoading ? (
                              <div className="flex items-center gap-1.5 text-amber-700/80 dark:text-amber-400/80 mt-1">
                                <Loader2 size={12} className="animate-spin" />
                                <span>Loading targeted reaches...</span>
                              </div>
                            ) : followersData && (followersData.targetedReaches !== null || followersData.followers !== null) ? (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 font-semibold text-amber-950 dark:text-amber-100">
                                {followersData.targetedReaches !== null && (
                                  <span className="inline-flex items-center gap-1 bg-amber-500/20 px-2 py-0.5 rounded-md border border-amber-500/30">
                                    {t('webhook_log_detail.quota_targeted_reaches', {
                                      count: fmt(followersData.targetedReaches),
                                    })}
                                  </span>
                                )}
                                {followersData.followers !== null && (
                                  <span className="text-amber-800 dark:text-amber-300 font-medium">
                                    {t('webhook_log_detail.quota_followers', {
                                      count: fmt(followersData.followers),
                                    })}
                                  </span>
                                )}
                              </div>
                            ) : null}

                            {quotaLoading ? (
                              <div className="flex items-center gap-1.5 text-amber-700/80 dark:text-amber-400/80 mt-1">
                                <Loader2 size={12} className="animate-spin" />
                                <span>{t('webhook_log_detail.quota_loading')}</span>
                              </div>
                            ) : quotaData ? (
                              <div className="flex flex-wrap items-center gap-2 mt-1 font-medium text-amber-900 dark:text-amber-200">
                                <span>
                                  {q.unlimited
                                    ? t('webhook_log_detail.quota_status_unlimited', { used: fmt(q.used) })
                                    : t('webhook_log_detail.quota_status_used', {
                                        used: fmt(q.used),
                                        limit: q.limit !== null ? fmt(q.limit) : '-',
                                        remaining: q.remaining !== null ? fmt(q.remaining) : '0',
                                      })}
                                </span>
                                {q.percent > 0 && !q.unlimited && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                                    {q.percent}%
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </DetailSection>
              )}
              <DetailSection label={t('webhook_log_detail.raw_log')}>
                <JsonViewer data={log} />
              </DetailSection>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const DetailItem: React.FC<{ label: string; value?: string; emphasize?: boolean; multiline?: boolean }> = ({
  label,
  value,
  emphasize,
  multiline
}) => {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p
        className={`text-sm ${emphasize ? 'text-emerald-600 font-semibold' : 'text-slate-700'} ${
          multiline ? 'break-words' : 'truncate'
        }`}
      >
        {value}
      </p>
    </div>
  );
};

const DetailSection: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1 border border-dark-700 rounded-lg bg-dark-900/50 p-3">
    <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
    <div className="text-sm text-slate-700">{children}</div>
  </div>
);

const JsonViewer: React.FC<{ data: Record<string, any> }> = ({ data }) => (
  <pre className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 whitespace-pre-wrap break-words">
    {JSON.stringify(data, null, 2)}
  </pre>
);
