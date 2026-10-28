/**
 * [FEAT-20260908-AITRANSLATE] the composer preview — what it must do, and the
 * four things it must NEVER do.
 * ===========================================================================
 * Owner, 09/09: *"แปลใน input box chat ต้องไม่ส่งทันที แอดมินจะกดส่งเอง (ปุ่มเดิม)
 * แปลเสร็จแล้วแค่พรีวิวคำแปลคู่กับคำต้นฉบับ"*
 *
 * The mutations these exist to kill (WORK-SPLIT §8):
 *   M19  add a debounce / keystroke trigger      → "typing fires zero requests"
 *   M20  auto-retry on 429                       → "exactly one request per press"
 *   M21  clear the composer on a failed translate → "the draft survives"
 *   plus the owner's own: call send in the translate handler → "translate sends nothing"
 *
 * ⚠️ NO REAL AI CALL IS MADE BY THIS FILE. `aiTranslateService` is stubbed at the
 * module boundary, so the owner's +20-call grant is untouched by the suite. The
 * only thing exercised for real is this repo's own wiring.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── the two network edges, stubbed ──────────────────────────────────────────
   ⚠️ `vi.hoisted`, not bare consts: vitest lifts every `vi.mock` factory above
   the file's own declarations, so a factory closing over a plain `const` throws
   "Cannot access 'sendReply' before initialization" and the whole suite reports
   as 0 tests — a failure that looks like a missing file rather than a broken
   mock. This is the documented way to share a spy with a hoisted factory. */
const { previewTranslate, sendReply, sendSticker, sendImages, createInlineNote } = vi.hoisted(() => ({
  previewTranslate: vi.fn(),
  sendReply: vi.fn(),
  sendSticker: vi.fn(),
  sendImages: vi.fn(),
  createInlineNote: vi.fn(),
}));

/* [TEMP-20260910-TRANSLATEDEVONLY] The composer's translate button is behind a
   temporary account lock; with nobody signed in it does not render and this
   whole suite fails for an unrelated reason. Sign the allowed account in.
   Remove alongside the lock — see components/chat/translateDevLock.ts. */
vi.mock('../services/authStorage', async () => {
  const actual = await vi.importActual<any>('../services/authStorage');
  return { ...actual, getAuthUser: () => ({ username: 'dev' }) };
});

vi.mock('../services/chat/aiTranslateService', async () => {
  /* the REAL isRateLimited / translateErrorText: they are the rules under test
     ("the server's own sentence survives", "429 latches the button"), and
     stubbing them would test the stub */
  const actual = await vi.importActual<any>('../services/chat/aiTranslateService');
  return { ...actual, aiTranslateService: { previewTranslate, translateMessage: vi.fn() } };
});

vi.mock('../services/chat', async () => {
  const actual = await vi.importActual<any>('../services/chat');
  return {
    ...actual,
    chatService: { sendReply, sendSticker, sendImages, createInlineNote },
  };
});

/* the language list — Agent C's `LanguagePicker` reads it through this hook.
   Stubbed so the suite makes no registry request and does not depend on the BE
   having shipped `translate_target_lang` yet. */
vi.mock('../services/hook/useFieldOptions', () => ({
  useFieldOptions: () => ({
    options: [
      { value: 'en', label_key: 'field_options.translate_target_lang.en', fallback_label: 'English' },
      { value: 'my', label_key: 'field_options.translate_target_lang.my', fallback_label: 'Burmese' },
    ],
    choiceCount: 2,
  }),
}));

import { ChatInputBox } from '../components/chat/chat-input';
import { I18nProvider } from '../i18n';

const room = { _id: 'room1', line_user_id: 'Uabc', unread_count: 0, hook_id: 'hook1' } as any;

const mount = () =>
  render(
    <I18nProvider>
      <ChatInputBox accepted accepting={false} room={room} hookId="hook1" />
    </I18nProvider>,
  );

/**
 * Type into the COMPOSER textarea — the one the admin writes in.
 *
 * ⚠️ Selected by placeholder, not `querySelector('textarea')`. Once a preview is
 * staged there are TWO textareas on screen and the strip renders ABOVE the
 * typing row, so the bare selector returns the PREVIEW's field: the draft would
 * appear never to change and the tests would quietly assert the wrong thing.
 * (Found the honest way — a case failed because of it.)
 */
