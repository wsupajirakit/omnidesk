/**
 * [FIX-20260830-GRIPWHOLE] the drag grip resized only the textarea.
 *
 * Owner, 30/08: *"เวลาลากสามขีดมันได้ลากไปแค่กล่อง input"* — and when asked,
 * chose that the grip should grow the WHOLE composer, the open tray included.
 *
 * ── the cause ──────────────────────────────────────────────────────────────
 * `areaH` was applied as `style={{ height: areaH }}` on the `<textarea>` and on
 * nothing else. The tray, the toolbar and the counter live outside that element,
 * so dragging up gave room to the typing area alone and an open sticker tray
 * stayed pinned at its own `max-h-48`.
 *
 * ── what the fix does ──────────────────────────────────────────────────────
 * `areaH` now drives the COMPOSER BOX (the inner `flex flex-col` holding
 * toolbar + tray + textarea + counter); the textarea becomes `h-full` inside a
 * `flex-1 min-h-0` row. One number stays one number, so every rule in
 * `composerHeightMemory.ts` — remember only while chatting, one value shared
 * across chat rooms, non-chat rooms reset — is untouched, and this file
 * re-asserts them so the change cannot quietly break the owner's 24/08
 * decisions.
 *
 * Source contract: jsdom computes no layout, so "the tray got taller" is not
 * observable by rendering; what IS exactly checkable is which element the drag
 * number lands on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  heightFor,
  shouldRemember,
  DEFAULT_COMPOSER_H,
  IDLE_COMPOSER_H,
} from '../pages/chat/composerHeightMemory';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const RAW = ticketChatSource();
const TICKET_CHAT = stripComments(RAW);

/** The `<textarea>` element of the composer, by its unmistakable placeholder. */
const composerTextarea = (): string => {
  const i = TICKET_CHAT.indexOf('พิมพ์ข้อความตอบลูกค้า');
  expect(i, 'the composer textarea must exist').toBeGreaterThan(-1);
  const start = TICKET_CHAT.lastIndexOf('<textarea', i);
  const end = TICKET_CHAT.indexOf('/>', i);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return TICKET_CHAT.slice(start, end);
};

/* [FIX-20260830-COMPOSERIDLEH] CONTRACT CHANGED in this block, deliberately.
   The original rule — "the textarea never carries a pixel height again" — read
   the 30/08 grip complaint correctly but stated it too absolutely. Applying the
   dragged number to the BOX in every non-full state made the box a FIXED height
   even with no tray open, so at the default areaH of 120 it was pinned to 198px
   with only chrome to fill it and the surplus showed as dead space under the
   caret (the owner's follow-up screenshot: stream squeezed to the top third).
   The rule is now conditional on there being a tray to share the height with. */
