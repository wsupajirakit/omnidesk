/**
 * [FEAT-20260826-STRIKESUSPEND] "N strikes inside H hours" — decided here.
 * ===========================================================================
 * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md` — read that
 *    first; it carries the measurements, the rejected alternatives and the
 *    owner decisions this file only implements.
 *
 * WHAT THIS DECIDES: whether a customer has earned enough rate-limit strikes,
 * recently enough, that the webhook should stop answering them entirely.
 *
 * WHY IT IS A PURE FUNCTION AND NOT AN `if` AT THE CALL SITE. Counting rows is
 * the easy half. Deciding what the count MEANS is where this goes wrong, and
 * every way it goes wrong is invisible to a type checker: an off-by-one on the
 * threshold locks nobody or locks everybody; a window computed the wrong way
 * counts all of history; a missing session read from the wrong side locks a
 * customer who has never been blocked. Split out, each of those is one
 * assertion — no database, no fake, no promise. ส่วนที่พลาดคือ "แปลว่าอะไร" ไม่ใช่ "นับยังไง"
 *
 * ⚠️ THIS IS A LATCH, NOT A ROLLING CONDITION. Once the caller writes
 * `suspended_at`, nothing here is consulted again — the customer stays locked
 * until an admin clears the session. So these functions answer "should the latch
 * be SET now", never "is the customer still over the line". Owner, 26/08:
 * *"ติดแล้วไม่นับ strike ต่อ เพราะข้อความไม่เข้าแล้ว"*.
 *
 * revert: delete this file, its spec, and the two call sites in `strike.service.ts`.
 */

/**
 * How many strikes inside the window before the customer is locked out.
 *
 * Owner, 26/08. Overridden by `STRIKE_SUSPEND_AT`.
 */
export const DEFAULT_SUSPEND_AT = 5;

/**
 * How far back to count, in HOURS.
 *
 * ⚠️ HOURS, DELIBERATELY NOT DAYS, and the unit is in the name. Hours can say
 * everything days can (a day is `24`) while days cannot say "six hours" at all;
 * `user-rate-ladder.ts` `strikeResetHours` — the counter that works in pair with
 * this one — is already in hours; and this repo puts the unit at the end of the
 * name everywhere else (`_SECONDS`, `_MS`, `_MIN`, `_TTL_SEC`).
 *
 * Starting in days would have left two bad options the first time someone wanted
 * six hours: silently change what the existing name means (anyone who had set
 * `=1` would jump from a day to an hour without being told), or add a second
 * knob doing the same job. ⇒ หน่วยอยู่ในชื่อ · ห้ามเปลี่ยนความหมายของชื่อเดิม
 *
 * Overridden by `STRIKE_SUSPEND_WINDOW_HOURS`.
 */
export const DEFAULT_SUSPEND_WINDOW_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

/**
 * The instant the counting window opens.
 *
 * ⚠️ `Math.max(hours, 1)` is a SECOND belt, not the first: `env.schema.ts`
 * already floors the value at 1. Without it a `0` would put the start AT `now`,
 * so no strike could ever fall inside the window and the feature would be
 * silently off — which is the worst way to disable something, because the log
 * and the config both still claim it is on. ปิดฟีเจอร์ต้องปิดให้เห็น ไม่ใช่ปิดโดยบังเอิญ
 */
export function suspendWindowStart(now: Date, hours: number): Date {
  const safeHours = Math.max(Number.isFinite(hours) ? hours : 0, 1);
  return new Date(now.getTime() - safeHours * MS_PER_HOUR);
}

/**
 * Has this customer earned enough strikes inside the window to be locked out?
 *
 * ⚠️ `>=`, not `>`. With `>` a threshold of 5 would need SIX strikes, so every
 * customer would sit one strike under the cap for ever and the number in the
 * config would not be the number that applies. ครบพอดีต้องติด ไม่ใช่ต้องเกิน
 */
export function shouldSuspend(
  strikesInWindow: number,
  threshold: number,
): boolean {
  if (!(strikesInWindow > 0)) return false;
  return strikesInWindow >= threshold;
}

/**
 * The tray's read, as a pipeline rather than a call.
 *
 * WHY A BUILDER AND NOT AN INLINE AGGREGATION. `z-test/lib/strike-fakes.ts` is a
 * deliberately small stand-in — its `aggregate` serves `$match` + `$group` and
 * says so loudly for anything else, which is the right call: growing it into a
 * mini-MongoDB to satisfy one screen would be a far bigger liability than the
 * screen. So the SHAPE is built here, where a test can read every stage without
 * a database, and the EXECUTION is verified against a real server.
 * (Measured 26/08 on a throwaway 200,000-customer set: 89 ms for the whole
 * thing including both joins.)
 * ไม่ขยาย fake ให้กลายเป็น mongo ปลอม — แยกรูป pipeline ออกมาให้เทสอ่านแทน
 */
