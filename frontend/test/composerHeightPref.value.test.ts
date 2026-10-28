/**
 * [FEAT-20260830-COMPOSERHPREF] the dragged input height as a preference.
 *
 * The two promises the owner asked for, pinned:
 *  1. an admin with NO stored value (or a broken one) falls back to the default
 *     and nothing breaks — `usePreference` does not validate, so the normalizer
 *     is the only gate;
 *  2. once a height exists it round-trips: what the drag saved is what a later
 *     session reads back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  COMPOSER_HEIGHT_PATH,
  COMPOSER_HEIGHT_MIN,
  COMPOSER_HEIGHT_MAX,
  normalizeComposerHeight,
} from '../hooks/composerHeightPref';
import { DEFAULT_COMPOSER_H } from '../pages/chat/composerHeightMemory';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const SRC = ticketChatSource();
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('fallback never breaks anyone', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string word', 'tall'],
    ['NaN', NaN],
    ['an object', {}],
    ['an array', [200]],
    ['Infinity', Infinity],
  ])('%s → the default', (_l, v) => {
    expect(normalizeComposerHeight(v)).toBe(DEFAULT_COMPOSER_H);
  });

  it('numbers out of range clamp instead of exploding the layout', () => {
    expect(normalizeComposerHeight(1)).toBe(COMPOSER_HEIGHT_MIN);
    expect(normalizeComposerHeight(99999)).toBe(COMPOSER_HEIGHT_MAX);
    expect(normalizeComposerHeight(-50)).toBe(COMPOSER_HEIGHT_MIN);
  });

  it('a stored numeric STRING still works — the wire does that', () => {
    expect(normalizeComposerHeight('200')).toBe(200);
  });

  it('a real height survives untouched (rounded only)', () => {
    expect(normalizeComposerHeight(200)).toBe(200);
    expect(normalizeComposerHeight(200.6)).toBe(201);
  });
});

describe('the clamp mirrors the drag clamp — cross-pinned so they cannot drift', () => {
  it('matches MIN_H / MAX_H in TicketChat', () => {
    const m = /const MIN_H = (\d+), MAX_H = (\d+)/.exec(CODE);
    expect(m, 'TicketChat MIN_H/MAX_H').toBeTruthy();
    expect(COMPOSER_HEIGHT_MIN).toBe(Number(m![1]));
    expect(COMPOSER_HEIGHT_MAX).toBe(Number(m![2]));
  });
});

describe('the wiring is real, not a hook nobody calls', () => {
  it('ChatInputBox reads the preference (immediate, like its siblings)', () => {
    expect(CODE).toMatch(/usePreference<number>\(\s*COMPOSER_HEIGHT_PATH,\s*DEFAULT_COMPOSER_H,\s*\{ immediate: true \},?\s*\)/);
  });

  it('what is READ goes through the normalizer — usePreference does not validate', () => {
    /* MUTATION NOTE: pinning "the normalizer appears somewhere" survived a
       mutation that removed it from the READ path — the save path also calls
       it and kept the loose match green. The read line itself is the pin. */
    expect(CODE).toMatch(
      /rememberedH\.current = normalizeComposerHeight\(composerHeightPref\)/,
    );
  });

  it('the drag SAVES through the same normalizer, on the same remember gate', () => {
    /* the pref must obey the 24/08 rule: remember only while actually chatting —
       the gate is shouldRemember, the same one the in-session memory uses */
    const at = CODE.indexOf('const onGripUp');
    const body = CODE.slice(at, at + 400);
    expect(body).toMatch(/shouldRemember\(canType\)/);
    expect(body).toMatch(/setComposerHeightPref\(normalizeComposerHeight\(areaH\)\)/);
  });

  it('the path is namespaced under ui.*, like every other screen preference', () => {
    expect(COMPOSER_HEIGHT_PATH).toBe('ui.chatComposerHeight');
  });
});
