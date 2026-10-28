/**
 * ==== [FEAT-20260829-MENUSTORED] the `render: 'stored'` renderer ====
 *
 * Draws a menu from a card an operator built in the FE (`flex_type: "menu"`)
 * instead of from code. This is the pipe the owner asked for on 29/08 — a
 * scenario switches by ONE field (`render: 'stored'` + `card: {...}`) and
 * switches back by deleting it. Nothing else moves either way.
 *
 * ── WHY IT FALLS BACK INSTEAD OF FAILING ────────────────────────────────────
 * This is a customer reply line. Every rejection below hands the work to the
 * fixed renderer, so the customer always receives a menu — a misconfigured card
 * degrades the LOOK, never the SERVICE. Modelled on the proven
 * `resolveCustomerHelperFlex` (webhook/hook-reply/customer-helper-flex.ts:117),
 * which solved this same problem for the helper card; the rules are copied
 * deliberately so the two behave alike rather than each inventing a policy.
 *
 * ── THE FIVE LAYERS, AND WHY EACH ONE EXISTS ────────────────────────────────
 *   1. a row came back            — nothing matched the scenario's card ref
 *   2. not soft-deleted           — a deleted card must stop being sent
 *   3. `flex_type` really is ours — another type carries a different variable
 *      set, so its `{{...}}` would reach the customer raw
 *   4. `content_json` non-empty   — LINE rejects an empty bubble outright
 *   5. the hook's group owns it   — ⚠️ PERM: the card's `group_ids` must contain
 *      `hook.group`, so a card belonging to another OA cannot be sent even if
 *      its id is written into the DB by hand or by an FE mistake
 *
 * ── WHY THE BUTTONS ARE REBUILT, NOT TRUSTED ────────────────────────────────
 * An operator drawing a card in the FE cannot hand-type a working
 * `menu:v1:` payload, and must not have to. So postback buttons are MINTED here
 * from the definition's items via the one codec, in card order — the stored card
 * supplies the LOOK, the definition supplies the BEHAVIOUR. A button beyond the
 * item count keeps its own action rather than being deleted, so a card that
 * mixes menu buttons with a plain link still works.
 *
 * ⚠️ `uri` buttons are repaired, never left broken: LINE rejects the WHOLE
 * message when a `uri` action is not http(s), so one unfinished button would
 * silently cost the customer the entire card. A non-http(s) `uri` is turned into
 * its postback equivalent when an item is available, and dropped otherwise.
 * (Owner, 29/08: "uri คุมด้วย คนไม่ต้องกังวล".)
 *
 * revert: delete this file + its map entry; scenarios asking for 'stored' fall
 *         back to the fixed renderer automatically (engine renderWith, §3f).
 */
import {
  buildMenuPostback,
  parseMenuOpenPostback,
} from '../menu-postback.util';
import { stampCardButtons } from './press-stamp';
// [FEAT-20260902-ADMINPOSTBACK] read-only: used to recognise a payload this
// renderer must leave alone. `common/` is a leaf, so no cycle is possible.
import { payLinkFromPostback } from '@/common/utils/paylink-tag';
import type { MenuContext } from '../menu-context';
import type { MenuDefinition, MenuItem } from '../scenarios/scenario.types';
import type {
  MenuAsyncRenderer,
  MenuRenderer,
  RenderedMenuMessage,
} from './renderer.port';
import type { StoredMenuCard, StoredMenuCardSource } from './stored-card.port';

/** Why a stored card was refused — logged, never shown to a customer. */
export type StoredCardRefusal =
  | 'no-card-ref'
  | 'not-found'
  | 'deleted'
  | 'wrong-type'
  | 'empty-content'
  | 'other-group'
  | 'read-failed';

