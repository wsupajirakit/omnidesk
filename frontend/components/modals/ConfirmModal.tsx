import React, { useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useI18n } from '../../i18n';
// [UI-20260829-CONFIRMOVERFLOW] the scroll signpost — the same one the broadcast form uses
import { ScrollHint } from '../common/ScrollHint';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  type?: 'danger' | 'warning' | 'info';
  hideCancel?: boolean;
  hideClose?: boolean;
  closeOnConfirm?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  // Distinct action for the cancel button (defaults to onClose when omitted).
  onCancel?: () => void;
  /**
   * [UI-20260825-SENDCONSENT] Extra body under the message.
   *
   * ⚠️ Optional, and renders NOTHING when it is not passed — the same shape as
   *    `Modal.Header`'s `actions` slot. That is what lets one dialog grow a
   *    consent step for the broadcast form while every other caller in the app
   *    keeps its exact markup, which `modalShell*.dom.test.tsx` measures.
   * ⚠️ Not a general escape hatch: a confirm dialog that grows a form is a
   *    different dialog. Use it for something the person must READ or
   *    ACKNOWLEDGE before confirming, nothing else.
   */
  children?: React.ReactNode;
  /**
   * [UI-20260826-DELCONSENT] ล็อกปุ่มยืนยันไว้จนกว่าผู้เรียกจะบอกว่าพร้อม
   *
   * ⚠️ ไม่ส่ง = `undefined` = ปุ่มกดได้เหมือนเดิมทุกประการ ⇒ ผู้เรียกอีก ~20 จุด
   *    ในแอปไม่รู้สึกอะไรเลย (รูปแบบเดียวกับ `children` ด้านบน)
   */
  confirmDisabled?: boolean;
  /**
   * [UI-20260907-CONFIRMBLUETONE] Paint the confirm button BLUE instead of the
   * app's primary green.
   *
   * 🔴 WHY A NEW PROP RATHER THAN CHANGING `type="info"`. The flex gallery's
   *    confirm has to be blue, header and button. `info`
   *    already renders a blue HEADER but a green (`primary-600`) button — and
   *    `type="info"` is passed by roughly a dozen call sites across chat,
   *    member, object, media-picker and flex. Recolouring it would restyle every
   *    one of those screens for a request about one dialog.
   *    ห้ามแก้ 'info' กลาง ๆ เดี๋ยวหน้าอื่นเปลี่ยนตามโดยไม่มีใครสั่ง.
   *
   * ⚠️ Absent = `undefined` = the button is byte-identical to today, so all ~160
   *    call sites are untouched. Same shape as `children` and `confirmDisabled`
   *    above, and for the same reason.
   *
   * ⚠️ Has no effect when `type="danger"` — a destructive action stays red. A
   *    caller asking for a blue "delete" button is asking for the wrong thing.
   *
   * revert: delete this prop and the `blue` branch on the confirm button.
   */
  confirmTone?: 'default' | 'blue';
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({ 
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type = 'danger',
  hideCancel = false,
  hideClose = false,
  closeOnConfirm = true,
  confirmLabel,
  cancelLabel,
  onCancel,
  children,
  confirmDisabled,
  confirmTone = 'default'
}) => {
  const { t } = useI18n();
  /* ⚠️ This hook MUST stay above the early return below. Otherwise the hook
     order differs between the open and the closed render and React breaks. */
  const bodyRef = useRef<HTMLDivElement>(null);
  if (!isOpen) return null;
  const resolvedConfirmLabel = confirmLabel || t('common.confirm');
  const resolvedCancelLabel = cancelLabel || t('common.cancel');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
    >
      <div 
        /* [UI-20260829-CONFIRMOVERFLOW] `max-h-full flex flex-col`
           - `max-h-full` caps the panel at the overlay's content box. The overlay
             already carries `p-4`, so there is always a margin to the screen edge,
             and there is no `calc()`/`vh` unit to get wrong on mobile.
           - Short content (the ~20 ordinary dialogs in the app) is untouched:
             `max-h` does not impose a height, so those panels still size to their
             content and do not move by a single pixel. */
        className="bg-white dark:bg-dark-800 border border-slate-200 dark:border-dark-700 rounded-2xl shadow-2xl w-full max-w-md max-h-full flex flex-col transform transition-all scale-100 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex justify-between items-center p-5 border-b border-slate-100 dark:border-dark-700">
          <h3 className="min-w-0 break-words text-xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <div className={`p-2 rounded-xl ${
              type === 'danger' ? 'bg-red-50 text-red-600' : 
              type === 'warning' ? 'bg-amber-50 text-amber-600' : 
              'bg-blue-50 text-blue-600'
            }`}>
              {(type === 'danger' || type === 'warning') ? <AlertTriangle size={24} /> : <AlertTriangle size={24} />}
            </div>
            {title}
          </h3>
          {!hideClose && (
            <button 
              type="button"
              onClick={onClose} 
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-dark-700 transition-all"
            >
              <X size={20} />
            </button>
          )}
        </div>
        
        {/* [UI-20260829-CONFIRMOVERFLOW] a body that scrolls itself, plus the signpost
            🔴 The real bug: the "close case" dialog with several topics
               (registration / deposit / withdraw = 3 topics x 2 options, each with a
               hint) is taller than the viewport, and the panel was `overflow-hidden`
               with nothing scrollable. **The confirm button ended up off screen**,
               unreachable, with nothing indicating that more content was below.
            ⚠️ The `relative` layer is required: `ScrollHint` positions absolutely.
            ⚠️ `min-h-0` is required in a flex column — without it the box refuses to
               shrink, so it never overflows and the arrow never appears.
            Same pattern as `components/campaign/BroadcastFormModal.tsx:1001`. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollHint targetRef={bodyRef} />
        <div ref={bodyRef} className="p-8 overflow-y-auto custom-scrollbar min-h-0 flex-1">
          {message.split('\n').map((line, index) => (
            <p
              key={`${line}-${index}`}
              /* [UI-20260829-CONFIRMOVERFLOW] `break-words` — long Thai text carries no
                 spaces for the browser to break at, so it pushes the box out to the
                 right instead of wrapping onto a new line. */
              className={`break-words text-base leading-relaxed ${
                index === 0 && message.includes('\n') 
                  ? 'text-slate-900 dark:text-white font-bold mb-2' 
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {line}
            </p>
          ))}
          {/* [UI-20260825-SENDCONSENT] ช่องเสริม — ไม่ส่งมาก็ไม่มีอะไรถูกวาด
              ⇒ ทุก dialog ที่เรียกตัวนี้อยู่เดิม markup ไม่ขยับแม้แต่ตัวเดียว */}
          {children}
        </div>
        </div>
 
        <div className="shrink-0 flex flex-row-reverse items-center gap-3 p-5 border-t border-slate-100 dark:border-dark-700 bg-slate-50/50 dark:bg-dark-900/50">
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() => { onConfirm(); if (closeOnConfirm) onClose(); }}
            className={`flex-1 px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-red-500/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${
              type === 'danger' ? 'bg-red-600 hover:bg-red-500 shadow-red-500/30'
                /* [UI-20260907-CONFIRMBLUETONE] opt-in only — see the prop's note */
                : confirmTone === 'blue' ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/30'
                : 'bg-primary-600 hover:bg-primary-500 shadow-primary-500/30'
            }`}
          >
            {resolvedConfirmLabel}
          </button>
          {!hideCancel && (
            <button
              type="button"
              onClick={() => { if (onCancel) { onCancel(); } else { onClose(); } }}
              className="flex-1 px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-dark-800 border-2 border-slate-200 dark:border-dark-700 hover:border-slate-300 dark:hover:border-dark-600 transition-all"
            >
              {resolvedCancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
