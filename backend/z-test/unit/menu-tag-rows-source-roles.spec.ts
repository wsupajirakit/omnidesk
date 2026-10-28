/**
 * [FIX-20260902-MENUSRCROLES] every migrated menu row declares its data source.
 * ===========================================================================
 * WHAT `source_roles` DECIDES. The flex editor's variable guide offers
 * `{{site_rules.*}}` for a card of type `menu`, and the central builder reads
 * `source_roles` OFF THE ROW to decide which of those it may actually resolve.
 * The two must agree. When they do not — guide says yes, row says nothing — the
 * operator pastes a variable the builder will not fill, and the customer reads
 * the raw `{{site_rules.…}}` on their phone. That happened: 31/08, live, on
 * `sub-register`.
 *
 * The product fixed it at the source: `flex-messages.service.ts` FORCES
 * `source_roles = MENU_SOURCE_ROLES` on every save of a `menu` card, so nothing
 * saved through the app can carry `[]` any more.
 *
 * 🔴 WHY THIS FILE EXISTS ANYWAY. `migrate-menu-tags.data.ts` does not go through
 * that service. It is a literal capture, pasted from a database, and the migrator
 * writes it back verbatim — it withholds only `_id`, `__v`, `hook_ids` and
 * `group_ids`. So a row captured from a database that predates the forcing rule
 * carries `[]`, and pasting it here puts the defective shape back into whatever
 * target the migration is run against. Two rows really did:
 * `menu_sub_00013` and `menu_sub_00014`, found on 02/09 by diffing the script
 * against the live cards — the card BODIES were byte-identical (same sha1), so
 * nothing but this field gave it away.
 *
 * The header of the data file tells a human to re-check after a recapture. This
 * file is what makes ignoring that instruction fail out loud.
 * ⇒ recapture แล้วต้องเช็คซ้ำ · ไฟล์นี้ทำให้ลืมไม่ได้
 *
 * revert: delete this file; the data file keeps its warning but nothing enforces it.
 */
import { MENU_TAG_ROWS } from '@/cli/migrate-menu-tags.data';

/** The one value the product forces for this card type. Kept as a literal on
 *  purpose: importing the service's constant would make the test pass by
 *  construction the day someone changes it, which is precisely the change that
 *  ought to be reviewed. */
const REQUIRED = ['site_rules'];

describe('[FIX-20260902-MENUSRCROLES] the migrated menu rows', () => {
  it('ships five rows — the count the migration is documented to move', () => {
    expect(MENU_TAG_ROWS).toHaveLength(5);
  });

  it.each(MENU_TAG_ROWS.map((r) => [String(r['flex_tag']), r] as const))(
    '🔴 %s declares source_roles ["site_rules"], never []',
    (_tag, row) => {
      /* `[]` is the exact shape that printed `{{site_rules.…}}` at a customer on
         31/08. It is not a cosmetic difference and must never ship. */
      expect(row['source_roles']).toEqual(REQUIRED);
    },
  );

  it('⭐⭐ every row is a menu card — the forcing rule applies to this type only', () => {
    /* If a non-menu card were ever added to this array, the assertion above would
       be wrong for it: `source_roles` is forced for `menu` and free for the rest.
       Catching that here stops the rule being applied where it does not belong. */
    for (const row of MENU_TAG_ROWS) {
      expect(row['flex_type']).toBe('menu');
    }
  });

  it('⭐⭐ no row carries an identity from the source database', () => {
    /* The data file documents these as deliberately absent: the target mints its
       own `_id`, and `created_by`/`updated_by` would be user ids that do not
       exist there — a reference pointing at a stranger. A recapture that pasted
       a whole document back in would reintroduce them silently. */
    for (const row of MENU_TAG_ROWS) {
      for (const k of ['_id', '__v', 'created_by', 'updated_by', 'group_ids']) {
        expect(row[k]).toBeUndefined();
      }
    }
  });

  it('⭐ every row still carries the tag the capture is keyed by', () => {
    /* The capture is BY `flex_tag`, not by slug — `sub-register` exists twice in
       the source and one copy is soft-deleted. A row without its tag could not be
       matched in the target at all. */
    for (const row of MENU_TAG_ROWS) {
      expect(String(row['flex_tag'])).toMatch(/^menu_(main|sub)_\d+$/);
      expect(String(row['flex_slug'] ?? '')).not.toHaveLength(0);
    }
  });
});
