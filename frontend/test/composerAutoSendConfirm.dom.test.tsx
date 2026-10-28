/**
 * [FEAT-20260918-AUTOSENDCONFIRM] แปลแล้วส่งเลย — but not without asking.
 * ===========================================================================
 * Owner, 18/09: *"ต้องทำงานได้จริงไม่ต้องพรีวิว แล้วส่งเลย … ถ้าตั้งให้แปลตอนส่ง ต้องมี
 * confirm ก่อนส่ง"* and *"ต้องมี fallback ด้วย กรณีแปลไม่สำเร็จ (ทุกกรณี) ก็เก็บแบบเดิม"*.
 *
 * What is load-bearing here:
 *   · with the switch OFF nothing changes at all — same body, no translate call
 *   · with it ON the first press sends NOTHING and spends NOTHING
 *   · cancelling keeps the draft and still sends nothing
 *   · confirming translates once and sends the TRANSLATION, original riding along
 *   · every failure still sends, carrying what was typed
 *
 * ⚠️ NO REAL AI CALL. `aiTranslateService` is stubbed at the module boundary, so
 * the owner's call budget is untouched by this file.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const {
  previewTranslate, sendReply, sendSticker, sendImages, createInlineNote,
  skipAutoSendConfirm, rememberAutoSendConfirm,
} = vi.hoisted(() => ({
  previewTranslate: vi.fn(),
  sendReply: vi.fn(),
  sendSticker: vi.fn(),
  sendImages: vi.fn(),
  createInlineNote: vi.fn(),
  skipAutoSendConfirm: vi.fn(() => false),
  rememberAutoSendConfirm: vi.fn(),
}));

/* [TEMP-20260910-TRANSLATEDEVONLY] the composer's translate button is behind an
   account lock; without a signed-in allowed user the row renders differently. */
vi.mock('../services/authStorage', async () => {
  const actual = await vi.importActual<any>('../services/authStorage');
  return { ...actual, getAuthUser: () => ({ username: 'dev' }) };
});

