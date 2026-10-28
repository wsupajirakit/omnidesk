/**
 * [FEAT-20260903-BCASTSRFRESH] Are this OA's site rules fresh enough to send,
 * and if they are not, what happens?
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock — the stamp and `now` are
 * handed in. The FETCHING lives in `broadcast-run/refresh-oa-site-rules.ts`;
 * this file only ever answers questions. ตัวนี้ตัดสิน ไม่ยิงเอง.
 *
 * 🔴 THIS OVERRIDES A WRITTEN RULE, AND IT SAYS SO ON PURPOSE.
 *
 * `read/raw-blob.reader.ts:6-7,24-25` carries the owner's instruction of
 * 22/08/2026 — *"profile และ site rule เอาจาก db นะ ห้ามดึงสด"* and *"NOTHING HERE
 * FETCHES … a background job must never call a customer's API"*. On 03/09/2026
 * the owner changed it for site rules on the send path: *"รอบการส่งเราเอา site rule
 * สดไหม มันควรเป็นแบบนั้นนะ"*, then *"ถ้าไม่มี เปลี่ยนเป็นยิงสด … และกรณีที่แคชเก่ากว่า 10 นาที
 * ก็ดึงสด"*.
 *
 * The old rule is left standing where it is written, because it is still true
 * for PROFILE and still true for everything outside this one decision. A reader
 * who finds the two must be able to see which one moved and when, instead of
 * finding a rule quietly deleted. กฎเก่าถูกทับ ไม่ใช่ถูกลบเงียบ ๆ.
 *
 * 🔑 WHY THIS IS AFFORDABLE, measured rather than hoped:
 *   · the question is asked ONCE PER OA PER RUN, never per recipient — a job
 *     touches at most `maxHooks` (20) channels
 *   · the tool's own cache is 30 s (`site-rules-cache.policy.ts:74`), far under
 *     the 10-minute threshold here, so asking almost always yields a live value
 *     and NOBODY jumps the queue — the same road a customer's message walks
 *
 * revert: set `CHECKS.siteRulesFreshness` to `false` — every OA then answers
 * `'use-stored'` and the send path reads the cached column exactly as it did
 * before. Delete this file and its caller to remove it fully.
 */
import { CHECKS } from './checks.config';
import { collectTags } from './needs-per-recipient';

/**
 * How old a stored blob may be before a run refetches it.
 *
 * Owner-set 03/09/2026: *"กรณีที่แคชเก่ากว่า 10 นาทีก็ดึงสด"*. It is a POLICY number,
 * not a measured one — it answers "how stale may a customer's card be", which
 * is a product question. The measured number nearby is the tool cache's 30 s,
 * and the two are deliberately different: that one bounds upstream load, this
 * one bounds what a customer sees.
 */
export const SITE_RULES_MAX_AGE_MS = 10 * 60 * 1000;

/** The tag family this whole decision is about. */
export const SITE_RULES_PREFIX = 'site_rules.';

/**
 * Does this card actually read any site rule?
 *
 * ⚠️ Reuses `collectTags` rather than scanning again — one tag scanner in this
 *    folder, so a card shape it cannot read is unreadable for every check at
 *    once instead of for some of them. ใช้ตัวสแกนเดิม ไม่เขียนตัวที่สอง.
 */
export function usesSiteRules(cardJson: unknown): boolean {
  return collectTags(cardJson).some((t) => t.startsWith(SITE_RULES_PREFIX));
}

/**
 * What the run should do about one OA's stored site rules BEFORE it renders.
 *
 * `'fetch'`      ⇒ ask upstream once, then use whatever comes back.
 * `'use-stored'` ⇒ the blob is present and recent enough; make no call.
 */
export type FreshnessAction = 'fetch' | 'use-stored';

export interface FreshnessInput {
  /** `hooks.raw_site_rules_data`. Absent/empty ⇒ there is nothing to send with. */
  readonly stored: unknown;
  /** `hooks.site_rules_updated_at`. `null` ⇒ never fetched, or never stamped. */
  readonly fetchedAt: Date | null;
  readonly now: Date;
}

/**
 * Nothing stored at all — the state most real rows are in.
 *
 * Verified against `local_db_10_aug_26` on 03/09: four of the first five hooks
 * hold no `raw_site_rules_data` whatsoever, and the fifth was stamped
 * 2026-08-05. So "missing" is the COMMON case here and "stale" is real; neither
 * is an edge worth treating as unlikely. เคสปกติ ไม่ใช่เคสหายาก.
 */
export function hasSiteRules(stored: unknown): boolean {
  if (stored === null || stored === undefined) return false;
  if (typeof stored !== 'object') return false;
  return Object.keys(stored).length > 0;
}

/**
 * The decision. Never throws; an unreadable stamp counts as "we do not know how
 * old this is", which is treated as stale — asking once is cheap, and shipping
 * a card built on data of unknown age is the thing being prevented.
 */
export function decideFreshness(input: FreshnessInput): FreshnessAction {
  if (!CHECKS.siteRulesFreshness) return 'use-stored';
  if (!hasSiteRules(input.stored)) return 'fetch';

  const at = input.fetchedAt;
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return 'fetch';
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    /* A clock we cannot read is not a reason to spend an upstream call on every
       OA of every run — the stored blob is still the best thing we have. */
    return 'use-stored';
  }

  const ageMs = input.now.getTime() - at.getTime();
  /* A stamp in the FUTURE (clock skew between our writer and this reader) is
     not stale. Treating a negative age as "older than 10 minutes" would refetch
     every run forever, which is the loudest possible way to get this wrong. */
  if (ageMs < 0) return 'use-stored';
  return ageMs > SITE_RULES_MAX_AGE_MS ? 'fetch' : 'use-stored';
}

/**
 * After the fetch has been attempted: may this OA send?
 *
 * The owner's rule, in order (03/09): try once → if it worked, use it → if it
 * did not but something is stored, send with the old one (*"เก่าก็เอา"*, the
 * standing rule `raw-blob.reader.ts:78-80` records) → only when there is
 * NOTHING and the card actually reads a site rule, skip that OA and say why.
 *
 * 🔴 THE CARD IS INSPECTED SO AN OA IS NEVER SKIPPED OVER DATA IT DOES NOT USE.
 *    A campaign of plain text through an OA that has never fetched site rules
 *    must still go out. ห้ามข้าม OA เพราะข้อมูลที่การ์ดไม่ได้อ่าน.
 */
export type SendVerdict =
  | { readonly kind: 'send' }
  | { readonly kind: 'skip'; readonly reason: string };

export function verdictAfterRefresh(
  storedAfterFetch: unknown,
  cardJson: unknown,
): SendVerdict {
  if (hasSiteRules(storedAfterFetch)) return { kind: 'send' };
  if (!usesSiteRules(cardJson)) return { kind: 'send' };
  return {
    kind: 'skip',
    reason:
      'site rules unavailable for this OA and the card fills ' +
      '{{site_rules.*}} — sending would show N/A to every recipient',
  };
}
