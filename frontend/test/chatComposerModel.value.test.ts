/**
 * [FIX-20260830-REALFULL] the composer height model — the whole thing, one file.
 *
 * Supersedes and CONSOLIDATES three earlier specs that pinned intermediate
 * designs (chatTrueFullscreen, chatFullNoShrink, chatComposerTrayBottom): those
 * revolved around `chatComposerRootClass` + `max-h-full`, a ceiling-based
 * fullscreen that could only ever reach a 50/50 split — the stream is `flex-1`
 * and a ceiling never makes a box GROW past its sibling. Every pin from those
 * files that is still true is carried here; the helper they tested is deleted.
 *
 * The model, four states, keyed on (mode, trayOpen):
 *   no tray (any mode)   → root shrink-0 + 55vh cap · box takes the dragged px
 *                          height (unless locked) · textarea fills the box
 *   locked room          → box auto · textarea carries areaH (= IDLE height,
 *                          reset per room by heightFor) — the card that is not
 *                          being chatted with snaps back to its own small size
 *   tray open, default   → box auto under the root cap · textarea pinned at
 *                          areaH · tray shrinks first (min-h-0) and scrolls
 *   tray open, full      → root flex-[999_1_0%] beats the stream's flex-1
 *                          ~999:1 · box flex-1 fills the root · tray flex-1
 *                          fills the box — genuinely full screen
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  chatComposerAlwaysCappedClass,
  chatComposerBoxClass,
  chatComposerFixedRowClass,
  chatTrayPanelClass,
  CHAT_COMPOSER_MAX_H,
} from '../hooks/chatTrayMode';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const SRC = ticketChatSource();
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const CODE = strip(SRC);
const ROOT_BASE = 'bg-white border-t border-gray-200 p-3 relative';
const tokens = (c: string) => c.split(/\s+/);

describe('the ROOT (chatComposerAlwaysCappedClass)', () => {
  it('⭐⭐⭐ fullscreen needs BOTH full mode AND an open tray', () => {
    const c = chatComposerAlwaysCappedClass('full', ROOT_BASE, true);
    expect(tokens(c)).toContain('flex-[999_1_0%]');
    expect(tokens(c)).toContain('min-h-0');
  });

  it('⭐⭐⭐ it must BEAT the stream, not tie it — flex-1 was the 50/50 bug', () => {
    // the stream (`tc-chat-history`) is flex-1; two flex-1 siblings split evenly
    const c = chatComposerAlwaysCappedClass('full', ROOT_BASE, true);
    expect(tokens(c)).not.toContain('flex-1');
    expect(tokens(c)).not.toContain('shrink-0');
    // and no ceiling: the flex race is the bound, the column clips via .tc
    expect(c).not.toMatch(/max-h-/);
  });

  it('⭐⭐⭐ full mode with NO tray behaves exactly like default — compact, draggable, bottom-anchored', () => {
    expect(chatComposerAlwaysCappedClass('full', ROOT_BASE, false)).toBe(
      chatComposerAlwaysCappedClass('default', ROOT_BASE, false),
    );
  });

  it('CLOSED states keep the 55vh ceiling and shrink-0 (carried pin)', () => {
    for (const mode of ['default', 'full', null, 'garbage'] as const) {
      const c = chatComposerAlwaysCappedClass(mode, ROOT_BASE, false);
      expect(tokens(c)).toContain('shrink-0');
      expect(tokens(c)).toContain(CHAT_COMPOSER_MAX_H);
      expect(tokens(c)).toContain('min-h-0');
      expect(tokens(c)).not.toContain('flex-[999_1_0%]');
    }
  });

  it('⭐⭐⭐ default + OPEN tray = exactly HALF: flex-1 ties the stream, no cap, no shrink', () => {
    /* [FIX-20260830-HALFTRAY] the owner asked default-mode trays for half the
       screen. flex-1 against the stream's flex-1 (both basis 0%) is a precise
       50/50 with no vh number to drift. */
    for (const mode of ['default', null, 'garbage'] as const) {
      const c = chatComposerAlwaysCappedClass(mode, ROOT_BASE, true);
      expect(tokens(c)).toContain('flex-1');
      /* [FIX-20260830-SENDFLOOR rev2] min-h-0 pinned ON PURPOSE: min-h-fit was
         tried and inflated the half rule to full screen (fit-content counts the
         tray's intrinsic grid height). The send-button floor is the computed
         drag clamp in TicketChat, not CSS. */
      expect(tokens(c)).toContain('min-h-0');
      expect(tokens(c)).not.toContain('min-h-fit');
      expect(tokens(c)).not.toContain('shrink-0');
      expect(tokens(c)).not.toContain('flex-[999_1_0%]');
      expect(c).not.toMatch(/max-h-/);
    }
  });

  it('⭐⭐ exactly one of shrink-0 / flex-* per state, decided in code (carried pin)', () => {
    const fullOpen = chatComposerAlwaysCappedClass('full', ROOT_BASE, true);
    const rest = chatComposerAlwaysCappedClass('default', ROOT_BASE, true);
    expect(/shrink-0/.test(fullOpen)).toBe(false);
    expect(/flex-\[/.test(rest)).toBe(false);
  });

  it('⭐ the CALLER base string carries no shrink-0 of its own (carried pin)', () => {
    const call = CODE.match(/chatComposerAlwaysCappedClass\([\s\S]{0,300}?\)\}/)?.[0];
    expect(call, 'root call site').toBeTruthy();
    expect(call as string).not.toContain('shrink-0');
    /* [FIX-20260909-TRAYHEIGHT] `trayPanelOpen`, not the widened `anyTrayOpen`.
       This argument is what turns the composer into a flex panel taking half the
       column (or all of it in full mode), and only the three SLIDING TRAYS need
       that — `flex-1` inside them has nothing to divide otherwise. The translate
       preview strip is an ordinary row, and feeding it in here made pressing
       แปล expand the composer over the conversation (owner, 09/09: "บัคกดแปลแล้ว
       ขยายเต็มจอ"). The height pins below still read `anyTrayOpen`, because for
       THEM the strip does count — it takes room from the input row. */
    expect(call as string).toContain('trayPanelOpen');
  });
});

