/**
 * [REFACTOR-20260904-OBJFORMSPLIT] `storageOptionsFor` — the rule that decides
 * which storage values the Object album picker lists.
 *
 * 🔴 WHY THIS FILE EXISTS NOW. The function has carried the sentence *"Exported
 * so this rule can be tested without mounting the whole form"* since it was
 * written — and nothing ever imported it. A grep across the repo found the
 * export used only by the modal that declares it. So the reason it was exported
 * was never collected, while the comment implied it had been.
 *
 * The rule is worth a test on its own terms: getting it wrong MOVES CUSTOMER
 * DATA silently. A `<select>` whose value matches no option renders the first
 * option instead, so an album stored on `google_drive` would display "local"
 * and the next save would quietly relocate it.
 */
import { describe, it, expect } from 'vitest';
import {
  storageOptionsFor,
  OFFER_GOOGLE_DRIVE,
} from '../components/object/form/storageOptions';

describe('[OBJFORMSPLIT] storageOptionsFor', () => {
  it('the offer is withdrawn by default — a new album cannot pick Drive', () => {
    /* Pins the shipped state of the flag, not just the function: flipping it
       is a deliberate act and should have to update this line. */
    expect(OFFER_GOOGLE_DRIVE).toBe(false);
    /* ⚠️ [UI-20260904-LOCALONLY] `external` left the default list on 04/09 —
       the owner asked for a single destination. Same rule Drive already
       followed: withdrawn from the offer, still shown to an album that holds
       it. These expectations moved with the rule, not around it. */
    expect(storageOptionsFor(undefined)).toEqual(['local']);
    expect(storageOptionsFor('local')).toEqual(['local']);
  });

  it('🔴 an album ALREADY on google_drive still gets the option', () => {
    /* The whole point. Without this the value has no matching option, the
       select falls back to the first one, and saving moves the album. */
    expect(storageOptionsFor('google_drive')).toEqual([
      'local',
      'google_drive',
    ]);
  });

  it('turning the offer back on adds it for everyone', () => {
    expect(storageOptionsFor(undefined, true)).toEqual([
      'local',
      'google_drive',
    ]);
  });

  it('never lists a value twice, even when both reasons apply', () => {
    /* `offerGoogleDrive` true AND current === 'google_drive' must not append
       the option twice — a duplicated <option> renders as two identical rows. */
    expect(storageOptionsFor('google_drive', true)).toEqual([
      'local',
      'google_drive',
    ]);
  });

  it('an unknown stored value does not add an option of its own', () => {
    /* A row holding something outside the enum must not widen the picker; it
       falls back to the base pair like any other non-Drive value. */
    expect(storageOptionsFor('s3')).toEqual(['local']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   [UI-20260904-LOCALONLY] external follows the SAME rule Drive does
   ══════════════════════════════════════════════════════════════════════════ */
describe('[LOCALONLY] withdrawing external does not move an album that holds it', () => {
  it('🔴 an album ALREADY on external still gets the option', () => {
    /* A `<select>` whose value matches no option renders the FIRST one. Drop
       this and opening such an album shows "local", and pressing save moves it
       — silently, with no edit anybody made. Exactly the hazard the Drive rule
       above was written for. ตัวเลือกต้องมี ไม่งั้นกดเซฟแล้วย้ายที่เก็บเงียบ ๆ */
    expect(storageOptionsFor('external')).toEqual(['local', 'external']);
  });

  it('turning the offer back on adds it for everyone', () => {
    expect(storageOptionsFor(undefined, false, true)).toEqual([
      'local',
      'external',
    ]);
  });

  it('never lists a value twice when both reasons apply', () => {
    expect(storageOptionsFor('external', false, true)).toEqual([
      'local',
      'external',
    ]);
  });

  it('both withdrawn choices can still show together for an album that holds one', () => {
    expect(storageOptionsFor('google_drive')).toEqual(['local', 'google_drive']);
    expect(storageOptionsFor('external')).toEqual(['local', 'external']);
  });
});
