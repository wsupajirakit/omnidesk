/**
 * [FEAT-20261018-EXTAPICARDS] The OA form's External API tab — layout only, owner 18/10/2026.
 * ===========================================================================
 * Asked: Custom Tool becomes its own card at the same level as Customer Link, placed before it ·
 * grey cards white (light theme only) and spaced so each topic reads as its own card · every
 * card folds, open by default · loan hides the Customer Link card (BE `hidden` sections) ·
 * "ห้ามกระทบส่วนอื่น x api ทำงานได้เหมือนเดิม".
 *
 * BEFORE (written on the unchanged code): every control in the tab and its value, and the
 * payload a Custom Tool bind saves — frozen. The layout may move cards; it may not add, drop or
 * change a single control, and the saved payload must be byte-identical.
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
      listCustomTools: () => Promise.resolve({ data: [
        { id: 't1', name: 'loan_demo', base_url: 'https://demo.example', endpoints: [{}, {}], category: 'generic', status: 'active' },
        { id: 'p1', name: 'pay_tool', base_url: 'https://pay.example', endpoints: [{}], category: 'payment', status: 'active' },
      ], pagination: { page: 1, limit: 200, total: 2, pages: 1 } }),
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

/** OA form (edit) → tab "External API" — returns the tab's own panel */
const openExternalTab = async (over: Record<string, unknown> = {}, onSubmit = vi.fn()) => {
  const { container } = render(
    <I18nProvider>
      <HookFormModal isOpen onClose={() => {}} onSubmit={onSubmit} initialData={{ ...hook, ...over }} mode="update" />
    </I18nProvider>,
  );
  const tab = await waitFor(() => { const b = byText(container, 'External API'); if (!b) throw new Error('tab'); return b; });
  fireEvent.click(tab);
  const panel = await waitFor(() => {
    const h = Array.from(container.querySelectorAll('h4')).find((x) => x.textContent === 'External API Configuration');
    const p = h?.closest('.animation-slide-in') as HTMLElement | null;
    if (!p) throw new Error('panel'); return p;
  });
  /* tool options arrive async — wait until the data-tool select lists loan_demo */
  await waitFor(() => { if (!panel.textContent?.includes('loan_demo')) throw new Error('tools'); });
  return { container, panel };
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

/** every control in the tab as "tag:type|name-or-label|value", sorted — cards may move, controls may not change */
const controls = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll('input, select, textarea')).map((el) => {
    const e = el as HTMLInputElement;
    const label = e.name || e.closest('label')?.textContent?.trim() || e.getAttribute('placeholder') || '?';
    const val = e.type === 'checkbox' ? String(e.checked) : e.value;
    return `${e.tagName.toLowerCase()}:${e.type || ''}|${label}|${val}`;
  }).sort();
/** open every folded card first (a folded payment-flex block does not render its selects) —
 *  BEFORE some start folded, AFTER all start open; either way the list is taken fully open */
const expandAll = async (panel: HTMLElement) => {
  for (const b of Array.from(panel.querySelectorAll('button[aria-expanded="false"]'))) fireEvent.click(b);
  await waitFor(() => expect(panel.querySelectorAll('button[aria-expanded="false"]').length).toBe(0));
};
const toolSwitch = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll('input[type="checkbox"]')).find((i) =>
    i.closest('label')?.textContent?.includes('เปิดใช้ tool')) as HTMLInputElement;
const toolSelect = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => o.value === 't1')) as HTMLSelectElement;

describe('[EXTAPICARDS] BEFORE — shop-api: the controls and what a Custom Tool bind saves', () => {
  it('⭐ Customer Link OFF: every control in the tab, frozen', async () => {
    const { panel } = await openExternalTab();
    await expandAll(panel);
    expect(controls(panel)).toMatchSnapshot();
  });
  it('⭐ Customer Link ON: every control in the tab, frozen', async () => {
    const { panel } = await openExternalTab({ customer_link_enabled: true, customer_link_web_code: 'sim_alpha' });
    await expandAll(panel);
    expect(controls(panel)).toMatchSnapshot();
  });
  it('⭐ tick "เปิดใช้ tool" + choose a tool + Save ⇒ the payload is exactly the two binding fields', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container, panel } = await openExternalTab({}, onSubmit);
    fireEvent.click(toolSwitch(panel));
    fireEvent.change(toolSelect(panel), { target: { value: 't1' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ custom_tool_status: true, custom_tool_id: 't1' });
  });
});

