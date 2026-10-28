/* [FEAT-20260821-IGNOREABANDON] the "not chased" badge on the ticket panel
 * ===========================================================================
 * A source-level check, matching the house style for this page: `TicketChat.tsx`
 * is 4,700+ lines behind a WebSocket, a router and a dozen queries, and
 * `orphanRooms.value.test.ts` next to it reads the file for the same reason.
 *
 * What must hold, and why each one is here rather than "obviously fine":
 *   1. `=== true`, never truthy. The column is absent on every member row that
 *      predates it and the API ships rows as they are, so a truthy test lights
 *      the badge up for the whole customer base.
 *   2. It does NOT touch the avatar ring. That ring already encodes orphan-room
 *      and is asserted byte-for-byte one file over; a second meaning on the same
 *      pixel is how two features start fighting.
 *   3. Both languages carry both keys, or the badge renders its own key name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const page = ticketChatSource();
const th = JSON.parse(read('i18n/translations/th.json')) as Record<string, string>;
const en = JSON.parse(read('i18n/translations/en.json')) as Record<string, string>;

const block = page.slice(
  page.indexOf('[FEAT-20260821-IGNOREABANDON]'),
  page.indexOf('data-testid="ignore-abandon-badge"') + 900,
);

describe('⭐ the badge only appears for a customer who really is opted out', () => {
  it('⭐ it reads `=== true`, not a truthy value', () => {
    /* every member row that predates the column reads `undefined`; a truthy
       test would badge the entire customer base. */
    expect(block).toContain('?.ignore_abandon_assist === true &&');
  });

  it('⭐ nothing in the block falls back to truthy or to true-by-default', () => {
    const code = block.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).not.toMatch(/!==\s*false/);
    expect(code).not.toMatch(/\?\?\s*true/);
    expect(code).not.toMatch(/Boolean\(/);
  });

  it('it reads the member row the panel already has — no new fetch', () => {
    expect(block).toContain('(ud as {');
  });
});

describe('⭐ it does not fight the avatar ring', () => {
  it('⭐ the ring line is untouched — one pixel, one meaning', () => {
    /* `orphanRooms.value.test.ts` asserts this exact string; the badge must be
       its own element, never a second condition on the ring. */
    expect(page).toContain('${avatarRingClass(ticket)}');
    expect(block).not.toContain('avatarRingClass');
  });

  it('the badge writes no ring colour of its own', () => {
    expect(block).not.toMatch(/ring-(orange|emerald|slate)-\d+/);
  });
});

describe('⭐ both languages can render it', () => {
  it('⭐ every key the badge asks for exists in th and en', () => {
    /* a missing key renders the key name itself — visible nonsense on a page an
       operator reads all day. */
    for (const k of ['ticket.ignore_abandon_badge', 'ticket.ignore_abandon_hint']) {
      expect(typeof th[k]).toBe('string');
      expect(typeof en[k]).toBe('string');
      expect((th[k] ?? '').length).toBeGreaterThan(0);
      expect((en[k] ?? '').length).toBeGreaterThan(0);
    }
  });

  it('it carries a hint, so the badge is not a mystery word', () => {
    expect(block).toContain("title={t('ticket.ignore_abandon_hint')}");
  });
});