export interface StoredCardRendererDeps {
  readonly source: StoredMenuCardSource;
  /** Used whenever a stored card cannot be used. Always present on purpose. */
  readonly fallback: MenuRenderer;
  /** Fire-and-forget; a logging failure must never cost a reply. */
  readonly warn?: (reason: StoredCardRefusal, detail: string) => void;
  /**
   * [FIX-20260831-STOREDCARDVARS] Resolve the CARD's own `{{...}}` before its
   * buttons are minted. Optional: omitted ⇒ the card is drawn exactly as stored,
   * which is what this renderer did before the fix.
   *
   * 🔴 WHY IT WAS ADDED — a real, silent failure found 31/08. A stored card's
   * `content_json` was the one shape on the menu path that NEVER went through a
   * variable pass: `open()` resolves the definition's title and labels, and
   * `sendResult` resolves a code-defined result, but a card opened by slug or by
   * tag went straight to `mintButtons` with its tags raw. A card whose button
   * read `uri: "{{hook_domain}}/dashboard"` therefore hit the `uri` repair rule
   * below — not http(s), no item to bind — and the button was DROPPED. The
   * customer got the card with no button on it and nothing was logged, because
   * from the renderer's point of view a broken link had been handled correctly.
   *
   * ⚠️ [FIX-20260831-MENUCARDVARS] IT TAKES THE WHOLE ROW, NOT THE BUBBLE.
   * The central builder reads `source_roles` off the doc to decide which
   * variable sources to build; handed only `content_json` it falls back to the
   * default source, and `{{site_rules.*}}` reach the customer raw — which is
   * exactly what happened on the first attempt. The seat implements this with
   * the SAME two central calls the notice guard's `loadCard` uses; nothing about
   * variables is decided in this module.
   *
   * ⚠️ ORDER IS THE WHOLE DESIGN: resolve FIRST, mint SECOND. §3e forbids any
   * substitution pass from walking a minted `menu:v1:` payload, and doing it in
   * this order means no pass ever sees one. It also means the repair rule below
   * now judges the FINAL uri — a variable that resolves to nothing is still a
   * broken link and is still dropped, which is the behaviour that keeps LINE
   * from rejecting the whole message.
   *
   * ⚠️ May be async: the seat is allowed to fetch what a card actually needs
   * (and only then — see the seat for why a card with no `{{` costs nothing).
   */
  readonly resolveCard?: (
    card: StoredMenuCard,
    context: MenuContext,
  ) => unknown | Promise<unknown>;
  /**
   * [FEAT-20260831-MENUSLIPQR] A quick reply to ride along with THIS card, or
   * `undefined` for the vast majority that have none.
   *
   * 🔴 WHY THE SEAM EXISTS AT ALL: `cameraRoll` — the image picker — is a
   * quick-reply action. LINE refuses an entire flex message that carries one as
   * a BUTTON (`{0} action is not available for flex message`, answered by its
   * own validate endpoint on 31/08), so a card that wants a picker must put it
   * on the message instead. This module supplies the seam and nothing else:
   * WHICH card gets WHICH picker is slip knowledge and lives at the seat, which
   * is also the only side allowed to know about slips (contract DO-NOT #1).
   *
   * ⚠️ Asked with the CARD ROW, so the answer follows the card an operator
   *    edits — never a definition title, which a scenario can rename.
   * ⚠️ A throw costs the picker, never the card.
   */
  readonly quickReplyFor?: (
    card: StoredMenuCard,
    context: MenuContext,
  ) => unknown | undefined;
  /**
   * [FEAT-20260902-MENUPRESSONCE] A render id for THIS send, or `undefined` to
   * leave the card unstamped.
   *
   * 🔴 OPTIONAL, AND THAT IS THE REVERT. Omit it — as every path does until the
   * seat wires it — and the rendered bytes are identical to before this feature
   * existed. No flag to read and no branch to skip: an absent dep is an absent
   * feature.
   *
   * 🔴 THE SEAT DECIDES WHICH CARDS, NOT THIS MODULE. It is handed the whole
   * card row precisely so it can answer `undefined` for anything that is not a
   * menu card. Scope (`flex_type === 'menu'`) is policy and lives with the
   * policy; this module owns the mechanism only.
   *
   * ⚠️ A throw costs the stamp, never the card — same rule as the picker above.
   */
  readonly renderStamp?: (card: StoredMenuCard) => string | undefined;
}

export class StoredCardRenderer implements MenuAsyncRenderer {
  public constructor(private readonly deps: StoredCardRendererDeps) {}

