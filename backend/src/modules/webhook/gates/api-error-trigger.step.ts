/**
 * [PROG-20260905-LADDER] legacy:3922-3928 — remember the failed profile fetch, do not act
 * on it yet.
 *
 * ⚠️ IT DOES NOT END THE TURN, AND THAT IS THE WHOLE POINT. A failed profile fetch is not
 * fatal here: the decision waits until we know whether the answer actually quoted an API
 * number, which is the `shouldBlockForApiError` gate ~230 lines further down. A step that
 * only computes is still a step — the ladder is interleaved, and pretending otherwise is
 * what would force the computation to stay behind in the spine.
 *
 * ⚠️ IT RE-STAMPS THE CLOCK. `bangkokTime` is one of the nine values the `assistTurn()`
 * thunk re-reads at the moment of each call, so this write has to reach the spine's own
 * local — the caller assigns it back on the line after the ladder runs. A value frozen
 * here instead would hand the Telegram hand-off an empty clock with every test still
 * green, because the shape would be right and only the value wrong.
 *
 * 🔴 AND IT IS THE SECOND WRITER OF THAT FIELD, IN A DIFFERENT FORMAT. The first is
 * `room-bootstrap/combined-profile.ts`, which produces `en-GB` with a spelled month —
 * `05 September 2026 at 22:15:30`. This line produces the `th-TH` default, which is
 * day/month/**Buddhist year**: `5/9/2569 22:15:30`. Both reach the same operator, through
 * `assistTurn()` and through `telegram-no-answer-notify.ts:107`
 * (`- เวลา: ${args.bangkokTime}`), so the date format an operator sees depends on whether
 * the profile fetch failed — and one of the two is 543 years off the other.
 *
 * ⚠️ NOT FIXED HERE ON PURPOSE. Both formats are what shipped; picking one changes what
 * operators have been reading for months, and that is the owner's call. It is PINNED
 * instead, by `z-test/unit/two-writer-locals.spec.ts`, so whoever unifies it gets a named
 * red naming both writers and the reader. ตรึงไว้ให้เห็น ไม่ใช่แอบแก้
 */

import type { LadderStep } from './ladder.types';

export const apiErrorTriggerStep: LadderStep = {
  id: 'api-error-trigger',
  describe: 'record a failed profile fetch and re-stamp the Thai clock',
  enabled: true,
  mustFollow: ['require-user-text'],
  orderNote:
    'it runs on the text path only; above the text guard it would also fire for events ' +
    'that never reach the model (webhook.service.ts:4167)',

  when: (ctx) => Boolean(ctx.profileData['_error_trigger']),
  reads: ['profileData'],
  writes: ['apiErrorTrigger', 'bangkokTime'],

  run: (ctx) => {
    ctx.apiErrorTrigger = ctx.profileData['_error_trigger'];
    ctx.bangkokTime = new Date().toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
    });
    return 'continue';
  },
};
