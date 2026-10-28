/**
 * [FEAT-20260905-CUSTPROV] `shopapi_v1` — today's cards, expressed as `view`.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 7)
 *
 * ## What this is
 * The last piece: the provider's fields and rows composed into the closed
 * section vocabulary (`../engine/view.types.ts`). Everything it reads is already
 * proven — `field-paths.ts` and `derive-fields.ts` against the panel's own
 * expressions, `row-paths.ts` against the panel's `.map()` callbacks — so what
 * is new here is only the ARRANGEMENT.
 *
 * ## 🔴 WHAT IS DELIBERATELY NOT EMITTED, and why the list is short but real
 *
 * 1. **ข้อมูลลูกค้า (the customer-info card).** Its values are still read inline
 *    in the panel's JSX (`profile.phone`, `member_id`, `bank.*`, `truewallet`,
 *    …) and are NOT among the 26 fields. Emitting a `kv` section here would mean
 *    inventing values this provider does not resolve. Guarded by the census in
 *    `customer-provider-fields.spec.ts`, so it cannot be forgotten.
 * 2. **The point-round COUNT.** Needs the site-rules `spend_amount`, a different
 *    payload. The point round HISTORY is emitted; the count is not.
 * 3. **The pending card (รอทำรายการ).** Reads ticket/case state as well as the
 *    blob, and its deposit side is frozen by the owner (11/08).
 * 4. **The tier badge.** `tierPaths` answers that, and PART 4 owns whether it
 *    shows.
 * ห้ามแอบเติมของที่ provider ไม่ได้อ่านเอง
 *
 * ## Labels: 14 keys, the rest literals — measured, not chosen
 * `labelKey` is used only where the panel already calls `t('ticket.*')` and the
 * dictionary really has th AND en. Everywhere else the panel holds a Thai
 * literal today, so a literal is what keeps the screen identical. Sending keys
 * for those would print `panel.finance` on screen until someone shipped a
 * dictionary entry.
 *
 * revert: delete this file and the `view` key in `members.service.ts`.
 */

import type { CustomerFields } from './derive-fields';
import { SHOPAPI_V1_ROW_PATHS } from './row-paths';
import { resolveRows } from '../engine/resolve-fields';
import type {
  AmountRow,
  Chip,
  CustomerView,
  ListItem,
  Section,
} from '../engine/view.types';

/**
 * `String()` on a value that came out of a vendor blob.
 *
 * ⚠️ Named rather than inlined because eslint's `no-base-to-string` is RIGHT to
 * flag a bare `String(x)` on an `unknown`: an object would render as
 * `[object Object]` on a customer's card. Every call below has already been
 * narrowed to a leaf by the path table, and this helper is where that claim is
 * stated once instead of suppressed six times.
 */
const asText = (v: unknown): string => {
  /* Narrowed by TYPE rather than suppressed: only the primitives that have a
     meaningful text form are converted, and everything else — objects, arrays,
     functions, symbols — becomes '' so a card shows its own empty state instead
     of `[object Object]`. */
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')
    return v.toString();
  return '';
};

const R = SHOPAPI_V1_ROW_PATHS;

/** `amount_rows` from a money/bonus list. `sign` is the card's, not the data's. */
const amountRows = (
  rows: unknown,
  sign: '+' | '-',
  kind: 'money' | 'bonus',
): AmountRow[] =>
  resolveRows(rows, R[kind]!).map((r) => ({
    at: r['at'],
    amount: r['amount'],
    sign,
    status: r['status'],
  }));

