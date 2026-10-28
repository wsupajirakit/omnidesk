/**
 * [FIX-20261014-TAGVALUECASE] The dynamic-tag form must accept a vendor's real key spelling.
 * =============================================================================
 * Two FE-only guards stood between an operator and a working tag on a custom-tool OA:
 *
 *   1. The Value box lower-cased every keystroke. The BE path reader is CASE-SENSITIVE
 *      (`rag-engine.service.ts` `_resolveDotIndexPath`: `curr[name]`), and the loan partner's
 *      real answers carry camelCase keys — `remaining.increaseBalance`, `installment[].dueDate`,
 *      `member.identityNumber` (BE fixture `z-test/fixtures/loan-v1-endpoints.ts`). A tag typed
 *      as the partner spells it was saved lower-cased and answered N/A for ever.
 *   2. A formula (+ - * /) was refused unless Sub Type was the legacy `api/v1/customer`. On a
 *      custom-tool OA the sub types are the tool's endpoint KEYS (shop-api's own CUSTOMER_PROFILE
 *      included), and the BE computes formulas on any source. Allowed now for this OA's own
 *      tool keys — the list the form already loads from `GET /hook/:id/tag-endpoints`.
 *
 * PIN: the legacy sub types answer exactly as before.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const getTagEndpoints = vi.fn();
/* [LOANV1SUBTYPE] the system_configs rows the form reads `acme_category` from */
const configs: { rows: unknown[] } = { rows: [] };
vi.mock('../services/messaging', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    dynamicTagService: { ...actual.dynamicTagService, getTagEndpoints: (id: string) => getTagEndpoints(id) },
  };
});
vi.mock('../services/chat', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, chatService: { ...actual.chatService, listRooms: () => Promise.resolve([]) } };
});
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      getAllHooks: () => Promise.resolve([{ _id: 'h1', line_oa_name: 'Loan OA', alias: 'loan' }]),
      getHooksByGroup: () => Promise.resolve([]),
    },
  };
});
vi.mock('../services/admin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    configService: { ...actual.configService, listConfigs: () => Promise.resolve({ data: configs.rows }) },
    fetchVisibleGroups: () => Promise.resolve([]),
    filterVisibleHooks: (h: any[]) => h,
  };
});
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }),
  handleApiResponse: () => Promise.resolve([]),
}));

import { DynamicTagFormModal } from '../components/dynamic-tag/DynamicTagFormModal';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

/* the loan tool's real endpoint keys, as `GET /hook/:id/tag-endpoints` lists them */
const LOAN_ENDPOINTS = [
  { key: 'CUSTOMER_PROFILE', is_profile: true, purpose: 'data' },
  { key: 'INSTALLMENT_CURRENT', purpose: 'data' },
  { key: 'PAYMENT_HISTORY', purpose: 'data' },
];
beforeEach(() => {
  configs.rows = [];
  getTagEndpoints.mockReset();
  getTagEndpoints.mockResolvedValue({ source: 'custom_tool', tool_name: 'loan', endpoints: LOAN_ENDPOINTS });
});

const tag = (over: Record<string, unknown>) => ({
  _id: 't1',
  tag: 'ins_x_test',
  type: 'api',
  detail: 'test',
  hook_id: 'h1',
  hook_ids: ['h1'],
  status: true,
  ...over,
});

const mount = (initialData: any) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const r = render(
    <I18nProvider>
      <DynamicTagFormModal isOpen onClose={() => {}} onSubmit={onSubmit} initialData={initialData} mode="update" />
    </I18nProvider>,
  );
  return { ...r, onSubmit };
};
const valueInput = (c: HTMLElement) =>
  c.querySelector('input[placeholder="customer.customer_name"]') as HTMLInputElement;
const FORMULA_REFUSED = 'ไม่สามารถใช้สูตรคำนวณกับหมวดนี้ได้';
const submitAndRead = async (c: HTMLElement) => {
  await waitFor(() => expect(getTagEndpoints).toHaveBeenCalled());
  /* let the endpoint list land before submitting — the rule reads it */
  await new Promise((r) => setTimeout(r, 0));
  fireEvent.submit(c.querySelector('form') as HTMLFormElement);
  await new Promise((r) => setTimeout(r, 50));
  return document.body.textContent ?? '';
};

describe('[TAGVALUECASE] TARGET — the partner’s spelling is kept', () => {
  it('a camelCase key typed into Value stays camelCase', async () => {
    const { container } = mount(tag({ sub_type: 'PAYMENT_HISTORY', value: 'data.remaining.balance' }));
    const input = await waitFor(() => {
      const el = valueInput(container);
      if (!el) throw new Error('Value input not mounted');
      return el;
    });
    fireEvent.change(input, { target: { value: 'data.remaining.increaseBalance' } });
    expect(valueInput(container).value).toBe('data.remaining.increaseBalance');
  });
});

