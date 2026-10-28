/* [FE] [FEAT-20260816-GROUPSCOPECLONE] — the multi-select group box.
 *
 * It replaced an inline checkbox list, and before that a native `<select>`.
 * Both failed the same way: a tenant with dozens of groups either could not
 * search, or the list pushed the confirm button off the screen. So the two
 * things pinned here are the ones that keep the dialog usable at any size —
 * the box stays collapsed until asked, and the open panel is height-capped and
 * searchable.
 *
 * revert: delete together with components/admin/group-scope/GroupPicker.tsx.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { I18nProvider } from '../i18n';
import { GroupPicker } from '../components/admin/group-scope/GroupPicker';

const many = [
  { _id: 'g1', group_name: 'omnidesk-dev-group', description: 'the main one', status: true },
  { _id: 'g2', group_name: 'alpha', description: '', status: true },
  { _id: 'g3', group_name: 'beta', description: 'billing team', status: true },
  { _id: 'g4', group_name: 'gamma', description: '', status: false },
  { _id: 'g5', group_name: 'delta', description: '', status: true },
  { _id: 'g6', group_name: 'epsilon', description: '', status: true },
  { _id: 'g7', group_name: 'zeta', description: '', status: true },
  { _id: 'g8', group_name: 'omnidesk-stg-group', description: '', status: true },
] as any[];

const few = many.slice(0, 3);

const draw = (props: Record<string, unknown> = {}, groups = many) => {
  const onChange = vi.fn();
  const view = render(
    <I18nProvider>
      <GroupPicker groups={groups} selected={[]} onChange={onChange} {...props} />
    </I18nProvider>,
  );
  return { onChange, ...view };
};

const openList = () => fireEvent.click(screen.getAllByTestId('group-picker-trigger')[0]);
const search = () => screen.getByPlaceholderText(/ค้นหากลุ่ม|Search groups/);

describe('GroupPicker — it is a closed box until asked', () => {
  it('shows a placeholder and no options at all before it is opened', () => {
    draw();
    expect(screen.queryByText('alpha')).toBeNull();
    expect(screen.queryByTestId('group-picker-list')).toBeNull();
  });

  it('opens on click, with the search field and the groups', () => {
    draw();
    openList();
    expect(search()).toBeTruthy();
    expect(screen.getByText('alpha')).toBeTruthy();
  });

  it('the open panel never shows more than five rows at once — it scrolls', () => {
    draw();
    openList();
    const list = screen.getByTestId('group-picker-list');
    expect(list.style.maxHeight).toBe('13.75rem'); // 5 rows
    expect(list.className).toContain('overflow-y-auto');
  });

  it('summarises the selection on the closed box', () => {
    draw({ selected: ['g2', 'g3'] });
    expect(screen.getByText('alpha, beta')).toBeTruthy();

    // beyond two names a count is easier to read than a wall of text
    draw({ selected: ['g2', 'g3', 'g5'] });
    expect(screen.getAllByText(/เลือกแล้ว 3 กลุ่ม|3 groups selected/).length).toBe(1);
  });
});

describe('GroupPicker — search', () => {
  it('stays out of the way for a short list', () => {
    draw({}, few);
    openList();
    expect(screen.queryByPlaceholderText(/ค้นหากลุ่ม|Search groups/)).toBeNull();
    expect(screen.getByText('omnidesk-dev-group')).toBeTruthy();
  });

  it('filters by name, case-insensitively', () => {
    draw();
    openList();
    fireEvent.change(search(), { target: { value: 'OMNIDESK' } });

    expect(screen.getByText('omnidesk-dev-group')).toBeTruthy();
    expect(screen.getByText('omnidesk-stg-group')).toBeTruthy();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('filters by description too — the name is not always what people remember', () => {
    draw();
    openList();
    fireEvent.change(search(), { target: { value: 'billing' } });

    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('says so when nothing matches, instead of showing an empty box', () => {
    draw();
    openList();
    fireEvent.change(search(), { target: { value: 'no-such-group' } });

    expect(screen.getByText(/ไม่พบกลุ่มที่ค้นหา|No group matches/)).toBeTruthy();
  });

  it('a filtered-out group cannot be selected by accident', () => {
    const { onChange } = draw();
    openList();
    fireEvent.change(search(), { target: { value: 'alpha' } });

    expect(screen.queryByText('zeta')).toBeNull();
    fireEvent.click(screen.getByText('alpha'));
    expect(onChange).toHaveBeenCalledWith(['g2']);
  });
});

describe('GroupPicker — selection', () => {
  it('adds a group', () => {
    const { onChange } = draw({ selected: ['g2'] });
    openList();
    fireEvent.click(screen.getByText('beta'));
    expect(onChange).toHaveBeenCalledWith(['g2', 'g3']);
  });

  it('removes a group that was already picked', () => {
    const { onChange } = draw({ selected: ['g2', 'g3'] });
    openList();
    fireEvent.click(screen.getByText('beta'));
    expect(onChange).toHaveBeenCalledWith(['g2']);
  });

  it('stays open while several groups are ticked', () => {
    const { onChange } = draw();
    openList();
    fireEvent.click(screen.getByText('alpha'));
    expect(screen.getByText('beta')).toBeTruthy();
    fireEvent.click(screen.getByText('beta'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('an inactive group is labelled, not hidden', () => {
    draw();
    openList();
    expect(screen.getByText('gamma')).toBeTruthy();
    expect(screen.getAllByText(/ไม่ใช้งาน|Inactive/).length).toBeGreaterThan(0);
  });
});