export function buildShopapiV1View(f: CustomerFields): CustomerView {
  const sections: Section[] = [];

  /* ── โปรโมชั่น ─────────────────────────────────────────────────────────────
     The badge is the promotion NAME when there is one, and the "ไม่มีโปรโมชั่น"
     chip when there is not — exactly what the card header does today. */
  sections.push({
    id: 'promotion',
    type: 'kv',
    label: 'โปรโมชั่น',
    collapsed: true,
    badge: [
      f.promoName
        ? /* `info` (blue) and `muted` (grey), NOT `neutral`/`off`. The promotion
           name is a fact and the absence of one is ordinary; neither is the red
           alarm that `off` means on the finance card. See `view.types.ts` for
           the collision that split these tokens apart. */
          { key: 'promoName', label: `🎟 ${asText(f.promoName)}`, tone: 'info' }
        : { key: 'promoName', label: 'ไม่มีโปรโมชั่น', tone: 'muted' },
    ],
    rows: [
      { key: 'promoName', label: 'โปรที่ใช้อยู่', value: f.promoName },
      /* 🔴 `target`, NOT a pre-joined string. An earlier revision emitted
         `'12 / 100'` here. It renders the same characters, and it silently threw
         away the COMPARISON: the card colours the done figure by measuring it
         against the required one (`xpActivityTone`), so every activity volume row would
         have gone one flat colour whether the customer had met their target or
         not. The pair travels as a pair; the colour rule stays on the FE, where
         it already lives. */
      ...f.promoToBreakdown.map((g) => ({
        /* `activity_volume:` PREFIXED, not bare. The โปรโมชั่น card draws activity volume and
           outstanding as two separate tables, and a vendor can send the same
           product key to both — `slot` would then appear twice with no way to tell
           the tables apart. The prefix is what lets a card select one table. */
        key: `activity_volume:${g.key}`,
        label: g.key,
        value: g.done,
        target: g.required,
      })),
      /* No per-product breakdown ⇒ the single summary row, which the earlier
         revision omitted ENTIRELY. On the mock upstream, which sends activity volume as
         one number, the card drew a `Activity volume (…)` line and the view carried
         nothing at all — the section would have rendered one row short of the
         screen it claims to describe. Caught by walking the card's two branches
         rather than its happy path. */
      ...(f.promoToBreakdown.length > 0
        ? []
        : [
            {
              key: 'promoActivityVolume',
              label: `Activity volume (${asText(f.promoToUnit) || 'activity volume'})`,
              value: f.promoToDone,
              target: f.promoToReq,
              /* Only when the upstream really sends a number — `(NaN%)` on a
                 customer's card is worse than no percentage at all. */
              ...(typeof f.promoToPercent === 'number'
                ? { suffix: `(${f.promoToPercent}%)` }
                : {}),
            },
          ]),
      ...(f.promoOsBreakdown.length > 0
        ? f.promoOsBreakdown.map((g) => ({
            key: `outstanding:${g.key}`,
            label: g.key,
            value: g.amount,
          }))
        : [
            {
              key: 'promoOutstanding',
              label: 'Outstanding',
              value: f.promoOutstanding,
            },
          ]),
    ],
  });

  /* ── สินค้าที่ซื้อล่าสุด ──────────────────────────────────────────────────────
     The card stays on screen when the list is empty (`[FIX-20260801-GAMESEMPTY]`
     — it used to VANISH, which moved every card below it per customer), so an
     `empty` section is emitted rather than nothing at all. */
  const products = resolveRows(f.promoProducts, R['product']!);
  sections.push(
    products.length > 0
      ? {
          id: 'products',
          type: 'list',
          label: 'สินค้าที่ซื้อล่าสุด',
          collapsed: true,
          items: products.map((g): ListItem => ({
            label: asText(g['name']) || '-',
            secondary: [g['provider'], g['type']]
              .filter(Boolean)
              .map((x) => asText(x).toUpperCase())
              .join(' · '),
            value: g['at'],
            /* RAW, beside the rendered `secondary`. A card formats time its own
               way (`xpDT` splits epoch seconds from milliseconds by magnitude)
               and must never parse a display string as data. */
            at: g['at'],
            /* The parts `secondary` was joined from. The card builds a
               two-letter initials block from the PROVIDER alone when a product's
               image fails to load; splitting the joined string back apart gives
               the wrong letters the moment a provider is missing. */
            tags: [g['provider'], g['type']]
              .filter(Boolean)
              .map((x) => asText(x)),
            /* The amount spent, drawn after the timestamp only when present. Kept
                 separate from `value` so a product with no amount draws no trailing
                 separator and a product with no timestamp does not print its amount
                 where a date belongs. */
            amount: g['amount'],
            /* ⚠️ The RAW path. Some rows omit the scheme and the card prefixes
                 `https://` before rendering — display logic, not a lookup, so it
                 stays on the FE where the `onError` fallback also lives. */
            image: g['image'] === undefined ? undefined : asText(g['image']),
          })),
        }
      : {
          id: 'products',
          type: 'empty',
          label: 'สินค้าที่ซื้อล่าสุด',
          collapsed: true,
          text: 'ยังไม่มีสินค้าที่ซื้อล่าสุด',
        },
  );

  /* ── การเงิน ───────────────────────────────────────────────────────────────
     Two tabs, so two sections sharing a group. The auto-deposit / auto-withdraw
     badges are the card header's chips.
     ⚠️ `finAutoDep` is already a BOOLEAN by the time it arrives — the string
     'enabled' vs boolean reconciliation happened in `derive-fields.ts`, and
     redoing it here would be a second copy of that rule. */
  const financeBadge: Chip[] = [
    {
      key: 'finAutoDep',
      label: f.finAutoDep ? 'ฝาก: เปิด' : 'ฝาก: ปิด',
      tone: f.finAutoDep ? 'ok' : 'off',
    },
    {
      key: 'finAutoWd',
      label: f.finAutoWd ? 'ถอน: เปิด' : 'ถอน: ปิด',
      tone: f.finAutoWd ? 'ok' : 'off',
    },
  ];
  sections.push(
    {
      id: 'finance.deposits',
      type: 'amount_rows',
      group: 'finance',
      label: 'ประวัติฝาก',
      collapsed: true,
      badge: financeBadge,
      rows: [
        { key: 'finCredit', label: 'เครดิตคงเหลือ', value: f.finCredit },
        { key: 'finWallet', label: 'เงินค้างในกระเป๋า', value: f.finWallet },
        { key: 'finDepTotal', label: 'ยอดฝากรวม', value: f.finDepTotal },
      ],
      amountRows: amountRows(f.depRows, '+', 'money'),
    },
    {
      id: 'finance.withdrawals',
      type: 'amount_rows',
      group: 'finance',
      label: 'ประวัติถอน',
      collapsed: true,
      rows: [{ key: 'finWdTotal', label: 'ยอดถอนรวม', value: f.finWdTotal }],
      amountRows: amountRows(f.wdRows, '-', 'money'),
    },
  );

  /* ── โบนัส ─────────────────────────────────────────────────────────────────
     `rfFriends` falls back to the referral row COUNT, never to 0 — that rule
     lives in `derive-fields.ts` and is not re-implemented here. */
  sections.push(
    {
      id: 'bonus.cashback',
      type: 'amount_rows',
      group: 'bonus',
      label: 'เงินคืน',
      collapsed: true,
      rows: [
        { key: 'cbPending', label: 'ยอดรอให้กดรับ', value: f.cbPending },
        { key: 'cbClaimed', label: 'รับไปแล้วทั้งหมด', value: f.cbClaimed },
      ],
      amountRows: amountRows(f.cbHistory, '+', 'bonus'),
    },
    {
      id: 'bonus.referral',
      type: 'amount_rows',
      group: 'bonus',
      label: 'แนะนำเพื่อน',
      collapsed: true,
      rows: [
        { key: 'rfPending', label: 'ยอดรอให้กดรับ', value: f.rfPending },
        { key: 'rfClaimed', label: 'รับไปแล้วทั้งหมด', value: f.rfClaimed },
        { key: 'rfFriends', label: 'แนะนำเพื่อนแล้ว', value: f.rfFriends ?? 0 },
      ],
      amountRows: amountRows(f.rfHistory, '+', 'bonus'),
    },
  );

  /* ── กิจกรรม ───────────────────────────────────────────────────────────────
     ⚠️ The coin row's TEXT is the truthy chain plus a type-driven default — an
     algorithm, which is why it is not in `row-paths.ts`. It is applied here, at
     the one place that draws it, and nowhere else.
     ⚠️ The point round ROUND COUNT is absent and must stay absent: it needs the
     site-rules payload. The point round HISTORY is blob-only, so it is here. */
  const coins = resolveRows(f.acCoinHistory, R['coin']!);
  const pointRound = resolveRows(f.acPointRoundHistory, R['pointRound']!);
  sections.push(
    {
      id: 'activity.coins',
      type: 'list',
      group: 'activity',
      label: 'เหรียญ',
      collapsed: true,
      rows: [
        {
          key: 'acCoinBal',
          label: 'เหรียญล่าสุดที่มี',
          value: f.acCoinBal ?? 0,
        },
      ],
      items: coins.map((c, i): ListItem => {
        const src = f.acCoinHistory[i] ?? {};
        const text =
          src.note ||
          src.reason ||
          src.description ||
          src.title ||
          src.action ||
          (c['type'] === 'earn' ? 'ได้รับ' : 'ใช้ไป');
        return {
          /* [FIX-20260906-COINLABEL] `|| '-'` — the two siblings in this file
             already carry it (`asText(g['name']) || '-'`, `asText(w['prize']) || '-'`)
             and this row was the one that did not.
             WHY IT MATTERS MORE THAN AN EMPTY STRING: the chain above is TRUTHY,
             so a `note` sent as `{th:…, en:…}` — an upstream shape this module
             exists to absorb — wins it, `asText` answers '' for a non-primitive,
             and `validate-view.ts` refuses the item as `unlabelled_item`. That
             refusal condemns the WHOLE section, and `labelledChildren` spans rows
             as well as items, so the `เหรียญล่าสุดที่มี` balance dies with the bad
             history row: a customer holding 5,000 coins is shown nothing at all.
             Reproduced end to end through `viewOf`, not inferred.
             แถวเดียวพัง ทั้งการ์ดหาย รวมยอดคงเหลือด้วย */
          label: asText(text) || '-',
          secondary: asText(c['at']),
          at: c['at'],
          value: c['amount'],
          /* The direction, decided HERE from the vendor's `type`, so the card
             never has to know what that vendor calls "earned". It drives both
             the +/- prefix and the green/red the เหรียญ row is drawn in. */
          sign: c['type'] === 'earn' ? ('+' as const) : ('-' as const),
        };
      }),
    },
    {
      id: 'activity.point_round',
      type: 'list',
      group: 'activity',
      label: 'รอบสะสมแต้ม',
      collapsed: true,
      items: pointRound.map((w): ListItem => ({
        label: asText(w['prize']) || '-',
        secondary: asText(w['at']),
        at: w['at'],
        value: w['cost'] ?? 0,
      })),
    },
  );

  return { sections };
}
