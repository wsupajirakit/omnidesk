import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckSquare, Square } from 'lucide-react';
import { useI18n } from '../../i18n';

interface DoubleConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  // [FEAT-20260805-FLEXTAGRULE] widened to ReactNode so a caller can highlight parts
  // (e.g. green {{ }}). Strings still work — this is backward-compatible.
  checkbox1Label: React.ReactNode;
  checkbox2Label: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const DoubleConfirmModal: React.FC<DoubleConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  checkbox1Label,
  checkbox2Label,
  confirmLabel,
  cancelLabel
}) => {
  const { t } = useI18n();
  const [checked1, setChecked1] = useState(false);
  const [checked2, setChecked2] = useState(false);
  // [FEAT-20260805-FLEXTAGRULE] shake + warn when the user presses confirm without
  // checking both boxes (instead of a silently-disabled button).
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setChecked1(false);
      setChecked2(false);
      setShake(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const canConfirm = checked1 && checked2;
  const handleConfirmClick = () => {
    if (canConfirm) { onConfirm(); return; }
    // force-press with a box unchecked → nudge both boxes + show the notice
    setShake(false);
    requestAnimationFrame(() => setShake(true));
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md transition-all animate-in fade-in duration-300">
      <div 
        className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-md transform transition-all scale-100 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-orange-50/50">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-orange-500 text-white rounded-xl shadow-lg shadow-orange-500/20">
              <AlertTriangle size={20} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 uppercase tracking-tighter">{title}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-6">
          <p className="text-sm text-slate-600 leading-relaxed font-medium">
            {message}
          </p>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => { setChecked1(!checked1); if (!checked1) setShake(false); }}
              className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${
                checked1
                  ? 'bg-orange-50 border-orange-200 text-orange-700 shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
              } ${shake && !checked1 ? 'ring-2 ring-red-400 animate-[shake_0.4s_ease] border-red-300' : ''}`}
            >
              <div className={checked1 ? 'text-orange-600' : (shake && !checked1 ? 'text-red-500' : 'text-slate-300')}>
                {checked1 ? <CheckSquare size={20} /> : <Square size={20} />}
              </div>
              <span className="text-xs font-bold leading-tight">{checkbox1Label}</span>
            </button>

            <button
              type="button"
              onClick={() => { setChecked2(!checked2); if (!checked2) setShake(false); }}
              className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${
                checked2
                  ? 'bg-orange-50 border-orange-200 text-orange-700 shadow-sm'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
              } ${shake && !checked2 ? 'ring-2 ring-red-400 animate-[shake_0.4s_ease] border-red-300' : ''}`}
            >
              <div className={checked2 ? 'text-orange-600' : (shake && !checked2 ? 'text-red-500' : 'text-slate-300')}>
                {checked2 ? <CheckSquare size={20} /> : <Square size={20} />}
              </div>
              <span className="text-xs font-bold leading-tight">{checkbox2Label}</span>
            </button>
          </div>

          {shake && !canConfirm && (
            <p className="text-xs font-bold text-red-600 -mt-2">{t('pageui.common.accept_all_first', 'กรุณายอมรับเงื่อนไขให้ครบก่อนดำเนินการต่อ')}</p>
          )}
        </div>

        <div className="px-6 py-5 border-t border-slate-100 bg-slate-50/50 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-white hover:text-slate-900 transition-all text-xs uppercase"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            onClick={handleConfirmClick}
            className={`flex-1 px-4 py-2.5 rounded-xl font-bold transition-all text-xs uppercase shadow-lg ${
              canConfirm
                ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-orange-500/20'
                : 'bg-slate-300 text-slate-500 hover:bg-slate-400'
            }`}
          >
            {confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
