/**
 * [FEAT-20261018-EXTAPICARDS] One foldable card of the OA form's External API tab.
 *
 * Owner 18/10/2026: every card folds and starts OPEN · grey cards are white in the light theme
 * (`.extapi-card`, index.css — the dark theme keeps its own colours) and spaced so each topic
 * reads as its own card.
 *
 * The body is hidden with `hidden`, never unmounted — typed values survive a fold, the same rule
 * as the tab's older folds ([FEAT-20260810-EXTAPIFOLD]). Fold state is screen-only: it never
 * touches form data, and it works in view mode (looking is not editing).
 *
 * revert: inline the card's old wrapper back at its call site and delete this file.
 */
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export const ExtApiFoldCard: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  /** controls that stay visible while folded (switches, buttons) */
  right?: React.ReactNode;
  /** replaces the white shell — only for a card whose colour carries a state (payment tool ON) */
  toneClass?: string;
  children: React.ReactNode;
}> = ({ icon, title, right, toneClass, children }) => {
  const [open, setOpen] = useState(true);
  return (
    <section className={`p-5 border rounded-2xl transition-colors ${toneClass ?? 'extapi-card bg-dark-900 border-dark-700'}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 text-left cursor-pointer"
        >
          {icon}
          {title}
          <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {right}
      </div>
      <div className={open ? 'mt-4' : 'hidden'}>{children}</div>
    </section>
  );
};
