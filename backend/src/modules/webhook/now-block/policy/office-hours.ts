/**
 * [FEAT-20260902-NOWBLOCK] The service window — THE ONLY PLACE THE NUMBERS LIVE.
 * ===========================================================================
 * Why this file exists on its own: the point of the whole feature is that the
 * office-hours decision stops being something a language model works out in its
 * head on every answer. Once code owns the decision, the numbers behind it must
 * be changeable by someone who never reads the logic. Everything below the
 * constants is arithmetic; everything a policy change touches is here.
 * แก้เวลาทำการ = แก้ไฟล์นี้ไฟล์เดียว ไม่ต้องอ่านตรรกะข้างล่างเลย
 *
 * ── HOW TO CHANGE THE POLICY ───────────────────────────────────────────────
 * Edit the two minute constants and the display string. Nothing else in the
 * repo knows these numbers. The display string is what a customer can end up
 * reading, so it is written for a customer, not for a developer.
 *
 * ── WRAPPING WINDOWS ARE SUPPORTED, AND WHY THAT MATTERS ───────────────────
 * A window may cross midnight. This is not hypothetical: the live time rule
 * this feature was born from is the 23:00-02:00 deposit/withdraw maintenance
 * band. A maintenance band is expressed here as its COMPLEMENT — the hours the
 * service IS available — so "closed 23:00-02:00" is written as a service
 * window of 02:00-23:00, which does not wrap at all.
 *
 * ⚠️ A naive `open <= m && m < close` silently reports "always closed" for any
 *    wrapping window, with no error and no failing test unless someone thought
 *    to write the case. The comparison in `now-status.ts` handles both shapes,
 *    and it does so by borrowing `noticeTimeWindow()` rather than writing a
 *    second copy of the same arithmetic.
 *
 * ── UNITS ──────────────────────────────────────────────────────────────────
 * Minutes since midnight on the THAI wall clock. Not a Date, not a string —
 * an integer, so the comparison downstream is integer comparison with no
 * parsing, no Date arithmetic and no daylight-saving question.
 *
 * revert: delete the `now-block/` folder.
 */

/**
 * Service opens — inclusive. 10:00 exactly is OPEN.
 *
 * ⚠️ VALUE NOT YET CONFIRMED AGAINST A LIVE OA. Measured 02/09/2026: no OA in
 * this database states 10:00-19:00 anywhere; the two live training documents
 * say the service runs 24 h. Treat these as the DEFAULT SHAPE, not as the
 * shipped policy — the feature is off by default precisely so that the numbers
 * can be settled after the mechanism exists. See be_todo121 §P0.
 */
export const OFFICE_OPEN_MIN = 10 * 60; // 10:00

/**
 * Service closes — the boundary itself is still OPEN.
 * 19:00:00 → OPEN · 19:00:01 → AFTER_CLOSE. Chosen deliberately: a customer who
 * asks exactly on the hour is inside, not outside.
 */
export const OFFICE_CLOSE_MIN = 19 * 60; // 19:00

/**
 * The one line a customer may end up reading, through the model.
 * Keep it in the customer's language and keep it consistent with the two
 * numbers above — nothing derives this string, so a mismatch here is invisible
 * to every test in this repo.
 */
export const OFFICE_HOURS_TEXT = '10:00-19:00 ทุกวัน';
