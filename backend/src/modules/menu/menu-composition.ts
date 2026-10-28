/**
 * ==== [FEAT-20260829-MENUCOMP] how a working engine is assembled — one place ====
 *
 * PLAN §3c/§3f. The S3 patch supplies only what it ALONE can know: the send
 * seam, the card reader, the var adapter — closures built from symbols already
 * in scope at the webhook call site. Everything else (which sources, in which
 * order; which renderers, under which keys) is this module's own knowledge and
 * belongs here rather than in a patch.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Before it, the engine was only ever constructed inside SPEC files. That meant
 * the shipped wiring existed nowhere, and a scenario that asked for
 * `render: 'stored'` would have drawn the FIXED card in production while every
 * test stayed green — because `renderWith` falls back silently when no renderer
 * map is supplied (menu-engine.service.ts, `renderWith`). Silent fallback is the
 * correct behaviour for a typo; it is the WRONG behaviour for "nobody wired the
 * map", and only a single shipped assembler can tell those two apart.
 *
 * Keeping it here also shrinks the S3 patch to its irreducible core: the patch
 * passes values, never composition rules. A patch that carries wiring knowledge
 * has to be re-reviewed whenever the wiring changes; this one does not.
 *
 * ── DO NOT ─────────────────────────────────────────────────────────────────
 *   · DO NOT import a Nest decorator, a model, or another feature module here.
 *     This is a plain factory; the module contract's DO-NOT #1/#3 still apply
 *     and menu-isolation-census.spec.ts still pins them.
 *   · DO NOT read config or env here. What is optional arrives as an argument,
 *     so a caller can always see what it turned on.
 *   · DO NOT let this file decide POLICY (which scenarios exist, whether a door
 *     is open). It decides ASSEMBLY only.
 *
 * revert: delete this file. Nothing else imports it until S3 lands.
 */
import { MenuEngineService, type MenuEngineDeps } from './menu-engine.service';
import { CodeRegistrySource } from './sources/code-registry.source';
import {
  CardDefinitionSource,
  type MenuSlugResolver,
} from './sources/card-source';
import type { MenuDefinitionSource } from './sources/definition-source.port';
import { FixedFlexRenderer } from './renderers/fixed-flex.renderer';
import { StoredCardRenderer } from './renderers/stored-card.renderer';
import type {
  MenuRendererMap,
  RenderedMenuMessage,
} from './renderers/renderer.port';
import type {
  StoredMenuCard,
  StoredMenuCardSource,
} from './renderers/stored-card.port';
import type { MenuTriggerConfig } from './menu-engine.port';
import type { MenuVars } from './vars/menu-vars.port';
import type { MenuContext } from './menu-context';
import type { StoredCardRefusal } from './renderers/stored-card.renderer';

/**
 * What the CALL SITE must supply — and nothing more. Each field is something
 * only the webhook can build; none of it is a composition decision.
 */
export interface MenuWiring {
  /** The pushcore reply seam. THROWS on failure (plan §3c). */
  readonly coreSend: (
    replyToken: string,
    messages: RenderedMenuMessage[],
  ) => Promise<unknown>;
  /**
   * Reads one stored card. OMITTED ⇒ no `'stored'` renderer is registered, so a
   * scenario asking for one falls back to the fixed card — see `strict` below
   * for how that stops being silent.
   */
  readonly cards?: StoredMenuCardSource;
  /** Central variable resolution (S6). Omitted ⇒ strings send as written. */
  readonly vars?: MenuVars;
  /**
   * [FIX-20260831-MENUCARDVARS] Resolve a STORED card's `{{...}}`. Separate from
   * `vars` on purpose: the central builder decides which variable sources apply
   * by reading `source_roles` off the card ROW, so this takes the row and not
   * the bubble `MenuVars.resolveFlex` expects. Omitted ⇒ a stored card is drawn
   * exactly as stored, which is the behaviour that existed before.
   *
   * The implementation belongs to the SEAT — this module neither knows nor
   * decides anything about variables (contract DO-NOT #1).
   */
  readonly resolveCard?: (
    card: StoredMenuCard,
    context: MenuContext,
  ) => unknown | Promise<unknown>;
  /**
   * [FEAT-20260831-MENUSLIPQR] The quick reply a stored card ships with, decided
   * by the SEAT from a lookup table it owns. See the renderer's dep for why a
   * picker cannot live inside the card.
   */
  readonly quickReplyFor?: (
    card: StoredMenuCard,
    context: MenuContext,
  ) => unknown | undefined;
  /**
   * [FEAT-20260902-MENUPRESSONCE] Forwarded verbatim to the stored renderer —
   * see its own note for what it does and why it is optional. Passed through
   * rather than interpreted: the composition layer decides nothing, so the SEAT
   * stays the only place that knows which cards carry a press budget.
   */
  readonly renderStamp?: (card: StoredMenuCard) => string | undefined;
  /** Sources that answer BEFORE the code registry. The registry stays last. */
  readonly frontSources?: readonly MenuDefinitionSource[];
  /**
   * [FEAT-20260829-MENUDYNSCEN] Serve a scenario from a stored CARD instead of
   * a code file. Supply the rule that says which card serves which scenario;
   * omit it and nothing changes — every menu keeps coming from code.
   *
   * Placed automatically in FRONT of the code registry and BEHIND any explicit
   * `frontSources`, so a caller can still override it. Needs `cards`; without a
   * reader there is nothing to read and the source is skipped rather than
   * registered dead.
   */
  readonly slugFor?: MenuSlugResolver;
  /** Which doors are open. Omitted ⇒ the shipped `MENU_TRIGGERS` default. */
  readonly triggers?: MenuTriggerConfig;
  /** Fire-and-forget observability. */
  readonly log?: MenuEngineDeps['log'];
  /** Warned when a stored card is refused; carries the reason. */
  readonly onCardRefused?: (reason: StoredCardRefusal, detail: string) => void;
}

