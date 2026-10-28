/**
 * [FIX-20260825-LEFTOPEN] การ์ดฝั่งซ้ายต้องกางไว้ตั้งแต่เปิดฟอร์ม
 *
 * เจ้าของ 25/08: *"กล่อง input ฝั่งซ้ายทั้งหมด ฝั่งนี้ default เปิดไว้เลย (ค่อยกดพับเอง)"*
 *
 * ⚠️ นี่คือการ **พลิก** คำสั่งเดิมของ 24/08 ที่ให้ "พับไว้" — แต่พลิกเฉพาะฝั่งซ้าย
 * (ชื่อ/คำอธิบาย/เนื้อหาข้อความ = ของที่ต้องกรอกทุกใบ) ส่วนฝั่งขวายังพับเหมือนเดิม
 * เพราะเป็นตัวเลือกที่ไม่ได้แตะทุกครั้ง
 *
 * mount จริง ไม่ใช่อ่านซอร์ส — `-body` จะมีอยู่ก็ต่อเมื่อการ์ดกางจริง
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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
import { I18nProvider } from '../i18n';

const mount = () =>
  render(
    <I18nProvider>
      <BroadcastFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn(() => Promise.resolve())} mode="create" />
    </I18nProvider>,
  );

const body = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}-body"]`);
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

describe('[LEFTOPEN] ฝั่งซ้ายกางไว้ ฝั่งขวายังพับ', () => {
  it('⭐⭐ ข้อมูลพื้นฐาน + เนื้อหาข้อความ กางตั้งแต่เปิดฟอร์ม', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(body(c, 'section-basic')).not.toBeNull());
    expect(body(c, 'section-message')).not.toBeNull();
  });

  /* ⚠️ [UI-20260825-SENDOPEN] `section-send` ถูก **ย้ายออกจากลิสต์นี้** 25/08
     เจ้าของสั่งรอบที่สอง: *"div สถานะการส่ง ให้เปิดค้างตลอด (พับค่อยกดเอง)"*
     เหตุผลที่ยังเข้ากับกติกาของเคสนี้: การ์ดใบนี้ต้องเลือกก่อนกดยืนยัน **ทุกครั้ง**
     จึงเป็น "ของที่ต้องแตะทุกใบ" เหมือนฝั่งซ้าย ไม่ใช่ "ตัวเลือกที่นาน ๆ ใช้ที"
     ⚠️ อีกสามใบยังต้องพับเหมือนเดิม — เคสนี้ยังทำหน้าที่กันไม่ให้ใครเผลอกางยกแผง */
  /* [FEAT-2708-GRIDPICK] (งาน 5.3) `section-group`/`section-oa` ย้ายไปฝั่ง
     "กางตลอด" ตามคำสั่ง 27/08 ("ไม่ต้องมี พับ...ให้กลางไว้ตลอด") — เหลือ
     `section-target` ใบเดียวที่ยังพับ ซึ่งเคสนี้ยังปินต่อไป */
  it('⭐ ฝั่งขวาที่เหลือยังพับเหมือนเดิม — ของเดิมห้ามขยับ (PIN)', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(body(c, 'section-basic')).not.toBeNull());
    /* [UI-20260828-NOFOLD] Owner, 28/08: every card in this modal is now open and
       has no fold arrow, so "the right-hand cards are still folded" stopped being
       true by decision, not by accident. The case keeps its job — pinning what the
       admin sees on open — with the expectation turned around.
       Switch: `BROADCAST_SECTIONS_COLLAPSIBLE` in FormSection.tsx. */
    for (const id of ['section-target']) {
      expect(body(c, id)).not.toBeNull();
      expect(q(c, `${id}-toggle`)).toBeNull();
    }
    // สองใบนี้กางตลอดโดยดีไซน์ใหม่ — เนื้อในต้องโผล่และไม่มีปุ่มพับ
    for (const id of ['section-group', 'section-oa']) {
      expect(body(c, id)).not.toBeNull();
      expect(q(c, `${id}-toggle`)).toBeNull();
    }
  });

  it('⭐⭐ สถานะการส่ง กางตั้งแต่เปิดฟอร์ม (create / edit / copy ใช้ modal เดียวกัน)', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(body(c, 'section-send')).not.toBeNull());
  });
});
