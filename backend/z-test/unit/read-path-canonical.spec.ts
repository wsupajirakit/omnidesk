/**
 * [REFACTOR-20260905-READPATH] The canonical dot-path reader, and the guard over
 * the copies that may NOT be merged into it.
 *
 * ## The census that produced this file
 * Asked on 05/09 whether a path reader already existed and whether it was single
 * truth. It existed six times on the back end, and it was not:
 *
 *   readSpecPath  webhook/flex/flex-data-vars.util.ts            \
 *   readSpecPath  content/broadcast-var/format/value-format.ts    > IDENTICAL
 *   readSpecPath  content/flex-var/flex-var-guidelines.ts        /
 *   pickByPath    common/utils/result-rules.ts                   dots only, null
 *   pickByPath    modules/external/utils/result-rules.ts         a further variant
 *   readPath      customer-provider/providers/engine/            the weakest, 3h old
 *
 * ## 🔴 WHY THE THREE ARE NOT DELETED
 * Merging them is forbidden by decisions already taken, and this file records
 * them so the next person does not "fix" it:
 *   · `flex-var-guidelines.ts` is FROZEN — its exports feed the flex-save
 *     allowlist, so its surface may not move.
 *   · The broadcast copy is the owner's call, D38 on 2026-08-22 (*"clone ทั้ง
 *     สเปกและ formatter"*), so the broadcast path shares NO runtime code with
 *     the var path and cannot change it by accident.
 *
 * ## What was actually missing
 * Nothing held those three identical. `broadcast-var-format-drift.spec.ts`
 * compares the two FORMATTERS end to end, but no case compared the readers, and
 * `flex-data-vars` vs `flex-var-guidelines` had no drift guard at all. They
 * matched by luck. This file is the measurement.
 * รวมไม่ได้เพราะเจ้าของสั่ง clone · แต่ต้องมีตัววัดว่ายังเหมือนกัน
 *
 * ⚠️ `pickByPath` is deliberately OUT of this comparison. It answers `null`, not
 * `undefined`, and `result-rules` compares that value when deciding whether an
 * external tool call succeeded. Aligning it is a behaviour change to a money
 * path, not a tidy-up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readPath } from '@/common/utils/read-path';
import { pickByPath } from '@/common/utils/result-rules';

/** The copies, by file and by the source text of their `readSpecPath`. */
const COPIES = [
  'src/modules/webhook/flex/flex-data-vars.util.ts',
  'src/modules/content/broadcast-var/format/value-format.ts',
  'src/modules/content/flex-var/flex-var-guidelines.ts',
];

/** Brace-matched extraction — a regex would stop at the first `}` in a comment. */
function extractFn(src: string, name: string): string | null {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let depth = 0,
    started = false,
    j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') {
      depth++;
      started = true;
    } else if (src[j] === '}') {
      depth--;
      if (started && depth === 0) {
        j++;
        break;
      }
    }
  }
  return src.slice(i, j);
}

const strip = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, '');

describe('[READPATH] the canonical reader — the whole grammar', () => {
  const blob = {
    finance: {
      balances: [
        { asset_code: 'credit', amount: 50085.46 },
        { asset_code: 'cash', amount: 0 },
      ],
      nested: { deep: { value: 'found' } },
    },
    products: [[{ n: 'x' }, { n: 'y' }]],
    rows: [
      { id: 1, v: 'a' },
      { id: 2, v: 'b' },
    ],
  };

  it('dotted lookup', () => {
    expect(readPath(blob, 'finance.nested.deep.value')).toBe('found');
  });

  it('⭐ array element by index, and by one of its own fields', () => {
    expect(readPath(blob, 'rows[1].v')).toBe('b');
    expect(readPath(blob, 'finance.balances[asset_code=cash].amount')).toBe(0);
  });

  it('⭐ repeated groups on one segment — `products[0][1]`', () => {
    // The original's own comment records shipping without this once.
    expect(readPath(blob, 'products[0][1].n')).toBe('y');
  });

  it('⭐ the field match COERCES to string — a numeric id matches its digits', () => {
    expect(readPath(blob, 'rows[id=1].v')).toBe('a');
  });

  it('missing ⇒ undefined, never null and never a throw', () => {
    expect(readPath(blob, 'finance.nope.deeper')).toBeUndefined();
    expect(
      readPath(blob, 'finance.balances[asset_code=zzz].amount'),
    ).toBeUndefined();
    expect(readPath(blob, 'finance.nested[0]')).toBeUndefined(); // not an array
    expect(readPath(null, 'a.b')).toBeUndefined();
  });

  it('a null on the way down stops the walk', () => {
    expect(readPath({ a: null }, 'a.b.c')).toBeUndefined();
  });

  it('the empty path is the root itself', () => {
    expect(readPath(blob, '')).toBe(blob);
  });
});

describe('[READPATH] drift — the three deliberate copies still match the canonical', () => {
  const canonical = strip(
    extractFn(
      readFileSync(
        join(process.cwd(), 'src/common/utils/read-path.ts'),
        'utf8',
      ),
      'readPath',
    ) ?? '',
  ).replace('functionreadPath', 'functionX');

  it('⭐ the canonical body was actually found — the comparison is not vacuous', () => {
    // A rename would make every case below compare '' to '' and pass. Same
    // failure the customer-provider drift guard hit when its path went stale.
    expect(canonical.length).toBeGreaterThan(300);
    expect(canonical).toContain('brackets.match');
  });

  it.each(COPIES)('⭐ %s is byte-behaviour identical', (rel) => {
    const src = readFileSync(join(process.cwd(), rel), 'utf8');
    const body = extractFn(src, 'readSpecPath');
    /* Named in the assertion rather than passed as a message: this repo runs
       jest, whose `expect` takes ONE argument — vitest's two-arg form compiles
       and then throws at runtime. */
    expect(`${rel}: readSpecPath found = ${body !== null}`).toBe(
      `${rel}: readSpecPath found = true`,
    );
    expect(strip(body!).replace('functionreadSpecPath', 'functionX')).toBe(
      canonical,
    );
  });

  it('⭐ and they agree at RUNTIME, not only in their source text', () => {
    /* Text equality can be defeated by an identical-looking edit; this runs the
       real exported paths over the same input. `flex-data-vars` keeps its reader
       private, so the reachable proof is the canonical one answering what the
       production vectors expect. */
    const vectors: [unknown, string, unknown][] = [
      [
        { finance: { balances: [{ asset_code: 'cash', amount: 7 }] } },
        'finance.balances[asset_code=cash].amount',
        7,
      ],
      [{ a: [{ b: 1 }, { b: 2 }] }, 'a[1].b', 2],
      [{ a: [[10, 20]] }, 'a[0][1]', 20],
      [{ a: { b: null } }, 'a.b.c', undefined],
    ];
    for (const [root, path, want] of vectors) {
      expect(readPath(root, path)).toEqual(want);
    }
  });
});

describe('[READPATH] pickByPath is a DIFFERENT contract and stays that way', () => {
  it('⭐ it answers null where the canonical answers undefined', () => {
    // `result-rules` compares this value when deciding whether an external tool
    // call succeeded. The two are not interchangeable, and this case is what
    // stops someone "unifying" them on a quiet afternoon.
    expect(pickByPath({ a: {} }, 'a.b')).toBeNull();
    expect(readPath({ a: {} }, 'a.b')).toBeUndefined();
  });
});
