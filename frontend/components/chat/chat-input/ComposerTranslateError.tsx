import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useI18n } from '../../../i18n';

interface ComposerTranslateErrorProps {
  errorMsg?: string | null;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Default 30,000 (30s) */
  autoDismissMs?: number;
}

/**
 * [FEAT-20260918-PHASE3] ComposerTranslateError
 * ===========================================================================
 * Beautiful error alert banner displayed above composer textarea when translation fails.
 * - Displays alert icon and actionable guidance:
 *   "ตรวจสอบ AI แปลภาษาอีกครั้ง หากต้องการส่งข้อความทันที (ในระหว่างแก้ไข AI) ให้ทำการปิดการแปลออโต้ และส่งข้อความด้วยวิธีการปกติ (เช่น ใช้ google translate ช่วยแปล)"
 * - Auto-dismisses after 30 seconds.
 * - Dismissible manually via 'x' button.
 * - Full TH/EN localization.
 */
export const ComposerTranslateError: React.FC<ComposerTranslateErrorProps> = ({
  errorMsg,
  onDismiss,
  autoDismissMs = 30000,
}) => {
  const { t } = useI18n();

  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [onDismiss, autoDismissMs]);

  return (
    <div
      role="alert"
      data-testid="composer-translate-error-banner"
      className="mb-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 shrink-0 mt-0.5">
            <AlertTriangle size={14} />
          </div>
          <div className="text-xs text-rose-800 dark:text-rose-200 leading-relaxed break-words space-y-1">
            <p className="font-semibold">
              {t(
                'chat_input.auto_send_error_msg',
                'ตรวจสอบ AI แปลภาษาอีกครั้ง หากต้องการส่งข้อความทันที (ในระหว่างแก้ไข AI) ให้ทำการปิดการแปลออโต้ และส่งข้อความด้วยวิธีการปกติ (เช่น ใช้ google translate ช่วยแปล)',
              )}
            </p>
            {errorMsg && errorMsg.trim() !== '' && (
              <p className="text-[11px] text-rose-600/90 dark:text-rose-400/90 font-mono break-all">
                {errorMsg}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss translation error"
          className="shrink-0 p-1 text-rose-400 hover:text-rose-700 dark:hover:text-rose-200 rounded-md hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default ComposerTranslateError;
