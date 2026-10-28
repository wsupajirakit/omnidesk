/**
 * [FEAT-20260822-NOTICERUNTIME] R3 — assemble one NoticeContext per event.
 * ===========================================================================
 * The single funnel from raw webhook material (hook row, message text, jsQR
 * verdict, the turn's site-rules block, the clock) into the flat context every
 * case reads. All the reading rules live in the R1 checkers it calls:
 * toggles `=== true`, scope via readNoticeScope, site rules fail-open, the
 * Thai wall-clock window. Pure — the caller hands in `now`.
 *
 * ⚠️ `siteRulesRaw` MUST be the block of THIS turn's profileData (the same
 * source the AI block reads) — `hook.raw_site_rules_data` is a panel cache
 * that is stale-by-one-request on the webhook path (see the checker's header).
 * revert: delete with the rest of `notice-runtime/`.
 */
import {
  readNoticeScope,
  readNoticeCheckFlag,
  readNoticeToggle,
} from '@/modules/hooks';

import type { NoticeContext } from './cases/notice-case.types';
import { noticeSiteRuleCheck } from './notice-site-rule-check';
import { noticeTimeWindow } from './notice-time-window';
import { matchDepositWord, matchWithdrawWord } from './notice-word-match';

/** The jsQR verdict value that means "a QR was actually found". */
export const QR_FOUND_REASON = 'qr_found';

export function buildNoticeContext(input: {
  eventKind: 'text' | 'image';
  hook: Record<string, unknown>;
  /** the customer's text — text events only, ignored for images. */
  text?: unknown;
  /** qrPrescan.reason — image events only. */
  qrReason?: string;
  /** THIS turn's site-rules block (never the hook column). */
  siteRulesRaw?: unknown;
  /** true when an operator holds the room (`skipBotProcessing`). */
  assisted?: boolean;
  now: Date;
}): NoticeContext {
  const site = noticeSiteRuleCheck(input.siteRulesRaw);
  return {
    eventKind: input.eventKind,
    /* [FIX-20260822-NOTICEPOLICY] `status === 0` is the OA kill switch; the
       webhook's own rule ([FEAT-20260806-STATUSOFF]) is that such an OA stays
       silent and only stores the chat. The notice guard sits far above that
       gate in the flow, so it must honour the switch itself — read here from
       the hook already in hand. Legacy rows without `status` are treated as ON,
       matching every other reader. สวิตช์ปิด OA = การ์ดต้องเงียบด้วย. */
    hookStatusOff: input.hook['status'] === 0,
    /* [FIX-20260822-NOTICECOLLIDE] `skipBotProcessing` as the webhook computed
       it. Absent = not assisted, so a caller that does not know stays on the
       old behaviour rather than guessing. */
    assisted: input.assisted === true,
    depositOn: readNoticeToggle(input.hook, 'notice_deposit_status'),
    withdrawOn: readNoticeToggle(input.hook, 'notice_withdraw_status'),
    depositScope: readNoticeScope(input.hook['notice_deposit_scope']),
    /* [FEAT-20260823-NOTICECHECKFLAGS] the four wrap-flags — absent=ON reader,
       one per side per check. Set explicitly here so the cases' `!== false`
       and these reads agree on the same rule in prod. ขั้ว absent=เปิด */
    depositTimeCheckOn: readNoticeCheckFlag(
      input.hook,
      'notice_deposit_time_check',
    ),
    depositSiteStatusCheckOn: readNoticeCheckFlag(
      input.hook,
      'notice_deposit_sitestatus_check',
    ),
    withdrawTimeCheckOn: readNoticeCheckFlag(
      input.hook,
      'notice_withdraw_time_check',
    ),
    withdrawSiteStatusCheckOn: readNoticeCheckFlag(
      input.hook,
      'notice_withdraw_sitestatus_check',
    ),
    depositWord: input.eventKind === 'text' && matchDepositWord(input.text),
    withdrawWord: input.eventKind === 'text' && matchWithdrawWord(input.text),
    qrFound: input.eventKind === 'image' && input.qrReason === QR_FOUND_REASON,
    /* [FEAT-20260829-STATUSFIRST] default-off reader ON PURPOSE — the `_check`
       flags above use readNoticeCheckFlag (absent=ON); these two use
       readNoticeToggle (absent=OFF) or every legacy OA changes on deploy day. */
    depositSiteStatusFirst: readNoticeToggle(
      input.hook,
      'notice_deposit_sitestatus_first',
    ),
    withdrawSiteStatusFirst: readNoticeToggle(
      input.hook,
      'notice_withdraw_sitestatus_first',
    ),
    inWindow: noticeTimeWindow(input.now),
    depositOff: site.deposit_off,
    withdrawOff: site.withdraw_off,
  };
}