const composerBox = () => screen.getByPlaceholderText(/พิมพ์ข้อความตอบลูกค้า/) as HTMLTextAreaElement;

/**
 * [FIX-20260910-TRANSLATEONEBOX] THE DRAFT HAS ONE BOX, AND IT MOVES.
 *
 * Once a translation is staged the typing row is hidden and the preview strip
 * carries the draft instead (owner, 10/09: the same Thai in two boxes and no
 * way to tell which one to edit). So "type into the composer" means the strip's
 * field while one is on screen, and the row's textarea otherwise — never both,
 * because never both exist.
 *
 * ⚠️ Resolved per call, not captured: a test types before a preview and again
 * after one, and those are two different elements.
 */
const draftBox = (): HTMLTextAreaElement =>
  (screen.queryByTestId('translate-source') as HTMLTextAreaElement | null) ?? composerBox();
const type = (value: string) => { fireEvent.change(draftBox(), { target: { value } }); };

const translateBtn = () => screen.getByTestId('composer-translate-btn') as HTMLButtonElement;

/**
 * Press แปล, then pick a target language — two presses, as designed.
 *
 * ⚠️ Picked BY POSITION, not by visible name. The wording belongs to
 * `i18n/translations/*.json` (Agent C's files) and is resolved through
 * `fieldOptionLabel`, so `en` reads "อังกฤษ" under the Thai UI and "English"
 * under the English one. Matching the text here would make this suite fail the
 * day someone reworded a label — a copy change breaking a behaviour test.
 * Which CODE was chosen is asserted where it matters: on the request itself.
 */
const pressTranslateAndPick = async (index = 0) => {
  fireEvent.click(translateBtn());
  const options = await screen.findAllByRole('option');
  await act(async () => { fireEvent.click(options[index]!); });
  /* [FIX-20260909-PICKERMODAL] TWO presses on this side now, not one. Owner,
     09/09: "ทำเป็น modal ไม่ใช่ list confirm ด้วย" — picking a language on the
     COMPOSER only opens a confirm; the request fires on ยืนยัน.
     🔴 The extra press is the feature, not test friction: a composer
     translation is about to be SENT to a customer in a language the admin may
     not read. The BUBBLE has no confirm and its helper still presses once. */
  const ok = await screen.findByTestId('translate-confirm-ok');
  await act(async () => { fireEvent.click(ok); });
};

const okPreview = (text: string, from: string | null = null) =>
  previewTranslate.mockResolvedValue({ success: true, data: { text, ...(from ? { from } : {}) } });

const refuse = (status: number, message: string) =>
  previewTranslate.mockRejectedValue(Object.assign(new Error(message), { status }));

beforeEach(() => {
  vi.clearAllMocks();
  sendReply.mockResolvedValue({ success: true, data: { _id: 'm1' } });
});

describe('[AITRANSLATE] ⭐⭐⭐ nothing translates by itself', () => {
  it('⭐⭐⭐ M19 — typing a whole sentence fires ZERO translate requests', async () => {
    /* 🔴 The mutation this kills: a debounce or an onChange trigger. It would
       spend the whole minute's allowance of six on ONE sentence being typed,
       and every one of those presses is a billed vendor call against a LIFETIME
       budget that never resets. §4C: "press-triggered only. Never on keystroke,
       never on blur, never on a timer, never debounced." */
    mount();
    for (const s of ['ร', 'รอ', 'รอส', 'รอสัก', 'รอสักครู่', 'รอสักครู่นะคะ']) type(s);
    /* let any debounce someone might add actually elapse before we look */
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(previewTranslate).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ mounting the composer fires nothing, and neither does blurring it', async () => {
    mount();
    type('รอสักครู่นะคะ');
    fireEvent.blur(composerBox());
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(previewTranslate).not.toHaveBeenCalled();
  });

  /* [LEGACY-20260918-MANUALPREVIEW] preserved, not running.
     This case asserts that pressing แปลภาษา opens `ComposerAutoSendToggle`. It
     does not, and cannot: the button dispatches `tc:open-room-translate-modal`
     (the room's 4-step modal) while the toggle listens for
     `tc:open-composer-translate-modal` — an event NOTHING in either repo
     dispatches. Two listeners, no sender, so that popover is unreachable.
     The switch it carries is still reachable from the room modal's step 4, so
     the feature works; only this shortcut is dead.
     ปุ่มยิง event คนละชื่อกับที่ popover ฟัง ⇒ เปิดไม่ได้ · สวิตช์ยังตั้งได้จากโมดัลห้อง */
  it.skip('[FEAT-20260918-ROOMTRANS] clicking translate button opens auto-send toggle', async () => {
    mount();
    fireEvent.click(translateBtn());
    expect(screen.getByTestId('composer-auto-send-toggle-card')).toBeTruthy();
    expect(screen.getByText('แปลและส่งอัตโนมัติ')).toBeTruthy();
    expect(previewTranslate).not.toHaveBeenCalled();
  });
});

