/**
 * [FEAT-20260905-CUSTPROV PART 5] The chat-room header's TOP line.
 * ============================================================================
 * WHAT: the `0925550014 | ไอติม | bbbb` line — one title span followed by any
 *       extra identity segments, each preceded by its own `|` separator.
 *
 * WHY:  it is the one piece of the bar whose CONTENT will differ per customer
 *       provider once the BE serves a `view` (plan §26: "which identity fields
 *       appear on the name line and in what order" is the varying half). Giving
 *       it a file now means that later change edits one small component instead
 *       of reaching back into a 250-line bar.
 *
 * 🔴 THE RULES ARE NOT HERE. Which segments show, and the de-dup that stops
 *    `dev_User-2 | dev_User-2`, live in `../../headerNameDedup.ts`
 *    ([FIX-20260830-HEADERDUP]) — already pure, already tested by
 *    `test/headerNameDedup.value.test.ts`. This file only draws what that
 *    function returns. Do not re-implement a rule here; there would then be two
 *    answers to one question. กฎอยู่ที่เดียว ไฟล์นี้แค่วาด
 *
 * The markup below is byte-identical to what stood in `ChatRoomView.tsx`
 * (`:1080-1108` before the move) — same classes, same element order, same keys.
 *
 * revert: delete this file and paste its `<div>` back into `RoomHeader.tsx`
 *         where `<HeaderNameLine …/>` is mounted.
 */
import React from 'react';
import { headerNameParts, type HeaderNameInput } from '../../headerNameDedup';

export const HeaderNameLine: React.FC<HeaderNameInput> = ({
  headerTitle,
  first,
  full_name,
  nickname,
}) => (
  /* [FEAT-20260815-HEADERNAME] Owner, 15/08: "ขยายชื่อไลน์ ตรง header
     chatroom + 20%". `text-sm` is 14px → 16.8px, taken to the 17px
     step. Only the SIZE changed; the row's structure, separators
     and truncation are untouched, and the OA line below keeps its
     11px so the two stay visually ranked. */
  <div className="font-bold text-slate-800 text-[15px] truncate flex items-center gap-1.5 min-w-0">
    {/* [FIX-20260814-CUSTOMERNAME] `headerTitle` (a caller's own
        wording, e.g. the ticket page's phone number) still wins;
        only the fallback changed, so a placeholder row no longer
        titles the header "Unknown". */}
    {/* [FEAT-20260729-FULLNAME] ชื่อจริงต่อจากเบอร์ · [FIX-20260830-HEADERDUP]
        the three segments and their show-rules are UNCHANGED and now
        live in headerNameParts (pure, tested); the one addition is
        that a text already shown on the line never repeats —
        `dev_User-2 | dev_User-2` collapses to one. Separators stay
        inside each segment's own block, so no dangling `|`. */}
    {headerNameParts({
      headerTitle,
      first,
      full_name,
      nickname,
    }).map((part, i) =>
      i === 0 ? (
        <span key={`h-${i}`} className="truncate">{part}</span>
      ) : (
        <React.Fragment key={`h-${i}`}>
          <span className="text-slate-400 font-normal shrink-0">|</span>
          <span className="text-slate-600 font-semibold truncate">
            {part}
          </span>
        </React.Fragment>
      ),
    )}
  </div>
);
