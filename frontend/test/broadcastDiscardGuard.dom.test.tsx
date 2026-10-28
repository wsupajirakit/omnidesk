/**
 * [UI-20260828-DISCARDGUARD] กดยกเลิกแล้วงานที่ยังไม่บันทึกต้องไม่หายเงียบ
 * ===========================================================================
 * ฟอร์มบรอดแคสต์ยาว 6 ขั้น · ปุ่ม "ยกเลิก" เดิมเรียก `onClose` ตรง ๆ ⇒ พลาดไปโดน
 * ครั้งเดียวคืองานทั้งใบหายโดยไม่มีอะไรถาม และกู้กลับไม่ได้
 *
 * 🔴 สิ่งที่เทสนี้ปักคือ **สองทาง** ไม่ใช่ทางเดียว:
 *    1. แก้แล้วกดยกเลิก ⇒ ต้องถามก่อน และ `onClose` ต้อง **ยังไม่ถูกเรียก**
 *    2. ยังไม่แก้อะไรแล้วกดยกเลิก ⇒ ต้องปิดทันที ไม่ถาม
 *    ถ้าปักแค่ข้อ 1 การเปลี่ยนโค้ดให้ "ถามทุกครั้ง" จะยังเขียว ทั้งที่กล่องที่เด้ง
 *    ทุกครั้งจะถูกกดผ่านจนติดนิสัย แล้ววันที่มันเด้งเพราะมีงานค้างจริงก็โดนกดผ่านด้วย
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

const job = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  _id: 'b1',
  name: 'งานทดสอบ',
  hook_ids: ['h1'],
  assign_group_ids: ['g1'],
  target: { mode: 'all', group_ids: [], match: 'and', rules: [] },
  message: { type: 'text', text: 'สวัสดี' },
  status: 'draft',
  send_kind: 'multicast',
  description: 'ทดสอบ discard',
  ...over,
});

const mount = () => {
  const onClose = vi.fn();
  const r = render(
    <I18nProvider>
      <BroadcastFormModal
        isOpen
        onClose={onClose}
        onSubmit={vi.fn(() => Promise.resolve())}
        mode="update"
        initialData={job() as never}
      />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return { ...r, onClose };
};

const cancelBtn = (c: HTMLElement) =>
  c.querySelector('button[name="header_cancel"]') as HTMLButtonElement | null;
const nameInput = (c: HTMLElement) =>
  c.querySelector('input[name="name"]') as HTMLInputElement | null;

describe('[DISCARDGUARD] ยกเลิกทั้งที่มีงานค้าง', () => {
  it('⭐⭐ 🔴 แก้แล้วกดยกเลิก ⇒ ถามก่อน และยังไม่ปิดหน้าต่าง', async () => {
    const { container, onClose, findByText } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(nameInput(c)).not.toBeNull());

    fireEvent.change(nameInput(c)!, { target: { value: 'ชื่อที่เพิ่งพิมพ์' } });
    fireEvent.click(cancelBtn(c)!);

    /* กล่องต้องขึ้น — และที่สำคัญกว่านั้นคือ `onClose` ต้องยังไม่ถูกเรียก
       ถ้าเรียกไปแล้ว ฟอร์มก็ถูกปิดทิ้งไปแล้ว การถามทีหลังไม่มีความหมาย */
    expect(await findByText('ปิดหน้าต่างโดยไม่บันทึก?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('⭐⭐ 🔴 ยังไม่แก้อะไร กดยกเลิก ⇒ ปิดทันที ไม่ถาม', async () => {
    const { container, onClose, queryByText } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(nameInput(c)).not.toBeNull());

    fireEvent.click(cancelBtn(c)!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(queryByText('ปิดหน้าต่างโดยไม่บันทึก?')).toBeNull();
  });

  it('⭐ ยืนยันทิ้งงาน ⇒ ปิดจริง', async () => {
    const { container, onClose, findByText } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(nameInput(c)).not.toBeNull());

    fireEvent.change(nameInput(c)!, { target: { value: 'แก้แล้ว' } });
    fireEvent.click(cancelBtn(c)!);
    fireEvent.click(await findByText('ปิดโดยไม่บันทึก'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('⭐ เลือก "กลับไปแก้ต่อ" ⇒ ไม่ปิด และงานยังอยู่ครบ', async () => {
    const { container, onClose, findByText } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(nameInput(c)).not.toBeNull());

    fireEvent.change(nameInput(c)!, { target: { value: 'ยังไม่เสร็จ' } });
    fireEvent.click(cancelBtn(c)!);
    fireEvent.click(await findByText('กลับไปแก้ต่อ'));

    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput(c)!.value).toBe('ยังไม่เสร็จ');
  });
});
