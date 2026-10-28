/**
 * [FIX-20260828-REPEATDAYS] เลือก "ส่งซ้ำ" แล้วต้องเลือกวันอย่างน้อยหนึ่งวัน
 * ===========================================================================
 * เจ้าของ 28/08: *"ถ้าเลือกส่งซ้ำ แล้วไม่เลือกวันไหน (อย่างน้อยต้องเลือก 1)
 * ให้เด้งเตือนตอนเซฟ"* + *"scroll + focus input วันให้ด้วย"*
 *
 * 🔴 ทำไมต้องกัน: ตารางเวลาที่ไม่มีวันไหนถูกเลือก = งานที่เซฟผ่าน สถานะขึ้นว่า
 *    scheduled แต่ **ไม่มีวันไหนยิงเลยตลอดกาล** · ไม่มี error ไม่มี log ไม่มีอะไร
 *    บอกเลย จนกว่าจะมีคนสังเกตว่าลูกค้าไม่เคยได้รับ
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/hook', () => ({
  webhookService: { getHooksByGroup: () => Promise.resolve([]) },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve([{ _id: 'g1', group_name: 'A' }]),
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const job = (schedule: Record<string, unknown> | null) => ({
  id: 'b1',
  _id: 'b1',
  name: 'งานทดสอบ',
  hook_ids: ['h1'],
  assign_group_ids: ['g1'],
  target: { mode: 'all', group_ids: [], match: 'and', rules: [] },
  message: { type: 'text', text: 'สวัสดี' },
  status: 'scheduled',
  scheduled_at: '2026-08-29T10:00:00.000Z',
  send_kind: 'multicast',
  description: 'ทดสอบ',
  schedule,
});

const mount = (schedule: Record<string, unknown> | null) => {
  const onSubmit = vi.fn(() => Promise.resolve());
  const r = render(
    <I18nProvider>
      <BroadcastFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        mode="update"
        initialData={job(schedule) as never}
      />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return { ...r, onSubmit };
};

const save = (c: HTMLElement) => {
  const btn = c.querySelector('button[name="header_confirm"]') as HTMLButtonElement;
  fireEvent.click(btn);
};

describe('[REPEATDAYS] ส่งซ้ำต้องมีวันอย่างน้อยหนึ่งวัน', () => {
  it('⭐⭐ 🔴 โหมดซ้ำ + ไม่เลือกวันเลย ⇒ เตือน และไม่เปิดชั้นยืนยัน', async () => {
    const { container, findAllByText, queryByText } = mount({
      mode: 'repeat',
      days_of_week: [],
      at_time: '17:11',
    });
    const c = container as HTMLElement;

    save(c);

    /* ⚠️ ต้องขึ้น **สองที่** และนั่นคือสิ่งที่ถูก:
       · แถบสรุปด้านบน — คนที่เพิ่งกดเซฟกำลังมองอยู่ตรงนั้น
       · ใต้ปุ่มวัน — คนที่ถูกเลื่อนพามาถึงตรงนั้นต้องอ่านได้โดยไม่ต้องเลื่อนกลับ
       ปักด้วย `findAllByText` + นับ ⇒ ถ้าวันหน้ามีคนถอดอันใดอันหนึ่งออก เคสนี้แดง */
    const shown = await findAllByText(/ต้องเลือกอย่างน้อย 1 วัน/);
    expect(shown.length).toBe(2);
    /* 🔴 ต้องไม่ไปถึงกล่องยืนยัน — ถ้าไปถึงแปลว่ากดต่ออีกทีก็เซฟได้ทั้งที่ผิด */
    expect(queryByText('ยืนยันการบันทึก')).toBeNull();
  });

  it('⭐⭐ 🔴 เลือกวันแล้วอย่างน้อยหนึ่งวัน ⇒ ไม่เตือน', async () => {
    const { container, queryByText } = mount({
      mode: 'repeat',
      days_of_week: [1],
      at_time: '17:11',
    });
    const c = container as HTMLElement;

    save(c);

    await waitFor(() =>
      expect(queryByText(/ต้องเลือกอย่างน้อย 1 วัน/)).toBeNull(),
    );
  });

  it('⭐⭐ 🔴 โหมด "ส่งครั้งเดียว" ต้องไม่โดนด่านนี้', async () => {
    /* โหมดนั้นไม่มีวันในสัปดาห์ให้เลือกด้วยซ้ำ · เผลอบังคับเมื่อไหร่ = เซฟไม่ได้เลย
       โดยที่ผู้ใช้หาช่องที่ต้องแก้ไม่เจอ */
    const { container, queryByText } = mount(null);
    const c = container as HTMLElement;

    save(c);

    await waitFor(() =>
      expect(queryByText(/ต้องเลือกอย่างน้อย 1 วัน/)).toBeNull(),
    );
  });

  it('⭐ กดเซฟไม่ผ่าน ⇒ โฟกัสไปที่ปุ่มวันให้เลย', async () => {
    /* เลื่อนไปหา (`scrollIntoView`) ไม่มีใน jsdom จึงวัดไม่ได้ที่นี่ —
       สิ่งที่วัดได้และสำคัญพอกันคือ **โฟกัสย้ายไปอยู่ที่ปุ่มวันจริง ๆ**
       ถ้าวันหน้ามีคนถอดบล็อกนั้นออก เคสนี้จะแดง */
    const { container } = mount({ mode: 'repeat', days_of_week: [], at_time: '17:11' });
    const c = container as HTMLElement;

    save(c);

    await waitFor(() => {
      const first = c.querySelector('[data-testid="repeat-days"] button');
      expect(document.activeElement).toBe(first);
    });
  });
});
