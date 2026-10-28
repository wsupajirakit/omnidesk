/**
 * [FEAT-20260822-NOTICERUNTIME] The shared deposit/withdraw off-service window.
 * ===========================================================================
 * Owner's spec, verbatim: "Warning_time window deposit withdraw = ช่วง
 * 23:00 - 02:00 แก้ไขได้ภายหลังอิสระยืดหยุ่น return true ถ้าอยู่ในช่วงเวลา /
 * false ถ้าไม่ (ฝากถอนใช้ window ร่วมกัน) ** เช็คเวลาแบบไทย+7".
 *
 * Pure — no imports, no clock of its own (the caller passes `now`), so anyone
 * may borrow it directly, which the owner explicitly wants. ยืมไปเรียกตรงได้.
 *
 * ⚠️ THAI WALL CLOCK, COMPUTED — NEVER the process TZ. Thailand is UTC+7
 * year-round (no DST), so a fixed offset is exact — the same rule
 * `BUSINESS_TZ_OFFSET_MINUTES` in common/utils/date-range.ts records. Reading
 * `now.getHours()` would answer in the machine's zone and be wrong on any
 * server not set to Bangkok.
 *
 * HOW TO CHANGE THE WINDOW: edit the two constants below — nothing else knows
 * the numbers. The window may cross midnight (it does today); the maths below
 * handles both crossing and non-crossing shapes, so any pair of times is legal.
 * revert: delete this file with the rest of `notice-runtime/`.
 */

/** Window start, Thai wall clock, inclusive. แก้ตรงนี้ที่เดียว. */
export const NOTICE_WINDOW_START_MIN = 23 * 60; // 23:00

/** Window end, Thai wall clock, exclusive. 02:00:00 = already outside. */
export const NOTICE_WINDOW_END_MIN = 2 * 60; // 02:00

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * true = `now` falls inside the off-service window on the Thai wall clock.
 * Start is inclusive, end is exclusive: 23:00:00 in · 01:59:59 in · 02:00:00 out.
 */
export function noticeTimeWindow(
  now: Date,
  startMin: number = NOTICE_WINDOW_START_MIN,
  endMin: number = NOTICE_WINDOW_END_MIN,
): boolean {
  // Minutes-of-day on the Bangkok wall clock, derived from the UTC instant.
  const bangkokMs = (now.getTime() + BANGKOK_OFFSET_MS) % DAY_MS;
  const minuteOfDay = Math.floor(bangkokMs / (60 * 1000));

  if (startMin === endMin) return false; // zero-length window = never on
  if (startMin < endMin) {
    // plain window, e.g. 09:00-17:00
    return minuteOfDay >= startMin && minuteOfDay < endMin;
  }
  // crosses midnight, e.g. 23:00-02:00
  return minuteOfDay >= startMin || minuteOfDay < endMin;
}
