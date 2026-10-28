/**
 * [FLOWTEST-20261018-TAGLIVEUID] Creating a dynamic tag can fetch the OA's real answer with a real
 * LINE user id — through the tag form's own buttons, single OA and group scope alike.
 * ===========================================================================
 * Owner 18/10/2026: "ต้อง get userid จริง ตอนสร้าง dynamic tag ด้วย". Dived before writing: the
 * form already has it — PREVIEW → Authentication → Login → "Paste Member User ID" → "Choose" on an
 * endpoint ⇒ `POST /hook/:id/execute-external-endpoint {endpoint_key, line_user_id, token}`, which
 * the BE answers through the OA's custom tool with that uid (`hook-outbound.service.ts`).
 *
 * A first reading suspected group scope was broken (the test buttons read `formData.hook_id`,
 * Login reads `credHookId`). It is not: in group scope an effect keeps `formData.hook_id` equal
 * to the chosen PRIMARY CREDENTIAL SOURCE. This file pins that, so nobody "fixes" it into a bug.
 *
 * Only the network is mocked; every click runs the shipped component.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const svc = vi.hoisted(() => ({
  getTagEndpoints: vi.fn(),
  loginHook: vi.fn(),
  testExternalEndpoint: vi.fn(),
}));
vi.mock('../services/messaging', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    dynamicTagService: {
      ...actual.dynamicTagService,
      getTagEndpoints: (id: string) => svc.getTagEndpoints(id),
      loginHook: (...a: unknown[]) => svc.loginHook(...a),
      testExternalEndpoint: (...a: unknown[]) => svc.testExternalEndpoint(...a),
    },
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
      getAllHooks: () => Promise.resolve([
        { _id: 'h1', line_oa_name: 'Loan OA', alias: 'loan', group_id: 'g1' },
        { _id: 'h2', line_oa_name: 'Loan OA 2', alias: 'loan2', group_id: 'g1' },
      ]),
      getHooksByGroup: () => Promise.resolve([
        { _id: 'h1', line_oa_name: 'Loan OA', alias: 'loan', group_id: 'g1' },
        { _id: 'h2', line_oa_name: 'Loan OA 2', alias: 'loan2', group_id: 'g1' },
      ]),
    },
  };
});
vi.mock('../services/admin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    configService: { ...actual.configService, listConfigs: () => Promise.resolve({ data: [] }) },
    fetchVisibleGroups: () => Promise.resolve([{ _id: 'g1', group_name: 'Loan group' }]),
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

const LOAN_ENDPOINTS = [
  { key: 'CUSTOMER_PROFILE', is_profile: true, purpose: 'data' },
  { key: 'INSTALLMENT_CURRENT', purpose: 'data' },
  { key: 'PAYMENT_HISTORY', purpose: 'data' },
];
const UID = 'U0123456789abcdef0123456789abcdef'; // a well-formed, made-up LINE id
const ANSWER = { status: true, data: { installment: { amount: 1234 } } };

beforeEach(() => {
  svc.getTagEndpoints.mockReset().mockResolvedValue({ source: 'custom_tool', tool_name: 'loan', endpoints: LOAN_ENDPOINTS });
  svc.loginHook.mockReset().mockResolvedValue({ token: 'tok-1', response: {} });
  svc.testExternalEndpoint.mockReset().mockResolvedValue({ request: {}, response: { status: 200, data: ANSWER } });
});

const button = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(text));

/** PREVIEW → Continue to Preview → Authentication → Login → uid → "Choose" on INSTALLMENT_CURRENT */
const runLiveTest = async (initialData: Record<string, unknown>) => {
  const { container } = render(
    <I18nProvider>
      <DynamicTagFormModal isOpen onClose={() => {}} onSubmit={vi.fn()} initialData={initialData as never} mode="update" />
    </I18nProvider>,
  );
  await waitFor(() => expect(svc.getTagEndpoints).toHaveBeenCalled());
  const preview = await waitFor(() => { const b = button(container, 'PREVIEW'); if (!b) throw new Error('preview'); return b; });
  fireEvent.click(preview);
  /* PREVIEW first opens a guidance dialog — "Continue to Preview" opens the pane */
  const cont = await waitFor(() => { const b = button(container, 'Continue to Preview'); if (!b) throw new Error('guidance'); return b; });
  fireEvent.click(cont);
  const auth = await waitFor(() => {
    const h = Array.from(container.querySelectorAll('h4')).find((x) => x.textContent === 'Authentication');
    if (!h) throw new Error('auth section'); return h;
  });
  fireEvent.click(auth);
  const login = await waitFor(() => { const b = button(container, 'Login'); if (!b) throw new Error('login'); return b; });
  fireEvent.click(login);
  await waitFor(() => expect(svc.loginHook).toHaveBeenCalled());
  const uidBox = container.querySelector('input[placeholder="Paste Member User ID here..."]') as HTMLInputElement;
  fireEvent.change(uidBox, { target: { value: UID } });
  const row = await waitFor(() => {
    const r = Array.from(container.querySelectorAll('div')).find((d) =>
      d.className.includes('rounded-2xl') && d.textContent?.includes('INSTALLMENT_CURRENT') &&
      !d.textContent?.includes('CUSTOMER_PROFILE') && !!button(d as HTMLElement, 'Choose'));
    if (!r) throw new Error('endpoint row'); return r as HTMLElement;
  });
  fireEvent.click(within(row).getAllByRole('button').find((b) => b.textContent?.includes('Choose'))!);
  await waitFor(() => expect(svc.testExternalEndpoint).toHaveBeenCalled());
  return container;
};

describe('[TAGLIVEUID] the tag form fetches with the LINE user id the admin pastes', () => {
  it('⭐ single OA: Login and the endpoint test both go to that OA, with the pasted uid and the login token', async () => {
    await runLiveTest({
      _id: 't1', tag: 'ins_x_live', type: 'api', detail: 'live', status: true,
      hook_id: 'h1', hook_ids: ['h1'], sub_type: 'INSTALLMENT_CURRENT', value: 'data.installment.amount',
    });
    expect(svc.loginHook.mock.calls[0]?.[0]).toBe('h1');
    expect(svc.testExternalEndpoint).toHaveBeenCalledWith('h1', 'INSTALLMENT_CURRENT', UID, 'tok-1');
  });
  it('⭐ group scope: both go to the PRIMARY CREDENTIAL SOURCE OA (the form keeps hook_id on it)', async () => {
    await runLiveTest({
      _id: 't2', tag: 'ins_x_live2', type: 'api', detail: 'live', status: true,
      group_ids: ['g1'], hook_ids: ['h2'], primary_credential_source: 'h2',
      sub_type: 'INSTALLMENT_CURRENT', value: 'data.installment.amount',
    });
    expect(svc.loginHook.mock.calls[0]?.[0]).toBe('h2');
    expect(svc.testExternalEndpoint.mock.calls[0]?.slice(0, 4)).toEqual(['h2', 'INSTALLMENT_CURRENT', UID, 'tok-1']);
  });
});
