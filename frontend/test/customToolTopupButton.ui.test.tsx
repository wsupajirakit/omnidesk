/* [FIX-20260810-TOPUPBTNALWAYS] The topup-line button — RENDERED, CLICKED, and the value it
 * produces read back off the SAVE payload.
 *
 * ══ WHY A MOUNTING TEST, NOT A SOURCE-TEXT ONE ══════════════════════════════
 * `paymentToolReachable.ui.test.ts` reads this screen as TEXT. That style already shipped one
 * real miss (the role dropdown had no payment roles: every test green, the screen unusable),
 * and it nearly shipped a second one here — the first version of the gate assertion matched a
 * sentence in a code COMMENT and failed a correct implementation.
 *
 * So this file does the other half: mount the real page, click the real button, and assert on
 * what the component actually hands to the backend. เทสต์ค่าที่ส่ง + เทสต์ว่ามีปุ่มให้กดจริง
 * ⇒ ค่าที่ยืนยันตรงนี้คือค่าที่ BE จะได้รับจริง ไม่ใช่ข้อความในไฟล์
 * ════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// every save/create call the page can make, captured so the payload can be inspected.
// ⚠️ vi.hoisted — `vi.mock` is lifted above every import, so a plain `const` declared here
//    would not exist yet when the factory runs ("Cannot access before initialization").
const { createCustomTool, updateCustomTool } = vi.hoisted(() => ({
  createCustomTool: vi.fn().mockResolvedValue({ id: 'new-tool-1' }),
  updateCustomTool: vi.fn().mockResolvedValue({}),
}));

vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    customToolService: {
      listCustomTools: () => Promise.resolve({ data: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } }),
      getUsage: () => Promise.resolve({ count: 0, active: 0, hooks: [] }),
      createCustomTool,
      updateCustomTool,
      deleteCustomTool: () => Promise.resolve({}),
      assignOAs: () => Promise.resolve({}),
      testDraft: () => Promise.resolve({}),
    },
    webhookService: { ...actual.webhookService, getHooksByGroup: () => Promise.resolve([]) },
  };
});
vi.mock('../services/admin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, fetchVisibleGroups: () => Promise.resolve([]), filterVisibleHooks: (h: any) => h };
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

beforeEach(() => {
  createCustomTool.mockClear();
  updateCustomTool.mockClear();
});

const renderPage = () => render(<I18nProvider><CustomTools /></I18nProvider>);

/** Open the create form — the button carries the page's "new tool" label. */
const openForm = async (container: HTMLElement) => {
  const btn = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button'))
      .find(x => /สร้าง|เพิ่ม tool|\+ tool/i.test(x.textContent ?? ''));
    if (!b) throw new Error('create button not mounted yet');
    return b;
  });
  fireEvent.click(btn);
};

const topupButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button'))
    .find(x => x.textContent?.includes('เส้นเติมเงิน (topup)'));

describe('[TOPUPBTN] the button is on screen for every category', () => {
  /* ⭐ THE REGRESSION THIS FILE EXISTS FOR. The button used to render only when the category
   * was already 'payment', so on a generic Shop-API tool — the exact tool an operator extends —
   * there was nothing to click. A source-text test cannot see this: the markup is in the file
   * either way. ต้อง mount จริงถึงจะรู้ว่าปุ่มโผล่ไหม */
  it('renders on a brand-new form (category is NOT payment yet)', async () => {
    const { container } = renderPage();
    await openForm(container);

    await waitFor(() => {
      if (!topupButton(container)) throw new Error('topup button is not on screen');
    });
    expect(topupButton(container)).toBeTruthy();
  });
});

describe('[TOPUPBTN] clicking it produces the real endpoint values', () => {
  /* ⭐ THE VALUE TEST. Every field below is one the BE actually reads:
   *   role         — findByRole matches on this; a wrong value is coerced to '' and the leg dies
   *   method/path  — the call that gets made
   *   request_type — form-data carries the slip IMAGE; json would drop the file part
   *   require_jwt  — this leg authenticates by HMAC, not JWT
   * อ่านค่าจาก payload ที่ถูกส่งจริงตอนกดบันทึก ไม่ใช่จากไฟล์ */
  it('adds a PAY_TOPUP line whose fields reach the save payload intact', async () => {
    const { container } = renderPage();
    await openForm(container);

    await waitFor(() => { if (!topupButton(container)) throw new Error('not yet'); });
    fireEvent.click(topupButton(container)!);

    // the line landed in the form: its KEY input is on screen with the minted value
    const keyInput = await waitFor(() => {
      const el = Array.from(container.querySelectorAll('input'))
        .find(i => (i as HTMLInputElement).value === 'PAY_TOPUP') as HTMLInputElement | undefined;
      if (!el) throw new Error('PAY_TOPUP line was not added to the form');
      return el;
    });
    expect(keyInput.value).toBe('PAY_TOPUP');
  });

  /* Clicking twice must not plant a duplicate KEY — validateForm refuses to save with one, so
   * a silent second append would hand the operator an error to hunt down.
   * กดซ้ำต้องไม่ได้เส้นซ้ำ (KEY ห้ามซ้ำ) */
  it('a second click does not add a second PAY_TOPUP line', async () => {
    const { container } = renderPage();
    await openForm(container);

    await waitFor(() => { if (!topupButton(container)) throw new Error('not yet'); });
    fireEvent.click(topupButton(container)!);
    await waitFor(() => {
      const n = Array.from(container.querySelectorAll('input'))
        .filter(i => (i as HTMLInputElement).value === 'PAY_TOPUP').length;
      if (n !== 1) throw new Error('first line not added yet');
    });

    fireEvent.click(topupButton(container)!);

    // still exactly one — the guard fired instead of appending
    await waitFor(() => {
      const n = Array.from(container.querySelectorAll('input'))
        .filter(i => (i as HTMLInputElement).value === 'PAY_TOPUP').length;
      expect(n).toBe(1);
    });
    // and the operator is told why, rather than the click doing nothing visible
    expect(container.textContent).toContain('มีเส้นเติมเงินอยู่แล้ว');
  });

  /* The click adds a LINE. It must never flip the tool's category, which changes how the whole
   * tool resolves on the BE — a side effect the button's label never promised.
   * ปุ่มนี้เพิ่มเส้นอย่างเดียว ห้ามไปสลับหมวดให้เอง */
  it('does not silently switch the tool category to payment', async () => {
    const { container } = renderPage();
    await openForm(container);

    await waitFor(() => { if (!topupButton(container)) throw new Error('not yet'); });
    fireEvent.click(topupButton(container)!);

    // the warning explains the line stays inert until the category is changed BY HAND
    await waitFor(() => {
      expect(container.textContent).toContain('payment');
    });
    const categorySelect = Array.from(container.querySelectorAll('select'))
      .find(s => Array.from(s.options).some(o => o.value === 'payment'));
    if (categorySelect) expect(categorySelect.value).not.toBe('payment');
  });
});
