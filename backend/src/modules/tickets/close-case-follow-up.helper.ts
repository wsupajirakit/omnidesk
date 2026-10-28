/* Relative, not `@/modules/webhook/...`: a deep alias into another feature
   module is a layering error the linter rejects, and `webhook`'s barrel does not
   export these two constants. Same path shape `customer-link/` uses to reach
   shared internals it may not import through an alias. */
import {
  ABANDON_TRIGGER_KEY,
  REQUEST_REG_KEY,
} from '../webhook/follow-up/follow-up.keys';

/**
 * [FEAT-20260826-CLOSECLEARFU] "Stop chasing this customer" — decided here.
 * ===========================================================================
 * Owner, 26/08/2026: when an admin closes a case and the member carries BOTH
 * registration follow-up stamps, the confirm dialog offers two boxes. Ticking
 * *"ไม่ต้องติดตามการสมัครลูกค้านี้อีก"* clears both stamps, so the customer drops
 * out of the follow-up flow and starts fresh the next time they get the card.
 *
 * 🔴 THIS OVERRIDES A STANDING RULE. READ BEFORE CHANGING ANYTHING HERE.
 * `request_reg_at` is documented in five places as a RECORD that nothing ever
 * removes ("ห้ามเคลียร์ห้ามยุ่ง คงค่าเดิม"). The owner was shown that note, and the
 * consequence below, and confirmed the change on 26/08/2026.
 *
 *   CONSEQUENCE, stated plainly: `insight-registrations.service.ts` splits its
 *   card on exactly this key — a member WITH it counts as "สมัครโดย Bot ช่วย
 *   Admin", without it as "สมัครโดยแอดมิน". Every tick moves that member from
 *   one bucket to the other, and it cannot be undone, because no other column
 *   records that the customer was ever asked.
 *
 * WHY THE DECISION IS A PURE FUNCTION AND NOT AN `if` AT THE CALL SITE: the
 * `$unset` is trivial; deciding WHEN to fire one is where this can go wrong, and
 * three of the four ways it can go wrong are invisible to a type checker (a
 * ghost key, a half-stamped member, a null stamp). A function returns a plan a
 * test can read. ส่วนที่พลาดง่ายคือ "เมื่อไหร่" ไม่ใช่ "ลบยังไง"
 *
 * revert: delete this file, its spec, the `clear_follow_up` field on
 * `UpdateTicketDto`, and the block that calls this in `tickets.service.ts`.
 */

/**
 * The two stamps a tick clears, in the order the audit row reports them.
 *
 * Exported so the caller and the audit entry name the same keys — two
 * hand-written lists drift the first time one of them is edited. Both are
 * declared in `MEMBER_CONFIG_KEYS`, so `clearMemberConfig` accepts them and a
 * typo here throws rather than clearing nothing.
 */
export const CLOSE_CASE_CLEARED_KEYS = [
  ABANDON_TRIGGER_KEY,
  REQUEST_REG_KEY,
] as const;

export interface FollowUpClearInput {
  /** Did THIS write take the ticket to closed? A re-save of a closed case is not a close. */
  becameClosed: boolean;
  /**
   * `dto.clear_follow_up`, passed through untouched.
   *
   * ⚠️ Compare by VALUE, never with `in` or truthiness of the key's presence.
   * `main.ts` runs the validation pipe with `transform: true`, which
   * materialises every declared DTO property as `undefined` even when the
   * client never sent it — `[FIX-20260824-CASGHOST]` records that exact trap
   * breaking case hand-over on stg. `undefined` here means "not asked for".
   */
  requested: boolean | undefined;
  /** The member document as it stood BEFORE the close. `null` is a valid answer. */
  member: unknown;
}

export interface FollowUpClearPlan {
  shouldClear: boolean;
  /** Empty unless `shouldClear`. Never partially filled. */
  keys: string[];
}

/** A stamp counts as present only when it holds a real value — null is absent. */
function hasStamp(line: Record<string, unknown> | null, leaf: string): boolean {
  const v = line?.[leaf];
  return v !== undefined && v !== null && v !== '';
}

/** `config.follow_up.line`, or null when any step of the path is missing. */
function followUpLine(member: unknown): Record<string, unknown> | null {
  const config = (member as { config?: unknown } | null)?.config;
  const followUp = (config as { follow_up?: unknown } | undefined)?.follow_up;
  const line = (followUp as { line?: unknown } | undefined)?.line;
  return line && typeof line === 'object'
    ? (line as Record<string, unknown>)
    : null;
}

/**
 * Decide whether this close should clear the follow-up stamps.
 *
 * All four conditions must hold, and each one is a real failure mode:
 *   becameClosed  — the same endpoint accepts, assigns and renames. Only a close
 *                   shows the dialog, so only a close may clear.
 *   requested     — an explicit `true`. See the ghost-key note above.
 *   both stamps   — the dialog only appears when the member carries BOTH, so a
 *                   request naming a half-stamped member came from a stale tab
 *                   or a hand-made call. Clearing half the pair would leave a
 *                   state the UI can never produce and nobody can explain.
 */
export function buildFollowUpClear(
  input: FollowUpClearInput,
): FollowUpClearPlan {
  const none: FollowUpClearPlan = { shouldClear: false, keys: [] };

  if (!input.becameClosed) return none;
  if (input.requested !== true) return none;

  const line = followUpLine(input.member);
  const leafOf = (key: string): string => key.slice(key.lastIndexOf('.') + 1);

  const carriesBoth = CLOSE_CASE_CLEARED_KEYS.every((key) =>
    hasStamp(line, leafOf(key)),
  );
  if (!carriesBoth) return none;

  return { shouldClear: true, keys: [...CLOSE_CASE_CLEARED_KEYS] };
}
