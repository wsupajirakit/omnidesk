/**
 * [FEAT-20260816-MULTIIMG] The staged-images tray above the ticket composer —
 * up to 5 thumbnails, each removable, each zoomable.
 *
 * Props-only on purpose (dev-local §6.4): the staging STATE stays inside
 * TicketChat's ChatInputBox, which owns the send; this file only renders.
 * Extracted as its own component from day one (§6.1) because TicketChat.tsx is
 * on the max-lines waiver — shrink-only.
 *
 * revert: delete this file and the <PendingImagesTray .../> block in
 * TicketChat.tsx (the single-thumbnail markup it replaced lives in git at
 * FE dev 6dc93cf, TicketChat.tsx:3746-3775).
 */
import React from 'react';
import { useI18n } from '../../i18n';
import { withVars } from './i18nVars';

export interface PendingImageItem {
  url: string;
}

const PendingImagesTray: React.FC<{
  items: PendingImageItem[];
  max: number;
  onRemove: (index: number) => void;
  onPreview: (url: string) => void;
}> = ({ items, max, onRemove, onPreview }) => {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="px-3 pt-2 flex items-end gap-2 flex-wrap">
      {items.map((it, i) => (
        <div key={it.url} className="relative inline-block group">
          <img
            src={it.url}
            alt={withVars(t('ticketui.tray.image_n', 'แนบรูปที่ {n}'), { n: i + 1 })}
            className="h-20 w-20 object-cover rounded-lg border border-gray-200 shadow-sm cursor-zoom-in"
            onClick={() => onPreview(it.url)}
          />
          <button
            type="button"
            aria-label={withVars(t('ticketui.tray.remove_n', 'ลบรูปที่ {n}'), { n: i + 1 })}
            onClick={() => onRemove(i)}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gray-800 text-white text-[10px] leading-none flex items-center justify-center shadow hover:bg-red-600"
          >
            ✕
          </button>
        </div>
      ))}
      <span className="ml-1 mb-1 text-[10px] text-gray-400">
        {items.length}/{max} · {withVars(t('ticketui.tray.hint', 'ส่งรูปพร้อมข้อความได้ · สูงสุด {max} รูป'), { max })}
      </span>
    </div>
  );
};

export default PendingImagesTray;
