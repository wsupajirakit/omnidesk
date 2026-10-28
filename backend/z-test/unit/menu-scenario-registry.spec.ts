/**
 * [FEAT-20260828-MENUTAG-S1] the registry is the ship list — and it must never
 * drift from the folder. PLAN §3a.
 *
 * The owner's shape: default + a-f on BOTH levels = 14 scenarios. Content is
 * still TBD (Q6), so every a-f placeholder ships DISABLED — "ใช้ไม่ใช้ก็ได้
 * ปิดเปิดบางตัวได้" — and this file is what proves no placeholder can reach a
 * customer by accident.
 */
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  ITEM_ID_CHARSET,
  MENU_LEVELS,
  SCENARIOS,
  UNSHIPPED,
  parseScenarioKey,
  scenarioFileName,
  scenarioKey,
  variantFromFileName,
} from '@/modules/menu';

const DIR = resolve(__dirname, '../../src/modules/menu/scenarios');

/* 🔴 LEVELS IS DERIVED, NEVER LISTED HERE (owner, 28/08: a future
   `scenarios/<newlevel>/` must be supported by every part that loads
   scenarios). MENU_LEVELS in menu-tag.util.ts is the ONE list; a spec with its
   own copy is exactly the drift that makes "add a level" a multi-file edit. */
const LEVELS = MENU_LEVELS;

/** The variant set every level is expected to carry (owner: default + a-f). */
const EXPECTED_VARIANTS = [null, 'a', 'b', 'c', 'd', 'e', 'f'] as const;

/** Walk the folder → the keys the files claim, by the mechanical path rule. */
const keysOnDisk = (): string[] => {
  const out: string[] = [];
  for (const level of LEVELS) {
    for (const f of readdirSync(resolve(DIR, level))) {
      if (!f.endsWith('.ts')) continue;
      /* the path rule comes from the module, never a copy of it here */
      out.push(scenarioKey(level, variantFromFileName(f)));
    }
  }
  return out.sort();
};

describe('[MENUSCENARIO] folder ↔ registry, both ways', () => {
  it('⭐⭐⭐ every file is registered and every registered key has a file', () => {
    const disk = keysOnDisk();
    const registered = [...SCENARIOS.keys()].sort();
    const unshipped = UNSHIPPED.map((u) => u.key);
    /* A file may be absent from the map ONLY via an explicit UNSHIPPED entry
       with a reason — the one loud, documented exception (plan §3a). */
    expect(
      disk.filter((k) => !registered.includes(k) && !unshipped.includes(k)),
    ).toEqual([]);
    expect(registered.filter((k) => !disk.includes(k))).toEqual([]);
  });

  it('⭐⭐ every level carries default + a-f (derived — a new level extends this by itself)', () => {
    const expected = LEVELS.flatMap((level) =>
      EXPECTED_VARIANTS.map((v) => scenarioKey(level, v)),
    ).sort();
    expect([...SCENARIOS.keys()].sort()).toEqual(expected);
    expect(SCENARIOS.size).toBe(LEVELS.length * EXPECTED_VARIANTS.length);
  });

  it('⭐⭐⭐ every declared level has a folder — adding a level to MENU_LEVELS without one is caught here', () => {
    /* The failure this prevents: a level declared in the grammar (so its tag
       parses) with no scenarios on disk — every tap for it would resolve to
       nothing and the customer would meet silence with no error anywhere. */
    const missing = LEVELS.filter((level) => !existsSync(resolve(DIR, level)));
    expect(missing).toEqual([]);
  });

  it('⭐⭐⭐ no scenario folder exists that the grammar does not declare', () => {
    /* The mirror failure: files on disk under a level MENU_LEVELS never names.
       They would be dead weight no tag can ever reach. */
    const onDisk = readdirSync(DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(onDisk).toEqual([...LEVELS].sort());
  });

  it('⭐⭐⭐ every registered scenario maps to a file that EXISTS by the path rule', () => {
    /* The forward half of the mechanical path rule, bound to reality. The
       folder walk above proves file → key; this proves key → file. Without it
       a future loader could compute a path nothing is at and resolve to
       nothing, with no error anywhere to trace. */
    for (const def of SCENARIOS.values()) {
      const file = resolve(
        DIR,
        def.level,
        `${scenarioFileName(def.variant)}.ts`,
      );
      expect({ key: def.key, onDisk: existsSync(file) }).toEqual({
        key: def.key,
        onDisk: true,
      });
    }
  });

  it('⭐⭐ every definition agrees with its own key (no self-inconsistent file)', () => {
    for (const [key, def] of SCENARIOS) {
      expect(def.key).toBe(key);
      const parsed = parseScenarioKey(key);
      expect(parsed).not.toBeNull();
      expect(def.level).toBe(parsed!.level);
      expect(def.variant).toBe(parsed!.variant);
    }
  });

  it('⭐⭐⭐ placeholders ship DISABLED — only the two defaults are on', () => {
    /* Content is Q6-pending. A placeholder that shipped enabled would send
       "PLACEHOLDER …" to a real customer the day the gate is wired. */
    const enabled = [...SCENARIOS.values()]
      .filter((d) => d.enabled)
      .map((d) => d.key)
      .sort();
    expect(enabled).toEqual(['primary', 'second']);
  });

  it('⭐ item ids are unique within a menu and postback-safe', () => {
    for (const def of SCENARIOS.values()) {
      const ids = def.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      const idRe = new RegExp(`^[${ITEM_ID_CHARSET}]+$`);
      for (const id of ids) expect(id).toMatch(idRe);
    }
  });

  it('⭐⭐ every `open` target names a scenario that exists — no dangling sub-menu', () => {
    for (const def of SCENARIOS.values()) {
      for (const item of def.items) {
        if (item.action.type === 'open') {
          expect(parseScenarioKey(item.action.target)).not.toBeNull();
          expect(SCENARIOS.has(item.action.target)).toBe(true);
        }
      }
    }
  });
});
