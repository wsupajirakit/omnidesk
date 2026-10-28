/**
 * [FEAT-20261018-CLOSEFOLLOW] The close-case dialog's follow-up sections follow the provider.
 * ===========================================================================
 * Owner 18/10/2026: "กำหนดได้ว่าให้ api ไหนมีบ้าง / shopapi มี / ส่วนของ loan ไม่มี ไม่ว่าจะติดตามฝาก
 * หรือถอน ก็ไม่มี สมัครก็ไม่มี ใช้ flag / config เดิมที่คุม ui".
 *
 * The same BE table that hides form sections ([FEAT-20261018-SCREENSECTIONS]) now names the three
 * dialog sections: registration → world `followUp`, deposit / withdraw → world `notice`. Loan
 * silences both worlds, so the BE lists all three in `hidden`; shop-api lists none.
 *
 * The rule that already governs the dialog stays the rule: a section that is not shown is a
 * plain close — no answer is required and none is sent ("section ไหนไม่ขึ้น = ปิดเคสปกติ").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { withoutHiddenTopics, type CloseCaseTopic } from '../components/member/follow-up/CloseCaseSections';

const ALL: CloseCaseTopic[] = ['registration', 'deposit', 'withdraw'];
const LOAN_HIDDEN = [
  'hook-form.site-rules', 'hook-form.customer-helper-card', 'hook-form.customer-link',
  'ticket-close.follow-registration', 'ticket-close.follow-deposit', 'ticket-close.follow-withdraw',
];

describe('[CLOSEFOLLOW] withoutHiddenTopics — the provider decides which dialog sections exist', () => {
  it('⭐ TARGET — loan hides all three: the dialog is a plain close', () => {
    expect(withoutHiddenTopics(ALL, LOAN_HIDDEN)).toEqual([]);
  });
  it('🔴 PIN — shop-api (hidden: []) keeps every section, in order', () => {
    expect(withoutHiddenTopics(ALL, [])).toEqual(ALL);
  });
  it('🔴 PIN — not answered yet / older back end (null) keeps every section', () => {
    expect(withoutHiddenTopics(ALL, null)).toEqual(ALL);
  });
  it('each section is hidden on its own (a provider can drop one and keep the others)', () => {
    expect(withoutHiddenTopics(ALL, ['ticket-close.follow-deposit'])).toEqual(['registration', 'withdraw']);
    expect(withoutHiddenTopics(['registration'], ['ticket-close.follow-withdraw'])).toEqual(['registration']);
  });
  it('form-section ids never touch the dialog', () => {
    expect(withoutHiddenTopics(ALL, ['hook-form.customer-link'])).toEqual(ALL);
  });
});

describe('[CLOSEFOLLOW] the Ticket page filters the topics it shows (source pin)', () => {
  const code = readFileSync(resolve(__dirname, '../pages/chat/TicketChat.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  it('⭐ closeTopics = withoutHiddenTopics(closeCaseTopicsFor(…), the provider\'s hidden list)', () => {
    expect(code).toMatch(/const closeTopics = withoutHiddenTopics\(\s*closeCaseTopicsFor\(/);
    expect(code).toMatch(/useProviderHiddenSections\(\)/);
  });
});
