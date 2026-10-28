/**
 * ==== [FEAT-20260828-MENUTAG-S1] the scenario registry — the ship list ====
 *
 * PLAN §3a: one import line per scenario; the map is keyed by the ONE
 * scenario-key spelling. A file present but missing here (or the reverse) is
 * a red spec (menu-scenario-registry.spec.ts walks the folder both ways) —
 * unless the key is listed in UNSHIPPED with a reason.
 *
 * ── ADDING ONE ─────────────────────────────────────────────────────────────
 * `menu-primary-g` = one new file `primary/g.ts` + ONE import line + ONE entry
 * in ALL below. Nothing else moves. Forget either half and
 * menu-scenario-registry.spec.ts goes red — it walks the folder and diffs it
 * against this map in BOTH directions.
 *
 * ── REMOVING ONE ───────────────────────────────────────────────────────────
 * Delete the file AND its two lines here. If you want it off but kept, do NOT
 * delete anything: set `enabled: false` in the file. If a file must exist
 * while staying unregistered, add it to UNSHIPPED with a reason — that is the
 * one loud, documented exception.
 *
 * ── DO NOT ─────────────────────────────────────────────────────────────────
 *   · DO NOT build this map by reading the folder at runtime. The explicit list
 *     is the ship list: a file appears to a customer only because someone chose
 *     to add it here, and that choice is reviewable in a diff.
 *   · DO NOT put a placeholder in with `enabled: true`. Every a-f ships
 *     disabled until the owner supplies real content (plan Q6); an enabled
 *     placeholder sends the literal word PLACEHOLDER to a real customer.
 *   · DO NOT hand-write a `key`. It must equal `scenarioKey(level, variant)`
 *     and the file name must follow the same rule, or the loader and the
 *     registry disagree about what exists.
 *   · DO NOT import a service into a scenario file. Scenarios are pure data.
 *
 * revert: delete src/modules/menu/ whole.
 */
import type { MenuDefinition } from './scenario.types';
import primaryDefault from './primary/default';
import primaryA from './primary/a';
import primaryB from './primary/b';
import primaryC from './primary/c';
import primaryD from './primary/d';
import primaryE from './primary/e';
import primaryF from './primary/f';
import secondDefault from './second/default';
import secondA from './second/a';
import secondB from './second/b';
import secondC from './second/c';
import secondD from './second/d';
import secondE from './second/e';
import secondF from './second/f';

/** Deliberately unshipped scenario keys, each with its reason. */
export const UNSHIPPED: ReadonlyArray<{ key: string; reason: string }> = [];

const ALL: readonly MenuDefinition[] = [
  primaryDefault,
  primaryA,
  primaryB,
  primaryC,
  primaryD,
  primaryE,
  primaryF,
  secondDefault,
  secondA,
  secondB,
  secondC,
  secondD,
  secondE,
  secondF,
];

export const SCENARIOS: ReadonlyMap<string, MenuDefinition> = new Map(
  ALL.map((d) => [d.key, d]),
);

export type {
  MenuDefinition,
  MenuItem,
  MenuItemAction,
  MenuResult,
} from './scenario.types';
