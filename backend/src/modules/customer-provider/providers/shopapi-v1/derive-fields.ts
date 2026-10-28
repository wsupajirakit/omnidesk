/**
 * [FEAT-20260905-CUSTPROV] `shopapi_v1` — the 9 values a PATH cannot express.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 7)
 *
 * ## WHY THESE NINE ARE CODE AND THE OTHER SEVENTEEN ARE DATA
 * Owner's design, 05/09: paths for the bulk, a function for the exceptions. The
 * exceptions are not a matter of taste — each one below does something a lookup
 * cannot:
 *
 *   finAutoDep/Wd   compares against two different TYPES ('enabled' vs true) and
 *                   switches on `!== undefined`, not on `??`
 *   rfFriends       falls back to ANOTHER field's length
 *   acCoinHistory   merges two arrays, tags each row, and sorts
 *   promoName       branches on the RUNTIME TYPE of a value
 *   promoOutstanding same
 *   promoProducts      copies then sorts
 *   promoTo/OsBreakdown  a key UNION and a key split
 *
 * Expressing any of them as data would mean inventing a DSL with comparisons,
 * type tests, sorts and set operations — i.e. a language, to avoid a function.
 * `field-options.registry.ts:25-29` names that trade the wrong way round.
 * อะไรที่เป็น "หา path" = data · อะไรที่เป็น "คิด" = ฟังก์ชัน
 *
 * ## 🔴 EVERY EXPRESSION HERE IS BYTE-IDENTICAL TO THE PANEL'S
 * Not a rewrite from understanding. `customer-provider-fields.spec.ts` reads
 * `omnidesk-console/components/member/PersonalPanel.tsx` and compares the
 * right-hand sides text for text, so "ported verbatim" is measured. The mapping
 * was derived from two live runs (2026-07-31, 2026-08-01) and had NO test
 * coverage until 05/09 — rewriting it puts blank cards on screen.
 *
 * revert: this file plus `field-paths.ts` replace `build-fields.ts` —
 *         `git show 20d301e:…/shopapi-v1/build-fields.ts` restores the single-piece
 *         version, which the golden vectors still describe exactly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped upstream blob. */

import type { Sections } from '../engine/resolve-fields';
import { xpTs, xpProductTs } from '../engine/time';

/**
 * [FIX-20260906-LISTSHAPE] A list that is not a list must give the empty answer,
 * not take the request down with it.
 *
 * WHAT WENT WRONG, reproduced through the real route rather than reasoned about.
 * `?? []` and `|| []` both defend against a list that is MISSING. Neither defends
 * against one that is PRESENT AND THE WRONG SHAPE: an upstream that sends
 * `activity.coin_received` as `{"0":{amount:5}}` instead of `[…]` yields a truthy
 * object, `.map` is not a function, and the TypeError escapes
 * `GET /api/line-users/:id/raw-profile` as a 500. One customer's stored blob then
 * breaks the profile route for that customer entirely. The panel wrote the same
 * expression, but there the throw cost one card in a browser; here it costs the
 * whole API answer.
 *
 * 🔴 WHY THE GUARD IS HERE AND NOT IN THE EXPRESSIONS. The obvious fix —
 * `asArray(activity?.coin_received).map(...)` — was written first and
 * `customer-provider-fields.spec.ts` immediately went red, correctly: that spec
 * compares each of the nine algorithms' RIGHT-HAND SIDE, normalised, against the
 * panel's own source, and its whole point is to prove the extraction was a MOVE
 * and not a rewrite. Editing the expression breaks the proof even when it does not
 * break the behaviour.
 *
 * So the shape is repaired at the BINDING instead. A wrong-shaped list is DELETED
 * from the section object, which puts it in exactly the state the expressions have
 * always handled — absent — and every one of the nine stays byte-identical to the
 * panel. The guard and the proof both hold.
 * ซ่อมรูปร่างตอนผูกตัวแปร ไม่ใช่ในนิพจน์ — นิพจน์ต้องเหมือน panel ทุกตัวอักษร
 *
 * @param section a section of the stored blob, or undefined
 * @param paths   dot-paths that MUST be arrays if they are present at all
 */
const withArrayPaths = (section: unknown, paths: string[]): any => {
  if (!section || typeof section !== 'object') return section;
  let out: any = section;
  for (const path of paths) {
    const parts = path.split('.');
    const last = parts.pop() as string;
    let parent: any = out;
    for (const p of parts) parent = parent?.[p];
    if (!parent || typeof parent !== 'object') continue;
    const v = parent[last];
    /* Absent is already the handled case; only a PRESENT non-array is repaired,
       so a well-shaped blob is returned untouched and identity is preserved. */
    if (v === undefined || Array.isArray(v)) continue;
    /* Copy on write, and only down the branch being changed: the caller's blob is
       shared with `raw_profile_data` readers (the tier port, the notice rules) and
       must not be mutated. */
    if (out === section) out = { ...section };
    let cur: any = out;
    for (const p of parts) {
      cur[p] = { ...(cur[p] as object) };
      cur = cur[p];
    }
    delete cur[last];
  }
  return out;
};

