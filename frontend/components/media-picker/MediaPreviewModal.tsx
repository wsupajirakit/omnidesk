// [FEAT-20260905-MEDIAPICKER] High-res Lightbox and interactive Video Player modal.
// Inherits standard theme Modal from components/common/Modal without creating technical debt.
import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Film } from 'lucide-react';
import type { MediaPickerMediaItem } from './types';
import {
  copyMediaLinkToClipboard,
  formatFileSize,
  formatMediaDate,
  resolveAbsoluteMediaUrl,
} from './mediaPickerUtils';
import { Modal } from '../common/Modal';
import { useI18n } from '../../i18n';

export interface MediaPreviewModalProps {
  item: MediaPickerMediaItem | null;
  onClose: () => void;
  onCopySuccess?: (url: string) => void;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  item,
  onClose,
  onCopySuccess,
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const isVideo = item?.media_kind === 'video';
  const fullUrl = item ? resolveAbsoluteMediaUrl(item.image_url) : '';

  // Attempt autoplay on open with fallback for browser autoplay policies
  React.useEffect(() => {
    setMediaError(false);
    if (isVideo && videoRef.current) {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // If blocked by browser sound policy, mute and retry playing
          if (videoRef.current) {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          }
        });
      }
    }
  }, [isVideo, fullUrl]);

  const handleCopy = async () => {
    if (!item) return;
    const ok = await copyMediaLinkToClipboard(item.image_url);
    if (ok) {
      setCopied(true);
      if (onCopySuccess) onCopySuccess(fullUrl);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!item) return null;

  return (
    <Modal
      isOpen={!!item}
      variant="panel"
      maxWidth="max-w-4xl"
    >
      {/* Modal Header */}
      <Modal.Header
        title={
          <div className="flex items-center gap-2 min-w-0">
            {isVideo && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 shrink-0">
                <Film size={12} />
                {t('media_picker.vdo_badge')}
              </span>
            )}
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
              {item.detail_text || (isVideo ? t('media_picker.untitled_video') : t('media_picker.untitled_image'))}
            </span>
          </div>
        }
        onClose={onClose}
      />

      {/* Media Canvas Body */}
      <Modal.Body className="p-0 overflow-hidden flex items-center justify-center bg-slate-950/90 flex-1 min-h-[260px] max-h-[60vh]">
        {mediaError ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400">
            <span className="text-sm font-medium mb-2">{t('pageui.media.load_failed', 'ไม่สามารถโหลดไฟล์มีเดียนี้ได้')}</span>
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-indigo-400 hover:underline"
            >
              {t('pageui.media.open_in_new_tab', 'ลองเปิดไฟล์โดยตรงในแท็บใหม่')}
            </a>
          </div>
        ) : isVideo ? (
          <video
            ref={videoRef}
            src={fullUrl}
            controls
            playsInline
            onError={() => setMediaError(true)}
            className="max-h-[56vh] max-w-full rounded-lg shadow-lg object-contain bg-black"
          />
        ) : (
          <img
            src={fullUrl}
            alt={item.detail_text || 'Preview'}
            onError={() => setMediaError(true)}
            className="max-h-[56vh] max-w-full rounded-lg shadow-lg object-contain"
          />
        )}
      </Modal.Body>

      {/* Metadata & Actions Footer */}
      <Modal.Footer className="bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500 dark:text-slate-400">
          {item.file_size > 0 && (
            <span>
              {t('media_picker.size_label')}{' '}
              <strong className="text-slate-700 dark:text-slate-200">{formatFileSize(item.file_size)}</strong>
            </span>
          )}
          {item.created_at && (
            <span>
              {t('media_picker.date_label')}{' '}
              <strong className="text-slate-700 dark:text-slate-200">{formatMediaDate(item.created_at)}</strong>
            </span>
          )}
          {item.created_by_name && (
            <span>
              {t('media_picker.uploader_label')}{' '}
              <strong className="text-slate-700 dark:text-slate-200">{item.created_by_name}</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors"
          >
            <ExternalLink size={13} />
            {t('media_picker.open_new_tab')}
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all shadow-sm cursor-pointer ${
              copied
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t('media_picker.copy_success') : t('media_picker.copy_action')}
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};
