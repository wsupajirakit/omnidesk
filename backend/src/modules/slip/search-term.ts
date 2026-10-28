/**
 * [FEAT-20260823-SLIPPHONE] What the operator typed — decided WITHOUT touching a
 * database.
 * ===========================================================================
 * `slip-verification.service.ts` has one search box that already means three
 * different queries (`[FEAT-20260817-SLIPSEARCHID]`). This file holds the two
 * shape questions that were about to grow a parser inside `searchFilter`, so
 * that file stays a list of branches and these rules can be tested on their own.
 *
 * ⚠️ EVERYTHING HERE IS PURE. No I/O, no model, no clock. That is deliberate:
 * the member lookup a phone needs happens in `list()`, where I/O already lives,
 * so `searchFilter` and `buildFilters` stay synchronous. Making them async would
 * have spread `await` through a call chain for one branch of one box.
 * ห้ามใส่ I/O ในไฟล์นี้ — มันคือเหตุผลที่ searchFilter ยังไม่ต้องเป็น async.
 *
 * revert: delete this file; inline the two regexes back into `searchFilter` and
 *         drop the phone branch. Nothing else imports it.
 */

/**
 * A LINE user id, normalised to the ONE spelling the collection stores.
 *
 * ⚠️ THE BUG THIS FIXES — the shape test was `/^U[0-9a-f]{32}$/i`, which ACCEPTS
 * lowercase, and the branch then compared the typed term to the stored value
 * with plain equality. The rows store `U` uppercase + hex lowercase, so a
 * pasted `u2e2f…` matched the regex, took the exact-id branch, and returned an
 * empty page with no error — the very trap the 17/08 note warns about.
 * Measured on real data before the fix: `U2e…` → 81 rows, `u2e…` → 0 rows.
 *
 * Lowercasing the whole thing is equally wrong: the stored value's first
 * character is an uppercase `U`. Each half is normalised to its own case.
 * ตัวแรกพิมพ์ใหญ่ · ที่เหลือพิมพ์เล็ก · ไม่ใช่ toUpperCase ทั้งก้อน.
 *
 * @returns the canonical `U…` form, or null when the term is not a LINE id.
 */
export function normalizeLineUserIdTerm(term: string): string | null {
  if (!/^U[0-9a-f]{32}$/i.test(term)) return null;
  return `U${term.slice(1).toLowerCase()}`;
}

/**
 * A Thai mobile number, normalised to the ten digits the member rows store.
 *
 * Accepts what an operator actually pastes — spaces, dashes, dots, brackets,
 * and the `+66` / `66` country form — and returns `0` + nine digits, which is
 * the exact shape `members.phone_number` holds (verified against real rows).
 *
 * ⚠️ FULL NUMBERS ONLY, by the owner's decision (23/08). A partial number was
 * designed and dropped: `explain` on the real collection showed a trailing
 * match (`/2251$/`) examining EVERY key in the index — a collection scan in all
 * but name — and the pre-tokenised `search.phone_number` bucket that would have
 * avoided it is filled only for members written since 21/08, with no backfill.
 * So a partial search would have been either a scan or a half-answer.
 * เบอร์เต็มเท่านั้น · ค้นบางส่วน = สแกนทั้ง index หรือได้คำตอบไม่ครบ.
 *
 * @returns ten digits starting `0`, or null when the term is not a phone.
 */
export function normalizePhoneTerm(term: string): string | null {
  const digits = term.replace(/[\s\-().]/g, '');

  const local = digits.startsWith('+66')
    ? `0${digits.slice(3)}`
    : digits.startsWith('66')
      ? `0${digits.slice(2)}`
      : digits;

  /* ⭐ THE ONLY TEST, and it is enough. An earlier draft screened the raw digits
     with `/^(\+?66|0)\d{8,9}$/` first; a mutation run left every case green with
     that line deleted, and a 200,280-input sweep of both versions found ZERO
     inputs where they disagree — the country-code rewrite can only ever produce
     ten characters starting `0` from an input this line would have accepted, so
     the screen was pure ceremony. It was removed rather than kept "for safety":
     a line that cannot change an answer is weight, not defence.
     ⚠️ Do not re-add it without a failing input to justify it.
     เช็คที่พิสูจน์แล้วว่าไม่เปลี่ยนคำตอบ = หนี้ ไม่ใช่ความปลอดภัย. */
  return /^0\d{9}$/.test(local) ? local : null;
}