  public async render(
    definition: MenuDefinition,
    context: MenuContext,
  ): Promise<RenderedMenuMessage> {
    const ref = definition.card;
    if (!ref) return this.refuse('no-card-ref', definition, context);

    let card: StoredMenuCard | null = null;
    try {
      card = await this.deps.source.find({
        flexType: ref.flexType,
        subType: ref.subType,
        slug: ref.slug,
        // [FEAT-20260831-MENUMAINTAG] forwarded like the other two; undefined on
        // every path that does not use it, so nothing existing changes.
        tag: ref.tag,
      });
    } catch (err) {
      /* A DB hiccup must not cost the customer the menu — fixed card instead. */
      return this.refuse(
        'read-failed',
        definition,
        context,
        (err as Error)?.message ?? 'unknown',
      );
    }

    const refusal = this.check(card, ref.flexType, context);
    if (refusal) return this.refuse(refusal, definition, context);

    /* [FIX-20260831-STOREDCARDVARS] the card's own variables, then its buttons.
       The WHOLE ROW goes in (see the dep's note); what comes back is the drawn
       bubble. A resolver that throws or answers with a non-object leaves the
       stored document untouched — a variable must never cost the customer the
       card. */
    let doc = card!.content_json as Record<string, unknown>;
    if (this.deps.resolveCard) {
      try {
        const resolved = await this.deps.resolveCard(card!, context);
        if (resolved && typeof resolved === 'object')
          doc = resolved as Record<string, unknown>;
      } catch {
        /* keep the stored document */
      }
    }

    let contents = mintButtons(doc, definition);
    /* [FEAT-20260902-MENUPRESSONCE] AFTER minting, so the stamp lands on FINAL
       payloads, and after variable resolution, so no substitution pass ever sees
       a minted payload (two specs assert exactly that). Unwired ⇒ untouched. */
    try {
      const render = this.deps.renderStamp?.(card!);
      if (render) contents = stampCardButtons(contents, render);
    } catch {
      /* a missing stamp costs the press budget, never the card */
    }
    /* [FEAT-20260831-MENUSLIPQR] absent unless the seat names one, so a card
       with no picker is byte-identical to before the seam existed. */
    let quickReply: unknown;
    try {
      quickReply = this.deps.quickReplyFor?.(card!, context);
    } catch {
      /* the picker is a convenience; the card is the message */
    }

    return {
      type: 'flex',
      /* The CARD's own name wins when it has one: a slug-opened menu has no
         scenario to borrow a title from, so `definition.title` there is only
         the slug. Falls back to the definition, then to a non-empty literal —
         alt-text is what the customer sees in the chat list and in a
         notification, and blank is never an acceptable value there. */
      altText:
        (typeof card!.name === 'string' && card!.name.trim()) ||
        definition.title.trim() ||
        'menu',
      contents,
      ...(quickReply ? { quickReply } : {}),
    };
  }

  /** The five layers, in the order that gives the most useful log line. */
  private check(
    card: StoredMenuCard | null,
    wantType: string | undefined,
    context: MenuContext,
  ): StoredCardRefusal | null {
    if (!card) return 'not-found';
    if (card.deleted_at) return 'deleted';
    /* [FEAT-20260831-OPENFLEXTAG] no wanted type ⇒ the caller addressed the card
       by MINTED TAG and asked for it whatever type it is. The layer is skipped,
       not weakened: every caller that names a type is still held to it, and the
       group check below is untouched on both paths. */
    if (wantType && card.flex_type !== wantType) return 'wrong-type';
    if (!card.content_json) return 'empty-content';
    if (!sameGroup(context.hook?.['group'], card.group_ids))
      return 'other-group';
    return null;
  }

  private refuse(
    reason: StoredCardRefusal,
    definition: MenuDefinition,
    context: MenuContext,
    detail = '',
  ): RenderedMenuMessage {
    try {
      this.deps.warn?.(
        reason,
        `${definition.key}${detail ? ` ${detail}` : ''}`,
      );
    } catch {
      /* observability must never break a reply */
    }
    return this.deps.fallback.render(definition, context);
  }
}

/**
 * A hook belongs to ONE group; a card may be shared across many. They must
 * overlap. Compared as strings because one side is an ObjectId and the other a
 * string — `===` on the raw values is always false and would silently refuse
 * every card. Copied from customer-helper-flex.ts:183 rather than re-derived.
 */
function sameGroup(
  hookGroup: unknown,
  cardGroups: unknown[] | undefined,
): boolean {
  const g = asText(hookGroup);
  if (!g) return false;
  return (cardGroups ?? []).some((x) => asText(x) === g);
}

