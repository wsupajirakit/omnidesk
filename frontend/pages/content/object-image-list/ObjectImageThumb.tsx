/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The album list's thumbnail cell.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageList.tsx` (§6.3 step 3) — class strings and
 * element order byte-identical to what shipped. The only edit is the seam: the
 * two things the button did to the parent's state
 * (`setPreviewImage(img)` + `fetchGDrivePreview(img)`) arrive as ONE `onPreview`
 * prop, so no state moved and the parent still owns every decision.
 *
 * 🔴 IT IS SIX BRANCHES, NOT A PICTURE. stored thumb → external → local →
 * google drive → raw `img_path` → nothing. Only the first is exercised by a
 * screenshot, which is exactly why they are pinned one by one in
 * `test/objectImageList.dom.test.tsx` — a move that quietly loses the "Drive
 * Gallery" marker looks perfect on the screen it was tested on.
 * ⚠️ THE ORDER IS THE RULE: `first_thumb` wins over `storage`, and `img_path` is
 * the last resort. Reordering the chain changes which marker an album shows.
 *
 * The inline `onError` data-URIs are the original ones, kept as-is: they are the
 * placeholder a broken link falls back to, and rewriting them here would be a
 * behaviour change wearing a tidy-up's clothes.
 *
 * revert: paste this component's body back into the first `<td>` of the row in
 *   `ObjectImageList.tsx` and delete this file.
 */
import React from 'react';
import { Camera, Image as ImageIcon, Search } from 'lucide-react';

import type { ObjectImage } from '../../../types';

export interface ObjectImageThumbProps {
  img: ObjectImage;
  /** Open the preview for this album — the parent decides what that means. */
  onPreview: (img: ObjectImage) => void;
}

export const ObjectImageThumb: React.FC<ObjectImageThumbProps> = ({
  img,
  onPreview,
}) => (
    <div className="flex flex-col gap-2">
      <button 
        onClick={() => {
          onPreview(img);
        }}
        className={`w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-dark-900 flex items-center justify-center border border-dark-600 overflow-hidden group/thumb relative cursor-zoom-in shadow-inner`}
      >
        {img.first_thumb ? (
          <>
            <img 
              src={img.first_thumb} 
              alt={img.detail || 'object'} 
              className="w-full h-full object-cover transition-transform group-hover/thumb:scale-110" 
              onError={(e) => {
                (e.target as any).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='9' cy='9' r='2'%3E%3C/circle%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'%3E%3C/path%3E%3C/svg%3E";
              }} 
            />
            <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors flex items-center justify-center">
              <Search className="text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" size={20} />
            </div>
          </>
        ) : img.storage === 'external' ? (
          <div className="flex flex-col items-center justify-center gap-1 group-hover/thumb:scale-110 transition-transform">
            <img src="/assets/external-logo.png" alt="External" className="w-10 h-10 object-contain drop-shadow-md" onError={(e) => {
              (e.target as any).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%233b82f6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'%3E%3C/path%3E%3Cpath d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'%3E%3C/path%3E%3C/svg%3E";
            }} />
            <span className="text-[9px] font-bold text-blue-500 uppercase tracking-tighter">External Link</span>
          </div>
        ) : img.storage === 'local' ? (
          <div className="flex flex-col items-center justify-center gap-1 group-hover/thumb:scale-110 transition-transform text-primary-500">
            <Camera size={28} strokeWidth={2.5} />
            <span className="text-[9px] font-bold uppercase tracking-tighter">Local</span>
          </div>
        ) : img.storage === 'google_drive' ? (
          <div className="flex flex-col items-center justify-center gap-1 group-hover/thumb:scale-110 transition-transform">
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-lg border border-slate-100 relative">
              <span className="text-xl font-black bg-gradient-to-br from-blue-500 via-red-500 to-yellow-500 bg-clip-text text-transparent">G</span>
            </div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Drive Gallery</span>
          </div>
        ) : img.img_path ? (
          <>
            <img 
              src={img.img_path} 
              alt={img.detail || 'object'} 
              className="w-full h-full object-cover transition-transform group-hover/thumb:scale-110" 
              onError={(e) => {
                (e.target as any).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='9' cy='9' r='2'%3E%3C/circle%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'%3E%3C/path%3E%3C/svg%3E";
              }} 
            />
          </>
        ) : (
          <ImageIcon className="text-slate-300" size={24} />
        )}
      </button>
      {/* image_id removed as per request */}
    </div>
);
