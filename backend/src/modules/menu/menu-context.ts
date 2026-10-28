/**
 * [FEAT-20260828-MENUTAG-S1/S2] the read-only situation bundle (plan §3d).
 *
 * Built once per tap/postback; renderers and results are pure functions of
 * (definition, context), so the whole flow is testable without booting Nest.
 *
 * 🔴 THE MENU READS NO STRIKE DATA — AND MUST NOT.
 * The webhook's own suspend gate runs FAR ABOVE any menu seat
 * (`webhook.service.ts:1321-1329`: `isSuspended` → log → `return`). A silenced
 * customer's event never reaches the menu window (`:1823`..`:3742`) at all, so
 * a second read here would duplicate a decision that has already been made and
 * would need the strike module changed to serve it. `silence` therefore stays
 * a plain INPUT: whoever builds the context states it, and the engine honours
 * it. Nothing in `src/modules/strike/` is touched by this feature.
 *
 * ONE LATCH, NOT TWO FLAGS. An earlier draft carried `{ suspended, blocked }`,
 * which implied two independent states. The real schema has ONE
 * (`suspended_at` on the open session) with `suspended_by` as ATTRIBUTION —
 * verified against live rows 28/08: 9 sessions, 5 silenced, 4 of those by an
 * admin, and no separate block field exists anywhere
 * (`member-strike-session.schema.ts`, whose own comment says "No enum, no
 * second flag, nothing derived"). Two booleans would have forced every
 * consumer to answer "what if blocked && !silenced?" — a state the data cannot
 * produce.
 *
 * ── IF THE OWNER EVER WANTS A BLOCKED CUSTOMER TO STILL USE POSTBACK ──
 * (owner, 28/08: "ถ้าโดนบล็อกอาจจะยอมให้ postback ได้ อนาคต ต้องแก้ไขได้ แต่เรา
 * บล็อกตอนนี้"). Recorded as a NOTE only — nothing here implements it, and the
 * decision is not ours to take.
 *
 * TODAY a blocked customer reaches NEITHER door, and that is correct: the
 * webhook's own suspend gate returns long before the menu
 * (`webhook.service.ts:1321-1329`). Opening the postback door alone would need
 * TWO layers changed, in this order, and only the first belongs to us:
 *
 *   LAYER 1 — ours, `src/modules/menu/`: split the single silence check in
 *     `menu-engine.service.ts` into a per-door policy beside `MENU_TRIGGERS`
 *     (e.g. `{ allowTapWhenSilenced: false, allowPostbackWhenSilenced: true }`).
 *     Small, additive, no other module involved.
 *
 *   LAYER 2 — SOMEONE ELSE'S CODE, and the one that actually decides:
 *     the gate at `webhook.service.ts:1321-1329` (`strikeGate?.isSuspended` →
 *     log → `return`) would have to let a postback event fall through instead
 *     of returning. That file is sacred (source-text asserted by 22 specs) and
 *     the gate is carried by `docs/strike-suspend-plug-in.patch`, whose spec
 *     re-applies and hash-compares it on every suite run — so the change would
 *     have to be made INSIDE that patch, by whoever owns the strike/suspend
 *     feature, with the owner's approval. Not by this module, and not silently.
 *
 * ⚠️ Layer 1 alone changes NOTHING observable: the event still never arrives.
 * Anyone implementing this must do layer 2 first or the work is invisible.
 *
 * revert: delete src/modules/menu/ whole.
 */

/** Who armed the latch. Attribution only — never a second state. */
export type MenuSilenceSource = 'admin' | 'ceiling' | null;

export interface MenuSilenceState {
  /** The single question the menu asks: may we answer this customer at all? */
  readonly silenced: boolean;
  readonly by: MenuSilenceSource;
  readonly since?: Date;
}

export interface MenuContext {
  readonly hook: Record<string, unknown>;
  readonly lineUserId: string;
  readonly member: {
    readonly id: string;
    readonly rawProfile: unknown;
    readonly linked: boolean;
  } | null;
  /** The raw site-rules data block (pickByRole output) — `null` when absent.
      Typed `unknown` because the shape belongs to noticeSiteRuleCheck, which
      the menu borrows rather than re-declares (plan §3e). */
  readonly siteRules: unknown;
  readonly silence: MenuSilenceState;
}

/** Never silenced — the shape a caller uses when the read is unavailable. */
export const NOT_SILENCED: MenuSilenceState = { silenced: false, by: null };

/**
 * [FEAT-20260828-MENUTAG-S2] Assemble the context.
 *
 * A pure assembler: it stores what the caller states and reads nothing. The
 * silence value comes from whoever wires the menu in — today the webhook has
 * already enforced it upstream (see the header), so a caller that passes
 * `NOT_SILENCED` is stating a fact, not skipping a check.
 */
export function buildMenuContext(input: {
  readonly hook: Record<string, unknown>;
  readonly lineUserId: string;
  readonly member: MenuContext['member'];
  readonly siteRules: unknown;
  /** Omitted ⇒ NOT_SILENCED — the upstream gate already returned on silence. */
  readonly silence?: MenuSilenceState;
}): MenuContext {
  return {
    hook: input.hook,
    lineUserId: input.lineUserId,
    member: input.member,
    siteRules: input.siteRules,
    silence: input.silence ?? NOT_SILENCED,
  };
}