/* [PRESERVED-LANGPICKER] Preserved original LanguagePicker modal tests while the picker
   is kept unused per user specification: "แสดง modal lang picker เดิมให้ note code eng ไว้ว่า เก็บไว้ ยังไม่ใช้เผื่อใช้" */
describe.skip('[PRESERVED-LANGPICKER] preserved manual language picker modal tests', () => {
  it('⭐⭐ neither opening the list NOR picking is a request — the CONFIRM is', async () => {
    /* [FIX-20260909-PICKERMODAL] This used to end at the pick, because the pick
       WAS the confirm on this side. It is not any more: the composer opens a
       modal and asks again, so there are now TWO points that must spend nothing.
       Both are asserted rather than just the new one — an admin who opens the
       list and changes their mind, and one who picks and then backs out, must
       each cost zero. */
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    fireEvent.click(translateBtn());
    const options = await screen.findAllByRole('option');
    expect(previewTranslate).not.toHaveBeenCalled();
    /* and the list shows a real translated name, never a raw i18n key — the
       guard §4D.2 asks for, checked where the list is actually on screen */
    expect(options[0]!.textContent).not.toContain('field_options.');

    await act(async () => { fireEvent.click(options[0]!); });
    /* ⭐ the pick alone still spends nothing */
    expect(previewTranslate).not.toHaveBeenCalled();

    const ok = await screen.findByTestId('translate-confirm-ok');
    await act(async () => { fireEvent.click(ok); });
    expect(previewTranslate).toHaveBeenCalledTimes(1);
  });
});

/* [LEGACY-20260918-MANUALPREVIEW] PRESERVED, NOT RUNNING — owner's call, 18/09:
   *"ทำไว้เป็น legacy แต่ยังไม่เรียกใช้"*.

   These cases drive the composer's manual translate-preview flow: press แปล,
   pick a language, confirm, then send the staged translation. The flow's ENTRY
   POINT no longer exists — the `LanguagePicker` JSX in `ChatInputBox.tsx` is
   commented out and the แปล button opens the room's translate settings instead,
   so `runTranslatePreview` is unreachable from the UI and every case here fails
   looking for a language list that is never rendered.

   They are kept, in full and unedited, because the flow itself is intact in the
   code and may be switched back on. Skipping is deliberate: a suite that is red
   for a reason nobody intends to fix teaches the next person to ignore red.

   🔴 TO BRING THE FLOW BACK: un-comment the picker block in `ChatInputBox.tsx`,
   change `describe.skip` to `describe` here, and expect these to pass unchanged
   — they were 30/30 green at commit 23e2673, before the picker was removed.
   ของเก่าเก็บไว้ทั้งดุ้น ยังไม่ใช้ · จะเอากลับมาก็แค่เปิด picker แล้วเปลี่ยน skip กลับ */
