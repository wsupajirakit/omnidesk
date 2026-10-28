/* [P2-20260813] The clone modal's "vendor without key" flag — request-body tests.
 *
 * ⚠️ Written after review: the flag shipped with ZERO tests, and both bugs it
 *    found are ones a request-body assertion catches immediately —
 *      · the flag was sent even after the AI tab was deselected, so the checkbox
 *        that set it was off-screen and un-untickable while it nulled the
 *        target's key on a clone that never touched AI;
 *      · it was not reset between modal openings, so cloning OA-A with it ticked
 *        left it ticked when the operator reopened on OA-B.
 *    ทั้งสองเคสจบที่ "body ที่ยิงออกไปมีอะไรบ้าง" — เลยเทสต์ตรงนั้น.
 *
 * These drive the REAL modal: the only thing faked is the network boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// vi.mock is hoisted above every const, so the spy has to be hoisted with it.
const { cloneHookSettings } = vi.hoisted(() => ({
  cloneHookSettings: vi.fn().mockResolvedValue({ results: [] }),
}));

/** BE shape of GET /hook/field-tabs, trimmed to the two tabs these cases use. */
const FIELD_TABS = [
  {
    key: 'ai',
    label_th: 'AI',
    label_en: 'AI',
    field_count: 3,
    sensitive_fields: ['custom_ai_key'],
    fields: [{ field: 'ai_vendor', label_key: 'hook_form.ai_vendor' }],
    sensitive_field_items: [{ field: 'custom_ai_key', label_key: 'hook_form.custom_ai_key' }],
  },
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

function renderModal(isOpen = true) {
  const view = render(
    <I18nProvider>
      <HookCloneModal
        isOpen={isOpen}
        onClose={() => undefined}
        source={SOURCE}
        allHooks={[SOURCE, TARGET]}
      />
    </I18nProvider>,
  );
  /* ⚠️ Closing must NOT unmount: the component returns null while `isOpen` is
     false but STAYS MOUNTED (`HookCloneModal.tsx:268`), which is the whole
     reason the reset effect exists. A test that unmounts and re-renders proves
     nothing — React discards the state either way, so it passes with the reset
     deleted. Re-rendering with isOpen toggled is the real close/reopen.
     ปิดแล้วไม่ได้ถูก unmount — state ค้างอยู่จริง. */
  const setOpen = (open: boolean) =>
    view.rerender(
      <I18nProvider>
        <HookCloneModal
          isOpen={open}
          onClose={() => undefined}
          source={SOURCE}
          allHooks={[SOURCE, TARGET]}
        />
      </I18nProvider>,
    );
  return { ...view, setOpen };
}

/* Tab checkboxes render in FIELD_TABS order, so index beats text: the visible
   label is locale-dependent (`tabLabel` picks label_th under the th locale the
   provider defaults to) and matching on it made the test read as passing for
   the wrong reason. 0 = 'ai', 1 = 'general'. */
const TAB_AI = 0;
const TAB_GENERAL = 1;

const tabBoxes = (container: HTMLElement): HTMLInputElement[] =>
  Array.from(
    container.querySelectorAll('input[type="checkbox"].accent-indigo-500, label.flex.min-w-0 input[type="checkbox"]'),
  ) as HTMLInputElement[];

const toggleTab = async (container: HTMLElement, index: number) => {
  const box = await waitFor(() => {
    const boxes = tabBoxes(container);
    if (!boxes[index]) throw new Error(`tab checkbox ${index} not mounted yet`);
    return boxes[index];
  });
  fireEvent.click(box);
  return box;
};

/** The amber "vendor without key" checkbox, or null when the AI tab is off.
 *
 * ⚠️ `accent-amber-500` also styles the per-tab SENSITIVE-FIELD tick, so a bare
 *    class selector grabs that one instead and the test silently ticks
 *    `include_secrets: ['custom_ai_key']` — the opposite of what it means to
 *    assert. Scope by the flag's own label. (Caught by printing the body.) */
const vendorBox = (container: HTMLElement): HTMLInputElement | null => {
  const row = Array.from(container.querySelectorAll('label')).find((l) =>
    l.textContent?.includes('คัดลอกเฉพาะผู้ให้บริการ AI'),
  );
  return (row?.querySelector('input[type="checkbox"]') as HTMLInputElement) ?? null;
};

/** Target OA checkbox (emerald), the confirm tick (red), and the two buttons. */
const pickTarget = async (container: HTMLElement) => {
  /* `accent-emerald-500` also styles the step indicator and the force-grant tick,
     so scope to the row that carries the target's label. */
  const box = await waitFor(() => {
    const row = Array.from(container.querySelectorAll('label'))
      .find((l) => l.textContent?.includes('target-oa'));
    const b = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined;
    if (!b) throw new Error('target checkbox not mounted yet');
    return b;
  });
  fireEvent.click(box);
};

/* The footer renders ONE primary button, swapped by step (`step === 1 ? … : …`):
   emerald "next" on step 1, red "do clone" on step 2. Selecting on that colour
   is what distinguishes them — position does not, since only one exists. */
const primaryBtn = (container: HTMLElement, cls: string): HTMLButtonElement | null =>
  (container.querySelector(`button.${cls}`) as HTMLButtonElement) ?? null;

/** Step 1 → step 2. The vendor flag lives on the CONFIRM screen, beside the
 *  confirm tick — not on the tab picker. */
const goToStep2 = async (container: HTMLElement) => {
  const next = await waitFor(() => {
    const b = primaryBtn(container, 'bg-emerald-600');
    if (!b || b.disabled) throw new Error('step-2 button not enabled yet');
    return b;
  });
  fireEvent.click(next);
};

/** Step 2 → step 1, via the Back button that makes the stale-flag path real. */
const goBackToStep1 = async (container: HTMLElement) => {
  // Back and Cancel share `border-slate-300`, so select on the label; the two
  // translations are distinct ("ย้อนกลับ" vs "ยกเลิก").
  const back = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button'))
      .find((x) => x.textContent?.trim() === 'ย้อนกลับ');
    if (!b) throw new Error('back button not mounted yet');
    return b as HTMLButtonElement;
  });
  fireEvent.click(back);
};

