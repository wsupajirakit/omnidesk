/**
 * [FEAT-20260907-BCASTNAMECELL] The campaign name, shortened, with a way to read
 * it in full.
 * ============================================================================
 * Owner, 07/09: the name column was eating the table. Job names in this system
 * are descriptive by habit ("FLOWTEST broadcast การ์ด site rule (dev-rule)
 * 13:34:20"), and because the cell was `whitespace-nowrap` with no cap, ONE long
 * name widened the column for every row and pushed the columns after it off the
 * screen. Give the name about two thirds of the room it takes now, cut the rest,
 * and put an info button after it for the full string.
 *
 * 🔴 ITS OWN FILE. `pages/messaging/Broadcasts.tsx` is 1,204 lines — three times
 *    the 400-line cap — so new UI does not go in it. `components/messaging/` is
 *    the folder that page's own pieces already live in (`JobIdCell`,
 *    `TagScopeCell`), and this is another one. ของใหม่แยกไฟล์ตั้งแต่แรก.
 *
 * 🔴 IT HOLDS NO STATE AND OWNS NO MODAL. The page passes `onShowFull` and
 *    answers with its EXISTING `AlertModal`, because that modal is counted in
 *    `Broadcasts.tsx:179` `isModalOpen`, which pauses the list's auto-refresh
 *    (`:333`). A modal rendered privately in here would not be counted, and the
 *    table would keep reloading underneath an open dialog — every other dialog
 *    on this page pauses it. ให้หน้าแม่ถือ modal เดิม ไม่งั้น auto-refresh ไม่หยุด.
 *
 * ⚠️ THE ID ROW BELOW IS NOT MINE. `JobIdCell` renders the id with its own copy
 *    and info buttons directly under this one, and the owner said explicitly on
 *    07/09 that those are unrelated and must not move. The info button here is a
 *    SECOND one, sitting after the NAME. Two info buttons in one cell is
 *    deliberate: they answer different questions.
 *
 * revert: delete this file, drop it from `components/messaging/index.ts`, and
 * put `<span className="text-sm font-medium text-slate-900">{item.name}</span>`
 * back in the name `<td>` of `pages/messaging/Broadcasts.tsx`.
 */
import React from 'react';
import { Info } from 'lucide-react';

import { useI18n } from '../../../i18n';

/**
 * How much name is shown before it is cut.
 *
 * ⚠️ This is the "two thirds" the owner asked for, expressed as a number rather
 *    than a feeling: the longest names in the list today run about 50-53
 *    characters, and 34 is two thirds of that. It is ONE number — widen or
 *    narrow the column by changing it here, not by editing class strings at the
 *    call site.
 *
 * ⚠️ `ch` is the width of a "0" in the current font, so a Thai string of N
 *    characters is not exactly N `ch` wide. That is fine for a max-width: the
 *    cap is a budget, not a promise of an exact cut point. It does mean
 *    `isNameTruncated` can disagree with the pixel truth by a character or two —
 *    see its own note.
 */
export const BROADCAST_NAME_MAX_CH = 34;

/**
 * Whether the info button is worth showing.
 *
 * ⚠️ Counted in CHARACTERS while the cut happens in `ch` UNITS, so around the
 *    boundary this can offer the button for a name that just barely fits, or
 *    (with very wide glyphs) miss one that just barely does not. Both failures
 *    are harmless — an extra button, or a name the reader can already see — and
 *    the alternative is measuring `scrollWidth` against `clientWidth` in a
 *    layout effect on every row of the table, which is a lot of machinery for a
 *    tooltip. The `title` attribute covers the near-miss case anyway.
 */
export const isNameTruncated = (name: string): boolean =>
  name.trim().length > BROADCAST_NAME_MAX_CH;

export interface BroadcastNameCellProps {
  readonly name: string;
  /** Ask the PAGE to show the whole thing — see the note about `isModalOpen`. */
  readonly onShowFull: () => void;
}

export const BroadcastNameCell: React.FC<BroadcastNameCellProps> = ({
  name,
  onShowFull,
}) => {
  const { t } = useI18n();
  const clipped = isNameTruncated(name);

  return (
    <div className="flex items-center gap-1" data-testid="bcast-name-cell">
      {/* `truncate` needs a block box and a width to work against; the cell it
          sits in is `whitespace-nowrap`, so without the cap this span would
          simply grow. `title` gives the full name on hover for the mouse, which
          the button gives to everyone else. */}
      <span
        data-testid="bcast-name-text"
        title={name}
        className="block truncate text-sm font-medium text-slate-900"
        style={{ maxWidth: `${String(BROADCAST_NAME_MAX_CH)}ch` }}
      >
        {name}
      </span>

      {clipped && (
        <button
          type="button"
          data-testid="bcast-name-info"
          onClick={onShowFull}
          title={t('broadcast.name_info')}
          aria-label={t('broadcast.name_info')}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-sky-600"
        >
          <Info size={13} />
        </button>
      )}
    </div>
  );
};

export default BroadcastNameCell;
