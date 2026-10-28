/**
 * [FEAT-2708-GRIDPICK] (งาน 5.3) step 3 กลุ่มเว็บ + step 4 LINE OA = ตาราง checkbox
 * ===========================================================================
 * เจ้าของ 27/08: *"ไม่ต้องมี พับ...ไม่ต้อมี arrow ให้กลางไว้ตลอด...ไม่ต้้องมี
 * select option ทั้งสองแท็บ...ออกมาเป็นตาราง 2x2 แล้วไล่ติ๊กง่ายๆ...
 * มีปุ่มเลือกทั้งหมด และปุ่มยกเลิก"*
 * กติกาที่ตรึง:
 *   · การ์ด 3/4 กางตลอด — ไม่มีปุ่มพับ ไม่มี chevron
 *   · ไม่มี dropdown trigger — checkbox โผล่เลยโดยไม่ต้องกดอะไร
 *   · grid 2 คอลัมน์ + กรอบ scroll (กลุ่มจริง ~100 แถว)
 *   · เลือกทั้งหมด / ยกเลิก กระทำเฉพาะแถวที่แสดง (สัญญาเดิมของ MultiCheckSelect)
 *   · cascade เดิม: ติ๊กกลุ่มออก → OA ของกลุ่มนั้นหลุดจากที่เลือก (pruneHookIds)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
const getHooksByGroup = vi.fn((gid: string) =>
  Promise.resolve(
    gid === 'g1'
      ? [
          { _id: 'h1', name: 'OA หนึ่ง', line_oa_name: 'OA หนึ่ง', domain_name: 'https://demo.site-a.com/dashboard' },
          { _id: 'h2', name: 'OA สอง', line_oa_name: 'OA สอง', domain_name: '' },
        ]
      : [{ _id: 'h3', name: 'OA สาม', line_oa_name: 'OA สาม' }],
  ),
);
vi.mock('../services/hook', () => ({
  webhookService: { getHooksByGroup: (...a: unknown[]) => getHooksByGroup(...(a as [string])) },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () =>
    Promise.resolve([
      { _id: 'g1', group_name: 'กลุ่มเอ' },
      { _id: 'g2', group_name: 'กลุ่มบี' },
    ]),
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

const box = (id: string) =>
  document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null;

describe('[GRIDPICK] การ์ดกางตลอด ไม่มีพับ', () => {
  it('⭐⭐ section-group/oa ไม่มีปุ่มพับ และเนื้อในโผล่เสมอ', async () => {
    mount();
    await waitFor(() => expect(box('assign-group-opt-g1')).not.toBeNull());
    expect(screen.queryByTestId('section-group-toggle')).toBeNull();
    expect(screen.queryByTestId('section-oa-toggle')).toBeNull();
    expect(screen.queryByTestId('section-group-body')).not.toBeNull();
    expect(screen.queryByTestId('section-oa-body')).not.toBeNull();
    /* [UI-20260828-NOFOLD] Owner, 28/08 reversed the earlier decision: NO card in
       this modal has a fold toggle any more, so the line that used to pin "other
       cards are still foldable" now pins the opposite. This card's own guarantee
       (group/OA are always open) is unchanged and still asserted above.
       Switch: `BROADCAST_SECTIONS_COLLAPSIBLE` in FormSection.tsx. */
    expect(screen.queryByTestId('section-basic-toggle')).toBeNull();
  });

  it('⭐⭐ ไม่มี dropdown trigger — checkbox ติ๊กได้ทันที ไม่ต้องกางอะไร', async () => {
    mount();
    await waitFor(() => expect(box('assign-group-opt-g1')).not.toBeNull());
    expect(document.querySelector('[data-testid="assign-group-trigger"]')).toBeNull();
    expect(document.querySelector('[data-testid="hook-picker-trigger"]')).toBeNull();
    fireEvent.click(box('assign-group-opt-g1')!);
    await waitFor(() => expect(box('assign-group-opt-g1')!.checked).toBe(true));
    // ติ๊กกลุ่มแล้ว OA ของกลุ่มโหลดเข้ามาเป็น checkbox เช่นกัน
    await waitFor(() => expect(box('hook-picker-opt-h1')).not.toBeNull());
  });

  it('⭐ ตารางเป็น 2 คอลัมน์ + มีกรอบ scroll', async () => {
    mount();
    await waitFor(() => expect(box('assign-group-opt-g1')).not.toBeNull());
    const grid = document.querySelector('[data-testid="assign-group-grid"]') as HTMLElement;
    expect(grid).toBeTruthy();
    expect(grid.className).toContain('grid-cols-2');
    const scroller = grid.closest('[class*="overflow-y-auto"]');
    expect(scroller).toBeTruthy();
  });
});

