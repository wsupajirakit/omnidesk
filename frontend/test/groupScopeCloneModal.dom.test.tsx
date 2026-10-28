/* [FE] [FEAT-20260816-GROUPSCOPECLONE] — the dialog's two safety rules.
 *
 * 1. the source group is never offered as a target
 * 2. the first click PREVIEWS; only a second, deliberate click writes
 *
 * Rule 2 is the whole reason the dialog has two steps: one confirm reaches every
 * dynamic tag and flex card the source group holds (801 and 39 on the dev
 * database), so the operator sees the count before anything moves.
 *
 * The service module is mocked at its own path — the component imports it
 * through `services/admin`, and the barrel re-exports this file (see the note at
 * the top of services/admin/index.ts).
 *
 * revert: delete together with components/admin/group-scope/.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// `vi.mock` is hoisted above every const, so the spies have to be hoisted too
const { preview, apply } = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));

vi.mock('../services/admin/groupScopeService', async () => {
  const actual = await vi.importActual<
    typeof import('../services/admin/groupScopeService')
  >('../services/admin/groupScopeService');
  return { ...actual, groupScopeService: { preview, apply } };
});

import { I18nProvider } from '../i18n';
import { GroupScopeCloneModal } from '../components/admin/group-scope/GroupScopeCloneModal';

const groups = [
  { _id: 'g1', group_name: 'omnidesk-dev-group', description: '', status: true },
  { _id: 'g2', group_name: 'group-two', description: '', status: true },
  { _id: 'g3', group_name: 'group-three', description: '', status: true },
] as any[];

const result = (applied: boolean, mode: 'add' | 'remove' = 'add') => ({
  applied,
  mode,
  source_group_id: 'g1',
  source_totals: { dynamic_tags: 801, flex_messages: 39 },
  targets: [{ group_id: 'g2', dynamic_tags: 801, flex_messages: 39 }],
});

const open = (props: Record<string, unknown> = {}) => {
  const onClose = vi.fn();
  const onApplied = vi.fn();
  const view = render(
    <I18nProvider>
      <GroupScopeCloneModal
        isOpen
        onClose={onClose}
        onApplied={onApplied}
        source={groups[0]}
        groups={groups}
        {...props}
      />
    </I18nProvider>,
  );
  return { onClose, onApplied, ...view };
};

/**
 * The target box is a closed dropdown: open it if it is not already open (it
 * stays open across ticks, which is what makes picking several groups bearable)
 * and then tick the group.
 */
const pickTarget = (name: string) => {
  if (!screen.queryByTestId('group-picker-list')) {
    fireEvent.click(screen.getByTestId('group-picker-trigger'));
  }
  fireEvent.click(screen.getByText(name));
};

/**
 * The primary action is rendered TWICE — header and footer — from one
 * definition, so the operator never has to scroll to find it. Tests take the
 * first; one case below proves the pair behaves as one.
 */
const previewButton = () =>
  screen.getAllByRole('button', { name: /ตรวจก่อนคัดลอก|Check first/ })[0];
const applyButton = () =>
  screen.getAllByRole('button', { name: /คัดลอกเลย|Copy now/ })[0];

describe('GroupScopeCloneModal', () => {
  beforeEach(() => {
    preview.mockReset().mockResolvedValue(result(false));
    apply.mockReset().mockResolvedValue(result(true));
  });

  it('offers every other group as a target, but never the source itself', () => {
    open();
    fireEvent.click(screen.getByTestId('group-picker-trigger'));
    // the source appears once — as the read-only "source group" box, never as
    // an option in the list below it
    expect(screen.getAllByText('omnidesk-dev-group')).toHaveLength(1);
    expect(screen.getByText('group-two')).toBeTruthy();
    expect(screen.getByText('group-three')).toBeTruthy();
  });

  it('previews first and writes nothing until the second click', async () => {
    open();
    pickTarget('group-two');

    fireEvent.click(previewButton());

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(apply).not.toHaveBeenCalled();
    expect(preview.mock.calls[0][0]).toMatchObject({
      source_group_id: 'g1',
      target_group_ids: ['g2'],
      mode: 'add',
    });

    fireEvent.click(applyButton());
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][0]).toEqual(preview.mock.calls[0][0]);
  });

  it('changing the selection throws the preview away, so a stale count can never be confirmed', async () => {
    open();
    pickTarget('group-two');
    fireEvent.click(previewButton());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));

    pickTarget('group-three');

    // back to the preview step — the confirm button is gone
    expect(screen.queryAllByRole('button', { name: /คัดลอกเลย|Copy now/ })).toHaveLength(0);
    expect(apply).not.toHaveBeenCalled();
  });

  it('the header carries the same action as the footer, in the same state', () => {
    open();
    // nothing picked yet: both copies are present and both are disabled
    const both = screen.getAllByRole('button', { name: /ตรวจก่อนคัดลอก|Check first/ });
    expect(both).toHaveLength(2);
    expect(both.every(button => (button as HTMLButtonElement).disabled)).toBe(true);

    pickTarget('group-two');
    expect(
      screen
        .getAllByRole('button', { name: /ตรวจก่อนคัดลอก|Check first/ })
        .every(button => (button as HTMLButtonElement).disabled),
    ).toBe(false);
  });

  it('the header copy of the button previews too', async () => {
    open();
    pickTarget('group-two');
    // index 1 is the footer; the header one must do exactly the same thing
    fireEvent.click(screen.getAllByRole('button', { name: /ตรวจก่อนคัดลอก|Check first/ })[0]);
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  });

  it('hands the result to the page and closes itself once the copy is done', async () => {
    const { onClose, onApplied } = open();
    pickTarget('group-two');
    fireEvent.click(previewButton());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));

    fireEvent.click(applyButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ applied: true, targets: expect.any(Array) }),
    );
  });

  it('the undo control is not on screen — the dialog closes on success instead', async () => {
    open();
    pickTarget('group-two');
    fireEvent.click(previewButton());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    fireEvent.click(applyButton());
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    expect(screen.queryAllByRole('button', { name: /เลิกทำ|Undo/ })).toHaveLength(0);
  });

  it('the undo call path still works and sends the same body with mode=remove', async () => {
    open({ allowUndo: true });
    pickTarget('group-two');
    fireEvent.click(previewButton());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    fireEvent.click(applyButton());
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    apply.mockResolvedValueOnce(result(true, 'remove'));
    fireEvent.click(screen.getAllByRole('button', { name: /เลิกทำ|Undo/ })[0]);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply.mock.calls[1][0]).toEqual({
      ...apply.mock.calls[0][0],
      mode: 'remove',
    });
  });
});
