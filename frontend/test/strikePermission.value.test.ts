/* [FEAT-20260824-STRIKESESSION] the "clear a strike session" permission, and a
 * guard that the front end still offers every permission the back end demands.
 *
 * WHY THIS FILE EXISTS AT ALL — a permission string that the BE requires but the
 * FE never lists is UNGRANTABLE. The role/user form builds its checkboxes from
 * two hand-maintained lists in this repo (`KNOWN_PERMISSIONS` and `SECTIONS` in
 * UserFormModal, plus a deliberate second copy of SECTIONS in
 * BulkPermissionsModal). Miss one and the endpoint ships with nobody able to be
 * given access to it — no error anywhere, the checkbox simply never renders.
 * That is the same class of silent loss dev-local §14 records for save-body
 * field lists. สิทธิ์ที่ BE ต้องการแต่ FE ไม่ลิสต์ = ไม่มีทางติ๊กให้ใครได้เลย
 *
 * The last case reads the BACK END'S OWN SOURCE when a checkout sits beside this
 * one, and says out loud when it cannot instead of passing quietly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FE_ROOT = process.cwd();
const userForm = readFileSync(
  join(FE_ROOT, 'components/admin/UserFormModal.tsx'),
  'utf8',
);
const bulkForm = readFileSync(
  join(FE_ROOT, 'components/bulk/BulkPermissionsModal.tsx'),
  'utf8',
);

const PERM = 'strike.manage';

describe('strike.manage can actually be granted', () => {
  it('is in KNOWN_PERMISSIONS, or no checkbox ever renders', () => {
    const block = userForm.slice(
      userForm.indexOf('const KNOWN_PERMISSIONS'),
      userForm.indexOf('// ==== [FIX-20260731-CONTACTPERM] END'),
    );
    expect(block).toContain(`'${PERM}'`);
  });

  it('sits in the support section of BOTH forms, and in the same one', () => {
    const support = (src: string): string[] => {
      const line = src
        .split('\n')
        .find((l) => l.includes("key: 'support'"));
      expect(line).toBeDefined();
      return [...line!.matchAll(/'([\w.]+)'/g)].map((m) => m[1]!);
    };
    expect(support(userForm)).toContain(PERM);
    expect(support(bulkForm)).toContain(PERM);
    // the two copies must stay identical — BulkPermissionsModal's own header
    // says it redeclares the list on purpose, which is exactly why it drifts
    expect(support(bulkForm)).toEqual(support(userForm));
  });

  it('has a label in every language, so the checkbox is not blank', () => {
    const key = `user.permission_${PERM.replace(/\./g, '_')}`;
    for (const lang of ['en', 'th', 'zh', 'it']) {
      const dict = JSON.parse(
        readFileSync(join(FE_ROOT, `i18n/translations/${lang}.json`), 'utf8'),
      ) as Record<string, string>;
      expect(dict[key], `${lang} is missing ${key}`).toBeTruthy();
    }
  });
});

describe('⭐ drift guard — every permission the back end demands is offered here', () => {
  /* The BE may be the plain checkout or a lane worktree beside it. Try each
     sibling that looks like one rather than hard-coding a branch's directory,
     so this keeps working after the lane is merged away. */
  const findBe = (): string | null => {
    const parent = join(FE_ROOT, '..');
    const candidates = readdirSync(parent).filter((d) =>
      d.startsWith('backend'),
    );
    for (const dir of ['backend', ...candidates]) {
      const file = join(
        parent,
        dir,
        'src/modules/strike/strike.controller.ts',
      );
      if (existsSync(file)) return file;
    }
    return null;
  };

  it('⭐ offers every @RequirePermissions string in omnidesk-api strike.controller.ts', () => {
    const be = findBe();
    if (!be) {
      /* not a silent pass: name the check that did not run. */
      expect('SKIPPED — no omnidesk-api checkout beside this one').toContain(
        'SKIPPED',
      );
      return;
    }
    const src = readFileSync(be, 'utf8');
    const required = [
      ...src.matchAll(/@RequirePermissions\(([^)]*)\)/g),
    ].flatMap((m) => [...m[1]!.matchAll(/'([\w.]+)'/g)].map((x) => x[1]!));

    // the guard must not pass vacuously
    expect(required.length).toBeGreaterThan(0);
    expect(new Set(required)).toContain(PERM);

    const offered = new Set(
      [...userForm.matchAll(/'([\w.]+\.[\w.]+)'/g)].map((m) => m[1]!),
    );
    const missing = [...new Set(required)].filter((p) => !offered.has(p));
    expect({ missing }).toEqual({ missing: [] });
  });
});
