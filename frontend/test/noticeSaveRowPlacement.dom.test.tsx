/**
 * [FEAT-20260829-NOTICEUNSAVED] the notice save row: where it sits, and its flash
 * ===========================================================================
 * Owner 29/08 — three asks and one bug, all on the notification tab.
 *
 * 🔴 THE ROW WAS THE LAST THING ON A TAB TALLER THAN THE SCREEN. The one control
 *    that stores these settings, and the only notice that they are still pending,
 *    were both below the fold — while the form's own save button sits at the top
 *    in plain sight and writes a DIFFERENT route. Moved directly under the
 *    case-reference button, which is the first thing after the intro.
 *
 * 🔴 THE MARKER USED TO LIE. Its snapshot was `useState` inside this tab, and the
 *    tab unmounts on every tab switch, so returning re-seeded it from the current
 *    form and it announced "saved" for a change never sent. It lives on the form
 *    now — asserted here by remounting, which is exactly what a tab switch does.
 *
 * ⚠️ The label lost "(ปุ่มนี้เท่านั้น)" per the owner; the key is asserted, not the
 *    Thai text, because the harness renders keys.
 *
 * revert: move the row back below the follower section, put the snapshot back in
 *         `useState`, and delete this spec.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    webhookService: { ...actual.webhookService, updateHookNotice: vi.fn().mockResolvedValue({}) },
  };
});

import { HookNoticeTab } from '../components/hook/form/tabs/HookNoticeTab';

const FORM = {
  notice_deposit_status: false,
  notice_withdraw_status: false,
  notice_deposit_scope: 'text',
  notice_withdraw_scope: 'text',
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
  return ctx;
}

describe('[NOTICEUNSAVED] the save row sits at the top', () => {
  it('⭐⭐ 🔴 it comes BEFORE the deposit section, not after the last one', () => {
    const { container } = render(<HookNoticeTab ctx={makeCtx()} />);
    const html = container.innerHTML;
    const row = html.indexOf('notice-save-row');
    const deposit = html.indexOf('hook_form.notice_section_deposit');
    expect(row).toBeGreaterThan(-1);
    expect(deposit).toBeGreaterThan(-1);
    expect(row).toBeLessThan(deposit);
  });

  it('⭐⭐ and AFTER the case-reference button it was asked to sit under', () => {
    const { container } = render(<HookNoticeTab ctx={makeCtx()} />);
    const html = container.innerHTML;
    expect(html.indexOf('เคส A–F')).toBeLessThan(html.indexOf('notice-save-row'));
  });
});

describe('[NOTICEUNSAVED] the marker survives a tab switch', () => {
  it('⭐⭐ 🔴 edited, unmounted, remounted ⇒ still says unsaved', () => {
    /* Remount IS the tab switch: `{activeTab === "notice" && <HookNoticeTab/>}`.
       With the snapshot back inside the tab this reads "synced" and the whole
       guard goes quiet from every other tab. */
    const ref = { current: null as string | null };
    const first = render(<HookNoticeTab ctx={makeCtx({ noticeSavedRef: ref })} />);
    first.unmount();

    /* a scope change, NOT a toggle: turning a side ON without its cards raises a
       card violation, and the row shows that instead — a different message and a
       different bug. This asserts the unsaved marker itself. */
    const edited = { ...FORM, notice_deposit_scope: 'all' };
    const ctx = makeCtx({ noticeSavedRef: ref, formData: edited });
    const { container } = render(<HookNoticeTab ctx={ctx} />);
    expect(container.textContent).toContain('hook_form.notice_unsaved');
    expect(container.textContent).not.toContain('hook_form.notice_synced');
  });

  it('⭐⭐ an untouched form still reads as synced — the marker must not cry wolf', () => {
    const ref = { current: null as string | null };
    render(<HookNoticeTab ctx={makeCtx({ noticeSavedRef: ref })} />).unmount();
    const { container } = render(<HookNoticeTab ctx={makeCtx({ noticeSavedRef: ref })} />);
    expect(container.textContent).toContain('hook_form.notice_synced');
  });
});

describe('[NOTICEUNSAVED] the flash', () => {
  it('⭐⭐ 🔴 a bump from the main save marks the button', () => {
    const { container } = render(<HookNoticeTab ctx={makeCtx({ noticeFlash: 1 })} />);
    const btn = container.querySelector('[data-testid="notice-save-button"]');
    expect(btn?.className).toContain('notice-save-flash');
  });

  it('⭐⭐ no bump ⇒ no flash, so an ordinary visit looks ordinary', () => {
    const { container } = render(<HookNoticeTab ctx={makeCtx()} />);
    const btn = container.querySelector('[data-testid="notice-save-button"]');
    expect(btn?.className).not.toContain('notice-save-flash');
  });
});
