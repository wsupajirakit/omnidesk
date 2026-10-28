/**
 * ==== [FEAT-20260828-MENUTAG-S1] the engine — pure orchestration ====
 *
 * PLAN §3c/§3d/§3f. No Nest decorators here on purpose: S1 is unwired by
 * design (the S3 patch constructs and injects it). Every side effect is an
 * injected dep, so the whole flow is testable without booting anything.
 *
 * Decisions encoded (each pinned by menu-engine.spec.ts):
 *   · not our text / not our payload  → handled:false, caller falls through
 *     byte-identical (zero-impact C1.2/C1.3)
 *   · suspended or blocked            → handled:true + SILENT (the
 *     strike-suspend stance: a blocked customer must not learn the menu talks)
 *   · unknown / disabled scenario     → unknownVariantPolicy dep decides;
 *     S1 default is 'silent' — plan Q4 is still the owner's call, so the
 *     policy is INJECTED, not hard-coded
 *   · source chain: first non-null wins, code registry LAST; a front source
 *     answering {enabled:false} disables the scenario for that lookup
 *   · send failure THROWS through (§3c: reaching the line after the send is
 *     the proof of delivery — the caller's wlog success row depends on it)
 *
 * ── WHAT THIS CLASS DOES, AND WHAT IT MUST NEVER DO ────────────────────────
 * DOES: read the two doors, decide whether the input is ours, resolve a
 * definition through the source chain, ask the renderer for a message, ask the
 * injected sender to send it, and report what happened.
 *
 * MUST NEVER:
 *   · talk to LINE, Mongo, Redis or the network directly — `coreSend` is the
 *     only exit and it arrives as a dep. A second sender would bypass pushcore
 *     and everything built on it.
 *   · write a `webhook_logs` row or a chat message itself. `log` is
 *     fire-and-forget observability; the REAL rows go through the existing
 *     doors at the S3 call site (`persistWebhookLog`, `chatHistory.logMessage`).
 *     A writer here would be caught by webhook-log-door-census.spec.ts, which
 *     is someone else's fence and must stay green.
 *   · swallow a send failure. Reaching the line after `coreSend` is the proof
 *     of delivery the caller's success row rests on, so the throw goes through.
 *   · answer `handled:true` for anything that is not ours. `false` is what lets
 *     the webhook fall through byte-identically, and it is the entire
 *     zero-impact contract in one boolean.
 *   · parse or build a postback string. The codec is the only minter.
 *   · substitute a variable. `vars` decides which central function applies;
 *     the substitution itself is always central code.
 *
 * revert: delete src/modules/menu/ whole.
 */
import {
  parseMenuTag,
  parseScenarioKey,
  scenarioKey,
  type MenuLevel,
} from './menu-tag.util';
import {
  parseMenuPostback,
  parseMenuOpenPostback,
  parseMenuOpenFlexPostback,
} from './menu-postback.util';
import type { MenuContext } from './menu-context';
import type { MenuDefinitionSource } from './sources/definition-source.port';
import type {
  MenuAsyncRenderer,
  MenuRenderer,
  MenuRendererMap,
  RenderedMenuMessage,
} from './renderers/renderer.port';
import {
  MENU_TRIGGERS,
  type MenuEngine,
  type MenuHandleOutcome,
  type MenuPostbackInput,
  type MenuTapInput,
  type MenuTriggerConfig,
} from './menu-engine.port';
import type { MenuDefinition, MenuResult } from './scenarios/scenario.types';
import type { MenuVarContext, MenuVars } from './vars/menu-vars.port';

