/**
 * [PERF-20260821-MEMBERSEARCH] The search buckets a member row carries, and the
 * two doors that fill them — both pure, both pinned here without Mongo.
 *
 * WHY BUCKETS PER SOURCE FIELD: every member writer in the codebase (8 sites, 6
 * modules) sends a PARTIAL `$set`. An update hook sees only the fields being
 * written, so each field keeps its own bucket and only that bucket is rewritten.
 * One array for all fields would need the whole document on every write.
 */
import {
  MEMBER_SEARCH_FIELDS,
  tokensForText,
  tokensForDigits,
  tokensForProfile,
  searchBucketsForDoc,
  applySearchBucketsToUpdate,
} from '@/modules/chat';

describe('tokensForText — lowercase, whole value + each word', () => {
  it('"สมชาย ใจดี" → [whole, each word]', () => {
    expect(tokensForText('สมชาย ใจดี')).toEqual([
      'สมชาย ใจดี',
      'สมชาย',
      'ใจดี',
    ]);
  });
  it('lowercases and trims, dedupes, drops empties/placeholders', () => {
    expect(tokensForText('  John  Doe ')).toEqual(['john doe', 'john', 'doe']);
    expect(tokensForText('Unknown')).toEqual([]);
    expect(tokensForText('')).toEqual([]);
    expect(tokensForText(undefined)).toEqual([]);
    expect(tokensForText(null)).toEqual([]);
  });
});

describe('tokensForDigits — phone / account: all digits + last 8/6/4', () => {
  it('"087-555-0016" → digits, last8, last6, last4', () => {
    expect(tokensForDigits('087-555-0016')).toEqual([
      '0875550016',
      '75550016',
      '550016',
      '0016',
    ]);
  });
  it('short values do not repeat themselves', () => {
    expect(tokensForDigits('1234')).toEqual(['1234']);
    expect(tokensForDigits('12345')).toEqual(['12345', '2345']);
  });
  it('non-digit / empty → []', () => {
    expect(tokensForDigits('N/A')).toEqual([]);
    expect(tokensForDigits(undefined)).toEqual([]);
  });
});

describe('tokensForProfile — the three raw_profile_data paths the search reads', () => {
  const raw = {
    data: {
      profile: {
        phone: '0812345678',
        bank: { account_no: '123-4-56789-0', account_name: 'นาย ทดสอบ ระบบ' },
      },
    },
  };
  it('phone + account_no as digits, account_name as text, in one bucket', () => {
    expect(tokensForProfile(raw)).toEqual([
      '0812345678',
      '12345678',
      '345678',
      '5678',
      '1234567890',
      '34567890',
      '567890',
      '7890',
      'นาย ทดสอบ ระบบ',
      'นาย',
      'ทดสอบ',
      'ระบบ',
    ]);
  });
  it('null / malformed / missing paths → []', () => {
    expect(tokensForProfile(null)).toEqual([]);
    expect(tokensForProfile('')).toEqual([]);
    expect(tokensForProfile({ data: {} })).toEqual([]);
    expect(tokensForProfile({ data: { profile: { bank: 'oops' } } })).toEqual(
      [],
    );
  });
});

describe('searchBucketsForDoc — the save/validate door', () => {
  it('fills one bucket per searchable field from a whole document', () => {
    const b = searchBucketsForDoc({
      display_name: 'Sz',
      nickname: 'ซี',
      full_name: 'เทสสมัครแบบไม่มี OTP',
      phone_number: '0875550016',
      contract_code: 'C-77',
      member_user_id: 'Ub3f6A4D6',
      detail: 'vip ลูกค้าเก่า',
      raw_profile_data: null,
    });
    expect(b).toEqual({
      display_name: ['sz'],
      nickname: ['ซี'],
      full_name: ['เทสสมัครแบบไม่มี otp', 'เทสสมัครแบบไม่มี', 'otp'],
      phone_number: ['0875550016', '75550016', '550016', '0016'],
      contract_code: ['c-77'],
      member_user_id: ['ub3f6a4d6'],
      detail: ['vip ลูกค้าเก่า', 'vip', 'ลูกค้าเก่า'],
      profile: [],
    });
  });
  it('MEMBER_SEARCH_FIELDS is exactly the list the ticket search reads (7 columns + profile)', () => {
    expect([...MEMBER_SEARCH_FIELDS]).toEqual([
      'display_name',
      'nickname',
      'full_name',
      'phone_number',
      'contract_code',
      'member_user_id',
      'detail',
    ]);
  });
});

