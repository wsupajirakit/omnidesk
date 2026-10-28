/**
 * ==== [FEAT-20260811-HOOKFORMSPLIT] extracted from HookFormModal.tsx ====
 *
 * Two small stand-alone overlays that HookFormModal used to inline: the image
 * lightbox (`zoomedImage`) and the no-permission alert (`permissionAlert`).
 * Both are pure presentation — one boolean/string of state each, read nowhere
 * but their own block, closed by a single setter. The state stays in the parent;
 * these components only render it.
 *
 * ⚠️ JSX COPIED VERBATIM — class strings and element order are byte-identical to
 * the inline versions (proven by `test/hookFormOverlays.dom.test.tsx`). Do not
 * "tidy" the markup; a class change is a visual change the snapshot rejects.
 * ห้ามแต่ง markup — snapshot ล็อกทีละไบต์.
 *
 * 🚫 KEEP HookFormModal THIN — any new self-contained overlay (reads one piece of
 * state, no form coupling) belongs in a child file like this from the start, not
 * inlined back into the 5,600-line parent. อย่า inline overlay ใหม่กลับเข้าไฟล์แม่.
 *
 * revert: paste each block back where its `<…/>` is rendered, delete this file.
 */
import React from 'react';
import { X, ShieldCheck } from 'lucide-react';

/** Full-screen image lightbox. `src` null = closed (the old `{zoomedImage && …}`). */
export const HookImageZoomOverlay: React.FC<{
  src: string | null;
  onClose: () => void;
}> = ({ src, onClose }) => {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-dark-900/90 backdrop-blur-sm cursor-zoom-out animation-fade-in"
      onClick={onClose}
    >
      <div className="relative max-w-5xl w-full max-h-[90vh] flex items-center justify-center group px-4">
        <button
          type="button"
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/40 transition-all z-10 border border-white/20"
          onClick={onClose}
        >
          <X size={28} />
        </button>
        <img
          src={src}
          alt="Zoomed"
          className="max-w-full max-h-full rounded-2xl shadow-2xl shadow-black/50 object-contain animation-scale-in"
        />
      </div>
    </div>
  );
};

/** "No Permission" alert. `open` false = closed (the old `{permissionAlert && …}`). */
export const HookPermissionAlertOverlay: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-dark-800 border border-dark-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform animate-in zoom-in-95 duration-300 text-slate-900">
        <div className="p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4 ring-8 ring-red-500/5">
            <ShieldCheck size={32} className="text-red-500" />
          </div>
          <h3 className="text-xl font-bold mb-2">No Permission</h3>
          <p className="text-slate-500 text-sm leading-relaxed">
            You do not have permission to access this section. Please contact your system administrator.
          </p>
        </div>
        <div className="p-4 bg-dark-900/50 border-t border-dark-700">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold transition-all active:scale-[0.98] shadow-lg shadow-primary-500/20"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};
