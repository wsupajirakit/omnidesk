/**
 * [FEAT-20260905-CUSTPROV] `shopapi_v1` — where the fields INSIDE a row live.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 7)
 *
 * ## WHY THIS EXISTS — a measurement, not a hunch
 * The 26 card values carry ROWS as raw arrays, and every card then reads that
 * vendor's field names again at draw time. Counted on 05/09 across the panel's
 * `.map()` callbacks: **~26 vendor field names over 5 row kinds** — as large as
 * the card values themselves.
 *
 *   products      13   product/name/catalog_name · provider/product_name · product_type ·
 *                   image/catalog_image_path · played_at/at/date/updated_at/created_at
 *   money       4   at/date · amount · status          (deposit, withdraw)
 *   bonus       4   at/date · amount · status          (cashback, referral)
 *   coin        9   at/date · note/reason/description/title/action · type · amount
 *   point round       7   at/date · prize/reward/name · coins_spent/coin_spent/cost
 *   statement   4   date/at · amount · type · status
 *
 * 🔴 SO A `view` THAT CARRIED RAW ROWS WOULD NOT FINISH THE JOB. The front end
 * would still have to know that this vendor calls a product's name `catalog_name`,
 * and adding provider B would still be a two-repo change — the exact outcome
 * PART 7 §38 exists to prevent. Rows have to be normalised too.
 * ส่งแถวดิบ = FE ยังต้องรู้ชื่อฟิลด์ของเจ้านี้อยู่ดี
 *
 * ## Why it is the SAME mechanism, not a new one
 * A row field is a value at a path, one level down. It reuses `readChain` — no
 * new syntax, no new engine, and a vendor edits data here exactly as it does in
 * `field-paths.ts`.
 *
 * ⚠️ Declared here, consumed when `view.sections` ships. Same status `tierPaths`
 * had: the data that describes today's behaviour, written where the next step
 * will look for it. Nothing reads it yet, and it is proven by vectors so that
 * when something does, the answer is already known to be right.
 *
 * revert: delete this file; nothing imports it outside its spec.
 */

import type { FieldPathMap } from '../engine/resolve-fields';

/**
 * 🔴 `at` DIFFERS BETWEEN THE TWO PENDING PIPES, AND THAT IS REAL.
 * `PersonalPanel.tsx:1811` reads a pending WITHDRAW as `r.at ?? r.date`;
 * `:1857` reads a pending DEPOSIT as `r.date ?? r.at`. Opposite order, same
 * feature, and the deposit side is frozen by the owner (11/08: *"ฝากมาจาก
 * statement อย่าไปยุ่ง"*) because it is the list the slip matcher reads.
 * Two entries, each true where it is used. Do not "unify" them — one of the two
 * screens would start reading a different timestamp with nothing to say so.
 */
export const SHOPAPI_V1_ROW_PATHS: Readonly<Record<string, FieldPathMap>> = {
  /** ประวัติฝาก / ประวัติถอน — `finance.transactions.*` or `recent_*`. */
  money: {
    at: { paths: ['at', 'date'] },
    amount: { paths: ['amount'] },
    status: { paths: ['status'] },
  },

  /** เงินคืน / แนะนำเพื่อน — same three, and deliberately a separate entry:
   *  the two cards drew from different upstream keys before today and a shared
   *  table would hide the day they diverge again. */
  bonus: {
    at: { paths: ['at', 'date'] },
    amount: { paths: ['amount'] },
    status: { paths: ['status'] },
  },

  /** สินค้าที่ซื้อล่าสุด — the widest disagreement between the two upstreams. */
  product: {
    name: { paths: ['product', 'name', 'catalog_name'] },
    provider: { paths: ['provider', 'product_name'] },
    type: { paths: ['product_type'] },
    /* ⚠️ The RAW image. Some upstream rows omit the scheme (`cdn.x/y.png`), and
       the panel prefixes `https://` before rendering. That prefixing is display
       logic, not a lookup, so it stays out of this table. */
    image: { paths: ['image', 'catalog_image_path'] },
    at: { paths: ['played_at', 'at', 'date', 'updated_at', 'created_at'] },
    /* [FEAT-20260905-CUSTPROV] The amount spent, added 05/09 when the card's second
       line was transcribed rather than skimmed: it prints
       `ซื้อล่าสุด <time>{amount ? ' · ' + amount : ''}`. Absent on both upstreams
       today, which is precisely why it was nearly missed — the happy path shows
       nothing either way. A vendor that sends one now reaches the screen. */
    amount: { paths: ['amount'] },
  },

  /** เหรียญ — `activity.coins.history`, or the merged received/spent pair. */
  coin: {
    at: { paths: ['at', 'date'] },
    type: { paths: ['type'] },
    amount: { paths: ['amount'] },
    /* ⚠️ The row's TEXT is NOT here. The panel reads
       `note || reason || description || title || action` — a TRUTHY chain, not
       `??`, so an empty-string note falls through — and then falls back to
       "ได้รับ"/"ใช้ไป" chosen by `type`. A truthy chain and a type-driven
       default are an algorithm, and algorithms live in `derive-fields.ts`.
       Putting it here would need a second chain rule invented for one field. */
  },

  /** รอบสะสมแต้ม — `activity.point_round.history` / `point_round_history`. */
  pointRound: {
    at: { paths: ['at', 'date'] },
    /* [FIX-20260906-REALFIELDS] `note` APPENDED, never inserted. The first three
       are the panel's own chain and stay first, so any customer whose upstream
       sends one of them reads exactly what they read before this line existed.
       WHY IT WAS ADDED: the live Shop-API sends none of the three. A real row is
         { date, note: "ได้รับของสมนาคุณจำนวน 5 เครดิต", reward_amount: 5, reward_type }
       so every point round row rendered a bare `-` while the prize sat in `note`,
       unread — on both this lane and `dev`, because the chain was transcribed
       faithfully from a panel that never saw this upstream.
       ⚠️ `reward_amount` is deliberately NOT added to `cost` below: the third
       column is what the round COST, and the reward is not the cost. The spend
       lives in `activity.coin_spent` ("สุ่มของสมนาคุณรอบสะสมแต้มจำนวน 3 เหรียญ"), a
       different list, so a fallback there would print a reward as a charge.
       ต่อท้ายเท่านั้น ของเดิมยังชนะก่อนเสมอ */
    prize: { paths: ['prize', 'reward', 'name', 'note'] },
    cost: { paths: ['coins_spent', 'coin_spent', 'cost'] },
  },

  /** รอถอน — from `finance` (`wdRows`), filtered by the pending rule. */
  pendingWithdraw: {
    at: { paths: ['at', 'date'] },
    amount: { paths: ['amount'] },
    status: { paths: ['status'] },
  },

  /** รอฝาก — from `profile.transaction.statement`. See the warning above: the
   *  timestamp order is the OPPOSITE of every other row kind, on purpose. */
  pendingDeposit: {
    at: { paths: ['date', 'at'] },
    amount: { paths: ['amount'] },
    type: { paths: ['type'] },
    status: { paths: ['status'] },
  },
};
