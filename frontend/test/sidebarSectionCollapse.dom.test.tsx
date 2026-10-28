/**
 * [FIX-20260830-SIDEMENUCOLLAPSE] the first sidebar section must be collapsible.
 *
 * 🔴 Owner report 30/08: *"side menu กดพับหมวดไม่ได้"*.
 *
 * `null` meant two different things at once. The sidebar accordion opens its
 * FIRST section by default, written as
 * `pinned === null && section === visibleSections[0]`. Tapping that header ran
 * `togglePin`, which sets `pinned` back to `null` — the very state that means
 * "show the first one". It sprang straight back open. Every OTHER section closed
 * normally, which is why only one header looked broken.
 *
 * These are interaction tests, not source greps: the bug lived in the state, and
 * a grep would have passed happily both before and after.
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { MegaMenu } from '../components/common/MegaMenu';
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

/** Every permission, so no section is hidden and the accordion is fully built. */
const ALL = [
  'hook.manage', 'slip.manage', 'flex.manage', 'dynamic_tag.manage',
  'custom_tool.manage', 'handoff.manage', 'translation.manage',
  'ticket.manage', 'user.manage', 'group.manage', 'config.manage',
  'audit.view', 'insight.view', 'object.manage', 'broadcast.manage',
  'auto_reply.manage', 'strike.manage', 'media.manage',
];

const mount = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <MegaMenu permissions={ALL} username="tester" isMobile />
      </I18nProvider>
    </MemoryRouter>,
  );

/** The accordion headers, in render order. */
const headers = (): HTMLElement[] =>
  Array.from(document.querySelectorAll('button')).filter((b) =>
    b.className.includes('uppercase'),
  ) as HTMLElement[];

/** A section is open when its header's sibling list is in the DOM. */
const isOpen = (header: HTMLElement): boolean => {
  const panel = header.parentElement;
  return Boolean(panel && panel.children.length > 1);
};

describe('the first section starts open, as before', () => {
  it('it is open on first render', () => {
    mount();
    const hs = headers();
    expect(hs.length).toBeGreaterThan(1);
    expect(isOpen(hs[0] as HTMLElement)).toBe(true);
  });

  it('the others start closed', () => {
    mount();
    headers()
      .slice(1)
      .forEach((h) => expect(isOpen(h)).toBe(false));
  });
});

describe('🔴 the first section can be CLOSED — the reported bug', () => {
  it('one tap closes it and it STAYS closed', () => {
    mount();
    const first = headers()[0] as HTMLElement;
    expect(isOpen(first)).toBe(true);
    fireEvent.click(first);
    expect(isOpen(headers()[0] as HTMLElement)).toBe(false);
  });

  it('it does not spring back open on a re-render', () => {
    mount();
    fireEvent.click(headers()[0] as HTMLElement);
    // touching another header re-renders the whole list
    fireEvent.click(headers()[1] as HTMLElement);
    fireEvent.click(headers()[1] as HTMLElement);
    expect(isOpen(headers()[0] as HTMLElement)).toBe(false);
  });

  it('it can be re-opened by tapping it again', () => {
    mount();
    const at = () => headers()[0] as HTMLElement;
    fireEvent.click(at());
    expect(isOpen(at())).toBe(false);
    fireEvent.click(at());
    expect(isOpen(at())).toBe(true);
  });
});

describe('the other sections keep working exactly as they did', () => {
  it('opening a second section closes the first — it is an accordion', () => {
    mount();
    fireEvent.click(headers()[1] as HTMLElement);
    expect(isOpen(headers()[0] as HTMLElement)).toBe(false);
    expect(isOpen(headers()[1] as HTMLElement)).toBe(true);
  });

  it('a non-first section closes on a second tap', () => {
    mount();
    const at = () => headers()[1] as HTMLElement;
    fireEvent.click(at());
    expect(isOpen(at())).toBe(true);
    fireEvent.click(at());
    expect(isOpen(at())).toBe(false);
  });

  it('closing the last open section leaves EVERY section closed', () => {
    /* the state this test really guards: after a deliberate close, "nothing is
       pinned" must not be read as "so show the first one". */
    mount();
    fireEvent.click(headers()[1] as HTMLElement);
    fireEvent.click(headers()[1] as HTMLElement);
    headers().forEach((h) => expect(isOpen(h)).toBe(false));
  });

  it('the section that is open still lists its items', () => {
    mount();
    const first = headers()[0] as HTMLElement;
    const panel = first.parentElement as HTMLElement;
    expect(within(panel).getAllByRole('link').length).toBeGreaterThan(0);
  });
});
