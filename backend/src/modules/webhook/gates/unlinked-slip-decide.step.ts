/**
 * [FEAT-20260809-REQUIREPROFILE] Step [2] of the owner's order — decide whether this slip
 * is refused because the sender has no account with this OA.
 *
 * ⚠️⚠️ THE GATE IS ONLY READ WHEN THE PRE-SCAN FOUND A QR (owner, 12/08). The setting is
 * about SLIPS. An image with no code is not a slip, so refusing it with "please link your
 * account first" answers a question the customer never asked — they sent an ordinary photo.
 * Seen on live traffic 12/08 before this guard existed: an ordinary photo from an
 * unregistered user was answered with `slip_require_profile_text` and stopped dead. That
 * was the bug, and `qrPrescanSawSlip` is the fix.
 *
 * ⚠️ `qrPrescanSawSlip` is TRUE whenever the pre-scan is off, in 'log' mode, or the read was
 * inconclusive — which keeps every existing OA byte-identical. The narrowing only happens
 * for an OA that opted into 'skip' AND whose image was read as having no QR.
 *
 * ⚠️ IT NEVER REFUSES ON UNCERTAINTY — upstream down, circuit open, 401/403, a
 * misconfigured profile endpoint. Treating those as "no account" would refuse real
 * customers' money. ไม่ชัด = ไม่ปฏิเสธ
 *
 * ⚠️ [FEAT-20260907-UNKNOWNPROFILEREVIEW] BUT "NOT REFUSED" NO LONGER MEANS "CARRIES
 * ON SILENTLY". This step now writes TWO verdicts about the same probe:
 *   · `blockUnlinked`         the upstream says this customer does not exist → refuse
 *   · `reviewUnknownProfile`  the upstream FAILED to answer → do not auto-check;
 *                             hand the slip to a human with the `review` card
 * They are mutually exclusive by construction, and everything that is neither — a
 * successful lookup, a fetch that never ran, an OA with no profile source — still
 * carries on exactly as it always did.
 *
 * ⚠️ IT ONLY DECIDES. Both replies are further down, past the notice guard, because
 * the notice runtime must get the first turn (owner, 24/08).
 */

import { asString } from '../logging/coerce-mask.util';
import { imgProbe } from '../logging/img-flow-probe';
import {
  shouldBlockUnlinkedSlip,
  shouldReviewUnknownProfile,
} from '../slip-flex/require-profile.gate';

import type { LadderStep, StepVerdict } from './ladder.types';

export const unlinkedSlipDecideStep: LadderStep = {
  id: 'unlinked-slip-decide',
  describe:
    'decide whether an unlinked sender`s slip is refused — decide only, not reply',
  enabled: true,
  mustFollow: ['qr-prescan'],
  orderNote:
    'the setting is about SLIPS, so it may only be consulted once the pre-scan has said ' +
    'whether this image carries a code at all (webhook.service.ts:2842)',
  reads: ['hook', 'slip', 'profileBlock', 'profileCircuitOpen'],
  writes: ['slip'],

  run: (ctx): StepVerdict => {
    const qrPrescanSawSlip = !ctx.slip.prescan.skipSlipVerify;
    /* Both rules read the SAME probe, so it is built once. Reading the context
       twice would let a future edit hand them different inputs and make the two
       verdicts disagree about the same turn. */
    const probe = {
      profileBlock: ctx.profileBlock ?? null,
      circuitOpen: ctx.profileCircuitOpen,
    };
    ctx.slip.blockUnlinked =
      qrPrescanSawSlip && shouldBlockUnlinkedSlip(ctx.hook, probe);
    /* [FEAT-20260907-UNKNOWNPROFILEREVIEW] The third answer — the lookup ran and
       failed, so the sender is unidentified and the slip must not be auto-checked.
       ⚠️ Gated by `qrPrescanSawSlip` for exactly the reason the line above is: if
          the pre-scan says this photo is not a slip, no slip rule may speak about
          it. Consulting it anyway is the 12/08 defect that answered an ordinary
          photo with "please link your account".
       ⚠️ The 404 case is NOT here — `shouldReviewUnknownProfile` returns it to
          `shouldBlockUnlinkedSlip`, so at most one of these two is ever true. */
    ctx.slip.reviewUnknownProfile =
      qrPrescanSawSlip && shouldReviewUnknownProfile(ctx.hook, probe);

    /* [OBS-20260812-IMGPROBE] SETTING 1. `blocked=true` is the only case that stops the
       turn here — no Swiftcheck, no ticket, no other setting gets a turn. */
    imgProbe('gate-require-profile', {
      setting_slip_require_profile: ctx.hook?.['slip_require_profile'],
      /* false ⇒ the pre QR check ruled this image out as a slip, so this setting is
         deliberately NOT consulted at all. */
      qrPrescanSawSlip,
      blocked: ctx.slip.blockUnlinked,
      /* [FEAT-20260907-UNKNOWNPROFILEREVIEW] reported beside `blocked` so one probe
         line says which of the three answers this turn got. Without it a review
         and a plain pass look identical in the log. */
      review_unknown_profile: ctx.slip.reviewUnknownProfile,
      profileStatus: ctx.profileBlock?.['status'],
      circuitOpen: ctx.profileCircuitOpen,
      willReply: ctx.slip.blockUnlinked
        ? (asString(ctx.hook?.['slip_require_profile_text']) || '').trim() ||
          'ยังไม่ได้ผูกบัญชี กรุณาผูกบัญชีก่อนแล้วส่งสลิปอีกครั้ง'
        : undefined,
    });
    return 'continue';
  },
};
