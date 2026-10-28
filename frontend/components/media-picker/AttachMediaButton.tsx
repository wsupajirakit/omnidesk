// [FEAT-20260905-MEDIAPICKER] Standalone, reusable [Attach VDO / IMG] button.
// Designed for cross-module reuse (Flex Messages, Broadcasts, Chat, etc.) with zero tech debt.
import React, { useState } from 'react';
import { Film, Image as ImageIcon, Paperclip } from 'lucide-react';
import type { AttachMediaButtonProps, MediaPickerMediaItem } from './types';
import { MediaPickerModal } from './MediaPickerModal';

export interface ExtendedAttachMediaButtonProps extends AttachMediaButtonProps {
  /**
   * Optional custom click handler if the caller prefers to control the modal state externally.
   * If omitted, the button manages its own internal modal state cleanly.
   */
  onClick?: () => void;
  /**
   * Button style variant. Default: 'default'
   */
  variant?: 'default' | 'compact' | 'outline';
  /**
   * Disabled state
   */
  disabled?: boolean;
}

import { useI18n } from '../../i18n';

export const AttachMediaButton: React.FC<ExtendedAttachMediaButtonProps> = ({
  onSelectMedia,
  onClick,
  label,
  className,
  tooltip,
  variant = 'default',
  disabled = false,
  lockKind,
  selectAction,
  headerActionsRight,
}) => {
  const { t } = useI18n();
  const [internalOpen, setInternalOpen] = useState<boolean>(false);

  const displayLabel = label || t('media_picker.attach_btn');
  const displayTooltip = tooltip || t('media_picker.attach_tooltip');

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onClick) {
      onClick();
    } else {
      setInternalOpen(true);
    }
  };

  const handleSelect = (item: MediaPickerMediaItem) => {
    if (onSelectMedia) {
      onSelectMedia(item);
    }
    /* [FEAT-20260907-USETHISIMAGE] In `use` mode the pick IS the whole job — the
       URL is already in the caller's field — so the picker closes behind it.
       In `copy` mode it stays open, because copying several links in a row is
       exactly what that mode is for, and closing would be a behaviour change for
       the flex editor. */
    if (selectAction === 'use') setInternalOpen(false);
  };

  // Base styling variants
  let variantClasses =
    'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-xs';

  if (variant === 'compact') {
    variantClasses =
      'p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700';
  } else if (variant === 'outline') {
    variantClasses =
      'bg-transparent hover:bg-indigo-50/50 text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700';
  }

  const defaultClasses =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={displayTooltip}
        aria-label={displayLabel}
        className={className || `${defaultClasses} ${variantClasses}`}
      >
        <Paperclip size={14} className="shrink-0" />
        <span>{displayLabel}</span>
      </button>

      {/* Internal modal rendered when in uncontrolled mode */}
      {!onClick && internalOpen && (
        <MediaPickerModal
          isOpen={internalOpen}
          onClose={() => setInternalOpen(false)}
          onSelectMedia={handleSelect}
          /* [FEAT-20260907-IMAGEONLYPICKER] forwarded; undefined = as before */
          lockKind={lockKind}
          selectAction={selectAction}
          headerActionsRight={headerActionsRight}
        />
      )}
    </>
  );
};
