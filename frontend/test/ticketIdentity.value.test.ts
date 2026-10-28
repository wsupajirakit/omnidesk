/* [FIX-20260814-TICKETIDENTITY] identity + naming rules of the ticket list
 * ===========================================================================
 * Two live bugs, both reproduced here from the real ticket payload the owner
 * captured (`omnidesk-api/14aug1845res.txt` and its follow-up):
 *
 *   phat2519  → line_user_id U0108919a… · display_name "phat2519" · nickname "Unknown"
 *   ผึ้ง      → line_user_id U28a50c1b… · display_name " ผึ้ง"    · nickname " ผึ้ง"
 *   (no name) → line_user_id Ud54aa56f… · display_name "Unknown"  · nickname "Unknown"
 *
 * BUG 1 — the card read `Unknown (Line : phat25…)`: the backend's "Unknown"
 *         placeholder outranked the customer's real LINE name.
 * BUG 2 — selecting one card highlighted two: identity fell back to comparing
 *         display names, and both of those customers rendered as "Unknown".
 *
 * The PIN blocks freeze what must not move: the priority order, the "Line :"
 * label, the LINE-id last resort, and same-customer grouping.
 */
import { describe, it, expect } from 'vitest';

import {
  buildIdentityParts,
  formatIdentityPair,
  formatIdentityPanelHeader,
  formatIdentityCard,
  getTicketUserKey,
  isSameTicketUser,
  getCustomerDisplayName,
} from '../pages/chat/ticketIdentity';

/** The three customers exactly as the live payload carries them. */
const PHAT = {
  line_user_id: 'U0108919a44c99352c4d3fd4af7126fe9',
  display_name: 'phat2519',
  nickname: 'Unknown',
  full_name: '',
  phone_number: '',
  detail: null,
};
const PHUENG = {
  line_user_id: 'U28a50c1b2295d5116afbd60bd6afe2f3',
  display_name: ' ผึ้ง',
  nickname: ' ผึ้ง',
  full_name: '',
  phone_number: '',
  detail: null,
};
const NAMELESS = {
  line_user_id: 'Ud54aa56f47420dc1b4197ec5ce0770cf',
  display_name: 'Unknown',
  nickname: 'Unknown',
  full_name: '',
  phone_number: '',
  detail: null,
};

describe('[TICKETIDENTITY] BUG 1 — the placeholder must not outrank a real name', () => {
  it('shows the LINE name instead of "Unknown" for phat2519', () => {
    // The card keeps its `A (B)` shape — only the poisoned nickname is gone, so
    // the real name moves into the lead and the LINE id fills the second slot.
    expect(formatIdentityPair(PHAT)).toBe(
      'Line : phat2519 (U0108919a44c99352c4d3fd4af7126fe9)',
    );
    expect(formatIdentityPair(PHAT)).not.toContain('Unknown');
    // the panel header shows the lead value alone
    expect(formatIdentityPanelHeader(PHAT)).toBe('Line : phat2519');
  });

  it('drops the placeholder from the identity list entirely', () => {
    expect(buildIdentityParts(PHAT).map((p) => p.value)).toEqual([
      'phat2519',
      'U0108919a44c99352c4d3fd4af7126fe9',
    ]);
  });

  it('a customer with no usable name at all falls back to the LINE id', () => {
    expect(formatIdentityPair(NAMELESS)).toBe(
      'Ud54aa56f47420dc1b4197ec5ce0770cf',
    );
    expect(formatIdentityPanelHeader(NAMELESS)).not.toContain('Unknown');
  });
});

describe('[TICKETIDENTITY] BUG 2 — identity never uses names or phones', () => {
  it('two different customers are NOT the same person just because names match', () => {
    // Both rendered "Unknown" before the fix, which merged them.
    const a = { _id: 't1', line_user_data: PHAT };
    const b = { _id: 't2', line_user_data: NAMELESS };
    expect(isSameTicketUser(a, b)).toBe(false);
    expect(getTicketUserKey(a)).not.toBe(getTicketUserKey(b));
  });

  it('a shared phone number does not merge two people', () => {
    const a = { _id: 't1', line_user_data: { ...PHAT, phone_number: '0812345678' } };
    const b = { _id: 't2', line_user_data: { ...NAMELESS, phone_number: '0812345678' } };
    expect(isSameTicketUser(a, b)).toBe(false);
  });

  it('PIN: two tickets of the SAME customer still group together', () => {
    const older = { _id: 't1', line_user_data: PHUENG };
    const newer = { _id: 't2', line_user_data: PHUENG };
    expect(isSameTicketUser(older, newer)).toBe(true);
    expect(getTicketUserKey(older)).toBe(getTicketUserKey(newer));
  });

  it('PIN: the same ticket is always itself, and null never matches', () => {
    const t = { _id: 't1', line_user_data: PHAT };
    expect(isSameTicketUser(t, t)).toBe(true);
    expect(isSameTicketUser(t, null)).toBe(false);
    expect(isSameTicketUser(null, null)).toBe(false);
  });

  it('PIN: a ticket with no LINE id keeps its own key rather than merging', () => {
    const a = { _id: 't1', line_user_data: { display_name: 'Unknown' } };
    const b = { _id: 't2', line_user_data: { display_name: 'Unknown' } };
    expect(getTicketUserKey(a)).toBe('id_t1');
    expect(isSameTicketUser(a, b)).toBe(false);
  });
});