/**
 * An id arrives as an ObjectId, a string, or nothing at all. Only those have a
 * meaningful text form — anything else answers '' and therefore never matches,
 * which is the safe direction for a permission check.
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return String(value);
  if (
    value &&
    typeof (value as { toHexString?: unknown }).toHexString === 'function'
  )
    return (value as { toHexString: () => string }).toHexString();
  return '';
}

/**
 * Walk the stored bubble and give every button a real action.
 *
 * The card is DEEP-COPIED first: `content_json` is a shared document and a
 * renderer that mutated it would poison the next reply with the previous
 * customer's payloads.
 *
 * Buttons are matched to items BY ORDER — the operator's first button is the
 * definition's first item. Order is the only mapping an operator can control
 * from a visual editor without typing ids.
 */
export function mintButtons(
  contentJson: Record<string, unknown>,
  definition: MenuDefinition,
): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(contentJson)) as Record<
    string,
    unknown
  >;
  const items = definition.items;
  let cursor = 0;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk).filter((n) => n !== DROP);
    if (!node || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const action = obj['action'] as Record<string, unknown> | undefined;

    if (action && typeof action === 'object') {
      /* `asText` rather than String(): an action shape is `unknown`, and a
         plain String() on an object yields "[object Object]", which would never
         match a branch here and would silently leave the button as drawn. */
      const kind = asText(action['type']);
      /* Only these two are ours to rewrite. A `message`/`camera`/etc. action is
         the operator's deliberate choice and is left exactly as drawn. */
      /* ⚠️ A slug-link the OPERATOR wrote is left exactly as drawn.
         The owner's model: the card names its own destination, so main `a`
         points at `sub-a` today and `sub-x` tomorrow by editing ONE button in
         the FE — no deploy, no scenario file. Minting over it would silently
         re-point every such button at a code-defined item and make the FE
         edit a lie. It does not consume an item either, so the remaining
         buttons still bind in order. */
      if (parseMenuOpenPostback(action['data'])) {
        return obj;
      }

      /* [FEAT-20260902-ADMINPOSTBACK] a minted paylink payload is not ours either.
         ═══════════════════════════════════════════════════════════════════════
         The contact buttons used to be `type:"message"`, and the branch below
         only ever claimed `postback`/`uri` — so they were protected by their very
         action type and this guard was unnecessary. Now they mint INTO a postback
         (`resolveCard` runs before `mintButtons`, see the call order above), which
         moves them out of the protected class and into the rewritten one. Without
         this line the payload would be overwritten with `buildMenuPostback(...)`
         the moment a card definition carried any items, and the admin button would
         silently open a menu page instead.
         ⚠️ Today every stored-card definition passes `items: []`, so `items[cursor]`
            is undefined and the rewrite happens not to fire. That is luck, not a
            design — nothing pins it, and it would break the day one card gains an
            item. Claiming the prefix is the actual guarantee.
         SCOPE: keyed off the payload prefix, exactly like the menu slug-link above,
         so a new paylink tag inherits the protection with no change here. */
      if (payLinkFromPostback(action['data'])) {
        return obj;
      }

      if (kind === 'postback' || kind === 'uri') {
        const item: MenuItem | undefined = items[cursor];
        if (item) {
          cursor += 1;
          obj['action'] = {
            type: 'postback',
            /* The stored label wins only when it really is text — an object
               left in the card would otherwise reach the customer as the
               literal "[object Object]". The item's own label is the fallback. */
            label:
              typeof action['label'] === 'string' && action['label'].trim()
                ? action['label']
                : item.label,
            data: buildMenuPostback(definition.key, item.id),
          };
        } else if (kind === 'uri' && !isHttp(action['uri'])) {
          /* No item left to bind, and the link is one LINE would reject —
             dropping the button saves the message; keeping it loses the card. */
          return DROP;
        }
      }
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k === 'action') continue;
      obj[k] = walk(v);
    }
    return obj;
  };

  return walk(doc) as Record<string, unknown>;
}

/** Sentinel for "remove this node from its array". */
const DROP = Symbol('DROP') as unknown;

function isHttp(uri: unknown): boolean {
  return typeof uri === 'string' && /^https?:\/\//i.test(uri);
}