export function buildSuspendedPipeline(
  limit: number,
): Record<string, unknown>[] {
  /* 🔴 CLAMPED HERE, AND BY VALUE RATHER THAN BY TYPE. The route reads
     `Number(req.query.limit)`, and a request with no `?limit=` makes that `NaN`
     — which is not `undefined`, so a default parameter never fires, and
     `Math.max(NaN, 1)` is `NaN`. The stage became `{ $limit: NaN }`, the tray
     came back empty, and the database plainly had a locked customer in it.
     TypeScript is no help: `NaN` IS a number. Found by clicking the button, not
     by a test — which is why one exists now.
     NaN ผ่าน type ได้ แต่พังเงียบ ⇒ กันด้วยค่า ไม่ใช่ด้วยชนิด */
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 200)
    : 50;
  return [
    /* [FIX-20260827-TRAYGHOST] `status: 'open'` — a cleared session keeps its
       `suspended_at` for ever (it is history, closeSession never unsets it),
       so existence alone kept every RELEASED customer in the tray. Seen live
       27/08 on the first real block/clear cycle; until then the collection had
       no rows and nothing could show it. Open sessions are the only ones that
       answer "who is the bot ignoring NOW". The partial index on
       `suspended_at` still serves this: it narrows to stamped rows, and the
       status test runs on the handful the $limit lets through.
       แถวปิด = ประวัติ ไม่ใช่สถานะ — tray ต้องกรอง open เท่านั้น
       revert: drop the `status` key (the ghost rows come back with it). */
    { $match: { status: 'open', suspended_at: { $exists: true } } },
    { $sort: { suspended_at: -1 } },
    { $limit: safeLimit },
    /* ── the join, and why it is here rather than on the client ─────────
             The tray shows a name, a phone and an OA per row. Asking for those
             one row at a time is fifty round trips for one dropdown — the
             classic N+1 — so the server pays once. It is bounded by the LIMIT
             above, never by the size of either collection.
             Measured at 200,000 customers / 200,000 strike rows (26/08): 89 ms
             for the whole thing. That is an on-demand click, not page load and
             not the webhook path, so it is the right place to spend it.
             ยอมจ่ายครั้งเดียวที่เซิร์ฟเวอร์ ดีกว่ายิงทีละแถวจากเบราว์เซอร์ */
    {
      $lookup: {
        from: 'members',
        localField: 'line_user_id',
        foreignField: 'line_user_id',
        as: 'member',
      },
    },
    /* The LATEST strike of that session decides which OA to show. A
             customer can be struck through more than one OA (the ledger is per
             customer by design), and "the one it happened through most recently"
             is the answer an admin can act on. */
    {
      $lookup: {
        from: 'member_strike_events',
        let: { sid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$session_id', '$$sid'] } } },
          { $sort: { occurred_at: -1 } },
          { $limit: 1 },
          { $project: { hook_alias: 1 } },
        ],
        as: 'latest',
      },
    },
    /* [FIX-2708-TRAYOAFALLBACK] เจ้าของ 27/08 (ภาพ): "บั๊ก line oa ไม่แสดง" —
       DB จริง: **ทุก** session ที่โดน suspend มี event = 0 (ใบ Block แอดมิน
       ไม่เคยมี strike และใบเก่าก็เขียนก่อนยุค ledger) ⇒ ทางเดิมที่อ่าน alias
       จาก event ล่าสุดว่างตลอด · fallback: ห้อง "ล่าสุด" ของลูกค้า
       (chat_rooms.updated_at) → hooks.alias ซึ่งเป็น namespace เดียวกับที่
       event เก็บ (alias จาก URL webhook) — event ยังชนะเสมอเมื่อมี ($ifNull)
       · สอง lookup นี้อยู่หลัง $limit เหมือนเพื่อน ⇒ bounded ด้วยจำนวนแถว tray
       revert: ลบสอง $lookup นี้ + คืน hook_alias เป็น $arrayElemAt ตัวเดียว */
    {
      $lookup: {
        from: 'chat_rooms',
        let: { u: '$line_user_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$line_user_id', '$$u'] } } },
          { $sort: { updated_at: -1 } },
          { $limit: 1 },
          { $project: { hook_id: 1 } },
        ],
        as: 'latest_room',
      },
    },
    {
      $lookup: {
        from: 'hooks',
        let: { hid: { $arrayElemAt: ['$latest_room.hook_id', 0] } },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$hid'] } } },
          { $project: { alias: 1 } },
        ],
        as: 'room_hook',
      },
    },
    {
      $project: {
        line_user_id: 1,
        seq: 1,
        strike_total: 1,
        suspended_at: 1,
        /* [FEAT-20260830-TRAYWHOBLOCKED] who armed the latch. Written ONLY by
           `strike-admin.service.ts` (an admin pressing Block); the strike
           ceiling never sets it. The tray needs it to say "Admin Blocked"
           instead of inferring that from `strike_total === 0` — a customer can
           legitimately hit the ceiling on a session whose counter reads 0 once
           events age out, and guessing there would label them wrongly.
           `StrikeStatsModal` already reads this same field. */
        suspended_by: 1,
        opened_at: 1,
        full_name: { $arrayElemAt: ['$member.full_name', 0] },
        display_name: { $arrayElemAt: ['$member.display_name', 0] },
        phone_number: { $arrayElemAt: ['$member.phone_number', 0] },
        hook_alias: {
          $ifNull: [
            { $arrayElemAt: ['$latest.hook_alias', 0] },
            { $arrayElemAt: ['$room_hook.alias', 0] },
          ],
        },
      },
    },
  ];
}