export interface MenuEngineDeps {
  /** Ordered — code registry LAST (plan §3f). */
  readonly sources: readonly MenuDefinitionSource[];
  /**
   * [FEAT-20260829-MENUSLUGLINK] The `flex_type` a slug-link resolves against.
   *
   * INJECTED rather than hard-coded because the value is owned by the content
   * module (`FLEX_TYPE_MENU`), and importing it here would break DO-NOT #1 of
   * the module contract — the isolation that keeps `rm -rf src/modules/menu` a
   * complete revert. Omitted ⇒ `'menu'`, which is what that module ships today;
   * the day it changes, the call site passes the new value and no menu code
   * moves.
   */
  readonly cardFlexType?: string;
  /** The default renderer — used when a definition names no kind, or an unknown one. */
  readonly renderer: MenuRenderer;
  /**
   * [FEAT-20260829-RENDERKIND] Optional renderer map keyed by
   * `MenuDefinition.render`. Omitted ⇒ every scenario draws with `renderer`,
   * which is exactly the behaviour before this field existed.
   *
   * This is the pipe for cards that will come from the flex-message collection
   * instead of from code: register a `'stored'` renderer here and the scenarios
   * that ask for it switch over. Switching one scenario back is a one-field edit
   * in that scenario file — nothing else moves, and the map can be dropped
   * entirely to return to today.
   */
  readonly renderers?: MenuRendererMap;
  /** The pushcore reply seam, injected by the S3 patch (plan §3c). THROWS on failure. */
  readonly coreSend: (
    replyToken: string,
    messages: RenderedMenuMessage[],
  ) => Promise<unknown>;
  /** Q4 pending — injected so flipping the answer is a dep change, not an edit. */
  readonly unknownVariantPolicy?: (
    key: string,
    context: MenuContext,
  ) => 'silent';
  /**
   * Which doors are open. Omitted ⇒ `MENU_TRIGGERS` (both). Injected rather
   * than read statically so a spec can prove each door independently without
   * touching the shipped constant.
   */
  readonly triggers?: MenuTriggerConfig;
  /**
   * [S6] Variable resolution, ALL of it central code injected at the call site
   * (plan §3e tier 1). OMITTED ⇒ every string is sent exactly as the scenario
   * wrote it — which is this module's behaviour before S6, so wiring vars in is
   * additive and wiring them out is a one-line revert.
   */
  readonly vars?: MenuVars;
  /** Fire-and-forget observability; failures must never fail a send (§3g). */
  readonly log?: (event: {
    kind: 'tap' | 'postback' | 'send' | 'refused';
    scenarioKey?: string;
    detail?: string;
  }) => void;
}

/**
 * MenuContext → the two values every central var function needs. Written once
 * so no call site invents its own idea of "the profile" (single truth, §3e).
 */
/**
 * [FEAT-20260829-MENUSLUGLINK] Identity of a slug-opened card in logs.
 * It is deliberately NOT a real scenario key: nothing resolves it, and
 * `parseScenarioKey` rejects it, so it can never be mistaken for one.
 */
const SLUG_LINK_KEY = 'slug-link';

/** What `content` ships today; overridable via `deps.cardFlexType`. */
const DEFAULT_CARD_FLEX_TYPE = 'menu';

/**
 * The ONE mapping from a menu context to a variable context. Exported because
 * `menu-composition.ts` needs the very same mapping to hand the stored renderer
 * its resolver — a second copy there would be a second spelling of this, and the
 * two would drift (module contract DO-NOT #5).
 */
export function varContext(context: MenuContext): MenuVarContext {
  return { hook: context.hook, rawProfile: context.member?.rawProfile ?? null };
}

export class MenuEngineService implements MenuEngine {
  private readonly triggers: MenuTriggerConfig;

  public constructor(private readonly deps: MenuEngineDeps) {
    this.triggers = deps.triggers ?? MENU_TRIGGERS;
  }

  public async handleTap(input: MenuTapInput): Promise<MenuHandleOutcome> {
    /* door closed ⇒ indistinguishable from "not ours" (see MenuTriggerConfig) */
    if (!this.triggers.tag) return { handled: false };
    const tag = parseMenuTag(input.text);
    if (!tag) return { handled: false };
    this.safeLog({
      kind: 'tap',
      scenarioKey: scenarioKey(tag.level, tag.variant),
    });
    return this.open(tag.level, tag.variant, input.replyToken, input.context);
  }

