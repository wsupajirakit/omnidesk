/**
 * [FEAT-20260824-BCASTTIMEDOOR] Every admin-supplied time enters through here.
 * ===========================================================================
 * Owner, 24/08: *"ทำ single truth เรื่องเวลา boardcast ต้องผ่านจุดเดียว"* ·
 * *"เวลาที่ถูกต้องใน db ห้ามงง"*.
 *
 * The written rule lives in `docs/TIME-RULE.md`. This file is that rule as code,
 * so the two cannot drift: a document nobody imports gets out of date, and five
 * copies of `new Date(x)` get edited four times.
 *
 * ── THE RULE, IN ONE LINE ────────────────────────────────────────────────────
 * DB stores UTC · UI shows +07:00 · a value with no offset means +07:00, stated
 * HERE rather than inherited from whatever timezone the server happens to run in.
 *
 * 🔴 WHY THIS EXISTS AT ALL — the failure it removes is SILENT.
 *    `<input type="datetime-local">` produces `"2026-08-24T15:00"`, with no
 *    offset, and `new Date()` reads an offset-less string as the local time OF
 *    THE PROCESS. Measured 24/08 on this machine (TZ `Asia/Bangkok`): that
 *    string became `08:00Z`, which is correct — but only by luck. On a UTC
 *    container the identical campaign stores `15:00Z`, seven hours wrong, with
 *    no error, no log and nothing in the row to say which reading happened.
 *    เครื่อง dev ตั้ง TZ ไทยเลยถูกโดยบังเอิญ · ขึ้น prod ที่เป็น UTC จะเพี้ยน 7 ชม. เงียบ ๆ.
 *
 * 🔴 IT DOES NOT ADD OR SUBTRACT HOURS, AND MUST NEVER LEARN TO.
 *    Mongo's `Date` is an instant with no zone; `2026-08-24T08:00:00.000Z` in
 *    mongosh IS 15:00 Bangkok. "Fixing" the display by storing 15:00Z is what
 *    actually breaks it — the value then reads correctly in exactly one tool and
 *    wrongly everywhere else, and every reader has to remember to subtract.
 *    ห้ามบวก/ลบชั่วโมงก่อนเก็บ — Mongo เก็บ instant ไม่ได้เก็บโซน.
 *
 * ⚠️ A VALUE WITH NO OFFSET IS NOT REJECTED — it is read at a DECLARED zone.
 *    Rejecting was the first design here and it was wrong: the dashboard's
 *    `datetime-local` boxes send offset-less strings today, so a 400 would have
 *    broken the scheduling that is already working, and any script or older
 *    client would break with it. "ห้ามพัง" outranks tidiness.
 *
 *    What the bug actually was is NOT the missing offset — it is that the
 *    meaning came from `process.env.TZ`, invisibly. So the fix is to state the
 *    zone instead of inheriting it: an offset-less value means Bangkok, here,
 *    written down, the same on every machine.
 *    บั๊กจริงคือ "ความหมายมาจาก TZ ของเครื่อง" ไม่ใช่ "ไม่มี offset"
 *    ⇒ แก้ด้วยการประกาศโซนให้ชัด ไม่ใช่ปฏิเสธค่า.
 *
 * ⚠️ THE ONE EXCEPTION, and it is deliberate: a value that is ALREADY a `Date`
 *    passes through. Those come from Mongo, which only ever hands back UTC
 *    instants — there is nothing to interpret.
 *
 * revert: inline `new Date(...)` back into the call sites and delete this file.
 * The behaviour that returns is "correct on a Bangkok server, silently wrong
 * elsewhere".
 */
import { BadRequestException } from '@nestjs/common';

/**
 * Does this string say WHICH instant it means?
 *
 * Accepts `Z`, `+07:00`, `+0700` and `-05:00`. Rejects a bare
 * `2026-08-24T15:00` and a bare `2026-08-24 15:00`.
 *
 * ⚠️ A DATE-ONLY value (`2026-08-24`) is accepted: ISO says a bare date is UTC
 * midnight, every engine agrees, and there is no hour for a zone to shift. It is
 * unambiguous in a way `T15:00` is not. วันที่ล้วนไม่กำกวม — ที่กำกวมคือมีเวลาแต่ไม่มีโซน.
 */
export function carriesOffset(value: string): boolean {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(v);
}

/**
 * The zone an offset-less value is read at. `+07:00`, stated once.
 *
 * 🔴 A CONSTANT, NOT `process.env.TZ`. Reading the environment is exactly the
 *    behaviour this module exists to remove: it makes the same stored campaign
 *    mean different instants on a laptop and in a container.
 * ⚠️ Thailand has no DST, so a fixed offset is correct all year. A country that
 *    observed DST would need a real zone database and this would be wrong.
 */
export const DEFAULT_INPUT_OFFSET = '+07:00';

/**
 * The ONLY door for a time an admin supplied.
 *
 * @param label the field name, so the 400 says WHICH box was wrong.
 * @returns a `Date`, or `undefined` when nothing was supplied — absent stays
 *   absent, and an empty box never becomes "now".
 */
export function parseAdminTime(
  value: unknown,
  label: string,
): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  /* Already an instant — it came out of Mongo. Nothing to interpret. */
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException(`${label} is invalid`);
    }
    return value;
  }

  if (typeof value === 'number') {
    /* Epoch milliseconds are an instant too, and carry no ambiguity. */
    const fromEpoch = new Date(value);
    if (Number.isNaN(fromEpoch.getTime())) {
      throw new BadRequestException(`${label} is invalid`);
    }
    return fromEpoch;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${label} is invalid`);
  }

  /* 🔴 STATED, NOT INHERITED. An offset-less string gets `DEFAULT_INPUT_OFFSET`
     appended so `new Date` cannot fall back to the process timezone. The value
     the admin typed keeps its meaning on every machine.
     เติม offset ที่ประกาศไว้ ⇒ ความหมายไม่ขึ้นกับ TZ ของเครื่องอีกต่อไป. */
  const raw = value.trim();
  const withZone = carriesOffset(raw)
    ? raw
    : `${raw.length === 16 ? `${raw}:00` : raw}${DEFAULT_INPUT_OFFSET}`;

  const parsed = new Date(withZone);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return parsed;
}
