/* [FEAT-20260818-PASSBADGE] Which pass of a chain run a step belongs to.
 * ===========================================================================
 * A run normally walks its legs once — topup, then walletpay. Every [ลองใหม่] tap
 * sends it round AGAIN, and as of 18/08/2026 the back end returns one audit row
 * per pass (`attempt`: 0 for the run the slip started, >0 for a tap) ordered by
 * real time. Without a label the page reads as one confusing sequence —
 * topup, walletpay, topup — with nothing saying where the second attempt began.
 *
 * Why this is a module and not two lines inside `HandoffHistory.tsx`: the file
 * is already on the `max-lines` waiver, and a rule about WHICH rows get a badge
 * is a decision worth pinning in a test rather than re-reading out of JSX.
 * แยกออกมาเพื่อเทสได้จริง และไม่ทำให้หน้าที่ใหญ่อยู่แล้วบวมขึ้นอีก.
 */

/** The `attempt` field as the page receives it — absent on rows written before
 *  the back end carried one, which read as the first pass. */
export type PassBearing = { attempt?: number | null };

/** `attempt` coerced to a pass index, tolerating null/undefined/garbage. */
export const passIndex = (step: PassBearing | null | undefined): number => {
  const n = Number(step?.attempt ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Should this run's steps be labelled with their pass?
 *
 * Only when a run genuinely has more than one. Labelling every ordinary run
 * "pass 1" would add a badge to the ~95% that never retried, which is noise
 * rather than information — and a run whose rows predate `attempt` all report
 * 0, so it stays unlabelled exactly as it renders today.
 */
export const hasMultiplePasses = (
  steps: ReadonlyArray<PassBearing> | null | undefined,
): boolean => (steps ?? []).some((s) => passIndex(s) > 0);

/** Human-facing pass number: `attempt` is 0-based, operators count from 1. */
export const passNumber = (step: PassBearing | null | undefined): number =>
  passIndex(step) + 1;
