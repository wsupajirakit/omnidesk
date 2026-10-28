/**
 * [FEAT-20260830-TRAYFIXEDSCALE]
 *
 * Owner, 30/08/2026, three things about the two media trays in the chat composer:
 *   1. stickers ALWAYS render at the largest step (step 6) — never the preference
 *   2. emoji ALWAYS render at step 3 — never the preference
 *   3. the per-pack "แพ็ค <id>" heading is removed
 *
 * Why a source-text test and not a render test: the whole feature is one CSS
 * custom property re-declared on a subtree. jsdom does not resolve `calc()` over
 * an inherited custom property, so a rendered assertion would be green whatever
 * the number is. What actually has to hold is (a) the constants come from the
 * ladder rather than being typed twice, and (b) the two panels really carry the
 * override. Both are checkable exactly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CHAT_FONT_SCALE_STEPS,
  CHAT_FONT_SCALE_DEFAULT,
  STICKER_TRAY_FIXED_SCALE,
  EMOJI_TRAY_FIXED_SCALE,
  normalizeChatFontScale,
} from '../hooks/chatFontScale';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
/** Comments quote the removed markup, so they must go before any matching. */
const stripComments = (src: string) =>
  /* ⚠️ block comments FIRST. Stripping `{/* ... *\/}` as one unit is wrong: the
     regex happily spans from one JSX comment's `{` to a LATER comment's `*\/}`
     and eats the markup in between (it swallowed the whole emoji panel opener
     when this test was written). Removing `/* ... *\/` first leaves the stray
     braces, which the second pass clears. */
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\s*\}/g, ' ');

const TICKET_CHAT = stripComments(ticketChatSource());

/** The JSX of one tray panel: from its `{showX && (` up to the closing `)}`. */
const panelOf = (flag: string): string => {
  const start = TICKET_CHAT.indexOf(`{${flag} && (`);
  expect(start, `panel for ${flag} must exist`).toBeGreaterThan(-1);
  const end = TICKET_CHAT.indexOf('\n        )}', start);
  expect(end).toBeGreaterThan(start);
  return TICKET_CHAT.slice(start, end);
};

describe('1. the locked values come from the ladder, not from literals', () => {
  it('⭐⭐⭐ stickers are pinned to the TOP step of the ladder', () => {
    expect(STICKER_TRAY_FIXED_SCALE).toBe(
      CHAT_FONT_SCALE_STEPS[CHAT_FONT_SCALE_STEPS.length - 1],
    );
    /* ...and the top step really is the biggest one, not just the last written */
    expect(STICKER_TRAY_FIXED_SCALE).toBe(Math.max(...CHAT_FONT_SCALE_STEPS));
  });

  it('⭐⭐⭐ emoji are pinned to step 3 (1-based, as the seekbar counts)', () => {
    expect(EMOJI_TRAY_FIXED_SCALE).toBe(CHAT_FONT_SCALE_STEPS[2]);
    /* the owner corrected 6 → 3: emoji must NOT be the top step */
    expect(EMOJI_TRAY_FIXED_SCALE).not.toBe(STICKER_TRAY_FIXED_SCALE);
  });

  it('⭐⭐ both are real members of the ladder — no off-ladder number sneaks in', () => {
    expect(CHAT_FONT_SCALE_STEPS).toContain(STICKER_TRAY_FIXED_SCALE);
    expect(CHAT_FONT_SCALE_STEPS).toContain(EMOJI_TRAY_FIXED_SCALE);
    expect(normalizeChatFontScale(STICKER_TRAY_FIXED_SCALE)).toBe(STICKER_TRAY_FIXED_SCALE);
    expect(normalizeChatFontScale(EMOJI_TRAY_FIXED_SCALE)).toBe(EMOJI_TRAY_FIXED_SCALE);
  });

  it('⭐⭐⭐ neither is the DEFAULT step — otherwise "locked" would be untestable', () => {
    /* If a lock happened to equal the fallback, an unset preference would look
       correct while the lock did nothing. Both must differ from the default. */
    expect(STICKER_TRAY_FIXED_SCALE).not.toBe(CHAT_FONT_SCALE_DEFAULT);
    expect(EMOJI_TRAY_FIXED_SCALE).not.toBe(CHAT_FONT_SCALE_DEFAULT);
  });

  it('⭐⭐⭐ the lock is independent of every stored preference, valid or not', () => {
    /* The lock is a constant, so this is a statement about the whole input space:
       nothing a user can store — including "never set" and garbage — moves it. */
    const stored: unknown[] = [
      undefined, null, NaN, 'banana', {}, [], -5, 0, 999,
      ...CHAT_FONT_SCALE_STEPS,
    ];
    for (const v of stored) {
      const pref = normalizeChatFontScale(v);
      expect(STICKER_TRAY_FIXED_SCALE).toBe(Math.max(...CHAT_FONT_SCALE_STEPS));
      expect(EMOJI_TRAY_FIXED_SCALE).toBe(CHAT_FONT_SCALE_STEPS[2]);
      /* the preference itself is still normalised as before — untouched feature */
      expect(CHAT_FONT_SCALE_STEPS).toContain(pref);
    }
  });
});

