/**
 * [FIX-20260830-SCALELOCK] a large chat font scale erased the message stream.
 *
 * Owner report 30/08, two symptoms with one cause: at a LARGE `--tc-chat-scale`
 * the chat message stream disappeared entirely, and the sticker tray could no
 * longer be scrolled — it simply ran off the bottom of the viewport.
 *
 * ── the cause this file guards ─────────────────────────────────────────────
 * [FIX-20260830-TRAYBOTTOM] gave the composer a ceiling, but only in `full`
 * tray mode. In the DEFAULT mode — what every admin has until they opt in — the
 * composer root was still `shrink-0` with height:auto and NO cap. Meanwhile
 * index.css multiplies everything inside it by `--tc-chat-scale`: the text
 * rules, `svg { width: calc(1em * var(--tc-chat-scale)) }`, and the tray caps
 * `.max-h-40` / `.max-h-48` themselves. So at a large scale the composer
 * inflated, refused to shrink, and took the space out of its flex sibling
 * `.tc-chat-history` (`flex-1 min-h-0`), which collapsed to zero. The same
 * unbounded growth is why the tray could not scroll: `overflow-y-auto` needs a
 * bounded height, and no ancestor supplied one.
 *
 * ── why this is a source contract, not a render test ───────────────────────
 * jsdom computes no layout, so nothing in the suite can observe a collapsed
 * flex child by rendering. The guard is therefore on the class strings, the
 * same technique the sibling files `chatComposerTrayBottom.value.test.ts` and
 * `chatComposerFontAndTray.value.test.ts` already use.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isChatTrayFull,
  chatComposerAlwaysCappedClass,
  CHAT_COMPOSER_MAX_H,
} from '../hooks/chatTrayMode';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
/** Comments quote the OLD broken classes, so they must go before matching. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const TICKET_CHAT = stripComments(ticketChatSource());
const INDEX_CSS = read('../index.css');

/** Every mode a stored preference can arrive as, INCLUDING the default one. */
const ALL_MODES: unknown[] = ['default', 'full', undefined, null, '', 'nonsense', 42, {}];

describe('the composer is capped at EVERY tray mode — this is the whole fix', () => {
  it.each(ALL_MODES.map((m) => [JSON.stringify(m) ?? 'undefined', m] as const))(
    'mode %s still gets a ceiling while no tray is open',
    (_label, mode) => {
      /* [FIX-20260830-REALFULL] UPDATED, not weakened: the helper takes
         `trayOpen` now, and the scale-lock bug this file exists for is the
         NO-TRAY / default-tray composer growing unbounded — so the ceiling is
         asserted for trayOpen=false across every mode (a full-mode user with
         nothing open behaves exactly like default, per the owner). The one
         state with NO ceiling — full mode + open tray — is fullscreen by
         definition and is pinned in chatComposerModel.value.test.ts. */
      const cls = chatComposerAlwaysCappedClass(mode, 'bg-white p-3 relative', false);
      expect(cls).toMatch(/\bmax-h-\S+/);
    },
  );

  it('the ceiling is in vh, so the font scale cannot inflate it', () => {
    // rem/em would be multiplied by --tc-chat-scale and the cap would grow with
    // the very thing it is meant to bound — that is the bug, not the fix.
    expect(CHAT_COMPOSER_MAX_H).toMatch(/^max-h-\[\d+vh\]$/);
    expect(CHAT_COMPOSER_MAX_H).not.toMatch(/rem|em\]|px/);
  });

  it('the always-on ceiling leaves the stream the majority of the viewport', () => {
    const vh = Number(CHAT_COMPOSER_MAX_H.match(/(\d+)vh/)![1]);
    // under 50 would make the composer feel cramped at scale 1; at 100 the
    // stream can still reach zero, which is exactly the reported symptom.
    expect(vh).toBeGreaterThanOrEqual(40);
    expect(vh).toBeLessThan(60);
  });

  it('every capped state also gets the flex column that makes the ceiling BITE', () => {
    /* [FIX-20260830-REALFULL] every NON-fullscreen state is capped and keeps
       shrink-0; fullscreen (full+trayOpen) replaces the ceiling with the
       flex-[999] race and is pinned in chatComposerModel.value.test.ts. */
    for (const mode of ALL_MODES) {
      for (const open of [false, true]) {
        const cls = chatComposerAlwaysCappedClass(mode, 'bg-white p-3 relative', open);
        if (open) continue; // ANY open tray is a flex state now (half/full) — other spec
        expect(cls).toContain('flex-col');
        expect(cls).toContain('min-h-0');
        expect(cls).toContain('bg-white p-3 relative');
        expect(cls).toContain('shrink-0');
        expect(cls.split(/\s+/)).not.toContain('flex-1');
        expect(cls.split(/\s+/).filter((c) => c.startsWith('max-h-')).length).toBe(1);
      }
    }
  });

  /* [FIX-20260830-REALFULL] the old "`full` keeps its own taller ceiling" case
     is gone WITH ITS FEATURE: fullscreen is no longer ceiling-based at all —
     a ceiling could only ever tie the stream's flex-1 (a 50/50 split, the
     owner's "เต็มจอก็ไม่เต็ม" screenshot). Fullscreen = flex-[999_1_0%], pinned
     in chatComposerModel.value.test.ts. */

  /* [FIX-20260830-REALFULL] the "two ceilings" case is gone with its feature:
     there is only ONE ceiling constant left (55vh, every capped state) —
     fullscreen carries none at all. Its single-ness is asserted per state
     above; fullscreen is chatComposerModel.value.test.ts territory. */
});

