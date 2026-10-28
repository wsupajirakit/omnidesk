/**
 * [PERF-20260821-MEMBERSEARCH] The read side: ONE builder decides what the
 * ticket search asks the members collection. `legacy_regex` must be the query
 * shipped on 19/08 byte for byte (it is what ships today); `tokens` is the
 * index-served shape, bounded by a minimum length and a result cap — never by
 * scope or time (owner: search stays global).
 */
import {
  MEMBER_SEARCH_MODE,
  MEMBER_SEARCH_MIN_CHARS,
  MEMBER_SEARCH_RESULT_CAP,
  buildMemberSearchQuery,
} from '@/modules/tickets';

describe('the switch ships in legacy mode', () => {
  it('MEMBER_SEARCH_MODE is legacy_regex until the buckets have filled', () => {
    expect(MEMBER_SEARCH_MODE).toBe('legacy_regex');
  });
});

describe('legacy_regex — the 19/08 query, byte for byte', () => {
  it('ten fields, unanchored, case-insensitive, escaped; no limit', () => {
    const q = buildMemberSearchQuery('08+', 'legacy_regex');
    expect(q).not.toBeNull();
    const rx = new RegExp('08\\+', 'i');
    expect(q!.filter).toEqual({
      $or: [
        { display_name: rx },
        { nickname: rx },
        { member_user_id: rx },
        { full_name: rx },
        { phone_number: rx },
        { contract_code: rx },
        { detail: rx },
        { 'raw_profile_data.data.profile.phone': rx },
        { 'raw_profile_data.data.profile.bank.account_no': rx },
        { 'raw_profile_data.data.profile.bank.account_name': rx },
      ],
    });
    expect(q!.limit).toBeNull();
  });
  it('a 1-character term still searches in legacy mode (today has no minimum)', () => {
    expect(buildMemberSearchQuery('a', 'legacy_regex')).not.toBeNull();
  });
});

describe('tokens — anchored on the buckets, bounded', () => {
  it('lowercased, escaped, ^-anchored on every bucket; capped', () => {
    const q = buildMemberSearchQuery('Som+', 'tokens');
    const rx = new RegExp('^som\\+');
    expect(q!.filter).toEqual({
      $or: [
        { 'search.display_name': rx },
        { 'search.nickname': rx },
        { 'search.full_name': rx },
        { 'search.phone_number': rx },
        { 'search.contract_code': rx },
        { 'search.member_user_id': rx },
        { 'search.detail': rx },
        { 'search.profile': rx },
      ],
    });
    expect(q!.limit).toBe(MEMBER_SEARCH_RESULT_CAP);
    expect(MEMBER_SEARCH_RESULT_CAP).toBe(200);
  });

  it('a digit-ish term: DIGIT buckets get the \\D-stripped form ("087/941" → ^087941), TEXT buckets keep the raw term', () => {
    const q = buildMemberSearchQuery('087/941', 'tokens');
    const or = q!.filter['$or'] as Array<Record<string, RegExp>>;
    expect(or[3]!['search.phone_number']).toEqual(new RegExp('^087941'));
    expect(or[7]!['search.profile']).toEqual(new RegExp('^087941'));
    expect(or[0]!['search.display_name']).toEqual(new RegExp('^087\\/941'));
  });
  it('a dashed contract code "2024-001" still meets its text bucket as-is (review: one normalisation for all buckets lost it)', () => {
    const q = buildMemberSearchQuery('2024-001', 'tokens');
    const or = q!.filter['$or'] as Array<Record<string, RegExp>>;
    expect(or[4]!['search.contract_code']).toEqual(new RegExp('^2024-001'));
    expect(or[3]!['search.phone_number']).toEqual(new RegExp('^2024001'));
  });
  it('below the minimum length → null = do not ask the database at all', () => {
    expect(MEMBER_SEARCH_MIN_CHARS).toBe(2);
    expect(buildMemberSearchQuery('a', 'tokens')).toBeNull();
    expect(buildMemberSearchQuery(' ', 'tokens')).toBeNull();
  });
  it('the regex is case-sensitive on purpose — the buckets are lowercased, so the `i` flag would cost the index', () => {
    const q = buildMemberSearchQuery('AB', 'tokens');
    const rx = (q!.filter['$or'] as Array<Record<string, RegExp>>)[0]![
      'search.display_name'
    ]!;
    expect(rx.flags).toBe('');
    expect(rx.source.startsWith('^')).toBe(true);
  });
});
