/**
 * [FIX-20260825-REPEATSELFHIDE] กดส่งซ้ำแล้วฟอร์มหายทั้งก้อน
 *
 * เจ้าของแจ้ง 25/08 (หลายรอบ): *"กดส่งซ้ำแล้ว กล่องตั้งเวลาไม่มี และปุ่มส่งซ้ำหาย"*
 * และย้ำอีกครั้งว่า *"edit modal กดส่งซ้ำแล้ว ฟิลหาย"* · *"create ด้วย"*
 *
 * ต้นเหตุ: ตัวเลือก "ทำซ้ำ" ถูกวางไว้ **ข้างใน** บล็อกที่มีเงื่อนไข
 * `formData.status === 'scheduled' && !isRepeatingSchedule`
 * ⇒ พอกดเลือกโหมด repeat ค่านั้นกลายเป็น true เงื่อนไขเป็นเท็จทันที
 *    **บล็อกถอดตัวเองออกจากจอ** พร้อมฟอร์มที่เพิ่งกด
 *
 * เทสนี้ mount จริงและกดจริงทั้งโหมด create และ edit — ไม่ใช่การอ่านซอร์ส
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

const q = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

const EXISTING = {
  _id: 'b1',
  name: 'เดิม',
  description: 'มีอยู่ก่อน',
  status: 'scheduled',
  message: { type: 'text', text: 'hi' },
  hook_ids: [],
  assign_group_ids: [],
  target: { mode: 'all', group_ids: [] },
} as never;

const mount = (initialData?: unknown) => {
  const r = render(
    <I18nProvider>
      <BroadcastFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn(() => Promise.resolve())}
        mode={initialData ? 'update' : 'create'}
        initialData={initialData as never}
      />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return r;
};

/** เข้าสถานะ "ตั้งเวลาส่ง" ซึ่งเป็นที่อยู่ของตัวเลือกทำซ้ำ */
const chooseScheduled = (c: HTMLElement) => {
  const b = c.querySelector('button[name="schedule_scheduled"]') as HTMLElement | null;
  expect(b).not.toBeNull();
  fireEvent.click(b as HTMLElement);
};

describe.each([
  ['create', undefined],
  ['update', EXISTING],
])('[REPEATSELFHIDE] โหมด %s — กดส่งซ้ำแล้วฟอร์มต้องไม่หาย', (_label, data) => {
  it('⭐⭐ กด "ส่งซ้ำ" แล้วปุ่มนั้นยังอยู่ และตัวเลือกทำซ้ำยังแสดง', async () => {
    const { container } = mount(data);
    const c = container as HTMLElement;

    chooseScheduled(c);
    await waitFor(() => expect(q(c, 'repeat-mode-repeat')).not.toBeNull());

    fireEvent.click(q(c, 'repeat-mode-repeat') as HTMLElement);

    // 🔴 หัวใจ: ก่อนแก้ ทั้งก้อนหายไป ปุ่มนี้จะกลายเป็น null ทันทีที่กด
    await waitFor(() => {
      expect(q(c, 'repeat-mode-repeat')).not.toBeNull();
    });
    // และตัวเลือก "ครั้งเดียว" ก็ยังอยู่ให้กดกลับได้
    expect(q(c, 'repeat-mode-once')).not.toBeNull();
  });

  it('⭐ กดกลับเป็น "ครั้งเดียว" แล้วช่องวันเวลากลับมา', async () => {
    const { container } = mount(data);
    const c = container as HTMLElement;

    chooseScheduled(c);
    await waitFor(() => expect(q(c, 'repeat-mode-repeat')).not.toBeNull());

    fireEvent.click(q(c, 'repeat-mode-repeat') as HTMLElement);
    fireEvent.click(q(c, 'repeat-mode-once') as HTMLElement);

    await waitFor(() => {
      expect(c.querySelector('input[name="scheduled_at"]')).not.toBeNull();
    });
  });
});
