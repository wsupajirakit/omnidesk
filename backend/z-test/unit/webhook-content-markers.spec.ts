import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildContentTagGuidelines,
  buildContentTagMap,
  parseContentMarkers,
  stripContentMarkers,
} from '@/modules/webhook/flex/flex-content-markers.util';

/**
 * DIFFERENTIAL test: the ported functions against the legacy JavaScript they
 * were ported from, on identical inputs.
 *
 * This is the strongest evidence available for this part of the port, and it is
 * stronger than an expectation table. A table records what I believed the
 * legacy code does; this runs the legacy code. Both halves of the two fixes
 * legacy carries markers for ([FIX-20260805-STRIPNOOP] and the lowest-slot
 * fallback in `buildContentTagMap`) are subtle enough that a hand-written table
 * would plausibly have encoded my misreading of them as the expected result.
 *
 * `flexContentTags.js` is a leaf module — it requires nothing — so it loads
 * without booting the legacy app, a database, or any credential. Nothing here
 * touches the network.
 *
 * The suite SKIPS rather than fails when the legacy checkout is not beside this
 * one, so it never turns red for a reason unrelated to the code under test.
 */
/**
 * [FIX-20260901-DROPLEGACY] The legacy checkout is gone from the workflow, so
 * this spec no longer loads and runs `legacy-api/src/config/flexContentTags.js`
 * side by side with ours. What it compared against is now a RECORDED FIXTURE:
 * every answer legacy produced for these exact inputs, captured from the real
 * module on 01/09/2026 before the dependency was cut.
 *
 * WHAT THIS KEEPS: the pin. Our implementation still has to produce these exact
 * values, so a drift in `parseContentMarkers` / `stripContentMarkers` /
 * `buildContentTagMap` still turns this file red.
 * WHAT IT GIVES UP, STATED PLAINLY: it can no longer notice legacy changing —
 * which is the point, because legacy is not being changed any more.
 * WHAT IT GAINS: the spec used to `describe.skip` itself on any machine without
 * the sibling checkout, reporting green while proving nothing. It now runs
 * everywhere. เทสที่ข้ามตัวเองแล้วบอกเขียว = เทสหลอก
 *
 * revert: restore LEGACY_PATH + describeIfLegacy and compare against
 *         `require(LEGACY_PATH)` again; the fixture can then be deleted.
 */
const LEGACY = JSON.parse(
  readFileSync(
    resolve(__dirname, '../fixtures/legacy-content-markers.json'),
    'utf8',
  ),
) as {
  parse: Record<string, [number, string][]>;
  strip: Record<string, string>;
  tagMap: Record<string, { map: unknown; declared: string[] }>;
  guidelines: Record<string, unknown>;
  named: Record<string, unknown>;
};

