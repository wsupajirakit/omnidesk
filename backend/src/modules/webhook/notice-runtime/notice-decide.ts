/**
 * [FEAT-20260822-NOTICERUNTIME] R3 — which notice fires, if any.
 * ===========================================================================
 * The thinnest possible orchestrator: walk NOTICE_CASE_ORDER, first `when`
 * that answers true wins, exactly ONE card per event. Precedence is entirely
 * the array in cases/index.ts (owner D13: time-first today, reorder there and
 * nowhere else). No match = null = the webhook behaves as if this feature
 * does not exist. Pure. revert: delete with the rest of `notice-runtime/`.
 */
import { providerFeatureOn } from '@/modules/customer-provider';

import { NOTICE_CASE_ORDER } from './cases';
import type { NoticeCase } from './cases';
import {
  NOTICE_RESPECTS_ASSIST,
  NOTICE_RESPECTS_HOOK_STATUS,
} from './notice-policy';
import type { NoticeContext, NoticeDecision } from './cases/notice-case.types';

/**
 * [FIX-20260822-NOTICEHARDEN #9] EVERY case that matches, in precedence order.
 * The guard walks this list and takes the first whose card is actually
 * configured, so one unusable case can no longer silence the ones behind it.
 * `decideNotice` below stays the single-answer form — the honest reading of
 * "which case wins" — and is what the case specs assert on.
 */
export function decideNoticeAll(
  ctx: NoticeContext,
  /* [FEAT-20260831-ADMINVIAWITHDRAW] WHICH cases to consult. Defaults to every
     one, so every existing caller is byte-identical; a door that screens only
     one lane passes that lane's slice. The slice is always DERIVED from
     `NOTICE_CASE_ORDER` (see notice-withdraw-lane.ts), never re-listed, so
     precedence keeps living in exactly one array. */
  cases: readonly NoticeCase[] = NOTICE_CASE_ORDER,
): NoticeDecision[] {
  if (NOTICE_RESPECTS_HOOK_STATUS && ctx.hookStatusOff) return [];
  /* [FIX-20260822-NOTICECOLLIDE] an assisted room silences every case at once
     — one check, both paths, flip NOTICE_RESPECTS_ASSIST to undo. */
  if (NOTICE_RESPECTS_ASSIST && ctx.assisted) return [];
  /* [FEAT-20261014-PROVFEATURES] the site has no notice world (loan_v1) — every door that
     asks here (text, withdraw button, slip lane) gets "no case"; the stamp never runs. */
  if (!providerFeatureOn('notice')) return [];
  return cases
    .filter((c) => c.when(ctx))
    .map((c) => ({
      caseId: c.caseId,
      cardField: c.cardField,
      stampKey: c.stampKey,
    }));
}

export function decideNotice(ctx: NoticeContext): NoticeDecision | null {
  /* [FIX-20260822-NOTICEPOLICY] the OA kill switch, honoured before any case is
     consulted — one check for all six rather than a condition copied into each.
     Policy, so it can be flipped: notice-policy.ts NOTICE_RESPECTS_HOOK_STATUS. */
  if (NOTICE_RESPECTS_HOOK_STATUS && ctx.hookStatusOff) return null;
  if (NOTICE_RESPECTS_ASSIST && ctx.assisted) return null;

  for (const c of NOTICE_CASE_ORDER) {
    if (c.when(ctx)) {
      return { caseId: c.caseId, cardField: c.cardField, stampKey: c.stampKey };
    }
  }
  return null;
}
