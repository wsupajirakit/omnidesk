/**
 * DetailSkeleton.tsx — the placeholder shown while a newly-clicked card's data
 * settles.
 *
 * WHAT: moved verbatim from `pages/chat/TicketChat.tsx` (it was declared there
 * at module scope, straight after the personal-panel section).
 *
 * WHY: it is 15 code lines of pure markup with no props, no state and no
 * imports beyond React — it never belonged in a 7,000-line page. Its only
 * caller is `PersonalPanel`, which now sits beside it.
 *
 * Behaviour: none. Same element order, same class strings, byte for byte.
 *
 * revert: paste the component back into the page above `useCardSwitchLoading`,
 *   drop the line from `./index.ts`, drop the import in `./PersonalPanel.tsx`,
 *   delete this file.
 */
import React from 'react';

// Skeleton for the detail panel while a newly-clicked card's data is settling.
export const DetailSkeleton: React.FC = () => (
  <div className="flex-1 overflow-hidden bg-gray-50 p-3 space-y-3">
    <div className="tc-skel h-16 rounded-lg" />
    <div className="bg-white border border-border rounded-lg shadow-sm p-3 space-y-3">
      <div className="tc-skel h-4 w-28 rounded" />
      {[0,1,2,3,4,5].map(i => (
        <div key={i} className="flex justify-between items-center gap-2">
          <div className="tc-skel h-3 w-16 rounded" />
          <div className="tc-skel h-3 rounded" style={{ width: `${90 + (i * 23) % 80}px` }} />
        </div>
      ))}
    </div>
    <div className="tc-skel h-20 rounded-lg" />
  </div>
);
