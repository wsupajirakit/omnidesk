/**
 * [FEAT-20261018-HELPERWORLD] + [FIX-20261018-WEBHOOKURLREQ] — the OA form, owner 18/10/2026.
 * ===========================================================================
 * 1. The customer-helper card picker (AI tab → Training Doc → "การช่วยตอบข้อมูล API") is part of
 *    the provider's `register` world: loan silences it ⇒ hidden ("ซ่อนการ์ดสำหรับ loan"); shop-api
 *    and any provider that declares nothing keep it. Its label/hint were wrong for every
 *    provider ("แก้ไข label คำอธิบาย … มันแสดงผิด") — the card also answers OA reply texts, and
 *    the BE sends only a card in the OA's OWN group (`customer-helper-flex.ts` sameGroup).
 * 2. Saving an OA created outside the form (API / tool mint — no `webhook_url`) failed with
 *    "Webhook URL — จำเป็นต้องกรอก" on a field the form never renders.
 * Harness = `siteRulesToAiBlock.dom.test.tsx`'s (real form, only the network mocked).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

/* the provider route — per test; every other call answers [] like the AI-tab harness */
const world = vi.hoisted(() => ({ silenced: [] as string[] | null, hidden: null as string[] | null, fail: false, pending: false }));
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: (url: string) =>
    String(url).endsWith('/api/customer-provider/features')
      ? world.pending ? new Promise(() => {}) : Promise.resolve(world.fail
        ? { ok: false, status: 500, json: () => Promise.resolve({}) }
        : { ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { silenced: world.silenced, ...(world.hidden ? { hidden: world.hidden } : {}) } }) })
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }),
  handleApiResponse: () => Promise.resolve([]),
}));
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
  return {
    ...actual,
    customToolService: {
      listCustomTools: () => Promise.resolve({ data: [], pagination: { page: 1, limit: 200, total: 0, pages: 1 } }),
      list: () => Promise.resolve({ data: [], pagination: {} }),
      getUsage: () => Promise.resolve({ count: 0, active: 0, hooks: [] }),
    },
  };
});
vi.mock('../services/authStorage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getAuthUser: () => ({ username: 'dev', role: 'superadmin', groups: [], permissions: ['system.manage'] }) };
});

import { HookFormModal } from '../components/hook';
import { resetProviderHiddenSections } from '../services/chat/providerFeatures';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (global as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (window.HTMLElement.prototype as any).showPicker = vi.fn();
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, media: '' });
});

const hook: any = {
  _id: 'h1', line_oa_name: 'OA One', alias: 'oa-alias', company_name: 'Company',
  channel_type: 'line', group_id: 'a0d00000000000000000001e', status: 1,
  suggestion_text: 'hello',
  domain_name: 'https://example.com', line_url: 'https://lin.ee/x', channel_id: '2000000001', channel_secret: 'sec', access_token: 'tok',
  /* no webhook_url — like every OA created outside the form (API, tool mint) */
};

const byText = (c: HTMLElement, ...texts: string[]) =>
  Array.from(c.querySelectorAll('button')).find((b) => texts.some((t) => b.textContent?.includes(t)));

/** AI tab → (Training Doc, the default sub-tab) → step "การช่วยตอบข้อมูล API" */
const openStep = async (onSubmit = vi.fn()) => {
  const { container } = render(
    <I18nProvider>
      <HookFormModal isOpen onClose={() => {}} onSubmit={onSubmit} initialData={hook} mode="update" />
    </I18nProvider>,
  );
  const ai = await waitFor(() => { const b = byText(container, 'AI & Responses'); if (!b) throw new Error('AI tab'); return b; });
  fireEvent.click(ai);
  const step = await waitFor(() => { const b = byText(container, 'การช่วยตอบข้อมูล API', 'API data reply'); if (!b) throw new Error('flexTag step'); return b; });
  fireEvent.click(step);
  await waitFor(() => { if (!container.querySelector('select[name="flex_customerhelper_id"], select')) throw new Error('step pane'); });
  return container;
};
const siteRulesSwitch = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('input[type="checkbox"]')).find((i) =>
    i.closest('label')?.textContent?.includes('Site Rules')) as HTMLInputElement | undefined;
const guideBox = (c: HTMLElement) => c.querySelector('textarea[name="ai_site_rules_guide"]') as HTMLTextAreaElement | null;
/** the block's markup: the switch's column + the guide's column */
const blockHtml = (c: HTMLElement) =>
  [siteRulesSwitch(c)?.closest('.md\\:col-span-2'), guideBox(c)?.closest('.md\\:col-span-2')]
    .map((el) => el?.outerHTML ?? '(missing)').join('\n');

beforeEach(() => { world.silenced = []; world.hidden = null; world.fail = false; world.pending = false; resetProviderHiddenSections(); });

const picker = (c: HTMLElement) => c.querySelector('select[name="flex_customerhelper_id"]') as HTMLSelectElement | null;
const LOAN_SILENCED = ['notice', 'followUp', 'register', 'payment', 'siteRules'];
const LOAN_HIDDEN = ['hook-form.site-rules', 'hook-form.customer-helper-card', 'hook-form.customer-link'];

describe('[HELPERWORLD] the customer-helper card picker follows the provider\'s hidden sections', () => {
  it('⭐ shop-api (silences nothing): the picker is on the step, with the corrected label and hint', async () => {
    const c = await openStep();
    await waitFor(() => expect(picker(c)).toBeTruthy());
    const box = picker(c)!.closest('div')!;
    expect(box.textContent).toMatch(/\[\[\[customer-helper\]\]\]/);
    /* the old hint claimed "your groups"; the BE sends only a card in THIS OA's group */
    expect(box.textContent).toMatch(/กลุ่มเดียวกับ OA นี้|same group as this OA/);
    expect(box.textContent).toMatch(/ข้อความตอบกลับของ OA|OA reply text/);
  });
  it('⭐ TARGET — loan (register silenced): no picker', async () => {
    world.silenced = LOAN_SILENCED;
    world.hidden = LOAN_HIDDEN;
    const c = await openStep();
    await waitFor(() => expect(c.querySelector('textarea[name="customer_helper_text"], select')).toBeTruthy());
    await waitFor(() => expect(picker(c)).toBeNull());
  });
  it('PIN — another section hidden but not this one: the picker stays', async () => {
    world.silenced = ['siteRules', 'payment'];
    world.hidden = ['hook-form.site-rules'];
    const c = await openStep();
    await waitFor(() => expect(picker(c)).toBeTruthy());
  });
  it('🔴 PIN — the route has not answered yet: the picker is already there', async () => {
    world.pending = true;
    const c = await openStep();
    await waitFor(() => expect(picker(c)).toBeTruthy());
  });
  it('🔴 PIN — an older back end (silenced, no `hidden`): nothing hidden, the picker stays', async () => {
    world.silenced = LOAN_SILENCED;
    const c = await openStep();
    await waitFor(() => expect(picker(c)).toBeTruthy());
  });
  it('PIN — the route fails: the picker stays', async () => {
    world.fail = true;
    const c = await openStep();
    await waitFor(() => expect(picker(c)).toBeTruthy());
  });
});

describe('[WEBHOOKURLREQ] an OA with no webhook_url saves (the form has no input for it)', () => {
  it('⭐ edit + Save on an OA created outside the form reaches onSubmit — no "Webhook URL required"', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const c = await openStep(onSubmit);
    fireEvent.submit(c.querySelector('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('webhook_url');
  });
});
