/**
 * [FIX-20260829-LOCKEDTYPERESET] "เพิ่มเมนู" must actually create a MENU card.
 *
 * 🔴 THE BUG THIS PINS, found by clicking the real UI and not by any test:
 * the create path reset the form to `DEFAULT_FORM`, whose `flex_type` is
 * `'slip'`. The effect that applied the locked type ran BEFORE that reset and
 * was wiped — the button said "เพิ่มเมนู", the card saved as a SLIP, and nothing
 * reported a thing. It surfaced only as a slip row sitting in the Normal tab.
 *
 * Two assertions, because the value alone is not the whole rule:
 *   1. the decision itself — a locked type wins, an unlocked one is untouched;
 *   2. a SOURCE CENSUS that no bare `setFormData(DEFAULT_FORM)` returns. That is
 *      the shape of the bug: a second reset added months from now would undo the
 *      lock again while every value test stayed green.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createFormFor } from '../components/flex/FlexMessageFormModal';

describe('[FLEXMENULOCK] a locked type survives the create reset', () => {
  it('🔴🔴🔴 a locked menu start is a MENU form, not slip', () => {
    expect(createFormFor('menu').flex_type).toBe('menu');
  });

  it('⭐⭐ no lock ⇒ the old default, unchanged', () => {
    expect(createFormFor().flex_type).toBe('slip');
    expect(createFormFor(undefined).flex_type).toBe('slip');
  });

  it('⭐⭐ the menu-only fields still start EMPTY — optional stays optional', () => {
    const f = createFormFor('menu');
    expect(f.flex_sub_type).toBe('');
    expect(f.flex_slug).toBe('');
  });

  it('⭐ a locked start does not disturb anything else on the form', () => {
    const locked = createFormFor('menu');
    const plain = createFormFor();
    const { flex_type: _a, ...restLocked } = locked;
    const { flex_type: _b, ...restPlain } = plain;
    expect(restLocked).toEqual(restPlain);
  });

  it('🔴🔴🔴 SOURCE CENSUS — no bare `setFormData(DEFAULT_FORM)` may return', () => {
    /* The reset must always go through `createFormFor`. A bare one is exactly
       what caused the bug, and no behavioural test can catch its return. */
    const raw = readFileSync(
      resolve(__dirname, '../components/flex/FlexMessageFormModal.tsx'),
      'utf8',
    );
    /* Comments are stripped first: the note explaining this rule quotes the very
       pattern it forbids, and a census that trips on its own documentation would
       be worse than none. */
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('setFormData(createFormFor(lockedFlexType))');
    expect(code).not.toMatch(/setFormData\(\s*DEFAULT_FORM\s*\)/);
  });
});