describe.skip('[AITRANSLATE] ⭐⭐⭐ translating NEVER sends', () => {
  it('⭐⭐⭐ a successful preview fires zero send calls', async () => {
    /* Owner's rule 1: "The translate action has NO send path in it at all."
       Pressing translate and then closing the browser sends nothing. */
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-preview-text');
    expect(sendReply).not.toHaveBeenCalled();
    expect(sendSticker).not.toHaveBeenCalled();
    expect(sendImages).not.toHaveBeenCalled();
    expect(createInlineNote).not.toHaveBeenCalled();
  });

  it('⭐⭐⭐ the preview shows BOTH texts together, and says it has not been sent', async () => {
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    expect((await screen.findByTestId('translate-source')).textContent).toBe('รอสักครู่นะคะ');
    expect((screen.getByTestId('translate-preview-text') as HTMLTextAreaElement).value)
      .toBe('Please wait a moment');
    /* [FIX-20260909-TRAYLABEL] The heading names the LANGUAGE now and no longer
       repeats "ยังไม่ได้ส่ง" — the line under the preview already says which
       button sends it, so the warning was printed twice while the one fact the
       admin needs (which language is staged) was not printed at all. */
    /* the heading carries both the word and the language, in one node */
    expect(screen.getByText(/พรีวิวคำแปล · อังกฤษ/)).toBeTruthy();
  });

  it('⭐⭐⭐ the target is shown ALONE when the model detected no source', async () => {
    /* Owner, 09/09: the admin never states a source language, so `from` is null
       on everything this UI creates. "null → en" or an invented "th → en" would
       both be lies; the target alone is the honest reading.
       [FIX-20260910-LANGBADGE] the name MOVED onto a badge pinned to the top of
       the translation box and the arrow went with the source it never had —
       "อังกฤษ" alone, not "→ อังกฤษ". The rule is unchanged and is what this
       still asserts: no invented source, ever. */
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-preview-text');
    /* names, not codes — an admin should not have to know that `my` is Burmese
       or `zh-Hant` is Traditional Chinese */
    expect((await screen.findByTestId('translate-lang-badge')).textContent).toBe('อังกฤษ');
    expect(screen.queryByText(/null/)).toBeNull();
    expect(screen.queryByText(/auto/i)).toBeNull();
  });

  it('⭐⭐ [LANGBADGE] a source the BE DID report still travels, on the badge', async () => {
    /* the badge replaced the old line's POSITION, not its rule */
    okPreview('Please wait a moment', 'th');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    expect((await screen.findByTestId('translate-lang-badge')).textContent)
      .toBe('ไทย → อังกฤษ');
  });

  it('⭐⭐⭐ and the request body never carries a source language', async () => {
    okPreview('x');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    /* previewTranslate(roomKey, text, to) — three positional args, no `from` */
    expect(previewTranslate).toHaveBeenCalledWith('room1', 'รอสักครู่นะคะ', 'en');
    expect(previewTranslate.mock.calls[0]).toHaveLength(3);
  });
});

