/**
 * [FEAT-20260902-NOWBLOCK] `[START_OF_NOW]` — the office-hours decision, made in code.
 * ===========================================================================
 * THE ONE DOOR of this feature. The webhook imports `nowBlockText` from here and
 * nothing else; every other file in this folder is an internal.
 *
 * ── WHAT IT REPLACES ──────────────────────────────────────────────────────
 * The prompt hands the model a live Thai date line and lets it work out, on every
 * single answer: convert a two-digit Buddhist year → compare hh:mm against a
 * window → scan a public-holiday list → conclude. The data it is given is right;
 * the DECISION is what goes wrong, and that decision sits with the one component
 * that is not deterministic. This folder computes the decision and hands over a
 * finished answer, leaving the model one job: read `status`.
 *
 * ── SHAPE, DICTATED BY THE OWNER'S EXTENSION RULE (webhook.service.ts:31-43) ──
 * An independent, detachable folder reached by ONE guarded call that early-returns.
 * Switched off, or data absent, must behave byte-identical to before the change.
 * Removing the feature costs: delete this folder + delete its single call line.
 * ⚠️ It adds NO provider, NO DI token and NO module import — so it never touches
 *    `webhook.module.ts`, where two existing plug patches already share context
 *    lines (see be_todo121). A pure folder cannot make that worse.
 *
 * ── OFF IS THE DEFAULT AND OFF IS SILENT ──────────────────────────────────
 * `nowBlockText()` returns `null` when the switch is off AND when anything at all
 * goes wrong. `null` means the caller adds nothing, so the prompt is byte-identical
 * to today. A diagnostics failure must never cost a customer their answer.
 * ปิดอยู่ = ไม่มีอะไรเพิ่มเข้าไปในพรอมป์เลยแม้แต่ไบต์เดียว
 *
 * revert: delete this folder + its single call line in webhook.service.ts.
 */
import { buildNowBlock, type NowBlockInput } from './now-block.builder';
import { resolveNowBlockMode } from './now-block.mode';
import { resolveOfficeHours } from './policy/resolve-office-hours';

/* [FIX-20261018-NOWLEAK] the outbound guard — used by the reply sweep */
export { stripNowBlocks } from './now-block.strip';
export {
  NOW_BLOCK_END,
  NOW_BLOCK_START,
  buildNowBlock,
  renderNowBlock,
  resolveNowFacts,
  type NowBlockFacts,
  type NowBlockInput,
} from './now-block.builder';
export {
  NOW_BLOCK_DEFAULT_MODE,
  resolveNowBlockMode,
  type NowBlockMode,
} from './now-block.mode';
export {
  resolveOfficeHours,
  type OfficeHours,
} from './policy/resolve-office-hours';
export { bangkokNow, type BangkokNow } from './bangkok-now';
export {
  resolveNowStatus,
  shouldAppendTimeSuffix,
  type NowStatus,
} from './policy/now-status';
export {
  OFFICE_CLOSE_MIN,
  OFFICE_HOURS_TEXT,
  OFFICE_OPEN_MIN,
} from './policy/office-hours';
export type { HolidaySource } from './calendar/holiday-source.port';
export {
  HOLIDAYS_PENDING,
  TH_HOLIDAYS,
  TH_HOLIDAYS_LAST_COVERED,
  staticHolidaySource,
} from './calendar/th-holidays';

/** What the seat knows at the moment it asks. */
export interface NowBlockRequest extends NowBlockInput {
  /** The OA document — carried to the resolver so per-OA is a one-line change later. */
  hook: Record<string, unknown> | null | undefined;
}

/**
 * The block for this reply, or `null` when nothing should be added.
 *
 * `null` on: the switch off · an unusable instant · any thrown error. The caller
 * treats `null` as "no change" and the prompt keeps today's exact bytes.
 *
 * ⚠️ NEVER let this throw. It sits on the path a customer is waiting on, and the
 * feature is a convenience for the model — not a reason to lose an answer.
 */
export function nowBlockText(request: NowBlockRequest): string | null {
  try {
    if (resolveNowBlockMode(request.hook) !== 'on') return null;

    /* The window is RESOLVED, not read off the constants, so that a per-OA window
       later is a change inside `resolveOfficeHours` and nowhere else — the same
       seam the switch above already has. An explicit override on the request still
       wins: specs pass one to exercise a boundary, and a caller that has already
       decided must not be second-guessed by this door. */
    const hours = resolveOfficeHours(request.hook);
    const text = buildNowBlock({
      ...request,
      openMin: request.openMin ?? hours.openMin,
      closeMin: request.closeMin ?? hours.closeMin,
      officeHoursText: request.officeHoursText ?? hours.text,
    });
    return text.length > 0 ? text : null;
  } catch {
    /* Deliberately silent: logging here would need a logger this pure folder does
       not have, and the caller already logs its own failures. The observable
       signal that the block did or did not travel is the existing `[AI-BLOCKS]`
       line, which prints `kind:length` for every block on the wire. */
    return null;
  }
}