/** Every value the four section cards read, paths and algorithms together. */
export interface CustomerFields {
  depRows: any[];
  wdRows: any[];
  finCredit: any;
  finWallet: any;
  finDepTotal: any;
  finWdTotal: any;
  finAutoDep: boolean;
  finAutoWd: boolean;
  cbPending: any;
  cbClaimed: any;
  cbHistory: any[];
  rfPending: any;
  rfClaimed: any;
  rfHistory: any[];
  rfFriends: any;
  acCoinBal: any;
  acCoinHistory: any[];
  acPointRoundHistory: any[];
  promoCurrent: any;
  promoName: any;
  promoToDone: any;
  promoToReq: any;
  /* Path reads, not algorithms — they label and annotate the activity volume SUMMARY
     row. See `field-paths.ts` for why they stopped being read off the blob. */
  promoToUnit: any;
  promoToPercent: any;
  promoOutstanding: any;
  promoProducts: any[];
  promoToBreakdown: { key: string; done: any; required: any }[];
  promoOsBreakdown: { key: string; amount: any }[];
}

/**
 * The nine, computed from the sections bag and the already-resolved paths.
 *
 * 🔴 IT TAKES THE RAW SECTIONS, NOT JUST THE RESOLVED VALUES, and it has to.
 * `finAutoDep` switches on `finance.auto_deposit !== undefined` — a test the path
 * engine cannot perform for it, because `readChain` treats `null` and
 * `undefined` alike and would hand back the same answer for both. A `null`
 * `auto_deposit` means "the mock said nothing useful", and today that still
 * BEATS a real `is_auto_deposit: true`. Route it through the engine and a
 * customer with deposits switched off starts showing as switched on.
 */
