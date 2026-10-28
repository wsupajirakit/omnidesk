/**
 * [FIX-20260830-QRSINGLESCROLL] the quick-reply tray had TWO nested scrollbars.
 *
 * Owner, 30/08: *"ตอบด่วน scroll เบิ้ล ข้างในไม่ต้องมี มีตัวนอกพอ"*, plus
 * *"แต่ต้อง wrap ข้างนอกให้ดี"*.
 *
 * ── the cause ──────────────────────────────────────────────────────────────
 * Two scroll regions, one directly inside the other:
 *   TicketChat.tsx   the tray wrapper: `max-h-[46vh] overflow-y-auto`
 *   QuickReplyManager.tsx  the reply list: `max-h-[46vh] overflow-y-auto` (compact)
 * The point round then drives whichever region the pointer happens to be over, so the
 * panel feels stuck or jumps between the two.
 *
 * ── the contract pinned here ───────────────────────────────────────────────
 *  · in the PANEL variant the inner list does not scroll and has no cap
 *  · the OUTER tray wrapper is the single scroll container, and it is properly
 *    bounded — otherwise dropping the inner cap just lets the tray grow forever
 *  · the MODAL variant is untouched: different wrapper, its own scroll region
 *  · the FULL (fullscreen tray) branch is untouched: there the list IS the
 *    intended scroller, because the wrapper gives up every cap to the tray
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { chatTrayPanelClass } from '../hooks/chatTrayMode';
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
const QUICK_REPLY = stripComments(read('../components/chat/QuickReplyManager.tsx'));
const TICKET_CHAT = stripComments(ticketChatSource());

/** the reply-list line: the one element in QuickReplyManager that branches on `full` */
const listLine = (): string => {
  const line = QUICK_REPLY.split('\n').find(
    (l) => l.includes('space-y-1.5') && l.includes('full ?'),
  );
  expect(line, 'the reply list line must exist and branch on `full`').toBeTruthy();
  return line as string;
};

/** the arm of the ternary chosen for a given state */
const compactArm = (): string => {
  const l = listLine();
  const after = l.slice(l.indexOf('compact ?') + 'compact ?'.length);
  return after.slice(0, after.indexOf(':'));
};
const modalArm = (): string => {
  const l = listLine();
  const after = l.slice(l.indexOf('compact ?') + 'compact ?'.length);
  return after.slice(after.indexOf(':') + 1);
};
const fullArm = (): string => {
  const l = listLine();
  const after = l.slice(l.indexOf('full ?') + 'full ?'.length);
  return after.slice(0, after.indexOf(':'));
};

describe('1. ⭐⭐⭐ the panel variant has no scroller of its own', () => {
  it('the compact branch declares no overflow', () => {
    // 🔴 the bug: `max-h-[46vh] overflow-y-auto` here, inside a wrapper that
    //    already scrolled — two nested scroll regions
    expect(compactArm()).not.toContain('overflow');
  });

  it('and no height cap either — the cap belongs to the outer wrapper now', () => {
    expect(compactArm()).not.toContain('max-h-');
  });

  it('⭐⭐ the scroll classes are inside the branches, not on the shared prefix', () => {
    /* if `overflow-y-auto` stayed on the always-applied part of the className the
       compact branch would still scroll no matter what its own arm said */
    const l = listLine();
    const prefix = l.slice(0, l.indexOf('${'));
    expect(prefix).not.toContain('overflow');
    expect(prefix).not.toContain('max-h-');
  });
});

describe('2. ⭐⭐⭐ the OUTER container is the single, properly bounded scroller', () => {
  it('the quick-reply tray wrapper still scrolls', () => {
    const i = TICKET_CHAT.indexOf('max-h-[46vh] overflow-y-auto');
    expect(i, 'the tray wrapper must keep cap + scroller').toBeGreaterThan(-1);
  });

  it('⭐⭐⭐ and it has a definite height to scroll within ("wrap ข้างนอกให้ดี")', () => {
    /* [FIX-20260830-HALFTRAY] the bound no longer comes from a cap on the tray
       (tc-tray-cap is gone) but from the FLEX CHAIN: root flex-1/flex-[999] →
       box flex-1 min-h-0 → tray flex-1 min-h-0. A flex-1 child of a bounded
       column has a definite height, which is what overflow-y-auto needs. */
    const c = chatTrayPanelClass('default', 'p-3 max-h-[46vh] overflow-y-auto custom-scrollbar');
    expect(c).toContain('flex-1');
    expect(c).toContain('min-h-0');
    expect(c).toContain('overflow-y-auto');
    expect(c).not.toMatch(/max-h-/);
  });

  it('⭐⭐ exactly ONE scroll region in the quick-reply chain, not two', () => {
    /* the pairing is the whole bug: wrapper scrolls + list scrolls = double.
       With the compact arm empty, only the wrapper does. */
    const wrapperScrolls = TICKET_CHAT.includes('max-h-[46vh] overflow-y-auto');
    const listScrollsWhenCompact = compactArm().includes('overflow');
    expect(wrapperScrolls).toBe(true);
    expect(listScrollsWhenCompact).toBe(false);
  });
});

describe('3. the other two variants are deliberately untouched', () => {
  it('⭐⭐⭐ the MODAL variant keeps its cap and its own scroller', () => {
    /* it lives in the gear dialog, a different wrapper outside the composer
       height chain; dropping its cap would let the body outgrow the shell */
    const arm = modalArm();
    expect(arm).toContain('max-h-[60vh]');
    expect(arm).toContain('overflow-y-auto');
  });

  it('the modal mount still exists and is a separate scroll region', () => {
    expect(TICKET_CHAT).toContain('<QuickReplyManager variant="modal" />');
    const i = TICKET_CHAT.indexOf('<QuickReplyManager variant="modal" />');
    const before = TICKET_CHAT.slice(i - 200, i);
    expect(before).toContain('overflow-y-auto');
  });

  it('⭐⭐ the FULL branch keeps scrolling — there the list IS the scroller', () => {
    /* in fullscreen the tray wrapper drops every cap so the tray owns the
       column, so the list must scroll or the content runs off the bottom */
    const arm = fullArm();
    expect(arm).toContain('flex-1');
    expect(arm).toContain('min-h-0');
    expect(arm).toContain('overflow-y-auto');
    expect(arm).not.toContain('max-h-');
  });

  it('the `full` flag is still wired from TicketChat — a prop nobody sets is dead', () => {
    expect(TICKET_CHAT).toMatch(/full=\{isChatTrayFull\(/);
  });
});