  public async handlePostback(
    input: MenuPostbackInput,
  ): Promise<MenuHandleOutcome> {
    if (!this.triggers.postback) return { handled: false };

    /* [FEAT-20260829-MENUSLUGLINK] The slug-link form is tried FIRST because it
       is the more specific shape; `parseMenuPostback` answers null for it, so
       the two never compete. This is the door for a card that names its own
       destination — main `a` opens `sub-a` or `sub-x` purely by what the
       operator typed in the FE, with no scenario and no deploy. A button that
       should go nowhere simply carries no such payload (a plain `uri`), which
       is why there is no target field to leave empty. */
    /* [FEAT-20260831-OPENFLEXTAG] The flex-tag form is tried before the slug
       form because it is the more specific shape. The order is defensive rather
       than load-bearing: `parseMenuOpenPostback` answers null for a flex payload
       anyway (a slug may not contain a colon), and a case pins that so a future
       charset change cannot make the two compete silently. */
    const flexLink = parseMenuOpenFlexPostback(input.data);
    if (flexLink) return await this.openByFlexTag(flexLink.tag, input);

    const link = parseMenuOpenPostback(input.data);
    if (link) return await this.openBySlug(link.slug, input);

    const pb = parseMenuPostback(input.data);
    if (!pb) return { handled: false };
    this.safeLog({ kind: 'postback', scenarioKey: pb.scenarioKey });
    const parsed = parseScenarioKey(pb.scenarioKey);
    if (!parsed) return this.refuse(pb.scenarioKey, input.context);
    const def = await this.resolve(parsed.level, parsed.variant, input.context);
    if (!def || !def.enabled) return this.refuse(pb.scenarioKey, input.context);
    if (this.silenced(input.context))
      return { handled: true, action: 'silent' };
    const item = def.items.find((i) => i.id === pb.itemId);
    if (!item) return this.refuse(pb.scenarioKey, input.context);
    if (item.action.type === 'open') {
      const target = parseScenarioKey(item.action.target);
      if (!target) return this.refuse(item.action.target, input.context);
      return this.open(
        target.level,
        target.variant,
        input.replyToken,
        input.context,
      );
    }
    return this.sendResult(
      def.key,
      item.action.result,
      input.replyToken,
      input.context,
    );
  }

  /**
   * [FEAT-20260829-MENUSLUGLINK] Open a stored card BY SLUG — no scenario.
   *
   * The definition handed to the renderer is a minimal envelope, not a scenario:
   * the card supplies the whole look, and its buttons are already addressed
   * (the operator wrote them), so there is nothing for a code-side item list to
   * contribute. `items: []` is therefore the honest value, not a placeholder —
   * it means "this card's buttons are the card's own", which is exactly what
   * `mintButtons` now respects.
   *
   * ⚠️ It routes through the SAME renderer map as every other menu, so a
   * slug-linked card inherits the five refusal layers unchanged — above all the
   * cross-OA check. A card from another OA is refused here for the same reason
   * and by the same code as anywhere else; this door adds no new way in.
   */
  private async openBySlug(
    slug: string,
    input: MenuPostbackInput,
  ): Promise<MenuHandleOutcome> {
    this.safeLog({ kind: 'postback', detail: slug });
    if (this.silenced(input.context))
      return { handled: true, action: 'silent' };
    const definition: MenuDefinition = {
      key: SLUG_LINK_KEY,
      /* Inert on this path: nothing reads `level` for a stored card (the
         renderer never touches it, and no resolve happens), but the type
         requires one. 'primary' is a placeholder, NOT a claim about the card. */
      level: 'primary',
      variant: null,
      enabled: true,
      /* alt-text, which LINE shows in the chat list and in notifications. The
         slug is the only identifier this path has — no scenario, no card read
         yet — and an EMPTY string is not acceptable: a blank alt-text is what
         the customer sees where a preview should be, and `reply-via-core.ts`
         documents the same concern for its own senders. The stored renderer
         overwrites this with the card's real name when the card resolves; this
         value only survives on the fallback path. */
      title: slug,
      items: [],
      render: 'stored',
      card: {
        flexType: this.deps.cardFlexType ?? DEFAULT_CARD_FLEX_TYPE,
        slug,
      },
    };
    const message = await this.renderWith(definition, input.context);
    await this.deps.coreSend(input.replyToken, [message]);
    this.safeLog({ kind: 'send', detail: slug });
    return { handled: true, action: 'sent' };
  }

