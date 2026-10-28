/* [FE] [FEAT-20260816-GROUPSCOPECLONE] — the request builder decides what a
 * selection MEANS, so it is tested without a browser.
 *
 * The one that matters: a group must never appear as its own target. Under
 * "add" that is a harmless no-op, but the same body with mode=remove is the
 * undo button — and an undo that included the source would pull the source
 * group out of its own tags. The API refuses it too; this keeps the screen from
 * ever asking.
 *
 * revert: delete together with services/admin/groupScopeService.ts.
 */
import { describe, it, expect } from 'vitest';

import {
  buildScopeCloneRequest,
  isScopeCloneReady,
  sumScopeCloneTargets,
  type ScopeCloneResult,
} from '../services/admin/groupScopeService';

const SRC = 'g-source';
const A = 'g-a';
const B = 'g-b';
const BOTH = { dynamic_tags: true, flex_messages: true };

describe('buildScopeCloneRequest', () => {
  it('keeps the chosen targets, in order', () => {
    const req = buildScopeCloneRequest(SRC, [A, B], BOTH);
    expect(req).toEqual({
      source_group_id: SRC,
      target_group_ids: [A, B],
      include: BOTH,
      mode: 'add',
    });
  });

  it('never lets the source be one of its own targets', () => {
    const req = buildScopeCloneRequest(SRC, [A, SRC, B], BOTH);
    expect(req.target_group_ids).toEqual([A, B]);
  });

  it('collapses duplicates and drops empty ids', () => {
    const req = buildScopeCloneRequest(SRC, [A, A, '', B, A], BOTH);
    expect(req.target_group_ids).toEqual([A, B]);
  });

  it('carries the mode through — the undo sends the same body', () => {
    const add = buildScopeCloneRequest(SRC, [A], BOTH);
    const undo = buildScopeCloneRequest(SRC, [A], BOTH, 'remove');
    expect({ ...undo, mode: 'add' }).toEqual(add);
    expect(undo.mode).toBe('remove');
  });
});

describe('isScopeCloneReady', () => {
  it('needs a source, at least one target and at least one thing to copy', () => {
    expect(isScopeCloneReady(buildScopeCloneRequest(SRC, [A], BOTH))).toBe(true);
    expect(isScopeCloneReady(buildScopeCloneRequest('', [A], BOTH))).toBe(false);
    expect(isScopeCloneReady(buildScopeCloneRequest(SRC, [], BOTH))).toBe(false);
    expect(isScopeCloneReady(buildScopeCloneRequest(SRC, [SRC], BOTH))).toBe(false);
    expect(
      isScopeCloneReady(
        buildScopeCloneRequest(SRC, [A], { dynamic_tags: false, flex_messages: false }),
      ),
    ).toBe(false);
  });

  it('one side alone is enough', () => {
    expect(
      isScopeCloneReady(
        buildScopeCloneRequest(SRC, [A], { dynamic_tags: true, flex_messages: false }),
      ),
    ).toBe(true);
    expect(
      isScopeCloneReady(
        buildScopeCloneRequest(SRC, [A], { dynamic_tags: false, flex_messages: true }),
      ),
    ).toBe(true);
  });
});

describe('sumScopeCloneTargets', () => {
  const result = (targets: ScopeCloneResult['targets']): ScopeCloneResult => ({
    applied: true,
    mode: 'add',
    source_group_id: SRC,
    source_totals: { dynamic_tags: 801, flex_messages: 39 },
    targets,
  });

  it('adds up every target', () => {
    expect(
      sumScopeCloneTargets(
        result([
          { group_id: A, dynamic_tags: 801, flex_messages: 39 },
          { group_id: B, dynamic_tags: 12, flex_messages: 1 },
        ]),
      ),
    ).toEqual({ dynamic_tags: 813, flex_messages: 40 });
  });

  it('answers zero for nothing, rather than throwing', () => {
    expect(sumScopeCloneTargets(null)).toEqual({ dynamic_tags: 0, flex_messages: 0 });
    expect(sumScopeCloneTargets(result([]))).toEqual({ dynamic_tags: 0, flex_messages: 0 });
  });
});
