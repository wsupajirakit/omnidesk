/**
 * ==== [FEAT-20260828-MENUTAG] `@/modules/menu` — THE MODULE CONTRACT ====
 *
 * The menu family: `[[[menu-primary-*]]]` / `[[[menu-second-*]]]` plus their
 * `menu:v1:` postbacks. Plan: todo/task/28082026/todo1_28082026_menu-primary-tag.md
 * Runbook (how to operate it): docs/menu-tag-runbook.md
 *
 * ── STATUS ──────────────────────────────────────────────────────────────────
 * NOT WIRED. Nothing in the application calls this module; typing the tag does
 * nothing. S3 (the seat inside the webhook) is what would make it live and it
 * is PARKED by the owner. Keep it that way until the owner reopens S3.
 *
 * ── WHO OWNS WHAT ───────────────────────────────────────────────────────────
 * This module owns ONLY:
 *   · the grammar          menu-tag.util.ts      — one regex family, derived
 *   · the postback codec   menu-postback.util.ts — the ONLY minter of payloads
 *   · the scenarios        scenarios/            — content, one file each
 *   · the decisions        menu-engine.service.ts — pure orchestration
 *   · the look             renderers/            — a definition to a message
 *   · where a definition comes from   sources/   — ordered chain
 *   · which strings get variables     vars/      — routing only, no grammar
 *
 * It owns NOTHING ELSE. Sending, logging, persistence, variable BUILDING and
 * variable SUBSTITUTION all belong to code that already exists elsewhere and is
 * handed in as a dependency. See vars/menu-vars.port.ts for the four central
 * functions and where each one lives.
 *
 * ── HARD RULES — DO NOT ─────────────────────────────────────────────────────
 * 1. DO NOT import anything from another feature module here. Not webhook, not
 *    content, not hooks. Every collaborator arrives as an injected dep. This is
 *    what keeps the module compilable and testable on its own, makes a TS import
 *    cycle impossible, and keeps `revert: delete the folder` true.
 *    Pinned by menu-isolation-census.spec.ts.
 * 2. DO NOT edit or copy central code to make something fit. Others depend on
 *    it. If a dep genuinely cannot carry a value, that is a conversation with
 *    the owner first (STANDING ORDER #1 in the plan), never a quiet edit.
 * 3. DO NOT add a Nest decorator or a Mongoose model here. The engine is
 *    constructed by the S3 patch, not by the DI container. No schema, no
 *    collection, no migration belongs to this feature.
 * 4. DO NOT reach past this barrel from outside, and DO NOT widen this barrel
 *    "just in case". An export nobody calls and no test pins is an unproven
 *    claim, not a convenience — that lesson cost a whole backtest round.
 * 5. DO NOT write a second spelling of anything: one grammar, one codec, one
 *    scenario-key form, one path rule. A copy drifts; a derived value cannot.
 *
 * ── HOW TO REMOVE IT ────────────────────────────────────────────────────────
 * `rm -rf src/modules/menu` and delete `z-test/unit/menu-*.spec.ts`. That is a
 * COMPLETE revert while the module stays unwired, and
 * menu-isolation-census.spec.ts fails the day it stops being true. Once S3
 * lands, run `git apply -R docs/menu-plug-in.patch` first.
 */
export {
  MENU_ENGINE,
  MENU_CARD_SOURCE,
  MENU_TRIGGERS,
} from './menu-engine.port';
export type {
  MenuEngine,
  MenuHandleOutcome,
  MenuTapInput,
  MenuPostbackInput,
  MenuTriggerConfig,
} from './menu-engine.port';
export { MenuEngineService, type MenuEngineDeps } from './menu-engine.service';
export {
  parseMenuTag,
  findMenuTag,
  hasMenuTag,
  stripMenuTags,
  scenarioKey,
  parseScenarioKey,
  MENU_LEVELS,
  RESERVED_VARIANT,
  ITEM_ID_CHARSET,
  VARIANT_CHARSET,
  scenarioFileName,
  variantFromFileName,
} from './menu-tag.util';
export {
  buildMenuPostback,
  parseMenuPostback,
  buildMenuOpenPostback,
  parseMenuOpenPostback,
  MENU_POSTBACK_PREFIX,
  MENU_POSTBACK_MAX_BYTES,
  MENU_OPEN_DISCRIMINATOR,
} from './menu-postback.util';
export type { ParsedMenuOpen } from './menu-postback.util';
export { SCENARIOS, UNSHIPPED } from './scenarios';
export type {
  MenuDefinition,
  MenuItem,
  MenuItemAction,
  MenuResult,
} from './scenarios/scenario.types';
export { CodeRegistrySource } from './sources/code-registry.source';
export { CardDefinitionSource } from './sources/card-source';
export type { MenuSlugResolver, CardSourceDeps } from './sources/card-source';
export type { MenuDefinitionSource } from './sources/definition-source.port';
export { FixedFlexRenderer } from './renderers/fixed-flex.renderer';
/* [FEAT-20260902-MENUPRESSONCE] the seat mints an id per send and reads the two
   parts of a press back out of the payload. All three are exported because the
   SEAT is the only place that may know the policy (which cards, which budget);
   the module owns the mechanism only. */
export {
  mintRenderId,
  pressItemOf,
  pressRenderOf,
} from './renderers/press-stamp';
export type {
  MenuRenderer,
  RenderedMenuMessage,
} from './renderers/renderer.port';
export {
  StoredCardRenderer,
  mintButtons,
} from './renderers/stored-card.renderer';
export type {
  StoredCardRendererDeps,
  StoredCardRefusal,
} from './renderers/stored-card.renderer';
export type {
  StoredMenuCard,
  StoredMenuCardQuery,
  StoredMenuCardSource,
} from './renderers/stored-card.port';
export { MenuVarResolver } from './vars/menu-vars.resolver';
export type {
  MenuVars,
  MenuVarDeps,
  MenuVarContext,
  MenuResolvableDefinition,
  MenuBuildDataVars,
  MenuApplyVars,
  MenuSubstituteCtxVars,
  MenuRenderFlexDoc,
} from './vars/menu-vars.port';
export {
  createMenuEngine,
  buildRendererMap,
  buildSources,
} from './menu-composition';
export type { MenuWiring } from './menu-composition';
export { buildMenuContext, NOT_SILENCED } from './menu-context';
export type {
  MenuContext,
  MenuSilenceState,
  MenuSilenceSource,
} from './menu-context';
