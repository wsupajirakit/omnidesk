/**
 * [PERF-20260822-LISTMEMBERTRIM] The list row loses ONLY the eight columns no
 * consumer reads, and every column a consumer DOES read survives.
 *
 * WHY EACH CASE EXISTS: a field-dropping bug is invisible to every other test —
 * the response still parses, the page still renders, and one badge or one
 * search result quietly stops working. These cases name the reader behind each
 * survivor so a future edit has to argue with the reader, not with a list.
 */
import {
  READ_MEMBER_KEYS,
  UNREAD_MEMBER_KEYS,
  trimListMember,
} from '@/modules/tickets/list-member-trim';

/** A member shaped like a real row: every key a consumer reads, plus the eight. */
const memberRow = (): Record<string, unknown> => ({
  _id: 'm1',
  line_user_id: 'U1',
  channel_user_id: 'C1',
  display_name: 'สมชาย',
  nickname: 'ชาย',
  picture_url: 'https://x/p.jpg',
  phone_number: '0812345678',
  contract_code: 'ABC-1',
  full_name: 'สมชาย ใจดี',
  detail: 'สมชาย|0812345678|ABC-1',
  tier: 'gold',
  raw_profile_data: { data: { profile: { phone: '0812345678' } } },
  link_registered_by: 'liff',
  link_registered_at: '2026-08-01T00:00:00.000Z',
  ignore_abandon_assist: true,
  // the eight
  member_user_id: 'U1',
  status_message: 'hello',
  last_synced_at: '2026-08-20T00:00:00.000Z',
  profile_data_updated_at: '2026-08-20T00:00:00.000Z',
  config: { anything: 1 },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-21T00:00:00.000Z',
  __v: 0,
});

describe('⭐ every column a dashboard consumer reads survives the trim', () => {
  it.each(READ_MEMBER_KEYS.map((k) => [k]))(
    '`%s` is still on the row',
    (key) => {
      const out = trimListMember(memberRow()) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(out, key)).toBe(true);
    },
  );

  it('their VALUES are untouched, not just present', () => {
    const src = memberRow();
    const out = trimListMember(src) as Record<string, unknown>;
    for (const k of READ_MEMBER_KEYS) expect(out[k]).toEqual(src[k]);
  });

  it('`tier` survives — it LOOKS redundant with raw_profile_data but memberTier.ts:60 falls back to it', () => {
    const out = trimListMember(memberRow()) as Record<string, unknown>;
    expect(out['tier']).toBe('gold');
  });

  it('`ignore_abandon_assist` survives — it travels a prop chain that grep does not find', () => {
    const out = trimListMember(memberRow()) as Record<string, unknown>;
    expect(out['ignore_abandon_assist']).toBe(true);
  });

  it('`channel_user_id` survives — memberSearchText.ts:128 puts it in the search haystack', () => {
    const out = trimListMember(memberRow()) as Record<string, unknown>;
    expect(out['channel_user_id']).toBe('C1');
  });
});

describe('⭐ the eight unread columns are gone', () => {
  it.each(UNREAD_MEMBER_KEYS.map((k) => [k]))('`%s` is removed', (key) => {
    const out = trimListMember(memberRow()) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, key)).toBe(false);
  });

  it('removes EXACTLY those eight and nothing else', () => {
    const src = memberRow();
    const out = trimListMember(src) as Record<string, unknown>;
    const removed = Object.keys(src).filter(
      (k) => !Object.prototype.hasOwnProperty.call(out, k),
    );
    expect(removed.sort()).toEqual([...UNREAD_MEMBER_KEYS].sort());
  });
});

describe('⭐ it is a DENY-list — a column nobody has thought of yet survives', () => {
  it('an unknown column added by a future feature is kept', () => {
    const out = trimListMember({
      _id: 'm1',
      some_future_column: 'keep me',
    }) as Record<string, unknown>;
    expect(out['some_future_column']).toBe('keep me');
  });

  it('a member consisting ONLY of unread columns becomes an empty object, not null', () => {
    // The green avatar ring asks `Object.keys(profile).length > 0` of the
    // PROFILE, not of the member, so an empty member is safe here — but it
    // must stay an object so `lud && typeof lud === 'object'` still holds.
    const out = trimListMember({ created_at: 'x', __v: 0 });
    expect(out).toEqual({});
    expect(typeof out).toBe('object');
  });
});

describe('⭐ pure and non-mutating — the caller may still hold the lean document', () => {
  it('the input object is not modified', () => {
    const src = memberRow();
    const snapshot = JSON.stringify(src);
    trimListMember(src);
    expect(JSON.stringify(src)).toBe(snapshot);
  });

  it('a non-object comes back untouched', () => {
    expect(trimListMember(null)).toBeNull();
    expect(trimListMember(undefined)).toBeUndefined();
    expect(trimListMember('x')).toBe('x');
    const arr = [1, 2];
    expect(trimListMember(arr)).toBe(arr);
  });
});

describe('⭐ the two lists do not overlap — a name cannot be both kept and cut', () => {
  it('no key appears in both READ_MEMBER_KEYS and UNREAD_MEMBER_KEYS', () => {
    const cut = new Set<string>(UNREAD_MEMBER_KEYS);
    expect(READ_MEMBER_KEYS.filter((k) => cut.has(k))).toEqual([]);
  });
});
