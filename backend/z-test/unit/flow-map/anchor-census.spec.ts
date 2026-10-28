import { readFileSync } from 'fs';
import { join } from 'path';

import { classifyLines } from '../../lib/code-line-census';

const ROOT = join(__dirname, '../../..');

interface Anchor {
  id: string;
  text: string;
  occurrences: number;
  which?: string;
  line?: number;
  role: string;
  patchOwned?: boolean;
  /** Set when a cut moved this anchor into its own file; defaults to the spine. */
  file?: string;
  movedBy?: string;
}

interface AnchorRegistry {
  file: string;
  anchors: Anchor[];
  /** Anchors whose text a docs/*.patch hunk also contains — measured, see the census. */
  patchOwnedAnchors?: string[];
}

/**
 * [PROG-20260905-ANCHORS] The census that keeps `z-test/fixtures/gate-anchors.json` honest.
 *
 * WHY A DOC NEEDS A TEST. An unguarded navigation document is debt: it is right the day
 * it is written and quietly wrong a week later, and the reader who trusts it is the one
 * who gets hurt. This repo has the receipts — the planning documents carried :NNNN
 * references that were 20-40 lines stale within a day, and one of them routed a condition
 * to the seat where it could NOT run while claiming the opposite.
 *
 * WHAT IS ASSERTED, AND WHAT DELIBERATELY IS NOT.
 *   asserted  — every anchor still exists, and its occurrence COUNT is exactly what the
 *               registry declares. Not "=== 1": three of these anchors legitimately
 *               appear twice or twelve times, and pretending otherwise is how a pin ends
 *               up matching the wrong site.
 *   asserted  — the anchors appear in the registry in the order they appear in the file,
 *               so the document reads top-to-bottom like the code does.
 *   NOT asserted — the `line` fields. They are evidence of record. Asserting them would
 *               make every unrelated edit red, the suite would be muted, and the real
 *               protection above would be lost with it.
 */
describe('[PROG-20260905-ANCHORS] gate anchor census', () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'z-test/fixtures/gate-anchors.json'), 'utf8'),
  ) as AnchorRegistry;
  const linesOf = (file: string): string[] =>
    readFileSync(join(ROOT, file), 'utf8').split('\n');
  const lines = linesOf(registry.file);

  /* An anchor is counted in ITS OWN file. The reduction program moves bodies into role
     directories and each takes its anchor along; counting everything against the spine
     would report every successful extraction as rot, the suite would get muted, and the
     real rot would go with it. An anchor whose count drops in the spine WITHOUT a
     declared file move still fails here, which is the case that matters.

     🔴 CODE LINES ONLY, ADDED 05/09 AFTER THIS CENSUS COUNTED A COMMENT AS A CALL SITE.
     `G14.assist.guard` is the string `if (userId) {`. A comment was added explaining why
     eleven locals had moved into that block — and because the explanation NAMES the
     block, the count went from 2 to 3 and this suite went red over prose. Nothing about
     the code had changed.

     That failure mode is worse than it looks. This directory's whole premise is that
     documentation is only worth having when a test keeps it honest; a census that
     reddens when somebody DOCUMENTS the spine teaches exactly one lesson — stop writing
     comments — and it is the opposite of the lesson intended. It is also the second time
     the same mistake was found in one day: the ladder's slice-order fence counted the
     phrase `runLadder(IMAGE_REFUSAL_LADDER, …)` inside a revert instruction as a call.

     Measured before changing: of the fourteen anchors, exactly ONE counts differently
     with comments stripped, and for that one the code-only count equals the number the
     registry already declared. So this narrows the census to what it always meant, and
     widens nothing. คอมเมนต์ที่พูดถึงโค้ด ไม่ใช่โค้ด */
  const codeLinesOf = (file: string): string[] => {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const kinds = classifyLines(src);
    return src.split('\n').filter((_, i) => kinds[i] === 'code');
  };
  const countOf = (anchor: Anchor): number =>
    codeLinesOf(anchor.file ?? registry.file).filter((l) =>
      l.includes(anchor.text),
    ).length;

  it('registers anchors at all', () => {
    expect(registry.anchors.length).toBeGreaterThan(0);
  });

  for (const anchor of registry.anchors) {
    it(`${anchor.id}: appears exactly ${anchor.occurrences}x`, () => {
      // A rename, a copy-paste, or a new call site all land here by name.
      expect(countOf(anchor)).toBe(anchor.occurrences);
    });
  }

  it('forces a disambiguation rule on every non-unique anchor', () => {
    // The rule the audit had to add the hard way: `if (event.type === 'message')` occurs
    // twice, and a pin written against it without saying WHICH one matched both places.
    const ambiguous = registry.anchors.filter((a) => a.occurrences > 1);
    const missingRule = ambiguous.filter(
      (a) => !a.which && !a.role.includes('⚠'),
    );
    expect(missingRule.map((a) => a.id)).toEqual([]);
  });

  it('lists the spine anchors in the order they appear in the spine', () => {
    // Extracted anchors leave the ordering set: they no longer have a position here.
    const positions = registry.anchors
      .filter((a) => !a.file)
      .map((a) => lines.findIndex((l) => l.includes(a.text)));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  it('records a role for every anchor — an anchor nobody can explain is not navigation', () => {
    expect(
      registry.anchors
        .filter((a) => !a.role || a.role.length < 20)
        .map((a) => a.id),
    ).toEqual([]);
  });
});