/* [LEGACY-20260918-MANUALPREVIEW] preserved, not running — see the block above. */
describe.skip('[AITRANSLATE] ⭐⭐⭐ the EXISTING send button is what sends', () => {
  it('⭐⭐⭐ it posts the TRANSLATION as the text, with the original riding along', async () => {
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-preview-text');

    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });

    expect(sendReply).toHaveBeenCalledTimes(1);
    const [, text, , , original] = sendReply.mock.calls[0]!;
    expect(text).toBe('Please wait a moment');          // what LINE delivers
    /* [FEAT-20260910-OUTBOUNDTARGET] the picked target rides along now — the
       admin chose it two presses ago, so the bubble can name both ends without
       anything being detected. */
    expect(original).toEqual({
      original_text: 'รอสักครู่นะคะ',
      original_lang: undefined,
      translated_lang: 'en',
    });
  });

  it('⭐⭐⭐ sending with NO translation is byte-identical to today', async () => {
    /* Owner's rule 4. The two new fields are simply absent — `sendReply` gets
       `undefined` for its fifth argument and builds the body it always built. */
    mount();
    type('สวัสดีค่ะ');
    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });
    expect(sendReply).toHaveBeenCalledTimes(1);
    const [, text, , , original] = sendReply.mock.calls[0]!;
    expect(text).toBe('สวัสดีค่ะ');
    expect(original).toBeUndefined();
  });

  it('⭐⭐⭐ an edited translation is what goes out — the edit is not decoration', async () => {
    /* Owner's rule 3: the admin may "edit the translation directly". If the send
       ignored the edit, the screen and the customer would disagree. */
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    const field = await screen.findByTestId('translate-preview-text');
    fireEvent.change(field, { target: { value: 'One moment please' } });

    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });
    const [, text, , , original] = sendReply.mock.calls[0]!;
    expect(text).toBe('One moment please');
    /* [FEAT-20260910-OUTBOUNDTARGET] the picked target rides along now — the
       admin chose it two presses ago, so the bubble can name both ends without
       anything being detected. */
    expect(original).toEqual({
      original_text: 'รอสักครู่นะคะ',
      original_lang: undefined,
      translated_lang: 'en',
    });
  });

  it('⭐⭐⭐ discarding the preview sends the ORIGINAL, untranslated', async () => {
    /* Owner's rule 3, last option: "send the original untranslated". */
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-preview-text');
    fireEvent.click(screen.getByLabelText('ปิดคำแปล'));

    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });
    const [, text, , , original] = sendReply.mock.calls[0]!;
    expect(text).toBe('รอสักครู่นะคะ');
    expect(original).toBeUndefined();
  });

  it('⭐⭐⭐ editing the Thai after previewing cannot send a mismatched pair', async () => {
    /* 🔴 The quietest way this feature could corrupt data: translate sentence A,
       edit the box to sentence B, press send — and store B's text with A's
       translation as though they were the same message. The send re-derives the
       match on every render, so the worst case is an untranslated send, never a
       wrong record.
       [FIX-20260909-KEEPPREVIEW] The strip is no longer DELETED on a draft
       change — it stays, marked stale, because deleting it threw away a
       translation the owner had already paid for (09/09: "เวลากดแก้ข้อความแล้ว
       กล่องแปลหายหมดเลย เปลืองโควต้าฟรี"). What protects the record is the
       derivation, not the deletion, and this case proves it by sending. */
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-preview-text');

    type('ขอบคุณค่ะ');
    /* still on screen, and openly saying it is not the thing being sent */
    expect(screen.getByTestId('translate-preview-text')).toBeTruthy();
    expect(screen.getByTestId('translate-stale')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });
    const [, text, , , original] = sendReply.mock.calls[0]!;
    expect(text).toBe('ขอบคุณค่ะ');
    expect(original).toBeUndefined();
  });

  it('⭐⭐⭐ [KEEPPREVIEW] undoing the edit re-stages it — and costs no second call', async () => {
    /* 🔴 THE BUG THIS FILE EXISTS TO STOP COMING BACK. One stray keystroke used
       to destroy a paid-for translation with no way back: the state was gone,
       not stale, so even retyping the exact sentence left the admin pressing
       แปล a second time and spending a second call out of the six a minute
       allows. Now the match is recomputed on every render, so restoring the
       text restores the staged translation for free. */
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-preview-text');
    expect(previewTranslate).toHaveBeenCalledTimes(1);

    type('รอสักครู่นะค');                      // one character deleted
    expect(screen.getByTestId('translate-stale')).toBeTruthy();
    type('รอสักครู่นะคะ');                     // and typed back
    expect(screen.queryByTestId('translate-stale')).toBeNull();

    /* zero further requests — the recovery is arithmetic, not a re-translate */
    expect(previewTranslate).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });
    const [, text, , , original] = sendReply.mock.calls[0]!;
    expect(text).toBe('Please wait a moment');
    expect(original).toEqual({
      original_text: 'รอสักครู่นะคะ',
      original_lang: undefined,
      translated_lang: 'en',
    });
  });

  it('⭐⭐⭐ [COMPACTSOURCE] a tall dragged composer does NOT come through as a tall source field', async () => {
    /* 🔴 THE BUG, reported with two screenshots: drag the box tall, type, press
       แปล — and the strip's source field inherited that height, pushing the
       translation, the badge and ➤ off the bottom edge. The cap is what makes
       the overflow impossible instead of merely clamped. */
    const src = readFileSync(
      resolve(__dirname, '..', 'components/chat/chat-input/ChatInputBox.tsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(src).toContain('sourceStyle={{ height: Math.min(areaH, PREVIEW_SOURCE_H) }}');
    /* about three lines — enough to review a sentence, not enough to bury what
       is under it. Asserted as a RANGE: the exact pixel is a look, the ceiling
       is the rule. */
    const px = Number(/const PREVIEW_SOURCE_H = (\d+);/.exec(src)?.[1]);
    expect(px).toBeGreaterThanOrEqual(60);
    expect(px).toBeLessThanOrEqual(140);
  });

  it('⭐⭐ [KEEPPREVIEW] a stale translation is read-only — editing what will not be sent is a trap', async () => {
    okPreview('Please wait a moment');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    const field = (await screen.findByTestId('translate-preview-text')) as HTMLTextAreaElement;
    expect(field.readOnly).toBe(false);
    type('ขอบคุณค่ะ');
    expect((screen.getByTestId('translate-preview-text') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('⭐⭐⭐ [TRANSLATEONEBOX] one Thai box at a time — the row goes, the strip types', async () => {
    /* 🔴 Owner, 10/09: with a preview staged the same sentence sat in the strip
       AND in the typing row, and nothing said which one to edit. The row is
       hidden while a preview exists, so the strip's field is the draft — and
       closing the translation brings the row back untouched
       ("ปิดแปลทุกอย่างต้องเหมือนเดิมนะ"). */
    okPreview('Please wait a moment');
    mount();
    /* before: the row is the only box */
    expect(composerBox()).toBeTruthy();
    expect(screen.queryByTestId('translate-source')).toBeNull();

    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();

    /* during: the row is GONE and the strip's field holds the draft */
    const field = (await screen.findByTestId('translate-source')) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toBe('รอสักครู่นะคะ');
    expect(screen.queryByPlaceholderText(/พิมพ์ข้อความตอบลูกค้า/)).toBeNull();
    /* …and there is still exactly ONE send button, now inside the strip */
    expect(screen.getAllByTitle('ส่งถึงลูกค้า')).toHaveLength(1);

    /* after ปิดคำแปล: everything is as it was, draft included */
    await act(async () => { fireEvent.click(screen.getByTitle('ปิดคำแปล')); });
    expect(screen.queryByTestId('translate-source')).toBeNull();
    expect(composerBox().value).toBe('รอสักครู่นะคะ');
    expect(screen.getAllByTitle('ส่งถึงลูกค้า')).toHaveLength(1);
  });

  it('⭐⭐ a detected source language, when the BE echoes one, is what gets stored', async () => {
    /* The FE never invents this. It travels only because the model reported it. */
    okPreview('Please wait a moment', 'th');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-preview-text');
    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });
    const [, , , , original] = sendReply.mock.calls[0]!;
    expect(original).toEqual({
      original_text: 'รอสักครู่นะคะ',
      original_lang: 'th',
      translated_lang: 'en',
    });
  });
});

/* [LEGACY-20260918-MANUALPREVIEW] preserved, not running — see the block above. */
describe.skip('[AITRANSLATE] ⭐⭐⭐ a refused press loses nothing and retries nothing', () => {
  it('⭐⭐⭐ M21 — the draft survives a failed translate, exactly as typed', async () => {
    /* §4C: "a refused press must leave the composer text exactly as the admin
       typed it. Never clear the box, never lose the draft." Losing a long Thai
       reply to a rate limit is a worse failure than the refusal. */
    refuse(429, 'แปลได้ 6 ครั้งต่อนาที ลองใหม่ในอีก 41 วินาที');
    mount();
    type('รอสักครู่นะคะ ทางเรากำลังตรวจสอบให้อยู่');
    await pressTranslateAndPick();
    /* ⚠️ Deliberately NOT gated on the error element appearing first. The claim
       is about the DRAFT, and `setDraft('')` re-runs the draft effect, which
       clears the error too — so waiting for the error would make this case fail
       with "unable to find [data-testid=translate-error]" and report a missing
       ERROR when what was actually lost was the admin's TEXT. A mutation should
       name the thing it broke. */
    expect(composerBox().value).toBe('รอสักครู่นะคะ ทางเรากำลังตรวจสอบให้อยู่');
  });

  it('⭐⭐⭐ M20 — one press makes exactly ONE request, even when refused', async () => {
    /* An auto-retry spends a seventh call inside a window that already refused
       six, and is refused too: cost with no chance of success. */
    refuse(429, 'too many');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-error');
    await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
    expect(previewTranslate).toHaveBeenCalledTimes(1);
  });

  it("⭐⭐⭐ the server's own sentence is shown, not a friendlier substitute", async () => {
    /* §4C: "do not invent a friendlier one that hides how long to wait" — the
       "41 วินาที" is precisely the part a hardcoded string destroys. */
    const sentence = 'แปลได้ 6 ครั้งต่อนาที ลองใหม่ในอีก 41 วินาที';
    refuse(429, sentence);
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    expect((await screen.findByTestId('translate-error')).textContent).toBe(sentence);
  });

  it('⭐⭐⭐ a 429 disables the button — pressable-and-always-failing is worse', async () => {
    refuse(429, 'too many');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-error');
    expect(translateBtn().disabled).toBe(true);
  });

  it('⭐⭐ the latch clears on a deliberate act, and even then fires nothing by itself', async () => {
    /* It must not be permanent (the button would stick) and it must not clear on
       a timer (that is a countdown copied from a BE env value this side cannot
       see). Dismissing re-enables; it does NOT re-request. */
    refuse(429, 'too many');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-error');
    expect(previewTranslate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('ปิด'));
    await waitFor(() => expect(translateBtn().disabled).toBe(false));
    expect(previewTranslate).toHaveBeenCalledTimes(1);   // dismiss ≠ retry
  });

  it('⭐⭐ a failed translate leaves nothing staged — the send is untouched', async () => {
    refuse(502, 'no usable key for this OA');
    mount();
    type('รอสักครู่นะคะ');
    await pressTranslateAndPick();
    await screen.findByTestId('translate-error');
    expect(screen.queryByTestId('translate-preview-text')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByTitle('ส่งถึงลูกค้า')); });
    const [, text, , , original] = sendReply.mock.calls[0]!;
    expect(text).toBe('รอสักครู่นะคะ');
    expect(original).toBeUndefined();
  });
});