describe('[TICKETIDENTITY] PIN — the display rules that must not move', () => {
  it('keeps the documented priority: phone → full name → nickname → LINE name', () => {
    const full = {
      phone_number: '0899999999',
      full_name: 'สมชาย ใจดี',
      nickname: 'ช้าง',
      display_name: 'somchai',
      line_user_id: 'U1',
    };
    expect(buildIdentityParts(full).map((p) => p.value)).toEqual([
      '0899999999',
      'สมชาย ใจดี',
      'ช้าง',
      'somchai',
      'U1',
    ]);
    expect(formatIdentityPair(full)).toBe('0899999999 (สมชาย ใจดี)');
  });

  it('labels a LINE display name, never a nickname', () => {
    expect(formatIdentityPair({ nickname: 'ช้าง', display_name: 'somchai' })).toBe(
      'ช้าง (Line : somchai)',
    );
  });

  /* [FIX-20260814-CARDNOLINE] Owner, 14/08: "เอาคำว่า line : ออกไป หน้า ticket
   * support panel ซ้าย" — the LEFT CARD only. The right panel and the pin menu
   * keep the prefix, so the rule cannot be baked into `labelIdField`. */
  it('formatIdentityCard drops the "Line :" prefix, keeping everything else', () => {
    const ud = { nickname: 'ช้าง', display_name: 'somchai' };
    expect(formatIdentityCard(ud)).toBe('ช้าง (somchai)');
    // a lead value that IS the LINE name loses the prefix too
    expect(formatIdentityCard(PHAT)).toBe(
      'phat2519 (U0108919a44c99352c4d3fd4af7126fe9)',
    );
    // and nothing else about the shape moves
    expect(formatIdentityCard({ phone_number: '0899999999', full_name: 'สมชาย ใจดี' })).toBe(
      '0899999999 (สมชาย ใจดี)',
    );
    expect(formatIdentityCard(null)).toBe('N/A');
  });

  it('PIN: the right panel and pin menu still carry "Line :"', () => {
    // same customer, three call sites — only the card is bare
    expect(formatIdentityPanelHeader(PHAT)).toBe('Line : phat2519');
    expect(formatIdentityPair(PHAT)).toContain('Line : ');
    expect(formatIdentityCard(PHAT)).not.toContain('Line : ');
  });

  it('reads phone and name out of the positional detail string', () => {
    const ud = { detail: 'สมหญิง|0888888888|C123', line_user_id: 'U9' };
    expect(formatIdentityPair(ud)).toBe('0888888888 (สมหญิง)');
  });

  it('never prints the same value twice (ผึ้ง has it as nickname AND LINE name)', () => {
    expect(formatIdentityPair(PHUENG)).toBe(
      'ผึ้ง (U28a50c1b2295d5116afbd60bd6afe2f3)',
    );
  });

  it('empty input is "N/A", not a blank card', () => {
    expect(formatIdentityPair(null)).toBe('N/A');
    expect(formatIdentityPanelHeader(undefined)).toBe('N/A');
  });
});

/* [FIX-20260815-CLOSEDTABUNKNOWN] the closed-ticket tab printed "Unknown"
 * ===========================================================================
 * Owner, 15/08: "แท็บปิดเคสมันยังมี Unknown อยู่ ให้แสดงเหมือนหน้าบอทดูแลเลย".
 * The bot-managed tab (`formatIdentityCard`) already skipped the backend
 * placeholder; the closed/grouped cards used a second resolver that did not,
 * so the SAME customer appeared under two different names depending on tab.
 */
describe('[CLOSEDTABUNKNOWN] getCustomerDisplayName skips the backend placeholder', () => {
  it('shows the real LINE name instead of "Unknown"', () => {
    expect(
      getCustomerDisplayName({ nickname: 'Unknown', display_name: 'bbbb' }),
    ).toBe('bbbb');
  });

  it('agrees with the bot tab for the same customer — one name, both tabs', () => {
    const ud = { nickname: 'Unknown', display_name: 'bbbb', line_user_id: 'U70fe' };
    expect(getCustomerDisplayName(ud)).toBe('bbbb');
    expect(formatIdentityCard(ud)).toContain('bbbb');
  });

  it('is case-insensitive — "unknown" and "UNKNOWN" are placeholders too', () => {
    expect(getCustomerDisplayName({ nickname: 'unknown', display_name: 'ผึ้ง' })).toBe('ผึ้ง');
    expect(getCustomerDisplayName({ full_name: 'UNKNOWN', display_name: 'ผึ้ง' })).toBe('ผึ้ง');
  });

  it('falls through to the LINE id when EVERY name is a placeholder', () => {
    expect(
      getCustomerDisplayName({ nickname: 'Unknown', display_name: 'Unknown', line_user_id: 'U123' }),
    ).toBe('U123');
  });

  /* The priority order itself must not drift — it is what the grouped cards
     have always shown, and only the placeholder rule was meant to change. */
  it('keeps the original priority: phone → nickname → full name → LINE name', () => {
    expect(getCustomerDisplayName({ phone_number: '0955550010', nickname: 'ผึ้ง' })).toBe('0955550010');
    expect(getCustomerDisplayName({ nickname: 'ผึ้ง', full_name: 'สมหญิง' })).toBe('ผึ้ง');
    expect(getCustomerDisplayName({ full_name: 'สมหญิง', display_name: 'bbbb' })).toBe('สมหญิง');
  });

  it('reads phone and name out of the positional detail string', () => {
    expect(getCustomerDisplayName({ detail: 'สมหญิง|0888888888|C123' })).toBe('0888888888');
    expect(getCustomerDisplayName({ detail: 'สมหญิง||C123' })).toBe('สมหญิง');
  });

  it('empty input is a dash, and a usable fallback id wins over it', () => {
    expect(getCustomerDisplayName(null)).toBe('-');
    expect(getCustomerDisplayName(null, 'U9')).toBe('U9');
    expect(getCustomerDisplayName({}, 'undefined')).toBe('-');
  });
});
