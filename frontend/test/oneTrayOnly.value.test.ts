/**
 * [FIX-20260830-ONETRAYONLY] only one composer tray may be open at a time.
 *
 * 🔴 Owner 30/08: *"ตอบด่วน กับ สติกเกอร์ห้ามเปิดพร้อมกัน มันต้องปิดอีกอันนึงทันที"*.
 *    Each opener closed only the trays it happened to remember: the emoji and
 *    sticker buttons cleared each other but NOT quick replies, so leaving
 *    "ตอบด่วน" open and pressing the sticker button stacked two panels.
 *
 * The fix routes every opener through one helper. These tests pin BOTH halves —
 * the helper's behaviour AND that no call site bypasses it — because the bug was
 * not in the logic, it was in one call site being written from memory.
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

const SRC = ticketChatSource();
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const CODE = stripComments(SRC);

describe('one helper owns the rule', () => {
  it('the helper exists and takes which tray to toggle', () => {
    expect(CODE).toMatch(/const toggleTray = \(which: 'emoji' \| 'sticker' \| 'quick'\)/);
  });

  it('it sets ALL THREE flags on every call — none may be left untouched', () => {
    const at = CODE.indexOf('const toggleTray');
    const body = CODE.slice(at, CODE.indexOf('};', at));
    ['setShowEmoji(', 'setShowStickers(', 'setShowQuickReply('].forEach((fn) =>
      expect(body).toContain(fn),
    );
  });

  it('opening one closes the other two — the flags are exclusive by construction', () => {
    const at = CODE.indexOf('const toggleTray');
    const body = CODE.slice(at, CODE.indexOf('};', at));
    // each setter is driven by an equality against `which`, never by a toggle
    expect(body).toMatch(/setShowEmoji\(!wasOpen && which === 'emoji'\)/);
    expect(body).toMatch(/setShowStickers\(!wasOpen && which === 'sticker'\)/);
    expect(body).toMatch(/setShowQuickReply\(!wasOpen && which === 'quick'\)/);
  });

  it('pressing the OPEN one closes it — it is still a toggle', () => {
    const at = CODE.indexOf('const toggleTray');
    const body = CODE.slice(at, CODE.indexOf('};', at));
    expect(body).toMatch(/wasOpen[\s\S]{0,200}showEmoji/);
    expect(body).toMatch(/wasOpen[\s\S]{0,200}showStickers/);
    expect(body).toMatch(/wasOpen[\s\S]{0,200}showQuickReply/);
  });
});

describe('🔴 no opener bypasses the helper — this is where the bug lived', () => {
  /** Every onClick that flips a tray flag. */
  const trayClicks = (): string[] =>
    (CODE.match(/onClick=\{[^}]*setShow(Emoji|Stickers|QuickReply)\([^}]*\}/g) ?? []);

  it('no button toggles a tray flag directly any more', () => {
    /* `setShowEmoji(v => !v)` in a handler is exactly the shape that forgot
       about quick replies. Insertion handlers that only CLOSE a tray are fine —
       those are matched out below. */
    const toggles = trayClicks().filter((h) => /=> !v|v => !v/.test(h));
    expect(toggles).toEqual([]);
  });

  it('the three toolbar buttons all call toggleTray', () => {
    expect(CODE).toContain("onClick={() => toggleTray('emoji')}");
    expect(CODE).toContain("onClick={() => toggleTray('sticker')}");
    expect(CODE).toContain("onClick={() => toggleTray('quick')}");
  });

  it('the secondary sticker entry point goes through it too', () => {
    // a second way into the sticker tray existed and had its own hand-written
    // pair of setters — the exact class of omission this file guards
    expect(CODE).not.toContain('setShowStickers(true); setShowEmoji(false);');
    expect(CODE).toMatch(/if \(!showStickers\) toggleTray\('sticker'\)/);
  });
});

describe('closing everything is still possible', () => {
  it('closeAllTrays still clears all three', () => {
    const at = CODE.indexOf('const closeAllTrays');
    const body = CODE.slice(at, at + 220);
    expect(body).toContain('setShowEmoji(false)');
    expect(body).toContain('setShowStickers(false)');
    expect(body).toContain('setShowQuickReply(false)');
  });

  it('picking an emoji KEEPS its tray open; a quick reply still closes its own', () => {
    /* [FEAT-20260830-EMOJISTAY] owner 30/08: emoji are picked continuously, so
       insertEmoji no longer closes the tray. Quick replies insert one message
       and close as before. */
    expect(CODE).not.toMatch(/setDraft\([\s\S]{0,80}setShowEmoji\(false\)/);
    expect(CODE).toMatch(/setShowQuickReply\(false\)/);
  });
});
