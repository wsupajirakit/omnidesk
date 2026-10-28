/**
 * [FEAT-20260829-STATUSFIRST] the per-side "prefer status in the night window" toggle
 * ===========================================================================
 * BE: `notice_deposit_sitestatus_first` / `notice_withdraw_sitestatus_first`,
 * default OFF (owner: "default ปิดห้ามเป็นหนี้"). This spec pins the FE half:
 * the toggle exists per side, the field survives the save round trip, and the
 * unsaved marker sees it — all three via `NOTICE_FORM_FIELDS`, which is the one
 * list every layer reads (save body, dirty marker, round trip).
 *
 * ⚠️ Proven by MUTATION, not by trusting green: written after the change, so the
 *    wiring was removed once to confirm every case here goes red, then restored.
 *
 * revert: drop the two toggles in HookNoticeTab, the two NOTICE_FORM_FIELDS
 *         entries, the two i18n keys, and this spec.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { updateHookNotice } = vi.hoisted(() => ({
  updateHookNotice: vi.fn().mockResolvedValue({}),
}));
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    webhookService: { ...actual.webhookService, updateHookNotice },
  };
});

import { HookNoticeTab } from '../components/hook/form/tabs/HookNoticeTab';
import { NOTICE_FORM_FIELDS } from '../components/hook/form/noticeCardGate';

const FORM = {
  notice_deposit_status: false,
  notice_withdraw_status: false,
  notice_deposit_scope: 'text',
  notice_withdraw_scope: 'text',
  notice_deposit_sitestatus_first: false,
  notice_withdraw_sitestatus_first: false,
};

function makeCtx(over: Record<string, unknown> = {}) {
  const state = { current: { ...FORM } as Record<string, unknown> };
  const ctx: any = {
    formData: state.current,
    setFormData: (fn: any) => {
      state.current = typeof fn === 'function' ? fn(state.current) : fn;
      ctx.formData = state.current;
    },
    isViewMode: false,
    t: (k: string) => k,
    inputClass: () => 'input',
    flexTemplates: [],
    hookId: 'HOOK1',
    setToast: () => {},
    noticeSavedRef: { current: null as string | null },
    noticeFlash: 0,
    ...over,
  };
  return { ctx, state };
}

describe('[STATUSFIRST-FE] the field list — the wire every layer shares', () => {
  it('⭐⭐ 🔴 both names are in NOTICE_FORM_FIELDS', () => {
    expect(NOTICE_FORM_FIELDS).toContain('notice_deposit_sitestatus_first');
    expect(NOTICE_FORM_FIELDS).toContain('notice_withdraw_sitestatus_first');
  });
});

describe('[STATUSFIRST-FE] the toggles', () => {
  it('⭐⭐ 🔴 one per side, both labelled by the shared key', () => {
    const { ctx } = makeCtx();
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    const labels = container.textContent?.match(/hook_form\.notice_sitestatus_first(?!_hint)/g);
    expect(labels).toHaveLength(2);
  });

  it('⭐⭐ 🔴 clicking the deposit one writes ONLY its own field', () => {
    const { ctx, state } = makeCtx();
    const { getAllByText } = render(<HookNoticeTab ctx={ctx} />);
    const label = getAllByText('hook_form.notice_sitestatus_first')[0];
    fireEvent.click(label.closest('label') ?? label);
    expect(state.current['notice_deposit_sitestatus_first']).toBe(true);
    expect(state.current['notice_withdraw_sitestatus_first']).toBe(false);
  });

  it('⭐⭐ the tab body sends the field to the notice route', async () => {
    const { ctx } = makeCtx({
      formData: { ...FORM, notice_deposit_sitestatus_first: true },
    });
    const { getByTestId } = render(<HookNoticeTab ctx={ctx} />);
    fireEvent.click(getByTestId('notice-save-button'));
    await waitFor(() => expect(updateHookNotice).toHaveBeenCalled());
    const body = updateHookNotice.mock.calls[0][1];
    expect(body['notice_deposit_sitestatus_first']).toBe(true);
  });

  it('⭐⭐ flipping it marks the tab unsaved — the marker reads the same list', () => {
    const ref = { current: null as string | null };
    render(<HookNoticeTab ctx={makeCtx({ noticeSavedRef: ref }).ctx} />).unmount();
    const edited = { ...FORM, notice_withdraw_sitestatus_first: true };
    const { container } = render(
      <HookNoticeTab ctx={makeCtx({ noticeSavedRef: ref, formData: edited }).ctx} />,
    );
    expect(container.textContent).toContain('hook_form.notice_unsaved');
  });
});
