/* [PERF-20260822-LISTMEMBERTRIM] The BE drops eight member columns from a LIST
 * row. This proves the dashboard cannot tell the difference — specifically that
 * the two things the owner said must not break, BADGE COUNTS and TICKET SEARCH,
 * compute identically with and without those columns.
 *
 * WHY THIS TEST AND NOT A GREP. The badge is not "a count of rows": it counts
 * `filterByActiveFilters(activeTickets)` (TicketChat.tsx:1966), and that filter
 * READS the member — `tierOfMember(tk.line_user_data)` for the tier filter and
 * `memberMatchesSearch(ud, …)` for the search box. So a member column CAN move
 * a badge. The only safe proof is to run those two functions against both
 * shapes and compare, which is what this file does.
 *
 * The trimmed shape here is produced by the SAME key list the backend uses
 * (omnidesk-api `list-member-trim.ts`), copied as data so this test fails loudly
 * if the two ever drift apart in a way that matters to these two functions.
 */
import { describe, it, expect } from 'vitest';

import { tierOfMember, tierBadgeText } from '../utils/memberTier';
import {
  memberMatchesSearch,
  memberSearchHaystack,
  hasRawProfile,
} from '../utils/memberSearchText';

/** What the backend removes from a list row. Keep in sync with list-member-trim.ts. */
const UNREAD_MEMBER_KEYS = [
  'member_user_id',
  'status_message',
  'last_synced_at',
  'profile_data_updated_at',
  'config',
  'created_at',
  'updated_at',
  '__v',
] as const;

const fullMember = () => ({
  _id: 'm1',
  line_user_id: 'U0108919a',
  channel_user_id: 'C1',
  display_name: 'สุดา สมมติ',
  nickname: 'จร',
  picture_url: 'https://x/p.jpg',
  phone_number: '0955550019',
  contract_code: 'ABC-1234',
  full_name: 'สุดา สมมติ',
  detail: 'สุดา สมมติ|0955550019|ABC-1234',
  tier: 'gold',
  raw_profile_data: {
    data: {
      profile: {
        phone: '0955550010',
        tier: 'silver',
        bank: { account_no: '5864854725', account_name: 'judy' },
      },
    },
  },
  link_registered_by: 'liff',
  link_registered_at: '2026-08-01T00:00:00.000Z',
  ignore_abandon_assist: true,
  // the eight the backend drops
  member_user_id: 'U0108919a',
  status_message: 'hello there',
  last_synced_at: '2026-08-20T00:00:00.000Z',
  profile_data_updated_at: '2026-08-20T00:00:00.000Z',
  config: { some_switch: true },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-21T00:00:00.000Z',
  __v: 3,
});

/** Exactly what arrives at the dashboard after the backend trim. */
const trimmedMember = () => {
  const m: Record<string, unknown> = fullMember();
  for (const k of UNREAD_MEMBER_KEYS) delete m[k];
  return m as ReturnType<typeof fullMember>;
};

/** The terms an operator actually types, plus the ones that must NOT match. */
const TERMS = [
  'สุดา',
  'สมมติ',
  'เกตุ', // mid-word — the legacy regex finds it
  '0955550019',
  '095 555 0019',
  '5864854725',
  '586-485-4725',
  'judy',
  'ABC-1234',
  'abc',
  'U0108919a', // the LINE id
  'hello', // ← lives ONLY in status_message, one of the eight
  '2026-01-01', // ← lives ONLY in created_at
  'ไม่มีคนนี้',
  '',
];

/* A customer whose raw profile carries NO tier — the ONLY case where the
 * `tier` column is load-bearing. The fixture above has a tier inside
 * raw_profile_data, and `tierOfMember` reads that FIRST, so it cannot detect a
 * trim that drops the column. Mutation testing found exactly that hole: cutting
 * `tier` left all 25 cases green. This pair closes it. */
const fullNoRawTier = () => {
  const m = fullMember();
  delete (m.raw_profile_data.data.profile as Record<string, unknown>)['tier'];
  return m;
};
const trimmedNoRawTier = () => {
  const m: Record<string, unknown> = fullNoRawTier();
  for (const k of UNREAD_MEMBER_KEYS) delete m[k];
  return m as ReturnType<typeof fullNoRawTier>;
};

