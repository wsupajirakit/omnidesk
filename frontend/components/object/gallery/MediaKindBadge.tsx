import React from 'react';
import { Video } from 'lucide-react';

import { useI18n } from '../../../i18n';

/**
 * [FEAT-20260904-OBJVIDEO] A small corner mark saying a tile holds a video.
 *
 * WHY IT EARNS ITS PLACE. A video tile already renders `<video controls>`, so
 * most of the time it is obvious. It is not obvious when the poster frame is
 * black or the metadata has not loaded — a common first frame — and then a
 * video is indistinguishable from a broken image at thumbnail size. The badge
 * is what the admin reads in that case.
 *
 * ⚠️ NOTHING IS DRAWN FOR AN IMAGE. Marking both kinds would put a badge on
 * every tile in every existing album, which is noise for the case that needs no
 * explanation. An image needs no badge; it is the default.
 *
 * ⚠️ `pointer-events-none` so it never intercepts the drag-to-reorder gesture
 * or a click meant for the player's controls underneath.
 *
 * revert: delete this file and its one line in the tile.
 */
export interface MediaKindBadgeProps {
  readonly mediaKind?: 'image' | 'video';
}

export const MediaKindBadge: React.FC<MediaKindBadgeProps> = ({ mediaKind }) => {
  const { t } = useI18n();
  if (mediaKind !== 'video') return null;

  return (
    <span
      data-testid="media-kind-badge"
      title={t('pageui.object.kind_video', 'วิดีโอ')}
      className="absolute top-1 left-1 z-10 pointer-events-none inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
    >
      <Video size={10} />
      MP4
    </span>
  );
};
