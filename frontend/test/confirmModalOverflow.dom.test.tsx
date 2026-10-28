/**
 * [UI-20260829-CONFIRMOVERFLOW] the confirm dialog must not fall off screen, and its
 * text must wrap.
 *
 * 🔴 The bug the owner hit: the "confirm close case" dialog with several topics
 *    (registration + deposit + withdraw = 3 topics x 2 options, each with a long hint)
 *    is taller than the viewport, while the panel was `overflow-hidden` with nothing
 *    scrollable ⇒ the confirm button ended up off screen and unreachable, and the Thai
 *    hints ran off to the right instead of wrapping.
 *
 * This file pins three contracts: the panel never exceeds the screen, the body scrolls
 * itself, and the header/footer never shrink. Plus one more: the ~20 short dialogs
 * elsewhere in the app must not notice any of it.
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';

import { ConfirmModal } from '../components/modals/ConfirmModal';
import {
  CloseCaseSections,
  type CloseCaseTopic,
} from '../components/member/follow-up/CloseCaseSections';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const noop = () => {};

const openDialog = (extra?: React.ReactNode) =>
  render(
    <I18nProvider>
      <ConfirmModal
        isOpen
        onClose={noop}
        onConfirm={noop}
        title="ยืนยันการปิดเคส"
        message="ต้องการปิดเคสนี้ใช่หรือไม่"
      >
        {extra}
      </ConfirmModal>
    </I18nProvider>,
  );

const panelOf = (c: HTMLElement) =>
  (c.firstElementChild as HTMLElement).firstElementChild as HTMLElement;

describe('the dialog can never grow taller than the screen', () => {
  it('the panel is capped by the overlay and lays out as a column', () => {
    const { container } = openDialog();
    const panel = panelOf(container);
    // max-h-full caps it at the overlay's content box, which already has p-4
    expect(panel.className).toContain('max-h-full');
    expect(panel.className).toContain('flex');
    expect(panel.className).toContain('flex-col');
  });

  it('the header and the footer never shrink — the confirm button stays reachable', () => {
    const { container } = openDialog();
    const panel = panelOf(container);
    const header = panel.children[0] as HTMLElement;
    const footer = panel.children[panel.childElementCount - 1] as HTMLElement;
    expect(header.className).toContain('shrink-0');
    expect(footer.className).toContain('shrink-0');
    // the confirm button really does live in that footer
    expect(footer.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('the body scrolls on its own instead of pushing the buttons off screen', () => {
    const { container } = openDialog();
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement | null;
    expect(scroller).not.toBeNull();
    // min-h-0 is what lets it shrink inside a flex column; without it, it never scrolls
    expect(scroller?.className).toContain('min-h-0');
    // the dialog's message really is inside the scroller, not next to it
    expect(scroller?.textContent).toContain('ต้องการปิดเคสนี้ใช่หรือไม่');
  });

  it('the scroll-hint layer sits OUTSIDE the scroller, or the arrow would scroll away', () => {
    const { container } = openDialog();
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement;
    const wrapper = scroller.parentElement as HTMLElement;
    expect(wrapper.className).toContain('relative');
    expect(scroller.querySelector('[data-testid^="scroll-hint"]')).toBeNull();
  });
});

describe('long text wraps instead of pushing the box wider', () => {
  it('the dialog message and title can break', () => {
    const { container } = openDialog();
    const panel = panelOf(container);
    expect((panel.querySelector('h3') as HTMLElement).className).toContain('break-words');
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement;
    expect((scroller.querySelector('p') as HTMLElement).className).toContain('break-words');
  });

  it('a close-case option wraps: the text column may shrink AND the words may break', () => {
    const topics: CloseCaseTopic[] = ['registration', 'deposit', 'withdraw'];
    const { container } = render(
      <CloseCaseSections topics={topics} answers={{}} onChange={noop} />,
    );
    const option = container.querySelector(
      '[data-testid="close-case-registration-stop"]',
    ) as HTMLElement;
    const textColumn = option.querySelector('span.flex') as HTMLElement;

    // 🔴 Both are required: a flex item without min-w-0 refuses to shrink below its
    //    content, and Thai has no spaces, so without break-words it still will not wrap.
    expect(textColumn.className).toContain('min-w-0');
    const [label, hint] = Array.from(textColumn.children) as HTMLElement[];
    expect(label.className).toContain('break-words');
    expect(hint.className).toContain('break-words');
    // the hint really is the long Thai sentence that used to overflow
    expect(hint.textContent && hint.textContent.length).toBeGreaterThan(40);
  });

  it('every option of every topic wraps, not just the first', () => {
    /* [FEAT-20260830-CLOSEWIZARD] one topic per step now, so the sweep walks
       the steps instead of reading six at once — same six options checked. */
    const topics: CloseCaseTopic[] = ['registration', 'deposit', 'withdraw'];
    const columns: HTMLElement[] = [];
    topics.forEach((_t, i) => {
      const view = render(
        <CloseCaseSections topics={topics} answers={{}} onChange={noop} stepIndex={i} />,
      );
      columns.push(
        ...(Array.from(
          view.container.querySelectorAll('[data-testid^="close-case-"] > span.flex'),
        ) as HTMLElement[]),
      );
      view.unmount();
    });
    expect(columns.length).toBe(6); // 3 topics x 2 options
    columns.forEach((col) => {
      expect(col.className).toContain('min-w-0');
      Array.from(col.children).forEach((child) => {
        expect((child as HTMLElement).className).toContain('break-words');
      });
    });
  });
});

describe('the no-options case stays exactly as it was', () => {
  it('no topics ⇒ CloseCaseSections renders nothing at all', () => {
    const { container } = render(
      <CloseCaseSections topics={[]} answers={{}} onChange={noop} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('a short dialog shows no scroll arrow', () => {
    const { container } = openDialog();
    expect(container.querySelector('[data-testid="scroll-hint-down"]')).toBeNull();
    expect(container.querySelector('[data-testid="scroll-hint-up"]')).toBeNull();
  });
});
