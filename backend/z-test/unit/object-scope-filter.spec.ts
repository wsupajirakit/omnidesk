/**
 * [FEAT-20260901-OBJSCOPE] The scope rule, pinned.
 *
 * `objectScopeFilter` / `objectRuntimeScopeFilter` are pure, so these cases run
 * the real builder — no model, no DI, no staging. Two things are being defended:
 *
 *  1. **absent / `[]` = unrestricted.** Every row that exists predates these
 *     columns. A fail-closed reading empties every admin screen and stops every
 *     image the bot sends.
 *  2. **`status` is `$ne: false`, never `=== true`.** Pre-existing rows carry no
 *     `status` key, so an equality match skips all of them.
 *
 * Rather than assert on filter shapes alone — which pass while meaning the
 * wrong thing — most cases run the produced filter against real documents with
 * a small matcher, so what is proven is which ROWS survive.
 */
import { Types } from 'mongoose';

import { objectRuntimeScopeFilter, objectScopeFilter } from '@/modules/content';

const oid = (hex: string) => new Types.ObjectId(hex);
const G1 = 'a0d00000000000000000003b';
const G2 = 'a0d000000000000000000059';
const H1 = 'a0d00000000000000000005a';
const H2 = 'a0d00000000000000000003c';

/**
 * The subset of Mongo's matching this filter uses: `$and`, `$or`, `$exists`,
 * `$in`, `$ne`, exact-array equality, and "array contains" equality.
 *
 * Written out rather than mocked so a case failing means the FILTER is wrong,
 * not that a stub drifted.
 */
function matches(doc: Record<string, unknown>, filter: unknown): boolean {
  if (filter === null || typeof filter !== 'object') return false;
  const f = filter as Record<string, unknown>;

  return Object.entries(f).every(([key, cond]) => {
    if (key === '$and')
      return (cond as unknown[]).every((c) => matches(doc, c));
    if (key === '$or') return (cond as unknown[]).some((c) => matches(doc, c));

    const value = doc[key];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$exists' in c) return (value !== undefined) === c['$exists'];
      if ('$ne' in c) return value !== c['$ne'];
      if ('$in' in c) {
        const wanted = (c['$in'] as unknown[]).map(String);
        const held = Array.isArray(value) ? value.map(String) : [String(value)];
        return held.some((v) => wanted.includes(v));
      }
    }
    /* Exact-array equality. ⚠️ Compare the CONTENTS, not the lengths: an
       earlier version compared `value.length === cond.length`, which made
       `{hook_ids: []}` match a document holding one id, so deleting the whole
       OA leg still passed every case. */
    if (Array.isArray(cond)) {
      return (
        Array.isArray(value) &&
        value.length === cond.length &&
        value.every((v, i) => String(v) === String(cond[i]))
      );
    }
    /* Equality against an array column means "contains" in Mongo. */
    return Array.isArray(value)
      ? value.map(String).includes(String(cond))
      : String(value) === String(cond);
  });
}

/** The rows that actually exist today: no scope keys, no status key. */
const LEGACY_ROW = { name: 'pre-existing' };

