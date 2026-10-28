/**
 * [REFACTOR-20260905-READPATHTRUTH] one reader for "value at a dot path"
 * ===========================================================================
 * Census 05/09 found the same "read a value at a dot path" logic written
 * three times over (a fourth, `utils/memberSearchText.ts:57-66`'s `pick`, was
 * also found while measuring this — it is out of this task's edit scope and
 * left alone; see utils/readPath.ts's header for why it is close-but-not-
 * identical to the canonical contract).
 *
 * This file pins:
 *   1. the grammar utils/readPath.ts supports
 *   2. the missing-step answer (undefined)
 *   3. THE WHOLE POINT — the falsy-intermediate case, where the OLD
 *      `acc && acc[part]` idiom (both former DynamicTagPreviewModal copies)
 *      disagreed with `acc == null ? undefined : acc[k]` (usePreferences,
 *      and now the shared utils/readPath.ts)
 *   4. the generateJsonLines invariant that makes repointing
 *      DynamicTagPreviewModal's handleCopyPath reader a no-observable-change
 *      move, proven against the REAL exported function, not a re-implementation
 *   5. a repo walk: no second `split('.').reduce(` remains in the files this
 *      task touched
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPath } from '../utils/readPath';
import { generateJsonLines } from '../components/dynamic-tag/DynamicTagPreviewModal';

const ROOT = join(__dirname, '..');

/* The OLD DynamicTagPreviewModal algorithm, reproduced ONLY inside this test
   to make the regression concrete — it is not reintroduced into the app. If
   utils/readPath.ts is ever "simplified" back to this idiom, the falsy-
   intermediate tests below catch it immediately. */
const oldShortCircuitAlgorithm = (obj: any, path: string): any =>
  path.split('.').reduce((acc, part) => acc && acc[part], obj);