  /**
   * [FEAT-20260831-OPENFLEXTAG] Open ANY flex card by its minted tag.
   * ==========================================================================
   * The third door, and the widest — `menu:v1:open:flex:flex_m00023` opens the
   * card an AI prompt would summon with `[[[flex_m00023]]]`. Owner 31/08: a menu
   * button should reach the other card families too, not only menu cards.
   *
   * ⚠️ HOW IT DIFFERS FROM `openByCardTag`, WHICH IS THE POINT: that door pins
   * `flexType` to the menu type, so it can only ever draw a menu card. This one
   * leaves the type UNSET, so the tag alone decides. A minted tag names exactly
   * one row, so "unset" is not "any card" — it is "that card, whatever type it
   * turned out to be".
   * ⚠️ WHAT STILL REFUSES IT: the group check in the stored renderer (layer 5) is
   * untouched, so a card belonging to another OA is refused here exactly as
   * everywhere else. A deleted card is refused by layer 2 and, since 31/08, is
   * not even returned by the query. Silence still wins over everything.
   * ⚠️ The card's own buttons are left as drawn: the definition carries `items:
   * []`, so `mintButtons` has nothing to bind and rewrites nothing.
   *
   * revert: delete this method and the `parseMenuOpenFlexPostback` branch in
   *         `handlePostback` — the payload then parses as NOT OURS again.
   */
  private async openByFlexTag(
    tag: string,
    input: MenuPostbackInput,
  ): Promise<MenuHandleOutcome> {
    this.safeLog({ kind: 'postback', detail: tag });
    if (this.silenced(input.context))
      return { handled: true, action: 'silent' };
    const definition: MenuDefinition = {
      key: SLUG_LINK_KEY,
      /* Inert, exactly as `openBySlug` states: nothing reads `level` for a
         stored card. 'primary' is a placeholder, not a claim about the card. */
      level: 'primary',
      variant: null,
      enabled: true,
      /* The tag is the only identifier this door has before the card resolves;
         the stored renderer replaces it with the card's real name. */
      title: tag,
      items: [],
      render: 'stored',
      /* No `flexType` ON PURPOSE — see StoredMenuCardQuery for what stands in
         for the type pin on this one door. */
      card: { tag },
    };
    const message = await this.renderWith(definition, input.context);
    await this.deps.coreSend(input.replyToken, [message]);
    this.safeLog({ kind: 'send', detail: tag });
    return { handled: true, action: 'sent' };
  }

  /**
   * [FEAT-20260831-MENUMAINTAG] Open the stored card carrying this minted tag.
   * ==========================================================================
   * The twin of `openBySlug` and deliberately built the same way: an inert
   * definition handed to the SAME stored renderer, so the card is subject to the
   * same rules — the hook's group must own it (`stored-card.renderer.ts:137`),
   * the card's own name becomes the alt-text, a refusal is logged rather than
   * sent, and the operator's buttons are left exactly as drawn.
   *
   * ⚠️ A DIFFERENT KEY FROM A SLUG, ON PURPOSE. A slug is operator-typed, free
   * text and nullable; a tag is minted, unique by construction and stable for
   * the card's life. That is why a marker pasted into an AI prompt names the
   * tag: renaming the card must not break the answer.
   * ⚠️ NOT a scenario. Nothing resolves, no source chain runs — like the slug
   * door, this is a card and only a card.
   */
  public async openByCardTag(
    tag: string,
    input: MenuPostbackInput,
  ): Promise<MenuHandleOutcome> {
    this.safeLog({ kind: 'tap', detail: tag });
    const message = await this.renderCardByTag(tag, input.context);
    if (!message) return { handled: true, action: 'silent' };
    await this.deps.coreSend(input.replyToken, [message]);
    this.safeLog({ kind: 'send', detail: tag });
    return { handled: true, action: 'sent' };
  }

  /**
   * [FEAT-20260831-MENUMAINTAG] Render the card carrying this minted tag —
   * WITHOUT sending it.
   * ==========================================================================
   * Two callers want the same card for different reasons, so the render and the
   * send are separated rather than copied:
   *   · `openByCardTag` above sends it, like every other menu door
   *   · the AI reply path sends it through ITS ladder, so the answer keeps the
   *     history row, the reply/push fallback and the logging that path already
   *     performs. Handing it a rendered message means the CARD is chosen here —
   *     with the group check and the button preservation the stored renderer
   *     enforces — and only the delivery belongs to the caller.
   *
   * ⚠️ A different key from a slug, on purpose: a slug is operator-typed, free
   * text and nullable; a tag is minted, unique and stable for the card's life,
   * which is what lets a marker pasted into a prompt still mean this card later.
   * ⚠️ NOT a scenario. Nothing resolves and no source chain runs — a card, and
   * only a card.
   * ⚠️ Silence wins: a silenced room renders nothing at all.
   */
  public async renderCardByTag(
    tag: string,
    context: MenuContext,
  ): Promise<RenderedMenuMessage | null> {
    if (this.silenced(context)) return null;
    const definition: MenuDefinition = {
      key: SLUG_LINK_KEY,
      /* Inert, exactly as `openBySlug` states: nothing reads `level` on a stored
         card. 'primary' is a placeholder, not a claim about the card. */
      level: 'primary',
      variant: null,
      enabled: true,
      /* The tag is the only identifier this path has before the card resolves,
         and an empty alt-text is what a customer sees where a preview belongs.
         The stored renderer replaces it with the card's real name. */
      title: tag,
      items: [],
      render: 'stored',
      card: {
        flexType: this.deps.cardFlexType ?? DEFAULT_CARD_FLEX_TYPE,
        tag,
      },
    };
    return await this.renderWith(definition, context);
  }

