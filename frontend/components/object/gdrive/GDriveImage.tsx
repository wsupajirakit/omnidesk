import React from 'react';
import { Loader2, Upload } from 'lucide-react';

/**
 * [FIX-20260904-GDRIVEINLINECOMP] One Google-Drive thumbnail in the Object album
 * picker — lifted OUT of `ObjectImageFormModal`, where it was declared inside
 * the parent component's body (`:657` before this change).
 *
 * 🔴 THIS IS A FIX, NOT A MOVE. A component defined in the body of another
 * component is a NEW function identity on every parent render, and React
 * compares element types by identity — so the entire thumbnail subtree was
 * unmounted and remounted whenever any parent state changed. The visible cost
 * was every Drive image refetching on each keystroke that touched the form.
 * ⇒ everything else in the Phase-1 split moved verbatim; this one changes
 *   remount behaviour on purpose, and `test/objectGDriveImageIdentity.dom.test.tsx`
 *   was written red-first against the old file to prove it.
 * คอมโพเนนต์ที่ประกาศในตัวแม่ = type ใหม่ทุก render ⇒ ลูกถูกถอดแล้วสร้างใหม่ทุกครั้ง
 *
 * ⚠️ THE STATE DID NOT MOVE (§6.4). What used to be captured from the closure —
 * the album id, the in-flight upload id and the upload handler — is now passed
 * in as props. The parent still owns all three; this file holds none.
 *
 * ⚠️ The markup below is the ORIGINAL, character for character, including the
 * inline SVG fallback and every class string. Only the three closure reads
 * became props.
 *
 * revert: paste this back into the modal body above `if (!isOpen) return null;`
 *   and delete the import — the remount comes back with it.
 */
export interface GDriveImageProps {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /** The saved album id. Absent while creating ⇒ no upload button. */
  readonly albumId?: string;
  /** Which file is uploading right now, so only that tile shows a spinner. */
  readonly uploadingId: string | null;
  readonly onUpload: (driveId: string) => void;
}

export const GDriveImage: React.FC<GDriveImageProps> = ({
  id,
  name,
  url,
  albumId,
  uploadingId,
  onUpload,
}) => (
  <div className="aspect-square bg-white rounded-lg border border-slate-200 overflow-hidden group/img relative shadow-sm">
    <img
      src={url}
      alt={name}
      className="w-full h-full object-cover transition-transform group-hover/img:scale-110"
      onError={(e) => {
        (e.target as any).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='9' cy='9' r='2'%3E%3C/circle%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'%3E%3C/path%3E%3C/svg%3E";
      }}
    />
    <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/40 transition-all flex flex-col items-center justify-center gap-2">
      <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 truncate text-[8px] text-white opacity-100 transition-opacity">
        {name}
      </div>

      {albumId && (
        <button
          type="button"
          disabled={uploadingId === id}
          onClick={() => onUpload(id)}
          className="p-1.5 bg-primary-600 text-white rounded-full opacity-0 group-hover/img:opacity-100 scale-90 group-hover/img:scale-100 transition-all hover:bg-primary-500 shadow-lg disabled:opacity-50"
        >
          {uploadingId === id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        </button>
      )}
    </div>
  </div>
);