/** Tick the confirm and fire, then read the body the service actually received. */
const submitFromStep2 = async (container: HTMLElement) => {
  const confirm = await waitFor(() => {
    const b = container.querySelector('input.accent-red-500') as HTMLInputElement;
    if (!b) throw new Error('confirm tick not mounted yet');
    return b;
  });
  fireEvent.click(confirm);

  const go = await waitFor(() => {
    const b = primaryBtn(container, 'bg-red-600');
    if (!b || b.disabled) throw new Error('submit button not enabled yet');
    return b;
  });
  fireEvent.click(go);

  await waitFor(() => expect(cloneHookSettings).toHaveBeenCalledTimes(1), { timeout: 4000 });
  return cloneHookSettings.mock.calls[0][1] as Record<string, unknown>;
};

describe('[P2 CLONE] the vendor-without-key flag reaches the request honestly', () => {
  beforeEach(() => cloneHookSettings.mockClear());

  /** Tabs + target on step 1, then straight to the confirm screen. */
  const setupToStep2 = async (tabIndex = TAB_AI) => {
    const view = renderModal();
    await toggleTab(view.container, tabIndex);
    await pickTarget(view.container);
    await goToStep2(view.container);
    return view;
  };

  const tickVendorOnly = async (container: HTMLElement) => {
    const box = await waitFor(() => {
      const b = vendorBox(container);
      if (!b) throw new Error('vendor checkbox not mounted yet');
      return b;
    });
    fireEvent.click(box);
    expect(vendorBox(container)?.checked).toBe(true);
  };

  it('ticked with the AI tab selected: the flag IS sent (the feature still works)', async () => {
    const { container } = await setupToStep2();
    await tickVendorOnly(container);
    const body = await submitFromStep2(container);
    expect(body['tabs']).toEqual(['ai']);
    expect(body['ai_vendor_without_key']).toBe(true);
  });

  it('not ticked: the flag is absent entirely, not sent as false', async () => {
    const { container } = await setupToStep2();
    const body = await submitFromStep2(container);
    expect(body).not.toHaveProperty('ai_vendor_without_key');
  });

  it('the flag is not even offered when the AI tab was not selected', async () => {
    const { container } = await setupToStep2(TAB_GENERAL);
    expect(vendorBox(container)).toBeNull();
  });

  it('⭐ ticking it, going Back and dropping the AI tab clears it from the BODY', async () => {
    /* The real path to the bug: the flag lives on the CONFIRM screen, so an
       operator ticks it, presses Back, swaps the AI tab for another one, and
       proceeds. The checkbox is gone from the screen but its state survived, so
       the body carried ai_vendor_without_key:true with tabs:['general'] —
       nulling the target OA's key on a clone that never touched AI, with no
       visible control left to untick.
       ⚠️ The assertion is on the BODY, not the DOM: the checkbox unmounting is
          the ORIGINAL behaviour, so a DOM assertion passes with the fix
          reverted (verified by mutation) and proves nothing. */
    const { container } = await setupToStep2();
    await tickVendorOnly(container);

    await goBackToStep1(container);
    await toggleTab(container, TAB_AI);      // AI off
    await toggleTab(container, TAB_GENERAL); // something else on
    await goToStep2(container);

    expect(vendorBox(container)).toBeNull();
    const body = await submitFromStep2(container);
    expect(body['tabs']).toEqual(['general']);
    expect(body).not.toHaveProperty('ai_vendor_without_key');
  });

  it('⭐ reopening the modal does not carry the tick over to the next OA', async () => {
    /* The reset effect explicitly clears provisionHandoff / forceGrant /
       selectedSecrets "กันค่าค้างจากรอบก่อน" — this flag was omitted, so an
       operator who cloned OA-A with it ticked would silently wipe OA-B's key. */
    const view = await setupToStep2();
    await tickVendorOnly(view.container);

    // Close and reopen the SAME mounted modal — what the operator really does.
    view.setOpen(false);
    view.setOpen(true);

    // Reopening resets to step 1, so drive the flow again on the same instance.
    await toggleTab(view.container, TAB_AI);
    await pickTarget(view.container);
    await goToStep2(view.container);

    expect(vendorBox(view.container)?.checked).toBe(false);
    const body = await submitFromStep2(view.container);
    expect(body).not.toHaveProperty('ai_vendor_without_key');
  });
});
