/* [FIX-20260811-CUSTOOLVIS] "OA ที่ใช้ tool นี้" — bound OA ต้องติ๊กอยู่ตอนเปิด edit
 * แม้ OA นั้นไม่อยู่ใน visible-group list ที่ render.
 *
 * ══ บั๊กที่ไฟล์นี้กันไว้ ═══════════════════════════════════════════════════════
 * `formHooks` (OA ที่ผูก) มาจาก getUsage — ไม่ผ่าน visibility filter.
 * `allHooks` (list ที่ render) ผ่าน filterVisibleHooks. checkbox ติ๊กเมื่อ id อยู่
 * ทั้งสอง ⇒ OA ที่ผูกแต่ไม่อยู่ในกลุ่มที่แอดมินเห็น = header นับได้ แต่ 0 ติ๊ก ⇒
 * แอดมินติ๊กใหม่ทุกครั้ง และ save (assign REPLACE) จะถอด binding ที่มองไม่เห็นทิ้ง.
 * fix: merge bound OA จาก getUsage เข้า allHooks ตอน openEdit.
 *
 * mount จริง + เปิด edit จริง + assert checkbox ติ๊ก — ไม่ใช่อ่าน source text.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// tool ที่มีอยู่ 1 ตัว + OA: bound-1 ผูก tool แต่ "ไม่อยู่ใน visible group" · visible-2 อยู่
const TOOL = { id: 'tool-1', _id: 'tool-1', name: 'Shop-API', base_url: 'https://x', endpoints: [], category: 'payment' };
const BOUND_OA = { _id: 'bound-1', alias: 'demo-oa-three', name: 'demo-oa-three', line_oa_name: 'demo-oa-three', custom_tool_status: true, group: { name: 'G1' } };
const VISIBLE_OA = { _id: 'visible-2', alias: 'omnideskdevoa', name: 'omnideskdevoa', line_oa_name: 'omnideskdevoa', group: { name: 'G1' } };

vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    customToolService: {
      listCustomTools: () => Promise.resolve({ data: [TOOL], pagination: { page: 1, limit: 20, total: 1, pages: 1 } }),
      // getUsage คืน bound-1 (OA ที่ผูก) — bound-1 จะ "ไม่อยู่" ใน getHooksByGroup ด้านล่าง
      getUsage: () => Promise.resolve({ count: 1, active: 1, hooks: [BOUND_OA] }),
      createCustomTool: vi.fn().mockResolvedValue({ id: 'x' }),
      updateCustomTool: vi.fn().mockResolvedValue({}),
      deleteCustomTool: () => Promise.resolve({}),
      assignOAs: () => Promise.resolve({}),
      testDraft: () => Promise.resolve({}),
    },
    // allHooks มาจากนี่ — คืนแค่ visible-2 (จำลอง bound-1 โดน visibility filter กรองออก)
    webhookService: { ...actual.webhookService, getHooksByGroup: () => Promise.resolve([VISIBLE_OA]) },
  };
});
vi.mock('../services/admin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    fetchVisibleGroups: () => Promise.resolve([{ _id: 'G1', name: 'G1' }]),
    // filter ปล่อยผ่าน (allHooks = สิ่งที่ getHooksByGroup คืน = แค่ visible-2)
    filterVisibleHooks: (h: any) => h,
  };
});
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }),
  handleApiResponse: () => Promise.resolve([]),
}));
vi.mock('../services/authStorage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getAuthUser: () => ({ username: 'dev', role: 'superadmin', groups: [], permissions: ['system.manage'] }) };
});

import { CustomTools } from '../pages/hook/CustomTools';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

const renderPage = () => render(<I18nProvider><CustomTools /></I18nProvider>);

describe('[FIX-20260811-CUSTOOLVIS] bound OA ที่ไม่อยู่ใน visible list ต้องยังติ๊กอยู่', () => {
  it('เปิด edit tool → OA ที่ผูก (bound-1) render + checkbox ติ๊ก แม้ไม่อยู่ใน getHooksByGroup', async () => {
    const { container } = renderPage();

    // เปิด edit ของ tool แรก (ปุ่มดินสอ/แก้ไข)
    const editBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find((x) => /แก้ไข|edit/i.test(x.getAttribute('title') ?? '') || /แก้ไข/.test(x.textContent ?? ''));
      if (!b) throw new Error('edit button not mounted');
      return b;
    });
    fireEvent.click(editBtn);

    // รอ OA ที่ผูก (bound-1 = "demo-oa-three") โผล่ในรายการ checkbox
    const boundRow = await waitFor(() => {
      const label = Array.from(container.querySelectorAll('label'))
        .find((l) => l.textContent?.includes('demo-oa-three'));
      if (!label) throw new Error('bound OA demo-oa-three ยังไม่ render — merge ไม่ทำงาน');
      return label;
    });

    // ⭐ checkbox ของ bound OA ต้อง checked (ไม่ใช่ว่าง)
    const cb = boundRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cb).toBeTruthy();
    expect(cb.checked).toBe(true);
  });
});
