/**
 * [FIX-20260830-CLOSEFOCUS] a blocked confirm must TAKE the admin to what is missing.
 *
 * Owner 30/08: with options on screen, pressing ยืนยัน without answering must
 * not close the case — it has to bounce and focus every remaining spot.
 * The red state already existed ([FIX-20260830-CLOSEMISSING]); what is added is
 * the shake on each unanswered option and focus landing on the first one.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CloseCaseSections,
  missingTopics,
  type CloseCaseAnswers,
  type CloseCaseTopic,
} from '../components/member/follow-up/CloseCaseSections';

const ALL: CloseCaseTopic[] = ['registration', 'deposit', 'withdraw'];

/** Renders with the missing flag already raised, like a blocked confirm. */
/* [FEAT-20260830-CLOSEWIZARD] one topic per step, so a blocked confirm marks
   and focuses the STEP that is showing. The rules are unchanged; the surface is
   one topic instead of the whole list. */
const blocked = (
  answers: CloseCaseAnswers = {},
  topics = ALL,
  attempt = 1,
  stepIndex = 0,
) =>
  render(
    <CloseCaseSections
      topics={topics}
      answers={answers}
      onChange={() => {}}
      showMissing
      missingAttempt={attempt}
      stepIndex={stepIndex}
    />,
  );

const shaking = () =>
  Array.from(document.querySelectorAll('.tc-close-missing')).map((el) =>
    el.getAttribute('data-testid'),
  );

describe('every unanswered option is marked', () => {
  it('both options of the CURRENT step shake when it is unanswered', () => {
    blocked();
    expect(shaking().length).toBe(2);
  });

  it('walking every step, each unanswered pair shakes in turn', () => {
    ALL.forEach((_t, i) => {
      const view = blocked({}, ALL, 1, i);
      expect(shaking().length).toBe(2);
      view.unmount();
    });
  });

  it('an ANSWERED step does not shake; an unanswered one does', () => {
    const answered = blocked({ deposit: 'follow' }, ALL, 1, 1); // deposit step
    expect(shaking()).toEqual([]);
    answered.unmount();
    blocked({ deposit: 'follow' }, ALL, 1, 2); // withdraw step, still unanswered
    expect(shaking().length).toBe(2);
  });

  it('nothing shakes once the step is answered', () => {
    blocked({ registration: 'keep', deposit: 'follow', withdraw: 'follow' });
    expect(shaking()).toEqual([]);
  });

  it('nothing shakes before a confirm was attempted (showMissing false)', () => {
    render(<CloseCaseSections topics={ALL} answers={{}} onChange={() => {}} />);
    expect(shaking()).toEqual([]);
  });

  it('unanswered options are announced as invalid to a screen reader', () => {
    blocked();
    const el = screen.getByTestId('close-case-registration-keep');
    expect(el.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('focus lands on the first thing still needed', () => {
  it('⭐ the FIRST unanswered topic gets focus, not the last', () => {
    blocked();
    // registration is first in ALL, and its safe option renders on top
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'close-case-registration-keep',
    );
  });

  it('⭐ the NEXT step focuses its own first option', () => {
    blocked({ registration: 'keep' }, ALL, 1, 1);
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'close-case-deposit-follow',
    );
  });

  it('focus is not stolen when the step is answered', () => {
    blocked({ registration: 'keep', deposit: 'follow', withdraw: 'follow' });
    expect(document.activeElement?.getAttribute('data-testid')).toBeFalsy();
  });

  it('the focused element is reachable by keyboard and acts as a radio', () => {
    blocked();
    const el = document.activeElement as HTMLElement;
    expect(el.getAttribute('role')).toBe('radio');
    expect(el.getAttribute('tabindex')).toBe('0');
  });
});

describe('the gate itself is unchanged', () => {
  it('missingTopics still decides — and an empty topic list blocks nothing', () => {
    expect(missingTopics([], {})).toEqual([]);
    expect(missingTopics(ALL, {})).toEqual(ALL);
    expect(missingTopics(ALL, { registration: 'stop', deposit: 'follow', withdraw: 'follow' })).toEqual([]);
  });

  it('no options ⇒ nothing renders, so a plain close is untouched', () => {
    const { container } = render(
      <CloseCaseSections topics={[]} answers={{}} onChange={() => {}} showMissing />,
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('[FIX-20260830-SHAKEEVERYTIME] every press answers, not just the first', () => {
  it('⭐ a NEW attempt with the same answers re-focuses the first missing option', () => {
    /* 🔴 the bug: `followUpMissing` was a boolean, so a second press set true
       over true — no state change, no re-render, no animation restart and no
       re-focus. The dialog shook once and then sat still. */
    const view = render(
      <CloseCaseSections topics={ALL} answers={{}} onChange={() => {}} showMissing missingAttempt={1} />,
    );
    (document.activeElement as HTMLElement)?.blur();
    expect(document.activeElement?.getAttribute('data-testid')).not.toBe(
      'close-case-registration-keep',
    );
    view.rerender(
      <CloseCaseSections topics={ALL} answers={{}} onChange={() => {}} showMissing missingAttempt={2} />,
    );
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'close-case-registration-keep',
    );
  });

  it('⭐ the animation restarts: a missing option REMOUNTS on a new attempt', () => {
    const view = render(
      <CloseCaseSections topics={['deposit']} answers={{}} onChange={() => {}} showMissing missingAttempt={1} />,
    );
    const before = screen.getByTestId('close-case-deposit-follow');
    view.rerender(
      <CloseCaseSections topics={['deposit']} answers={{}} onChange={() => {}} showMissing missingAttempt={2} />,
    );
    const after = screen.getByTestId('close-case-deposit-follow');
    // a different node ⇒ React remounted it ⇒ the CSS animation plays again
    expect(after).not.toBe(before);
    expect(after.className).toContain('tc-close-missing');
  });

  it('an ANSWERED option does NOT remount when the attempt changes', () => {
    /* keys stay stable for answered options — remounting them would throw away
       their state for no reason and could steal focus from the missing one */
    const view = render(
      <CloseCaseSections topics={['deposit']} answers={{ deposit: 'follow' }} onChange={() => {}} showMissing missingAttempt={1} />,
    );
    const before = screen.getByTestId('close-case-deposit-follow');
    view.rerender(
      <CloseCaseSections topics={['deposit']} answers={{ deposit: 'follow' }} onChange={() => {}} showMissing missingAttempt={2} />,
    );
    expect(screen.getByTestId('close-case-deposit-follow')).toBe(before);
  });

  it('⭐ it scrolls the option into the MIDDLE, so one below the fold is reachable', () => {
    /* owner: "เลื่อนลงไปหาตัว focus ที่เหลือด้วย ถ้าเหลือตัวข้างล่าง" —
       `block:'nearest'` scrolls the minimum and can leave it hugging the edge. */
    const calls: unknown[] = [];
    const proto = window.HTMLElement.prototype as unknown as {
      scrollIntoView?: (o?: unknown) => void;
    };
    proto.scrollIntoView = (o?: unknown) => { calls.push(o); };
    render(
      <CloseCaseSections
        topics={ALL}
        answers={{ registration: 'keep', deposit: 'follow' }}
        onChange={() => {}}
        showMissing
        missingAttempt={1}
        stepIndex={2}
      />,
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ block: 'center' });
    delete proto.scrollIntoView;
  });
});
