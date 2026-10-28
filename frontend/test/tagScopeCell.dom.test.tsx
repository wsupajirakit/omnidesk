/**
 * [FEAT-20260830-TAGSCOPECELL] the Dynamic Tags OA column.
 *
 * Owner 30/08 with a screenshot: a tag bound to 15 groups printed all fifteen
 * names into one cell and the column ran off the screen. Cap the list, show
 * `+N`, and put the rest behind a click.
 *
 * These tests do two jobs at once:
 *  1. CHARACTERIZATION — the four branches (many groups / one group / picked
 *     OAs / a single OA) keep the wording and the branch order they had in
 *     `DynamicTagList.tsx` before the move. The markup was moved verbatim; if a
 *     later edit rewords a branch or changes which one wins, these go red.
 *  2. THE NEW BEHAVIOUR — the cap, the `+N` button, and the dialog.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TagScopeCell, TAG_SCOPE_INLINE_LIMIT } from '../components/messaging';
import type { DynamicTagEntry, HookData } from '../types';

const hooks = [
  { _id: 'h1', alias: 'oa-one', line_oa_name: 'OA One' },
  { _id: 'h2', alias: 'oa-two', line_oa_name: 'OA Two' },
  { _id: 'h3', alias: 'oa-three', line_oa_name: 'OA Three' },
] as HookData[];

const groupName = (gid?: string) => (gid ? `G-${gid}` : 'กลุ่ม (ไม่พบชื่อ)');

const entry = (over: Partial<DynamicTagEntry>): DynamicTagEntry =>
  ({ id: 't', tag: 'odk_p_00451', value: 'v', detail: 'd', status: true, type: 'api', sub_type: 's', created_at: '', updated_at: '', ...over }) as DynamicTagEntry;

const show = (over: Partial<DynamicTagEntry>) =>
  render(<TagScopeCell item={entry(over)} hooks={hooks} groupName={groupName} />);

/** the screenshot's row: fifteen groups on one tag */
const fifteen = Array.from({ length: 15 }, (_, i) => `g${i + 1}`);

describe('many groups — the row that overflowed', () => {
  it('⭐ prints only the first few names, never all fifteen', () => {
    show({ group_ids: fifteen });
    const text = screen.getByTestId('tag-scope-more').parentElement?.textContent ?? '';
    expect(text).toContain('G-g1');
    expect(text).toContain('G-g2');
    /* the 3rd name and beyond must NOT be in the cell — that is the whole bug */
    expect(text).not.toContain('G-g3');
    expect(text).not.toContain('G-g15');
  });

  it('⭐ the remainder becomes +13, not a longer sentence', () => {
    show({ group_ids: fifteen });
    expect(screen.getByTestId('tag-scope-more').textContent).toBe(
      `+${15 - TAG_SCOPE_INLINE_LIMIT}`,
    );
  });

  it('keeps the total and the two-line summary it always showed', () => {
    show({ group_ids: fifteen, hook_ids: ['h1'] });
    expect(screen.getByText(/15 กลุ่ม:/)).toBeTruthy();
    expect(screen.getByText(/ทั้งกลุ่ม \+ ☑️ อีก 1 OA/)).toBeTruthy();
  });

  it('⭐ +N opens a dialog listing every group', () => {
    show({ group_ids: fifteen });
    expect(screen.queryByTestId('tag-scope-modal')).toBeNull();

    fireEvent.click(screen.getByTestId('tag-scope-more'));

    const modal = screen.getByTestId('tag-scope-modal');
    expect(modal.textContent).toContain('กลุ่ม (15)');
    for (const g of fifteen) expect(modal.textContent).toContain(`G-${g}`);
  });

  it('the dialog also lists the extra OAs, and closes again', () => {
    show({ group_ids: fifteen, hook_ids: ['h1', 'h3'] });
    fireEvent.click(screen.getByTestId('tag-scope-more'));

    const modal = screen.getByTestId('tag-scope-modal');
    expect(modal.textContent).toContain('OA (2)');
    expect(modal.textContent).toContain('oa-one');
    expect(modal.textContent).toContain('oa-three');

    fireEvent.click(screen.getByLabelText('ปิด'));
    expect(screen.queryByTestId('tag-scope-modal')).toBeNull();
  });

  it('a short list gets no +N at all', () => {
    show({ group_ids: ['g1', 'g2'] });
    expect(screen.queryByTestId('tag-scope-more')).toBeNull();
  });

  it('🔴 the button does not also trigger the row underneath it', () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <TagScopeCell item={entry({ group_ids: fifteen })} hooks={hooks} groupName={groupName} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('tag-scope-more'));
    expect(onRow).not.toHaveBeenCalled();
  });
});

describe('the other three branches are untouched', () => {
  it('one whole group', () => {
    const { container } = show({ group_id: 'g9' });
    expect(container.textContent).toContain('👥 G-g9');
    expect(container.textContent).toContain('ทั้งกลุ่ม (ทุก OA ในกลุ่ม)');
    expect(screen.queryByTestId('tag-scope-more')).toBeNull();
  });

  it('hand-picked OAs keep their count line, and their +N now opens the dialog too', () => {
    const { container } = show({ hook_ids: ['h1', 'h2', 'h3'] });
    expect(container.textContent).toContain('☑️ เฉพาะ 3 OA');
    expect(container.textContent).toContain('oa-one, oa-two');

    fireEvent.click(screen.getByTestId('tag-scope-more'));
    const modal = screen.getByTestId('tag-scope-modal');
    expect(modal.textContent).toContain('OA (3)');
    expect(modal.textContent).toContain('oa-three');
    // no group section when the tag is not bound by group
    expect(modal.textContent).not.toContain('กลุ่ม (');
  });

  it('a single OA shows its name and alias', () => {
    const { container } = show({ hook_id: 'h2' });
    expect(container.textContent).toContain('OA Two');
    expect(container.textContent).toContain('oa-two');
  });

  it('an unbound tag falls back to - / System', () => {
    const { container } = show({});
    expect(container.textContent).toContain('-');
    expect(container.textContent).toContain('System');
  });

  it('🔴 group_ids wins over group_id and hook_ids — the original branch order', () => {
    const { container } = show({ group_ids: ['g1'], group_id: 'g9', hook_ids: ['h1'] });
    expect(container.textContent).toContain('G-g1');
    expect(container.textContent).not.toContain('G-g9');
    expect(container.textContent).not.toContain('☑️ เฉพาะ');
  });
});
