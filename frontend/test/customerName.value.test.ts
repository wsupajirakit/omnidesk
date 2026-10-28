/* [FIX-20260814-CUSTOMERNAME] the "Unknown" customer name bug
 * ===========================================================================
 * Owner, 14/08: ticket pages showed "Unknown" for customers who have a real
 * name, while the Contact page showed it correctly — same person, same data.
 *
 * Evidence taken from the live ticket payload before any code was touched
 * (`omnidesk-api/14aug1845res.txt`), plus the member rows behind it:
 *
 *   U0108919a… → display_name "phat2519" · nickname "Unknown" · has picture
 *   U28a50c1b… → display_name " ผึ้ง"    · nickname " ผึ้ง"   · has picture
 *   Ud54aa56f… → display_name "Unknown"  · nickname "Unknown" · no picture
 *
 * `"Unknown"` is written by the BACKEND placeholder, never typed by a person
 * (`chat-history.service.ts:174,177`), so it must be treated as "no name" —
 * while the field PRIORITY stays exactly as it was (an operator's nickname
 * still outranks the LINE display name; the owner confirmed that part is right).
 *
 * The cases below fail on the pre-fix tree wherever the sentinel used to win.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { customerName, realName } from '../components/common/customerName';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
/** Comments name the old chains on purpose; strip them before asserting. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('[CUSTOMERNAME] realName — the backend sentinel is not a name', () => {
  it('rejects "Unknown" in any casing or padding', () => {
    expect(realName('Unknown')).toBe('');
    expect(realName('unknown')).toBe('');
    expect(realName('UNKNOWN')).toBe('');
    expect(realName('  Unknown  ')).toBe('');
  });

  it('keeps every real value, trimmed', () => {
    expect(realName('phat2519')).toBe('phat2519');
    expect(realName(' ผึ้ง')).toBe('ผึ้ง');
    // a name that merely CONTAINS the word is a real name, not a sentinel
    expect(realName('Unknown Soldier')).toBe('Unknown Soldier');
  });

  it('treats blank-ish input as absent', () => {
    expect(realName('')).toBe('');
    expect(realName('   ')).toBe('');
    expect(realName(null)).toBe('');
    expect(realName(undefined)).toBe('');
  });
});

describe('[CUSTOMERNAME] customerName — order preserved, sentinel skipped', () => {
  it('THE BUG: a poisoned nickname no longer hides the real display name', () => {
    // exactly the row that shipped in the live payload
    expect(
      customerName({ display_name: 'phat2519', nickname: 'Unknown' }),
    ).toBe('phat2519');
  });

  it('an operator-set nickname still wins — the ticket rule is unchanged', () => {
    expect(
      customerName({ display_name: 'phat2519', nickname: 'พี่หมู VIP' }),
    ).toBe('พี่หมู VIP');
    // and the live " ผึ้ง" row keeps reading the same, just trimmed
    expect(customerName({ display_name: ' ผึ้ง', nickname: ' ผึ้ง' })).toBe(
      'ผึ้ง',
    );
  });

  it('falls through display_name → full_name → line_user_id', () => {
    expect(customerName({ nickname: 'Unknown', full_name: 'สมชาย ใจดี' })).toBe(
      'สมชาย ใจดี',
    );
    expect(
      customerName({
        display_name: 'Unknown',
        nickname: 'Unknown',
        line_user_id: 'Ud54aa56f47420dc1b4197ec5ce0770cf',
      }),
    ).toBe('Ud54aa56f47420dc1b4197ec5ce0770cf');
  });

  it('preferFullName keeps the contacts book reading exactly as before', () => {
    // Contact has always led with the registered name; ticket leads with the
    // nickname. Same helper, both orders preserved — neither page moves.
    const row = { full_name: 'สมชาย ใจดี', display_name: 'somchai', nickname: 'ช้าง' };
    expect(customerName(row, '(ไม่ทราบชื่อ)', { preferFullName: true })).toBe('สมชาย ใจดี');
    expect(customerName(row)).toBe('ช้าง');
  });

  it('lands on the fallback only when nothing real is left', () => {
    expect(customerName({ display_name: 'Unknown', nickname: 'Unknown' })).toBe(
      'Line User',
    );
    expect(customerName(null)).toBe('Line User');
    expect(customerName(undefined)).toBe('Line User');
    // callers may keep their own wording
    expect(customerName({}, '(ไม่ทราบชื่อ)')).toBe('(ไม่ทราบชื่อ)');
  });
});

/**
 * The helper is pure, so green tests above prove nothing about the SCREENS.
 * These pin the four render sites the live bug was visible on, so re-inlining
 * `nickname || display_name` anywhere fails here instead of in production.
 * เทส helper อย่างเดียวไม่พอ — ต้องล็อกจุดที่หน้าจอใช้จริง.
 */
describe('[CUSTOMERNAME] every customer-facing render site uses the helper', () => {
  const SITES = [
    'pages/chat/TicketSupport.tsx',
    'components/chat/ChatRoomView.tsx',
    'pages/chat/Contact.tsx',
    'components/contact/ContactHeaderInfo.tsx',
  ];

  it.each(SITES)('%s resolves the name through customerName()', (path) => {
    expect(codeOnly(read(path))).toContain('customerName(');
  });

  it.each(SITES)('%s no longer chains the raw fields itself', (path) => {
    const code = codeOnly(read(path));
    // the exact shapes that let the "Unknown" sentinel win
    expect(code).not.toMatch(/nickname \|\| displayName/);
    expect(code).not.toMatch(/display_name \|\| 'Unknown'/);
  });
});
