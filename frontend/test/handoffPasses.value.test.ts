/* [FEAT-20260818-PASSBADGE] which chain-run steps get a pass label
 * ===========================================================================
 * Back end change of 18/08/2026: a run that the customer retried now returns
 * one audit row PER PASS (`attempt`: 0 = the pass the slip started, >0 = a
 * [ลองใหม่] tap), and the rows arrive in real time order. On the page that
 * reads topup → walletpay → topup, so a badge has to say where pass 2 began.
 *
 * The data behind these cases is the real run `a0d000000000000000000041`
 * (owner-reported): four rows, two per pass.
 *
 * WHAT IS PINNED
 *   1. a run that never retried gets NO badge — otherwise ~95% of runs carry a
 *      "pass 1" that tells the reader nothing
 *   2. a run that did retry labels EVERY row, including the first pass, so the
 *      two groups can be told apart
 *   3. `attempt` is 0-based and operators count from 1
 *   4. rows written before the field existed (absent / null) read as pass 1 and
 *      never trigger a badge on their own
 */
import { describe, expect, it } from 'vitest';

import {
  hasMultiplePasses,
  passIndex,
  passNumber,
} from '../utils/handoffPasses';

/** The shape the page receives, trimmed to what the rule reads. */
const RUN_SINGLE_PASS = [{ attempt: 0 }, { attempt: 0 }];
/** Run 6a83e019…1131 after the retry: two passes, two rows each. */
const RUN_TWO_PASSES = [
  { attempt: 0 },
  { attempt: 0 },
  { attempt: 1 },
  { attempt: 1 },
];
/** The same run as stored before the back end carried `attempt`. */
const RUN_LEGACY = [{}, {}];

describe('[PASSBADGE] a badge appears only when a run really has more than one pass', () => {
  it('stays silent on a run that was never retried', () => {
    expect(hasMultiplePasses(RUN_SINGLE_PASS)).toBe(false);
  });

  it('labels a run that was retried', () => {
    expect(hasMultiplePasses(RUN_TWO_PASSES)).toBe(true);
  });

  it('stays silent on rows written before the field existed', () => {
    expect(hasMultiplePasses(RUN_LEGACY)).toBe(false);
    expect(hasMultiplePasses([{ attempt: null }])).toBe(false);
  });

  it('survives the shapes a page can actually be handed', () => {
    expect(hasMultiplePasses(undefined)).toBe(false);
    expect(hasMultiplePasses(null)).toBe(false);
    expect(hasMultiplePasses([])).toBe(false);
  });
});

describe('[PASSBADGE] the number an operator reads', () => {
  it('counts from 1 while the field counts from 0', () => {
    expect(passNumber({ attempt: 0 })).toBe(1);
    expect(passNumber({ attempt: 1 })).toBe(2);
  });

  it('treats a missing or unusable value as the first pass', () => {
    expect(passNumber({})).toBe(1);
    expect(passNumber({ attempt: null })).toBe(1);
    expect(passNumber(undefined)).toBe(1);
    // A negative or non-numeric value is data damage, not a pass — clamp to the
    // first rather than render "pass 0" or "pass NaN" at an operator.
    expect(passIndex({ attempt: -3 })).toBe(0);
    expect(passIndex({ attempt: Number.NaN })).toBe(0);
  });

  it('labels every row of a retried run, first pass included', () => {
    expect(RUN_TWO_PASSES.map(passNumber)).toEqual([1, 1, 2, 2]);
  });
});
