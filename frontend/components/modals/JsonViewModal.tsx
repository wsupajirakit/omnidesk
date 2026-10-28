import React from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useI18n } from '../../i18n';
import { copyText } from '../../utils/copyText';

interface JsonViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  data: any;
}

export const JsonViewModal: React.FC<JsonViewModalProps> = ({ isOpen, onClose, title, data }) => {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  /* [FIX-20260830-COPYHTTP2] `utils/copyText`, never `navigator.clipboard`
     directly: the Clipboard API exists only in a SECURE CONTEXT, and this
     dashboard is served over plain http — the call was a silent no-op while
     the success UI fired anyway. copyText falls back to execCommand and
     returns whether the copy really happened. */
  const handleCopy = async () => {
    if (!(await copyText(JSON.stringify(data, null, 2)))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-all duration-300">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-dark-700 text-slate-600 hover:text-primary-500 hover:bg-dark-600 transition-all flex items-center gap-2 text-xs font-medium"
              title="Copy JSON"
            >
              {copied ? (
                <>
                  <Check size={16} className="text-emerald-500" />
                  <span className="text-emerald-500">{t('common.copied')}</span>
                </>
              ) : (
                <>
                  <Copy size={16} />
                  <span>{t('common.copy')}</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-dark-700 transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 bg-dark-900/50 custom-scrollbar">
          <pre className="text-[13px] font-mono text-emerald-400 bg-dark-950 p-6 rounded-xl border border-dark-700 shadow-inner leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>

        <div className="px-6 py-4 border-t border-dark-700 bg-dark-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-sm shadow-lg shadow-primary-500/20 transform hover:scale-[1.02] active:scale-95 transition-all"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
