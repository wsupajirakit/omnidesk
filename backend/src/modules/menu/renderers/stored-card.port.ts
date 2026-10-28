/**
 * [FEAT-20260829-MENUSTORED] WHERE a stored menu card is read from.
 *
 * The renderer must not know Mongoose, a model name, or a collection — that is
 * DO-NOT #1 and #3 of the module contract (`src/modules/menu/index.ts`). It asks
 * this port a question and is handed rows; the S3 patch supplies the real reader.
 *
 * Shape mirrors what `flex_messages` actually holds — verified against the live
 * row on 29/08/2026, not assumed:
 *   flex_type "menu" · flex_sub_type "main" · flex_slug "1234"
 *   group_ids [22 hook-group ids] · content_json { type: "bubble", … }
 * Every field is optional and `unknown`-typed because a legacy row may carry
 * none of them, and a renderer that assumes a field exists sends nothing while
 * looking correct.
 *
 * revert: delete src/modules/menu/ whole.
 */

/** One `flex_messages` row, only the parts a menu card needs. */
export interface StoredMenuCard {
  /**
   * ⚠️ [FIX-20260831-MENUCARDVARS] The row is handed to the resolver WHOLE, not
   * just its `content_json`: `buildFlexVarMaps` reads `source_roles` /
   * `source_role` off the doc to decide WHICH variable sources to build. Passing
   * only the bubble means the roles resolve to the default one, and a card's
   * `{{site_rules.*}}` then reach the customer raw. Seen live 31/08.
   * These two are therefore part of the contract, not incidental fields.
   */
  readonly source_roles?: unknown;
  readonly source_role?: unknown;
  readonly flex_type?: string | null;
  readonly flex_sub_type?: string | null;
  readonly flex_slug?: string | null;
  readonly content_json?: unknown;
  readonly group_ids?: unknown[];
  readonly deleted_at?: unknown;
  readonly name?: string | null;
}

/**
 * The query the renderer is allowed to ask. Deliberately narrow: a caller
 * cannot ask for "any card" — type is pinned by the scenario's `card.flexType`,
 * so a menu can never send somebody else's slip.
 *
 * ⚠️ [FEAT-20260831-OPENFLEXTAG] ONE exception, and it is addressed by TAG.
 * `menu:v1:open:flex:<tag>` opens a card of any type on purpose (owner 31/08:
 * a menu button should reach `flex_m…`/`flex_pc…` too), so that door leaves
 * `flexType` undefined. What replaces the type pin there is not nothing:
 *   · the tag must match the minted shape — the door cannot take free text
 *   · a minted tag names exactly ONE row in the collection
 *   · the group check still refuses a card this OA does not own
 * Every other caller still passes a type, so nothing else widens.
 */
export interface StoredMenuCardQuery {
  /** Omitted ONLY by the flex-tag door above; every scenario pins it. */
  readonly flexType?: string;
  readonly subType?: string;
  /** Optional operator label from the scenario; ignored when absent. */
  readonly slug?: string;
  /**
   * [FEAT-20260831-MENUMAINTAG] the minted `flex_tag`. The MOST specific key
   * there is: it identifies one row on its own, so an implementation that has
   * it may ignore the others. Absent ⇒ the query behaves exactly as before.
   */
  readonly tag?: string;
}

export interface StoredMenuCardSource {
  /** MUST NOT throw — a customer line. Return `null` when nothing matches. */
  find(query: StoredMenuCardQuery): Promise<StoredMenuCard | null>;
}
