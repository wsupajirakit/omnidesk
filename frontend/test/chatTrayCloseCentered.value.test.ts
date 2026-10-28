/**
 * [FIX-20260830-CLOSECENTER] the tray close button moves to the CENTRE.
 *
 * Owner, 30/08, said twice: *"ปิดแผงย้ายมาตรงกลาง"* / *"ปุ่ม ปิดแผง ย้ายไปตรงกลางจอ"*
 * — the "✕ ปิดแผง" button must sit at the horizontal centre of the toolbar row,
 * i.e. the middle of the chat column, not merely to the right of "ตอบด่วน".
 *
 * ── the cause ──────────────────────────────────────────────────────────────
 * It was simply the next flex child after ตอบด่วน. `ml-auto` on the settings
 * button pushes only the RIGHT cluster away; every child before it stays packed
 * against the left, so the close button read as part of the left icon cluster.
 *
 * ── why absolute centring, not three-zone flex ─────────────────────────────
 * `absolute left-1/2 -translate-x-1/2` centres against the ROW, so the button
 * lands at the true middle of the column whatever the two clusters weigh. The
 * `flex-1` spacer alternative centres against the LEFTOVER space, so the button
 * drifts off-centre whenever the clusters differ in width — and they do: the
 * right one carries a two-option pill. Out of flow also means it can never push
 * the clusters around at narrow widths.
 *
 * Source contract: jsdom computes no layout, so "it is at x = width/2" is not
 * observable by rendering. The centring mechanism is what is exactly checkable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\s*\}/g, ' ');
const TICKET_CHAT = stripComments(ticketChatSource());

const TOOLBAR_OPENER = 'chatComposerFixedRowClass(trayMode, `${composerLocked';

/** the composer toolbar row, from its helper call to the mode-switch pill */
const toolbar = (): string => {
  const i = TICKET_CHAT.indexOf(TOOLBAR_OPENER);
  expect(i, 'the composer toolbar row must exist').toBeGreaterThan(-1);
  const end = TICKET_CHAT.indexOf('tc-mode-switch', i);
  expect(end).toBeGreaterThan(i);
  return TICKET_CHAT.slice(i, end);
};

/** everything from the tray-open gate down to the close button itself */
const closeButtonBlock = (): string => {
  const bar = toolbar();
  const i = bar.indexOf('trayCloseLabel');
  expect(i, 'the close button must exist').toBeGreaterThan(-1);
  const gate = bar.lastIndexOf('{anyTrayOpen && (', i);
  expect(gate, 'it must still be gated on a tray being open').toBeGreaterThan(-1);
  return bar.slice(gate, i);
};

describe('1. ⭐⭐⭐ the button is centred against the toolbar row', () => {
  it('it is taken out of flow and centred, not packed after ตอบด่วน', () => {
    /* 🔴 the bug: it was an ordinary flex child, so it sat hard against the
       left cluster. `left-1/2` alone puts its LEFT EDGE at the middle; the
       translate is what centres the button itself. Both are required. */
    const block = closeButtonBlock();
    expect(block).toContain('absolute');
    expect(block).toContain('left-1/2');
    expect(block).toContain('-translate-x-1/2');
  });

  it('⭐⭐⭐ the toolbar row is the positioning context it resolves against', () => {
    /* absolute positioning walks up to the nearest POSITIONED ancestor. Without
       `relative` on the row the button escapes to whatever is positioned above
       (the composer box is `relative`) and centres against the wrong element —
       markup that looks right and lands wrong. */
    const start = TICKET_CHAT.indexOf(TOOLBAR_OPENER);
    const openTag = TICKET_CHAT.slice(start, TICKET_CHAT.indexOf('>', start));
    expect(openTag).toContain('border-b border-gray-100 bg-white');
    expect(openTag).toContain('relative');
  });

  it('⭐⭐ it does not become a dead click strip over the toolbar', () => {
    /* the centring wrapper overlays the row; without the pointer-events pair the
       empty space either side of the button would swallow clicks meant for the
       icons underneath it */
    const block = closeButtonBlock();
    expect(block).toContain('pointer-events-none');
    expect(block).toContain('pointer-events-auto');
  });

  it('⭐⭐ the left and right clusters are untouched — centring took nothing from them', () => {
    const bar = toolbar();
    // left cluster still first, right cluster still pushed right by ml-auto
    expect(bar).toContain('ตอบด่วน');
    expect(bar).toContain('ml-auto');
  });
});

describe('2. everything else about the button is unchanged', () => {
  it('⭐⭐⭐ its size is still pinned against every font scale and tray override', () => {
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    const tag = bar.slice(bar.lastIndexOf('<button', i), i);
    expect(tag).toContain('tc-fixed-scale-1');
  });

  it('⭐⭐⭐ it is still rendered ONLY while a tray is open', () => {
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    expect(bar.lastIndexOf('{anyTrayOpen && (', i)).toBeGreaterThan(-1);
  });

  it('⭐⭐⭐ it still closes whichever tray is open', () => {
    expect(closeButtonBlock()).toContain('onClick={closeAllTrays}');
  });

  it('it is still exactly ONE button, not one per tray', () => {
    const all = TICKET_CHAT.match(/onClick=\{closeAllTrays\}/g) ?? [];
    expect(all.length).toBe(1);
  });

  it('it is still type="button" — a bare button here would submit and send', () => {
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    expect(bar.slice(bar.lastIndexOf('<button', i), i)).toContain('type="button"');
  });
});