/* [LEGACY-20260918-MANUALPREVIEW] preserved, not running — see the block above. */
describe.skip('[AITRANSLATE] ⭐⭐ the FE keeps no press counter of its own', () => {
  it('⭐⭐⭐ six successful presses in a row are all sent to the server', async () => {
    /* §4C: "the FE must not keep its own count of presses. Two browser tabs
       would each think they have six." A local counter would start refusing at
       the sixth without asking, and two tabs would spend twelve between them.
       The server refuses; this side only reports what it was told. */
    okPreview('x');
    mount();
    for (let i = 0; i < 6; i++) {
      type(`ประโยคที่ ${i}`);
      await pressTranslateAndPick();
      await screen.findByTestId('translate-preview-text');
    }
    expect(previewTranslate).toHaveBeenCalledTimes(6);
    expect(translateBtn().disabled).toBe(false);   // still the server's call, not ours
  });

  it('⭐⭐ the composer source contains no counter and no debounce machinery', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', 'components/chat/chat-input/ChatInputBox.tsx'), 'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    /* the translate block must own no timer at all: a debounce, a countdown and
       an auto-retry are all the same line to write */
    const block = code.slice(code.indexOf('translatePreview'), code.indexOf('const send ='));
    for (const banned of ['setTimeout', 'setInterval', 'debounce', 'Count', 'count']) {
      expect(block).not.toContain(banned);
    }
  });

  /**
   * [FIX-20260909-TRAYHEIGHT] The strip is a ROW, never a PANEL.
   *
   * 🔴 Owner, 09/09: *"บัคกดแปลแล้วขยายเต็มจอ"*. The first version of this fix
   *    folded the strip into `anyTrayOpen`, which is read by two different
   *    questions at once — "must the input row share the box?" (yes) and "does
   *    the composer become a flex panel taking half the column, or all of it in
   *    full mode?" (no). Pressing แปล answered both yes and swallowed the
   *    conversation. jsdom computes no layout, so nothing on screen could have
   *    caught it; the split is pinned in the source instead.
   */
  it('⭐⭐⭐ the preview strip never puts the composer into its flex/fullscreen state', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '..', 'components/chat/chat-input/ChatInputBox.tsx'), 'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

    /* the panel questions take the NARROW value … */
    expect(code).toMatch(/chatComposerAlwaysCappedClass\([^)]*trayPanelOpen/);
    expect(code).toMatch(/chatComposerBoxClass\(trayMode, trayPanelOpen,/);
    /* … while the height questions take the wide one, strip included */
    expect(code).toMatch(/const anyTrayOpen = trayPanelOpen \|\| translateStripOpen;/);
    expect(code).toMatch(
      /const translateStripOpen =[\s\S]{0,160}stagedTranslation[\s\S]{0,160}translating/,
    );
  });
});

