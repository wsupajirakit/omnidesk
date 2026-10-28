/**
 * [FIX-20260830-SAFEFIRST] the safe choice sits above the destructive one.
 *
 * Owner 30/08: in the close-case dialog the green "keep following" option goes
 * on top, the red one underneath. `registration` was authored the other way
 * round (stop first); deposit/withdraw were already correct.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  CloseCaseSections,
  type CloseCaseTopic,
} from '../components/member/follow-up/CloseCaseSections';

const noop = () => {};

/** testids in DOM order for one topic: close-case-<topic>-<value> */
const orderFor = (topic: CloseCaseTopic): string[] => {
  const group = document.querySelector(`[data-testid="close-case-topic-${topic}"]`);
  return Array.from(group?.querySelectorAll('[data-testid^="close-case-"]') ?? [])
    .map((el) => el.getAttribute('data-testid') ?? '')
    .filter((id) => id !== `close-case-topic-${topic}`);
};

/* [FEAT-20260830-CLOSEWIZARD] one topic per step now, so a test that wants a
   given topic on screen renders it AT its step. The safe-first rule is unchanged
   — it just applies to the step that is showing. */
const mount = (topics: CloseCaseTopic[], stepIndex = 0) =>
  render(
    <CloseCaseSections topics={topics} answers={{}} onChange={noop} stepIndex={stepIndex} />,
  );

describe('the safe option is always first', () => {
  it('🔴 registration: keep (safe) above stop (destructive) — it was inverted', () => {
    mount(['registration']);
    expect(orderFor('registration')).toEqual([
      'close-case-registration-keep',
      'close-case-registration-stop',
    ]);
  });

  it('deposit keeps its already-correct order: follow, then unfollow', () => {
    mount(['deposit']);
    expect(orderFor('deposit')).toEqual([
      'close-case-deposit-follow',
      'close-case-deposit-unfollow',
    ]);
  });

  it('withdraw likewise', () => {
    mount(['withdraw']);
    expect(orderFor('withdraw')).toEqual([
      'close-case-withdraw-follow',
      'close-case-withdraw-unfollow',
    ]);
  });

  it('EVERY step is safe-first — walked one at a time', () => {
    const all = ['registration', 'deposit', 'withdraw'] as CloseCaseTopic[];
    all.forEach((t, i) => {
      const view = mount(all, i);
      const [first] = orderFor(t);
      expect(first).not.toMatch(/-(stop|unfollow)$/);
      view.unmount();
    });
  });

  it('both options still render on a step — sorting must not drop one', () => {
    mount(['registration', 'deposit', 'withdraw']);
    expect(screen.getAllByRole('radio').length).toBe(2);
  });
});