describe('2. both tray panels actually carry the override', () => {
  it('⭐⭐⭐ the sticker panel re-declares --tc-chat-scale from the sticker constant', () => {
    const panel = panelOf('showStickers');
    expect(panel).toContain('--tc-chat-scale');
    expect(panel).toContain('STICKER_TRAY_FIXED_SCALE');
    /* and it must be the sticker constant, not the emoji one */
    expect(panel).not.toContain('EMOJI_TRAY_FIXED_SCALE');
  });

  it('⭐⭐⭐ the emoji panel re-declares --tc-chat-scale from the emoji constant', () => {
    const panel = panelOf('showEmoji');
    expect(panel).toContain('--tc-chat-scale');
    expect(panel).toContain('EMOJI_TRAY_FIXED_SCALE');
    expect(panel).not.toContain('STICKER_TRAY_FIXED_SCALE');
  });

  it('⭐⭐⭐ neither panel is wired to the live preference variable', () => {
    /* `chatFontScale` is the per-user value; if either panel used it the lock
       would silently follow the setting again — this is the actual regression. */
    for (const flag of ['showStickers', 'showEmoji']) {
      const panel = panelOf(flag);
      const styleLine = panel.split('\n').find((l) => l.includes('--tc-chat-scale'));
      expect(styleLine, `${flag} must set the variable`).toBeTruthy();
      expect(styleLine).not.toMatch(/\bchatFontScale\b/);
    }
  });

  it('⭐⭐ the constants are imported, so the ladder stays the single source', () => {
    expect(TICKET_CHAT).toMatch(/STICKER_TRAY_FIXED_SCALE,?\s/);
    expect(TICKET_CHAT).toMatch(/EMOJI_TRAY_FIXED_SCALE,?\s/);
    /* no hardcoded multiplier typed into the trays instead */
    for (const flag of ['showStickers', 'showEmoji']) {
      const styleLine = panelOf(flag)
        .split('\n')
        .find((l) => l.includes('--tc-chat-scale'))!;
      expect(styleLine).not.toMatch(/--tc-chat-scale'\s*as never\]:\s*'?[\d.]/);
    }
  });

  it('⭐⭐ the quick-reply tray and the centre column are NOT locked', () => {
    /* The owner asked for two trays only. The column keeps the preference. */
    expect(panelOf('showQuickReply')).not.toContain('--tc-chat-scale');
    expect(TICKET_CHAT).toMatch(/tc-col-center[\s\S]{0,2000}?chatFontScale/);
  });
});

describe('3. the per-pack heading is gone', () => {
  it('⭐⭐⭐ no "แพ็ค <id>" label above the sticker grids', () => {
    const panel = panelOf('showStickers');
    expect(panel).not.toContain('แพ็ค');
    expect(panel).not.toMatch(/\{pack\.packageId\}\s*<\/div>/);
  });

  it('⭐⭐ the packs themselves still render, in order, keyed by package id', () => {
    const panel = panelOf('showStickers');
    expect(panel).toContain('STICKER_PACKS.map');
    expect(panel).toContain('key={pack.packageId}');
    expect(panel).toContain('pack.stickerIds.map');
    expect(panel).toContain('pickSticker(pack.packageId, sid)');
  });

  it('⭐⭐ the sticker images keep w-12 h-12 — the size comes from the CSS ladder', () => {
    expect(panelOf('showStickers')).toContain('w-12 h-12 object-contain');
  });
});