describe('flex content markers — pinned to the legacy answers', () => {
  /*
   * [FIX-20260812-LEGACYOPTIONAL] loaded in `beforeAll`, not at describe scope.
   *
   * `describe.skip` still EXECUTES the callback body to collect test names — it
   * only skips the tests themselves. A `require()` written here therefore ran
   * even when the guard above said the checkout was missing, and the suite
   * failed to run instead of skipping. `beforeAll` never fires for a skipped
   * suite, so the load is genuinely conditional.
   */

  /**
   * Inputs chosen to cover every documented branch AND the ones documented only
   * by a bug marker. Each comment says which property it is there to catch.
   */
  const TEXTS: [name: string, value: unknown][] = [
    ['no markers at all', 'สวัสดีครับ ยินดีให้บริการ'],
    // [FIX-20260805-STRIPNOOP]: double spaces must SURVIVE when no marker is
    // present. The pre-fix code collapsed them on every call.
    ['double spaces, no marker', 'สวัสดี  ครับ'],
    ['leading and trailing spaces, no marker', '   hello   '],
    ['single marker', '[[[custom_content_1]]] ทักทายลูกค้า'],
    ['two markers', '[[[custom_content_1]]] หนึ่ง [[[custom_content_2]]] สอง'],
    // Text before the first marker has no owner and is dropped.
    [
      'orphan text before first marker',
      'ก่อนหน้า [[[custom_content_2]]] เนื้อหา',
    ],
    // Same slot twice joins with a newline rather than overwriting.
    [
      'same slot twice',
      '[[[custom_content_3]]] บรรทัดหนึ่ง [[[custom_content_3]]] บรรทัดสอง',
    ],
    // Two brackets, not three — legacy accepts both forms.
    ['two-bracket form', '[[custom_content_1]] สอง วงเล็บ'],
    // 10 must not be read as 1 followed by a stray 0.
    ['slot 10', '[[[custom_content_10]]] ช่องสิบ'],
    // 11 is not a slot; the marker must not match at all.
    ['slot 11 is not a marker', '[[[custom_content_11]]] ไม่ใช่ช่อง'],
    ['marker with empty body', '[[[custom_content_1]]]   '],
    ['marker only', '[[[custom_content_1]]]'],
    ['uppercase marker', '[[[CUSTOM_CONTENT_2]]] ตัวใหญ่'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['number', 12345],
  ];

  const TAG_SETS: [name: string, value: unknown][] = [
    ['declares nothing (undefined)', undefined],
    ['declares nothing (empty array)', []],
    ['not an array', { no: 1 }],
    ['one slot', [{ no: 1, label: 'ทักทาย' }]],
    [
      'two slots',
      [
        { no: 1, label: 'ทักทาย' },
        { no: 2, label: 'ปิดท้าย' },
      ],
    ],
    // Lowest number, not index 0 — the unmarked-answer fallback targets the
    // lowest NUMBER, and this ordering is what tells the two rules apart.
    [
      'unsorted, lowest is not first',
      [
        { no: 5, label: 'ห้า' },
        { no: 2, label: 'สอง' },
      ],
    ],
    ['slot 10', [{ no: 10, label: 'สิบ' }]],
    ['out-of-range slot is ignored', [{ no: 11, label: 'สิบเอ็ด' }]],
    ['non-numeric slot is ignored', [{ no: 'x', label: 'ผิด' }]],
    ['row with a hint', [{ no: 1, label: 'ทักทาย', hint: 'ไม่เกิน 20 คำ' }]],
    ['row with no label', [{ no: 3 }]],
  ];

  it.each(TEXTS)('parseContentMarkers — %s', (_name, value) => {
    const ours = parseContentMarkers(value);
    // Maps compare by entries; sorted so insertion order never masks a real diff.
    const norm = (m: Map<number, string>) =>
      [...m.entries()].sort((a, b) => a[0] - b[0]);
    expect(norm(ours)).toEqual(LEGACY.parse[_name]);
  });

  it.each(TEXTS)('stripContentMarkers — %s', (_name, value) => {
    expect(stripContentMarkers(value)).toBe(LEGACY.strip[_name]);
  });

  it('buildContentTagMap — every tag set against every answer', () => {
    let compared = 0;
    for (const [tagName, tags] of TAG_SETS) {
      for (const [textName, text] of TEXTS) {
        const ours = buildContentTagMap(tags, text);
        const theirs = LEGACY.tagMap[`${tagName} || ${textName}`];
        /* a missing fixture must fail loudly, naming the pair — jest's expect
           takes no message argument, so the key is asserted instead */
        expect(`${tagName} || ${textName}`).toBe(
          theirs ? `${tagName} || ${textName}` : 'MISSING FIXTURE',
        );
        if (!theirs) continue;
        expect(ours.map).toEqual(theirs.map);
        expect([...ours.declared].sort()).toEqual(theirs.declared);
        compared += 1;
      }
    }
    // Guards against a rewrite of the loops above that silently compares nothing.
    expect(compared).toBe(TAG_SETS.length * TEXTS.length);
  });

  it.each(TAG_SETS)('buildContentTagGuidelines — %s', (_name, tags) => {
    expect(buildContentTagGuidelines(tags)).toEqual(LEGACY.guidelines[_name]);
  });

  /**
   * Pinned separately from the diff above: these are the two properties whose
   * legacy behaviour is surprising enough that "we match legacy" is worth
   * stating in its own right, so a future change to BOTH sides at once is still
   * a red test.
   */
  it('an unmarked answer fills the lowest-numbered slot, not the first row', () => {
    const tags = [
      { no: 5, label: 'ห้า' },
      { no: 2, label: 'สอง' },
    ];
    const { map } = buildContentTagMap(tags, 'คำตอบที่ไม่มี marker เลย');
    expect(map['custom_content_2']).toBe('คำตอบที่ไม่มี marker เลย');
    expect(map['custom_content_5']).toBe('');
    expect(map).toEqual(LEGACY.named['lowest slot']);
  });

  it('a marker for an undeclared slot is dropped, not invented', () => {
    const tags = [{ no: 1, label: 'หนึ่ง' }];
    const text = '[[[custom_content_1]]] เก็บ [[[custom_content_7]]] ทิ้ง';
    const { map, declared } = buildContentTagMap(tags, text);
    expect(map['custom_content_1']).toBe('เก็บ');
    expect(map['custom_content_7']).toBeUndefined();
    expect([...declared]).toEqual(['custom_content_1']);
    expect(map).toEqual(LEGACY.named['undeclared dropped']);
  });
});

/**
 * The one assertion that must hold whether or not the legacy checkout is
 * present: these functions now have a caller. The gap this port exists to close
 * was "four functions, zero call sites".
 */
describe('flex content markers — wired into the renderer', () => {
  it('renderFlexDoc calls buildContentTagMap and stripContentMarkers', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('node:fs').readFileSync(
      resolve(__dirname, '../../src/modules/webhook/flex/flex-render.util.ts'),
      'utf8',
    ) as string;
    expect(source).toContain('buildContentTagMap(');
    expect(source).toContain('stripContentMarkers(');
  });
});
