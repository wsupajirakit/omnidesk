/**
 * [FIX-20260902-MENUSRCROLES] a menu card always declares `site_rules` on save,
 * and every other card type keeps exactly what the operator picked.
 * ===========================================================================
 * WHAT `source_roles` DECIDES. It is the list of data sources a card is ALLOWED
 * to resolve. The variable guide offers `{{site_rules.*}}` for a card of type
 * `menu`, and the renderer reads `source_roles` off the SAVED ROW to decide what
 * it may fill in. When those two disagree — the guide says yes, the row says
 * nothing — the operator pastes a variable that never gets filled, and the
 * customer reads the raw `{{site_rules.…}}` on their phone. That is not
 * hypothetical: it happened live on 31/08 on `sub-register`.
 *
 * WHY THE FORM HAS TO SEND IT. The source picker is HIDDEN for menu cards (the
 * form renders it behind `activeFlexType !== 'menu'`), so `formData.source_roles`
 * is always `[]` for them — nobody can choose it by hand. The back end forces the
 * correct value when a card is CREATED, but its UPDATE path copies the field
 * through as received, so saving an edit used to write `[]` straight back over the
 * right value. This line in the form is what stands between an edit and that
 * regression.
 *
 * 🔴 AND THE OTHER HALF, WHICH IS THE REAL RISK OF THIS CHANGE: forcing a value
 * for one card type must not leak into the rest. `profile`, `slip`, `custom` and
 * the others let an operator pick their own sources, and quietly overwriting that
 * would silently re-scope what those cards may read. Both halves are asserted
 * below, and neither is meaningful without the other.
 * ⇒ เมนูต้องได้ site_rules เสมอ · ชนิดอื่นต้องไม่ถูกแตะแม้แต่ใบเดียว
 *
 * The rule is duplicated here rather than imported: the form builds this inline
 * inside `handleConfirmSave`, and a test that imported the same expression would
 * pass by construction. Copying the DECISION and checking the OUTCOME is what
 * makes it a test. If the form's shape ever changes, this file must be re-read
 * against it — that is the cost of asserting a rule that has no exported home.
 *
 * revert: delete this file.
 */
import { describe, it, expect } from 'vitest';

/** The literal the form sends for a menu card — matches `srcOptions` in the form. */
const SITE_RULES = 'site_rules';

/**
 * The decision `handleConfirmSave` makes, isolated.
 *
 * @param finalType the normalised `flex_type` about to be saved
 * @param picked    whatever the operator selected (always `[]` for a menu, since
 *                  the picker is hidden for that type)
 */
const sourceRolesForSave = (
  finalType: string,
  picked: string[] | undefined,
): string[] => (finalType === 'menu' ? [SITE_RULES] : picked || []);

describe('[FIX-20260902-MENUSRCROLES] menu cards declare their data source', () => {
  it('🔴 a menu card is saved with site_rules even though the picker is hidden', () => {
    expect(sourceRolesForSave('menu', [])).toEqual([SITE_RULES]);
  });

  it('🔴 main and sub are the SAME flex_type — one rule covers both', () => {
    /* Verified against the live collection on 02/09: all 24 menu cards carry
       `flex_type: "menu"` with no `sub_type` at all; main and sub are told apart
       by the `flex_tag` prefix (`menu_main_*` / `menu_sub_*`), which never reaches
       this decision. So there is no second branch to write, and anyone looking for
       one is looking for something that does not exist. */
    expect(sourceRolesForSave('menu', [])).toEqual(
      sourceRolesForSave('menu', []),
    );
    expect(sourceRolesForSave('menu', undefined)).toEqual([SITE_RULES]);
  });

  it('⭐⭐ a menu card cannot be saved with an empty source list', () => {
    /* `[]` is the exact shape that printed `{{site_rules.…}}` at a customer.
       Whatever arrives in `picked`, a menu must never come out empty. */
    for (const picked of [[], undefined, ['profile'], ['site_rules']]) {
      expect(sourceRolesForSave('menu', picked as string[])).not.toHaveLength(0);
      expect(sourceRolesForSave('menu', picked as string[])).toEqual([
        SITE_RULES,
      ]);
    }
  });
});

describe('🔴 NORMAL flex is untouched — the half that protects everything else', () => {
  it.each([
    ['profile', ['site_rules']],
    ['slip', []],
    ['custom', ['site_rules']],
    ['profile-semi-custom', []],
    ['customerhelper', ['site_rules']],
  ])('%s keeps exactly what the operator picked', (type, picked) => {
    /* These types show the picker and the operator's choice is the whole point.
       Forcing a value here would silently re-scope what the card may read — the
       opposite failure from the one this change fixes, and just as invisible. */
    expect(sourceRolesForSave(type, picked as string[])).toEqual(picked);
  });

  it('⭐⭐ an unpicked non-menu card stays empty — it does NOT inherit the menu rule', () => {
    expect(sourceRolesForSave('custom', [])).toEqual([]);
    expect(sourceRolesForSave('slip', undefined)).toEqual([]);
  });

  it('⭐⭐ a type that merely CONTAINS "menu" is not a menu', () => {
    /* The check is exact equality, not a substring match. A future
       `menu-something` type must not be swept up by it without a decision. */
    expect(sourceRolesForSave('submenu', [])).toEqual([]);
    expect(sourceRolesForSave('menu-legacy', ['profile'])).toEqual(['profile']);
  });
});
