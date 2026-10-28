/**
 * [FEAT-20260822-NOTICERUNTIME] The member-config keys the notice mode owns.
 * ===========================================================================
 * Nothing else, no logic, no imports — same shape as `follow-up/follow-up.keys.ts`
 * and deliberately NOT imported from there: notice and follow-up are separate
 * features that must stay removable one at a time. แยกไว้ถอดทีละ feature ได้จริง.
 *
 * Each key must also be declared in `chat/config`'s registry (which validates
 * it) with its CONSUMERS entry, its FLAG/RECORD verdict and its partial index —
 * this file is only the name. Registering happens in the R3 step, BEFORE the
 * first write ships.
 *
 * ── TIME NOTE (owner-mandated, 2026-08-22): READ THIS BEFORE CONSUMING ──────
 * Every value under these keys is stored as a UTC Date instant (`new Date()`),
 * exactly like every other follow_up stamp — the registry's type assertion
 * refuses anything else. Consumers: convert to Asia/Bangkok (UTC+7, fixed
 * offset, no DST) for DISPLAY ONLY. Queries, comparisons and cooldown math
 * stay in UTC. The spec's "+7time" describes the wall clock the admin sees,
 * never the stored value.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 [DOC-20260825-REGSTATUS] WHAT THESE THREE MEAN, AND THE TWO THINGS THEY
 *    CANNOT BE MADE TO MEAN
 * ═══════════════════════════════════════════════════════════════════════════
 * All three are ROLLING RECORDS: the writer overwrites on every card sent, so
 * the value answers "WHEN did we LAST tell this member", never "how many times"
 * and never "is it still true".
 *
 * ① NOT A REGISTRATION STATUS. Obvious here, easy to lose in a query builder:
 *    these say the BANK had a problem, not that the CUSTOMER has one. Nothing
 *    in the `follow_up` bag answers "has this customer registered?" — that is
 *    `members.raw_profile_data`, present and non-empty. Full rule, and the
 *    hole an admin's profile wipe leaves even in THAT check:
 *    `src/modules/chat/config/member-config.registry.ts`, same tag.
 * ② NOT "IS STILL AFFECTED". A stamp is the moment a card went out. The bank
 *    may have reopened five minutes later; nothing re-reads the site rules to
 *    take the stamp back. An audience built on one of these selects "was ever
 *    notified about X", exactly like the other RECORDS in the bag.
 *    ⚠️ TWO OF THE THREE DO HAVE A CLEARER SINCE 24/08 —
 *    `notice_deposit_at` and `notice_withdraw_at` are removed for every member
 *    a MULTICAST actually reached
 *    (`content/broadcast-follow-up/clear-notice-on-multicast.ts`), because a
 *    campaign announcing the bank works again ends the reason for the stamp.
 *    That does NOT promote them to FLAGS: the clearing is triggered by an
 *    outgoing campaign, never by the customer doing anything, so "no stamp"
 *    still means "either never notified, or notified and since told otherwise".
 *    `notice_payment_at` is deliberately left out of that clear — the campaign
 *    speaks about deposits and withdrawals, not payments.
 *    ล้างเฉพาะเรื่องที่แคมเปญพูดถึงจริง · ล้างได้ ≠ เป็นธง.
 *
 * ⚠️ THE FORCE-NO-PROFILE POLICY DOES NOT COVER THESE, AND MUST NOT.
 * `content/audience/sources/force-no-profile.policy.ts` silently ANDs "and has
 * no profile" onto campaigns built on the register-chasing keys. These three
 * are not in its list and adding them would be a bug: a linked customer is
 * exactly who a "the bank is working again" campaign is FOR.
 *
 * 📖 Plain-language overview of all six follow-up stamps, the four screens they
 * appear on, and the live counts: `docs/follow-up-status-spec.md`.
 *
 * revert: delete with the rest of `notice-runtime/`.
 */

/** Last time this member was sent a DEPOSIT notice card (case A or B). */
export const NOTICE_DEPOSIT_AT_KEY = 'follow_up.line.notice_deposit_at';

/** Last time this member was sent a WITHDRAW notice card (case C or D). */
export const NOTICE_WITHDRAW_AT_KEY = 'follow_up.line.notice_withdraw_at';

/** Last time this member was sent an ALL/payment notice card (case E or F). */
export const NOTICE_PAYMENT_AT_KEY = 'follow_up.line.notice_payment_at';
