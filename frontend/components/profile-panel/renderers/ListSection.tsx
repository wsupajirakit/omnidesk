/**
 * [FEAT-20260905-CUSTPROV PART 7] `list` — an image, a bold label, a secondary
 * line and a trailing value.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (`list` = "สินค้าที่ซื้อล่าสุด, กิจกรรม")
 *
 * ## THE SHAPE IS `RecentProductsCard.tsx`, GENERALISED
 * Row markup, class strings, the 8×8 thumbnail, the scroll cap and the coloured
 * palette come from that card verbatim, so a `list` section looks like it
 * belongs to this panel rather than to a component library. What CHANGED is
 * where each slot's content comes from: the card reads vendor field names with
 * `??` chains (`g.product ?? g.name ?? g.catalog_name`), and a renderer must not —
 * knowing a vendor's field names is exactly what the dashboard is forbidden to
 * do. The producer resolves them and sends `label`/`secondary`/`value`/`amount`/
 * `image`. เจ้าของฟิลด์คือ BE — FE รู้แค่ช่อง
 *
 * ## 🔴 SLOT PLACEMENT FOLLOWS THE CONTRACT'S WORDS, NOT ONE CARD'S LAYOUT
 * `view.types.ts`: *"`list` — a title with a trailing value, and optional
 * secondary text"*. So `secondary` is the small grey line UNDER the title and
 * `value` is the TRAILING cell on the right. Three cards feed this primitive and
 * they do not agree with each other: สินค้าที่ซื้อล่าสุด puts its provider chip on
 * the right and its timestamp underneath, while เหรียญ and รอบสะสมแต้ม put the date on
 * the left and the amount on the right.
 * REJECTED: mirror `RecentProductsCard`'s placement exactly (secondary → the
 * coloured right-hand chip, value → the sub-line). It reproduces ONE card
 * pixel-for-pixel and costs the other two: their date would render inside a
 * coloured chip and their amount would sit where a date belongs. A primitive
 * that only fits the card it was traced from is not a primitive. Every field
 * still reaches the screen either way — what differs is which corner.
 * ยึดตามสัญญา ไม่ใช่ตามการ์ดใบเดียว
 *
 * ## 🔴 THE BROKEN-IMAGE FALLBACK IS COPIED, NOT REINVENTED
 * `RecentProductsCard.tsx:58-60, :77-91`: some upstream rows omit the scheme (so
 * `xpImageUrl` prefixes `https://`) and some URLs are dead. On error the `<img>`
 * hides itself and reveals the coloured initials block already rendered beside
 * it — a block, never a broken-image glyph. The sibling is always in the DOM
 * with `display` toggled rather than swapped in by state, because the error
 * fires during load and a state round-trip flashes the broken glyph first.
 *
 * ## `rows` FIRST, THEN `items`
 * `activity.coins` is `type: 'list'` AND carries a summary row
 * (เหรียญล่าสุดที่มี). See `KvRows` in `./KvSection.tsx` for why every renderer
 * draws `section.rows`.
 *
 * ## `value` goes through `xpMaybeDT`, not `xpText`
 * Same field, two meanings across cards: a product's `value` is when it was bought,
 * a coin row's is an amount. `./values.tsx` records the heuristic, its scope and
 * the contract field that will replace it.
 *
 * ## An item with no label is not drawn
 * `./labels.ts` — a blank row looks deliberate, which is why nobody reports it.
 * REJECTED: drawing it with a `-` placeholder. That is a visible lie about the
 * data; skipping is honest and the section still renders.
 *
 * revert: delete this file and its `list` entry in `./index.tsx`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { xpAmt } from '../shared/formatters';
import { XP_PRODUCT_COLORS } from '../ProfilePanel';
import { KvRows } from './KvSection';
import { resolveLabel } from './labels';
import { xpImageUrl, xpMaybeDT, xpText } from './values';
import type { ListItem, SectionProps } from './types';

export const ListSection: React.FC<SectionProps> = ({ section }) => {
  const { t } = useI18n();
  const drawn = (section.items ?? [])
    .map((item) => ({ item, label: resolveLabel(t, item) }))
    .filter((x): x is { item: ListItem; label: string } => x.label !== null);

  return (
    <div className="space-y-2.5">
      <KvRows rows={section.rows} />
      {/* [FIX-20260802-GAMEWRAP] cap the height and scroll inside the card — a
          real provider sent 8 rows where the mock sent 3 and the card grew until
          the ones below it fell off screen. `max-h`, not `h`, so a short list
          still shrinks and leaves no empty gap. */}
      <div className="max-h-72 overflow-y-auto custom-scrollbar pr-1">
        <div className="space-y-1">
          {drawn.map(({ item, label }, i) => {
            const [swatch] = XP_PRODUCT_COLORS[i % XP_PRODUCT_COLORS.length];
            const img = xpImageUrl(item.image);
            const secondary = xpText(item.secondary);
            const trailing = xpMaybeDT(item.value);
            const amountText = item.amount === undefined || item.amount === null ? null : xpAmt(item.amount);
            return (
              <div
                key={`${item.label ?? item.labelKey ?? 'item'}-${i}`}
                className="flex items-center gap-2 p-1.5 bg-gray-50 rounded border border-transparent hover:border-gray-200 transition-colors"
              >
                {img ? (
                  <img
                    src={img}
                    alt={label}
                    loading="lazy"
                    className="w-8 h-8 rounded object-cover shrink-0 bg-gray-200"
                    onError={(e) => {
                      /* Dead URL → hide the image and reveal the initials block
                         sitting next to it. */
                      const el = e.currentTarget;
                      el.style.display = 'none';
                      const fb = el.nextElementSibling as HTMLElement | null;
                      if (fb) fb.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  data-testid="list-item-initials"
                  className="w-8 h-8 rounded items-center justify-center text-white text-[10px] font-bold shrink-0"
                  style={{ background: swatch, display: img ? 'none' : 'flex' }}
                >
                  {label.slice(0, 2).toUpperCase()}
                </div>
                {/* min-w-0 is required: a flex child defaults to min-width:auto,
                    so a long label would push the trailing cell past the edge. */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800 leading-snug break-words">{label}</p>
                  {secondary ? (
                    <p className="text-[10px] text-gray-400 leading-tight">{secondary}</p>
                  ) : null}
                </div>
                {trailing || amountText ? (
                  <span className="text-[11px] font-bold text-gray-700 shrink-0 text-right">
                    {trailing ?? ''}
                    {/* The amountText is drawn only when the provider sent one, so a
                        row without one draws no stray separator. */}
                    {amountText ? `${trailing ? ' · ' : ''}${amountText}` : ''}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
