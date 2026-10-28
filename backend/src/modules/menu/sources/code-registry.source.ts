/**
 * [FEAT-20260828-MENUTAG-S1] today's ONLY source: the code registry.
 * Always present, always LAST in the chain (plan §3f). Returns the definition
 * as-is — the `enabled` check belongs to the ENGINE, so a per-hook
 * `{enabled:false}` stub from a front source wins the lookup and disables the
 * scenario without this source ever knowing.
 * revert: delete src/modules/menu/ whole.
 */
import { scenarioKey, type MenuLevel } from '../menu-tag.util';
import { SCENARIOS } from '../scenarios';
import type { MenuDefinition } from '../scenarios/scenario.types';
import type { MenuDefinitionSource } from './definition-source.port';

export class CodeRegistrySource implements MenuDefinitionSource {
  public get(level: MenuLevel, variant: string | null): MenuDefinition | null {
    return SCENARIOS.get(scenarioKey(level, variant)) ?? null;
  }
}