vi.mock('../services/chat/aiTranslateService', async () => {
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

vi.mock('../services/hook/useFieldOptions', () => ({
  useFieldOptions: () => ({ options: [], choiceCount: 0 }),
}));

/* [FEAT-20260918-AUTOSENDREMEMBER] the per-account preference, stubbed at its
   own module boundary so these cases drive the COMPOSER's use of it and not the
   preferences service (which has its own suite). */
vi.mock('../services/chat/autoSendConfirmPref', () => ({
  skipAutoSendConfirm,
  rememberAutoSendConfirm,
  AUTO_SEND_CONFIRM_PREF_PATH: 'chat.skip_auto_send_confirm',
}));

import { ChatInputBox } from '../components/chat/chat-input';
import { I18nProvider } from '../i18n';

const baseRoom = { _id: 'room1', line_user_id: 'Uabc', unread_count: 0, hook_id: 'hook1' };

const mount = (extra: Record<string, unknown> = {}) =>
  render(
    <I18nProvider>
      <ChatInputBox accepted accepting={false} room={{ ...baseRoom, ...extra } as any} hookId="hook1" />
    </I18nProvider>,
  );

const composerBox = () => screen.getByPlaceholderText(/พิมพ์ข้อความตอบลูกค้า/) as HTMLTextAreaElement;
const type = (v: string) => fireEvent.change(composerBox(), { target: { value: v } });
const pressSend = async () => {
  /* by title, the way the sibling suite does it — the button has no testid */
  const btn = screen.getByTitle('ส่งถึงลูกค้า');
  await act(async () => { fireEvent.click(btn); });
};
const confirmBox = () => screen.queryByTestId('auto-send-confirm');

beforeEach(() => {
  vi.clearAllMocks();
  sendReply.mockResolvedValue({ success: true, data: { _id: 'm1' } });
  skipAutoSendConfirm.mockReturnValue(false); // the default: ask
});

describe('[FEAT-20260918-AUTOSENDCONFIRM] the switch is OFF — nothing changes', () => {
  it('sends straight away, with no confirm and no translate call', async () => {
    mount();
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    expect(confirmBox()).toBeNull();
    expect(previewTranslate).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledTimes(1);
    // The 5th argument is the original_* payload — absent means the body is
    // byte-identical to the one that always went out.
    expect(sendReply.mock.calls[0]![1]).toBe('ยอดเข้าแล้วครับ');
    expect(sendReply.mock.calls[0]![4]).toBeUndefined();
  });
});

describe('[FEAT-20260918-AUTOSENDCONFIRM] the switch is ON — the first press asks', () => {
  const ON = { auto_send_translated: true, translate_lang: 'my' };

  it('🔴 sends NOTHING and spends NOTHING on the first press', async () => {
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    expect(confirmBox()).toBeTruthy();
    expect(sendReply).not.toHaveBeenCalled();
    expect(previewTranslate).not.toHaveBeenCalled();
  });

  it('shows the text as TYPED — the confirm is not a preview', async () => {
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    expect(screen.getByTestId('auto-send-confirm-text').textContent).toBe('ยอดเข้าแล้วครับ');
    expect(previewTranslate).not.toHaveBeenCalled();
  });

  it('cancelling keeps the draft and still sends nothing', async () => {
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-cancel')); });

    expect(confirmBox()).toBeNull();
    expect(sendReply).not.toHaveBeenCalled();
    expect(previewTranslate).not.toHaveBeenCalled();
    expect(composerBox().value).toBe('ยอดเข้าแล้วครับ');
  });

  it('confirming translates once, then sends the TRANSLATION with the original riding along', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ', from: 'th' } });
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(previewTranslate).toHaveBeenCalledTimes(1);
    expect(previewTranslate.mock.calls[0]![2]).toBe('my'); // the customer's language
    expect(sendReply.mock.calls[0]![1]).toBe('ငွေရောက်ပါပြီ');
    expect(sendReply.mock.calls[0]![4]).toMatchObject({
      original_text: 'ยอดเข้าแล้วครับ',
      translated_lang: 'my',
    });
  });

  it('🔴 one confirm buys ONE send — the next press asks again', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ' } });
    mount(ON);
    type('first');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });
    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));

    type('second');
    await pressSend();

    expect(confirmBox()).toBeTruthy();
    expect(sendReply).toHaveBeenCalledTimes(1);
  });
});

describe('[FEAT-20260918-AUTOSENDCONFIRM] switching the outbound language, end to end', () => {
  /* The pure cross is `outboundTranslateMatrix.value.test.ts`. These drive the
     whole composer for each language so the value that reaches the request — and
     the name the operator is shown before agreeing — are both real.
     สลับภาษาขาออกจริงผ่านหน้าจอ ไม่ใช่แค่เรียกฟังก์ชัน */
  const LANGS: Array<[string, string, string]> = [
    ['my', 'ငွေရောက်ပါပြီ', 'พม่า'],
    ['km', 'ប្រាក់បានមកដល់ហើយ', 'เขมร'],
    ['lo', 'ເງິນເຂົ້າແລ້ວ', 'ลาว'],
    ['en', 'The money has arrived', 'อังกฤษ'],
    ['zh-Hans', '钱已到账', 'จีนตัวย่อ'],
    ['zh-Hant', '錢已到帳', 'จีนตัวเต็ม'],
    ['th', 'ยอดเข้าแล้วครับ', 'ไทย'],
  ];

  it.each(LANGS)('a room set to %s translates into %s and sends it', async (code, translated) => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: translated, from: 'th' } });
    mount({ auto_send_translated: true, translate_lang: code });
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(previewTranslate.mock.calls[0]![2]).toBe(code);
    expect(sendReply.mock.calls[0]![1]).toBe(translated);
    expect(sendReply.mock.calls[0]![4]).toMatchObject({
      original_text: 'ยอดเข้าแล้วครับ',
      translated_lang: code,
    });
  });

  it.each(LANGS)('the confirm names %s by its語 name, not its code', async (code, _t, thaiName) => {
    mount({ auto_send_translated: true, translate_lang: code });
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    const box = screen.getByTestId('auto-send-confirm');
    expect(box.textContent).toContain(thaiName);
    // 🔴 the raw code must never be what the operator is asked to approve —
    // "zh-Hant" tells nobody anything about who is about to receive this.
    expect(box.textContent).not.toContain(code === 'th' ? 'xx-nope' : code);
  });

  it('a room that only has an OBSERVED language still shows a real name', async () => {
    mount({ auto_send_translated: true, detected_source_lang: 'km' });
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    expect(screen.getByTestId('auto-send-confirm').textContent).toContain('เขมร');
  });

  it('a room with no language at all says so, instead of naming a language', async () => {
    mount({ auto_send_translated: true });
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    const text = screen.getByTestId('auto-send-confirm').textContent ?? '';
    expect(text).toContain('ยังไม่ทราบภาษาของลูกค้า');
    expect(text).toContain('ส่งตามที่พิมพ์');
  });
});