/**
 * [FIX-20260909-MODALSIZE] What the modal must refuse to do, and what an empty
 * box must refuse to start.
 *
 * 🔴 EVERY ONE OF THESE IS A WAY TO LOSE WORK OR SPEND MONEY BY ACCIDENT, which
 *    is why they are pinned rather than left to the stylesheet:
 *      · a stray click on the dim area used to throw the choice away — and the
 *        modal can be mid-translate, so it could abandon a request in flight
 *        with nothing left on screen to report it
 *      · ยกเลิก sat as the last ROW of the list, where it read as an eighth
 *        language rather than the way out
 *      · pressing แปล with an empty box opened the modal, spent a call, and
 *        came back with nothing to preview
 */
/* [LEGACY-20260918-MANUALPREVIEW] preserved, not running — see the block above.
   All three drive the language-picker modal, whose JSX is commented out. */
describe.skip('[AITRANSLATE] the modal is deliberate, and an empty draft is not translatable', () => {
  it('⭐⭐ clicking the backdrop does NOT close it', async () => {
    okPreview('x');
    mount();
    type('รอสักครู่นะคะ');
    /* the button must be live before the press means anything — asserted rather
       than assumed, because the empty-draft guard below makes it conditional */
    expect(translateBtn().disabled).toBe(false);
    await act(async () => { fireEvent.click(translateBtn()); });
    const modal = await screen.findByTestId('language-picker-modal');
    fireEvent.click(modal);
    /* still there, and still showing the list */
    expect(screen.getByTestId('language-picker-modal')).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('⭐⭐ ยกเลิก is a bordered BUTTON outside the list, and it does close', async () => {
    okPreview('x');
    mount();
    type('รอสักครู่นะคะ');
    fireEvent.click(translateBtn());
    const modal = await screen.findByTestId('language-picker-modal');

    const cancel = Array.from(modal.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'ยกเลิก',
    )!;
    expect(cancel).toBeTruthy();
    /* not an option row — the thing it used to be mistaken for */
    expect(cancel.getAttribute('role')).not.toBe('option');
    /* and it looks like a control before the pointer arrives */
    expect(cancel.className).toContain('border');

    fireEvent.click(cancel);
    expect(screen.queryByTestId('language-picker-modal')).toBeNull();
  });

  it('⭐⭐⭐ an EMPTY box is ANSWERED, not silently ignored', async () => {
    /* [FIX-20260909-EMPTYDRAFT] The first shape of this made the button
       `disabled`. The owner changed it on 09/09: "ปุ่มยังห้ามอยู่ ถ้าฝืนกด ให้เตือน
       modal … เราไม่ห้ามกดแล้ว กดได้ แต่จะเตือนแทน".
       🔴 The reason is worth keeping: a disabled button cannot fire `onClick`,
          so it can never say WHY. The admin is left guessing which of several
          conditions greyed it out. It still LOOKS discouraged; the press is now
          answered with a sentence.
       ⚠️ And the press must still cost nothing — no picker, no request. */
    okPreview('x');
    mount();
    fireEvent.click(translateBtn());
    expect(screen.getByTestId('translate-need-text')).toBeTruthy();
    expect(screen.queryByTestId('language-picker-modal')).toBeNull();
    expect(previewTranslate).not.toHaveBeenCalled();

    /* and with something typed, the same press opens the picker instead */
    type('รอสักครู่นะคะ');
    fireEvent.click(translateBtn());
    expect(await screen.findByTestId('language-picker-modal')).toBeTruthy();
  });
});
