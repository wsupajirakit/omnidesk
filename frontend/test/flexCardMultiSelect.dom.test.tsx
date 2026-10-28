/* [FE] FlexCardMultiSelect — characterization test for [FEAT-20260811-HOOKFORMSPLIT].
 *
 * The picker moved verbatim out of HookFormModal into its own file. These snapshots
 * freeze its rendered DOM (collapsed, and with a selection) so the move is proven
 * to have changed nothing. It owns its open/tag-modal state internally; the parent
 * only passes templates/picked/onChange — so it renders standalone with no context.
 *
 * revert: delete together with components/hook/form/FlexCardMultiSelect.tsx.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { FlexCardMultiSelect } from '../components/hook/form/FlexCardMultiSelect';

const templates = [
  { id: 't1', name: 'Card One', flex_tag: 'ONE' },
  { id: 't2', name: 'Card Two' },
] as any[];

const base = {
  label: 'Flex cards',
  hint: 'pick some',
  emptyText: 'no cards',
  placeholder: 'choose…',
  tagModalTitle: 'Tags',
  tagModalFooter: 'footer note',
  templates,
  isViewMode: false,
  onCopyToast: () => {},
  copyFailMsg: 'copy failed',
};

describe('FlexCardMultiSelect DOM unchanged by extraction', () => {
  it('collapsed, nothing picked', () => {
    const { container } = render(
      <FlexCardMultiSelect {...base} picked={[]} onChange={() => {}} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('with a selection', () => {
    const { container } = render(
      <FlexCardMultiSelect {...base} picked={['t1']} onChange={() => {}} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  // The onChange contract is exercised end-to-end at the real call sites in
  // test/HookFormModal.value.test.tsx (the picker feeds flex_*_ids into the
  // submit payload); here we only freeze the rendered DOM of the moved component.
});
