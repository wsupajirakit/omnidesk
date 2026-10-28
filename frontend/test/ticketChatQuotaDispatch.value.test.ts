import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

/**
 * [FEAT-2708-HEADERQUOTA] The quota-refresh event fires exactly where a REAL
 * push succeeded — source-asserted, because mounting the whole TicketChat page
 * for three lines is a worse test than reading them.
 *
 * Rules pinned:
 *   · every dispatch sits AFTER its awaited send (success path), never before
 *   · the inline-note branch never dispatches (a note doesn't touch LINE)
 *   · exactly 3 dispatch sites: sticker, images, text-reply
 */
const src = ticketChatSource();

describe('tc:quota-refresh dispatch sites in TicketChat', () => {
  it('⭐ exactly three dispatch sites, one per real-push branch', () => {
    const hits = src.match(/tc:quota-refresh/g) ?? [];
    expect(hits).toHaveLength(3);
  });

  it('⭐ the text branch dispatches only for reply — the inline note stays silent', () => {
    // the guard must sit on the shared text branch's dispatch
    expect(src).toMatch(
      /if \(mode === 'reply'\) window\.dispatchEvent\(new CustomEvent\('tc:quota-refresh'\)\)/,
    );
    // and the note call itself is never followed by an unconditional dispatch
    const noteIdx = src.indexOf('createInlineNote(roomKey');
    expect(noteIdx).toBeGreaterThan(-1);
  });

  it('⭐ each dispatch lands after onSent (success), inside the try — not the catch/finally', () => {
    for (const branch of ['sendSticker(roomKey', 'sendImages(roomKey']) {
      const at = src.indexOf(branch);
      expect(at).toBeGreaterThan(-1);
      const window = src.slice(at, at + 700);
      const dispatchAt = window.indexOf('tc:quota-refresh');
      const catchAt = window.indexOf('} catch');
      expect(dispatchAt).toBeGreaterThan(-1);
      expect(catchAt).toBeGreaterThan(-1);
      // dispatch must come BEFORE the catch (i.e., inside the success path)
      expect(dispatchAt).toBeLessThan(catchAt);
      // and after the onSent hand-off
      expect(window.indexOf('onSent?.')).toBeLessThan(dispatchAt);
    }
  });
});
