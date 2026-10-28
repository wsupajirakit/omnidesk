/* [FEAT-20261026-RAGENGINE] The RAG engine controls on the hook form — drives the REAL modal.
 *
 * BE (omnidesk-api, lane demo) decides everything: `doc_retrieval === true` turns the
 * engine on per OA, and `rag_prompt_mode` / `rag_search_mode` tune it, with null meaning "the
 * engine's code default" (add + bm25). This file pins the FE half of "the default touches nobody":
 *   1. the old `doc_retrieval` block moved into `RagEngineSection.tsx` with its markup unchanged
 *      (structure snapshot taken on the code BEFORE the move);
 *   2. the two mode selects exist only while the switch is on;
 *   3. a hook that never had the fields submits null for both — never undefined, never a mode;
 *   4. what the operator picks survives the round trip, and '' goes out as null.
 * ค่าเริ่มต้นต้องไม่กระทบใคร · สวิตช์ปิด = ไม่มีตัวเลือกโผล่ · ไม่เคยตั้ง = ส่ง null
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── network boundary only — same stubs as HookFormModal.value.test.tsx ──
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
vi.mock('../services/apiClient', () => ({ API_BASE_URL: '', authFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }), handleApiResponse: () => Promise.resolve([]) }));
vi.mock('../services/authStorage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getAuthUser: () => ({ username: 'dev', role: 'superadmin', groups: [], permissions: ['system.manage'] }) };
});

import { HookFormModal } from '../components/hook';
import { buildHookPayload, diffHookPayload } from '../utils/hookFormPayload';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (global as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (window.HTMLElement.prototype as any).showPicker = vi.fn();
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

/** A hook that passes validate() and carries NONE of the three fields — like every stored row. */
const validHook: any = {
  _id: 'h1', line_oa_name: 'OA One', alias: 'oa-alias', company_name: 'Company',
  description: 'desc', domain_name: 'example.com', line_url: 'https://line.me/x',
  webhook_url: 'https://example.com/wh', channel_id: 'CHAN1', channel_type: 'line',
  telegram_key: 'TG-KEY', telegram_chat_id: 'TG-CHAT', telegram_noti_type: 'all',
  channel_secret: 'secret123', access_token: 'token123', group_id: 'a0d00000000000000000001e', status: 1,
  suggestion_text: 'hello',
};

const renderModal = (props: any) =>
  render(<I18nProvider><HookFormModal isOpen onClose={() => {}} {...props} /></I18nProvider>);

const findButton = (container: HTMLElement, label: string) =>
  waitFor(() => {
    const b = Array.from(container.querySelectorAll('button')).find(x => x.textContent?.includes(label));
    if (!b) throw new Error(`button "${label}" not mounted yet`);
    return b;
  });

/** AI tab → "AI ขั้นสูง" sub-tab: both gates are `&&`, so the controls are absent until then. */
const openAdvanced = async (container: HTMLElement) => {
  fireEvent.click(await findButton(container, 'AI & Responses'));
  fireEvent.click(await findButton(container, 'AI ขั้นสูง'));
  return waitFor(() => {
    const el = container.querySelector('select[name="doc_retrieval"]') as HTMLSelectElement;
    if (!el) throw new Error('doc_retrieval select not mounted yet');
    return el;
  });
};

const sel = (container: HTMLElement, name: string) =>
  container.querySelector(`select[name="${name}"]`) as HTMLSelectElement | null;

const submitClone = async (container: HTMLElement, onSubmit: ReturnType<typeof vi.fn>) => {
  const b = await waitFor(() => {
    const x = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    if (!x) throw new Error('submit button not mounted yet');
    return x;
  });
  fireEvent.click(b);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
  return onSubmit.mock.calls[0][0];
};

/** Tags + attributes + order, text replaced by '#' — the labels are allowed to change, the markup is not. */
const shape = (n: Node): string => {
  if (n.nodeType === Node.TEXT_NODE) return n.textContent?.trim() ? '#' : '';
  if (n.nodeType !== Node.ELEMENT_NODE) return '';
  const el = n as Element;
  const attrs = Array.from(el.attributes).map(a => `${a.name}="${a.value}"`).sort().join(' ');
  return `<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${Array.from(el.childNodes).map(shape).join('')}</${el.tagName.toLowerCase()}>`;
};

describe('[RAGENGINE] the doc_retrieval switch — moved, not changed', () => {
  it('🔴 PIN markup of the switch block is the pre-move markup (snapshot taken on the old code)', async () => {
    const { container } = renderModal({ onSubmit: vi.fn(), initialData: validHook, mode: 'update' });
    const select = await openAdvanced(container);
    expect(shape(select.closest('div')!)).toMatchSnapshot();
  });

  it('PIN the switch still sits right before the AI vendor block', async () => {
    const { container } = renderModal({ onSubmit: vi.fn(), initialData: validHook, mode: 'update' });
    const select = await openAdvanced(container);
    const block = select.closest('div')!;
    // the vendor select follows the switch (and, when on, the two mode selects) in the same grid
    const grid = block.parentElement!;
    const names = Array.from(grid.querySelectorAll('select')).map(s => s.getAttribute('name'));
    expect(names[0]).toBe('doc_retrieval');
    expect(names).toContain('ai_vendor');
  });
});

