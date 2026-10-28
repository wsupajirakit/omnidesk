/* [UI-20260825-SENDCONSENT] + [FEAT-20260825-BCASTSKIPASSIST]
 * ===========================================================================
 * เจ้าของ 25/08 สั่งสามข้อที่ผูกกันอยู่:
 *   · กล่องยืนยันต้องมีช่องติ๊ก **ทุกงาน** ทั้ง broadcast และ multicast
 *   · กดยืนยันโดยยังไม่ติ๊ก ⇒ ช่องติ๊กต้อง **แดง** ไม่ใช่เงียบ ไม่ใช่ปุ่มถูกปิด
 *   · งานที่เลือกผู้รับด้วย "ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน" ต้องมีคำเตือน
 *     สีส้ม และ **ข้อความต่างกันตามช่องติ๊กเปิดเคส** · งานอื่นไม่ต้องมีคำเตือน
 *
 * 🔴 ข้อสุดท้ายคือเหตุผลที่ไฟล์นี้ผูกสองฝั่งไว้ด้วยกัน: คำเตือนไม่ใช่ข้อความ
 *    ประดับ มันอธิบายพฤติกรรมจริงของ BE สองก้อน (เปิดเคสทันที vs ติดธงให้
 *    ข้อความถัดไปเปิดเคส) ⇒ ถ้าคีย์ตัวกรองฝั่ง BE เปลี่ยน คำเตือนจะกลายเป็นคำโกหก
 *    เคส `CARD_RULE_KEY` ข้างล่างคือหมุดที่ทำให้เรื่องนั้นแดงแทนที่จะเงียบ
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react';
import { I18nProvider } from '../i18n';
import {
  BroadcastSendConsent,
  usesCardRule,
  CARD_RULE_KEY,
} from '../components/campaign/form/BroadcastSendConsent';

const draw = (over: Partial<React.ComponentProps<typeof BroadcastSendConsent>> = {}) =>
  render(
    <I18nProvider>
      <BroadcastSendConsent
        rules={undefined}
        directTicket={false}
        checked={false}
        onChange={() => {}}
        missing={false}
        {...over}
      />
    </I18nProvider>,
  );

describe('[SENDCONSENT] the tick box', () => {
  it('⭐⭐ (T1) is there even for a job with no conditions at all', () => {
    // "ทุกงาน boardcast ทุกงาน multicast"
    const v = draw();
    expect(v.queryByTestId('send-consent-input')).not.toBeNull();
  });

  it('⭐⭐ (T2) turns red only once a confirm was attempted without it', () => {
    /* ⚠️ สองการ render อยู่ใน document เดียวกัน ⇒ ต้อง query ในกล่องของตัวเอง
       ไม่งั้นจะเจอ "multiple elements" ซึ่งเป็นข้อผิดพลาดของเทส ไม่ใช่ของโค้ด */
    const calm = within(draw().container);
    expect(calm.getByTestId('send-consent-box').getAttribute('data-consent-missing')).toBe('no');
    const angry = within(draw({ missing: true }).container);
    expect(angry.getByTestId('send-consent-box').getAttribute('data-consent-missing')).toBe('yes');
    expect(angry.getByTestId('send-consent-box').className).toContain('border-red-500');
  });

  it('⭐ (T3) ticking reports upward', () => {
    const onChange = vi.fn();
    const v = draw({ onChange });
    fireEvent.click(v.getByTestId('send-consent-input'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('[SENDCONSENT] the orange warning', () => {
  const cardRules = [{ key: CARD_RULE_KEY }];

  it('⭐⭐ (T4) no card rule = no warning at all', () => {
    // "ถ้าไม่ตรงสองเงื่อนไขนี้ไม่ต้องมี warning"
    expect(within(draw().container).queryByTestId('send-consent-warning')).toBeNull();
    expect(
      within(draw({ rules: [{ key: 'follow_up.abandon_at' }] }).container)
        .queryByTestId('send-consent-warning'),
    ).toBeNull();
  });

  it('⭐⭐ (T5) card + เปิดเคส ⇒ warns that a case opens ON SEND', () => {
    const w = within(draw({ rules: cardRules, directTicket: true }).container)
      .getByTestId('send-consent-warning');
    expect(w.getAttribute('data-warning-kind')).toBe('direct');
    expect(w.className).toContain('amber');
  });

  it('⭐⭐ (T6) card + ไม่ติ๊ก ⇒ warns about the NEXT message instead', () => {
    const w = within(draw({ rules: cardRules, directTicket: false }).container)
      .getByTestId('send-consent-warning');
    expect(w.getAttribute('data-warning-kind')).toBe('next-message');
  });

  it('⭐⭐ (T7) the two warnings are genuinely different text, not one label reused', () => {
    const a = within(draw({ rules: cardRules, directTicket: true }).container)
      .getByTestId('send-consent-warning').textContent;
    const b = within(draw({ rules: cardRules, directTicket: false }).container)
      .getByTestId('send-consent-warning').textContent;
    expect(a).not.toBe(b);
    expect((a ?? '').length).toBeGreaterThan(20);
    expect((b ?? '').length).toBeGreaterThan(20);
  });
});

describe('[SENDCONSENT] which rule counts as "the card"', () => {
  it('⭐⭐⭐ (T8) it is the SAME key the backend stamps on — not a lookalike', () => {
    /* ฝั่ง BE: `broadcast-follow-up/stamp-abandon-on-multicast.ts`
       → TRIGGER_SOURCE_KEYS = ['follow_up.customer_helper_at']
       สองฝั่งต้องพูดถึงคีย์เดียวกัน ไม่งั้นคำเตือนจะโผล่ผิดงาน */
    expect(CARD_RULE_KEY).toBe('follow_up.customer_helper_at');
  });

  it('⭐ (T9) one matching rule among several is enough', () => {
    expect(usesCardRule([{ key: 'x' }, { key: CARD_RULE_KEY }])).toBe(true);
  });

  it('⭐ (T10) no rules / broken rows do not throw', () => {
    expect(usesCardRule(undefined)).toBe(false);
    expect(usesCardRule([])).toBe(false);
    expect(usesCardRule([{}, { key: undefined }])).toBe(false);
  });
});
