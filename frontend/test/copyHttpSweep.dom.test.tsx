/**
 * [FIX-20260830-COPYHTTP2] the swept copy buttons, exercised on an http page.
 *
 * `test/clipboardSweep.value.test.ts` proves nobody CALLS the raw API any more.
 * That is a source rule; it says nothing about whether the success UI is gated
 * on the real result. These render one component per pattern found in the
 * sweep, with the Clipboard API removed the way plain http removes it, and
 * check both directions: the value reaches the clipboard, and a refused copy
 * never lights the success UI.
 *
 * Patterns covered:
 *   A  async handler + `if (!ok) return`      → JsonModal (tick)
 *   B  await + explicit else branch           → RawJsonRulesHelp (callbacks)
 *   C  inline `void copyText(x).then(...)`    → FlexCardMultiSelect (toast)
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { JsonModal } from '../components/modals/JsonModal';
import { RawJsonRulesHelp } from '../components/hook/RawJsonRulesHelp';
import { FlexCardMultiSelect } from '../components/hook/form/FlexCardMultiSelect';
import { I18nProvider } from '../i18n';

const realExec = (document as unknown as { execCommand?: unknown }).execCommand;
const realClip = navigator.clipboard;

afterEach(() => {
  (document as unknown as { execCommand?: unknown }).execCommand = realExec;
  Object.defineProperty(navigator, 'clipboard', { value: realClip, configurable: true });
});

/** strip the Clipboard API, exactly as a plain-http page does */
const asHttpPage = () =>
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

/** legacy path that works, capturing what it was handed */
const execWorks = () => {
  const seen: string[] = [];
  (document as unknown as { execCommand: () => boolean }).execCommand = () => {
    seen.push(document.querySelector('textarea')?.value ?? '');
    return true;
  };
  return seen;
};

/** legacy path the browser refuses */
const execRefuses = () => {
  (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
};

/* ── A: async handler that returns early ─────────────────────────────────── */
describe('JsonModal copy (pattern A — the tick)', () => {
  const open = () =>
    render(
      <I18nProvider>
        <JsonModal isOpen data={{ hello: 'world' }} onClose={vi.fn()} />
      </I18nProvider>,
    );

  const pressCopy = () => {
    /* the copy button carries only an icon and no label, so it is taken by
       position: it is the FIRST of the modal's two buttons, the second being
       the close X (JsonModal.tsx renders them in that order) */
    fireEvent.click(screen.getAllByRole('button')[0]!);
  };

  it('⭐ on http the JSON still reaches the clipboard', async () => {
    asHttpPage();
    const seen = execWorks();
    open();
    pressCopy();
    await waitFor(() => expect(seen[0]).toBe(JSON.stringify({ hello: 'world' }, null, 2)));
  });

  it('⭐ a refused copy never shows the copied state', async () => {
    asHttpPage();
    execRefuses();
    const { container } = open();
    const before = container.innerHTML;
    pressCopy();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe(before);
  });
});

/* ── B: await + an explicit failure branch ───────────────────────────────── */
describe('RawJsonRulesHelp copy (pattern B — success/failure callbacks)', () => {
  const mount = (onCopied: () => void, onCopyFailed: () => void) =>
    render(
      <I18nProvider>
        <RawJsonRulesHelp onCopied={onCopied} onCopyFailed={onCopyFailed} />
      </I18nProvider>,
    );

  it('⭐ on http the sample copies and reports success', async () => {
    asHttpPage();
    const seen = execWorks();
    const ok = vi.fn();
    const bad = vi.fn();
    mount(ok, bad);
    fireEvent.click(screen.getAllByRole('button')[0]!);

    await waitFor(() => expect(ok).toHaveBeenCalledTimes(1));
    expect(bad).not.toHaveBeenCalled();
    /* the old code reported FAILURE here on every press, because the raw API
       threw before it could copy anything — the sample was uncopyable */
    expect(seen[0]).toContain('RAW_JSON_PROFILE_START');
  });

  it('a genuinely refused copy still reports failure', async () => {
    asHttpPage();
    execRefuses();
    const ok = vi.fn();
    const bad = vi.fn();
    mount(ok, bad);
    fireEvent.click(screen.getAllByRole('button')[0]!);

    await waitFor(() => expect(bad).toHaveBeenCalledTimes(1));
    expect(ok).not.toHaveBeenCalled();
  });
});

/* ── C: inline .then() in JSX ────────────────────────────────────────────── */
describe('FlexCardMultiSelect copy (pattern C — the toast)', () => {
  const templates = [{ id: 't1', name: 'Card One', flex_tag: 'ONE' }] as any[];

  const mount = (onCopyToast: (m: string, k: string) => void) =>
    render(
      <FlexCardMultiSelect
        label="Flex cards"
        hint="pick some"
        emptyText="no cards"
        placeholder="choose…"
        tagModalTitle="Tags"
        tagModalFooter="footer note"
        templates={templates}
        picked={['t1']}
        isViewMode={false}
        onChange={vi.fn()}
        onCopyToast={onCopyToast}
        copyFailMsg="copy failed"
        {...({} as any)}
      />,
    );

  /** the tag panel has to be opened before the copy button exists */
  const openTagsThenCopy = () => {
    for (const b of screen.getAllByRole('button')) fireEvent.click(b);
    const copyBtn = screen.queryAllByRole('button').find((b) => /คัดลอก/.test(b.textContent ?? ''));
    expect(copyBtn, 'the copy button should be reachable').toBeTruthy();
    fireEvent.click(copyBtn!);
  };

  it('⭐ on http it copies and toasts success — the old .catch could not even run', async () => {
    asHttpPage();
    const seen = execWorks();
    const toast = vi.fn();
    mount(toast);
    openTagsThenCopy();

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('คัดลอก'), 'success'));
    expect(seen[0]).toContain('ONE');
  });

  it('a refused copy toasts the failure message, not success', async () => {
    asHttpPage();
    execRefuses();
    const toast = vi.fn();
    mount(toast);
    openTagsThenCopy();

    await waitFor(() => expect(toast).toHaveBeenCalledWith('copy failed', 'error'));
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });
});
