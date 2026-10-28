/* [FIX-20260822-NOTICEHARDEN] A CLONE TARGET THE BE SKIPPED MUST SAY WHY.
 *
 * The clone route has always answered per target — `{ ok, reason }` for
 * `not_found` · `different_group` · `forbidden` — but the modal read only the
 * warning fields, so a refusal arrived as a number ("failed: 1") and the
 * operator had to guess which OA and what for. The notice card gate on the BE
 * (hooks.service.ts, `notice_cards_incomplete`) added a refusal that happens in
 * ordinary use: a clone that would leave a notice toggle ON without every card
 * that side needs is skipped for THAT OA, and the rest of the batch proceeds.
 *
 * These cases drive the REAL modal; only the network boundary is faked.
 * ปลายทางที่ถูกข้าม ต้องขึ้นเหตุผลให้เห็น ไม่ใช่แค่ตัวเลข.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { cloneHookSettings } = vi.hoisted(() => ({
  cloneHookSettings: vi.fn(),
}));

const FIELD_TABS = [
  {
    key: 'general',
    label_th: 'ทั่วไป',
    label_en: 'General',
    field_count: 2,
    sensitive_fields: [],
    fields: [{ field: 'alias', label_key: 'hook_form.alias' }],
    sensitive_field_items: [],
  },
];

vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      getHookFieldTabs: () => Promise.resolve({ tabs: FIELD_TABS }),
      cloneHookSettings,
    },
  };
});

vi.mock('../services/admin', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    fetchVisibleGroups: () => Promise.resolve([]),
    filterVisibleHooks: (h: any[]) => h,
  };
});

import { HookCloneModal } from '../components/hook/HookCloneModal';
import { I18nProvider } from '../i18n';

const GROUP = 'g1';
const SOURCE = { _id: 'src', alias: 'source-oa', group: GROUP };
const TARGET = { _id: 'tgt', alias: 'target-oa', group: GROUP };

function renderModal() {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const view = render(
    <I18nProvider>
      <HookCloneModal
        isOpen
        onClose={onClose}
        onDone={onDone}
        source={SOURCE}
        allHooks={[SOURCE, TARGET]}
      />
    </I18nProvider>,
  );
  return { ...view, onClose, onDone };
}

/** every line the post-clone panel is showing. */
const panelLines = (c: HTMLElement): string[] =>
  Array.from(c.querySelectorAll('li')).map((l) => l.textContent || '');

const tabBoxes = (c: HTMLElement): HTMLInputElement[] =>
  Array.from(
    c.querySelectorAll(
      'input[type="checkbox"].accent-indigo-500, label.flex.min-w-0 input[type="checkbox"]',
    ),
  ) as HTMLInputElement[];

const primaryBtn = (c: HTMLElement, cls: string): HTMLButtonElement | null =>
  (c.querySelector(`button.${cls}`) as HTMLButtonElement) ?? null;

/** tick the one tab, pick the target, step 2, confirm, fire. */
const cloneOnce = async (c: HTMLElement) => {
  const tab = await waitFor(() => {
    const b = tabBoxes(c)[0];
    if (!b) throw new Error('tab checkbox not mounted yet');
    return b;
  });
  fireEvent.click(tab);

  const target = await waitFor(() => {
    const row = Array.from(c.querySelectorAll('label')).find((l) =>
      l.textContent?.includes('target-oa'),
    );
    const b = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined;
    if (!b) throw new Error('target checkbox not mounted yet');
    return b;
  });
  fireEvent.click(target);

  const next = await waitFor(() => {
    const b = primaryBtn(c, 'bg-emerald-600');
    if (!b || b.disabled) throw new Error('step-2 button not enabled yet');
    return b;
  });
  fireEvent.click(next);

  const confirm = await waitFor(() => {
    const b = c.querySelector('input.accent-red-500') as HTMLInputElement;
    if (!b) throw new Error('confirm tick not mounted yet');
    return b;
  });
  fireEvent.click(confirm);

  const go = await waitFor(() => {
    const b = primaryBtn(c, 'bg-red-600');
    if (!b || b.disabled) throw new Error('submit button not enabled yet');
    return b;
  });
  fireEvent.click(go);
  await waitFor(() => expect(cloneHookSettings).toHaveBeenCalledTimes(1), {
    timeout: 4000,
  });
};

