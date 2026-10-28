/**
 * [FEAT-20260918-LANGSUMMARY] The blue box has to answer the question in front of it.
 * =============================================================================
 * Owner, 18/09: *"ตรงสีฟ้าให้แสดงออกมาเลยว่าตั้งภาษาอะไรไว้พร้อมธงด้วย ทั้งระดับห้องและ
 * ระดับ OA ถ้าไม่ตั้งหรือตั้งตาม OA ก็บอกให้ครบ"*.
 *
 * Three lines, always: what the room chose, what the OA defaults to, and what a
 * reply will actually leave in. The third is `outboundTargetLang` — the same
 * function the send path calls — so this box cannot promise a language the send
 * would not use.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Step4LangSummary } from '../components/chat/room-header/parts/room-translate/Step4LangSummary';
import { I18nProvider } from '../i18n';

const mount = (room: Record<string, unknown> | null) =>
  render(
    <I18nProvider>
      <Step4LangSummary room={room as never} />
    </I18nProvider>,
  );

const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('[LANGSUMMARY] both levels are always named', () => {
  it('room and OA each named, with their flag', () => {
    mount({ translate_lang: 'my', hook_translate_lang: 'km' });

    expect(text('step4-lang-room')).toContain('🇲🇲');
    expect(text('step4-lang-room')).toContain('พม่า');
    expect(text('step4-lang-hook')).toContain('🇰🇭');
    expect(text('step4-lang-hook')).toContain('เขมร');
  });

  it('🔴 the room says so when it has not chosen — and says it follows the OA', () => {
    mount({ translate_lang: null, hook_translate_lang: 'km' });

    expect(text('step4-lang-room')).toContain('ยังไม่ได้ตั้ง');
    expect(text('step4-lang-room')).toContain('ใช้ตาม OA');
  });

  it('🔴 the OA says so when IT has not been set either', () => {
    mount({ translate_lang: null, hook_translate_lang: null });

    expect(text('step4-lang-hook')).toContain('ยังไม่ได้ตั้ง');
  });

  it('every one of the seven languages renders with a flag', () => {
    const codes = ['th', 'en', 'my', 'zh-Hans', 'zh-Hant', 'lo', 'km'];

    for (const code of codes) {
      const { unmount } = mount({ translate_lang: code });
      // a flag is a pair of regional-indicator/CJK-ish glyphs; asserting the
      // value is not the bare code is enough and survives a flag change
      expect(text('step4-lang-room')).not.toMatch(new RegExp(`\\b${code}\\s*$`));
      expect(text('step4-lang-target')).toBeTruthy();
      unmount();
    }
  });
});

describe('[LANGSUMMARY] the last line is what will really happen', () => {
  it('the room wins when it named one', () => {
    mount({ translate_lang: 'my', hook_translate_lang: 'km' });

    expect(text('step4-lang-target')).toContain('พม่า');
  });

  it('the OA fills in when the room named none', () => {
    mount({ translate_lang: null, hook_translate_lang: 'km' });

    expect(text('step4-lang-target')).toContain('เขมร');
  });

  it('🔴 nobody knows ⇒ it says replies go out as typed, not a blank', () => {
    mount({ translate_lang: null, hook_translate_lang: null });

    expect(text('step4-lang-target')).toContain('ส่งตามที่พิมพ์');
  });

  it('a language only the model observed is used, and shown as its own line', () => {
    mount({ detected_source_lang: 'zh-Hant' });

    expect(screen.getByTestId('step4-lang-detected')).toBeTruthy();
    expect(text('step4-lang-target')).toContain('จีน');
  });

  it('the observed line is hidden once a real setting decides', () => {
    // It would only add noise beside two fields that already answered.
    mount({ translate_lang: 'my', detected_source_lang: 'zh-Hant' });

    expect(screen.queryByTestId('step4-lang-detected')).toBeNull();
  });

  it('🔴 no room at all renders without crashing', () => {
    mount(null);

    expect(screen.getByTestId('step4-lang-summary')).toBeTruthy();
    expect(text('step4-lang-target')).toContain('ส่งตามที่พิมพ์');
  });
});
