import React from 'react';

/**
 * [FIX-20260905-LINELOGO] The LINE mark — ONE definition, and it had drifted.
 * ===========================================================================
 * 🔴 THIS FILE EXISTS BECAUSE THE TWO COPIES DISAGREED ON SCREEN.
 * `LineLogoIcon` was declared twice: once in `ChatRoomView.tsx` and once in the
 * profile panel. They were NOT the same icon.
 *
 *   ChatRoomView  drew the wordmark with `<text>LINE</text>`
 *   the panel     still drew it with the four letter `<path>`s
 *
 * The `<text>` version is the CORRECTED one — `[FIX-20260731-LINENAME]`, whose
 * own comment records why: *"เดิม path ตัวอักษรวาดออกมาไม่เป็นคำว่า LINE"*. That
 * fix was applied to one copy and never reached the other, so the room header
 * and the customer panel have been drawing two different logos since 31/07.
 *
 * ⚠️ MERGING THEM IS A VISIBLE CHANGE, and it is deliberate: the panel and
 * ticket now get the corrected wordmark. That is the whole point — the fix was
 * meant for both. คัดลอกไว้สองที่ = แก้ที่เดียวแล้วอีกที่ค้างของเก่า
 *
 * `test/lineLogoSingleTruth.test.ts` fails if a third definition appears.
 *
 * revert: paste this component back into `ChatRoomView.tsx` and
 *         `profile-panel/ProfilePanel.tsx`, delete this file and its spec — and
 *         accept that the two will drift again.
 */
export const LineLogoIcon: React.FC<{ className?: string }> = ({
  className = 'w-3.5 h-3.5 shrink-0',
}) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path
      fill="#06C755"
      d="M12 2C6.48 2 2 5.8 2 10.49c0 4.19 3.6 7.7 8.46 8.35.33.07.78.22.89.5.1.26.07.67.03.94-.06.46-.27 1.66-.3 2.01-.05.57.26.78.58.55 2.5-1.8 5.76-4.22 7.86-7.22C21.14 13.56 22 12.1 22 10.49 22 5.8 17.52 2 12 2z"
    />
    {/* [FIX-20260731-LINENAME] letters as <text>, not as paths — the path form
        did not spell LINE. Keep it this way. */}
    <text
      x="12"
      y="13.6"
      textAnchor="middle"
      fill="#FFF"
      fontSize="6.2"
      fontWeight="700"
      fontFamily="Arial, Helvetica, sans-serif"
      letterSpacing="0.2"
    >
      LINE
    </text>
  </svg>
);
