/**
 * [FEAT-20260825-ATTIME] "ทำซ้ำ ตอนกี่โมง" บนฟอร์มจริง
 * ===========================================================================
 * เจ้าของ 25/08: *"ทำซ้ำ ตอนกี่โมง = เลือกเวลาในวัน พอถึงเวลานั้นก็ยิง"* ·
 * *"เริ่มเวลา กับถึงเวลาไม่ต้องมี"* · *"หยุดซ้ำหลังวันที่ ไม่ต้องมีตัดทิ้ง"*
 *
 * 🔴 ไฟล์นี้เขียนเพิ่มเพราะตรวจแล้วพบว่า **ไม่มีเทสไหนแตะช่องใหม่นี้เลย** ทั้งที่
 *    เป็นหัวใจของงานทั้งก้อน · ชุดเดิม 141 ไฟล์เขียวโดยไม่เคยเห็นช่องนี้สักครั้ง
 *    เขียวทั้งชุดไม่ได้แปลว่าของใหม่ถูกทดสอบ.
 *
 * 🔴 ชื่อฟิลด์ต้องตรงกับ BE เป๊ะ — พิมพ์ผิด = `ValidationPipe` ปฏิเสธทั้ง request
 *    ด้วยคำว่า "validation failed" ที่ไม่บอกว่าฟิลด์ไหน (เจอจริงตอนยิงเทส 25/08)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../services/admin', () => ({
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { RepeatRuleForm } from '../components/campaign/schedule/RepeatRuleForm';
import type { RepeatRule } from '../components/campaign/schedule/RepeatRuleForm';
import { I18nProvider } from '../i18n';

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

/** ขับผ่าน state จริงเหมือนฟอร์มทำ */
const Harness: React.FC<{ onRule: (r: RepeatRule | null) => void }> = ({ onRule }) => {
  const [rule, setRule] = React.useState<RepeatRule | null>(null);
  return (
    <RepeatRuleForm
      value={rule}
      onChange={next => {
        setRule(next);
        onRule(next);
      }}
    />
  );
};

const q = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('ช่อง "ทำซ้ำ ตอนกี่โมง"', () => {
  it('โหมดครั้งเดียว ⇒ ยังไม่มีช่องนี้', () => {
    const { container } = wrap(<Harness onRule={() => {}} />);
    expect(q(container, 'repeat-at-time')).toBeNull();
  });

  it('🔴 กด "ส่งซ้ำ" ⇒ ช่องเวลาโผล่ และตั้งค่าเริ่มต้นที่ใช้ได้ทันที', () => {
    const seen: (RepeatRule | null)[] = [];
    const { container } = wrap(<Harness onRule={r => seen.push(r)} />);
    fireEvent.click(q(container, 'repeat-mode-repeat') as HTMLElement);

    const box = q(container, 'repeat-at-time') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.type).toBe('time');

    /* กดแล้วต้องใช้ได้เลย ไม่ใช่เด้ง error — และต้องส่ง tz คู่มาด้วยเสมอ */
    const last = seen.at(-1)!;
    expect(last?.at_time_min).toBe(540); // 09:00 ไทย
    expect(last?.tz_offset_min).toBe(420);
  });

  it('🔴 เลือกเวลา ⇒ ส่ง at_time_min เป็นนาทีในวัน คู่กับ tz_offset_min', () => {
    const seen: (RepeatRule | null)[] = [];
    const { container } = wrap(<Harness onRule={r => seen.push(r)} />);
    fireEvent.click(q(container, 'repeat-mode-repeat') as HTMLElement);
    fireEvent.change(q(container, 'repeat-at-time') as HTMLElement, {
      target: { value: '15:00' },
    });

    const last = seen.at(-1)!;
    expect(last?.at_time_min).toBe(900);
    expect(last?.tz_offset_min).toBe(420);
  });

  it('เที่ยงคืน (00:00) ส่ง 0 ไม่ใช่ปล่อยว่าง — absent ≠ 0', () => {
    const seen: (RepeatRule | null)[] = [];
    const { container } = wrap(<Harness onRule={r => seen.push(r)} />);
    fireEvent.click(q(container, 'repeat-mode-repeat') as HTMLElement);
    fireEvent.change(q(container, 'repeat-at-time') as HTMLElement, {
      target: { value: '00:00' },
    });
    expect(seen.at(-1)?.at_time_min).toBe(0);
  });

  /**
   * 🔴 สามช่องที่เจ้าของสั่งตัด — ถ้าใครเผลอเอากลับมา เทสนี้แดง
   *    (เอากลับมาโดยไม่ตั้งใจ = ฟอร์มส่งฟิลด์ที่ BE ไม่อ่านแล้ว แล้วแอดมินจะ
   *     ตั้งค่าที่ไม่มีผลโดยไม่รู้ตัว)
   */
  it('🔴 ไม่มี "ทุก ๆ กี่นาที" / "เริ่มเวลา-ถึงเวลา" / "หยุดหลังวันที่" อีกแล้ว', () => {
    const { container } = wrap(<Harness onRule={() => {}} />);
    fireEvent.click(q(container, 'repeat-mode-repeat') as HTMLElement);
    expect(q(container, 'repeat-every-minutes')).toBeNull();
    expect(q(container, 'repeat-window-start')).toBeNull();
    expect(q(container, 'repeat-window-end')).toBeNull();
    expect(q(container, 'repeat-ends-at')).toBeNull();
  });

  it('ยังเลือกวันในสัปดาห์ และตั้ง "หยุดหลังครบกี่รอบ" ได้', () => {
    const { container } = wrap(<Harness onRule={() => {}} />);
    fireEvent.click(q(container, 'repeat-mode-repeat') as HTMLElement);
    expect(q(container, 'repeat-days')).not.toBeNull();
    expect(q(container, 'repeat-max-runs')).not.toBeNull();
  });

  it('ไม่ใส่จำนวนรอบ ⇒ เตือนว่าจะซ้ำไปเรื่อย ๆ', () => {
    const { container } = wrap(<Harness onRule={() => {}} />);
    fireEvent.click(q(container, 'repeat-mode-repeat') as HTMLElement);
    expect(q(container, 'repeat-no-brake-hint')).not.toBeNull();
  });
});
