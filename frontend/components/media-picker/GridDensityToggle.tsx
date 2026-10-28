// [FEAT-20260905-DENSITY-TOGGLE] Single Animated Grid Density Toggle Button with Toast
import React, { useState } from 'react';
import { Grid2x2, Grid3x3, LayoutGrid } from 'lucide-react';
import type { MediaPickerGridDensity } from './types';
import { useI18n } from '../../i18n';

export interface GridDensityToggleProps {
  density: MediaPickerGridDensity;
  onChange: (nextDensity: MediaPickerGridDensity) => void;
  onToast?: (message: string) => void;
  className?: string;
}

const DENSITY_CYCLE: Record<MediaPickerGridDensity, MediaPickerGridDensity> = {
  '4x2': '6x2',
  '6x2': '2x2',
  '2x2': '4x2',
};

export const GridDensityToggle: React.FC<GridDensityToggleProps> = ({
  density,
  onChange,
  onToast,
  className = '',
}) => {
  const { t } = useI18n();
  const [isAnimating, setIsAnimating] = useState(false);

  const handleToggle = () => {
    const next = DENSITY_CYCLE[density] || '4x2';
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 400);

    onChange(next);

    const toastMsg = t('media_picker.density_toast', { density: next });
    if (onToast) {
      onToast(toastMsg);
    }
  };

  const renderIcon = () => {
    const iconClass = `text-indigo-600 dark:text-indigo-400 stroke-[2.2] transition-transform duration-300 ${
      isAnimating ? 'rotate-180 scale-110' : ''
    }`;

    switch (density) {
      case '2x2':
        return <Grid2x2 size={15} className={iconClass} />;
      case '6x2':
        return <Grid3x3 size={15} className={iconClass} />;
      case '4x2':
      default:
        return <LayoutGrid size={15} className={iconClass} />;
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={t('media_picker.density_btn_aria', { density })}
      title={t('media_picker.density_toggle_tooltip')}
      className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-bold rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs transition-all cursor-pointer active:scale-95 shrink-0 select-none ${className}`}
    >
      {renderIcon()}
      <span className="font-bold text-indigo-600 dark:text-indigo-400">{density}</span>
    </button>
  );
};
