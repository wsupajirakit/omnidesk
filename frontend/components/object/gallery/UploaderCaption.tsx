import React from 'react';
import { User } from 'lucide-react';

/**
 * [FEAT-20260904-UPLOADEDBY] Who put this file here.
 * ===========================================================================
 * One component for both galleries — the album modal's and the list page's
 * preview — so the two screens cannot answer the question differently, the way
 * they did with image-vs-video until today.
 *
 * 🔴 A NAME, NEVER AN ID. The server resolves `created_by` (which stores the id
 * and only the id) into a display name when the row is read, so there is no id
 * in the payload to render by accident. Owner, 04/09: store the id and join for
 * the name; show the display name, never the id.
 *
 * ⚠️ ABSENT IS NORMAL, NOT AN ERROR. A row uploaded before the column was
 * populated, or one whose account has since been deleted, has no name — nothing
 * was backfilled and nothing will be. It shows a dash rather than a blank strip,
 * so "nobody recorded" is visibly different from "the caption is broken".
 * No name means a dash, not an empty strip.
 *
 * ⚠️ `pointer-events-none`: the strip sits over a tile that is draggable and
 * clickable. Without it, the caption swallows the gesture on its own third of
 * the tile and reordering mysteriously stops working near the bottom edge.
 *
 * revert: delete this file and its two call sites. The tiles lose the caption
 *   and nothing else changes.
 */
export interface UploaderCaptionProps {
  /** The display name the server resolved, or null/absent for an unknown one. */
  name?: string | null;
  /** Shown on hover only by default, to match the existing tile overlays. */
  alwaysVisible?: boolean;
}

export const UploaderCaption: React.FC<UploaderCaptionProps> = ({
  name,
  alwaysVisible = false,
}) => (
  <div
    data-testid="uploader-caption"
    title={name || undefined}
    className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/60 px-1 py-0.5 text-[9px] text-white transition-opacity ${
      alwaysVisible ? '' : 'opacity-0 group-hover/server:opacity-100 group-hover/srv:opacity-100'
    }`}
  >
    <User size={8} className="shrink-0" aria-hidden />
    <span className="truncate">{name || '—'}</span>
  </div>
);
