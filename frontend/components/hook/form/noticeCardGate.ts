/**
 * [FEAT-20260822-NOTICEMODE] The D6 card gate, mirrored on the front end.
 * ===========================================================================
 * A notice toggle may only be ON when every card that side needs is bound.
 * The BACK END is the source of truth and enforces it on every write path
 * (`PUT /hook/notice/:id`, `PATCH /hook/notice/bulk`, and the clone route) —
 * see `omnidesk-api/src/modules/hooks/notice-settings/notice-settings.fields.ts`
 * `NOTICE_CARD_PAIRS` / `noticeCardViolation`. This file exists so the admin is
 * told BEFORE the request (owner decision D16: a warning modal, with the 400 as
 * the backstop), never to replace that check.
 *
 * ⚠️ KNOWN, ACCEPTED DUPLICATION — declared out loud, the same way
 * `HookPaymentFlexBlock.tsx` declares its badge table. The BE does not serve
 * these pairs over the API, so they are kept in sync BY HAND: change
 * `NOTICE_CARD_PAIRS` there → change the array below in the same round.
 * Nothing breaks functionally if it drifts — the modal simply stops matching
 * the 400 the server will answer with, which is worse than useless to an admin.
 * แก้ฝั่ง BE แล้วต้องมาแก้ที่นี่ด้วย ไม่งั้นคำเตือนจะไม่ตรงกับที่เซิร์ฟเวอร์ปฏิเสธ.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE BE FUNCTION:
 *  1. it returns EVERY violation, not the first — the admin fixes them in one
 *     pass instead of discovering them one 400 at a time;
 *  2. it reads the form bag directly (candidates only, no stored row), because
 *     the form already holds the effective state the write would leave behind.
 *
 * revert: delete this file, its import in HookNoticeTab.tsx, and the modal.
 */

export type NoticeScope = 'text' | 'all' | 'slip';

/** mirrors `readNoticeScope`: anything that is not 'all'/'slip' is 'text'. */
export const readScope = (value: unknown): NoticeScope =>
  value === 'all' || value === 'slip' ? value : 'text';

/** mirrors `readNoticeToggle`: a real `true`, never a truthy string. */
export const readToggle = (value: unknown): boolean => value === true;

/** mirrors `readNoticeFlex`: a non-empty id, or null. */
export const readFlex = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return String(value) || null;
};

export interface NoticeCardPair {
  /** the toggle that makes this card required */
  status: string;
  /** the hook field holding the card id */
  flex: string;
  /** i18n key for the card's own label — the same key the field uses */
  labelKey: string;
  /** required only while this scope field's effective value equals `value` */
  whenScope?: { field: string; value: NoticeScope };
}

/** ⚠️ MIRROR of NOTICE_CARD_PAIRS in the back end — keep the order too, so a
 *  reader comparing the two files can do it line by line. */
export const NOTICE_CARD_PAIRS: readonly NoticeCardPair[] = [
  {
    status: 'notice_deposit_status',
    flex: 'notice_deposit_flex_id',
    labelKey: 'hook_form.notice_deposit_flex_id',
  },
  {
    status: 'notice_deposit_status',
    flex: 'notice_deposit_offtime_flex_id',
    labelKey: 'hook_form.notice_deposit_offtime_flex_id',
  },
  {
    status: 'notice_withdraw_status',
    flex: 'notice_withdraw_flex_id',
    labelKey: 'hook_form.notice_withdraw_flex_id',
  },
  {
    status: 'notice_withdraw_status',
    flex: 'notice_withdraw_offtime_flex_id',
    labelKey: 'hook_form.notice_withdraw_offtime_flex_id',
  },
  {
    status: 'notice_deposit_status',
    flex: 'notice_all_offtime_flex_id',
    labelKey: 'hook_form.notice_all_offtime_flex_id',
    whenScope: { field: 'notice_deposit_scope', value: 'slip' },
  },
  {
    status: 'notice_deposit_status',
    flex: 'notice_all_disable_flex_id',
    labelKey: 'hook_form.notice_all_disable_flex_id',
    whenScope: { field: 'notice_deposit_scope', value: 'slip' },
  },
];

/**
 * Every card the current form state still owes, in pair order.
 * An empty array = the state the write routes will accept.
 */
export function noticeCardViolations(
  form: Record<string, unknown>,
): NoticeCardPair[] {
  return NOTICE_CARD_PAIRS.filter((pair) => {
    if (!readToggle(form[pair.status])) return false;
    if (
      pair.whenScope &&
      readScope(form[pair.whenScope.field]) !== pair.whenScope.value
    ) {
      return false;
    }
    return readFlex(form[pair.flex]) === null;
  });
}

/** the notice fields, for building the request body and nothing else.
 *
 * ⚠️ [FIX-20260823-FLAGSAVE] THIS LIST IS WHERE A NEW NOTICE FIELD SILENTLY
 * DIES. `pickNotice` builds the save body from it — a field missing here is
 * dropped BEFORE the request leaves the browser: the checkbox renders, the
 * click registers, the save succeeds, and the row never changes. That exact
 * failure shipped for a few hours on 23/08: the four check-flags were added to
 * the tab, the modal and the BE, but not here — the owner unticked a box,
 * saved, reopened, and it was back. A drift test now pins this list against
 * the BE's NOTICE_CHECK_FLAG_FIELDS so the next field cannot repeat it.
 * field ใหม่ของแท็บ notice ต้องเพิ่มที่นี่ด้วยเสมอ ไม่งั้นเซฟแล้วหายเงียบ */
export const NOTICE_FORM_FIELDS: readonly string[] = [
  'notice_deposit_status',
  'notice_withdraw_status',
  'follow_player_status',
  'notice_deposit_scope',
  'notice_withdraw_scope',
  // [FEAT-20260823-NOTICECHECKFLAGS] the four wrap-flags — absent=ON polarity
  'notice_deposit_time_check',
  'notice_deposit_sitestatus_check',
  'notice_withdraw_time_check',
  'notice_withdraw_sitestatus_check',
  // [FEAT-20260829-STATUSFIRST] absent=OFF polarity (default off, owner's order)
  'notice_deposit_sitestatus_first',
  'notice_withdraw_sitestatus_first',
  ...NOTICE_CARD_PAIRS.map((p) => p.flex),
];
