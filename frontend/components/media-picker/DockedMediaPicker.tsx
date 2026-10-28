// [FEAT-20260905-DOCKPANEL] Docked Media Picker Panel
// Decoupled, independent, and reusable component for side-by-side editing.
// Replaces or complements side panels (e.g., Var Guide in FlexMessageFormModal) without tech debt.
import React, { useState } from 'react';
import {
  Check,
  ExternalLink,
  Maximize2,
  Paperclip,
  Upload,
  X,
} from 'lucide-react';
import type {
  DockedMediaPickerProps,
  MediaPickerAlbumItem,
  MediaPickerMediaItem,
  MediaPickerView,
} from './types';
import { AlbumListView } from './AlbumListView';
import { MediaItemListView } from './MediaItemListView';
import { ConfirmModal } from '../modals/ConfirmModal';
import { useI18n } from '../../i18n';

export const DockedMediaPicker: React.FC<DockedMediaPickerProps> = ({
  onMaximize,
  onClose,
  onSelectMedia,
  title,
  className = '',
}) => {
  const { t } = useI18n();
  const [currentView, setCurrentView] = useState<MediaPickerView>('albums');
  const [selectedAlbum, setSelectedAlbum] = useState<MediaPickerAlbumItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'close' | 'maximize' | null>(null);

  const displayTitle = title || t('media_picker.modal_title');

  const handleSelectAlbum = (album: MediaPickerAlbumItem) => {
    setSelectedAlbum(album);
    setCurrentView('items');
  };

  const handleBackToAlbums = () => {
    setSelectedAlbum(null);
    setCurrentView('albums');
  };

  const handleNotifyCopied = (url: string) => {
    setToastMessage(t('media_picker.copied_toast', { url }));
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleOpenUpload = () => {
    const origin = window.location.origin;
    const pathname = window.location.pathname.endsWith('/')
      ? window.location.pathname
      : `${window.location.pathname}/`;
    const url = `${origin}${pathname}#/object-images`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCloseConfirm = () => {
    // [USER-DIRECTIVE] "มี confirm เสมอ กดแล้วปิด medpickaer panael ไปเลยแล้วแสดง var guide เหมือนเดิม"
    // Use project theme ConfirmModal instead of native window.confirm to avoid tech debt
    setConfirmAction('close');
  };

  const handleMaximizeConfirm = () => {
    // [USER-DIRECTIVE] "ถ้ากดขยาย +confirm เสจเปิด modal; เหมือนเดิม พร้อมแสดง var guide กลับมา"
    // Use project theme ConfirmModal instead of native window.confirm to avoid tech debt
    setConfirmAction('maximize');
  };

  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl flex-1 flex flex-col overflow-hidden shadow-sm max-h-[600px] h-[600px] ${className}`}
    >
      {/* Docked Panel Header - Reusing Modal Theme */}
      <div className="px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60 shrink-0">
            <Paperclip size={16} className="stroke-[2.2]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
              {displayTitle}
            </h3>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 hidden sm:block truncate">
              {t('media_picker.modal_subtitle')}
            </p>
          </div>
        </div>

        {/* Header Actions: Upload More, Maximize, Close */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Upload More button */}
          <button
            type="button"
            onClick={handleOpenUpload}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-xs transition-all cursor-pointer"
            title={t('media_picker.upload_more_tooltip')}
          >
            <Upload size={13} className="stroke-[2.2]" />
            <span className="hidden sm:inline">{t('media_picker.upload_more')}</span>
            <ExternalLink size={11} className="opacity-70 hidden sm:inline" />
          </button>

          {/* Maximize Button */}
          <button
            type="button"
            onClick={handleMaximizeConfirm}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/70 dark:hover:bg-purple-900/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-xs transition-all cursor-pointer"
            title={t('media_picker.maximize_tooltip')}
          >
            <Maximize2 size={13} className="stroke-[2.2]" />
            <span>{t('media_picker.maximize_btn')}</span>
          </button>

          {/* Close Button with Confirm */}
          <button
            type="button"
            onClick={handleCloseConfirm}
            className="p-1.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 hover:text-black dark:text-slate-200 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs transition-all cursor-pointer"
            title={t('pageui.media.close_docked_tip', 'ปิดแผง Media Picker (กลับไป Variable Guide)')}
            aria-label="Close"
          >
            <X size={16} className="stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* Docked Panel Body */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-3.5 bg-slate-50/50 dark:bg-slate-900">
        {/* Toast Alert on link copied */}
        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="mb-2.5 p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between shadow-xs animate-fadeIn shrink-0"
          >
            <div className="flex items-center gap-2 truncate">
              <Check size={14} className="text-emerald-600 shrink-0" />
              <span className="truncate text-[11px]">{toastMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-emerald-500 hover:text-emerald-700 p-0.5"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* View Switcher */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {currentView === 'albums' || !selectedAlbum ? (
            <AlbumListView
              onSelectAlbum={handleSelectAlbum}
              isDocked={true}
              onToast={(msg) => {
                setToastMessage(msg);
                setTimeout(() => setToastMessage(null), 2500);
              }}
            />
          ) : (
            <MediaItemListView
              album={selectedAlbum}
              onBackToAlbums={handleBackToAlbums}
              onSelectMedia={onSelectMedia}
              onNotifyCopied={handleNotifyCopied}
              isDocked={true}
              onToast={(msg) => {
                setToastMessage(msg);
                setTimeout(() => setToastMessage(null), 2500);
              }}
            />
          )}
        </div>
      </div>

      {/* Styled Theme Confirmation Modal (Replaces browser-native window.confirm) */}
      <ConfirmModal
        isOpen={confirmAction !== null}
        type={confirmAction === 'close' ? 'warning' : 'info'}
        title={
          confirmAction === 'close'
            ? t('media_picker.close_docked_title')
            : t('media_picker.maximize_title')
        }
        message={
          confirmAction === 'close'
            ? t('media_picker.close_docked_confirm')
            : t('media_picker.maximize_confirm')
        }
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action === 'close') {
            onClose();
          } else if (action === 'maximize') {
            onMaximize();
          }
        }}
      />
    </div>
  );
};