describe('1. the drag number lands on the textarea ONLY when there is no tray', () => {
  it('⭐⭐⭐ the textarea height is gated, never unconditional', () => {
    /* 🔴 the original bug was `style={{ height: areaH }}` typed inline on this
       element, which no branch could turn off. The inline literal must stay gone;
       the height may only arrive through the gated `textareaStyle`. */
    const ta = composerTextarea();
    expect(ta).not.toMatch(/style=\{\{\s*height:\s*areaH/);
    expect(ta).toContain('style={textareaStyle}');
  });

  it('⭐⭐⭐ that gate is locked-or-fullscreen — the two states the box gives up', () => {
    /* [FIX-20260830-REALFULL] rewritten with the model: the textarea carries
       its own height exactly when the BOX cannot (locked room → box auto so a
       non-chat card snaps back to its own size; true fullscreen → box flex-1).
       In every other state — including default mode with a tray open — the box
       holds the dragged height so the grip grows the whole composer. */
    const decl = TICKET_CHAT.slice(
      TICKET_CHAT.indexOf('const textareaStyle'),
      TICKET_CHAT.indexOf('const textareaStyle') + 300,
    );
    /* [FIX-20260830-HALFTRAY] the gate widened from "truly fullscreen" to ANY
       open tray — every open tray is a flex state now. */
    expect(decl).toMatch(/composerLocked \|\| anyTrayOpen/);
    /* [FIX-20261019-STALEPIN] the textarea branch reads `effectiveAreaH`, not `areaH`, since commit
       a34be6e (18/09) — owner rule [FIX-20260918-TRAYHALFAREA]: with the quick-reply / emoji /
       sticker panel open in DEFAULT mode the typing area takes HALF the dragged height (never under
       44px) so the panel is not squeezed out of sight; expanded mode untouched. That commit did not
       update this pin, which kept asserting the pre-rule `height: areaH` and failed since. Still
       ONE number: `effectiveAreaH` is derived from `areaH` alone (pinned below). */
    expect(decl).toContain('height: effectiveAreaH');
    expect(TICKET_CHAT).toMatch(
      /const effectiveAreaH =\s*trayPanelOpen && !isFullTray\s*\?\s*Math\.max\(44, Math\.round\(areaH \/ 2\)\)\s*:\s*areaH;/,
    );
  });

  it('⭐⭐⭐ `h-full` is dropped in exactly the state the pixel height applies', () => {
    /* both at once would be a contradiction: `h-full` against a content-sized
       ancestor resolves to auto and would collapse the typing area to one line
       however far the grip was dragged */
    expect(composerTextarea()).toMatch(/\$\{textareaStyle \? '' : 'h-full'\}/);
  });

  it('its row can absorb the leftover height, with a floor it cannot fall below', () => {
    const rows: string[] =
      TICKET_CHAT.match(/chatComposerFixedRowClass\([\s\S]{0,300}?\)\}/g) ?? [];
    const row = rows.find((r) => r.includes('flex items-end p-2 bg-white rounded-b-lg'));
    expect(row, 'the textarea+send row must still go through the helper').toBeTruthy();
    expect(row as string).toContain('flex-1');
    /* [FIX-20260830-TRAYCAPSCALE] `min-h-0` → `min-h-[44px]`. A `flex:1 1 0%`
       row has a floor of literally zero, so a tall tray in a capped composer
       crushed it to a clipped sliver (the owner's default-mode screenshot).
       44px is the send button (h-10) plus the row's padding. */
    expect(row as string).toMatch(/min-h-\[\d+px\]/);
    expect(row as string).not.toMatch(/\bmin-h-0\b/);
  });
});

describe('2. the drag number lands on the WHOLE composer box', () => {
  it('⭐⭐⭐ a derived box height exists and is built from areaH', () => {
    expect(TICKET_CHAT).toMatch(/const\s+composerBoxH\s*=/);
    const decl = TICKET_CHAT.slice(
      TICKET_CHAT.indexOf('const composerBoxH'),
      TICKET_CHAT.indexOf('const composerBoxH') + 300,
    );
    expect(decl).toContain('areaH');
    // it must still be CLAMPED — an unclamped drag can bury the message stream
    expect(decl).toContain('Math.max');
    expect(decl).toContain('Math.min');
    expect(decl).toContain('MIN_H');
    expect(decl).toContain('MAX_H');
  });

  it('⭐⭐⭐ it is applied to the inner composer box, the one holding the tray', () => {
    const i = TICKET_CHAT.indexOf('rounded-lg shadow-sm flex flex-col');
    expect(i, 'the inner composer box must exist').toBeGreaterThan(-1);
    // the style attribute sits within the same JSX opening tag
    const tag = TICKET_CHAT.slice(i, TICKET_CHAT.indexOf('\n      >', i));
    expect(tag).toContain('composerBoxStyle');
  });

  /* [FIX-20260830-COMPOSERIDLEH] this used to read the ternary straight off the
     JSX tag. The condition moved to a named declaration so it could carry its
     reasoning, and it grew a third state, so it is pinned at the declaration. */
  it('⭐⭐⭐ TRUE fullscreen is exempt — a dragged pixel height would cap "เต็มจอ"', () => {
    /* [FIX-20260830-REALFULL] "fullscreen" is a STATE (full mode AND a tray
       open), not the mode alone — gating on the mode alone was itself a bug:
       a full-mode user with nothing open got a flex-1 composer that ate half
       the column while empty. */
    const decl = TICKET_CHAT.slice(
      TICKET_CHAT.indexOf('const composerBoxStyle'),
      TICKET_CHAT.indexOf('const composerBoxStyle') + 260,
    );
    /* [FIX-20260830-HALFTRAY] any open tray is exempt, not just fullscreen. */
    expect(decl).toMatch(/!composerLocked && !anyTrayOpen \? \{ height: composerBoxH \} : undefined/);
  });

  it('⭐⭐⭐ a LOCKED room sheds the box height, so the card snaps back to its own size', () => {
    /* [FIX-20260830-REALFULL] supersedes "with no tray the box carries no
       height": that reading was wrong — with no tray the box DOES hold the
       dragged height (that is the drag working, and the pre-existing default
       look). The state that must shed it is the locked, non-chat card
       (บอทดูแล / รอรับเคส): its chrome is hidden, so height+CHROME would pad
       78px of emptiness, and `heightFor()` already resets `areaH` per room. */
    const decl = TICKET_CHAT.slice(
      TICKET_CHAT.indexOf('const composerBoxStyle'),
      TICKET_CHAT.indexOf('const composerBoxStyle') + 200,
    );
    expect(decl).toContain('!composerLocked');
  });

  it('the grip handlers still drive `areaH`, so the memory rules see the drag', () => {
    /* window widened 400→1400: [FIX-20260830-DRAGTOGETHER] put a documented
       tray branch ahead of the first setAreaH — which itself now calls setAreaH
       too (the input scales with the tray drag), so the intent holds harder. */
    expect(TICKET_CHAT).toMatch(/onGripMove[\s\S]{0,1400}setAreaH\(/);
    expect(TICKET_CHAT).toMatch(/onGripUp[\s\S]{0,300}shouldRemember\(canType\)/);
  });
});

describe('3. MIN_H/MAX_H changed MEANING — the change is declared, not silent', () => {
  it('the chrome height used to re-express the bounds exists', () => {
    expect(TICKET_CHAT).toMatch(/const\s+COMPOSER_CHROME_H\s*=\s*\d+/);
  });

  it('⭐⭐ the reinterpretation is documented at the source, with the tag', () => {
    // an undeclared change of meaning is how the next reader misreads the clamp
    const i = RAW.indexOf('[FIX-20260830-GRIPWHOLE]');
    expect(i, 'the fix must carry its tag').toBeGreaterThan(-1);
    const block = RAW.slice(i, i + 3000);
    expect(block).toContain('MIN_H');
    expect(block).toContain('MAX_H');
  });

  it('the box floor still leaves room for one readable line above the chrome', () => {
    const chrome = Number(TICKET_CHAT.match(/const\s+COMPOSER_CHROME_H\s*=\s*(\d+)/)![1]);
    const min = Number(TICKET_CHAT.match(/const\s+MIN_H\s*=\s*(\d+)/)![1]);
    // grip 16 + toolbar ~40 + counter ~22; anything much smaller means the
    // floor was re-expressed as if the chrome were free
    expect(chrome).toBeGreaterThanOrEqual(56);
    expect(min + chrome).toBeGreaterThan(chrome);
  });
});

describe('4. the 24/08 height-memory decisions are untouched by this fix', () => {
  it('non-chat rooms still reset to the idle height, ignoring the remembered value', () => {
    expect(heightFor(false, 400)).toBe(IDLE_COMPOSER_H);
    expect(heightFor(false, null)).toBe(IDLE_COMPOSER_H);
  });

  it('chat rooms still get the shared remembered value, else the default', () => {
    expect(heightFor(true, 260)).toBe(260);
    expect(heightFor(true, null)).toBe(DEFAULT_COMPOSER_H);
  });

  it('only a real chat room remembers a drag', () => {
    expect(shouldRemember(true)).toBe(true);
    expect(shouldRemember(false)).toBe(false);
  });

  it('the remembered value is still ONE shared scalar, not a per-room map', () => {
    // a second dimension here would break every one of the rules above
    expect(TICKET_CHAT).toMatch(/rememberedH\s*=\s*useRef<number \| null>\(null\)/);
  });
});
