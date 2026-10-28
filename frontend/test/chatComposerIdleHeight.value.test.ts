/**
 * [FIX-20260830-HALFTRAY] UPDATED SPEC — supersedes [FIX-20260830-COMPOSERIDLEH].
 *
 * The intermediate design this file used to pin (no tray → box auto, textarea
 * carries the height; tray open → box fixed) was INVERTED by the final model:
 * an open tray now puts the composer in a FLEX state (half the column in
 * default mode, all of it in fullscreen), so the pixel height belongs to the
 * quiet state instead:
 *
 *   no tray, unlocked → box fixed at composerBoxH (the drag works here)
 *   locked            → box auto; textarea carries areaH (IDLE per room)
 *   any tray open     → box flex; textarea pinned at areaH; tray fills
 *
 * What this file still owes its old self: the two heights stay mutually
 * exclusive (the drag must never count twice), h-full appears exactly when the
 * inline height is absent, and the height-memory rules stay untouched.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_COMPOSER_H, IDLE_COMPOSER_H, heightFor } from '../pages/chat/composerHeightMemory';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const SRC = ticketChatSource();
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const CODE = strip(SRC);

describe('the pixel height lives in the QUIET state', () => {
  it('box fixed exactly while nothing is open and the room is unlocked', () => {
    expect(CODE).toMatch(/composerBoxStyle\s*=\s*\n?\s*!composerLocked && !anyTrayOpen \? \{ height: composerBoxH \} : undefined/);
  });

  it('locked or tray open: the textarea takes areaH instead', () => {
    expect(CODE).toMatch(/textareaStyle\s*=[\s\S]{0,220}composerLocked \|\| anyTrayOpen[\s\S]{0,120}height: /);
  });

  it('⭐ mutually exclusive — the drag can never count twice', () => {
    // the two conditions are literal complements of each other
    expect(CODE).toContain('!composerLocked && !anyTrayOpen');
    expect(CODE).toMatch(/composerLocked \|\| anyTrayOpen/);
  });

  it('h-full appears exactly when the inline height is absent', () => {
    expect(CODE).toMatch(/\$\{textareaStyle \? '' : 'h-full'\}/);
  });
});

describe('the height-memory rules are untouched', () => {
  it('a locked room resolves to IDLE, whatever was remembered', () => {
    expect(heightFor(false, 400)).toBe(IDLE_COMPOSER_H);
  });

  it('a chatting room with no memory opens at the default', () => {
    expect(heightFor(true, null)).toBe(DEFAULT_COMPOSER_H);
  });

  it('a remembered drag still wins over the default', () => {
    expect(heightFor(true, 300)).toBe(300);
  });
});