describe('[GRIDPICK] เลือกทั้งหมด / ยกเลิก', () => {
  it('⭐⭐ เลือกทั้งหมด → ติ๊กครบทุกแถวที่แสดง · ยกเลิก → ว่าง', async () => {
    mount();
    await waitFor(() => expect(box('assign-group-opt-g1')).not.toBeNull());
    fireEvent.click(screen.getByTestId('assign-group-select-all'));
    await waitFor(() => {
      expect(box('assign-group-opt-g1')!.checked).toBe(true);
      expect(box('assign-group-opt-g2')!.checked).toBe(true);
    });
    fireEvent.click(screen.getByTestId('assign-group-clear'));
    await waitFor(() => {
      expect(box('assign-group-opt-g1')!.checked).toBe(false);
      expect(box('assign-group-opt-g2')!.checked).toBe(false);
    });
  });

  it('⭐ มีคำค้น = กระทำเฉพาะแถวที่แสดง (สัญญาเดิม)', async () => {
    mount();
    await waitFor(() => expect(box('assign-group-opt-g1')).not.toBeNull());
    fireEvent.change(screen.getByTestId('assign-group-search'), { target: { value: 'เอ' } });
    await waitFor(() => expect(box('assign-group-opt-g2')).toBeNull());
    fireEvent.click(screen.getByTestId('assign-group-select-all'));
    fireEvent.change(screen.getByTestId('assign-group-search'), { target: { value: '' } });
    await waitFor(() => {
      expect(box('assign-group-opt-g1')!.checked).toBe(true);
      expect(box('assign-group-opt-g2')!.checked).toBe(false);
    });
  });

  it('⭐ [5.3+] แถว OA โชว์โดเมนของ hook (host เดี่ยว ไม่เอา protocol/path)', async () => {
    /* เจ้าของ 27/08 เพิ่ม: "hook oa grid แสดงชื่อโดเมนของ hook ออกมาด้วย"
       — endpoint ส่ง domain_name เต็ม URL มาอยู่แล้ว จอโชว์เฉพาะ host พออ่าน */
    mount();
    await waitFor(() => expect(box('assign-group-opt-g1')).not.toBeNull());
    fireEvent.click(box('assign-group-opt-g1')!);
    await waitFor(() => expect(box('hook-picker-opt-h1')).not.toBeNull());
    const grid = document.querySelector('[data-testid="hook-picker-grid"]') as HTMLElement;
    expect(grid.textContent).toContain('demo.site-a.com');
    expect(grid.textContent).not.toContain('https://');
    expect(grid.textContent).not.toContain('/dashboard');
  });

  it('⭐ cascade เดิมยังอยู่: ติ๊กกลุ่มออก → OA ของกลุ่มหลุดจากที่เลือก', async () => {
    mount();
    await waitFor(() => expect(box('assign-group-opt-g1')).not.toBeNull());
    fireEvent.click(box('assign-group-opt-g1')!);
    await waitFor(() => expect(box('hook-picker-opt-h1')).not.toBeNull());
    fireEvent.click(box('hook-picker-opt-h1')!);
    await waitFor(() => expect(box('hook-picker-opt-h1')!.checked).toBe(true));
    // เอากลุ่มออก → OA ที่เคยติ๊กของกลุ่มนั้นต้องหลุด (pruneHookIds)
    fireEvent.click(box('assign-group-opt-g1')!);
    await waitFor(() => {
      const h1 = box('hook-picker-opt-h1');
      expect(h1 === null || h1.checked === false).toBe(true);
    });
  });
});
