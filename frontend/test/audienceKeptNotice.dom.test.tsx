/**
 * [FIX-20260907-DEADCONDWARN] Switching a campaign to Broadcast must SAY that
 * the conditions are kept and no longer applied.
 * ===========================================================================
 * 🔴 THIS FILE IS THE PROOF THAT THE OLD WARNING WAS DEAD. `BroadcastFormModal`
 *    has carried the copy key `broadcast.audience_needs_multicast` since 23/08,
 *    rendered under `rules.length > 0 && send_kind !== 'multicast'` — inside a
 *    block gated on `send_kind === 'multicast'`. The two conditions contradict
 *    each other, so it never appeared once, and no test asserted that it did.
 *    Every case below fails on the code as it stood before 07/09.
 *
 * The form is MOUNTED and the dropdown really switched — not a source read.
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

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { shouldShowAudienceKept } from '../components/campaign/audience';
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

/**
 * A SAVED job, opened for editing — the real path this notice exists for.
 *
 * ⚠️ Driving the conditions builder from the UI does not work here: its "add
 *    condition" button is disabled until the audience SOURCES have loaded from
 *    the server (`AudienceRuleBuilder.tsx:278`), and those are mocked away. So
 *    the rules arrive the way they arrive in production for an edit — on
 *    `initialData.target`, which the form copies into its own state.
 */
const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  _id: 'job-1',
  name: 'promo',
  description: 'a campaign',
  status: 'draft',
  hook_ids: [],
  assign_group_ids: [],
  message: { type: 'text', text: 'hi' },
  send_kind: 'multicast',
  target: {
    mode: 'all',
    match: 'and',
    rules: [{ key: 'display_name', op: 'eq', value: 'Ann' }],
  },
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

const sendSelect = (c: HTMLElement) =>
  c.querySelector('select[name="send_kind"]') as HTMLSelectElement;

const notice = (c: HTMLElement) =>
  c.querySelector('[data-testid="audience-kept-notice"]');

describe('shouldShowAudienceKept — the rule, on its own', () => {
  it('shows when rules exist and the send is not multicast', () => {
    expect(shouldShowAudienceKept([{}], 'broadcast')).toBe(true);
  });

  it('covers a job with NO send_kind — the legacy sender ignores target too', () => {
    expect(shouldShowAudienceKept([{}], null)).toBe(true);
    expect(shouldShowAudienceKept([{}], undefined)).toBe(true);
  });

  it('stays quiet on multicast, where the conditions really do narrow', () => {
    expect(shouldShowAudienceKept([{}], 'multicast')).toBe(false);
  });

  it('stays quiet when there are no conditions — "everyone" is a real choice', () => {
    expect(shouldShowAudienceKept([], 'broadcast')).toBe(false);
    expect(shouldShowAudienceKept(undefined, 'broadcast')).toBe(false);
  });
});

describe('the form — switching to Broadcast says what happened', () => {
  const builderVisible = (c: HTMLElement) =>
    !!c.querySelector('button[name="audience_add"]');

  it('⭐⭐ RED BEFORE THE FIX: the notice appears after the switch', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());

    /* Stored as a multicast — the conditions are honoured, so nothing to say. */
    expect(notice(c)).toBeNull();

    fireEvent.change(sendSelect(c), { target: { value: 'broadcast' } });
    await waitFor(() => expect(notice(c)).not.toBeNull());
  });

  it('⭐⭐ a job STORED as a broadcast with conditions says so on open', async () => {
    /* The four rows in this state on the local database. Opening one used to
       show a blank where the conditions had been, and no explanation. */
    const { container } = mount(job({ send_kind: 'broadcast' }));
    const c = container as HTMLElement;
    await waitFor(() => expect(notice(c)).not.toBeNull());
  });

  it('⭐ the notice sits OUTSIDE the block that hides on broadcast', async () => {
    /* The placement IS the fix. Inside that block a "not multicast" notice can
       never render — which is exactly how the 23/08 warning died. */
    const { container } = mount(job({ send_kind: 'broadcast' }));
    const c = container as HTMLElement;
    await waitFor(() => expect(notice(c)).not.toBeNull());
    expect(builderVisible(c)).toBe(false);
  });

  it('⭐ the clear button empties the rules, and only when pressed', async () => {
    const { container } = mount(job({ send_kind: 'broadcast' }));
    const c = container as HTMLElement;
    await waitFor(() => expect(notice(c)).not.toBeNull());

    const clear = c.querySelector('[data-testid="audience-clear-rules"]');
    expect(clear).not.toBeNull();
    fireEvent.click(clear as HTMLElement);
    /* Cleared ⇒ nothing left to warn about, so the notice retires itself. */
    await waitFor(() => expect(notice(c)).toBeNull());
  });

  it('⭐ switching back to Multicast restores the conditions and drops the notice', async () => {
    /* `[FIX-20260825-CONDMULTICASTONLY]` keeps the values on purpose. This pins
       that the new notice did not quietly start clearing them. */
    const { container } = mount(job({ send_kind: 'broadcast' }));
    const c = container as HTMLElement;
    await waitFor(() => expect(notice(c)).not.toBeNull());

    fireEvent.change(sendSelect(c), { target: { value: 'multicast' } });
    await waitFor(() => expect(notice(c)).toBeNull());
    expect(builderVisible(c)).toBe(true);
  });

  it('⭐ a broadcast with NO conditions is left alone', async () => {
    const { container } = mount(
      job({ send_kind: 'broadcast', target: { mode: 'all', rules: [] } }),
    );
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    expect(notice(c)).toBeNull();
  });
});
