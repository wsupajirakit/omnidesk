/**
 * [FEAT-20260826-ENABLETOGGLE] ช่อง "สถานะ" เป็นสวิตช์ — ใครกดได้ ใครกดไม่ได้
 * ============================================================================
 * เจ้าของสั่ง 26/08 แล้วต้องแจ้งซ้ำเพราะรอบแรกยังกดได้อยู่:
 * *"ถ้าส่งแล้ว และไม่มีรอบซ้ำ ไม่มีตั้งเวลา toggle นั้นให้เบลอกดไม่ได้"*
 *
 * 🔴 บั๊กรอบแรก: เขียนเป็น `state === 'one_off' && FINISHED.includes(status)`
 *    ซึ่ง **ไม่เคยทำงาน** เพราะ `one_off` ถูกล็อกไปก่อนหน้าแล้ว = โค้ดตายที่ดูเหมือนทำงาน
 *    เคสในไฟล์นี้จับได้ทันทีถ้าใครเขียนกลับไปแบบนั้นอีก
 *
 * ตัวเลขจริงจากฐาน 26/08 ที่ใช้ออกแบบเคส:
 *   sent+repeat = 8 · sent+ไม่มี schedule = 4 · scheduled+repeat = 2 · draft+repeat = 1
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BroadcastEnabledToggle } from '../components/messaging';

const REPEAT = { mode: 'repeat', enabled: true } as any;

const draw = (props: Partial<React.ComponentProps<typeof BroadcastEnabledToggle>> = {}) => {
  const onToggle = vi.fn();
  const view = render(
    <BroadcastEnabledToggle
      schedule={REPEAT}
      status="scheduled"
      testId="enabled-x"
      onToggle={onToggle}
      {...props}
    />,
  );
  return { view, onToggle, el: () => view.container.querySelector('[data-testid="enabled-x"]')! };
};

describe('[ENABLETOGGLE] ใครกดได้ ใครกดไม่ได้', () => {
  it('⭐⭐ (TARGET) งานทำซ้ำที่ส่งจบแล้ว = เบลอ กดไม่ได้', () => {
    /* นี่คือ 8 แถวในฐานที่เจ้าของเห็นว่า "ส่งแล้วแต่ยังกดได้" */
    const { el, onToggle } = draw({ status: 'sent' });
    expect(el().getAttribute('data-locked')).toBe('yes');
    expect(el().className).toContain('cursor-not-allowed');
    fireEvent.click(el());
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('⭐ ยกเลิก / ล้มเหลว ก็เบลอเหมือนกัน', () => {
    for (const status of ['cancelled', 'failed']) {
      const { el } = draw({ status });
      expect({ status, locked: el().getAttribute('data-locked') })
        .toEqual({ status, locked: 'yes' });
    }
  });

  it('⭐⭐ (PIN) งานทำซ้ำที่ยังตั้งเวลาอยู่ **ต้องกดได้** — ห้ามล็อกเกิน', () => {
    /* 🔴 เคสนี้คือด้านตรงข้ามที่พลาดง่ายที่สุด: ถ้าใครล็อกจาก `schedule` แทน `status`
       หรือล็อกทุกงานที่มี `next_run_at` ในอดีต งานที่ยังทำงานอยู่จะโดนปิดตายเงียบ ๆ */
    const { el, onToggle } = draw({ status: 'scheduled' });
    expect(el().getAttribute('data-locked')).toBeNull();
    fireEvent.click(el());
    expect(el().getAttribute('role')).toBe('switch');
    expect(onToggle).not.toHaveBeenCalled(); // ยังไม่เปลี่ยน — ต้องผ่าน confirm ก่อน
  });

  it('⭐ (PIN) ต้องกดยืนยันก่อนถึงจะเปลี่ยนจริง', () => {
    const { view, el, onToggle } = draw({ status: 'scheduled' });
    fireEvent.click(el());
    const ok = view.container.querySelector('[data-testid="enabled-x-confirm-ok"]');
    expect(ok, 'กด toggle แล้วต้องมีกล่องยืนยัน').not.toBeNull();
    fireEvent.click(ok as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('⭐ (PIN) `enabled: null` แปลว่า **เปิด** ไม่ใช่ปิด', () => {
    /* งานเก่าในฐานถูกบันทึกเป็น `enabled: null` — ตีเป็น "ปิด" จะทำให้ดูเหมือน
       ถูกปิดทั้งที่ยังทำงานอยู่ · กฎนี้เป็นของ `resolveBroadcastEnableState` */
    const { el } = draw({ schedule: { mode: 'repeat', enabled: null } as any, status: 'scheduled' });
    expect(el().getAttribute('data-enable-state')).toBe('on');
  });

  it('⭐ (PIN) งานที่ไม่มี schedule = ส่งครั้งเดียว = ป้ายเฉย ๆ กดไม่ได้', () => {
    const { el, onToggle } = draw({ schedule: null, status: 'draft' });
    expect(el().getAttribute('data-enable-state')).toBe('one_off');
    expect(el().getAttribute('data-locked')).toBe('yes');
    fireEvent.click(el());
    expect(onToggle).not.toHaveBeenCalled();
  });
});
