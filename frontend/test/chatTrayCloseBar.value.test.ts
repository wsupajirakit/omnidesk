/**
 * [FEAT-20260830-TRAYCLOSEBAR] one tray close button, in the toolbar, fixed size.
 *
 * Owner, 30/08: *"ปุ่มปิดย้ายไปอยู่ตรงกลาง ระหว่างตอบด่วนกับปุ่มขยาย · สเกล font
 * ปกติ ไม่สนใจ 6 scale"*.
 *
 * ── the cause of what the owner saw ────────────────────────────────────────
 * Each tray rendered its OWN `PanelCloseButton` in a `sticky top-0` strip INSIDE
 * the panel. The emoji and sticker panels carry a pinned `--tc-chat-scale`
 * override ([FEAT-20260830-TRAYFIXEDSCALE]) and index.css multiplies every
 * text/svg rule by that variable, so the sticker tray's close button was blown
 * up to the largest step — huge, exactly as screenshotted.
 *
 * ── the contract this file pins ────────────────────────────────────────────
 *  · exactly ONE close button, in the composer toolbar row
 *  · [FIX-20260830-CLOSECENTER] horizontally CENTRED in that row — the owner
 *    repeated *"ปุ่ม ปิดแผง ย้ายไปตรงกลางจอ"*, which supersedes the original
 *    "between ตอบด่วน and the expand button" placement pinned below
 *  · rendered only while a tray is open, and it closes whichever one is
 *  · its size is fixed: it sits outside every panel AND re-pins the multiplier
 *  · the old in-panel close strips are gone, and so is the component nobody
 *    else was using
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const at = (p: string) => resolve(__dirname, p);
const read = (p: string) => readFileSync(at(p), 'utf8');
const stripComments = (src: string) =>
  /* block comments FIRST — a `{/* … *\/}` pass alone spans from one JSX comment
     to a LATER one and eats the markup in between (same trap as
     chatTrayFixedScale.value.test.ts). */
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\s*\}/g, ' ');

const TICKET_CHAT = stripComments(ticketChatSource());
const INDEX_CSS = read('../index.css');
const EN = JSON.parse(read('../i18n/translations/en.json'));
const TH = JSON.parse(read('../i18n/translations/th.json'));

/** The composer toolbar row: from its `chatComposerFixedRowClass(` opener with
 *  the toolbar's own classes, to the mode-switch pill that ends it. */
const TOOLBAR_OPENER = 'chatComposerFixedRowClass(trayMode, `${composerLocked';
const toolbar = (): string => {
  /* [FIX-20260830-CLOSECENTER] anchored on the helper CALL rather than on the
     tail of its class string. The row gained `relative` (the positioning context
     the centred button resolves against), which moved the old
     "border-b border-gray-100 bg-white`)}" anchor and made every assertion in
     this file fail to even locate the toolbar. The call opener is stable
     regardless of what classes are appended. */
  const i = TICKET_CHAT.indexOf(TOOLBAR_OPENER);
  expect(i, 'the composer toolbar row must exist').toBeGreaterThan(-1);
  const end = TICKET_CHAT.indexOf('tc-mode-switch', i);
  expect(end).toBeGreaterThan(i);
  return TICKET_CHAT.slice(i, end);
};

