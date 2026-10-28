import { emptyCombinedProfile } from '@/modules/webhook/room-bootstrap/combined-profile';

/**
 * [FIX-20260906-EMPTYPROFILENA] The turn's starting profile must match what the spine
 * declared before this function was extracted.
 * ===========================================================================
 * THE BUG THIS PINS. `fetchCombinedProfile` returns this object from its outer catch, and
 * the spine assigns every field of it over its own defaults
 * (`webhook.service.ts:2198` declares `customerName = 'N/A'`, `:2753` overwrites it with
 * `profile.customerName`). While this function answered `undefined`, a profile fetch that
 * THREW — a Mongo hiccup, a failed system-config read, not a 404 — silently turned
 * `'N/A'` into `undefined`, and `missing-profile-reply.step.ts:42`
 * (`ctx.customerName === 'N/A'`, a strict string test) stopped matching. `dev` answered
 * that customer with the OA's `missing_api_data_text`; this lane answered nothing.
 *
 * 🔴 THE OTHER HALF MATTERS AS MUCH. Three fields must STAY `undefined`, because for them
 * `undefined` means "we never found out" and the gates fail OPEN on it. Filling them in
 * would turn "do not know" into a confident wrong answer — `followUpHasProfile: false`
 * in particular would read as "confirmed unregistered" and arm the abandon chase against
 * someone whose profile simply failed to load. That is why this spec asserts both
 * directions; a fix that set everything would pass a one-sided test.
 * ครึ่งที่ต้องเป็น undefined สำคัญเท่ากับครึ่งที่ต้องมีค่า
 */
describe('[FIX-20260906-EMPTYPROFILENA] emptyCombinedProfile', () => {
  it("⭐ the four display fields carry the spine's own defaults, not undefined", () => {
    const p = emptyCombinedProfile();
    // the exact literals dev declared at webhook.service.ts:1911-1914
    expect(p.customerName).toBe('N/A');
    expect(p.customerTel).toBe('N/A');
    expect(p.contractCode).toBe('N/A');
    expect(p.bangkokTime).toBe('');
  });

  it('⭐ the missing-profile gate matches on it — the predicate that broke', () => {
    /* Not a paraphrase: this is the step's `when` clause, copied. A test that asserted
       only `!== undefined` would pass on `null` or `''` and miss the real requirement,
       which is the exact string. */
    const ctx = { ...emptyCombinedProfile(), skipBotProcessing: false };
    expect(ctx.customerName === 'N/A').toBe(true);
  });

  it("⭐ the three 'we do not know' fields stay undefined", () => {
    const p = emptyCombinedProfile();
    expect(p.perfProfileMs).toBeUndefined();
    expect(p.profileBlock).toBeUndefined();
    expect(p.followUpHasProfile).toBeUndefined();
  });

  it('the two remaining fields are unchanged', () => {
    /* The vacuity guard: a "fix" that rebuilt the whole object could quietly change these
       two, and `profileData` is spread into the var maps while `profileCircuitOpen` gates
       a retry. */
    const p = emptyCombinedProfile();
    expect(p.profileData).toEqual({});
    expect(p.profileCircuitOpen).toBe(false);
  });
});
