/**
 * [FIX-20260830-HEADERDUP] the chat-room header line never repeats a value.
 *
 * Owner 30/08: `dev_User-2 | dev_User-2` when two values carry the same text —
 * show the second only when it differs. Every EXISTING show-rule is untouched:
 * a differing full_name / nickname still renders exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { headerNameParts } from '../components/chat/headerNameDedup';

describe('the reported bug', () => {
  it('dev_User-2 | dev_User-2 collapses to one', () => {
    expect(
      headerNameParts({ first: 'dev_User-2', nickname: 'dev_User-2' }),
    ).toEqual(['dev_User-2']);
  });

  it('title | full_name | nickname all equal → one', () => {
    expect(
      headerNameParts({
        headerTitle: 'dev_User-2',
        first: 'dev_User-2',
        full_name: 'dev_User-2',
        nickname: 'dev_User-2',
      }),
    ).toEqual(['dev_User-2']);
  });

  it('nickname equal to the shown full_name is dropped, full_name stays', () => {
    expect(
      headerNameParts({
        headerTitle: '0812345678',
        first: '0812345678',
        full_name: 'สมชาย ใจดี',
        nickname: 'สมชาย ใจดี',
      }),
    ).toEqual(['0812345678', 'สมชาย ใจดี']);
  });
});

describe('the existing rules are untouched when values differ', () => {
  it('three different values → three segments, same order as before', () => {
    expect(
      headerNameParts({
        headerTitle: '0925550014',
        first: '0925550014',
        full_name: 'ไอติม',
        nickname: 'bbbb',
      }),
    ).toEqual(['0925550014', 'ไอติม', 'bbbb']);
  });

  /* MUTATION NOTE (M2, equivalent mutant): removing the carried `!== headerTitle`
     check cannot change behaviour — when headerTitle is set, `first` IS
     headerTitle, so the new includes-dedup always catches the same case. The
     line stays as provenance of the original rule, and this is recorded so a
     future mutation sweep does not misread the green as a weak test. */
  it('full_name equal to headerTitle is skipped — the PRE-existing rule, verbatim', () => {
    expect(
      headerNameParts({
        headerTitle: 'ไอติม',
        first: 'ไอติม',
        full_name: 'ไอติม',
        nickname: 'bbbb',
      }),
    ).toEqual(['ไอติม', 'bbbb']);
  });

  it('missing full_name / nickname simply do not render — no dangling separator slot', () => {
    expect(headerNameParts({ first: '0812345678' })).toEqual(['0812345678']);
    expect(
      headerNameParts({ first: '0812345678', full_name: null, nickname: '' }),
    ).toEqual(['0812345678']);
  });

  it('no headerTitle: the customerName fallback is the first segment and dedups too', () => {
    // headerTitle absent ⇒ the old `!== headerTitle` check never fired here;
    // the new include-check is what finally kills this duplicate
    expect(
      headerNameParts({ first: 'dev_User-2', full_name: 'dev_User-2', nickname: 'x' }),
    ).toEqual(['dev_User-2', 'x']);
  });
});

describe('the JSX really consumes the helper', () => {
  /* [REFACTOR-20260905-ROOMHEADER] BOTH files, concatenated, not one.
     The header bar moved out of `ChatRoomView.tsx` into `room-header/`, so
     reading only the old file made this case go red while the rule it protects
     was perfectly intact at the new address. Reading only the NEW file would be
     the opposite mistake: the raw condition this case forbids could be
     reintroduced in `ChatRoomView.tsx` and nothing would notice. The rule is
     "nowhere in the header path", so the subject is the header path. */
  const SRC =
    readFileSync(
      resolve(__dirname, '../components/chat/ChatRoomView.tsx'),
      'utf8',
    ) +
    readFileSync(
      resolve(__dirname, '../components/chat/room-header/RoomHeader.tsx'),
      'utf8',
    ) +
    readFileSync(
      resolve(
        __dirname,
        '../components/chat/room-header/parts/HeaderNameLine.tsx',
      ),
      'utf8',
    );
  it('the header row maps headerNameParts, with the separator inside each block', () => {
    expect(SRC).toMatch(/headerNameParts\(\{/);
    // the old raw conditions must be GONE, or the dedup can be bypassed
    expect(SRC).not.toMatch(/full_name !== headerTitle && \(/);
  });
});
