/**
 * [FEAT-20260918-LANGFIRST] Step 4 may not be switched on with no language.
 * =============================================================================
 * Owner, 18/09: *"ถ้าเลือกเปิดระบบแปลออโต้ (ข้อ 4) แล้วกดเปิด โดยที่ข้อ 3 ยังไม่ตั้งค่า
 * ภาษา จะต้อง modal เตือนว่าให้เลือกภาษาในข้อ 3 ก่อน"*, and the follow-up that draws
 * the line precisely: *"ถ้าระดับ OA มีภาษาหลัก (แล้วข้อ 3 เลือกใช้ตาม OA) ไม่เข้าเงื่อนไข
 * เตือน ยอมให้ส่งได้ เพราะใช้ค่าจาก hook · แต่ถ้า hook ภาษาหลักไม่ตั้ง แล้วข้อ 3 เลือกใช้
 * ค่าเริ่มตาม OA ต้องเตือน"*.
 *
 * So the question is NOT "is step 3 empty" — it is "does a reply have anywhere to
 * be translated INTO". A room that names nothing under an OA that does is fine;
 * the reply resolves through the hook exactly as step 4's own label promises.
 * The warning exists for the one state where the switch would lie: on, with
 * every reply going out untranslated.
 *
 * The condition is `outboundTargetLang(room) === null` — the same function the
 * SEND path calls, so the warning can never disagree with what would happen.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { RoomTranslateModal } from '../components/chat/room-header/parts/room-translate/RoomTranslateModal';
import { outboundTargetLang } from '../services/chat/outboundTranslateTarget';
import { I18nProvider } from '../i18n';

const onUpdateSettings = vi.fn();

const baseRoom = { _id: 'room1', line_user_id: 'Uabc', hook_id: 'hook1' };

const mount = (room: Record<string, unknown>) =>
  render(
    <I18nProvider>
      <RoomTranslateModal
        isOpen
        onClose={() => {}}
        room={{ ...baseRoom, ...room } as any}
        onUpdateSettings={onUpdateSettings}
      />
    </I18nProvider>,
  );

/** Open step 4 and press its switch. */
const pressStep4 = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('room-wizard-step-4-btn'));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId('room-modal-auto-send-toggle'));
  });
};

const notice = () => screen.queryByTestId('room-lang-required-notice');

beforeEach(() => {
  vi.clearAllMocks();
  onUpdateSettings.mockResolvedValue(undefined);
});

describe('[LANGFIRST] the rule, stated on the resolver itself', () => {
  it('🔴 warns only when NOBODY knows the language', () => {
    // room named one → fine
    expect(outboundTargetLang({ translate_lang: 'my' })).toBe('my');
    // room says "follow the OA" and the OA named one → fine
    expect(outboundTargetLang({ translate_lang: null, hook_translate_lang: 'km' })).toBe('km');
    // room says "follow the OA" and the OA named none → this is the warning case
    expect(outboundTargetLang({ translate_lang: null, hook_translate_lang: null })).toBeNull();
  });
});

describe('[LANGFIRST] switching step 4 ON', () => {
  it('🔴 no language anywhere ⇒ warns and saves NOTHING', async () => {
    mount({ auto_send_translated: false });
    await pressStep4();

    expect(notice()).toBeTruthy();
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it('🔴 the OA has a main language ⇒ no warning, the switch saves', async () => {
    // "ข้อ 3 เลือกใช้ตาม OA" + OA has one — allowed, per the owner's follow-up.
    mount({ auto_send_translated: false, translate_lang: null, hook_translate_lang: 'km' });
    await pressStep4();

    expect(notice()).toBeNull();
    expect(onUpdateSettings).toHaveBeenCalledWith({ auto_send_translated: true });
  });

  it('the room named its own language ⇒ no warning', async () => {
    mount({ auto_send_translated: false, translate_lang: 'my' });
    await pressStep4();

    expect(notice()).toBeNull();
    expect(onUpdateSettings).toHaveBeenCalledWith({ auto_send_translated: true });
  });

  it('a language the model merely OBSERVED is enough — a reply has a target', async () => {
    mount({ auto_send_translated: false, detected_source_lang: 'zh-Hant' });
    await pressStep4();

    expect(notice()).toBeNull();
    expect(onUpdateSettings).toHaveBeenCalled();
  });
});

describe('[LANGFIRST] the warning never traps anyone', () => {
  it('🔴 switching step 4 OFF is never blocked, even with no language', async () => {
    // The guard must only ever stop the ON direction; blocking OFF would leave an
    // operator unable to undo a setting the warning itself complains about.
    mount({ auto_send_translated: true });
    await pressStep4();

    expect(notice()).toBeNull();
    expect(onUpdateSettings).toHaveBeenCalledWith({ auto_send_translated: false });
  });

  it('closing it leaves the switch exactly as it was', async () => {
    mount({ auto_send_translated: false });
    await pressStep4();

    await act(async () => {
      fireEvent.click(screen.getByTestId('room-lang-required-cancel'));
    });

    expect(notice()).toBeNull();
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it('Escape closes it and saves nothing', async () => {
    mount({ auto_send_translated: false });
    await pressStep4();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(notice()).toBeNull();
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it('"ไปเลือกภาษา" closes it and opens step 3', async () => {
    mount({ auto_send_translated: false });
    await pressStep4();

    await act(async () => {
      fireEvent.click(screen.getByTestId('room-lang-required-go'));
    });

    expect(notice()).toBeNull();
    // step 3's language picker is on screen, which is where the operator was sent
    expect(screen.getByTestId('room-modal-lang-select')).toBeTruthy();
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });

  it('🔴 other settings are never guarded — only step 4 turning on', async () => {
    mount({ auto_send_translated: false });
    await act(async () => {
      fireEvent.click(screen.getByTestId('room-wizard-step-1-btn'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('room-modal-auto-translate-toggle'));
    });

    expect(notice()).toBeNull();
    expect(onUpdateSettings).toHaveBeenCalledWith({ auto_translate: true });
  });
});
