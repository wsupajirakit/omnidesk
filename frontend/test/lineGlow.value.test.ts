/**
 * [FEAT-20260819-LINEGLOW] The LINE mark is WASHED OUT for a customer the site
 * does not know — i.e. one without a real `raw_profile_data`. A customer with a
 * profile keeps the normal LINE green.
 *
 * (The first cut did the opposite — a green halo on the KNOWN ones — and the
 * owner replaced it: on a long list the exception is what should catch the eye.)
 *
 * The rule lives in ONE place (`hasRawProfile`) because the mark is rendered in
 * three, and "does this customer have a profile" is exactly the kind of question
 * two screens end up answering differently. The empty-object case is the one
 * that matters: the profile sync writes `{}` on a 404, so a naive truthiness
 * check would light up every UNLINKED customer — the opposite of the signal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';

import { hasRawProfile } from '../utils/memberSearchText';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('who gets the glow', () => {
  it('a customer with a real profile does', () => {
    expect(hasRawProfile({ raw_profile_data: { data: { profile: { phone: '0812345678' } } } })).toBe(true);
  });

  it('the shorter shape the sync also writes counts too', () => {
    expect(hasRawProfile({ raw_profile_data: { profile: { phone: '08' } } })).toBe(true);
  });

  it('an EMPTY profile does NOT — that is what a 404 leaves behind', () => {
    expect(hasRawProfile({ raw_profile_data: {} })).toBe(false);
    expect(hasRawProfile({ raw_profile_data: { data: { profile: {} } } })).toBe(false);
  });

  it('no profile at all, or no member at all, does not', () => {
    expect(hasRawProfile({})).toBe(false);
    expect(hasRawProfile(null)).toBe(false);
    expect(hasRawProfile(undefined)).toBe(false);
  });
});

describe('every place the mark is drawn asks the same question', () => {
  // [REFACTOR-20261027-TCSPLIT] the page + the pieces its code moved into (test/ticketChatSource.ts); assertions unchanged
  const page = ticketChatPageWithPieces();
  /* [REFACTOR-20260905-ROOMHEADER] the header bar left `ChatRoomView.tsx` for
     `room-header/`. Both are read, so the rule keeps meaning "anywhere on the
     open-conversation header path" rather than "in whichever file it sits in
     this week" — and a copy reappearing in the old file is still caught. */
  const view =
    src('components/chat/ChatRoomView.tsx') +
    src('components/chat/room-header/RoomHeader.tsx');
  const css = src('index.css');

  it('both list cards dim the mark when the site does NOT know the customer', () => {
    const uses = page.match(/hasRawProfile\(ud\) \? '' : 'tc-line-dim'/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it('the open conversation header follows the member it already holds', () => {
    expect(view).toContain("hasRawProfile((memberData ?? activeRoom.user_data) as never) ? '' : 'tc-line-dim'");
  });

  it('the signal is a WASHED-OUT mark, not a glow — the odd one out is what shows', () => {
    /* The first cut haloed the KNOWN customers, which on a busy list is noise:
       the eye should catch the exception instead. Owner replaced it 2026-08-19. */
    const rule = /\.tc-line-dim \{([\s\S]*?)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('saturate');
    expect(rule![1]).toContain('opacity');
    expect(css).not.toContain('.tc-line-glow {');
  });

  it('a customer WITH a profile gets no class at all — the mark stays LINE green', () => {
    expect(page).not.toContain("hasRawProfile(ud) ? 'tc-line-dim'");
  });
});
