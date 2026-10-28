/* [FE] HookEndpointUsageGuide — characterization test for [FEAT-20260811-HOOKFORMSPLIT].
 *
 * Freezes the rendered DOM of the "Custom Endpoints Usage Guide" overlay extracted
 * out of HookFormModal. JSX moved verbatim, so the snapshot IS the proof nothing
 * visible changed. Static content, single boolean of state.
 *
 * revert: delete together with components/hook/form/HookEndpointUsageGuide.tsx.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { HookEndpointUsageGuide } from '../components/hook/form/HookEndpointUsageGuide';

const noop = () => {};

describe('HookEndpointUsageGuide DOM unchanged by extraction', () => {
  it('closed renders nothing', () => {
    const { container } = render(
      <HookEndpointUsageGuide open={false} onClose={noop} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('open', () => {
    const { container } = render(
      <HookEndpointUsageGuide open onClose={noop} />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('both X and Get Started close', () => {
    let n = 0;
    const { getAllByRole } = render(
      <HookEndpointUsageGuide open onClose={() => n++} />,
    );
    const buttons = getAllByRole('button');
    expect(buttons).toHaveLength(2); // header X + footer Get Started
    buttons.forEach((b) => b.click());
    expect(n).toBe(2);
  });
});