describe('[FEAT-20260918-AUTOSENDCONFIRM] the confirm renders correctly', () => {
  const ON = { auto_send_translated: true, translate_lang: 'my' };

  it('shows the draft in full, including newlines, not a truncated preview', async () => {
    mount(ON);
    type('บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม');
    await pressSend();

    expect(screen.getByTestId('auto-send-confirm-text').textContent).toBe(
      'บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม',
    );
  });

  it('a very long draft is still shown whole — the box scrolls, it does not cut', async () => {
    const long = 'ทดสอบข้อความยาว '.repeat(60);
    mount(ON);
    type(long);
    await pressSend();

    const box = screen.getByTestId('auto-send-confirm-text');
    expect(box.textContent).toBe(long.trim());
    expect(box.className).toContain('overflow-y-auto');
  });

  it('is a real dialog, and both answers are reachable', async () => {
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    const box = screen.getByTestId('auto-send-confirm');
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByTestId('auto-send-confirm-ok')).toBeTruthy();
    expect(screen.getByTestId('auto-send-confirm-cancel')).toBeTruthy();
  });

  it('Escape cancels — the safe direction never sends', async () => {
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByTestId('auto-send-confirm')).toBeNull();
    expect(sendReply).not.toHaveBeenCalled();
    expect(previewTranslate).not.toHaveBeenCalled();
  });

  it('🔴 no confirm is left on screen after a send — a stale one would block the box', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ' } });
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('auto-send-confirm')).toBeNull();
  });

  it('🔴 the composer is cleared after a translated send, exactly as after a normal one', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ' } });
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(composerBox().value).toBe('');
  });

  it('🔴 a failed translation still clears the box — the message DID go out', async () => {
    // The opposite would be worse than useless: the operator retypes and sends
    // the same line twice because the composer looks like it never sent.
    previewTranslate.mockRejectedValue(new Error('vendor down'));
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(composerBox().value).toBe('');
  });
});