const LOAN_HIDDEN = ['hook-form.site-rules', 'hook-form.customer-helper-card', 'hook-form.customer-link'];
const heading = (panel: HTMLElement, text: string) =>
  Array.from(panel.querySelectorAll('h4, h5')).find((h) => h.textContent?.trim().startsWith(text)) as HTMLElement | undefined;
const CUSTOM_TOOL = 'Custom Tool (ปลายทาง + credential + path)';
const CUSTOMER_LINK = 'Customer Link (ลงทะเบียนผ่านแชท)';

describe('[EXTAPICARDS] TARGET — the new layout', () => {
  it('⭐ Custom Tool is its own card, BEFORE Customer Link, and no longer inside it', async () => {
    const { panel } = await openExternalTab({ customer_link_enabled: true });
    const tool = heading(panel, CUSTOM_TOOL)!;
    const link = heading(panel, CUSTOMER_LINK)!;
    expect(tool && link).toBeTruthy();
    expect(tool.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.closest('.extapi-card')!.contains(tool)).toBe(false);
  });
  it('⭐ every card folds and starts open; folding hides the body without unmounting it', async () => {
    const { panel } = await openExternalTab();
    const folds = Array.from(panel.querySelectorAll('button[aria-expanded]'));
    expect(folds.length).toBeGreaterThanOrEqual(5);
    expect(folds.map((b) => b.getAttribute('aria-expanded'))).toEqual(folds.map(() => 'true'));
    const toolFold = heading(panel, CUSTOM_TOOL)!.closest('button')!;
    fireEvent.click(toolFold);
    expect(toolFold.getAttribute('aria-expanded')).toBe('false');
    expect(toolSelect(panel).closest('.hidden')).toBeTruthy();
    expect(toolSwitch(panel).closest('.hidden')).toBeNull(); /* the switch stays visible while folded */
  });
  it('⭐ the cards carry the white light-theme shell (`.extapi-card`)', async () => {
    const { panel } = await openExternalTab();
    for (const t of [CUSTOM_TOOL, CUSTOMER_LINK, 'Custom API Endpoints', 'External API Configuration']) {
      /* the card's OWN shell (nearest rounded card), not an outer one that happens to be white */
      const shell = heading(panel, t)?.closest('.rounded-2xl');
      expect({ t, white: !!shell?.classList.contains('extapi-card') }).toEqual({ t, white: true });
    }
  });
});

describe('[SCREENSECTIONS] the Customer Link card follows the BE `hidden` sections', () => {
  it('⭐ TARGET — loan: no Customer Link card; Custom Tool is there and still saves the binding', async () => {
    world.silenced = ['notice', 'followUp', 'register', 'payment', 'siteRules'];
    world.hidden = LOAN_HIDDEN;
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container, panel } = await openExternalTab({}, onSubmit);
    await waitFor(() => expect(heading(panel, CUSTOMER_LINK)).toBeUndefined());
    fireEvent.click(toolSwitch(panel));
    fireEvent.change(toolSelect(panel), { target: { value: 't1' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ custom_tool_status: true, custom_tool_id: 't1' });
  });
  it('🔴 PIN — shop-api (hidden: []): the Customer Link card is there', async () => {
    world.hidden = [];
    const { panel } = await openExternalTab();
    expect(heading(panel, CUSTOMER_LINK)).toBeTruthy();
  });
  it('🔴 PIN — an older back end (no `hidden`): the Customer Link card is there', async () => {
    world.silenced = ['register'];
    const { panel } = await openExternalTab();
    expect(heading(panel, CUSTOMER_LINK)).toBeTruthy();
  });
});