describe('[TAGVALUECASE] TARGET — a formula on this OA’s own tool keys', () => {
  it('INSTALLMENT_CURRENT amount + mulct is not refused', async () => {
    const { container } = mount(
      tag({ sub_type: 'INSTALLMENT_CURRENT', value: 'data.installment.amount + data.installment.mulct_amount' }),
    );
    expect(await submitAndRead(container)).not.toContain(FORMULA_REFUSED);
  });
});

describe('[TAGVALUECASE] 🔴 PIN — the legacy sub types answer as before', () => {
  it('a formula on a legacy non-profile path is still refused', async () => {
    getTagEndpoints.mockResolvedValue({ source: 'hook', tool_name: '', endpoints: [] });
    const { container } = mount(
      tag({ sub_type: 'api/line/v1/payment_history.php', value: 'data.a + data.b' }),
    );
    expect(await submitAndRead(container)).toContain(FORMULA_REFUSED);
  });

  it('a formula on the legacy Customer Profile is still allowed', async () => {
    getTagEndpoints.mockResolvedValue({ source: 'hook', tool_name: '', endpoints: [] });
    const { container } = mount(tag({ sub_type: 'api/v1/customer', value: 'data.a + data.b' }));
    expect(await submitAndRead(container)).not.toContain(FORMULA_REFUSED);
  });

  it('a formula on a key that is NOT this OA’s tool is still refused', async () => {
    const { container } = mount(tag({ sub_type: 'SOME_OTHER_KEY', value: 'data.a + data.b' }));
    expect(await submitAndRead(container)).toContain(FORMULA_REFUSED);
  });
});

/* ── [FLOWTEST-20261014-LOANV1SUBTYPE] F6 / mega_test §L-56 ──────────────────────────────
   On the loan site `acme_category` is absent (false). The legacy "System Defaults"
   (api/line/v1/*.php) must stay hidden — they are the OLD line's paths and would answer N/A on
   a custom-tool OA — and the tool's own data endpoints must all be offered: exactly what BE
   `GET /hook/:id/tag-endpoints` returns for the loan tool (its 5 data lines; LOGIN is an auth
   line and BE drops it — `hooks.service.ts` getTagEndpoints). */
describe('[LOANV1SUBTYPE] F6 — the loan tool’s endpoints are the Sub Type choices', () => {
  const LOAN_DATA_KEYS = ['CUSTOMER_PROFILE', 'INSTALLMENT_CURRENT', 'PAYMENT_HISTORY', 'CONTRACT_INFO', 'ALL_INSTALLMENTS'];
  const subTypeSelect = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('select')).find((sel) =>
      Array.from(sel.options).some((o) => o.textContent === 'Select Option'),
    ) as HTMLSelectElement | undefined;
  const groups = (sel: HTMLSelectElement) =>
    Object.fromEntries(
      Array.from(sel.querySelectorAll('optgroup')).map((g) => [g.label, Array.from(g.querySelectorAll('option')).map((o) => o.value)]),
    );

  beforeEach(() => {
    getTagEndpoints.mockResolvedValue({
      source: 'custom_tool',
      tool_name: 'acme',
      endpoints: LOAN_DATA_KEYS.map((key) => ({ key, label: key, method: 'POST', path: 'x' })),
    });
  });

  it('flag absent (the loan site): all 5 data endpoints offered, no legacy defaults', async () => {
    const { container } = mount(tag({ sub_type: 'CUSTOMER_PROFILE', value: 'data.customer.customer_name' }));
    const sel = await waitFor(() => {
      const el = subTypeSelect(container);
      if (!el || el.querySelectorAll('optgroup').length === 0) throw new Error('sub type options not loaded');
      return el;
    });
    expect(groups(sel)).toEqual({ 'Hook Endpoints': LOAN_DATA_KEYS });
    /* the form keeps a SECOND copy of this select for preview mode (picking a sub type opens
       the preview) — a rule fixed in one copy only would survive here, so both are walked */
    fireEvent.change(sel, { target: { value: 'INSTALLMENT_CURRENT' } });
    const previewSel = await waitFor(() => {
      const el = subTypeSelect(container);
      if (!el || el === sel) throw new Error('preview-mode select not mounted');
      return el;
    });
    expect(groups(previewSel)).toEqual({ 'Hook Endpoints': LOAN_DATA_KEYS });
  });

  it('🔴 PIN: flag true (the legacy acme line) still adds the System Defaults', async () => {
    configs.rows = [{ key: 'acme_category', value: true }];
    const { container } = mount(tag({ sub_type: 'CUSTOMER_PROFILE', value: 'data.customer.customer_name' }));
    const sel = await waitFor(() => {
      const el = subTypeSelect(container);
      if (!el || !el.querySelector('optgroup[label="System Defaults"]')) throw new Error('defaults not shown');
      return el;
    });
    expect(groups(sel)['Hook Endpoints']).toEqual(LOAN_DATA_KEYS);
    expect(groups(sel)['System Defaults']?.length).toBeGreaterThan(0);
  });
});
