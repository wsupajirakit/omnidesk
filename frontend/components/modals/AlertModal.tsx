import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X, ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string | React.ReactNode;
  type?: 'success' | 'error' | 'info' | 'warning';
}

export const AlertModal: React.FC<AlertModalProps> = ({ 
  isOpen, onClose, title, message, type = 'success' 
}) => {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);

  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollHeight, clientHeight, scrollTop } = scrollRef.current;
      const hasSpace = scrollHeight > clientHeight + 5; // buffer
      setCanScroll(hasSpace);
      setIsAtBottom(scrollTop + clientHeight >= scrollHeight - 20); // buffer
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Check after small delay to let content render
      const timer = setTimeout(checkScroll, 100);
      window.addEventListener('resize', checkScroll);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, [isOpen, message]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-opacity">
      <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-xl transform transition-all scale-100 animation-fade-in overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-5 border-b border-dark-700 bg-dark-900/50">
          <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            {type === 'success' ? (
              <CheckCircle className="text-emerald-500" size={26} />
            ) : type === 'info' ? (
              <Info className="text-blue-500" size={26} />
            ) : type === 'warning' ? (
              <AlertCircle className="text-orange-500" size={26} />
            ) : (
              <AlertCircle className="text-red-500" size={26} />
            )}
            {title}
          </h3>
          <button 
            onClick={onClose} 
            className="p-2 rounded-xl bg-dark-700 text-slate-400 hover:text-slate-900 hover:bg-dark-600 transition-all border border-dark-600 shadow-sm"
            title={t('common.close') || 'Close'}
          >
            <X size={24} />
          </button>
        </div>
        
        <div 
          ref={scrollRef}
          onScroll={checkScroll}
          className="p-6 overflow-y-auto custom-scrollbar relative flex-1"
        >
          <div className={`whitespace-pre-wrap leading-relaxed pb-6 ${
            type === 'success' ? 'text-slate-600' :
            type === 'warning' ? 'text-orange-600 font-medium' :
            type === 'error' ? 'text-red-600 font-medium' :
            'text-slate-600'
          }`}>{message}</div>
          
          {/* Animated Scroll Indicator - Only visible if content is long and not at bottom */}
          {canScroll && !isAtBottom && (
            <div className="sticky bottom-0 left-0 right-0 pointer-events-none flex justify-center pb-2 pt-12 bg-gradient-to-t from-dark-800 via-dark-800/80 to-transparent transition-opacity duration-300">
              <div className="flex flex-col items-center gap-1 animate-bounce">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-dark-900/50 px-2 rounded">Scroll</span>
                <div className="p-1 rounded-full bg-primary-500/10 border border-primary-500/20 shadow-lg shadow-primary-500/20">
                  <ChevronDown className="text-primary-500" size={20} />
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-dark-700 bg-dark-800/50 flex justify-end">
          <button
            onClick={onClose}
            className={`px-6 py-2 rounded-xl text-sm font-bold shadow-lg transition-all ${
              type === 'success' ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20' :
              type === 'info' ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20' :
              type === 'warning' ? 'bg-orange-600 hover:bg-orange-500 text-white shadow-orange-500/20' :
              'bg-red-600 hover:bg-red-500 text-white shadow-red-500/20'
            }`}
          >
            {t('common.close') || 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
