/* [FE] InputError — characterization test for [FEAT-20260811-HOOKFORMSPLIT].
 * Freezes the pure field-error primitive extracted from HookFormModal into
 * components/common/. revert: delete with components/common/InputError.tsx. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { InputError } from '../components/common/InputError';

describe('InputError', () => {
  it('renders nothing without an error', () => {
    const { container } = render(<InputError />);
    expect(container.innerHTML).toBe('');
  });
  it('renders icon + message when given an error', () => {
    const { container } = render(<InputError error="required" />);
    expect(container.innerHTML).toMatchSnapshot();
  });
});
