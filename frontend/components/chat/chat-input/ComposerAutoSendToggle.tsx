/**
 * [LEGACY NOTE - 20260918]
 * ComposerAutoSendToggle was originally designed as a small popover above the composer toolbar
 * to configure `auto_send_translated`. Per user request, the bottom composer "แปลภาษา" button
 * now directly opens the unified 4-step `RoomTranslateModal` (which manages auto_translate,
 * show_original_text, translate_lang, and auto_send_translated together).
 * This component is preserved as a legacy fallback and reference.
 *
 * Dev-local: max-lines < 400, role directory (chat-input/).
 */
import React, { useState, useEffect, useRef, useId } from 'react';
import { Languages, X, Info, ChevronRight, Settings2 } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { chatService, ChatRoom } from '../../../services/chat';
import { TRANSLATE_LANGUAGES } from '../../../config/translateLanguages';

export interface ComposerAutoSendToggleProps {
  isOpen: boolean;
  onClose: () => void;
  room: ChatRoom | null;
  hookId?: string;
  onUpdateSettings?: (settings: { auto_send_translated: boolean }) => Promise<void> | void;
  onOpenRoomSettings?: () => void;
}

export const ComposerAutoSendToggle: React.FC<ComposerAutoSendToggleProps> = ({
  isOpen,
  onClose,
  room,
  hookId,
  onUpdateSettings,
  onOpenRoomSettings,
}) => {
  const { t, isEnglish } = useI18n();
  const toggleId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Optimistic local state for immediate, smooth toggle response
  const [isAutoSend, setIsAutoSend] = useState(Boolean(room?.auto_send_translated));
  const roomId = room ? String(room._id || (room as any).id || '') : '';
  const [liveSettings, setLiveSettings] = useState<{
    translate_lang?: string | null;
    hook_translate_lang?: string | null;
    effective_translate_lang?: string | null;
    auto_send_translated?: boolean;
  } | null>(null);

  useEffect(() => {
    setIsAutoSend(Boolean(room?.auto_send_translated));
  }, [room?.auto_send_translated]);

  // Fetch room translation settings to resolve OA default language (e.g. Khmer)
  useEffect(() => {
    if (!isOpen || !roomId) return;
    let active = true;
    chatService
      .getRoomTranslateSettings(roomId)
      .then((res) => {
        if (active && res?.data) {
          setLiveSettings(res.data);
          if (room) {
            Object.assign(room, res.data);
          }
          if (res.data.auto_send_translated !== undefined) {
            setIsAutoSend(Boolean(res.data.auto_send_translated));
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen, roomId, room]);

  // Listen to cross-component setting updates
  useEffect(() => {
    const handleSettingsUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<{
        roomId?: string;
        hook_translate_lang?: string | null;
        effective_translate_lang?: string | null;
        translate_lang?: string | null;
        auto_send_translated?: boolean;
      }>;
      if (!customEvent.detail?.roomId || customEvent.detail.roomId === roomId) {
        setLiveSettings((prev) => ({ ...prev, ...customEvent.detail }));
        if (room && customEvent.detail) {
          Object.assign(room, customEvent.detail);
        }
        if (customEvent.detail?.auto_send_translated !== undefined) {
          setIsAutoSend(Boolean(customEvent.detail.auto_send_translated));
        }
      }
    };
    window.addEventListener('tc:room-translate-settings-updated', handleSettingsUpdated);
    return () => window.removeEventListener('tc:room-translate-settings-updated', handleSettingsUpdated);
  }, [roomId, room]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, onClose]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleToggle = async () => {
    const nextVal = !isAutoSend;
    setIsAutoSend(nextVal);
    await onUpdateSettings?.({ auto_send_translated: nextVal });
  };

  const currentTranslateLang =
    liveSettings?.translate_lang !== undefined ? liveSettings.translate_lang : room?.translate_lang;
  const isRoomCustomLang = Boolean(currentTranslateLang);
  const explicitLangObj = isRoomCustomLang
    ? TRANSLATE_LANGUAGES.find((l) => l.code === currentTranslateLang)
    : undefined;

  const hookOrEffectiveCode =
    liveSettings?.effective_translate_lang ||
    liveSettings?.hook_translate_lang ||
    (room as any)?.effective_translate_lang ||
    (room as any)?.hook_translate_lang;
  const hookOrEffectiveObj = TRANSLATE_LANGUAGES.find((l) => l.code === hookOrEffectiveCode);

  /* [FEAT-20261022-I18NTICKETEN] English names on the English UI, Thai names otherwise (as before) */
  const nameOf = (l: { nameTh: string; nameEn: string }) => (isEnglish ? l.nameEn : l.nameTh);
  const displayTargetLang = explicitLangObj
    ? `${explicitLangObj.flag} ${nameOf(explicitLangObj)}`
    : `${t('ticketui.composer.follow_oa', 'ตาม LINE OA')} / ${hookOrEffectiveObj ? `${hookOrEffectiveObj.flag} ${nameOf(hookOrEffectiveObj)}` : t('ticketui.composer.thai_lang', 'ภาษาไทย')}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="composer-auto-send-title"
      ref={popoverRef}
      data-testid="composer-auto-send-toggle-card"
      className="absolute bottom-full left-0 mb-2 z-40 w-80 rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 p-4 animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-700/60">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400">
            <Languages size={15} />
          </div>
          <h3 id="composer-auto-send-title" className="text-xs font-bold text-gray-900 dark:text-white">
            {t('composer_auto_send.title', 'แปลและส่งออโต้')}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      <div className="py-3 space-y-3">
        {/* Toggle Switch */}
        <div className="flex items-center justify-between">
          <label htmlFor={toggleId} className="text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
            {t('composer_auto_send.toggle_label', 'เปิดระบบแปลและส่งออโต้')}
          </label>
          <button
            id={toggleId}
            type="button"
            role="switch"
            aria-checked={isAutoSend}
            data-testid="composer-auto-send-switch"
            onClick={handleToggle}
            className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none ${
              isAutoSend ? 'bg-sky-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out mt-0.5 ml-0.5 ${
                isAutoSend ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Room Language Context Badge */}
        <div className="rounded-lg bg-gray-50 dark:bg-gray-750/60 p-2.5 border border-gray-100 dark:border-gray-700/50 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500 dark:text-gray-400">
              {t('composer_auto_send.target_lang_label', 'ภาษาเป้าหมายของห้อง:')}
            </span>
            <span className="font-semibold text-gray-800 dark:text-gray-200">
              {displayTargetLang}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed flex items-start gap-1">
            <Info size={12} className="shrink-0 mt-0.5 text-sky-500" />
            <span>
              {t(
                'composer_auto_send.info_desc',
                'เมื่อเปิดใช้งาน ทุกข้อความที่คุณพิมพ์จะถูกแปลเป็นภาษาของห้องแชทและส่งให้ลูกค้าทันที',
              )}
            </span>
          </p>
        </div>

        {/* Action: Open Room Language Settings */}
        {onOpenRoomSettings && (
          <button
            type="button"
            data-testid="composer-open-room-settings-btn"
            onClick={() => {
              onClose();
              onOpenRoomSettings();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-sky-50/60 hover:bg-sky-100/80 dark:bg-sky-950/30 dark:hover:bg-sky-900/40 border border-sky-100 dark:border-sky-900/40 text-xs font-semibold text-sky-700 dark:text-sky-300 transition-colors cursor-pointer group"
          >
            <span className="flex items-center gap-2">
              <Settings2 size={14} className="text-sky-600 dark:text-sky-400" />
              {t('composer_auto_send.btn_room_settings', 'ตั้งค่าภาษาของห้องแชท')}
            </span>
            <ChevronRight size={14} className="text-sky-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      <div className="pt-2.5 border-t border-gray-100 dark:border-gray-700/60 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          data-testid="composer-auto-send-close-btn"
          className="text-xs font-semibold px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white shadow-xs hover:shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          {t('composer_auto_send.done', 'เสร็จสิ้น')}
        </button>
      </div>
    </div>
  );
};
