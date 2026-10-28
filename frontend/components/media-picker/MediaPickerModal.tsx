import React, { useState } from 'react';
import { Check, ExternalLink, Film, Image as ImageIcon, Minimize2, Paperclip, Upload, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import type {
  MediaPickerAlbumItem,
  MediaPickerMediaItem,
  MediaPickerModalProps,
  MediaPickerView,
} from './types';
import { AlbumListView } from './AlbumListView';
import { MediaItemListView } from './MediaItemListView';

import { useI18n } from '../../i18n';

export const MediaPickerModal: React.FC<MediaPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectMedia,
  title,
  onDock,
  lockKind,
  selectAction,
  headerActionsRight,
}) => {
  const { t } = useI18n();
  const [currentView, setCurrentView] = useState<MediaPickerView>('albums');
  const [selectedAlbum, setSelectedAlbum] = useState<MediaPickerAlbumItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const displayTitle = title || t('media_picker.modal_title');

  // Reset view when modal is closed
  const handleClose = () => {
    setCurrentView('albums');
    setSelectedAlbum(null);
    setToastMessage(null);
    onClose();
  };

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

  return (
    <Modal
      isOpen={isOpen}
      variant="panel"
      maxWidth="max-w-6xl"
    >
      {/* Modal Header */}
      <Modal.Header
        title={
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
              <Paperclip size={20} className="stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {displayTitle}
              </h2>
              <p className="text-[11px] font-normal text-slate-400">
                {t('media_picker.modal_subtitle')}
              </p>
            </div>
          </div>
        }
        onClose={handleClose}
        actions={
          /* [FIX-20260907-PICKERHEADERRIGHT] `ml-auto` is what pins this beside
             the close button; see the prop's note for why the shared header
             otherwise strands it mid-bar. */
          <div className={`flex items-center gap-2 mr-2 ${headerActionsRight ? 'ml-auto' : ''}`}>
            {/* [FEAT-20260905-UPLOADMORE] Upload more button opening /object-images in a new tab */}
            <button
              type="button"
              onClick={handleOpenUpload}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shadow-xs hover:shadow-sm transition-all cursor-pointer"
              title={t('media_picker.upload_more_tooltip')}
            >
              <Upload size={14} className="stroke-[2.2]" />
              <span>{t('media_picker.upload_more')}</span>
              <ExternalLink size={12} className="opacity-70" />
            </button>

            {/* [FEAT-20260905-DOCKPANEL] Minimize to Side Panel (replaces var guide) */}
            {onDock && (
              <button
                type="button"
                onClick={onDock}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/70 dark:hover:bg-purple-900/80 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-xs hover:shadow-sm transition-all cursor-pointer"
                title={t('media_picker.dock_tooltip')}
              >
                <Minimize2 size={14} className="stroke-[2.2]" />
                <span>{t('media_picker.dock_btn')}</span>
              </button>
            )}
          </div>
        }
      />

      {/* Modal Body */}
      <Modal.Body className="flex-1 min-h-0 overflow-hidden flex flex-col p-5">
        {/* Toast Alert on link copied or density changed */}
        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between shadow-xs animate-fadeIn"
          >
            <div className="flex items-center gap-2 truncate">
              <Check size={16} className="text-emerald-600 shrink-0" />
              <span className="truncate">{toastMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-emerald-500 hover:text-emerald-700 p-1"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* View Switcher */}
        <div className="flex-1 min-h-0 flex flex-col">
          {currentView === 'albums' || !selectedAlbum ? (
            <AlbumListView
              onSelectAlbum={handleSelectAlbum}
              onToast={(msg) => {
                setToastMessage(msg);
                setTimeout(() => setToastMessage(null), 2500);
              }}
            />
          ) : (
            <MediaItemListView
              album={selectedAlbum}
              /* [FEAT-20260907-IMAGEONLYPICKER] straight through; `undefined`
                 means the view behaves exactly as it always has. */
              lockKind={lockKind}
              selectAction={selectAction}
              onBackToAlbums={handleBackToAlbums}
              onSelectMedia={onSelectMedia}
              onNotifyCopied={handleNotifyCopied}
              onToast={(msg) => {
                setToastMessage(msg);
                setTimeout(() => setToastMessage(null), 2500);
              }}
            />
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
};