describe('1. the button lives in the toolbar, CENTRED in the row', () => {
  it('⭐⭐⭐ a close button is rendered inside the toolbar row', () => {
    expect(toolbar()).toContain('trayCloseLabel');
  });

  /* [FIX-20260830-CLOSECENTER] CONTRACT CHANGED, deliberately.
     This block used to pin "after ตอบด่วน and before the expand button", which
     is where the owner then said it must NOT be: repeated twice as *"ปุ่ม ปิดแผง
     ย้ายไปตรงกลางจอ"*, i.e. the horizontal CENTRE of the toolbar, not merely the
     next child after the left cluster. Source order no longer decides where it
     appears, so pinning source order would pin the wrong thing and would stay
     green if the centring were removed. What is pinned instead is the mechanism
     that actually centres it. */
  it('⭐⭐⭐ it is absolutely centred against the row, not packed after ตอบด่วน', () => {
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    expect(i, 'the close button must exist').toBeGreaterThan(-1);
    const wrapper = bar.slice(0, i);
    // `left-1/2` + `-translate-x-1/2` is the pair; either alone is off-centre
    expect(wrapper).toContain('absolute');
    expect(wrapper).toContain('left-1/2');
    expect(wrapper).toContain('-translate-x-1/2');
  });

  it('⭐⭐⭐ the toolbar row is the positioning context it centres against', () => {
    /* absolute positioning resolves against the nearest positioned ancestor. If
       the row is not `relative` the button escapes to the composer box (or the
       page) and lands somewhere else entirely — green markup, wrong pixel. */
    const start = TICKET_CHAT.indexOf(TOOLBAR_OPENER);
    expect(start).toBeGreaterThan(-1);
    const openTag = TICKET_CHAT.slice(start, TICKET_CHAT.indexOf('>', start));
    expect(openTag).toContain('border-b border-gray-100 bg-white');
    expect(openTag).toContain('relative');
  });

  it('⭐⭐ being out of flow must not make the row a dead click strip', () => {
    /* the centring wrapper spans no width of its own, but it DOES sit over the
       toolbar; without the pointer-events pair the gap either side of the button
       would swallow clicks aimed at the icons underneath */
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    const wrapper = bar.slice(0, i);
    expect(wrapper).toContain('pointer-events-none');
    expect(wrapper).toContain('pointer-events-auto');
  });

  it('it is a type="button" — a bare button here would submit and send', () => {
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    expect(bar.slice(bar.lastIndexOf('<button', i), i)).toContain('type="button"');
  });
});

describe('2. it only exists while a tray is open, and closes whichever one is', () => {
  it('⭐⭐⭐ it is gated on a tray actually being open', () => {
    /* [FIX-20260830-CLOSECENTER] the gate now wraps a centring <div> rather than
       the <button> directly, so `{anyTrayOpen && (` is no longer the last thing
       on its line before the button. The gate itself is unchanged and is what
       this pins: the nearest opening gate above the button is anyTrayOpen. */
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    const before = bar.slice(0, i);
    expect(before).toContain('{anyTrayOpen && (');
    // ...and nothing else re-gates it in between
    const gate = before.lastIndexOf('{anyTrayOpen && (');
    expect(before.slice(gate)).not.toMatch(/\{\s*show(Emoji|Stickers|QuickReply)\s*&&/);
  });

  it('the gate covers all three trays', () => {
    /* [FIX-20260909-TRAYHEIGHT] the gate this bar uses is `trayPanelOpen`, the
       THREE sliding panels. `anyTrayOpen` still exists and still drives the
       height decisions, but it grew to mean "anything that steals height from
       the input row" — the translate preview joined it after that strip
       collapsed the textarea to a sliver.
       🔴 The close BAR must not follow it there: this button closes panels, and
          the translate strip is not one — it has its own labelled button. So the
          gate is asserted against the narrow name, which is what it always meant. */
    const decl = TICKET_CHAT.match(/const\s+trayPanelOpen\s*=\s*([^;]+);/)![1];
    for (const flag of ['showEmoji', 'showStickers', 'showQuickReply']) {
      expect(decl).toContain(flag);
    }
    /* and the bar is gated on THAT one, not on the wider name */
    expect(TICKET_CHAT).toContain('anyTrayOpen={trayPanelOpen}');
  });

  it('⭐⭐⭐ clicking it closes every tray, not just one', () => {
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    expect(bar.slice(0, i)).toContain('onClick={closeAllTrays}');
    const fn = TICKET_CHAT.match(/const\s+closeAllTrays\s*=\s*\(\)\s*=>\s*\{([^}]*)\}/)![1];
    for (const setter of ['setShowEmoji(false)', 'setShowStickers(false)', 'setShowQuickReply(false)']) {
      expect(fn).toContain(setter);
    }
  });
});

