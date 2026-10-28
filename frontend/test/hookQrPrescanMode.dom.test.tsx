/* [FEAT-20260822-QRPRESCANFE] `qr_prescan_mode` becomes visible and settable.
 *
 * WHY IT MATTERS: this column decides whether jsQR runs on an inbound image.
 * When it is absent or 'off' the prescan never runs, `qr_found` never happens,
 * and the notice mode's SLIP cases (E/F) can never fire for that OA — while the
 * card gate still forces an operator to bind two cards for them. The dashboard
 * had NO reference to the field at all (grep: zero), so the only way to change
 * it was by hand in Mongo. โหมดนี้ตัดสินว่า jsQR รันไหม แต่หน้าเว็บไม่เคยเห็นมันเลย
 *
 * These cases drive the REAL modal; only the network boundary is mocked, the
 * same harness HookFormModal.value.test.tsx uses.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../services/media', () => ({ flexMessageService: { listFlexMessages: () => Promise.resolve([]) } }));
vi.mock('../services/admin/configService', () => ({ configService: { listConfigs: () => Promise.resolve([]) } }));
vi.mock('../services/chat/handoffService', () => ({ handoffService: { listTargets: () => Promise.resolve([]) } }));
vi.mock('../services/admin/groupService', () => ({ groupService: {
  listGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getVisibleGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroup: () => Promise.resolve({ _id: 'a0d00000000000000000001e', group_name: 'Group One' }),
} }));
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const data = [{ id: 'pay-tool-1', name: 'Payment tool', category: 'payment', base_url: 'https://pay.test', endpoints: [] }];
  return {
    ...actual,
    customToolService: {
      listCustomTools: () => Promise.resolve({ data, pagination: { page: 1, limit: 200, total: data.length, pages: 1 } }),
      list: () => Promise.resolve({ data, pagination: {} }),
      getUsage: () => Promise.resolve({ count: 0, active: 0, hooks: [] }),
    },
  };
});
vi.mock('../services/apiClient', () => ({ API_BASE_URL: '', authFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }), handleApiResponse: () => Promise.resolve([]) }));
vi.mock('../services/authStorage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getAuthUser: () => ({ username: 'dev', role: 'superadmin', groups: [], permissions: ['system.manage'] }) };
});

import { HookFormModal } from '../components/hook';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (global as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (window.HTMLElement.prototype as any).showPicker = vi.fn();
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

const baseHook: any = {
  _id: 'h1', line_oa_name: 'OA One', alias: 'oa-alias', company_name: 'Company',
  description: 'desc', domain_name: 'example.com', line_url: 'https://line.me/x',
  webhook_url: 'https://example.com/wh', channel_id: 'CHAN1', channel_type: 'line',
  channel_secret: 'secret123', access_token: 'token123',
  group_id: 'a0d00000000000000000001e', status: 1, suggestion_text: 'hello',
};

const renderModal = (props: any) =>
  render(<I18nProvider><HookFormModal isOpen onClose={() => {}} {...props} /></I18nProvider>);

/** open the slip tab — its button carries the slip label. */
const openSlipTab = async (container: HTMLElement) => {
  const btn = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button')).find((x) =>
      /สลิป|Slip/i.test(x.textContent || ''),
    );
    if (!b) throw new Error('slip tab not mounted yet');
    return b;
  });
  fireEvent.click(btn);
};

const prescanSelect = (container: HTMLElement) =>
  waitFor(() => {
    const s = container.querySelector(
      'select[name="qr_prescan_mode"]',
    ) as HTMLSelectElement | null;
    if (!s) throw new Error('qr_prescan_mode select is not on the slip tab');
    return s;
  });

const submit = async (container: HTMLElement, onSubmit: any) => {
  const saveBtn = await waitFor(() => {
    const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    if (!b) throw new Error('submit button not mounted yet');
    return b;
  });
  fireEvent.click(saveBtn);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
  return onSubmit.mock.calls[0][0];
};

describe('⭐ qr_prescan_mode is visible on the slip tab and survives the round trip', () => {
  it('⭐ a stored value is shown as it is', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, qr_prescan_mode: 'log' },
      mode: 'create', // clone path: no baseline, so the whole payload is sent
    });
    await openSlipTab(container);
    expect((await prescanSelect(container)).value).toBe('log');
  });

  it('⭐ changing it reaches the payload — the value the OA will store', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, qr_prescan_mode: 'log' },
      mode: 'create',
    });
    await openSlipTab(container);
    fireEvent.change(await prescanSelect(container), {
      target: { value: 'skip' },
    });
    const payload = await submit(container, onSubmit);
    expect(payload.qr_prescan_mode).toBe('skip');
  });

  it('⭐ an OA that never had the column shows OFF — what the runtime really does', async () => {
    /* `.lean()` skips schema defaults, so an old row reads as undefined and
       `resolveQrPrescanMode` answers 'off'. Showing 'skip' there would be a
       comfortable lie, and the operator would never know why E/F stay silent
       on that OA. แสดงค่าที่ระบบใช้จริง ไม่ใช่ค่า default ที่แถวนั้นไม่มี. */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook },
      mode: 'create',
    });
    await openSlipTab(container);
    expect((await prescanSelect(container)).value).toBe('off');
  });
});
