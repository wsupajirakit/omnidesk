/**
 * [FEAT-20260918-ROOMTRANS] Room Translation Header Button & Settings Popover
 * ============================================================================
 * WHAT: Control cluster placed to the left of `Aa` (font scale):
 *   1. "แปลภาษาออโต้" button: Reads latest message in chat and requests translation.
 *   2. Settings trigger & popover:
 *      - `translate_lang`: Target translation language for this room.
 *      - `show_original_text`: Whether to show original text alongside translation.
 *      - `auto_translate`: Whether auto-translate is active for this room.
 *
 * Placed in `components/chat/room-header/parts/` to preserve HeaderActions and
 * RoomHeader under the 400-line ratchet ceiling (dev-local §6.1, §6.2, §7).
 * revert: delete this file and remove its mount in HeaderActions.tsx.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Loader2 } from 'lucide-react';
import type { ChatRoom } from '../../../../../services/chat';
import { TRANSLATE_LANGUAGES, asTranslateLanguage } from '../../../../../config/translateLanguages';
import { useI18n } from '../../../../../i18n';
/* [FEAT-20260919-SHOWORIGSRC] the shared rule — same one the modal and the
   bubbles use, so this popover cannot disagree with them. */
import { resolveShowOriginalText } from '../../../../../services/chat/showOriginalText';

export interface RoomTranslateSettingsPopoverProps {
  room: ChatRoom | null;
  onTranslateLatest?: () => void;
  isTranslating?: boolean;
  onUpdateRoomSettings?: (settings: {
    translate_lang?: string | null;
    show_original_text?: boolean;
    show_original_text_source?: 'all_rooms' | 'room';
    auto_translate?: boolean;
  }) => Promise<void> | void;
}

export const RoomTranslateSettingsPopover: React.FC<RoomTranslateSettingsPopoverProps> = ({
  room,
  onTranslateLatest,
  isTranslating = false,
  onUpdateRoomSettings,
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const currentLang = room?.translate_lang ?? null;
  /* [FEAT-20260919-SHOWORIGSRC] The box shows what the operator WILL SEE, not the
     room's stored boolean — since 19/09 that boolean only counts when the room's
     `show_original_text_source` says `'room'`, so rendering it raw would tick a
     box for a room that is following the account-wide setting and showing
     nothing. Ticking it takes ownership: the write below sets the source at the
     same time, which is the only reading of a per-room checkbox that is always
     true. ติ๊กที่นี่ = ห้องนี้ขอตัดสินเอง */
  const showOriginal = resolveShowOriginalText({
    source: (room as any)?.show_original_text_source,
    roomValue: room?.show_original_text,
  });
  const autoTranslate = room?.auto_translate ?? false;

  return (
    <div className="relative inline-flex items-center" ref={popoverRef}>
      <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white shadow-xs overflow-hidden">
        {/* Main action button: Translate latest message */}
        <button
          type="button"
          onClick={() => {
            if (!isTranslating && onTranslateLatest) {
              onTranslateLatest();
            }
          }}
          disabled={isTranslating}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-60"
          title={t('chat_header.auto_translate')}
          aria-label={t('chat_header.auto_translate')}
        >
          {isTranslating ? (
            <Loader2 size={14} className="animate-spin text-blue-600" />
          ) : (
            <Languages size={14} />
          )}
          <span>{t('chat_header.auto_translate')}</span>
        </button>

        {/* Popover trigger chevron */}
        {onUpdateRoomSettings && (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className={`px-1.5 py-1.5 border-l border-gray-200 text-slate-400 hover:text-slate-700 hover:bg-gray-50 transition-colors cursor-pointer ${
              open ? 'bg-gray-100 text-slate-700' : ''
            }`}
            title={t('chat_header.translate_settings')}
            aria-label={t('chat_header.translate_settings')}
          >
            <ChevronDown size={13} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Popover Panel */}
      {open && onUpdateRoomSettings && (
        <div
          className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-3.5 z-50 text-xs flex flex-col gap-3 animation-fade-in"
          role="dialog"
          aria-label={t('chat_header.translate_settings')}
        >
          <div className="font-bold text-slate-700 border-b border-slate-100 pb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Languages size={14} className="text-blue-600" />
              {t('chat_header.translate_settings')}
            </span>
          </div>

          {/* Target language */}
          <div>
            <label className="block text-slate-600 font-medium mb-1">
              {t('chat_header.translate_lang')}
            </label>
            <select
              value={currentLang || ''}
              onChange={(e) => {
                const val = asTranslateLanguage(e.target.value);
                onUpdateRoomSettings({ translate_lang: val });
              }}
              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-hidden focus:border-blue-500"
            >
              <option value="">{t('chat_header.translate_lang_default')}</option>
              {TRANSLATE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {t(l.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Show original text toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => {
                /* Both fields, one write: a room cannot express "show the
                   original" without also claiming the decision, or the value
                   would be stored and never read. */
                onUpdateRoomSettings({
                  show_original_text: e.target.checked,
                  show_original_text_source: 'room',
                });
              }}
              className="accent-blue-600 rounded w-4 h-4 cursor-pointer"
            />
            <div className="flex flex-col">
              <span className="font-medium text-slate-700">
                {t('chat_header.show_original_text')}
              </span>
              <span className="text-[10px] text-slate-400">
                {t('chat_header.show_original_text_hint')}
              </span>
            </div>
          </label>

          {/* Auto translate toggle for this room */}
          <label className="flex items-center gap-2 cursor-pointer select-none border-t border-slate-100 pt-2">
            <input
              type="checkbox"
              checked={autoTranslate}
              onChange={(e) => {
                onUpdateRoomSettings({ auto_translate: e.target.checked });
              }}
              className="accent-blue-600 rounded w-4 h-4 cursor-pointer"
            />
            <div className="flex flex-col">
              <span className="font-medium text-slate-700">
                {t('chat_header.auto_translate_toggle')}
              </span>
              <span className="text-[10px] text-slate-400">
                {t('chat_header.auto_translate_desc')}
              </span>
            </div>
          </label>
        </div>
      )}
    </div>
  );
};
