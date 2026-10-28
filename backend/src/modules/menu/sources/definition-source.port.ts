/**
 * [FEAT-20260828-MENUTAG-S1] WHERE a definition comes from — the dynamic seam.
 *
 * PLAN §3f: the engine asks an ordered chain and takes the first non-null
 * answer; the code registry is always LAST. Tomorrow's per-hook source slots
 * in FRONT with zero engine changes. An explicit per-hook disable is answered
 * with a stub `{enabled:false}` definition — `null` stays reserved for "not
 * defined here, fall through".
 *
 * Async-ready on purpose: the future hook source reads a DB.
 *
 * ── RULES FOR ANY SOURCE, INCLUDING FUTURE ONES ────────────────────────────
 *   · `null` means "not defined here, keep looking" — NEVER "disabled".
 *     To disable a scenario for one hook, answer a definition with
 *     `enabled:false`; that wins the lookup and stops the chain, while its
 *     neighbours still fall through to code. Returning null for a disable would
 *     silently inherit the code default instead.
 *   · DO NOT check `enabled` inside a source. That belongs to the engine, which
 *     is why a front source can disable something the registry still defines.
 *   · DO NOT send, log or mutate anything. A source answers a question.
 *   · The code registry stays LAST, always. A new source goes in FRONT of it.
 *
 * revert: delete src/modules/menu/ whole.
 */
import type { MenuLevel } from '../menu-tag.util';
import type { MenuDefinition } from '../scenarios/scenario.types';
import type { MenuContext } from '../menu-context';

export interface MenuDefinitionSource {
  get(
    level: MenuLevel,
    variant: string | null,
    context: MenuContext,
  ): MenuDefinition | null | Promise<MenuDefinition | null>;
}
