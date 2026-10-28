/**
 * [FEAT-20261018-SITERULESWORLD] The OA form's Site Rules block follows the provider's world.
 * ===========================================================================
 * Owner 18/10/2026: the loan site has no site rules ⇒ hide the option there; keep it a flag per
 * provider (a future company that has site rules declares nothing and gets it) · shop-api untouched.
 *
 * The block = the switch "ส่ง Site Rules เข้า AI อัตโนมัติ…" (+ help + "ตัวอย่าง json" buttons and the
 * auto-inject hint) and the box "กฏการใช้ข้อมูล Site Rules". It lives at AI tab → Training Doc →
 * step "การช่วยตอบข้อมูล API" (`docStep === 'flexTag'`).
 *
 * BEFORE (written on the unchanged code): shop-api's block, markup frozen by a snapshot — the move
 * into `components/hook/form/tabs/SiteRulesToAiBlock.tsx` and the world rule must not change a byte.
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
  ai_raw_site_rules: true, ai_site_rules_guide: 'ใช้ข้อมูลเว็บตอบเรื่องยอดฝากขั้นต่ำ',
};

const byText = (c: HTMLElement, ...texts: string[]) =>
  Array.from(c.querySelectorAll('button')).find((b) => texts.some((t) => b.textContent?.includes(t)));

/** AI tab → (Training Doc, the default sub-tab) → step "การช่วยตอบข้อมูล API" */
const openStep = async () => {
  const { container } = render(
    <I18nProvider>
      <HookFormModal isOpen onClose={() => {}} onSubmit={vi.fn()} initialData={hook} mode="update" />
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

describe('[SITERULESWORLD] BEFORE — the block as it is today (shop-api)', () => {
  it('⭐ the switch and the guide box are on the step, with the saved values', async () => {
    const c = await openStep();
    await waitFor(() => expect(siteRulesSwitch(c)).toBeTruthy());
    expect(siteRulesSwitch(c)!.checked).toBe(true);
    expect(guideBox(c)!.value).toBe('ใช้ข้อมูลเว็บตอบเรื่องยอดฝากขั้นต่ำ');
  });
  it('⭐ markup frozen (shop-api)', async () => {
    const c = await openStep();
    await waitFor(() => expect(guideBox(c)).toBeTruthy());
    expect(blockHtml(c)).toMatchSnapshot();
  });
});

const LOAN_SILENCED = ['notice', 'followUp', 'register', 'payment', 'siteRules'];
/* [FEAT-20261018-SCREENSECTIONS] what the BE now hands the screen for loan (per section) */
const LOAN_HIDDEN = ['hook-form.site-rules', 'hook-form.customer-helper-card', 'hook-form.customer-link'];

describe('[SITERULESWORLD] the provider decides — loan hides the block, shop-api keeps it', () => {
  it('⭐ TARGET — loan (siteRules silenced): neither the switch nor the guide box is on the step', async () => {
    world.silenced = LOAN_SILENCED;
    world.hidden = LOAN_HIDDEN;
    const c = await openStep();
    await waitFor(() => expect(guideBox(c)).toBeNull());
    expect(siteRulesSwitch(c)).toBeUndefined();
  });
  it('⭐ PIN — shop-api (silences nothing): the block is there, markup identical to BEFORE', async () => {
    world.silenced = [];
    const c = await openStep();
    await waitFor(() => expect(guideBox(c)).toBeTruthy());
    expect(blockHtml(c)).toMatchSnapshot();
  });
  it('PIN — another section hidden but not this one: the block stays (per section, not per site)', async () => {
    world.silenced = ['notice', 'payment'];
    world.hidden = ['hook-form.customer-link'];
    const c = await openStep();
    await waitFor(() => expect(guideBox(c)).toBeTruthy());
  });
  it('🔴 PIN — while the route has not answered yet, the block is already there (shop-api never waits on this)', async () => {
    world.pending = true;
    const c = await openStep();
    await waitFor(() => expect(guideBox(c)).toBeTruthy());
  });
  it('🔴 PIN — an older back end (silenced, no `hidden`): nothing hidden, the block stays', async () => {
    world.silenced = LOAN_SILENCED;
    const c = await openStep();
    await waitFor(() => expect(guideBox(c)).toBeTruthy());
  });
  it('PIN — the route fails (older back end / 500): the block stays', async () => {
    world.fail = true;
    const c = await openStep();
    await waitFor(() => expect(guideBox(c)).toBeTruthy());
  });
});
