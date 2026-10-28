import React, { useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from 'lucide-react';
import { useI18n } from '../../i18n';

interface ImageZoomModalProps {
  isOpen: boolean;
  imageUrl: string;
  onClose: () => void;
}

export const ImageZoomModal: React.FC<ImageZoomModalProps> = ({ isOpen, imageUrl, onClose }) => {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  if (!isOpen) return null;

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.25, 4));
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.25, 0.25));
  const handleReset = () => {
    setScale(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm transition-opacity animate-fade-in">
      <div 
        className="relative bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 bg-dark-800 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-500/10 rounded-lg">
              <Maximize2 className="text-primary-500" size={20} />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{t('slip.zoom_image_title') || 'Slip Image Preview'}</h3>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex items-center bg-dark-900/50 rounded-xl p-1 border border-dark-700">
              <button 
                onClick={handleZoomOut}
                className="p-2 rounded-lg hover:bg-dark-700 text-slate-500 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={20} />
              </button>
              <div className="w-12 text-center text-xs font-mono text-slate-500">
                {Math.round(scale * 100)}%
              </div>
              <button 
                onClick={handleZoomIn}
                className="p-2 rounded-lg hover:bg-dark-700 text-slate-500 transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={20} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={handleRotate}
                className="p-2 rounded-lg hover:bg-dark-700 text-slate-500 transition-colors"
                title="Rotate"
              >
                <RotateCcw size={20} />
              </button>
              <button 
                onClick={handleReset}
                className="hidden sm:block px-4 py-2 rounded-lg hover:bg-dark-700 text-slate-600 text-sm font-medium transition-colors border border-dark-600"
              >
                {t('common.reset') || 'Reset'}
              </button>
            </div>

            <div className="w-px h-6 bg-dark-700 mx-1"></div>
            
            <button 
              onClick={onClose} 
              className="p-2 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/10"
              title={t('common.close') || 'Close'}
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 sm:p-12 flex items-center justify-center bg-[#0a0f1e] custom-scrollbar selection:bg-none">
          <div 
            className="transition-transform duration-200 ease-out"
            style={{ 
              transform: `scale(${scale}) rotate(${rotation}deg)`,
              transformOrigin: 'center center'
            }}
          >
            <img 
              src={imageUrl} 
              alt="Slip" 
              className="max-w-full h-auto rounded-lg shadow-[0_0_50px_rgba(0,0,0,0.5)] select-none pointer-events-none border border-white/5"
              style={{ maxHeight: '75vh' }}
            />
          </div>
        </div>

        {/* Footer info (optional) */}
        <div className="bg-dark-800/80 backdrop-blur-md px-6 py-3 border-t border-dark-700 flex justify-center">
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-medium">
              Image Viewer • Use controls to zoom and rotate
            </p>
        </div>
      </div>
    </div>
  );
};
