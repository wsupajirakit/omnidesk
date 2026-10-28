/**
 * [FIX-20260825-OALOADALLGROUPS] ติ๊กหลายกลุ่มแล้ว "ไม่มี LINE OA ให้เลือก"
 *
 * เจ้าของแจ้ง 25/08 พร้อมภาพ: ช่องกลุ่มขึ้น `123, 4444 +2` (4 กลุ่ม) แต่ช่อง
 * LINE OA ขึ้น `0` และ *"ไม่มี LINE OA ให้เลือก"*
 *
 * ต้นเหตุ: `groupPickKey` ประกอบจาก `assign_group` ซึ่งเป็น **กลุ่มแรกกลุ่มเดียว**
 * ⇒ โหลด OA จากกลุ่มแรกเท่านั้น · กลุ่มแรกไม่มี OA = จอว่างทั้งที่กลุ่มอื่นมี
 *
 * ⚠️ เทสนี้ **mount ฟอร์มจริงแล้วกดจริง** ไม่ใช่การอ่านซอร์ส — เจ้าของสั่ง 25/08
 *    ว่า "อย่าเทสเดา" หลังจากเทสแบบอ่านซอร์สพลาดมาหลายรอบ
 *    ของจริงที่วัด: ติ๊ก 2 กลุ่ม ⇒ เมนู OA ต้องมี OA ของ **ทั้งสองกลุ่ม**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const GROUPS = [
  { _id: 'g1', group_name: 'Alpha Group' },
  { _id: 'g2', group_name: 'Bravo Group' },
];

/* 🔴 g1 ไม่มี OA เลย — จำลองเคสจริงของเจ้าของเป๊ะ ๆ: กลุ่มแรกว่าง แต่กลุ่มที่สองมี
   ถ้าโค้ดโหลดแค่กลุ่มแรก เมนูจะว่างสนิทและเทสนี้จะแดง */
const HOOKS: Record<string, { _id: string; line_oa_name: string; group: string }[]> = {
  g1: [],
  g2: [{ _id: 'h2', line_oa_name: 'OA Bravo', group: 'g2' }],
};

const askedFor: string[] = [];

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/hook', () => ({
  webhookService: {
    getHooksByGroup: (id: string) => {
      askedFor.push(id);
      return Promise.resolve(HOOKS[id] ?? []);
    },
  },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve(GROUPS),
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const q = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const open = () => {
  const r = render(
    <I18nProvider>
      <BroadcastFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn(() => Promise.resolve())} mode="create" />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return r;
};

/* [FEAT-2708-GRIDPICK] (งาน 5.3) dropdown → ตารางกางตลอด: ไม่มี trigger/menu
   ให้เปิดอีกแล้ว — "เมนู" ของเทสนี้คือกล่อง grid ที่ render อยู่เสมอ */
const openMenu = async (c: HTMLElement, picker: string) =>
  await waitFor(() => {
    const m = q(c, picker);
    expect(m).not.toBeNull();
    return m as HTMLElement;
  });

beforeEach(() => { askedFor.length = 0; });

describe('[OALOADALLGROUPS] ติ๊กหลายกลุ่ม ⇒ OA ต้องมาจากทุกกลุ่ม', () => {
  it('⭐⭐ กลุ่มแรกไม่มี OA แต่กลุ่มสองมี ⇒ ต้องเห็น OA ของกลุ่มสอง', async () => {
    const { container } = open();
    const c = container as HTMLElement;

    // รอให้รายชื่อกลุ่มโหลดเสร็จก่อน (ตารางกางตลอด — รอ checkbox โผล่)
    const gm = await openMenu(c, 'assign-group');
    await waitFor(() =>
      expect(gm.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2),
    );
    // ติ๊กทั้งสองกลุ่มจริง ๆ ผ่าน checkbox ในเมนู
    const boxes = Array.from(gm.querySelectorAll('input[type="checkbox"]'));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(boxes[0] as HTMLElement);
    fireEvent.click(boxes[1] as HTMLElement);

    // ⭐ หัวใจ: ต้องถาม OA ของ "ทุกกลุ่มที่ติ๊ก" ไม่ใช่กลุ่มแรกกลุ่มเดียว
    await waitFor(() => {
      expect(askedFor).toContain('g1');
      expect(askedFor).toContain('g2');
    });

    // ⭐ และผลลัพธ์ต้องเลือกได้จริงบนจอ ไม่ใช่แค่ยิง API สำเร็จ
    //    (ตัวเลือกจะ render ต่อเมื่อเปิดเมนู OA — ปิดอยู่ = ยังพิสูจน์ไม่ได้)
    const om = await openMenu(c, 'hook-picker');
    await waitFor(() => {
      expect(om.textContent).toContain('OA Bravo');
    });
  });
});
