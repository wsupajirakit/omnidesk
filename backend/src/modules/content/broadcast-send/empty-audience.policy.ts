/**
 * [FEAT-20260903-BCASTEMPTYAUD] May an OA with nobody selected still be sent to?
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock. One switch, one function.
 *
 * 🔑 THE QUESTION IS ABOUT THE PIPE, NOT ABOUT THE AUDIENCE.
 *
 * `/message/broadcast` carries NO recipient list — LINE fans the message out to
 * every friend of the channel. `oa-executor.ts:250-273` already sends that shape
 * as ONE request with `to: []`: no pager, no chunking, no dedupe, no resume. So
 * a headcount of zero says nothing about whether the OA can be sent to; it only
 * says our `chat_rooms` table does not know those followers.
 *
 * `run-plan.ts` nevertheless marked EVERY zero-recipient OA `skipReason: 'empty'`,
 * which made `executeOa` refuse it at its `plan.sendable` guard. The effect was a
 * campaign of pure `{{site_rules.*}}` — a card that needs no member data at all —
 * being silently dropped for an OA whose followers we simply have not recorded.
 * `new-send.service.ts:36-38` had already written this down as a known difference
 * from the old sender; owner decision 03/09 is to close it.
 * นับได้ 0 = เราไม่รู้จักผู้ติดตาม ไม่ใช่ไม่มีผู้ติดตาม.
 *
 * ⚠️ MULTICAST IS NOT TOUCHED, and that is the whole safety of this file.
 *    `multicast:*` names its recipients, so zero recipients there means a request
 *    addressed to nobody — which LINE rejects and which would burn a request for
 *    certain. Those cells keep skipping exactly as before.
 *
 * revert: set the switch below to `false` — `skipsEmptyAudience` then answers
 * `true` for every cell and `run-plan.ts` behaves byte-for-byte as it did before
 * this file existed. Delete the file and its one call site to remove it fully.
 */
import { addressesRecipients } from './send-loop.helpers';
import type { SendCell } from './send-matrix.registry';

/**
 * The switch. `false` = today's behaviour for every cell.
 *
 * ⚠️ A plain const rather than an env var, following `checks.config.ts`: a rule
 *    that can be flipped per environment is a rule nobody can predict from the
 *    code. Flip it here, in the diff, where a reviewer sees it.
 */
export const ALLOW_EMPTY_AUDIENCE_ON_BROADCAST = true;

/**
 * Should a headcount of zero skip this OA?
 *
 * `true`  ⇒ skip it (`skipReason: 'empty'`), as `run-plan.ts` always did.
 * `false` ⇒ let it run: the request this cell makes does not name anybody, so
 *           there is nothing an empty selection could break.
 */
export function skipsEmptyAudience(cell: SendCell): boolean {
  if (!ALLOW_EMPTY_AUDIENCE_ON_BROADCAST) return true;
  return addressesRecipients(cell);
}