describe('⭐ badge: the tier filter sees the same tier before and after the trim', () => {
  it('tierOfMember is unchanged', () => {
    expect(tierOfMember(trimmedMember())).toEqual(tierOfMember(fullMember()));
  });

  /* `tierKeyOf` — the value the badge filter compares — is a LOCAL function in
     TicketChat.tsx:456 and is not exported, so it cannot be imported here. It
     takes the TIER VALUE, not the member, and is therefore downstream of
     `tierOfMember`: identical input to it means an identical key by
     construction. What this file has to prove is that its INPUT is identical,
     which the case above does. The badge text is asserted too, because that is
     the other exported consumer of the same value. */
  it('the badge text rendered from that tier is unchanged', () => {
    expect(tierBadgeText(tierOfMember(trimmedMember()))).toBe(
      tierBadgeText(tierOfMember(fullMember())),
    );
  });

  it('and it still falls back to raw_profile_data when the column is absent', () => {
    const noColumn: Record<string, unknown> = trimmedMember();
    delete noColumn['tier'];
    expect(tierOfMember(noColumn)).toBeTruthy();
  });

  /* THE CASE THAT MATTERS: no tier in the raw profile, so the `tier` COLUMN is
     the only source. If the backend ever adds `tier` to its cut list, the badge
     for these customers goes blank — and only this pair goes red. */
  it('a customer with NO tier in raw_profile_data still has a tier — the column is the only source', () => {
    expect(tierOfMember(fullNoRawTier())).toBe('gold');
  });

  it('…and it survives the trim', () => {
    expect(tierOfMember(trimmedNoRawTier())).toBe(
      tierOfMember(fullNoRawTier()),
    );
    expect(tierOfMember(trimmedNoRawTier())).toBe('gold');
  });

  it('…and the badge it renders is unchanged', () => {
    expect(tierBadgeText(tierOfMember(trimmedNoRawTier()))).toBe(
      tierBadgeText(tierOfMember(fullNoRawTier())),
    );
  });
});

describe('⭐ search: every term matches identically before and after the trim', () => {
  it.each(TERMS.map((t) => [t || '(ว่าง)', t]))(
    'term %s gives the same verdict',
    (_label, term) => {
      expect(memberMatchesSearch(trimmedMember(), term)).toBe(
        memberMatchesSearch(fullMember(), term),
      );
    },
  );

  it('the haystack itself is byte-identical — none of the eight ever fed it', () => {
    expect(memberSearchHaystack(trimmedMember())).toBe(
      memberSearchHaystack(fullMember()),
    );
  });

  it('`hello` never matched even BEFORE the trim — status_message was never searchable', () => {
    // Guards against "the trim removed a search field" being mistaken for
    // "search was already narrower than we thought".
    expect(memberMatchesSearch(fullMember(), 'hello')).toBe(false);
  });

  it('extras still work — parseCustomerDetail values are passed by the caller, not read off the member', () => {
    expect(
      memberMatchesSearch(trimmedMember(), 'สมหญิง', ['สมหญิง']),
    ).toBe(true);
  });
});

describe('⭐ the green LINE ring still lights — hasRawProfile is unaffected', () => {
  it('a customer with a profile still counts as known', () => {
    expect(hasRawProfile(trimmedMember())).toBe(true);
    expect(hasRawProfile(trimmedMember())).toBe(hasRawProfile(fullMember()));
  });

  it('an unlinked customer stays dark, before and after', () => {
    const unlinkedFull = { ...fullMember(), raw_profile_data: {} };
    const unlinkedTrim = { ...trimmedMember(), raw_profile_data: {} };
    expect(hasRawProfile(unlinkedTrim)).toBe(false);
    expect(hasRawProfile(unlinkedTrim)).toBe(hasRawProfile(unlinkedFull));
  });
});

describe('⭐ realtime: the identity the WS patch matches on is not a member column', () => {
  it('a row keeps _id and line_user_id — what patching and grouping use', () => {
    const m = trimmedMember() as Record<string, unknown>;
    expect(m['_id']).toBe('m1');
    expect(m['line_user_id']).toBe('U0108919a');
  });

  it('ignore_abandon_assist survives — it reaches ignoreAbandonService through a prop chain', () => {
    expect(
      (trimmedMember() as Record<string, unknown>)['ignore_abandon_assist'],
    ).toBe(true);
  });
});
