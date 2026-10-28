import React, { useEffect, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';

/**
 * [FEAT-20260904-UPLOADPROGRESS] What the admin watches while a file goes up.
 * ===========================================================================
 * Three things at once, because they answer the three questions an admin has
 * while staring at a stalled-looking screen:
 *
 *   WHAT am I uploading  → a real preview of the picked file, playable for a
 *                          video, BEFORE the server has ever seen it
 *   HOW FAR has it got   → the phase, and a percentage while one exists
 *   CAN I STOP           → a cancel that asks once before it throws the work away
 *
 * ### 🔴 The percentage is honest or it is absent
 *
 * There is no bar during `shrinking`, because no request exists yet — the
 * browser is re-encoding, in REAL TIME for a video, and a bar frozen at 0% for
 * two minutes reads as a hang. And 100% does not mean "saved": it means the
 * bytes left the browser, and the server can still refuse them. So 100% shows
 * "finishing…" until the caller says it is done.
 * 100% means the bytes are sent, not that the server took them; while
 * shrinking there is no percentage, so none is shown.
 *
 * ### The cancel asks first, in place
 *
 * ⚠️ Not a modal on top of a modal — this panel already lives inside the album
 * dialog, and a third layer is where a click lands on the wrong thing. Pressing
 * cancel swaps the row for a question with two plain answers, and the question
 * says what is lost: for a video, minutes of encoding.
 *
 * revert: delete this file and the `uploadState` block in
 *   `ObjectImageFormModal.tsx`. Uploads go back to a spinner with no progress,
 *   no preview and no way to stop them.
 */

export type UploadPhase = 'shrinking' | 'uploading';

export interface UploadProgressPanelProps {
  /** The file the admin picked. Its preview is built from this, never from a url. */
  file: File;
  kind: 'image' | 'video';
  phase: UploadPhase;
  /** 0-100. Only meaningful while `phase === 'uploading'`. */
  percent: number;
  /** Absent until the transfer has actually started — nothing to stop before that. */
  onCancel?: () => void;
  t: (key: string) => string;
}

export const UploadProgressPanel: React.FC<UploadProgressPanelProps> = ({
  file,
  kind,
  phase,
  percent,
  onCancel,
  t,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /* 🔴 THE URL IS REVOKED WHEN THE FILE CHANGES OR THE PANEL GOES AWAY. Each
     `createObjectURL` pins the whole file in memory until revoked; a 50 MB clip
     per attempt, never released, is a tab that grows until it is reloaded. */
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
  const shrinking = phase === 'shrinking';
  /* The bytes are gone but the server has not answered yet. */
  const finishing = !shrinking && percent >= 100;

  return (
    <div
      className="flex gap-3 rounded-xl border border-primary-200 bg-primary-50/40 p-3"
      data-testid="upload-progress-panel"
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-primary-200 bg-white">
        {previewUrl && kind === 'video' ? (
          <>
            {/* muted + no autoplay: the point is to SEE the clip, not hear it
                start playing by itself while something else is uploading. */}
            <video
              src={previewUrl}
              className="h-full w-full object-cover"
              preload="metadata"
              muted
              playsInline
              controls
              data-testid="pending-video"
            />
            <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-black/60 p-0.5 text-white">
              <Play size={10} />
            </span>
          </>
        ) : (
          previewUrl && (
            <img
              src={previewUrl}
              alt={file.name}
              className="h-full w-full object-cover"
              data-testid="pending-image"
            />
          )
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-800" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 text-[11px] font-bold text-slate-400">{sizeMb} MB</span>
        </div>

        <div className="flex items-center gap-2">
          <Loader2 size={12} className="shrink-0 animate-spin text-primary-600" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary-700">
            {shrinking
              ? t('object_image.upload_phase_shrinking')
              : finishing
                ? t('object_image.upload_phase_finishing')
                : `${percent}%`}
          </span>
        </div>

        {/* No bar while shrinking — there is no measurable progress to draw. */}
        {!shrinking && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary-100">
            <div
              className="h-full rounded-full bg-primary-600 transition-all duration-200"
              style={{ width: `${percent}%` }}
              data-testid="upload-bar"
            />
          </div>
        )}

        {confirming ? (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] font-bold text-red-600">
              {kind === 'video'
                ? t('object_image.upload_cancel_confirm_video')
                : t('object_image.upload_cancel_confirm')}
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-100"
              data-testid="upload-cancel-yes"
            >
              {t('object_image.upload_cancel_yes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
              data-testid="upload-cancel-no"
            >
              {t('object_image.upload_cancel_no')}
            </button>
          </div>
        ) : (
          onCancel && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex w-fit items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 transition-colors hover:border-red-200 hover:text-red-600"
              data-testid="upload-cancel"
            >
              <X size={10} />
              {t('common.cancel')}
            </button>
          )
        )}
      </div>
    </div>
  );
};
