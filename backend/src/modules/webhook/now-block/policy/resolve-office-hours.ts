/**
 * [FEAT-20260902-NOWBLOCK] Which window applies to THIS reply — one decision point.
 * ===========================================================================
 * `office-hours.ts` holds the numbers. This file answers "whose numbers", and it is
 * the only thing that ever will. Every caller asks this function instead of reading
 * the constants, so the day the window depends on which OA is asking, the change is
 * this function body and nothing else. ท่อเผื่อไว้แล้ว — วันเปลี่ยนเป็นราย OA แก้ที่นี่ที่เดียว
 *
 * ── WHY THIS EXISTS AT ALL, WHEN THE CONSTANTS WERE ALREADY IN ONE FILE ────
 * Owner, 03/09/2026: *"ต้องสเกลได้ แยกอิสระ ห้ามกระทบ"*, and *"10:00-19:00 มันแค่ตัวอย่าง"*.
 * Before this file, the numbers were changeable — edit one constant — but not
 * SCALABLE: `NowBlockInput` accepted `openMin`/`closeMin` overrides and the seat
 * never passed them, so nothing except a spec could ever vary the window. One server
 * had exactly one window, permanently. That is the gap this closes.
 *
 * ── THE LADDER — deliberately the same shape as the switch next door ───────
 *   layer 1  hook   NOT READ YET. Accepted from day one so per-OA is a one-line
 *                   change here and no call site moves.
 *   layer 2  const  the values in `office-hours.ts`.
 * Identical to `resolveNowBlockMode`, on purpose: two seams that behave the same way
 * are two seams a reader only has to understand once.
 *
 * ── "ห้ามกระทบ" IS A REAL CONSTRAINT, NOT A SLOGAN ─────────────────────────
 * This file imports only its own policy constants. Nothing outside `now-block/`
 * imports it. Deleting the folder is still the whole revert, and a window change can
 * never reach the slip cards, the notice runtime, or any other clock in this repo.
 *
 * revert: delete the `now-block/` folder.
 */
import {
  OFFICE_CLOSE_MIN,
  OFFICE_HOURS_TEXT,
  OFFICE_OPEN_MIN,
} from './office-hours';

/**
 * A resolved service window.
 *
 * ⚠️ `closeMin` is INCLUSIVE here — the closing minute itself is still open. The
 * arithmetic in `now-status.ts` reconciles that against `noticeTimeWindow()`'s
 * exclusive end in exactly one place; do not "fix" the asymmetry in passing.
 */
export interface OfficeHours {
  /** Minutes since Bangkok midnight when the window opens. Inclusive. */
  openMin: number;
  /** Minutes since Bangkok midnight when it closes. Inclusive. */
  closeMin: number;
  /** The customer-facing sentence. Travels into the prompt, so it is written for a customer. */
  text: string;
}

/**
 * The window that applies to this reply.
 *
 * @param _hook the OA document, accepted today and deliberately not read — layer 1.
 *
 * ⚠️ THE UNDERSCORE IS LOAD-BEARING. `noUnusedParameters` is on (tsconfig.json:31);
 * the `void` below satisfies eslint. Together they say "kept on purpose" more loudly
 * than a disable comment. Same pair as `resolveNowBlockMode(_hook)` and
 * `mustRecheckCeiling(_trigger)` (content/broadcast-send/run-trigger.ts:59).
 *
 * ⚠️ It returns a FRESH object every call. A shared frozen constant would be cheaper
 * by an allocation nobody can measure, and would mean a future per-OA branch could
 * hand two OAs the same mutable object — the sort of bug that only shows up under
 * load, in production, in one tenant.
 */
export function resolveOfficeHours(
  _hook: Record<string, unknown> | null | undefined,
): OfficeHours {
  void _hook;

  /* layer 1 — per-OA. Intentionally empty: no OA carries such a field today.
     When it lands it reads the window off `_hook` here, validates it (an OA-supplied
     window is untrusted input in a way a constant never is), and falls through to
     the constants below when absent or unusable. */

  // layer 2 — the server-wide policy, and the only rung with a value today.
  return {
    openMin: OFFICE_OPEN_MIN,
    closeMin: OFFICE_CLOSE_MIN,
    text: OFFICE_HOURS_TEXT,
  };
}
