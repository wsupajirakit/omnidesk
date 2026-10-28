/**
 * ==== [FEAT-20260824-BCASTENABLED] what the สถานะ column is actually about ===
 *
 * Owner, 24/08: "สถานะ คือเปิด ปิด ใช้งาน ไม่ใช่ส่งแล้ว" and
 *               "1 job มันส่งได้หลายครั้ง การดูว่าเสร็จไหม ไปดูใน history".
 *
 * The list used to print the job LIFECYCLE (ฉบับร่าง / ตั้งเวลา / ส่งแล้ว) in
 * that column. With repeat schedules a single job sends over and over, so
 * "ส่งแล้ว" answers a question nobody asked — whether a particular RUN finished
 * is a history question. What the column has to answer at a glance is: is this
 * campaign armed right now, yes or no.
 *
 * 🔴 THE ONE RULE THAT MATTERS — `enabled === false` IS THE ONLY "OFF".
 *    Mongo stores `null` for a declared-but-unset field, so a schedule saved
 *    before the toggle existed arrives as `{ enabled: null }`, and a partial
 *    write arrives with the key missing. Treating either as off has ALREADY
 *    caused a real outage: live campaigns rendered as ปิด, an admin "fixed"
 *    them, and the toggling churned the schedule. Falsy-checking this field
 *    (`!schedule.enabled`, `schedule.enabled ?? false`) reintroduces that bug.
 *    null/undefined = เปิด. มีแต่ false เท่านั้นที่แปลว่าปิด.
 *
 * THE THIRD STATE IS NOT A ROUNDING ERROR. A row with no `schedule` object at
 * all never had a repeat rule — it is a one-off campaign. It is not "on" (there
 * is no recurring rule to be on) and it is not "off" (nobody turned anything
 * off). Folding it into either one tells the admin something untrue, so it gets
 * its own value and its own neutral badge. ไม่มีรอบส่งซ้ำ ≠ ปิดอยู่.
 *
 * revert: delete this file and BroadcastEnabledBadge.tsx, and put the
 *         lifecycle <StatusBadge> back in the สถานะ cell of Broadcasts.tsx.
 */

export type BroadcastEnableState = 'on' | 'off' | 'one_off';

/** Only the field that decides; keeps the helper usable from tests and from the row type alike. */
export interface ScheduleEnabledLike {
  enabled?: boolean | null;
}

/**
 * Resolve the on/off/one-off state of a broadcast row from its schedule.
 * @param schedule the row's `schedule` — absent/null means the job has no repeat rule.
 */
export const resolveBroadcastEnableState = (
  schedule?: ScheduleEnabledLike | null,
): BroadcastEnableState => {
  // No repeat rule was ever configured → one-off, which is neither on nor off.
  if (schedule === null || schedule === undefined) return 'one_off';
  // 🔴 Strict `=== false`. null / undefined / true all mean ON. ห้ามใช้ falsy check.
  return schedule.enabled === false ? 'off' : 'on';
};

/**
 * Thai labels, hard-coded on purpose for now.
 * ⚠️ TODO(i18n): move to `broadcast.enabled_*` in i18n/translations/*.json — that
 * file is owned by another change in flight, so the strings live here meanwhile.
 */
export const BROADCAST_ENABLE_LABEL: Record<BroadcastEnableState, string> = {
  on: 'เปิดใช้งาน',
  off: 'ปิดใช้งาน',
  one_off: 'ส่งครั้งเดียว',
};

/** Hover text that spells out why a one-off row shows no on/off at all. */
export const BROADCAST_ENABLE_HINT: Record<BroadcastEnableState, string> = {
  on: 'ตั้งรอบส่งซ้ำไว้และกำลังทำงาน',
  off: 'ตั้งรอบส่งซ้ำไว้แต่ถูกปิดอยู่',
  one_off: 'ไม่ได้ตั้งรอบส่งซ้ำ — ไม่มีสถานะเปิด/ปิด',
};
