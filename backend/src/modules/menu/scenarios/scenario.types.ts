/**
 * ==== [FEAT-20260828-MENUTAG-S1] scenario shapes — pure data, no IO ====
 *
 * PLAN §3a. A scenario file exports ONE MenuDefinition and imports no service.
 * `MenuResult` is a UNION on purpose (owner: every scenario answers in ANY
 * shape — text, flex, image — or chains into another menu). A future kind
 * (video, carousel) = one union member + one renderer branch; existing
 * scenarios never notice.
 *
 * Var placeholders ({{profile.x}} {{hook.x}} {{site_rule.x}} {{guideline.x}})
 * are allowed in every string field; they resolve at S6 through the one
 * injected adapter — no shape gets its own substitution dialect.
 *
 * ── ADDING A NEW ANSWER SHAPE ──────────────────────────────────────────────
 * One new member of the `MenuResult` union + one branch where the engine turns
 * a result into a message. Existing scenarios never notice. DO NOT smuggle a
 * new shape inside an existing member (a `text` that is secretly JSON), and DO
 * NOT give a shape its own substitution rule — every shape routes to the one
 * central function that owns it.
 *
 * revert: delete src/modules/menu/ whole.
 */
import type { MenuLevel } from '../menu-tag.util';

export type MenuResult =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'flex';
      readonly flex: Record<string, unknown>;
      readonly altText: string;
    }
  | {
      readonly kind: 'image';
      readonly imageUrl: string;
      readonly previewUrl?: string;
    }
  | { readonly kind: 'menu'; readonly open: string };

export type MenuItemAction =
  | { readonly type: 'open'; readonly target: string }
  | { readonly type: 'result'; readonly result: MenuResult };

export interface MenuItem {
  /** Postback item id — charset `ITEM_ID_CHARSET`, unique within its menu. */
  readonly id: string;
  readonly label: string;
  readonly action: MenuItemAction;
}

export interface MenuDefinition {
  /** The one scenario-key spelling (plan §3a): `primary`, `primary-a`, … */
  readonly key: string;
  readonly level: MenuLevel;
  readonly variant: string | null;
  /**
   * Per-scenario switch (owner: "ใช้ไม่ใช้ก็ได้ ปิดเปิดบางตัวได้").
   * false ⇒ the engine treats the scenario as absent (unknown-variant policy).
   * One-field edit to flip; neighbours never affected.
   */
  readonly enabled: boolean;
  readonly title: string;
  readonly items: readonly MenuItem[];
  /**
   * WHICH renderer draws this scenario. Omitted ⇒ `'fixed'`.
   *
   * `'fixed'`  — today's code-built bubble (FixedFlexRenderer).
   * `'stored'` — a card fetched from the flex-message collection at run time.
   *              Nothing implements it yet; the value exists so the switch is a
   *              ONE-FIELD edit in one scenario file when the renderer lands,
   *              and a one-field edit back if it has to be reverted.
   *
   * An unknown value falls back to the fixed renderer rather than throwing — a
   * typo must never take a customer's menu down.
   */
  readonly render?: MenuRenderKind;
  /**
   * WHERE a `'stored'` card comes from. Ignored by the fixed renderer.
   *
   * These are the query keys, named now so the future source and renderer agree
   * on them instead of each inventing their own: the flex-message TYPE and its
   * SUB-TYPE. The hook scope is NOT here on purpose — it comes from
   * `MenuContext.hook` at run time, so one scenario file serves every OA and
   * cannot hard-code somebody else's card.
   */
  readonly card?: MenuCardRef;
}

/** Renderer kinds. Add one here + one entry in the engine's renderer map. */
export type MenuRenderKind = 'fixed' | 'stored';

export interface MenuCardRef {
  /**
   * flex-message `type` to look up.
   *
   * ⚠️ [FEAT-20260831-OPENFLEXTAG] optional, for the one door that opens a card
   * by MINTED TAG regardless of type. See `StoredMenuCardQuery` for what stands
   * in for the type pin there. Every scenario still states it.
   */
  readonly flexType?: string;
  /**
   * [FEAT-20260831-MENUMAINTAG] flex-message `flex_tag` — the MINTED reference,
   * which names one card and only that card.
   *
   * Why it exists next to `slug`: a slug is operator-typed free text, nullable
   * and renameable, so it can only be trusted when a scenario file states it.
   * A tag is allocated by the server, unique by construction and stable for the
   * card's life, which is what lets an operator paste `[[[menu_main_00001]]]`
   * into a prompt and have it still mean this card next month.
   * When present it is the MOST specific key — see the port for the order.
   */
  readonly tag?: string;
  /** flex-message `sub_type`, when the type alone is not specific enough. */
  readonly subType?: string;
  /**
   * flex-message `flex_slug` — the operator-facing name that picks ONE card.
   *
   * ⚠️ Needed because type + sub-type cannot identify a scenario: every
   * `primary*` scenario shares `sub_type: "main"`, so a lookup without a slug
   * returns whichever card the collection happens to answer first. Proven on
   * 29/08/2026 — all 7 primary scenarios silently rendered the same card, and
   * no test could see it because a fixture source answers with one row.
   *
   * Omitted ⇒ type + sub-type decide, which is correct when a level really does
   * have exactly one card.
   */
  readonly slug?: string;
}