  /** Resolve + render + send one menu. */
  private async open(
    level: MenuLevel,
    variant: string | null,
    replyToken: string,
    context: MenuContext,
  ): Promise<MenuHandleOutcome> {
    if (this.silenced(context)) return { handled: true, action: 'silent' };
    const def = await this.resolve(level, variant, context);
    if (!def || !def.enabled)
      return this.refuse(scenarioKey(level, variant), context);
    /* Title and labels resolve BEFORE the renderer builds the bubble, so no
       substitution pass ever walks the `menu:v1:` payloads it mints (§3e). */
    const shown = this.deps.vars
      ? this.deps.vars.resolveDefinition(def, varContext(context))
      : def;
    const message = await this.renderWith(shown, context);
    await this.deps.coreSend(replyToken, [message]); // throws through (§3c)
    this.safeLog({ kind: 'send', scenarioKey: def.key });
    return { handled: true, action: 'sent', scenarioKey: def.key };
  }

  private async sendResult(
    key: string,
    result: MenuResult,
    replyToken: string,
    context: MenuContext,
  ): Promise<MenuHandleOutcome> {
    if (result.kind === 'menu') {
      const target = parseScenarioKey(result.open);
      if (!target) return this.refuse(result.open, context);
      return this.open(target.level, target.variant, replyToken, context);
    }
    const vars = this.deps.vars;
    const vctx = varContext(context);
    /* Each shape goes to the central function that owns it — the flex branch to
       the FULL renderFlexDoc, never a partial applier (the helper-card trap). */
    const text = (s: string): string => (vars ? vars.resolveText(s, vctx) : s);
    const message: RenderedMenuMessage =
      result.kind === 'text'
        ? { type: 'text', text: text(result.text) }
        : result.kind === 'flex'
          ? {
              type: 'flex',
              altText: text(result.altText),
              contents: vars
                ? vars.resolveFlex(result.flex, vctx)
                : result.flex,
            }
          : {
              type: 'image',
              originalContentUrl: text(result.imageUrl),
              previewImageUrl: text(result.previewUrl ?? result.imageUrl),
            };
    await this.deps.coreSend(replyToken, [message]);
    this.safeLog({ kind: 'send', scenarioKey: key });
    return { handled: true, action: 'sent', scenarioKey: key };
  }

  /**
   * Pick the renderer a definition asked for, and fall back to the default.
   *
   * ⚠️ An unknown kind falls back rather than throwing: a typo in one scenario
   * file must never take a customer's menu down, and it stays visible because
   * the card that arrives is the fixed one rather than the stored one.
   * ⚠️ `await` on purpose — a stored card is a DB read, and a synchronous
   * renderer passes through untouched.
   */
  private async renderWith(
    definition: MenuDefinition,
    context: MenuContext,
  ): Promise<RenderedMenuMessage> {
    const kind = definition.render ?? 'fixed';
    const picked: MenuRenderer | MenuAsyncRenderer | undefined =
      this.deps.renderers?.[kind];
    return await (picked ?? this.deps.renderer).render(definition, context);
  }

  private async resolve(
    level: MenuLevel,
    variant: string | null,
    context: MenuContext,
  ): Promise<MenuDefinition | null> {
    for (const source of this.deps.sources) {
      const def = await source.get(level, variant, context);
      if (def) return def;
    }
    return null;
  }

  private silenced(context: MenuContext): boolean {
    /* one latch — see menu-context.ts for why this is not two flags */
    return context.silence.silenced;
  }

  private refuse(key: string, context: MenuContext): MenuHandleOutcome {
    const policy = this.deps.unknownVariantPolicy?.(key, context) ?? 'silent';
    this.safeLog({ kind: 'refused', scenarioKey: key, detail: policy });
    return { handled: true, action: 'silent' };
  }

  private safeLog(
    event: Parameters<NonNullable<MenuEngineDeps['log']>>[0],
  ): void {
    try {
      this.deps.log?.(event);
    } catch {
      /* a log failure must never fail the flow (§3g) */
    }
  }
}
