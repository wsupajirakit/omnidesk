/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The full-screen image overlay.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageList.tsx` (§6.3 step 3). It reached for
 * exactly two names — the url and the setter that clears it — which is what a
 * safe lift looks like: no state, no effect, no handler body moved.
 *
 * ⚠️ THE THREE CLICK HANDLERS ARE NOT DECORATION. The backdrop closes, the
 * button closes, and the <img> STOPS PROPAGATION so clicking the picture itself
 * does not. Drop the third and the overlay closes when the admin clicks the very
 * thing they opened it for.
 *
 * revert: paste the body back at the bottom of `ObjectImageList.tsx` behind
 *   `{zoomedPreviewImage && (…)}` and delete this file.
 */
import React from 'react';
import { X } from 'lucide-react';

export interface ObjectImageZoomOverlayProps {
  /** The file to show. The parent renders this component only when set. */
  url: string;
  /**
   * [FEAT-20260904-OBJVIDEO] `'video'` plays; anything else (including absent)
   * is an image. Absent means image because that is what a legacy row means —
   * the same rule `StoredMediaThumb` follows, read from the same column.
   */
  mediaKind?: 'image' | 'video';
  onClose: () => void;
}

export const ObjectImageZoomOverlay: React.FC<ObjectImageZoomOverlayProps> = ({
  url,
  mediaKind,
  onClose,
}) => (
    <div 
      className="fixed inset-0 z-[120] flex items-center justify-center bg-white/60 animate-in fade-in duration-300 backdrop-blur"
      onClick={() => onClose()}
    >
      <button 
        className="absolute top-6 right-6 p-2.5 bg-slate-900/10 hover:bg-slate-900/20 text-slate-900 rounded-full transition-all hover:rotate-90 z-[130]"
        onClick={() => onClose()}
      >
        <X size={24} />
      </button>
      {mediaKind === 'video' ? (
        /* [FEAT-20260904-OBJVIDEO] A video needs its controls, so it must NOT be
           `pointer-events-none` the way the image is — and it stops propagation
           itself, or pressing play would close the overlay. `autoPlay` is
           deliberate: the admin pressed zoom on a clip in order to watch it. */
        <video
          src={url}
          className="max-w-[95%] max-h-[90%] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300"
          controls
          autoPlay
          playsInline
          data-testid="zoom-video"
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