describe('[FEAT-20260918-AUTOSENDCONFIRM] 🔴 fallback — a failure still sends what was typed', () => {
  const ON = { auto_send_translated: true, translate_lang: 'my' };

  it.each([
    ['the vendor refused', Object.assign(new Error('vendor unavailable'), { status: 502 })],
    ['the cap is full', Object.assign(new Error('translate call cap reached (20/20)'), { status: 429 })],
    ['rate limited', Object.assign(new Error('too many requests'), { status: 429 })],
    ['no key on the OA', Object.assign(new Error('Line access token is required'), { status: 400 })],
  ])('%s → the original goes out, untranslated', async (_name, err) => {
    previewTranslate.mockRejectedValue(err);
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(sendReply.mock.calls[0]![1]).toBe('ยอดเข้าแล้วครับ');
    expect(sendReply.mock.calls[0]![4]).toBeUndefined();
  });

  it('a vendor answering with empty text is a failure too — the original goes', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: '' } });
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(sendReply.mock.calls[0]![1]).toBe('ยอดเข้าแล้วครับ');
  });

  it('🔴 a room with NO customer language translates nothing and guesses nothing', async () => {
    // The old code ended its fallback chain with a literal 'en'.
    mount({ auto_send_translated: true });
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(previewTranslate).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]![1]).toBe('ยอดเข้าแล้วครับ');
  });

  it('falls back to the language the model observed when nobody declared one', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ' } });
    mount({ auto_send_translated: true, detected_source_lang: 'my' });
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(previewTranslate).toHaveBeenCalledTimes(1));
    expect(previewTranslate.mock.calls[0]![2]).toBe('my');
  });
});

describe('[FEAT-20260918-AUTOSENDREMEMBER] จำค่านี้ไว้ — a per-account answer', () => {
  const ON = { auto_send_translated: true, translate_lang: 'my' };

  it('the box sits next to ยกเลิก and starts UNCHECKED', async () => {
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    const box = screen.getByTestId('auto-send-confirm-remember') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.type).toBe('checkbox');
  });

  it('confirming WITHOUT ticking remembers nothing', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ' } });
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalled());
    expect(rememberAutoSendConfirm).not.toHaveBeenCalled();
  });

  it('ticking then confirming saves it once, for every room', async () => {
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ' } });
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    fireEvent.click(screen.getByTestId('auto-send-confirm-remember'));
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-ok')); });

    await waitFor(() => expect(sendReply).toHaveBeenCalled());
    expect(rememberAutoSendConfirm).toHaveBeenCalledTimes(1);
    expect(rememberAutoSendConfirm).toHaveBeenCalledWith(true);
  });

  it('🔴 ticking then CANCELLING remembers nothing — cancel is a way out, not a setting', async () => {
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();
    fireEvent.click(screen.getByTestId('auto-send-confirm-remember'));
    await act(async () => { fireEvent.click(screen.getByTestId('auto-send-confirm-cancel')); });

    expect(rememberAutoSendConfirm).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();
  });

  it('🔴 once remembered, the confirm never appears again — it translates and sends straight away', async () => {
    skipAutoSendConfirm.mockReturnValue(true);
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ငွေရောက်ပါပြီ' } });
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    expect(confirmBox()).toBeNull();
    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(previewTranslate).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0]![1]).toBe('ငွေရောက်ပါပြီ');
  });

  it('remembered applies in ANOTHER room too — it is an account-level answer', async () => {
    skipAutoSendConfirm.mockReturnValue(true);
    previewTranslate.mockResolvedValue({ success: true, data: { text: 'ខ្ញុំ' } });
    mount({ _id: 'room-999', auto_send_translated: true, translate_lang: 'km' });
    type('ข้อความห้องอื่น');
    await pressSend();

    expect(confirmBox()).toBeNull();
    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
  });

  it('🔴 remembering does NOT turn the feature on — a room with the switch off still sends as typed', async () => {
    skipAutoSendConfirm.mockReturnValue(true);
    mount(); // auto_send_translated absent
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    expect(confirmBox()).toBeNull();
    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(previewTranslate).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]![1]).toBe('ยอดเข้าแล้วครับ');
  });

  it('remembered + a failing vendor still falls back to the original', async () => {
    skipAutoSendConfirm.mockReturnValue(true);
    previewTranslate.mockRejectedValue(new Error('vendor down'));
    mount(ON);
    type('ยอดเข้าแล้วครับ');
    await pressSend();

    await waitFor(() => expect(sendReply).toHaveBeenCalledTimes(1));
    expect(sendReply.mock.calls[0]![1]).toBe('ยอดเข้าแล้วครับ');
  });
});
