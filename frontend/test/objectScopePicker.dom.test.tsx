/**
 * [FEAT-20260901-OBJSCOPE] The scope controls, and the auto-select-all that had
 * to go.
 *
 * The bug worth pinning forever: `ObjectImageFormModal` used to tick EVERY group
 * into `group_providers` after hydrating, then hide the field. Opening an album
 * scoped to one group and pressing save silently rewrote it to all 131. With the
 * control hidden nobody could see it happen, and with `group_providers` read by
 * no filter nobody could feel it either — until the scope started being enforced.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ObjectScopeCell } from '../components/object/scope/ObjectScopeCell';
import { ObjectScopePicker } from '../components/object/scope/ObjectScopePicker';
import { ObjectStatusToggle } from '../components/object/scope/ObjectStatusToggle';
import { toIds } from '../components/object/scope/toIds';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

const GROUPS = [
  { _id: 'g1', group_name: 'Alpha' },
  { _id: 'g2', group_name: 'Beta' },
];
const HOOKS = [
  { _id: 'h1', line_oa_name: 'OA One', alias: 'oa-one', group: 'g1' },
  { _id: 'h2', line_oa_name: 'OA Two', alias: 'oa-two', group: 'g2' },
] as never[];

const renderPicker = (over: Record<string, unknown> = {}) => {
  const onChange = vi.fn();
  render(
    <ObjectScopePicker
      groupIds={[]}
      hookIds={[]}
      onChange={onChange}
      groups={GROUPS}
      hooks={HOOKS}
      {...over}
    />,
  );
  return onChange;
};

describe('ObjectScopePicker', () => {
  /* [FIX-20260901-SCOPEREQUIRED] The old "ticking nothing means everyone" hint
     is gone: the form now refuses to save an empty scope, so the sentence would
     contradict the validation standing next to it. */
  it('no longer claims an empty scope means everyone', () => {
    renderPicker();
    expect(screen.queryByTestId('object-scope-hint')).toBeNull();
  });

  it('shows a validation message when the parent passes one', () => {
    renderPicker({ error: 'pick something' });
    expect(screen.getByTestId('object-scope-error')).toHaveTextContent(
      'pick something',
    );
  });

  it('shows nothing when there is no error', () => {
    renderPicker();
    expect(screen.queryByTestId('object-scope-error')).toBeNull();
  });

  it('renders a row per group', () => {
    renderPicker();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('starts with NOTHING ticked — the auto-select-all must not come back', () => {
    renderPicker();
    const checked = screen
      .getAllByRole('checkbox')
      .filter((box) => (box as HTMLInputElement).checked);
    expect(checked).toHaveLength(0);
  });

  it('labels an OA by its display name, not its routing alias', () => {
    renderPicker({ groupIds: ['g1'] });
    expect(screen.getByText('OA One')).toBeInTheDocument();
    expect(screen.queryByText('oa-one')).not.toBeInTheDocument();
  });

  it('unticking a group drops the OAs that belonged to it', () => {
    const onChange = renderPicker({ groupIds: ['g1', 'g2'], hookIds: ['h1', 'h2'] });

    fireEvent.click(screen.getByText('Alpha'));

    const next = onChange.mock.calls[0][0];
    expect(next.group_providers).toEqual(['g2']);
    /* h1 lived in g1, which is no longer ticked. Leaving it behind would store
       an OA the scope can no longer reach. */
    expect(next.hook_ids).toEqual(['h2']);
  });

  it('picking a group keeps the OA picks it still covers', () => {
    const onChange = renderPicker({ groupIds: ['g1'], hookIds: ['h1'] });

    fireEvent.click(screen.getByText('Beta'));

    const next = onChange.mock.calls[0][0];
    expect(next.group_providers.sort()).toEqual(['g1', 'g2']);
    expect(next.hook_ids).toEqual(['h1']);
  });
});

describe('ObjectStatusToggle', () => {
  it('an absent status reads as ON — rows saved before this field have no key', () => {
    render(<ObjectStatusToggle value={undefined} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('only an explicit false is OFF', () => {
    render(<ObjectStatusToggle value={false} onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('flips to the opposite of what it currently shows', () => {
    const onChange = vi.fn();
    render(<ObjectStatusToggle value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('toIds — the form ticks by id, whatever shape the API sent', () => {
  it('passes bare id strings through', () => {
    expect(toIds(['a', 'b'])).toEqual(['a', 'b']);
  });

  /* `group_providers` comes back POPULATED on an album. Left as objects, the
     picker would tick nothing and the next save would write the empty scope. */
  it('unwraps populated documents, by id or _id', () => {
    expect(toIds([{ id: 'a' }, { _id: 'b' }])).toEqual(['a', 'b']);
  });

  it('drops empties instead of emitting blank ids', () => {
    expect(toIds([null, undefined, '', { id: '' }, 'c'])).toEqual(['c']);
  });

  it('a missing column is an empty list, never a crash', () => {
    expect(toIds(undefined)).toEqual([]);
    expect(toIds('nonsense')).toEqual([]);
  });
});

/**
 * [FIX-20260901-CELLPOPULATED] The album list showed "[object Object]".
 *
 * `group_providers` comes back POPULATED on an album — `object-images.service`
 * calls `.populate('group_providers')` — so the cell received documents, not
 * ids, and `String(doc)` is "[object Object]". The category list was fine
 * because that endpoint returns bare ids, which is exactly why reading one
 * screen was not enough to catch it.
 */
describe('ObjectScopeCell renders names, whatever shape the API sent', () => {
  const NAMES = { g1: 'Alpha', g2: 'Beta' };

  it('resolves bare id strings', () => {
    render(<ObjectScopeCell groupIds={['g1']} groupNames={NAMES} />);
    expect(screen.getByTestId('object-scope-cell')).toHaveTextContent('Alpha');
  });

  it('resolves POPULATED documents — the bug, pinned', () => {
    render(
      <ObjectScopeCell
        groupIds={[{ _id: 'g1', group_name: 'Alpha' }]}
        groupNames={NAMES}
      />,
    );
    const cell = screen.getByTestId('object-scope-cell');
    expect(cell).toHaveTextContent('Alpha');
    expect(cell).not.toHaveTextContent('[object Object]');
  });

  it('falls back to the embedded name when the catalogue has not loaded', () => {
    render(<ObjectScopeCell groupIds={[{ _id: 'g9', group_name: 'Gamma' }]} />);
    expect(screen.getByTestId('object-scope-cell')).toHaveTextContent('Gamma');
  });

  it('counts the rest, not just the first', () => {
    render(
      <ObjectScopeCell
        groupIds={['g1', 'g2']}
        hookIds={['h1']}
        groupNames={NAMES}
      />,
    );
    expect(screen.getByTestId('object-scope-cell-more')).toHaveTextContent('+2');
  });

  it('an empty scope says so in words rather than rendering blank', () => {
    render(<ObjectScopeCell groupIds={[]} hookIds={[]} />);
    expect(
      screen.getByTestId('object-scope-cell-unrestricted'),
    ).toBeInTheDocument();
  });
});
