/**
 * [FEAT-20260907-FLEXPICKREFRESH] / [FEAT-20260907-FLEXMANAGELINK]
 * Step 2, at the level the admin actually sees it: which label, which buttons.
 * ===========================================================================
 * The form is mounted and the message type really switched. Two properties are
 * pinned that a component-level test cannot see:
 *
 *  · the flex branch gets its OWN label while text and image keep the shared
 *    one — the trap here was that a single label sat above all three branches,
 *    so renaming the key would have renamed two fields nobody asked about
 *  · "open this flex card" is gone and "manage flex messages" replaced it,
 *    while the PREVIEW button beside it is untouched (owner said so explicitly)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/hook', () => ({
  webhookService: { getHooksByGroup: () => Promise.resolve([]) },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve([{ _id: 'g1', group_name: 'A' }]),
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));
vi.mock('../services/media/flexMessageService', () => ({
  flexMessageService: {
    listFlexMessages: () =>
      Promise.resolve({ data: [{ id: 'card-1', name: 'Promo card' }] }),
    getFlexMessage: () => Promise.resolve({ content_json: {} }),
  },
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  _id: 'job-1',
  name: 'promo',
  description: 'a campaign',
  status: 'draft',
  hook_ids: [],
  assign_group_ids: [],
  message: { type: 'flex', flex_id: 'card-1' },
  send_kind: 'multicast',
  target: { mode: 'all', rules: [] },
  ...over,
});

const mount = (initialData: Record<string, unknown> = job()) => {
  const r = render(
    <I18nProvider>
      <BroadcastFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn(() => Promise.resolve())}
        mode="update"
        initialData={initialData as never}
      />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return r;
};

const FLEX_LABEL = 'Flex ที่ใช้ส่ง';

/**
 * The shared label, matched on the LABEL ELEMENT rather than on page text.
 *
 * ⚠️ A substring search is wrong here: the message-TYPE label above it reads
 *    "ประเภทข้อความ", which contains the shared label's text and makes every
 *    assertion pass for the wrong reason.
 */
const hasGenericLabel = (c: HTMLElement): boolean =>
  Array.from(c.querySelectorAll('label')).some(
    l => (l.textContent ?? '').trim() === 'ข้อความ *',
  );

describe('step 2 — the field label follows the message type', () => {
  it('⭐⭐ flex names the card it sends', async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="flex-card-picker"]')).not.toBeNull(),
    );
    expect(container.textContent).toContain(FLEX_LABEL);
  });

  it('🔴 TEXT keeps the SHARED label, untouched', async () => {
    /* The whole reason the flex label is a separate key. If this goes red, the
       change leaked into a field nobody asked about. */
    const { container } = mount(job({ message: { type: 'text', text: 'hi' } }));
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('textarea[name="message_text"]')).not.toBeNull(),
    );
    expect(hasGenericLabel(c)).toBe(true);
    expect(c.textContent).not.toContain(FLEX_LABEL);
  });

  it('🔴 IMAGE keeps the SHARED label, untouched', async () => {
    const { container } = mount(
      job({ message: { type: 'image', image_url: 'https://x/y.png' } }),
    );
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('input[name="message_image_url"]')).not.toBeNull(),
    );
    expect(hasGenericLabel(c)).toBe(true);
    expect(c.textContent).not.toContain(FLEX_LABEL);
  });

  it('🔴 flex does NOT show the shared label twice', async () => {
    /* Two labels stacked would be the lazy version of this change. */
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('[data-testid="flex-card-picker"]')).not.toBeNull(),
    );
    expect(hasGenericLabel(c)).toBe(false);
  });
});

describe('step 2 — the buttons under the picker', () => {
  it('⭐⭐ "open this flex card" is gone', async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="flex-card-picker"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="open-flex-card"]')).toBeNull();
  });

  it('⭐⭐ "manage flex messages" replaced it', async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="manage-flex-messages"]')).not.toBeNull(),
    );
  });

  it('🔴 the PREVIEW button is still there and still wired — owner said not to touch it', async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="preview-selected-card"]')).not.toBeNull(),
    );
    const btn = container.querySelector(
      '[data-testid="preview-selected-card"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    /* Pressing it must not throw — it is the same handler as before. */
    fireEvent.click(btn);
  });

  /* [FEAT-20260907-FLEXTOOLROW] Owner, 07/09: the three tools around the flex
     field become one theme, one size, one row, in a stated order — and จัดการ flex
     must be on screen at ALL times, not only once a card has been picked. */
  it('⭐⭐ all three tools share ONE theme and ONE size', async () => {
    /* The point of `FlexToolButton`. If somebody re-styles one of them in place,
       this goes red rather than the difference being noticed months later. */
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('[data-testid="preview-selected-card"]')).not.toBeNull(),
    );
    const cls = (id: string) =>
      (c.querySelector(`[data-testid="${id}"]`) as HTMLElement).className.trim();
    expect(cls('manage-flex-messages')).toBe(cls('flex-card-refresh'));
    expect(cls('preview-selected-card')).toBe(cls('flex-card-refresh'));
  });

  it('⭐⭐ order on the row: refresh → จัดการ flex → ดูตัวอย่าง', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('[data-testid="preview-selected-card"]')).not.toBeNull(),
    );
    const html = c.innerHTML;
    expect(html.indexOf('flex-card-refresh')).toBeLessThan(
      html.indexOf('manage-flex-messages'),
    );
    expect(html.indexOf('manage-flex-messages')).toBeLessThan(
      html.indexOf('preview-selected-card'),
    );
  });

  it('🔴 จัดการ flex shows with NO card selected — preview does not', async () => {
    /* This is the bug the move fixed. Both buttons used to live inside the
       `flex_id` gate, so on a brand new campaign — the exact moment somebody
       needs the card library — the way into it was not rendered. Preview stays
       gated on purpose: with nothing selected it has nothing to render. */
    const { container } = mount(job({ message: { type: 'flex' } }));
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('[data-testid="manage-flex-messages"]')).not.toBeNull(),
    );
    expect(c.querySelector('[data-testid="preview-selected-card"]')).toBeNull();
  });

  it('the refresh control sits with the picker, not with the preview button', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('[data-testid="flex-card-refresh"]')).not.toBeNull(),
    );
    const html = c.innerHTML;
    expect(html.indexOf('flex-card-refresh')).toBeLessThan(
      html.indexOf('preview-selected-card'),
    );
  });
});
