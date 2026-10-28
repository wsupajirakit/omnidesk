/**
 * [FEAT-20260908-AITRANSLATE] the feature is OPTIONAL — pinned by reading the
 * source, because the things that matter here are absences.
 * ===========================================================================
 * Owner, 09/09: *"ส่วนการแปลไม่แปล ไม่ได้บังคับที่หน้า FE นะ optional เผื่อแอดมิน
 * ไม่อยากแปล"* — and D8: the ticket-chat screen is the ONLY screen that gets this
 * round. `ChatRoomView` is shared by four pages, so three of them must come out
 * of this work byte-identical **with no edits to those files at all**.
 *
 * ⚠️ WHY SOURCE-READING AND NOT ONLY RENDERING. Every guarantee below is about
 * something NOT being there: no prop passed by three pages, no service call
 * inside a shared component, no second reader of a switch, no cache added to a
 * file whose header forbids one. A render test proves what a screen does today;
 * it cannot prove that a future edit did not quietly add a call. These read the
 * code. เทสสิ่งที่ "ต้องไม่มี" ต้องอ่านโค้ด ไม่ใช่ดูหน้าจอ.
 *
 * The runtime half lives in `chatTranslateBubble.dom.test.tsx` (the chip really
 * appears, the picker really lists, opening a room really fires nothing) and the
 * byte-identity half in `chatBubbleCharacterization.dom.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import th from '../i18n/translations/th.json';
import en from '../i18n/translations/en.json';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** code with comments stripped — the prose below legitimately names the things
 *  these tests assert are absent, and matching the raw file would fail on the
 *  explanation rather than on the code. Same trick `contactChatTab` uses. */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const VIEW = src('components/chat/ChatRoomView.tsx');
const VIEW_CODE = codeOnly(VIEW);

/* The three pages that share `ChatRoomView` and must not change. TicketChat is
   deliberately NOT in this list — it is the one screen that gets the feature. */
const UNTOUCHED_PAGES = [
  'pages/chat/Chat.tsx',
  'pages/chat/Contact.tsx',
  'pages/chat/TicketSupport.tsx',
];

describe('[AITRANSLATE] ⭐⭐⭐ the three shared pages were not edited and cannot see the feature', () => {
  it.each(UNTOUCHED_PAGES)('%s never mentions the translate seam', (page) => {
    /* If this ever fails, someone passed `onTranslate` from a page that was
       supposed to stay exactly as it was — the chip would appear on a screen the
       owner did not ask for, and every press there is a billed AI call. */
    const code = codeOnly(src(page));
    expect(code).not.toContain('onTranslate');
    expect(code).not.toContain('BubbleTranslateButton');
    expect(code).not.toContain('LanguagePicker');
    expect(code).not.toContain('TranslatedBubble');
  });

  it('⭐⭐⭐ and the component gates EVERYTHING on the prop those pages do not pass', () => {
    // the chip
    expect(VIEW_CODE).toContain('SHOW_BUBBLE_TRANSLATE_BUTTON && onTranslate &&');
    // the picker
    expect(VIEW_CODE).toMatch(/onTranslate && langPickerFor === String\(msg\._id\)/);
    // the two-layer body itself
    expect(VIEW_CODE).toMatch(/onTranslate \? activeTranslation\(msg\.translations\) : null/);
  });
});

describe('[AITRANSLATE] ⭐⭐⭐ ChatRoomView still acts on nothing', () => {
  it('⭐⭐⭐ it calls no translate service and no field-options service itself', () => {
    /* `test/contactChatTab.dom.test.tsx` proves the read-only Contact tab cannot
       SEND, structurally: there is no call inside the component it renders. This
       feature must not be the thing that breaks that property. The chip hands a
       target to a handler the PAGE passed in; the picker's fetch lives inside
       `LanguagePicker`, which only mounts after a press. */
    expect(VIEW_CODE).not.toMatch(/chatService\s*\.\s*sendReply\s*\(/);
    expect(VIEW_CODE).not.toContain('fieldOptionsService');
    expect(VIEW_CODE).not.toContain('useFieldOptions');
    expect(VIEW_CODE).not.toMatch(/translate\w*Service\s*\./);
  });

  it('⭐⭐ the handler fires from a PRESS, never from a mount or an effect', () => {
    /* The rule has not changed: a translation must be something a person asked
       for. What changed is the shape — `onTranslate` is now reached through the
       memoised `executeTranslate`, which the bubble picker, the composer and the
       "translate latest" button all share, instead of being called inline at one
       JSX site. So the assertion moved with it: ONE call site, and it is inside
       `executeTranslate`, which no effect invokes.

       [FIX-20260918-NOBROWSERAUTO] this case used to fail against `dev`: the
       18/09 work added a call inside `appendMessage`, a websocket handler, which
       is exactly the "on every message" this test exists to forbid. That block is
       gone — the backend translates inbound now — so the rule holds again.
       แปลต้องเกิดจากการกด ไม่ใช่จาก effect */
    const calls = VIEW_CODE.split(/onTranslate\(/).length - 1;
    expect(calls).toBe(1);

    const at = VIEW_CODE.indexOf('onTranslate(');
    const before = VIEW_CODE.slice(Math.max(0, at - 800), at);
    expect(before).toContain('const executeTranslate = useCallback(');

    /* and nothing schedules it: no effect may mention the shared runner. */
    for (const block of VIEW_CODE.split('useEffect(')) {
      const body = block.slice(0, block.indexOf('}, ['));
      expect(body).not.toContain('executeTranslate(');
    }
  });
});
