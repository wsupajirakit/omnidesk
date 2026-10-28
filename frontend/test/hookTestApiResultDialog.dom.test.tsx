/* [FE] HookTestApiResultDialog — characterization test for [FEAT-20260811-HOOKFORMSPLIT].
 *
 * Freezes the rendered DOM of the "Test Connection Result" dialog that was
 * extracted out of HookFormModal.tsx. The JSX was moved verbatim, so this
 * snapshot IS the proof the extraction changed nothing visible — a diff here
 * means a class string drifted during the move.
 *
 * Both branches are captured because the header icon chrome switches on
 * `result.error` (red vs emerald), and closed→null is the guard the parent used
 * to inline as `{testApiResult && (…)}`.
 *
 * revert: delete together with components/hook/form/HookTestApiResultDialog.tsx.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

import { HookTestApiResultDialog } from '../components/hook/form/HookTestApiResultDialog';

const noop = () => {};

describe('HookTestApiResultDialog DOM is unchanged by the extraction', () => {
  it('renders nothing when result is null', () => {
    const { container } = render(
      <HookTestApiResultDialog result={null} onClose={noop} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('success branch (emerald icon)', () => {
    const { container } = render(
      <HookTestApiResultDialog
        result={{ status: 200, data: { ok: true } }}
        onClose={noop}
      />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('error branch (red icon)', () => {
    const { container } = render(
      <HookTestApiResultDialog
        result={{ error: 'boom', detail: 'timeout' }}
        onClose={noop}
      />,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('close button and header X both call onClose', async () => {
    const calls: string[] = [];
    const { getAllByRole } = render(
      <HookTestApiResultDialog
        result={{ ok: 1 }}
        onClose={() => calls.push('x')}
      />,
    );
    // two buttons: the header X and the footer Close — both wired to onClose
    const buttons = getAllByRole('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => b.click());
    expect(calls).toEqual(['x', 'x']);
  });
});
