/**
 * Three fixes reported by the owner that shipped WITHOUT a test. This file is
 * the guard for all three, because each one is invisible to every other test:
 * they are CSS scope and JSX props, and the suite was green while all three
 * were broken in the browser.
 *
 *  1. [FIX-20260830-CHATFONTCOMPOSER] "Sarabun, chat only" never reached the composer.
 *     `.tc-chat-bg` is the message stream alone; the composer and all three trays sit
 *     outside it.
 *  2. [FEAT-20260830-CHATTRAY] "open fullscreen" was not actually full.
 *     The class being swapped was on the outer element, while the real `max-h-*` cap
 *     was hiding one level deeper.
 *  3. The tray stuck across rooms — leave the composer expanded, click another card,
 *     and its height and draft came along. The fix is a `key` that forces a remount per
 *     room, and deleting it turns nothing red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatPageSource, ticketChatSource } from './ticketChatSource';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
/** Comments quote the OLD broken code, so they must go before any matching. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const INDEX_HTML = stripComments(read('../index.html'));
const QUICK_REPLY = stripComments(read('../components/chat/QuickReplyManager.tsx'));
const TICKET_CHAT = stripComments(ticketChatSource());

describe('1. Sarabun "chat only" reaches the composer, quick replies and stickers', () => {
  /** The selector list of the one rule that paints Sarabun in chat-only mode. */
  const chatFontSelectors = (): string[] => {
    const start = INDEX_HTML.indexOf('html[data-font="chat"]');
    expect(start).toBeGreaterThan(-1);
    const block = INDEX_HTML.slice(start, INDEX_HTML.indexOf('}', start));
    return block
      .split('{')[0]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  it('scopes on the whole centre column, not just the message stream', () => {
    const sel = chatFontSelectors().join(' | ');
    // .tc-chat-bg alone was the bug: it is the stream only
    expect(sel).toContain('.tc-col-center');
  });

  it('reaches DESCENDANTS of the centre column — the composer and the trays', () => {
    const sel = chatFontSelectors();
    expect(sel.some((s) => s.startsWith('html[data-font="chat"] .tc-col-center *'))).toBe(true);
  });

  it('still covers the legacy stream selector, or older chat pages lose the font', () => {
    expect(chatFontSelectors().join(' | ')).toContain('.tc-chat-bg');
  });

  it('never leaks outside the chat — no unscoped descendant selector', () => {
    chatFontSelectors().forEach((s) => {
      expect(s).toMatch(/\.tc-chat-bg|\.tc-col-center/);
    });
  });

  it('leaves monospace alone in every scope', () => {
    chatFontSelectors()
      .filter((s) => s.includes('*'))
      .forEach((s) => expect(s).toContain(':not(.font-mono)'));
  });
});