describe('the INNER BOX (chatComposerBoxClass)', () => {
  it('⭐⭐⭐ fills the root exactly when the root is fullscreen — the level the old fix missed', () => {
    const c = chatComposerBoxClass('full', true, 'relative flex flex-col');
    expect(tokens(c)).toContain('flex-1');
    expect(tokens(c)).toContain('min-h-0');
  });

  it('the box FILLS whenever a tray is open, any mode — half and full alike', () => {
    for (const mode of ['default', 'full', 'garbage'] as const) {
      const c = chatComposerBoxClass(mode, true, 'relative flex flex-col');
      expect(tokens(c)).toContain('flex-1');
      expect(tokens(c)).toContain('min-h-0');
    }
  });

  it('closed states: shrinkable under the root cap, never a filler', () => {
    for (const mode of ['default', 'full'] as const) {
      const c = chatComposerBoxClass(mode, false, 'relative flex flex-col');
      expect(tokens(c)).toContain('min-h-0');
      expect(tokens(c)).not.toContain('flex-1');
    }
  });

  it('the page passes trayOpen to it', () => {
    /* [FIX-20260909-TRAYHEIGHT] same split as the root above: `flex-1` here makes
       the box FILL the flex panel, which only a sliding tray asks for. */
    expect(CODE).toMatch(/chatComposerBoxClass\(trayMode, trayPanelOpen,/);
  });
});

describe('the HEIGHT decisions in the page', () => {
  it('⭐⭐⭐ the box holds a pixel height ONLY while nothing is open and not locked', () => {
    /* [FIX-20260830-HALFTRAY] superseded "locked or truly fullscreen": ANY open
       tray now puts the composer in a flex state (half in default, all in
       full), so the pixel height applies exactly while nothing is open. */
    expect(CODE).toMatch(
      /composerBoxStyle\s*=\s*\n?\s*!composerLocked && !anyTrayOpen \? \{ height: composerBoxH \} : undefined/,
    );
  });

  it('⭐⭐⭐ locked or any tray open: the textarea carries the height instead', () => {
    expect(CODE).toMatch(
      /textareaStyle\s*=[\s\S]{0,220}composerLocked \|\| anyTrayOpen[\s\S]{0,120}height: /,
    );
  });

  it('the textarea falls back to h-full exactly when it has no own height (carried pin)', () => {
    expect(CODE).toMatch(/\$\{textareaStyle \? '' : 'h-full'\}/);
  });

  it('⭐ the textarea ROW is the filler only when it owns the box', () => {
    const row = CODE.match(/className=\{composerLocked \|\| anyTrayOpen\s*\?\s*chatComposerFixedRowClass\([\s\S]{0,200}?\}/)?.[0];
    expect(row, 'the conditional row class').toBeTruthy();
    expect(row as string).toMatch(/: 'flex items-end p-2 bg-white rounded-b-lg min-h-\[44px\] flex-1'/);
  });
});

describe('the SHRINK discipline that keeps the send button on screen', () => {
  it('⭐⭐⭐ fixed rows are protected in EVERY mode (carried pin)', () => {
    expect(tokens(chatComposerFixedRowClass('default', 'flex'))).toContain('shrink-0');
    expect(tokens(chatComposerFixedRowClass('full', 'flex'))).toContain('shrink-0');
    expect(tokens(chatComposerFixedRowClass(null, 'flex'))).toContain('shrink-0');
  });

  it('⭐⭐⭐ EVERY tray is the filler of its box: flex-1 min-h-0, caps stripped', () => {
    /* [FIX-20260830-HALFTRAY] mode-agnostic now — the ROOT decides how much
       screen the composer takes; the tray just fills it and scrolls inside.
       The per-mode caps (max-h-* / tc-tray-cap) kept fighting the fixed-scale
       sticker tray, so they are gone with the mechanism. */
    for (const mode of ['default', 'full', undefined, 'garbage']) {
      const c = chatTrayPanelClass(mode, 'p-2 max-h-48 overflow-y-auto');
      expect(tokens(c)).toContain('flex-1');
      expect(tokens(c)).toContain('min-h-0');
      expect(c).not.toMatch(/max-h-/);
      expect(c).not.toContain('tc-tray-cap');
      expect(c).toContain('overflow-y-auto');
    }
  });
});