describe('applySearchBucketsToUpdate — the update door (partial $set stays partial)', () => {
  it('$set of one field → only that bucket is set, nothing else touched', () => {
    const u: Record<string, unknown> = { $set: { nickname: 'ซี' } };
    applySearchBucketsToUpdate(u);
    expect(u).toEqual({ $set: { nickname: 'ซี', 'search.nickname': ['ซี'] } });
  });
  it('$set of phone + full_name → two buckets; raw_profile_data → profile bucket', () => {
    const u: Record<string, unknown> = {
      $set: {
        phone_number: '0812345678',
        full_name: 'A B',
        raw_profile_data: { data: { profile: { phone: '0899' } } },
      },
    };
    applySearchBucketsToUpdate(u);
    expect(
      (u['$set'] as Record<string, unknown>)['search.phone_number'],
    ).toEqual(['0812345678', '12345678', '345678', '5678']);
    expect((u['$set'] as Record<string, unknown>)['search.full_name']).toEqual([
      'a b',
      'a',
      'b',
    ]);
    expect((u['$set'] as Record<string, unknown>)['search.profile']).toEqual([
      '0899',
    ]);
  });
  it('$setOnInsert fields get their buckets in $setOnInsert (an upsert-created row is searchable at once)', () => {
    const u: Record<string, unknown> = {
      $setOnInsert: { display_name: 'Sz', nickname: 'Sz' },
      $set: { last_synced_at: 1 },
    };
    applySearchBucketsToUpdate(u);
    expect(
      (u['$setOnInsert'] as Record<string, unknown>)['search.display_name'],
    ).toEqual(['sz']);
    expect(
      (u['$set'] as Record<string, unknown>)['search.display_name'],
    ).toBeUndefined();
  });

  it('$set to ""/null → that bucket becomes []', () => {
    const u: Record<string, unknown> = {
      $set: { full_name: '', phone_number: null },
    };
    applySearchBucketsToUpdate(u);
    expect((u['$set'] as Record<string, unknown>)['search.full_name']).toEqual(
      [],
    );
    expect(
      (u['$set'] as Record<string, unknown>)['search.phone_number'],
    ).toEqual([]);
  });
  it('$unset of a source field → the bucket is $unset too (NOT $set []): a missing path is a no-op, so modifiedCount stays honest', () => {
    // review finding: members.service reports `cleared` from modifiedCount; a
    // `$set search.profile: []` on a row that never had the bucket would report
    // a change that did not happen.
    const u: Record<string, unknown> = { $unset: { raw_profile_data: '' } };
    applySearchBucketsToUpdate(u);
    expect(u).toEqual({
      $unset: { raw_profile_data: '', 'search.profile': '' },
    });
    expect(u).not.toHaveProperty('$set');
  });
  it('an update that touches no searchable field is left byte-identical', () => {
    const u: Record<string, unknown> = {
      $set: { last_synced_at: 1, picture_url: 'x' },
    };
    const before = JSON.stringify(u);
    applySearchBucketsToUpdate(u);
    expect(JSON.stringify(u)).toBe(before);
  });
  it('never writes a top-level `search` object that would wipe sibling buckets — always dotted paths', () => {
    const u: Record<string, unknown> = {
      $set: { nickname: 'a', full_name: 'b' },
    };
    applySearchBucketsToUpdate(u);
    expect(Object.keys(u['$set'] as object)).not.toContain('search');
  });
});