describe('3. its size is FIXED — no font scale, no tray override, reaches it', () => {
  it('⭐⭐⭐ it carries the scale-pinning class', () => {
    const bar = toolbar();
    const i = bar.indexOf('trayCloseLabel');
    expect(bar.slice(bar.lastIndexOf('<button', i), i)).toContain('tc-fixed-scale-1');
  });

  it('⭐⭐⭐ that class really pins the multiplier to 1', () => {
    const rule = INDEX_CSS.match(/\.tc-fixed-scale-1[^{]*\{[^}]*\}/)?.[0];
    expect(rule, 'index.css must define the pin').toBeTruthy();
    expect(rule as string).toMatch(/--tc-chat-scale:\s*1\s*;/);
    /* No `!important` — `chatFontScale.value.test.ts` pins that this CSS block
       stays out of the escalation war, and it is not needed: the ancestor value
       reaches the button only by INHERITANCE, which any rule matching the
       element itself outranks. Asserted so the two contracts cannot drift. */
    expect(rule as string).not.toContain('!important');
  });

  it('the pin reaches the button CONTENTS too — the icon is a descendant', () => {
    // scaling is applied by `.tc-col-center svg { width: calc(1em * var(...)) }`,
    // which matches the <X/> inside the button, not the button itself
    const rule = INDEX_CSS.match(/\.tc-fixed-scale-1[\s\S]{0,120}?\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/\.tc-fixed-scale-1\s*\*/);
  });

  it('it is outside the trays, so no tray override can inflate it', () => {
    // the trays paint their own --tc-chat-scale; being in the toolbar is what
    // structurally keeps the button out of that subtree
    for (const flag of ['showEmoji', 'showStickers', 'showQuickReply']) {
      const start = TICKET_CHAT.indexOf(`{${flag} && (`);
      expect(start).toBeGreaterThan(-1);
      const end = TICKET_CHAT.indexOf('\n        )}', start);
      expect(TICKET_CHAT.slice(start, end)).not.toContain('trayCloseLabel');
    }
  });

  it('the trays keep their own fixed-scale overrides — this fix undoes none', () => {
    expect(TICKET_CHAT).toContain('STICKER_TRAY_FIXED_SCALE');
    expect(TICKET_CHAT).toContain('EMOJI_TRAY_FIXED_SCALE');
  });
});

describe('4. the old in-panel close buttons are gone, component included', () => {
  it('⭐⭐⭐ no tray renders a PanelCloseButton any more', () => {
    expect(TICKET_CHAT).not.toContain('<PanelCloseButton');
    expect(TICKET_CHAT).not.toContain("from '../../components/chat/PanelCloseButton'");
  });

  it('the sticky close strips are gone from the panels', () => {
    expect(TICKET_CHAT).not.toContain('sticky top-0 z-10 -mt-2 -mx-2 mb-1 flex justify-end');
  });

  it('⭐⭐ the component file is deleted — it had no other users', () => {
    expect(existsSync(at('../components/chat/PanelCloseButton.tsx'))).toBe(false);
  });
});

describe('5. the new label is translated', () => {
  it('en + th both carry ticket.tray_close', () => {
    expect(typeof EN['ticket.tray_close']).toBe('string');
    expect(EN['ticket.tray_close'].length).toBeGreaterThan(0);
    expect(typeof TH['ticket.tray_close']).toBe('string');
    expect(TH['ticket.tray_close'].length).toBeGreaterThan(0);
  });

  it('the label is passed down to ChatInputBox from every mount', () => {
    const passes = TICKET_CHAT.match(/trayCloseLabel=\{t\('ticket\.tray_close'\)\}/g) ?? [];
    // the composer is mounted twice (the closed-case view and the live one)
    expect(passes.length).toBe(2);
  });
});
