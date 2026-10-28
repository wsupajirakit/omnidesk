/**
 * [FEAT-20260830-CLOSEWIZARD] the close-case walkthrough's state, in one place.
 *
 * WHY A HOOK AND NOT STATE IN `TicketChat.tsx`: that page is already ~6,600
 * lines and the owner's standing rule is *"ห้ามยัดเข้า ticket มันบวม"*. Every
 * rule of the walkthrough — where it starts, when it may advance, what the
 * footer button should say — lives here, next to the component it drives, so
 * the page keeps only the wiring.
 *
 * WHAT IT OWNS
 *   · the step index, reset whenever the dialog opens or the topic list changes
 *   · `canAdvance` — the current topic must be answered before moving on
 *   · `isLast` / `confirmKind` — what the modal's footer button means right now
 *
 * WHAT IT DOES NOT OWN
 *   · the answers (the page holds them; they must survive going back)
 *   · the actual close (the page calls `executeAction`)
 *   · the missing-attempt counter ([FIX-20260830-SHAKEEVERYTIME]) — that is a
 *     property of "a confirm was blocked", which applies to the last step too
 *
 * ⚠️ NO TOPICS ⇒ `total === 0` and `isLast === true`, so a case with no options
 *    behaves exactly as it did before the wizard existed: one press closes it.
 *
 * revert: delete this file and the `useCloseCaseWizard(...)` call in
 *         `TicketChat.tsx`; `CloseCaseSections` falls back to its `stepIndex`
 *         default of 0.
 */
import { useCallback, useEffect, useState } from 'react';

import type { CloseCaseAnswers, CloseCaseTopic } from './CloseCaseSections';

export interface CloseCaseWizard {
  /** which topic is on screen */
  stepIndex: number;
  /** how many topics this member has */
  total: number;
  /** true on the final step — and when there are no topics at all */
  isLast: boolean;
  /** the current topic is answered, so the walkthrough may move on */
  canAdvance: boolean;
  /** what the footer button means now: advance a step, or close the case */
  confirmKind: 'next' | 'close';
  /** step forward; a no-op on the last step (the page closes the case there) */
  next: () => void;
  /** step back; `undefined` on the first step so the control is not rendered */
  back?: () => void;
}

export function useCloseCaseWizard(
  topics: CloseCaseTopic[],
  answers: CloseCaseAnswers,
  /** the dialog's identity — changing it restarts the walkthrough */
  dialogKey: string | null,
): CloseCaseWizard {
  const [stepIndex, setStepIndex] = useState(0);

  /* Restart on a NEW dialog and whenever the topic list itself changes — the
     fresh follow-up read can replace the list a moment after the dialog opens
     ([FEAT-20260830-FOLLOWUPFRESH]), and a stale index would land on the wrong
     topic or past the end. */
  const topicKey = topics.join(',');
  useEffect(() => {
    setStepIndex(0);
  }, [dialogKey, topicKey]);

  const total = topics.length;
  /* clamped, never trusted: a list that shrinks under us must not leave the
     index pointing past the end */
  const safeIndex = total === 0 ? 0 : Math.min(stepIndex, total - 1);
  const activeTopic = topics[safeIndex];
  const canAdvance = activeTopic ? answers[activeTopic] !== undefined : true;
  const isLast = total === 0 || safeIndex >= total - 1;

  const next = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, Math.max(total - 1, 0)));
  }, [total]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  return {
    stepIndex: safeIndex,
    total,
    isLast,
    canAdvance,
    confirmKind: isLast ? 'close' : 'next',
    next,
    back: safeIndex > 0 ? back : undefined,
  };
}
