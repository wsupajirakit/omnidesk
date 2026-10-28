import React, { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useI18n } from '../../i18n';

interface BubbleTranslateErrorProps {
  errorMsg?: string;
  onDismiss: () => void;
  /** Auto dismiss delay in ms. Default 30,000 (30s) */
  autoDismissMs?: number;
}

/**
 * [FEAT-20260918-PHASE3] BubbleTranslateError
 * ===========================================================================
 * Error badge rendered beside/below a message bubble when translation fails.
 * - Soft red/rose background with alert icon.
 * - Text: "ตรวจสอบ AI แปลภาษาอีกครั้ง" (Please check AI translation settings again).
 * - Wraps gracefully to prevent overflowing the chat timeline.
 * - Auto-dismisses in 30 seconds via self-cleaning timer.
 * - Has an 'x' button for instant manual dismissal.
 */
export const BubbleTranslateError: React.FC<BubbleTranslateErrorProps> = ({
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
      data-testid="bubble-translate-error"
      className="mt-1 flex items-start gap-1.5 p-1.5 px-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-[11px] leading-tight max-w-xs sm:max-w-sm w-fit animate-in fade-in duration-200"
      role="alert"
    >
      <AlertCircle size={13} className="shrink-0 mt-0.5 text-rose-500" />
      <div className="flex-1 break-words">
        <span className="font-semibold">
          {t('chat_room.translate_error_title', 'ตรวจสอบ AI แปลภาษาอีกครั้ง')}
        </span>
        {errorMsg && errorMsg.trim() !== '' && (
          <span className="block text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-0.5 break-all">
            {errorMsg}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss translation error"
        className="shrink-0 p-0.5 text-rose-400 hover:text-rose-600 dark:hover:text-rose-200 rounded hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors ml-1"
      >
        <X size={12} />
      </button>
    </div>
  );
};

export default BubbleTranslateError;
