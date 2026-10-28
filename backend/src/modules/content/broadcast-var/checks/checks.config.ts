/**
 * [FEAT-20260822-BCASTCHECKS] One switch per checker.
 * ===========================================================================
 * เจ้าของสั่ง 22/08: "ทุกอย่างอิสระแยกกันทั้งหมด ไม่ว่าจะตัวเช็คอะไรก็ตาม".
 *
 * Every checker in this folder is independently switchable and independently
 * deletable. Turning one off must leave the others working and must never make
 * a card fail to send — each fallback is safe on its own.
 *
 * ⚠️ Plain consts, not env vars, on purpose: a checker that can be flipped per
 *    environment is a checker whose behaviour nobody can predict from the code.
 *    Flip it here, in the diff, where a reviewer sees it. (ภาพ = const, 22/08)
 *
 * revert: delete this file with the rest of `checks/`.
 */

export interface CheckSwitches {
  /** Replace empty values with `N/A` before substitution. */
  readonly emptyValue: boolean;
  /** Replace unusable image URLs with the fallback image. */
  readonly imageShape: boolean;
  /** Verify the gift cards the send profile the admin ticked. */
  readonly profileMatch: boolean;
  /**
   * [FEAT-20260903-BCASTSRFRESH] Refetch an OA's site rules before a run when
   * they are missing or older than `SITE_RULES_MAX_AGE_MS`.
   *
   * ⚠️ The ONE checker in this folder whose "on" costs an upstream call. Off is
   *    always safe: every OA then reads the stored column exactly as it did
   *    before 03/09. ปิดแล้วกลับไปอ่านของเก่า ไม่พังอะไร.
   */
  readonly siteRulesFreshness: boolean;
}

/**
 * Defaults — all ON.
 *
 * ⚠️ `emptyValue` off means LINE receives an empty `text`, which fails
 *    validation and the WHOLE card is rejected. Turn it off only in a test.
 */
export const CHECKS: CheckSwitches = {
  emptyValue: true,
  imageShape: true,
  profileMatch: true,
  siteRulesFreshness: true,
};