describe('[READPATHTRUTH] grammar', () => {
  it('⭐ nested plain objects resolve segment by segment', () => {
    expect(readPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('⭐ a single segment with no dot reads a top-level key', () => {
    expect(readPath({ a: 1 }, 'a')).toBe(1);
  });

  it('⭐ numeric-string segments index arrays', () => {
    expect(readPath({ a: [10, 20, 30] }, 'a.1')).toBe(20);
  });

  it('⭐ a falsy value at the LAST step is returned untouched, not treated as "missing"', () => {
    expect(readPath({ a: { b: false } }, 'a.b')).toBe(false);
    expect(readPath({ a: { b: 0 } }, 'a.b')).toBe(0);
    expect(readPath({ a: { b: '' } }, 'a.b')).toBe('');
  });

  it('⭐ a non-string path never throws — returns undefined', () => {
    expect(readPath({ a: 1 }, null as unknown as string)).toBeUndefined();
    expect(readPath({ a: 1 }, undefined as unknown as string)).toBeUndefined();
    expect(readPath({ a: 1 }, 42 as unknown as string)).toBeUndefined();
  });
});

describe('[READPATHTRUTH] missing step ⇒ undefined', () => {
  it('⭐⭐ missing top-level key', () => {
    expect(readPath({}, 'a.b')).toBeUndefined();
  });

  it('⭐⭐ missing middle key', () => {
    expect(readPath({ a: {} }, 'a.b.c')).toBeUndefined();
  });

  it('⭐⭐ path longer than the data (walk bottoms out at a leaf early)', () => {
    expect(readPath({ a: 5 }, 'a.b.c')).toBeUndefined();
  });
});

describe('[READPATHTRUTH] 🔴 the falsy-intermediate case — this is the whole point', () => {
  it('⭐⭐⭐ {a:0} at "a.b" — readPath: undefined · old algorithm: 0', () => {
    expect(readPath({ a: 0 }, 'a.b')).toBeUndefined();
    expect(oldShortCircuitAlgorithm({ a: 0 }, 'a.b')).toBe(0);
  });

  it('⭐⭐⭐ {a:""} at "a.b" — readPath: undefined · old algorithm: ""', () => {
    expect(readPath({ a: '' }, 'a.b')).toBeUndefined();
    expect(oldShortCircuitAlgorithm({ a: '' }, 'a.b')).toBe('');
  });

  it('⭐⭐⭐ {a:false} at "a.b" — readPath: undefined · old algorithm: false', () => {
    expect(readPath({ a: false }, 'a.b')).toBeUndefined();
    expect(oldShortCircuitAlgorithm({ a: false }, 'a.b')).toBe(false);
  });

  it('⭐⭐ {a:null} at "a.b" — readPath: undefined · old algorithm: null', () => {
    expect(readPath({ a: null }, 'a.b')).toBeUndefined();
    expect(oldShortCircuitAlgorithm({ a: null }, 'a.b')).toBe(null);
  });

  it('⭐⭐ {a:NaN} at "a.b" — readPath: undefined · old algorithm: NaN', () => {
    expect(readPath({ a: NaN }, 'a.b')).toBeUndefined();
    expect(Number.isNaN(oldShortCircuitAlgorithm({ a: NaN }, 'a.b'))).toBe(true);
  });
});

describe('[READPATHTRUTH] real usePreference() paths never hit the divergence', () => {
  // Every literal path string passed to usePreference(...) in the app today —
  // collected by grep across App.tsx, TicketSupport.tsx, TicketChat.tsx and
  // SuspendedTrayButton.tsx. All walk through 'ui' / 'tables' namespace
  // objects populated by deepMerge from a JSON preferences blob — never a
  // falsy primitive. This test pins that fact so a future preference shaped
  // as `ui: false` (instead of an object) would be caught here first.
  const shape = {
    ui: {
      theme: 'dark', fontScale: 1, forceOneRow: false, fontMode: 'default',
      notiSound: true, favGroups: [] as string[], ticketGroupMode: 'slider',
      chatMessageScale: 1.4, chatTrayMode: 'default', chatComposerHeight: 120,
    },
    tables: { tickets: { colWidths: {}, visibleCols: ['name'] } },
  };
  const realPaths = [
    'ui.theme', 'ui.fontScale', 'ui.forceOneRow', 'ui.fontMode', 'ui.notiSound',
    'ui.favGroups', 'ui.ticketGroupMode', 'ui.chatMessageScale', 'ui.chatTrayMode',
    'ui.chatComposerHeight', 'tables.tickets.colWidths', 'tables.tickets.visibleCols',
  ];

  it('⭐⭐ a populated preferences blob reads identically under readPath and the old algorithm', () => {
    for (const p of realPaths) {
      expect(readPath(shape, p)).toEqual(oldShortCircuitAlgorithm(shape, p));
    }
  });

  it('⭐⭐ a brand-new account with no saved prefs (obj={}) reads undefined either way', () => {
    for (const p of realPaths) {
      expect(readPath({}, p)).toBeUndefined();
      expect(oldShortCircuitAlgorithm({}, p)).toBeUndefined();
    }
  });
});

describe('[READPATHTRUTH] generateJsonLines invariant — handleCopyPath repoint is provably safe', () => {
  /* generateJsonLines only ever extends a path past a key whose value is a
     confirmed non-null object (DynamicTagPreviewModal.tsx's own
     `typeof value === 'object' && value !== null` check, both for object
     keys and array items). So for ANY path it builds while walking a real
     jsonContent, reading that path back must agree between readPath and the
     old algorithm — the divergence only exists when a path walks through a
     falsy PRIMITIVE, and this function structurally cannot emit a path that
     does that against the SAME object it was generated from.
     Adversarial fixture: falsy leaves of every type, mixed with real nesting
     and an array, so a future edit to generateJsonLines that breaks the
     invariant would turn this red. */
  const adversarial = {
    active: false,
    count: 0,
    note: '',
    nothing: null,
    bank: { account_no: '123', verified: false },
    flags: { a: 0, b: '', c: null, d: { deep: true } },
    list: [0, '', false, { x: 1 }],
  };

  function collectNonEmptyPaths(lines: ReturnType<typeof generateJsonLines>): string[] {
    return [...new Set(lines.map((l) => l.path).filter((p) => p !== ''))];
  }

  it('⭐⭐⭐ every path the real generateJsonLines can build reads identically under readPath and the old algorithm', () => {
    const lines = generateJsonLines(adversarial);
    const paths = collectNonEmptyPaths(lines);
    // Sanity: the fixture actually produced nested paths worth checking —
    // guards against this test silently checking zero paths if the fixture
    // or the function's shape ever changes underneath it.
    expect(paths.length).toBeGreaterThan(8);
    for (const p of paths) {
      expect(readPath(adversarial, p)).toEqual(oldShortCircuitAlgorithm(adversarial, p));
    }
  });

  it('⭐⭐ the same holds through an array of mixed falsy primitives and an object', () => {
    const lines = generateJsonLines(adversarial.list, 'list');
    const paths = collectNonEmptyPaths(lines);
    expect(paths).toContain('list.3.x');
    for (const p of paths) {
      expect(readPath(adversarial, p)).toEqual(oldShortCircuitAlgorithm(adversarial, p));
    }
  });
});

describe("[READPATHTRUTH] no second split('.').reduce( remains in the touched files", () => {
  const TOUCHED = [
    join('components', 'dynamic-tag', 'DynamicTagPreviewModal.tsx'),
    join('hooks', 'usePreferences.ts'),
  ];

  it("⭐⭐ 🔴 the pattern this task existed to remove is gone from every file it touched", () => {
    const offenders: string[] = [];
    for (const rel of TOUCHED) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      // Matches the shape regardless of variable names (part/k/key) or
      // whether .reduce is generic (`.reduce<unknown>(`) or plain (`.reduce(`),
      // and regardless of a line break between .split(...) and .reduce(...).
      if (/\.split\((['"])\.\1\)[\s\S]{0,15}\.reduce\s*[<(]/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('⭐ DynamicTagPreviewModal.tsx has exactly one dot-path reader now, not two local ones', () => {
    const src = readFileSync(
      join(ROOT, 'components', 'dynamic-tag', 'DynamicTagPreviewModal.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/getValueByPath/);
    expect(src.match(/from ['"]\.\.\/\.\.\/utils\/readPath['"]/g)).toHaveLength(1);
  });

  it('⭐ hooks/usePreferences.ts reads through the shared utils/readPath.ts, not a local copy', () => {
    const src = readFileSync(join(ROOT, 'hooks', 'usePreferences.ts'), 'utf8');
    expect(src).not.toMatch(/const getPath\s*=/);
    expect(src.match(/from ['"]\.\.\/utils\/readPath['"]/g)).toHaveLength(1);
  });
});