export function deriveShopapiV1Fields(
  sections: Sections,
  resolved: Record<string, unknown>,
): CustomerFields {
  const bonus: any = sections?.['bonus'];
  const finance: any = sections?.['finance'];
  /* [FIX-20260906-LISTSHAPE] every list the expressions below spread or `.map`,
     repaired at the binding so the expressions stay byte-identical to the panel —
     see the helper's header for why the guard cannot live inside them. */
  const activity: any = withArrayPaths(sections?.['activity'], [
    'coin_received',
    'coin_spent',
    'coins.history',
    'point_round.history',
    'point_round_history',
  ]);
  const promotion: any = withArrayPaths(sections?.['promotion'], [
    'top_products',
    'recent_products',
  ]);

  /* 🔴 `?? []` AND `: any` ARE BOTH LOAD-BEARING, AND A TEST FOUND OUT.
     Two of the algorithms below build on a value the PATH TABLE produced, which
     means a provider that reuses these algorithms with a table that omits the key
     hands them `undefined`. The first version read `resolved['rfHistory']`
     straight and a second provider died on `.length` inside a card renderer —
     a vendor "added by editing data only" crashing on the data it edited.
     Defaulting here keeps the expressions below byte-identical to the panel's
     (`rfHistory.length`, `promoCurrent?.name`) while making a partial table
     degrade to the empty answer instead of throwing.
     ตารางขาดคีย์ = ได้ค่าว่าง ไม่ใช่พัง */
  /* [FIX-20260906-LISTSHAPE] `Array.isArray`, not a cast: the cast made a
     wrong-shaped value pass through and `rfFriends` below then read `.length` off
     an object — `undefined`, rendered as a blank count. Not compared by the
     backtest (only the nine algorithms are), so the guard can live here. */
  const rfHistoryRaw = resolved['rfHistory'];
  const rfHistory: any[] = Array.isArray(rfHistoryRaw) ? rfHistoryRaw : [];
  const promoCurrent: any = resolved['promoCurrent'];

  /* ⚠️ NOT `??`. The mock sends the STRING 'enabled'; the real one sends a
     boolean. `undefined` on the old key is what selects the new one, so a mock
     value of 'disabled' still wins over a real `is_auto_deposit: true` — which
     is the difference between showing a customer's deposits as on or off. */
  const finAutoDep =
    finance?.auto_deposit !== undefined
      ? finance.auto_deposit === 'enabled'
      : finance?.is_auto_deposit === true;
  const finAutoWd =
    finance?.auto_withdraw !== undefined
      ? finance.auto_withdraw === 'enabled'
      : finance?.is_auto_withdraw === true;

  /* Falls back to the row COUNT, not to 0 — a referral history with rows but no
     `friends_count` still shows a number.
     [FIX-20260906-REALFIELDS] `bonus?.friend_count` INSERTED IN THE MIDDLE, and
     it is the one place in this file that deliberately differs from the panel.
     The panel reads `friends_count` (with an s); the live Shop-API sends
     `friend_count` (without). Neither name is wrong — they are two upstreams —
     but with only the panel's spelling the chain fell through to the row count,
     so a customer whose payload says `friend_count: 1` beside a five-row
     `referral_history` was shown **5**. Wrong by five times, on every customer of
     that upstream, on `dev` as well as here.
     Order is the whole safety argument: the panel's spelling still wins, so
     anyone who has it reads exactly what they read before. The new name is only
     consulted when the old one is absent, and the row count still catches
     everyone who has neither.
     ⚠️ `customer-provider-fields.spec.ts` compares this expression to the panel's
     and therefore KNOWS about this divergence by name — it asserts the difference
     is exactly this insertion and nothing else. Change the shape here and that
     spec goes red, which is the point.
     ชื่อฟิลด์จริงต่างจาก panel — เติมต่อ ไม่ใช่แทนที่ */
  const rfFriends =
    bonus?.referral?.friends_count ?? bonus?.friend_count ?? rfHistory.length;

  /* The real upstream splits coins into two arrays with no `type`; the merged
     list is sorted newest-first and each row tagged so the card can colour it.
     The mock's single `history` array wins when present. */
  const acCoinHistory: any[] =
    activity?.coins?.history ??
    [
      ...(activity?.coin_received || []).map((h: any) => ({
        ...h,
        type: h?.type ?? 'earn',
      })),
      ...(activity?.coin_spent || []).map((h: any) => ({
        ...h,
        type: h?.type ?? 'spend',
      })),
    ].sort((a, b) => xpTs(b) - xpTs(a));

  /* Seen as null on the real upstream; a bare promotion NAME is also accepted. */
  const promoName =
    typeof promoCurrent === 'string' ? promoCurrent : promoCurrent?.name;

  /* The real upstream sends an object with a `total`; the mock sends a scalar. */
  const promoOutstanding =
    promotion?.outstanding && typeof promotion.outstanding === 'object'
      ? promotion.outstanding.total
      : promotion?.outstanding;

  /* Newest first — the upstream does not sort. Copied before sorting because
     `sort` mutates, and this array is shared with whoever else holds the blob. */
  const promoProducts: any[] = [
    ...(promotion?.top_products ?? promotion?.recent_products ?? []),
  ].sort((a, b) => xpProductTs(b) - xpProductTs(a));

  /* Per-category activity volume: the union of both sides' keys with `total` removed —
     `total` is shown on its own line above and would otherwise appear twice.
     ⚠️ The category names are NEVER hardcoded: a vendor that adds a product type
     gets a new row for free. */
  const promoToBreakdown: { key: string; done: any; required: any }[] =
    promotion?.activity_volume_done &&
    typeof promotion.activity_volume_done === 'object'
      ? Array.from(
          new Set([
            ...Object.keys(promotion.activity_volume_done),
            ...Object.keys(promotion.activity_volume_required || {}),
          ]),
        )
          .filter((k) => k !== 'total')
          .map((k) => ({
            key: k,
            done: promotion.activity_volume_done?.[k],
            required: promotion.activity_volume_required?.[k],
          }))
      : [];

  /* [FIX-20260905-OSBREAKDOWN] The same split for outstanding.
     🔴 MISSED BY THE FIRST PORT and caught by the census on 05/09: it is
     rendered at `PersonalPanel.tsx:2491-2503`, where the panel chooses between
     per-product rows and a one-line summary on `promoOsBreakdown.length > 0`. Had
     the panel switched to the server's answer with this absent, those rows would
     have vanished with nothing erroring. */
  const promoOsBreakdown: { key: string; amount: any }[] =
    promotion?.outstanding && typeof promotion.outstanding === 'object'
      ? Object.keys(promotion.outstanding)
          .filter((k) => k !== 'total')
          .map((k) => ({ key: k, amount: promotion.outstanding[k] }))
      : [];

  return {
    ...(resolved as unknown as CustomerFields),
    finAutoDep,
    finAutoWd,
    rfFriends,
    acCoinHistory,
    promoName,
    promoOutstanding,
    promoProducts,
    promoToBreakdown,
    promoOsBreakdown,
  };
}