describe('objectScopeFilter — admin lists', () => {
  const forOperator = (over: Record<string, unknown> = {}) =>
    objectScopeFilter({
      groupIds: [G1],
      allowedHookIds: [H1],
      ...over,
    });

  it('a superuser gets no scope legs at all', () => {
    const filter = objectScopeFilter({
      groupIds: [G1],
      allowedHookIds: null,
      includeDisabled: true,
    });
    expect(filter).toEqual({});
  });

  it('a superuser still gets the status leg when disabled rows are excluded', () => {
    const filter = objectScopeFilter({ allowedHookIds: null });
    expect(matches({ ...LEGACY_ROW, status: false }, filter)).toBe(false);
    expect(matches(LEGACY_ROW, filter)).toBe(true);
  });

  it('a row with NO scope columns stays visible — nothing that exists disappears', () => {
    expect(matches(LEGACY_ROW, forOperator())).toBe(true);
  });

  it('a row scoped to an empty list stays visible', () => {
    const row = { group_providers: [], hook_ids: [] };
    expect(matches(row, forOperator())).toBe(true);
  });

  it("a row scoped to the caller's own group is visible", () => {
    const row = { group_providers: [oid(G1)], hook_ids: [] };
    expect(matches(row, forOperator())).toBe(true);
  });

  it("a row scoped to SOMEONE ELSE'S group is hidden", () => {
    const row = { group_providers: [oid(G2)], hook_ids: [] };
    expect(matches(row, forOperator())).toBe(false);
  });

  /* ⚠️ The group leg must NOT be what rejects this row, or the case proves
     nothing about the OA leg — deleting the OA leg entirely would still pass.
     So: the group is the caller's own AND the row is unrestricted by group in
     the second case, leaving the OA leg as the only thing that can reject. */
  it("a row scoped to someone else's OA is hidden even when the group matches", () => {
    const row = { group_providers: [oid(G1)], hook_ids: [oid(H2)] };
    expect(matches(row, forOperator())).toBe(false);
  });

  it("a row with NO group scope but someone else's OA is hidden — the OA leg alone rejects it", () => {
    const row = { hook_ids: [oid(H2)] };
    expect(matches(row, forOperator())).toBe(false);
  });

  it('an operator with no groups still sees unrestricted rows, and only those', () => {
    const filter = objectScopeFilter({ groupIds: [], allowedHookIds: [] });
    expect(matches(LEGACY_ROW, filter)).toBe(true);
    expect(matches({ group_providers: [oid(G1)] }, filter)).toBe(false);
  });

  it('a garbage group id cannot widen the scope', () => {
    const filter = objectScopeFilter({
      groupIds: ['not-an-object-id'],
      allowedHookIds: [H1],
    });
    expect(matches({ group_providers: [oid(G1)] }, filter)).toBe(false);
    expect(matches(LEGACY_ROW, filter)).toBe(true);
  });

  describe('the switch', () => {
    it('a switched-off row is hidden from the runtime-facing default', () => {
      const row = { group_providers: [oid(G1)], status: false };
      expect(matches(row, forOperator())).toBe(false);
    });

    it('admin screens keep showing switched-off rows, or they can never be switched on again', () => {
      const row = { group_providers: [oid(G1)], status: false };
      expect(matches(row, forOperator({ includeDisabled: true }))).toBe(true);
    });

    /* The whole reason the leg is `$ne: false`. */
    it('a row with NO status key counts as ON', () => {
      expect(matches(LEGACY_ROW, forOperator())).toBe(true);
    });

    it('status: true is ON', () => {
      expect(matches({ status: true }, forOperator())).toBe(true);
    });
  });
});

describe('objectRuntimeScopeFilter — one conversation, one OA', () => {
  it('refuses when the OA cannot be identified — the caller must skip the lookup', () => {
    expect(objectRuntimeScopeFilter(undefined, G1)).toBeNull();
    expect(objectRuntimeScopeFilter('', G1)).toBeNull();
    expect(objectRuntimeScopeFilter('not-an-object-id', G1)).toBeNull();
  });

  it('an album with no scope is served — every album that exists today keeps working', () => {
    const filter = objectRuntimeScopeFilter(H1, G1);
    expect(matches(LEGACY_ROW, filter)).toBe(true);
  });

  it("an album scoped to this conversation's group is served", () => {
    const filter = objectRuntimeScopeFilter(H1, G1);
    expect(matches({ group_providers: [oid(G1)] }, filter)).toBe(true);
  });

  /* The leak this change exists to close, and the owner's decision that albums
     already carrying a scope are honoured as written. */
  it('an album scoped to ANOTHER group is NOT served', () => {
    const filter = objectRuntimeScopeFilter(H1, G1);
    expect(matches({ group_providers: [oid(G2)] }, filter)).toBe(false);
  });

  it('an album scoped to another OA is NOT served, even in the right group', () => {
    const filter = objectRuntimeScopeFilter(H1, G1);
    const row = { group_providers: [oid(G1)], hook_ids: [oid(H2)] };
    expect(matches(row, filter)).toBe(false);
  });

  it('an album scoped to this OA is served', () => {
    const filter = objectRuntimeScopeFilter(H1, G1);
    expect(matches({ hook_ids: [oid(H1)] }, filter)).toBe(true);
  });

  it('a switched-off album is not served — same outcome as out of scope', () => {
    const filter = objectRuntimeScopeFilter(H1, G1);
    const row = { group_providers: [oid(G1)], status: false };
    expect(matches(row, filter)).toBe(false);
  });

  it('accepts an ObjectId as readily as its hex string', () => {
    const filter = objectRuntimeScopeFilter(oid(H1), oid(G1));
    expect(matches({ group_providers: [oid(G1)] }, filter)).toBe(true);
  });

  /* A hook carrying no group is legal. Refusing outright would take images from
     OAs that work today for a reason the owner never asked about, so the group
     leg narrows to the unrestricted rows and the OA leg still does the scoping. */
  it('a hook with no group still serves unrestricted albums, but not group-scoped ones', () => {
    const filter = objectRuntimeScopeFilter(H1, undefined);
    expect(matches(LEGACY_ROW, filter)).toBe(true);
    expect(matches({ hook_ids: [oid(H1)] }, filter)).toBe(true);
    expect(matches({ group_providers: [oid(G1)] }, filter)).toBe(false);
  });

  it('nests the legs under $and so a later $or cannot overwrite the scope', () => {
    const filter = objectRuntimeScopeFilter(H1, G1);
    expect(Object.keys(filter ?? {})).toEqual(['$and']);
  });
});
