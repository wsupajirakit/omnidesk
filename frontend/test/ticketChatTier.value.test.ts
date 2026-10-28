/**
 * [REFACTOR-20261027-TCSPLIT] TicketChat's tier helpers, now that they are module functions
 * (pages/chat/ticket-chat/derive/tier.ts) and can be called directly.
 *
 * CHARACTERIZATION: the bodies moved out of the page verbatim (checked line-for-line during the
 * split), so these cases pin what the page has always done — they do not redesign it. Before
 * the move nothing exercised them: the page tests carry no tier data and the tier suites use
 * harnesses, so breaking a rule here went unnoticed.
 *
 * The rules come from the notes beside the code ([FEAT-20260801-MEMBERTIER]):
 *   · an EMPTY code/name is skipped (`??` would have kept '' and matched nobody)
 *   · level 0 (Normal) is a real key (`||` would have swallowed it)
 *   · keys compare lower-cased; options are built from tiers that really occur,
 *     de-duplicated, ordered by level then label
 */
import { describe, expect, it } from 'vitest';
import { buildTierFilterOptions, tierKeyOf, tierLabelOf } from '../pages/chat/ticket-chat/derive';

const row = (tier: unknown) => ({ line_user_data: { tier } }) as never;

describe('tierKeyOf — the key the tier filter compares', () => {
  it('nothing → no key', () => {
    expect(tierKeyOf(null)).toBe('');
    expect(tierKeyOf(undefined)).toBe('');
    expect(tierKeyOf('')).toBe('');
    expect(tierKeyOf({})).toBe('');
  });
  it('a plain value is lower-cased', () => {
    expect(tierKeyOf('Gold')).toBe('gold');
    expect(tierKeyOf(3)).toBe('3');
  });
  it('an object: code first, then name — an EMPTY string is skipped, not taken', () => {
    expect(tierKeyOf({ code: 'VIP', name: 'Very' })).toBe('vip');
    expect(tierKeyOf({ code: '', name: 'Silver', level: 1 })).toBe('silver');
  });
  it('level 0 is a real key, not "missing"', () => {
    expect(tierKeyOf({ code: '', name: '', level: 0 })).toBe('0');
  });
});

describe('tierLabelOf — the text of an option', () => {
  it('name (or code) with its level', () => {
    expect(tierLabelOf({ name: 'Gold', level: 2 })).toBe('Gold (Tier 2)');
    expect(tierLabelOf({ code: 'G', level: 0 })).toBe('G (Tier 0)');
    expect(tierLabelOf({ name: 'Gold' })).toBe('Gold');
  });
  it('a plain value as-is, nothing as empty', () => {
    expect(tierLabelOf('vip')).toBe('vip');
    expect(tierLabelOf(null)).toBe('');
  });
});

describe('buildTierFilterOptions — only tiers that occur, once each, by level then label', () => {
  it('no tier anywhere → no option (the dropdown keeps only "ทั้งหมด")', () => {
    expect(buildTierFilterOptions([row(null)], [row(undefined)])).toEqual([]);
  });
  it('open + closed rows both count; a repeated key keeps the FIRST row seen; level orders, label breaks ties', () => {
    const open = [row({ code: 'gold', name: 'Gold', level: 2 }), row({ code: 'normal', name: 'Normal', level: 0 })];
    const closed = [row({ code: 'GOLD', name: 'Gold Plus', level: 2 }), row({ code: 'b', name: 'Bravo', level: 1 }), row({ code: 'a', name: 'Alpha', level: 1 })];
    expect(buildTierFilterOptions(open, closed)).toEqual([
      { value: 'normal', label: '💎 Normal (Tier 0)' },
      { value: 'a', label: '💎 Alpha (Tier 1)' },
      { value: 'b', label: '💎 Bravo (Tier 1)' },
      { value: 'gold', label: '💎 Gold (Tier 2)' },
    ]);
  });
  it('a tier without a usable level sorts after every levelled one', () => {
    expect(buildTierFilterOptions([row('zeta'), row({ code: 'x', name: 'X', level: 5 })], []).map((o) => o.value))
      .toEqual(['x', 'zeta']);
  });
});