describe('[RAGENGINE] the two mode selects', () => {
  it('⭐ switch OFF (a hook that never had the field) ⇒ neither mode select exists', async () => {
    const { container } = renderModal({ onSubmit: vi.fn(), initialData: validHook, mode: 'update' });
    const select = await openAdvanced(container);
    expect(select.value).toBe('false');
    expect(sel(container, 'rag_prompt_mode')).toBeNull();
    expect(sel(container, 'rag_search_mode')).toBeNull();
  });

  it('⭐ turning the switch on reveals both, showing the default ("") for a hook that never set them', async () => {
    const { container } = renderModal({ onSubmit: vi.fn(), initialData: validHook, mode: 'update' });
    const select = await openAdvanced(container);
    fireEvent.change(select, { target: { value: 'true' } });
    await waitFor(() => expect(sel(container, 'rag_prompt_mode')).not.toBeNull());
    expect(sel(container, 'rag_prompt_mode')!.value).toBe('');
    expect(sel(container, 'rag_search_mode')!.value).toBe('');
  });

  it('⭐ a NEW hook starts with both at the default — pins DEFAULT_FORM (null), not a mode', async () => {
    const { container } = renderModal({ onSubmit: vi.fn(), mode: 'create' });
    const select = await openAdvanced(container);
    expect(select.value).toBe('false');
    fireEvent.change(select, { target: { value: 'true' } });
    await waitFor(() => expect(sel(container, 'rag_prompt_mode')).not.toBeNull());
    expect(sel(container, 'rag_prompt_mode')!.value).toBe('');
    expect(sel(container, 'rag_search_mode')!.value).toBe('');
  });

  it('the option values are exactly the BE enums plus "" — anything else is a 400 from the BE', async () => {
    const { container } = renderModal({
      onSubmit: vi.fn(), initialData: { ...validHook, doc_retrieval: true }, mode: 'update',
    });
    await openAdvanced(container);
    const values = (name: string) => Array.from(sel(container, name)!.options).map(o => o.value);
    expect(values('rag_prompt_mode')).toEqual(['', 'add', 'replace']);
    expect(values('rag_search_mode')).toEqual(['', 'bm25', 'hybrid']);
  });
});

describe('[RAGENGINE] round trip (clone path — it sends the whole payload)', () => {
  it('🔴 a hook without the fields submits null for both — never undefined, never a mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });
    const body = await submitClone(container, onSubmit);
    expect(body.doc_retrieval).toBe(false);
    expect(body).toHaveProperty('rag_prompt_mode', null);
    expect(body).toHaveProperty('rag_search_mode', null);
  });

  it('⭐ stored replace + hybrid load into the selects and go back out unchanged', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, doc_retrieval: true, rag_prompt_mode: 'replace', rag_search_mode: 'hybrid' },
      mode: 'create',
    });
    await openAdvanced(container);
    expect(sel(container, 'rag_prompt_mode')!.value).toBe('replace');
    expect(sel(container, 'rag_search_mode')!.value).toBe('hybrid');
    const body = await submitClone(container, onSubmit);
    expect(body.doc_retrieval).toBe(true);
    expect(body.rag_prompt_mode).toBe('replace');
    expect(body.rag_search_mode).toBe('hybrid');
  });

  it('picking the default ("") after a stored mode sends null — the BE then uses its code default', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, doc_retrieval: true, rag_prompt_mode: 'replace', rag_search_mode: 'bm25' },
      mode: 'create',
    });
    await openAdvanced(container);
    fireEvent.change(sel(container, 'rag_prompt_mode')!, { target: { value: '' } });
    fireEvent.change(sel(container, 'rag_search_mode')!, { target: { value: 'hybrid' } });
    const body = await submitClone(container, onSubmit);
    expect(body.rag_prompt_mode).toBeNull();
    expect(body.rag_search_mode).toBe('hybrid');
  });
});

describe('[RAGENGINE] the wire (buildHookPayload / diffHookPayload)', () => {
  const boxes = { general: 'g', company: 'c', noProfile: 'n' };
  const EDIT = { isCreate: false };
  const build = (over: Record<string, any>) => buildHookPayload({ ...validHook, ...over }, boxes, EDIT);

  it('🔴 "" and undefined go out as null — the BE reads null as its code default', () => {
    expect(build({ rag_prompt_mode: '', rag_search_mode: undefined })).toMatchObject({
      rag_prompt_mode: null, rag_search_mode: null,
    });
    expect(build({ rag_prompt_mode: 'replace', rag_search_mode: 'hybrid' })).toMatchObject({
      rag_prompt_mode: 'replace', rag_search_mode: 'hybrid',
    });
  });

  it('an edit that did not touch them omits them — nothing is rewritten', () => {
    const base = build({ doc_retrieval: true, rag_prompt_mode: 'add', rag_search_mode: null });
    expect(diffHookPayload(base, base)).toEqual({});
  });

  it('changing one mode sends exactly that one', () => {
    const before = build({ doc_retrieval: true, rag_prompt_mode: null, rag_search_mode: null });
    const after = build({ doc_retrieval: true, rag_prompt_mode: null, rag_search_mode: 'hybrid' });
    expect(diffHookPayload(after, before)).toEqual({ rag_search_mode: 'hybrid' });
  });

  it('clearing a stored mode sends null so the BE clears it', () => {
    const before = build({ doc_retrieval: true, rag_prompt_mode: 'replace' });
    const after = build({ doc_retrieval: true, rag_prompt_mode: '' });
    expect(diffHookPayload(after, before)).toEqual({ rag_prompt_mode: null });
  });
});