describe('2. "open fullscreen" actually removes the height cap', () => {
  it('QuickReplyManager takes a `full` flag', () => {
    expect(QUICK_REPLY).toMatch(/full\??\s*:\s*boolean/);
  });

  it('the SCROLLING list drops its max-h when full — the cap lived one level deeper', () => {
    const line = QUICK_REPLY.split('\n').find(
      (l) => l.includes('overflow-y-auto') && l.includes('full'),
    );
    expect(line, 'the list line must branch on `full`').toBeTruthy();
    const fullBranch = (line as string).slice((line as string).indexOf('full ?'));
    const upToColon = fullBranch.slice(0, fullBranch.indexOf(':'));
    // 🔴 the whole bug: swapping an OUTER class while an inner `max-h-*` survived
    expect(upToColon).not.toMatch(/max-h-/);
    expect(upToColon).toContain('flex-1');
    expect(upToColon).toContain('min-h-0');
  });

  /* [FIX-20260830-QRSINGLESCROLL] CONTRACT CHANGED for the PANEL branch only.
     Owner, 30/08: *"ตอบด่วน scroll เบิ้ล ข้างในไม่ต้องมี มีตัวนอกพอ"* — the
     quick-reply tray had two nested scroll regions, this list's own
     `max-h-[46vh] overflow-y-auto` inside the tray wrapper's `overflow-y-auto`,
     so the point round drove whichever the pointer was over.
     The compact/panel branch therefore no longer scrolls at all: no `max-h-*`,
     no `overflow-*`. Its ceiling now lives solely on the tray wrapper in
     TicketChat, which is the single scroll container.
     The MODAL branch (`max-h-[60vh]`) is deliberately unchanged — it is a
     different wrapper, outside the composer height chain, and dropping its cap
     would let the dialog body outgrow its own `max-h-[92vh]` shell. */
  it('the modal path keeps its cap and its scroller — only the panel gave one up', () => {
    const line = QUICK_REPLY.split('\n').find(
      (l) => l.includes('overflow-y-auto') && l.includes('full'),
    ) as string;
    expect(line, 'the list line must still branch on `full`').toBeTruthy();
    // modal: unchanged, still capped and still its own scroller
    expect(line).toMatch(/max-h-\[60vh\]/);
    // panel: the 46vh cap and the inner scroller are BOTH gone
    expect(line).not.toMatch(/max-h-\[46vh\]/);
  });

  it('⭐⭐⭐ the panel branch has no scroller of its own — one scrollbar, the outer', () => {
    const line = QUICK_REPLY.split('\n').find(
      (l) => l.includes('overflow-y-auto') && l.includes('full'),
    ) as string;
    /* the compact branch is the `? :` arm chosen when `full` is false and
       `compact` is true — it must be empty of any scroll/cap class */
    const compactArm = line.slice(line.indexOf('compact ?') + 'compact ?'.length);
    const arm = compactArm.slice(0, compactArm.indexOf(':'));
    expect(arm).not.toContain('overflow');
    expect(arm).not.toContain('max-h-');
  });

  it('⭐⭐⭐ the OUTER quick-reply tray really is a bounded scroll container', () => {
    /* "wrap ข้างนอกให้ดี": removing the inner scroller is only safe while the
       wrapper both scrolls AND has a definite height to scroll within —
       otherwise the tray just grows without limit. */
    const i = TICKET_CHAT.indexOf('max-h-[46vh] overflow-y-auto');
    expect(i, 'the quick-reply tray wrapper must keep its cap + scroller').toBeGreaterThan(-1);
    // and it goes through the tray helper, which adds the unscalable ceiling too
    const line = TICKET_CHAT.slice(TICKET_CHAT.lastIndexOf('\n', i), i);
    expect(line).toContain('chatTrayPanelClass');
  });

  it('TicketChat actually passes the flag — a prop nobody sets is dead code', () => {
    expect(TICKET_CHAT).toMatch(/full=\{isChatTrayFull\(/);
  });
});

describe('3. the composer resets when you switch to another card', () => {
  /* [REFACTOR-20260905-CUSTPROV] the PAGE, not the union: a "mount" is a
     `<ChatInputBox …>` in the page's JSX, and the composer's own
     `React.FC<ChatInputBoxProps>` signature contains that same substring. The
     assertions below are unchanged — only the text they read is narrowed back
     to the file the claim was always about. */
  const mounts = () =>
    stripComments(ticketChatPageSource())
      .split('<ChatInputBox')
      .slice(1)
      .map((chunk) => chunk.slice(0, 400));

  it('there are still exactly two composer mounts', () => {
    expect(mounts().length).toBe(2);
  });

  it('BOTH mounts are keyed by the open ticket, so React remounts per room', () => {
    mounts().forEach((m) => {
      expect(m).toMatch(/key=\{selectedTicket\?\._id \?\? 'none'\}/);
    });
  });

  it('the key is the TICKET id, not an index or a constant', () => {
    mounts().forEach((m) => {
      const key = m.match(/key=\{([^}]*)\}/)?.[1] ?? '';
      expect(key).toContain('selectedTicket');
      expect(key).not.toMatch(/^\s*(index|i|0|'[^']*')\s*$/);
    });
  });
});
