import React from 'react';
import { X } from 'lucide-react';

interface StrikeRestrictedPopoverProps {
  show: boolean;
  text: string;
  manageText?: string;
  closeText?: string;
  onDismiss: () => void;
  onManage?: () => void;
}

/**
 * Speech-bubble popover positioned next to / below the restricted user's avatar.
 * Features:
 * - Prominent red badge/bubble (+25% size) with pointer arrow towards avatar.
 * - Manage button with solid white background (both light and dark theme) and red bold text.
 * - Close button with both '✕' icon and 'ปิด' / 'Close' text.
 * - High z-index to overlay header content properly.
 */
export const StrikeRestrictedPopover: React.FC<StrikeRestrictedPopoverProps> = ({
  show,
  text,
  manageText = 'จัดการ',
  closeText = 'ปิด',
  onDismiss,
  onManage,
}) => {
  if (!show) return null;

  return (
    <div
      data-testid="strike-restricted-popover"
      className="absolute left-0 top-[calc(100%+12px)] z-40 select-none pointer-events-auto max-w-[280px] sm:max-w-[340px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Speech bubble beak / arrow pointing up towards avatar */}
      <div className="absolute -top-2 left-6 h-4 w-4 rotate-45 bg-gradient-to-tl from-rose-600 to-red-600 border-t border-l border-rose-400 shadow-md" />

      {/* Main bubble with prominent static/pulsing glow */}
      <div className="relative flex flex-col gap-2 rounded-2xl bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 p-3 text-white shadow-[0_0_25px_6px_rgba(225,29,72,0.6),0_10px_25px_-5px_rgba(0,0,0,0.5)] border border-rose-300/80">
        <div className="text-[13px] sm:text-[14px] font-extrabold tracking-wide drop-shadow-md leading-snug">
          {text}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/20">
          {onManage && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
                onManage();
              }}
              /* Solid white background with !important fallback to resist dark theme overrides */
              className="flex items-center justify-center px-3 py-1 rounded-lg !bg-white !text-rose-600 hover:!bg-rose-50 text-xs font-black tracking-wide transition-all hover:scale-105 active:scale-95 shadow-md cursor-pointer"
              title={manageText}
            >
              {manageText}
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg !bg-black/25 hover:!bg-black/40 !text-white text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer shrink-0 shadow-sm border border-white/20"
            title={closeText}
            aria-label={closeText}
          >
            <X size={12} strokeWidth={3} />
            <span>{closeText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default StrikeRestrictedPopover;
