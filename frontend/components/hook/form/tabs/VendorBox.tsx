import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * [FEAT-20260909-AITABVENDORSPLIT] One vendor's box, collapsible.
 * ===========================================================================
 * The AI tab now carries both vendors at once — that is the whole point of the
 * split, since an OA can answer customers on one and translate on the other.
 * Both boxes open at once is a lot of screen for an operator who came to change
 * one number, so each folds.
 *
 * 🔴 OPEN IS THE DEFAULT, AND IT MATTERS. The reason the boxes stopped being
 *    conditional in the first place was that a hidden DeepSeek box left nowhere
 *    to paste a DeepSeek key. Collapsing is the operator's choice, made after
 *    they can see what is there; hiding by default would walk straight back
 *    into the bug the split fixed.
 *
 * ⚠️ COLLAPSED IS CSS, NOT UNMOUNTED. The children stay in the DOM and keep
 *    their form state, so folding a box cannot drop a value the operator typed,
 *    and a validation error inside a folded box is still reachable by the error
 *    handler that switches tabs. `hidden` on the grid, not a `&&`.
 *
 * ⚠️ WHITE, not the `bg-dark-900/50` the other panels on this tab use — owner,
 *    09/09: "ใช้สีขาวไม่ใช่สีเทา". Two grey boxes sitting inside a grey tab read
 *    as one flat surface; white is what makes each vendor look like its own card.
 *
 * revert: render `children` directly and delete this file.
 */
export const VendorBox: React.FC<{
  title: string;
  testId: string;
  children: React.ReactNode;
}> = ({ title, testId, children }) => {
  const [open, setOpen] = useState(true);

  return (
    /* 🔴 NO PADDING ON THE CARD — it moves onto the header and the body instead.
       Owner, 09/09: "กดตรงไหนก็ได้ของแท็บ ไม่ใช่เล็งแค่ arrow". With `p-6` here the
       button sat INSIDE a 24px frame, so the strip around the title looked like
       part of the header and did nothing when clicked. Aiming for a 16px chevron
       is not a control, it is a target. */
    <div
      className="md:col-span-2 bg-white rounded-2xl border border-dark-700 overflow-hidden"
      data-testid={testId}
    >
      {/* Edge to edge: the whole top strip is the button, padding included. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-6 py-4 text-sm font-bold text-slate-700 border-b border-dark-700 hover:bg-slate-50 transition-colors"
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {/* `hidden` rather than unmounting — see the header. */}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-6 px-6 pb-6 pt-4 ${open ? '' : 'hidden'}`}
      >
        {children}
      </div>
    </div>
  );
};

export default VendorBox;
