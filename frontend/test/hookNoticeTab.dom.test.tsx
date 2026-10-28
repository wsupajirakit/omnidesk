/* [FEAT-20260822-NOTICEMODE] the notice tab — what it SENDS, and what it refuses
 * to send.
 *
 * The tab writes on its own route, so the only thing that matters to the server
 * is the body it builds and when it builds it. These cases drive the real
 * component; only the network boundary is faked.
 * ⛔ No source file was changed to make them pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

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

const CARD_A = 'a'.repeat(24);
const CARD_B = 'b'.repeat(24);

const TEMPLATES = [
  { id: CARD_A, name: 'DEPWARN', flex_type: 'custom' },
  { id: CARD_B, name: 'WITHWARN', flex_type: 'custom' },
  { id: 'c'.repeat(24), name: 'A PROFILE CARD', flex_type: 'profile' },
];

/** a ctx with only what this tab reads — mirrors HookFormTabCtx's shape. */
function makeCtx(form: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const state = { current: { ...form } };
  const toasts: Array<{ message: string; type: string }> = [];
  const ctx: any = {
    formData: state.current,
    setFormData: (fn: any) => {
      state.current = typeof fn === 'function' ? fn(state.current) : fn;
      ctx.formData = state.current;
    },
    isViewMode: false,
    t: (k: string, v?: Record<string, unknown>) =>
      v ? `${k}:${JSON.stringify(v)}` : k,
    inputClass: () => 'input',
    flexTemplates: TEMPLATES,
    hookId: 'HOOK1',
    setToast: (v: any) => toasts.push(v),
    /* [FEAT-20260829-NOTICEUNSAVED] the snapshot moved onto the FORM, so the ctx
       this harness mirrors gained two fields. Seeded `null` = "the tab has never
       been opened", which is what a fresh mount really is; the tab fills it on
       first render, exactly as the real form does. `noticeFlash` at 0 = the main
       save has not asked for attention. */
    noticeSavedRef: { current: null as string | null },
    noticeFlash: 0,
    ...over,
  };
  return { ctx, toasts, state };
}

const saveButton = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('hook_form.notice_save'),
  ) as HTMLButtonElement;

const modalLines = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('li')).map((l) => l.textContent || '');

describe('⭐ the notice tab sends only its own fields', () => {
  beforeEach(() => updateHookNotice.mockClear());

  it('⭐ a complete state saves exactly the notice fields — nothing else from the form', async () => {
    const { ctx } = makeCtx({
      alias: 'my-oa', // a field from another tab: must NOT be sent
      notice_deposit_status: true,
      notice_deposit_scope: 'text',
      notice_deposit_flex_id: CARD_A,
      notice_deposit_offtime_flex_id: CARD_B,
    });
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(updateHookNotice).toHaveBeenCalledTimes(1));
    const [id, body] = updateHookNotice.mock.calls[0];
    expect(id).toBe('HOOK1');
    expect(Object.keys(body)).not.toContain('alias');
    expect(body).toMatchObject({
      notice_deposit_status: true,
      notice_deposit_flex_id: CARD_A,
      notice_deposit_offtime_flex_id: CARD_B,
    });
  });

  it('⭐ D16: a toggle without its cards opens the gate and sends NOTHING', async () => {
    const { ctx } = makeCtx({ notice_deposit_status: true });
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    fireEvent.click(saveButton(container));

    await waitFor(() => expect(modalLines(container).length).toBe(2));
    // the bullet glyph is part of the row markup — compare on the label text
    expect(modalLines(container).map((l) => l.replace('•', ''))).toEqual([
      'hook_form.notice_deposit_flex_id',
      'hook_form.notice_deposit_offtime_flex_id',
    ]);
    expect(updateHookNotice).not.toHaveBeenCalled();
  });

  it('⭐ the gate\'s way out switches the unready side OFF and then saves', async () => {
    const { ctx } = makeCtx({ notice_deposit_status: true });
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(modalLines(container).length).toBe(2));

    const disable = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('notice_gate_disable'),
    ) as HTMLButtonElement;
    fireEvent.click(disable);

    await waitFor(() => expect(updateHookNotice).toHaveBeenCalledTimes(1));
    expect(updateHookNotice.mock.calls[0][1]).toMatchObject({
      notice_deposit_status: false,
    });
  });

  it('⭐ scope slip reveals the two ALL cards, and they become required', async () => {
    const { ctx } = makeCtx({
      notice_deposit_status: true,
      notice_deposit_scope: 'slip',
      notice_deposit_flex_id: CARD_A,
      notice_deposit_offtime_flex_id: CARD_B,
    });
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    const names = Array.from(container.querySelectorAll('select')).map(
      (s) => s.getAttribute('name'),
    );
    expect(names).toContain('notice_all_offtime_flex_id');
    expect(names).toContain('notice_all_disable_flex_id');

    fireEvent.click(saveButton(container));
    await waitFor(() => expect(modalLines(container).length).toBe(2));
    expect(updateHookNotice).not.toHaveBeenCalled();
  });

  it('⭐ a card select lists custom cards only — plus whatever is already bound', () => {
    const bound = 'c'.repeat(24); // a profile-type card someone bound by hand
    const { ctx } = makeCtx({
      notice_deposit_status: true,
      notice_deposit_flex_id: bound,
    });
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    const select = container.querySelector(
      'select[name="notice_deposit_flex_id"]',
    ) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain(CARD_A); // custom
    expect(values).toContain(bound); // kept, though it is not custom
    expect(select.value).toBe(bound); // and it is still the selection
  });

  it('⭐ while the OA has no id the tab explains itself and cannot save', () => {
    const { ctx } = makeCtx({}, { hookId: undefined });
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    expect(container.textContent).toContain('notice_needs_saved_hook');
    expect(saveButton(container).disabled).toBe(true);
  });
});
