import React, { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useI18n } from '../../i18n';

export interface ToastItem {
  id: string;
  hook_name: string;
  ts: number;
}

interface Props {
  toast: ToastItem | null;
  onDismiss: () => void;
}

/**
 * [FIX-20260829-NOTICARDHIDDEN] noti card hidden — owner 29/08.
 * ===========================================================================
 * The card is hidden, NOT deleted: the component below, its 5s auto-dismiss and
 * the caller in `App.tsx` are all left exactly as they were, so bringing it back
 * is this one flag. Kept switchable on purpose — the owner asked for it to stay
 * ready in case they want it later.
 *
 * ⚠️ BEFORE TURNING THIS BACK ON, GIVE IT A CORNER. `ToastCard` carries no
 *    `fixed` and no `absolute` — only `flex items-center gap-3 …` — so it lands
 *    in normal flow at the bottom-left of the page and pushes real layout around
 *    instead of floating over it. That is the behaviour that got it hidden. The
 *    other toasts in this app do it properly, e.g. `TicketSupport.tsx` uses
 *    `fixed bottom-5 right-5 … z-50`; copy that shape onto the wrapper.
 *
 * Locked by `test/ticketToastHidden.dom.test.tsx`.
 * revert: flip this to `true` (and read the warning above first).
 */
export const TICKET_TOAST_ENABLED = false;

export const TicketToast: React.FC<Props> = ({ toast, onDismiss }) => {
  if (!TICKET_TOAST_ENABLED) return null;
  if (!toast) return null;
  return <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />;
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setVisible(false);
    fadeRef.current = setTimeout(() => onDismiss(), 300);
  };

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    timerRef.current = setTimeout(() => dismiss(), 5000);
    return () => {
      cancelAnimationFrame(frame);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeRef.current) clearTimeout(fadeRef.current);
    };
  }, []);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border border-dark-600 bg-dark-800 text-white min-w-[240px] max-w-[300px] transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
        <Bell size={15} className="text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-emerald-400 mb-0.5">{t('ticketui.toast.new_ticket', 'Ticket ใหม่')}</p>
        <p className="text-sm font-medium text-white truncate">
          {toast.hook_name || t('ticketui.toast.new_work', 'มีงานเข้าใหม่')}
        </p>
      </div>
      <button
        onClick={dismiss}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-dark-700 text-slate-500 hover:text-slate-300 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
};
