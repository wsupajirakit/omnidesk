import React from 'react';

/**
 * [FEAT-20260904-OBJVIDEO] The picture inside one Local Gallery tile — an image
 * or a video, decided by `media_kind` and nothing else.
 *
 * 🔴 IT NEVER GUESSES FROM THE EXTENSION. The BE schema comment on `media_kind`
 * says that is the entire reason the column exists, and `ChatRoomView.tsx`
 * already reads it this way for chat media. Parsing `image_type` here would put
 * a second, drifting rule in the codebase for a question the data answers.
 *
 * ⚠️ ABSENT MEANS IMAGE. Legacy rows carry no `media_kind` at all — every one
 * of them is an image — so the fallback is not a guess, it is the documented
 * meaning of the empty case: a legacy row without the column IS an image, as
 * the schema itself documents.
 *
 * ⚠️ `preload="metadata"` and no autoplay: a gallery of videos must not start
 * downloading or playing several files at once when the modal opens. The
 * poster frame is what the admin needs to recognise the clip.
 *
 * ⚠️ `pointer-events-none` on the image is kept from the original tile so the
 * drag-to-reorder handler on the wrapper still receives the gesture. The video
 * element does NOT get it — controls have to be clickable.
 *
 * revert: put `<img src={img.image_url} .../>` back in the tile and delete this
 *   file. Video rows then render as a broken image.
 */
export interface StoredMediaThumbProps {
  readonly url: string;
  /** `'video'` renders a player; anything else (including absent) an image. */
  readonly mediaKind?: 'image' | 'video';
  readonly className?: string;
}

export const StoredMediaThumb: React.FC<StoredMediaThumbProps> = ({
  url,
  mediaKind,
  className = 'w-full h-full object-cover transition-transform group-hover/server:scale-110',
}) => {
  if (mediaKind === 'video') {
    return (
      <video
        src={url}
        className={className}
        preload="metadata"
        muted
        playsInline
        controls
      />
    );
  }

  return (
    <img
      src={url}
      alt="Server storage"
      className={`${className} pointer-events-none`}
    />
  );
};
