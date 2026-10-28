/**
 * [FEAT-20260822-BCASTOASCOPE] A recipient list is only usable once it has been
 * narrowed to ONE OA. These cases pin that narrowing.
 */
import {
  OA_SCOPE_BATCH,
  buildOaScopeQueries,
  needsOaScope,
} from '@/modules/content';

describe('per-OA scoping — the step the first design was missing', () => {
  it('asks chat_rooms, because members has no OA column at all', () => {
    const q = buildOaScopeQueries(['m1', 'm2'], 'hookA');
    expect(q).toHaveLength(1);
    expect(q?.[0]?.collection).toBe('chat_rooms');
    expect(q?.[0]?.filter.hook_id).toBe('hookA');
    expect(q?.[0]?.filter.user_id.$in).toEqual(['m1', 'm2']);
  });

  it('reads only the id it needs, and drops _id', () => {
    const q = buildOaScopeQueries(['m1'], 'hookA');
    expect(q?.[0]?.projection).toEqual({ line_user_id: 1, _id: 0 });
  });

  it('🔴 refuses to build a query without an OA — that query matches everyone', () => {
    // A missing hook_id would return rooms from every OA, which is precisely
    // the mixing that makes a campaign report 5,000 and reach 1,000.
    for (const bad of [null, undefined, '']) {
      expect(buildOaScopeQueries(['m1'], bad)).toBeNull();
    }
  });

  it('pages large lists instead of one enormous $in', () => {
    const ids = Array.from({ length: 2_500 }, (_, i) => `m${i}`);
    const q = buildOaScopeQueries(ids, 'hookA');
    expect(q).toHaveLength(3);
    expect(q?.[0]?.filter.user_id.$in).toHaveLength(OA_SCOPE_BATCH);
    expect(q?.[2]?.filter.user_id.$in).toHaveLength(500);
  });

  it('an empty match asks nothing at all — that is not a failure', () => {
    expect(buildOaScopeQueries([], 'hookA')).toEqual([]);
    expect(buildOaScopeQueries([null, undefined, ''], 'hookA')).toEqual([]);
  });

  it('falls back to a sane batch size rather than trusting a bad one', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `m${i}`);
    expect(buildOaScopeQueries(ids, 'h', 0)).toHaveLength(1);
    expect(buildOaScopeQueries(ids, 'h', Number.NaN)).toHaveLength(1);
    expect(buildOaScopeQueries(ids, 'h', 2)).toHaveLength(3);
  });

  it('🔴 an unknown source is assumed NOT scoped — the safe assumption', () => {
    // Guessing "already scoped" sends a campaign into the wrong channel;
    // guessing "not scoped" costs one extra query.
    expect(needsOaScope(null)).toBe(true);
    expect(needsOaScope({})).toBe(true);
    expect(needsOaScope({ scope_by_hook: false })).toBe(true);
    // customer_tags carries hook_id itself, so it may skip step 2.
    expect(needsOaScope({ scope_by_hook: true })).toBe(false);
  });
});
