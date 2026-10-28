/**
 * [FEAT-20260905-CUSTPROV PART 7] `kv` — label/value rows.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (`kv` = "โปรโมชั่น — label/value rows")
 *
 * Rows are drawn with the existing `PanelRow` (`../shared/PanelRow`), so the
 * label/value line, its border and its `last` behaviour are the panel's, not a
 * second implementation of them.
 *
 * ## 🔴 `target` PRESENT ⇒ THE ROW IS PROGRESS, AND THE COLOUR IS NOT MINE
 * `value / target` drawn as one pair, tinted by `xpActivityTone` imported from
 * `../ProfilePanel` — the SAME function `PromotionCard.tsx:77` uses. It is
 * imported rather than reimplemented because the rule has three edges that a
 * second copy gets wrong (0 is colourless even when the target is also 0;
 * unreadable values are colourless, not orange; only the two classes with dark
 * overrides in `index.css` may be used). Two comparison rules for one screen is
 * how a customer who met their activity volume and one who did not end up the same
 * colour. กติกาสีมีชุดเดียว — import ไม่ใช่เขียนใหม่
 * The contract's `target` exists precisely so this comparison survives the trip:
 * an earlier BE revision sent the pre-joined string `'12 / 100'`, which draws the
 * same characters and destroys the comparison.
 *
 * ## `xpAmt` for the pair, plain formatting for a lone value
 * The progress pair is money-shaped on today's card, so it uses `xpAmt` exactly
 * as the card does. A lone value goes through `Value` — see `./values.tsx` for
 * why a count must not gain two decimals.
 *
 * ## A row with no label is not drawn (contract header + `./labels.ts`)
 * Filtered BEFORE `last` is computed, so the surviving final row still loses its
 * bottom border. Filtering after would leave a hairline under the last row.
 *
 * ## Empty section ⇒ nothing, not an invented message
 * A `kv` with no drawable rows renders an empty body. The vocabulary has an
 * `empty` type carrying the provider's OWN text for that case, so inventing Thai
 * copy here would put a vendor-visible string back in the dashboard — the thing
 * this design exists to remove. REJECTED: a hardcoded "ไม่มีข้อมูล" fallback.
 *
 * revert: delete this file and its two entries in `./index.tsx` (`kv`, and the
 *         `KvRows` import in `ListSection`/`AmountRowsSection`).
 */
import React from 'react';
import { PanelRow } from '../shared/PanelRow';
import { xpAmt } from '../shared/formatters';
import { xpActivityTone } from '../ProfilePanel';
import { useI18n } from '../../../i18n';
import { resolveLabel, rowLabelSource, translateFixedValue } from './labels';
import { Value } from './values';
import type { KvRow, SectionProps } from './types';

/** The trailing note beside a value, e.g. `(87%)` — `PromotionCard.tsx:89`. */
const Suffix: React.FC<{ text?: string }> = ({ text }) =>
  text ? <span className="ml-1 text-[10px] font-bold text-blue-600">{text}</span> : null;

/**
 * The rows of a section, with no card or spacing wrapper.
 *
 * 🔴 EXPORTED BECAUSE `rows` IS NOT A `kv` FIELD — IT IS A SECTION FIELD.
 * The producer emits summary rows on `list` and `amount_rows` sections too:
 * `activity.coins` carries เหรียญล่าสุดที่มี, `finance.deposits` carries three
 * (`build-view.ts`). A `list` renderer that draws only `items` would drop them
 * silently — the card renders, looks finished, and is one row short of the
 * screen it claims to describe. Every renderer draws `rows` first.
 */
export const KvRows: React.FC<{ rows?: readonly KvRow[] }> = ({ rows }) => {
  const { t } = useI18n();
  /* Resolve and filter in one pass so `last` counts only the rows that survive. */
  const drawn = (rows ?? [])
    .map((row) => ({ row, label: resolveLabel(t, rowLabelSource(row)) }))
    .filter((x): x is { row: KvRow; label: string } => x.label !== null);

  return (
    <>
      {drawn.map(({ row, label }, i) => (
        <PanelRow key={`${label}-${i}`} label={label} last={i === drawn.length - 1}>
          {row.target !== undefined && row.target !== null ? (
            /* PROGRESS — same markup and same tone rule as the activity volume table. */
            <span data-testid="kv-progress" className={`font-bold ${xpActivityTone(row.value, row.target)}`}>
              {xpAmt(row.value)}
              <span className="text-gray-400 font-normal">/{xpAmt(row.target)}</span>
              <Suffix text={row.suffix} />
            </span>
          ) : (
            <span className={row.mono ? 'font-mono' : undefined}>
              <Value value={translateFixedValue(t, row.key, row.value)} />
              <Suffix text={row.suffix} />
            </span>
          )}
        </PanelRow>
      ))}
    </>
  );
};

/** `type: 'kv'` — the rows, in the panel's own row spacing. */
export const KvSection: React.FC<SectionProps> = ({ section }) => (
  <div className="space-y-2.5">
    <KvRows rows={section.rows} />
  </div>
);
