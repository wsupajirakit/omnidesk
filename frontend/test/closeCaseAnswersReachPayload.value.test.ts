/**
 * [FIX-20260830-CLOSEANSWERSTALE] the close-case answers must reach the payload.
 *
 * 🔴 The owner-reported bug: closing a case with "ไม่ติดตาม" ticked on both
 *    deposit and withdraw cleared nothing and wrote no audit row, while the case
 *    itself closed normally and no error appeared anywhere.
 *
 *    The back end was innocent — it logged `patchAfterClose=undefined
 *    jobStatus=2` against the running server. `executeAction` is a `useCallback`
 *    whose deps are `[activeTickets, completedTickets, currentUser, fetchActive]`
 *    and it read `closeTopics` / `closeAnswers` straight out of its closure. The
 *    dialog rendered and validated correctly (those read the live values during
 *    render), but the click ran an EARLIER render's callback, where
 *    `closeTopics` was still `[]`. The loop iterated nothing and the key was
 *    never added to the payload.
 *
 * Every test here is source-level on purpose: the failure is a captured value,
 * which no DOM assertion about the dialog can see — the dialog was always right.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '../pages/chat/TicketChat.tsx'),
  'utf8',
);
/** Comments quote the OLD broken code, so they must go before any matching. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const CODE = stripComments(SRC);

/** The body of `executeAction`, from its opening to its dependency array. */
const executeActionBody = (): string => {
  const start = CODE.indexOf('const executeAction = useCallback');
  expect(start).toBeGreaterThan(-1);
  const end = CODE.indexOf('}, [', start);
  expect(end).toBeGreaterThan(start);
  return CODE.slice(start, end);
};

describe('the ref exists and always mirrors what the screen shows', () => {
  it('a ref holds the topics and the answers together', () => {
    expect(CODE).toMatch(/closeCaseRef\s*=\s*useRef</);
  });

  it('it is assigned on EVERY render, not inside an effect', () => {
    /* MUTATION NOTE: an earlier version only looked for an unterminated
       `useEffect(` in the 200 chars before the assignment, which a one-line
       `useEffect(() => { ... });` sails straight past — that mutation stayed
       green. The assignment must be a STATEMENT of the component body, so the
       pin is now the line itself: it starts at two-space indent with the ref,
       and nothing else may open on it.
       Why it matters: an effect runs AFTER paint, so a click landing in the
       same tick as a change would read the previous value — the very class of
       bug this file exists for. */
    const line = CODE.split('\n').find((l) =>
      /closeCaseRef\.current\s*=/.test(l),
    );
    expect(line, 'the ref must be assigned somewhere').toBeTruthy();
    expect((line as string).trimStart()).toMatch(
      /^closeCaseRef\.current = \{ topics: closeTopics, answers: closeAnswers \};$/,
    );
    expect(line).not.toMatch(/useEffect|useLayoutEffect|useMemo|=>/);
  });

  it('the ref is declared AFTER closeTopics, so it can read it', () => {
    expect(CODE.indexOf('const closeTopics')).toBeLessThan(
      CODE.indexOf('closeCaseRef'),
    );
  });
});

describe('executeAction reads the LIVE answers, never its closure', () => {
  it('it builds the payload from the ref', () => {
    expect(executeActionBody()).toContain('closeCaseRef.current');
  });

  it('🔴 it never loops over the captured `closeTopics`', () => {
    // this is the exact line that shipped the bug
    expect(executeActionBody()).not.toMatch(/for\s*\(\s*const\s+topic\s+of\s+closeTopics\s*\)/);
  });

  it('🔴 it never indexes the captured `closeAnswers`', () => {
    expect(executeActionBody()).not.toMatch(/closeAnswers\s*\[/);
  });

  it('it still sends the key only when something was answered', () => {
    // an empty object must NOT be sent: the BE tells "chose not to" apart from
    // "was never asked", and a bare {} would look like the first
    expect(executeActionBody()).toMatch(
      /Object\.keys\(answered\)\.length\s*>\s*0[\s\S]{0,80}patch_after_close\s*=\s*answered/,
    );
  });

  it('the payload key is the one the BE reads', () => {
    // a rename on either side is silent: the BE simply sees undefined
    expect(executeActionBody()).toContain('patch_after_close');
  });
});

describe('the dialog itself keeps reading the live values', () => {
  it('the gate that blocks confirm still uses closeTopics directly', () => {
    // that check runs during render, where the closure problem does not exist —
    // routing it through the ref would be a pointless indirection
    expect(CODE).toMatch(/missingTopics\(closeTopics,\s*closeAnswers\)/);
  });

  it('the sections are still driven by closeTopics', () => {
    expect(CODE).toMatch(/topics=\{closeTopics\}/);
  });
});