describe('TicketChat wires it in — a capped helper nobody calls fixes nothing', () => {
  it('the composer ROOT goes through the always-capped helper', () => {
    const call = TICKET_CHAT.match(
      /chatComposerAlwaysCappedClass\([\s\S]{0,300}?\)\}/,
    )?.[0];
    expect(call, 'the composer root must use the unconditional cap').toBeTruthy();
    // identified by its own unmistakable classes, not by line number
    expect(call as string).toContain('border-t border-gray-200');
    /* [FIX-20260830-FULLNOSHRINK] CONTRACT CHANGED, deliberately.
       The base string used to type `shrink-0` here, which meant it reached the
       element in every mode and `full` had to strip it back out — so whether
       `shrink-0` or `flex-1` actually reached the DOM depended on a removal
       happening downstream of where a reader sees the class written, and both
       could co-exist with Tailwind's emission order deciding the winner.
       `shrink-0` is now ADDED by `chatComposerAlwaysCappedClass` on the non-full
       branches only, so the two classes are mutually exclusive by construction.
       The base must therefore NOT contain it, and the assertion is inverted to
       pin that — the composer still ends up `shrink-0` in default mode, which is
       asserted on the helper's OUTPUT in the tests just above. */
    expect(call as string).not.toContain('shrink-0');
  });

  it('the root is NOT left on the mode-gated helper', () => {
    // the regression: reverting the call site to chatComposerRootClass silently
    // restores the full-only cap and the default mode goes unbounded again
    expect(TICKET_CHAT).not.toMatch(
      /chatComposerRootClass\(\s*trayMode\s*,\s*'bg-white border-t/,
    );
  });

  it('the message stream is still the flex child that absorbs the remainder', () => {
    // if this ever loses flex-1/min-h-0 the ceiling above has nothing to hand to
    expect(TICKET_CHAT).toContain('tc-chat-history flex-1 min-h-0');
  });
});

describe('the scale rules that CAUSE the inflation are still in place', () => {
  it('the tray caps still grow with the scale — the fix bounds, never unscales', () => {
    // the owner wants big text to stay big; the fix is the ancestor ceiling, so
    // deleting these rules would be a different (wrong) fix and must show up
    expect(INDEX_CSS).toMatch(/\.tc-col-center \.max-h-40\s*\{[^}]*--tc-chat-scale/);
    expect(INDEX_CSS).toMatch(/\.tc-col-center \.max-h-48\s*\{[^}]*--tc-chat-scale/);
  });

  it('icons still scale with the font — untouched by this fix', () => {
    expect(INDEX_CSS).toMatch(/\.tc-col-center svg\s*\{[^}]*calc\(1em \* var\(--tc-chat-scale\)\)/);
  });
});
