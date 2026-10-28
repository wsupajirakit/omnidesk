import React from 'react';
import { X } from 'lucide-react';

/**
 * [REFACTOR-20260904-OBJFORMSPLIT] Full-screen view of one stored file, inside
 * the album form.
 * ===========================================================================
 * Lifted VERBATIM (§6.3 step 3). It reached for exactly two names — the url and
 * the setter that clears it — which is what a safe lift looks like.
 *
 * ⚠️ NOT SHARED WITH THE LIST PAGE'S OVERLAY, ON PURPOSE.
 * `object-image-list/ObjectImageZoomOverlay.tsx` looks similar and is not the
 * same component: the two screens are free to diverge. Merging them means one
 * component with two behaviours behind a flag — a merge for the line count, not
 * for the reader. Looking alike is not being the same thing.
 *
 * 🔴 [FIX-20260904-ZOOMVIDEO] IT USED TO SAY "this one is image-only, because
 * the form's grid only holds images". That was WRONG THE DAY IT WAS WRITTEN —
 * the same grid renders `StoredMediaThumb`, which plays video, and its zoom
 * button hands this component a video url. A stored .mp4 opened here as a
 * BROKEN <img>. The claim in a comment was never checked against the caller.
 * The list-page overlay had the rule right; only this twin was missed.
 * เจอซ้ำรอยเดิม: การ์ดใบเดียวกันมีสองที่ แก้ที่เดียวไม่พอ
 *
 * revert: paste the body back behind `{zoomedImage && (…)}` in
 *   `ObjectImageFormModal.tsx` and delete this file.
 */
/**
 * [FIX-20260904-ZOOMVIDEO] What the form's zoom state holds.
 *
 * 🔴 ONE OBJECT, NOT TWO PARALLEL STATES. The url and the kind must change
 * together — a second `useState` for the kind is how a video url ends up drawn
 * with the previous tile's kind for one render. The state was a bare `string`
 * before, which is exactly why the kind never reached the overlay at all.
 */
export interface ZoomedMedia {
  url: string;
  mediaKind?: 'image' | 'video';
}

export interface StoredImageZoomProps {
  /** The file to show. The parent renders this only when set. */
  url: string;
  /**
   * [FIX-20260904-ZOOMVIDEO] `'video'` plays; anything else (including absent)
   * is an image. Absent means image because that is what a legacy row means —
   * the same rule `StoredMediaThumb` and the list overlay follow, read from the
   * same `media_kind` column. Never guessed from the extension.
   */
  mediaKind?: 'image' | 'video';
  onClose: () => void;
}

export const StoredImageZoom: React.FC<StoredImageZoomProps> = ({
  url,
  mediaKind,
  onClose,
}) => (
  <div
    className="fixed inset-0 z-[100] flex items-center justify-center bg-white/60 animate-in fade-in duration-300 backdrop-blur"
    onClick={() => onClose()}
  >
    <button
      className="absolute top-6 right-6 p-2.5 bg-slate-900/10 hover:bg-slate-900/20 text-slate-900 rounded-full transition-all hover:rotate-90 z-[110]"
      onClick={() => onClose()}
    >
      <X size={24} />
    </button>
    {mediaKind === 'video' ? (
      /* [FIX-20260904-ZOOMVIDEO] A video needs its controls, so it must NOT be
         `pointer-events-none` the way the image is — and it stops propagation
         itself, or pressing play would close the overlay. `autoPlay` is
         deliberate: the admin pressed zoom on a clip in order to watch it.
         Same three rules as the list overlay, for the same reasons. */
      <video
        src={url}
        className="max-w-[95%] max-h-[90%] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
        controls
        autoPlay
        playsInline
        data-testid="form-zoom-video"
        onClick={(e) => e.stopPropagation()}
      />
    ) : (
      <img
        src={url}
        alt="Fullscreen preview"
        className="max-w-[95%] max-h-[90%] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300 select-none pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      />
    )}
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-6 py-2 bg-white/45 backdrop-blur rounded-full text-slate-500 text-xs font-bold tracking-widest uppercase border border-slate-200">
      Click anywhere to close
    </div>
  </div>
);
