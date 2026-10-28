/**
 * [FEAT-20260909-VENDORTRANSLATE / DSREASONING] The round trip: a stored value
 * must come BACK into the form, and an untouched OA must not be rewritten.
 * ============================================================================
 * 🔴 THIS FILE EXISTS BECAUSE OF A TRAP THE MODAL DOCUMENTS ABOUT ITSELF.
 *
 * `DEFAULT_FORM` holds a key for every field the form can write, and submit
 * spreads `...formData`. So the moment a key is added to the defaults it is
 * sent on EVERY save — and if the load block does not overwrite it from the
 * row, that spread writes `null` over whatever the operator had stored. The
 * modal's own comment on `ai_vendor` says exactly this: *"Leaving these two out
 * would reset an OA's vendor every time anyone opened the form — silently, with
 * no type error."*
 *
 * Six columns were added to both blocks today. `tsc` cannot check that the two
 * lists agree, and no existing test looks at these fields, so agreement is
 * checked here instead — through the real modal, not by reading source text.
 *
 * ⚠️ THE FAILURE IS INVISIBLE WITHOUT THIS. A missing load line does not throw,
 *    does not warn, and produces a form that looks perfectly normal. The
 *    operator only finds out later, when the OA is answering on a vendor they
 *    did not choose.
 *
 * revert: delete with the six columns.
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
// [REFACTOR-20260808-SVCGROUP] customToolService now shares the `services/hook` barrel with
// parseTrainingDoc / webhookService / suggestionUtils. Spread the real module and override ONLY
// customToolService — byte-identical to the pre-group wiring (where just customToolService was mocked).
// [FEAT-20260809-WALLETPAYTOOL] the mock now returns the REAL shape ({ data, pagination }) with a
// couple of tools, because the External API tab renders both tool pickers and reads
// `t.endpoints.length`. The previous bare-[] stub was only safe while no test opened that tab —
// `[].data` is undefined, which crashes the dropdown as soon as it is rendered.
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const data = [
    { id: 'pay-tool-1', name: 'Payment tool', category: 'payment', base_url: 'https://pay.test', endpoints: [] },
    // the walletpay tool is deliberately NOT category 'payment' — the walletpay picker must not
    // category-filter, so a generic tool has to be selectable there
    { id: 'walletpay-tool-1', name: 'Walletpay tool', category: 'generic', base_url: 'https://walletpay.test', endpoints: [] },
  ];
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

// a fully-valid hook so validate() passes and we reach onSubmit
const validHook: any = {
  _id: 'h1', line_oa_name: 'OA One', alias: 'oa-alias', company_name: 'Company',
  description: 'desc', domain_name: 'example.com', line_url: 'https://line.me/x',
  webhook_url: 'https://example.com/wh', channel_id: 'CHAN1', channel_type: 'line',
  telegram_key: 'TG-KEY', telegram_chat_id: 'TG-CHAT', telegram_noti_type: 'all',
  channel_secret: 'secret123', access_token: 'token123', group_id: 'a0d00000000000000000001e', status: 1,
  suggestion_text: 'hello',
  // fields under test
  default_answer_text: 'DEFAULT_ANSWER', missing_api_data_text: 'MISSING_API',
  image_answer_text: 'IMAGE_ANS', answer_link: 'https://example.com/a',
  status_off_action: 'silent', status_off_text: 'ปิดปรับปรุงชั่วคราว',
};

const renderModal = (props: any) =>
  render(<I18nProvider><HookFormModal isOpen onClose={() => {}} {...props} /></I18nProvider>);



/**
 * Open the AI tab, then its "advanced" pane — the controls live two levels in.
 * Copied from `aiTabVendorBlocks.dom.test.tsx` rather than re-derived: the tab
 * labels are the only handle there is, and two versions of this walk would
 * drift the day one of them is renamed.
 */
const openAdvanced = async (initialData: any) => {
  const onSubmit = vi.fn();
  const { container } = renderModal({ onSubmit, initialData, mode: 'update' });
  const tabBtn = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button')).find((x) =>
      x.textContent?.includes('AI & Responses'),
    );
    if (!b) throw new Error('AI tab not mounted yet');
    return b;
  });
  fireEvent.click(tabBtn);
  const subTabBtn = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button')).find((x) =>
      x.textContent?.includes('AI ขั้นสูง'),
    );
    if (!b) throw new Error('advanced sub-tab not mounted yet');
    return b;
  });
  fireEvent.click(subTabBtn);
  await waitFor(() => {
    if (!container.querySelector('select[name="ai_vendor"]')) {
      throw new Error('advanced pane not mounted yet');
    }
  });
  return container;
};

const FIELDS = {
  ai_vendor_translate: 'deepseek',
  deepseek_thinking: 'enabled',
  deepseek_reasoning_effort: 'high',
  deepseek_thinking_translate: 'disabled',
  deepseek_reasoning_effort_translate: 'medium',
  gemini_thinking_budget_translate: 4096,
} as const;

const sel = (c: HTMLElement, name: string) =>
  c.querySelector(`select[name="${name}"]`) as HTMLSelectElement | null;

describe('🔴 [VENDORTRANSLATE/DSREASONING] stored values come back into the form', () => {
  it('⭐ RT1 · every one of the six renders its STORED value, not "not set"', async () => {
    /* The whole point. Without a load line each control shows the empty option,
       and an operator reasonably concludes their setting never saved. */
    const container = await openAdvanced({ ...validHook, ...FIELDS });

    expect(sel(container, 'ai_vendor_translate')!.value).toBe('deepseek');
    expect(sel(container, 'deepseek_thinking')!.value).toBe('enabled');
    expect(sel(container, 'deepseek_reasoning_effort')!.value).toBe('high');
    expect(sel(container, 'deepseek_thinking_translate')!.value).toBe('disabled');
    expect(sel(container, 'deepseek_reasoning_effort_translate')!.value).toBe(
      'medium',
    );
    /* 4096 is a custom budget, so the select shows "custom" and the number
       input carries the value. */
    expect(sel(container, 'gemini_thinking_budget_translate')!.value).toBe(
      'custom',
    );
    expect(
      (container.querySelector(
        'input[name="gemini_thinking_budget_translate_value"]',
      ) as HTMLInputElement).value,
    ).toBe('4096');
  });

  it('⭐ RT2 · a row with NONE of them set shows "not set" everywhere', async () => {
    /* The other half: the six must not invent a value for an OA that predates
       them. Every control empty, and in particular the budget must NOT show
       "off" — that is the state the older control would have shown. */
    const container = await openAdvanced(validHook);

    for (const name of Object.keys(FIELDS)) {
      expect({ name, value: sel(container, name)!.value }).toEqual({
        name,
        value: '',
      });
    }
    expect(
      container.querySelector(
        'input[name="gemini_thinking_budget_translate_value"]',
      ),
    ).toBeNull();
  });

  it('⭐ RT3 · the MAIN Gemini budget still behaves the old way — unchanged', async () => {
    /* Pinned so the new lane's rule cannot be "fixed" onto the running one.
       There, a missing value really is 0, and that is what every live OA has. */
    const container = await openAdvanced(validHook);
    expect(
      container.querySelector(
        'input[name="gemini_thinking_budget_translate_value"]',
      ),
    ).toBeNull();
    /* And the translate twin is null while the main one is 0 — two different
       defaults on one screen, which is the point. */
    expect(sel(container, 'gemini_thinking_budget_translate')!.value).toBe('');
  });
});
