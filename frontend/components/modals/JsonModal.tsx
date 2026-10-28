import React from 'react';
import { X, Code, Copy, ClipboardCheck } from 'lucide-react';
import { useI18n } from '../../i18n';
import { copyText } from '../../utils/copyText';

interface JsonModalProps {
  isOpen: boolean;
  data: any;
  title?: string;
  onClose: () => void;
}

export const JsonModal: React.FC<JsonModalProps> = ({ isOpen, data, title, onClose }) => {
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-white/45 backdrop-blur-sm transition-opacity animate-fade-in">
      <div 
        className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-3xl transform transition-all scale-100 flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 bg-dark-800">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Code className="text-indigo-500" size={20} />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{title || t('slip.raw_response_title') || 'Raw Data Viewer'}</h3>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 text-slate-600 hover:text-slate-900 transition-all text-xs font-medium border border-dark-600 shadow-sm"
            >
              {copied ? <ClipboardCheck size={14} className="text-emerald-500" /> : <Copy size={14} />}
              {copied ? t('common.copied') || 'Copied!' : t('common.copy_json') || 'Copy JSON'}
            </button>
            <button onClick={onClose} className="p-2 rounded-xl bg-dark-700 hover:bg-dark-600 text-slate-500 hover:text-slate-900 transition-all border border-dark-600">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-auto custom-scrollbar bg-dark-900/30">
           <pre className="text-xs font-mono text-slate-700 leading-relaxed overflow-x-auto p-4 rounded-xl border border-dark-700 bg-dark-800 shadow-inner whitespace-pre overflow-y-visible">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
        
        <div className="px-6 py-3 border-t border-dark-700 bg-dark-800 flex justify-center">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
              Data Visualizer • Pretty Printed Format
            </p>
        </div>
      </div>
    </div>
  );
};
