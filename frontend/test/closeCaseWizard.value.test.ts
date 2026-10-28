/**
 * [FEAT-20260830-CLOSEWIZARD] the close-case walkthrough — one topic per step.
 *
 * Owner 30/08: with options on screen, closing a case should walk through them
 * step by step rather than showing three sections and six radios at once.
 *
 * 🔴 The rule that must never break: a case with NO options closes in one press,
 *    exactly as it did before the wizard existed.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCloseCaseWizard } from '../components/member/follow-up/useCloseCaseWizard';
import type {
  CloseCaseAnswers,
  CloseCaseTopic,
} from '../components/member/follow-up/CloseCaseSections';

const ALL: CloseCaseTopic[] = ['registration', 'deposit', 'withdraw'];

const hook = (topics: CloseCaseTopic[], answers: CloseCaseAnswers = {}, key = 'k1') =>
  renderHook(({ t, a, k }) => useCloseCaseWizard(t, a, k), {
    initialProps: { t: topics, a: answers, k: key as string | null },
  });

describe('🔴 no options = the old behaviour, untouched', () => {
  it('one press closes: isLast true, confirm means close', () => {
    const { result } = hook([]);
    expect(result.current.total).toBe(0);
    expect(result.current.isLast).toBe(true);
    expect(result.current.confirmKind).toBe('close');
  });

  it('nothing blocks it — canAdvance is true with no topic to answer', () => {
    expect(hook([]).result.current.canAdvance).toBe(true);
  });

  it('there is no back control', () => {
    expect(hook([]).result.current.back).toBeUndefined();
  });
});

describe('walking the steps', () => {
  it('starts at the first topic, and the footer says ถัดไป', () => {
    const { result } = hook(ALL);
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.total).toBe(3);
    expect(result.current.isLast).toBe(false);
    expect(result.current.confirmKind).toBe('next');
  });

  it('⭐ an unanswered step cannot be stepped past', () => {
    expect(hook(ALL).result.current.canAdvance).toBe(false);
  });

  it('answering the current topic unlocks the step', () => {
    expect(hook(ALL, { registration: 'keep' }).result.current.canAdvance).toBe(true);
  });

  it('⭐ canAdvance follows the CURRENT topic, not the whole list', () => {
    // deposit answered, but step 0 is registration and it is not
    expect(hook(ALL, { deposit: 'follow' }).result.current.canAdvance).toBe(false);
  });

  it('the last step flips the footer to close', () => {
    const { result } = hook(ALL, { registration: 'keep', deposit: 'follow' });
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.stepIndex).toBe(2);
    expect(result.current.isLast).toBe(true);
    expect(result.current.confirmKind).toBe('close');
  });

  it('next never runs past the end', () => {
    const { result } = hook(ALL);
    act(() => { result.current.next(); result.current.next(); result.current.next(); result.current.next(); });
    expect(result.current.stepIndex).toBe(2);
  });
});

describe('going back', () => {
  it('no back control on the first step', () => {
    expect(hook(ALL).result.current.back).toBeUndefined();
  });

  it('a back control appears from the second step, and it steps back', () => {
    const { result } = hook(ALL, { registration: 'keep' });
    act(() => result.current.next());
    expect(result.current.back).toBeTypeOf('function');
    act(() => result.current.back!());
    expect(result.current.stepIndex).toBe(0);
  });

  it('back never runs past the start', () => {
    const { result } = hook(ALL, { registration: 'keep' });
    act(() => result.current.next());
    act(() => { result.current.back!(); result.current.back!(); });
    expect(result.current.stepIndex).toBe(0);
  });
});

describe('the walkthrough restarts when it should', () => {
  it('⭐ a NEW dialog starts at step 0', () => {
    const { result, rerender } = hook(ALL, { registration: 'keep' });
    act(() => result.current.next());
    expect(result.current.stepIndex).toBe(1);
    rerender({ t: ALL, a: { registration: 'keep' }, k: 'k2' });
    expect(result.current.stepIndex).toBe(0);
  });

  it('⭐ the topic list changing under it also restarts — the fresh read can replace it', () => {
    const { result, rerender } = hook(ALL, { registration: 'keep' });
    act(() => result.current.next());
    rerender({ t: ['deposit', 'withdraw'] as CloseCaseTopic[], a: {}, k: 'k1' });
    expect(result.current.stepIndex).toBe(0);
  });

  it('a shrinking list can never leave the index past the end', () => {
    const { result, rerender } = hook(ALL, { registration: 'keep', deposit: 'follow' });
    act(() => { result.current.next(); result.current.next(); });
    expect(result.current.stepIndex).toBe(2);
    // same key, so no reset effect — the clamp is what must save it
    rerender({ t: ['registration'] as CloseCaseTopic[], a: {}, k: 'k1' });
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.isLast).toBe(true);
  });
});
