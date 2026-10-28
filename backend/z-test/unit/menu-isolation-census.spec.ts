/**
 * [FEAT-20260828-MENUTAG-S7] the revert claim, made checkable.
 *
 * EVERY stage note in this feature ends with the same line: `revert: delete
 * src/modules/menu/ whole`. The plan's zero-impact contract rests on it, and
 * until now it was only ever verified by someone typing a grep by hand. This is
 * that grep, executable.
 *
 * WHY A SOURCE CENSUS RATHER THAN A BEHAVIOUR TEST: the failure being guarded is
 * someone MONTHS from now importing the menu from a file that does not exist
 * yet — a webhook branch, a controller, a resolver. No behavioural test can fail
 * for code nobody has written. A census can. Same technique, and the same
 * reasoning, as `webhook-log-door-census.spec.ts`.
 *
 * WHEN THIS GOES RED:
 *   · someone imported `@/modules/menu` from outside the module while the menu
 *     is still unwired ⇒ deleting the directory would now break a build, so the
 *     revert line in every header has quietly become false. Expected to go red
 *     ON PURPOSE at S3, when the patch adds the one intended call site — at
 *     which point the allow-list below gains that file and the revert
 *     instruction becomes "git apply -R docs/menu-plug-in.patch, then delete".
 *   · the menu started importing another feature module ⇒ the module is no
 *     longer free-standing, a TS cycle is possible, and §3e tier 1 (deps are
 *     INJECTED, never imported) has been abandoned.
 *   · something outside reached past the barrel into a menu internal.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '../../src');
const MENU = join(SRC, 'modules', 'menu');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
};

const rel = (p: string): string => p.slice(SRC.length + 1);

/** Every import specifier in a file, however it is written. */
const importsOf = (file: string): string[] => {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (m) => m[1]!,
  );
};

/**
 * The call sites that are ALLOWED to import the menu. Empty while the feature is
 * unwired by design. S3 adds `modules/webhook/webhook.service.ts` and
 * `modules/webhook/webhook.module.ts` here, in the same commit as the patch —
 * never before, so this file is also the record of when the menu stopped being
 * free-standing.
 */
/**
 * The ONE sanctioned importer, named so the exception is reviewable rather than
 * a quietly weakened rule.
 *
 * `menu-postback-guidelines.ts` builds the copyable postback spec the dashboard
 * shows to an operator, and it does so BY CALLING THE CODEC. Hand-writing those
 * strings there instead would be a second spelling of the grammar: the day the
 * codec changes, the guide would keep handing operators a payload that silently
 * no longer parses — the exact failure the guide exists to prevent. It imports
 * only the two pure minters: no engine, no renderer, no DB.
 *
 * ⚠️ `rm -rf src/modules/menu` therefore also means deleting this file. It is a
 * guide table, not a code path — nothing reads its rows — so the deletion is
 * mechanical and the revert note in that file says so.
 */
const ALLOWED_IMPORTERS: readonly string[] = [
  'modules/content/flex-var/menu-postback-guidelines.ts',
  /* ⚠️ ADDED 29/08/2026 WHEN THE OWNER APPROVED S3 AND THE PLUG WENT IN.
     These two are the webhook seat, and they are here ONLY because
     `docs/menu-plug-in.patch` is currently applied. They are not an ordinary
     exception: `menu-plug-patch.spec.ts` proves the patch still reverts, so
     `git apply -R docs/menu-plug-in.patch` removes both references and the file
     tree goes back to knowing nothing about the menu.
     ⇒ `rm -rf src/modules/menu` is STILL a complete revert — it just needs the
     patch reverted first, which is one command and is itself under test.
     DO NOT add anything else to this list without the owner's approval; every
     other importer would be a permanent coupling with no off switch. */
  'modules/webhook/webhook.service.ts',
  'modules/webhook/webhook.module.ts',
];

describe('[MENUCENSUS] `revert: delete src/modules/menu/` is still true', () => {
  it('⭐⭐⭐ nothing outside the module imports it', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.startsWith(MENU)) continue;
      if (ALLOWED_IMPORTERS.includes(rel(file))) continue;
      for (const spec of importsOf(file)) {
        /* `@/modules/menus…` and `./menu.schema` belong to the pre-existing
           LINE rich-menu feature in content/ — a name neighbour, not us. */
        if (/^@\/modules\/menu(\/|$)/.test(spec))
          offenders.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('⭐⭐⭐ the module imports NO other feature module — deps are injected, not imported (§3e tier 1)', () => {
    /* This is what keeps the menu compilable and testable with no webhook, and
       what makes a TS import cycle impossible rather than merely absent. */
    const offenders: string[] = [];
    for (const file of walk(MENU)) {
      for (const spec of importsOf(file)) {
        if (/^@\/modules\//.test(spec))
          offenders.push(`${rel(file)} → ${spec}`);
        if (/^\.\.\/\.\./.test(spec)) offenders.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('⭐⭐ the module pulls in no Nest runtime either — it is plain TypeScript', () => {
    /* S1 is unwired on purpose: the engine is constructed by the S3 patch, not
       by a decorator. If a `@Injectable()` appears here, the module can no
       longer be exercised without booting Nest and the revert stops being a
       directory delete. */
    const offenders: string[] = [];
    for (const file of walk(MENU)) {
      for (const spec of importsOf(file)) {
        if (spec.startsWith('@nestjs/'))
          offenders.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('⭐⭐ outsiders may only enter through the barrel (the eslint fence, asserted)', () => {
    /* The fence is enforced repo-wide by the linter, but a waiver comment can
       switch a rule off in one file — `payment-state-flex.resolver.ts` already deep-imports
       webhook internals that way (plan §3e, "negative precedent"). A census
       cannot be waived. */
    const deep: string[] = [];
    for (const file of walk(SRC)) {
      if (file.startsWith(MENU)) continue;
      for (const spec of importsOf(file)) {
        if (/^@\/modules\/menu\/.+/.test(spec))
          deep.push(`${rel(file)} → ${spec}`);
      }
    }
    expect(deep).toEqual([]);
  });

  it('the census is not vacuous — it really is reading the tree', () => {
    /* Without this, a broken walk() would make every list above trivially
       empty and all four cases would pass while checking nothing. */
    const all = walk(SRC);
    expect(all.length).toBeGreaterThan(200);
    expect(walk(MENU).length).toBeGreaterThanOrEqual(20);
    expect(
      importsOf(join(MENU, 'menu-engine.service.ts')).length,
    ).toBeGreaterThan(3);
  });
});