/**
 * Build the renderer map.
 *
 * `'stored'` is registered ONLY when a card reader was supplied — registering
 * it with no reader would turn every stored scenario into a guaranteed refusal
 * that still looks configured.
 */
export function buildRendererMap(wiring: MenuWiring): MenuRendererMap {
  const fixed = new FixedFlexRenderer();
  if (!wiring.cards) return { fixed };
  return {
    fixed,
    stored: new StoredCardRenderer({
      source: wiring.cards,
      fallback: fixed,
      warn: wiring.onCardRefused,
      /* [FIX-20260831-MENUCARDVARS] present only when the caller supplied a card
         resolver, so a caller that supplies none keeps the previous behaviour
         exactly: the card is drawn as stored.

         ⚠️ NOT built from `wiring.vars`. `MenuVars.resolveFlex` takes a BUBBLE,
         and the central variable builder needs the ROW (it reads `source_roles`
         off the doc). Handing it the bubble is what left `{{site_rules.*}}` raw
         on the first attempt. The seat therefore supplies this one directly,
         using the same two central calls the notice guard already uses. */
      ...(wiring.resolveCard ? { resolveCard: wiring.resolveCard } : {}),
      // [FEAT-20260831-MENUSLIPQR] same shape, same rule: absent ⇒ nothing changes
      ...(wiring.quickReplyFor ? { quickReplyFor: wiring.quickReplyFor } : {}),
      /* Spread-if-present like its neighbour: an unwired build must not gain a
         key at all, so the renderer's own `?.` never even fires. */
      ...(wiring.renderStamp ? { renderStamp: wiring.renderStamp } : {}),
    }),
  };
}

/**
 * The ordered source chain. The code registry is ALWAYS last (plan §3f), so a
 * front source can override or disable a scenario while unknown keys still fall
 * through to code.
 */
export function buildSources(
  wiring: MenuWiring,
): readonly MenuDefinitionSource[] {
  /* Order, front to back: explicit front sources → the card source → the code
     registry. The registry is ALWAYS last (§3f) so an unmapped scenario still
     falls through to its file, and the card source sits behind explicit ones so
     a caller can override it without removing it. */
  const cardSource =
    wiring.slugFor && wiring.cards
      ? [
          new CardDefinitionSource({
            cards: wiring.cards,
            slugFor: wiring.slugFor,
            ...(wiring.onCardRefused
              ? { warn: (d: string) => wiring.onCardRefused!('not-found', d) }
              : {}),
          }),
        ]
      : [];
  return [
    ...(wiring.frontSources ?? []),
    ...cardSource,
    new CodeRegistrySource(),
  ];
}

/**
 * Assemble a ready engine.
 *
 * ⚠️ The engine's own `renderWith` falls back silently when a renderer is
 * missing — right for a typo in one scenario file, wrong for a wiring mistake
 * that would downgrade EVERY stored menu at once. `onCardRefused` makes the
 * first case audible; a caller that wants the second case to be loud passes
 * nothing and gets the fixed card, which is the safe default. Nothing here can
 * throw at a customer.
 */
export function createMenuEngine(wiring: MenuWiring): MenuEngineService {
  return new MenuEngineService({
    sources: buildSources(wiring),
    renderer: new FixedFlexRenderer(),
    renderers: buildRendererMap(wiring),
    coreSend: wiring.coreSend,
    ...(wiring.vars ? { vars: wiring.vars } : {}),
    ...(wiring.triggers ? { triggers: wiring.triggers } : {}),
    ...(wiring.log ? { log: wiring.log } : {}),
  });
}
