import React from 'react';
import { Database } from 'lucide-react';

/**
 * [FIX-20260904-GALLERYHEADERROW] The "Local Gallery / SERVER SIDE STORAGE"
 * caption above the storage box.
 *
 * 🔴 THIS IS A FIX, NOT ONLY A MOVE — it is why the owner's screenshot shows
 * the words cut through the middle.
 *
 * In `ObjectImageFormModal.tsx` the caption and the dropzone were SIBLINGS
 * inside one `flex items-center justify-between` row (opened at `:1152`, closed
 * at `:1294` — the dropzone at `:1189` sat between them). A flex row lays its
 * children side by side, so the caption was squeezed into whatever the dropzone
 * left over and the dashed border ran straight over the text.
 *
 * ⇒ the caption becomes its own block ABOVE the dropzone. That is the whole
 *   change: same words, same icon, same classes on the pieces themselves.
 * ป้ายกับกล่องลากไฟล์เคยเป็นพี่น้องในแถวเดียวกัน มันเลยทับกัน — แยกคนละแถวจบ
 *
 * ⚠️ Pure display. It reads nothing, holds nothing, and takes no props — which
 * is what makes lifting it a §6.3 markup move with no state involved.
 *
 * revert: paste the two <div>s back inside the `justify-between` row and delete
 *   this file. The overlap comes back with them.
 */
export const GalleryHeader: React.FC = () => (
  <div className="flex items-center gap-2">
    <div className="w-8 h-8 rounded-lg bg-primary-600/10 flex items-center justify-center shrink-0">
      <Database size={16} className="text-primary-600" />
    </div>
    <div className="min-w-0">
      <h4 className="text-sm font-bold text-slate-800">Local Gallery</h4>
      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
        Server side storage
      </p>
    </div>
  </div>
);