describe('⭐ clone modal — a skipped target explains itself', () => {
  beforeEach(() => cloneHookSettings.mockReset());

  it('⭐ the notice card gate: the OA, the reason and the BE detail are all on screen', async () => {
    cloneHookSettings.mockResolvedValue({
      total: 1,
      success: 0,
      failed: 1,
      results: [
        {
          hook_id: 'tgt',
          alias: 'target-oa',
          ok: false,
          reason: 'notice_cards_incomplete',
          detail: 'deposit off-time notice needs a flex card before it can be on',
        },
      ],
    });
    const { container } = renderModal();
    await cloneOnce(container);

    const panel = await waitFor(() => {
      const el = Array.from(container.querySelectorAll('li')).find((l) =>
        l.textContent?.includes('target-oa'),
      );
      if (!el) throw new Error('warning row not rendered');
      return el;
    });
    // which OA · why (translated, not the raw key) · the BE's own words
    expect(panel.textContent).toContain('target-oa');
    expect(panel.textContent).toContain('โหมดแจ้งเตือน');
    expect(panel.textContent).not.toContain('hook_clone.fail_');
    expect(panel.textContent).toContain('deposit off-time notice');
  });

  it('⭐ a reason with no translation still names the OA and the raw reason', async () => {
    cloneHookSettings.mockResolvedValue({
      total: 1,
      success: 0,
      failed: 1,
      results: [{ hook_id: 'tgt', alias: 'target-oa', ok: false, reason: 'brand_new_reason' }],
    });
    const { container } = renderModal();
    await cloneOnce(container);

    const row = await waitFor(() => {
      const el = Array.from(container.querySelectorAll('li')).find((l) =>
        l.textContent?.includes('target-oa'),
      );
      if (!el) throw new Error('warning row not rendered');
      return el;
    });
    expect(row.textContent).toContain('brand_new_reason');
    /* ⚠️ `t()` answers with the KEY when a translation is missing, so a
       template-literal lookup renders `hook_clone.fail_brand_new_reason` —
       which still CONTAINS the reason. Without this line the case passes on
       the bug it exists to catch. คีย์ดิบห้ามโผล่บนจอ. */
    expect(row.textContent).not.toContain('hook_clone.fail_');
  });

  it('⭐ an all-clean clone closes and reports at once — the old path is untouched', async () => {
    cloneHookSettings.mockResolvedValue({
      total: 1,
      success: 1,
      failed: 0,
      results: [{ hook_id: 'tgt', alias: 'target-oa', ok: true, changed: 2 }],
    });
    const { container, onClose, onDone } = renderModal();
    await cloneOnce(container);
    /* ⚠️ asserting "no panel" alone is a case that SURVIVES deleting the
       feature — a clean clone never had a panel. What must hold is that the
       clean path still closes immediately and still reports its counts in the
       same tick. เทสต้องตายถ้าฟีเจอร์ถูกถอด ไม่ใช่ผ่านเพราะไม่มีอะไรเกิด. */
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalledWith({ success: 1, failed: 0 });
    expect(panelLines(container)).toEqual([]);
  });

  it('⭐ a target with NO alias is named from the picker, never as a raw id', async () => {
    /* 3 of the 4 reasons the BE emits (`not_found` · `different_group` ·
       `forbidden`) carry no alias — only `notice_cards_incomplete` does. */
    cloneHookSettings.mockResolvedValue({
      total: 1,
      success: 0,
      failed: 1,
      results: [{ hook_id: 'tgt', ok: false, reason: 'forbidden' }],
    });
    const { container } = renderModal();
    await cloneOnce(container);

    const lines = await waitFor(() => {
      const l = panelLines(container);
      if (!l.length) throw new Error('panel not rendered');
      return l;
    });
    expect(lines.join(' ')).toContain('target-oa');
    expect(lines.join(' ')).not.toContain('tgt:');
    expect(lines.join(' ')).toContain('ไม่มีสิทธิ์');
  });

  it('⭐ a mixed batch names ONLY the target that was skipped', async () => {
    cloneHookSettings.mockResolvedValue({
      total: 2,
      success: 1,
      failed: 1,
      results: [
        { hook_id: 'ok1', alias: 'good-oa', ok: true, changed: 3 },
        {
          hook_id: 'tgt',
          alias: 'target-oa',
          ok: false,
          reason: 'notice_cards_incomplete',
        },
      ],
    });
    const { container } = renderModal();
    await cloneOnce(container);

    const lines = await waitFor(() => {
      const l = panelLines(container);
      if (!l.length) throw new Error('panel not rendered');
      return l;
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('target-oa');
    expect(lines[0]).not.toContain('good-oa');
  });

  it('⭐ the count alert is HELD until the operator has read the panel', async () => {
    cloneHookSettings.mockResolvedValue({
      total: 1,
      success: 0,
      failed: 1,
      results: [
        { hook_id: 'tgt', alias: 'target-oa', ok: false, reason: 'forbidden' },
      ],
    });
    const { container, onClose, onDone } = renderModal();
    await cloneOnce(container);
    await waitFor(() => expect(panelLines(container).length).toBe(1));

    // the list page's alert (z-130) would cover this panel (z-80): not yet.
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const close = Array.from(container.querySelectorAll('button')).find((b) =>
      b.className.includes('bg-indigo-600'),
    ) as HTMLButtonElement;
    fireEvent.click(close);
    expect(onDone).toHaveBeenCalledWith({ success: 0, failed: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /* [FEAT-20261016-SLIPGUARDLOAN] the BE held this OA's slip provider (loan site, SlipGuard): the
     clone would have put a new provider beside the old provider's key, and the key was not
     ticked. The OA cloned fine otherwise — but the operator must learn the provider did NOT
     move, or they will think it did. BE rule: omnidesk-api hooks/hook-clone/slip-pair.ts. */
  it('⭐ a held slip provider is named on the panel (ok:true, changed>0)', async () => {
    cloneHookSettings.mockResolvedValue({
      total: 1,
      success: 1,
      failed: 0,
      results: [
        {
          hook_id: 'tgt',
          alias: 'target-oa',
          ok: true,
          changed: 2,
          slip_provider_held_without_key: true,
        },
      ],
    });
    const { container, onClose } = renderModal();
    await cloneOnce(container);
    const lines = await waitFor(() => {
      const l = panelLines(container);
      if (!l.length) throw new Error('panel not rendered');
      return l;
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('target-oa');
    expect(lines[0]).toContain('slip_verify_key');
    expect(onClose).not.toHaveBeenCalled();
  });
});
