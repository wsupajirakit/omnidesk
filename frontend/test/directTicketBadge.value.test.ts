/**
 * [FIX-20260817-DIRECTBADGECLOSED] — the orange ⚠ on the avatar disappears when
 * the case is closed
 * ============================================================================
 * Owner, 17/08: "ticket-support > panel ซ้าย ทำงานเหมือนเดิมดีแล้ว แต่ถ้ากดปิดเคส
 * caution สีส้มที่ avatar จะต้องหายไป".
 *
 * Two layers, the same shape `ticketTagFilterOptions.value.test.tsx` uses:
 *  1) real unit tests on the pure predicate — the behaviour itself;
 *  2) one source-assert that the 3k-line page really calls the predicate at the
 *     badge (the page cannot be rendered in vitest, and an inline
 *     `direct_ticket === true` creeping back would otherwise pass silently).
 *
 * The closed values are the ones the app actually produces, verified before the
 * fix: the live API returns closed rows with `direct_ticket: true`
 * (`GET /api/tickets/hook/:id?job_status=2`), and the optimistic close patch
 * spreads the old ticket plus `job_status: 2` (`TicketChat.tsx:1728`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';

import { shouldShowDirectTicketBadge } from '../pages/chat/directTicketBadge';

describe('[DIRECTBADGECLOSED] shouldShowDirectTicketBadge', () => {
  it('⭐ closed case (job_status 2) → NO badge, even though direct_ticket stays true', () => {
    // Exactly what the ปิดเคส tab holds, and what the optimistic patch builds.
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: true, job_status: 2 }),
    ).toBe(false);
  });

  it('open cases keep the badge — waiting (0) and accepted (1)', () => {
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: true, job_status: 0 }),
    ).toBe(true);
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: true, job_status: 1 }),
    ).toBe(true);
  });

  it('a normal case never shows it, open or closed', () => {
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: false, job_status: 0 }),
    ).toBe(false);
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: false, job_status: 2 }),
    ).toBe(false);
  });

  it('only the literal `true` lights it — undefined/null/1/"true" must not', () => {
    // Legacy rows have no such field; a truthy check here would light every one.
    expect(shouldShowDirectTicketBadge({ job_status: 0 })).toBe(false);
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: null, job_status: 0 }),
    ).toBe(false);
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: 1, job_status: 0 }),
    ).toBe(false);
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: 'true', job_status: 0 }),
    ).toBe(false);
  });

  it('a string job_status is still understood — "2" is closed', () => {
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: true, job_status: '2' }),
    ).toBe(false);
    expect(
      shouldShowDirectTicketBadge({ direct_ticket: true, job_status: '1' }),
    ).toBe(true);
  });

  it('no job_status at all → behaves as before the fix (badge shown)', () => {
    // "unknown state" is not "closed": this is the seamless half of the change.
    expect(shouldShowDirectTicketBadge({ direct_ticket: true })).toBe(true);
  });

  it('null / undefined ticket → no badge, no throw', () => {
    expect(shouldShowDirectTicketBadge(null)).toBe(false);
    expect(shouldShowDirectTicketBadge(undefined)).toBe(false);
  });
});

describe('[DIRECTBADGECLOSED] the page really uses the predicate', () => {
  // [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
  const PAGE = ticketChatPageWithPieces();

  it('the avatar badge is gated by shouldShowDirectTicketBadge', () => {
    expect(PAGE).toMatch(/shouldShowDirectTicketBadge\(tk\)\s*&&/);
    /* [REFACTOR-20261027-TCSPLIT] flipped 27/10: the card (and its import) moved from the page
       to pages/chat/ticket-chat/list-column/TicketCard.tsx, so the same module is now reached
       as '../../directTicketBadge'. Same claim — the predicate is imported, not copied inline —
       pinned just as exactly; only the relative path moved with the file. Was:
       /import \{ shouldShowDirectTicketBadge \} from '\.\/directTicketBadge'/ */
    expect(PAGE).toMatch(
      /import \{ shouldShowDirectTicketBadge \} from '\.\.\/\.\.\/directTicketBadge'/,
    );
  });

  it('the old inline condition is gone from the badge', () => {
    // `direct_ticket_detail` (the tooltip) may stay; the raw truth test must not.
    const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
      /\{\/\*[\s\S]*?\*\/\}/g,
      '',
    );
    expect(code).not.toMatch(/direct_ticket\s*===\s*true/);
  });
});
