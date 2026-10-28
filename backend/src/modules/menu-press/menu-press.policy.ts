/**
 * ==== [FEAT-20260902-MENUPRESSONCE] the knob, and the key ====
 *
 * Everything an operator or a future session might want to change about this
 * feature is in ONE object. Nothing else in the feature contains a number.
 *
 * 🔴 CODE-LEVEL, NOT ENV — owner's standing preference, the same shape
 * `UserRateLadderService` uses: a default constant, injectable through a symbol
 * only so a spec can hand in a variant. Production binds nothing and gets the
 * default.
 *
 * revert: set `enabled: false`. Every press is allowed, nothing is written, and
 * the feature is inert without removing a line of code.
 */

/** What a refused press does. Only `silent` is implemented — see below. */
export type MenuPressRefusal = 'silent';

export interface MenuPressPolicy {
  /**
   * 🔴 THE SWITCH. `false` ⇒ the guard answers "allowed" before it touches
   * anything, so no claim is written, no stamp is consulted and the webhook path
   * behaves exactly as it did before this feature existed.
   */
  readonly enabled: boolean;
  /**
   * How many presses each (card × button × person) is worth.
   *
   * ⚠️ It is a NUMBER on purpose. The owner asked that "กดกี่ครั้งก็ได้ ก็แค่สับสวิตช์"
   * be true, and on 02/09 he exercised it: the shipping value moved from 1 to 3
   * with no other edit anywhere in the feature. That is the proof the mechanism
   * never spelled "once" into itself — the store returns a COUNT, not a boolean,
   * and this line is the only place the comparison happens.
   */
  readonly max: number;
  /**
   * How long the rule holds. Owner 02/09: **6 hours**, adjustable.
   *
   * What it really means: after this window the card becomes pressable again —
   * one fresh press per button, silently. That is the accepted trade, not an
   * oversight. A flex card lives in the chat history for ever and LINE cannot
   * delete or disable it, so NO ttl is long enough to be "correct"; industry
   * practice for the same problem ranges from 24 h (Stripe) to 7-14 days
   * (Adyen), and no source anywhere addresses a button with unlimited lifetime.
   * In practice a customer presses a menu within minutes, so 6 hours is a wide
   * margin over the real behaviour.
   *
   * Changing it is safe and needs no migration — see `expires_at` in the schema.
   */
  readonly ttlSeconds: number;
  /**
   * Owner 02/09: **silent**. A refused press produces one log line, zero LINE
   * calls and zero writes, and the payload is still reported as handled so it
   * can never fall through to the text pipeline and be answered by something
   * else.
   *
   * ⚠️ The type exists so that changing this later is a VALUE, not a redesign —
   * but only `silent` is built. A branch nobody can reach would be dead code;
   * the option in the type is not.
   */
  readonly onRefused: MenuPressRefusal;
}

export const MENU_PRESS_POLICY_TOKEN = Symbol('MENU_PRESS_POLICY');

/** 6 hours. */
const SIX_HOURS_IN_SECONDS = 6 * 60 * 60;

export const DEFAULT_MENU_PRESS_POLICY: MenuPressPolicy = {
  enabled: true,
  /* Owner 02/09: three presses per button per rendered card. */
  max: 3,
  ttlSeconds: SIX_HOURS_IN_SECONDS,
  onRefused: 'silent',
};

/**
 * The ONE spelling of a claim's identity. Built here rather than at the call
 * site so the four parts can never be assembled in a different order by a second
 * caller — a key that differs by ordering is a budget that silently resets.
 *
 * `:` is safe as the joiner: a render id is hex, a hook id and a LINE user id are
 * both `[0-9a-zA-Z]`, and the item is a minted tag or slug whose charset has no
 * colon. So no part can contain the joiner and no two different tuples can
 * produce the same string.
 */
export function pressClaimId(parts: {
  render: string;
  item: string;
  lineUserId: string;
  hookId: string;
}): string {
  return `${parts.render}:${parts.item}:${parts.lineUserId}:${parts.hookId}`;
}
