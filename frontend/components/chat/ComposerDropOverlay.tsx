import React from 'react';
import { ImagePlus } from 'lucide-react';
import { useI18n } from '../../i18n';
import { withVars } from './i18nVars';

/**
 * ==== [FEAT-20260818-DROPIMAGE] the "drop images here" hint =====================
 *
 * Render-only, props-only (dev-local §6.4): the drag state and the staging both
 * live in TicketChat's ChatInputBox, so this file moves no behaviour.
 *
 * ITS OWN FILE because `pages/chat/TicketChat.tsx` is on the max-lines waiver and
 * that list may only shrink — a new self-contained overlay goes in a file from the
 * start (§6.1) instead of being inlined into the 4,400-line parent.
 *
 * `pointer-events-none` is essential, not cosmetic: an overlay that swallowed
 * pointer events would fire `dragleave` on the box the instant it appeared, so the
 * hint would flicker and the drop would land on the overlay instead of the
 * composer. ห้ามให้ overlay กินอีเวนต์ ไม่งั้นการวางจะไม่เข้ากล่อง.
 *
 * revert: delete this file + the <ComposerDropOverlay/> block in TicketChat.tsx.
 */
const ComposerDropOverlay: React.FC<{
  /** dragging a file over the composer right now */
  active: boolean;
  /** free slots left; 0 never renders because the box stops accepting */
  free: number;
  /** total cap, shown so the operator knows how many more fit */
  max: number;
}> = ({ active, free, max }) => {
  const { t } = useI18n();
  if (!active) return null;
  return (
    <div className="absolute inset-0 z-[110] pointer-events-none rounded-lg border-2 border-dashed border-primary bg-primary-500/10 flex flex-col items-center justify-center gap-1.5">
      <ImagePlus size={26} className="text-primary" />
      <span className="text-sm font-bold text-primary-700">{t('ticketui.drop.here', 'วางรูปที่นี่เพื่อแนบ')}</span>
      <span className="text-[11px] text-primary-700/70">
        {withVars(t('ticketui.drop.free', 'แนบได้อีก {free} รูป (สูงสุด {max})'), { free, max })}
      </span>
    </div>
  );
};

export default ComposerDropOverlay;
