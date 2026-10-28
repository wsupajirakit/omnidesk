/**
 * [FEAT-20260905-CUSTPROV] Blob → the values a provider declared by PATH.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 7)
 *
 * ## THE THREE LEVELS, and why there are three rather than one
 * A flat "path from the blob root" table was tried first and rejected with a
 * number: the upstream varies in THREE independent ways — the container
 * (`data.…` or the blob itself), the nesting (sections beside `profile` or
 * inside it), and the field name (mock or real). Flat paths multiply those out,
 * so `finDepTotal` alone needs 2 × 2 × 2 = 8 spellings and every new field pays
 * the same tax. Naming the container once and the sections once collapses the
 * first two, and a field then costs the 2 spellings that are genuinely its own.
 * ทางแบนแล้ว path บานเป็น 8 ต่อฟิลด์ — แยกสามชั้นจึงเหลือ 2
 *
 *   rootPaths     where the container is          ['data', '']
 *   sectionPaths  each section, relative to root  finance: ['finance', 'profile.finance']
 *   fieldPaths    each value, relative to sections finCredit: ['finance.credit_balance', …]
 *
 * ## 🔴 THE ROOT RULE IS A GUARD, NOT A CONVENIENCE
 * The root is the first candidate whose `profile` section resolves TRUTHY, and
 * a blob with no such root yields NOTHING — every field falls to its fallback.
 * That reproduces `readShopapiSections`, which returned `null` unless it found a
 * profile. Drop the guard and a malformed blob that happens to carry a
 * `finance` object starts filling cards for a customer whose profile never
 * loaded. `profile` is therefore a REQUIRED key of `sectionPaths`, asserted by
 * `customer-provider-engine.spec.ts` rather than left to a comment.
 *
 * revert: delete `providers/engine/` and restore `shopapi-v1/build-fields.ts` from
 *         git history (commit `20d301e`), which computed the same values inline.
 */

import { readChain } from './read-path';

/**
 * One declared value: where to look, and what it is when nothing is there.
 *
 * `fallback` is written even when it is `undefined`-by-omission, because the
 * five array fields need `[]` and a card that receives `undefined` where it
 * expected a list renders nothing rather than an empty state. One uniform shape
 * — no union to branch on, and a reader never has to ask which form a line is.
 */
export interface FieldSpec {
  readonly paths: readonly string[];
  readonly fallback?: unknown;
}

export type FieldPathMap = Readonly<Record<string, FieldSpec>>;

/** What a provider declares about where its data lives. All DATA, no code. */
export interface PathDeclaration {
  readonly rootPaths: readonly string[];
  readonly sectionPaths: Readonly<Record<string, readonly string[]>>;
  readonly fieldPaths: FieldPathMap;
}

/** The sections bag — `{ profile, finance, … }`, or `null` when no root matched. */
export type Sections = Readonly<Record<string, unknown>> | null;

/**
 * Pick the container, then read each declared section out of it.
 *
 * Returns `null` — not an empty bag — when no candidate root carries a profile,
 * so callers can tell "this blob has no customer in it" from "this customer has
 * no finance section". The two look identical once flattened, and today's code
 * distinguishes them.
 */
export function resolveSections(
  blob: unknown,
  decl: PathDeclaration,
): Sections {
  const profilePaths = decl.sectionPaths['profile'];
  if (!profilePaths) {
    throw new Error(
      '[custprov] a provider must declare sectionPaths.profile — it is the marker that decides the root',
    );
  }
  for (const rootPath of decl.rootPaths) {
    const root = readChain(blob, [rootPath]);
    if (root === null || root === undefined) continue;
    if (!readChain(root, profilePaths)) continue; // TRUTHY, exactly as before
    const out: Record<string, unknown> = {};
    for (const [name, paths] of Object.entries(decl.sectionPaths)) {
      out[name] = readChain(root, paths);
    }
    return out;
  }
  return null;
}

/**
 * The declared values, resolved. This is the 80% — everything here came out of a
 * path table, so a vendor that differs only in field names is served by editing
 * data and shipping no code.
 *
 * 🔴 A missing section is not an error. `readChain` walks into `undefined` and
 * stops, so a provider may declare fields for a section the vendor omits and
 * every one of them lands on its fallback. That is what lets ONE field table
 * describe two upstream shapes.
 */
export function resolveFields(
  sections: Sections,
  fieldPaths: FieldPathMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fieldPaths)) {
    const v = sections === null ? undefined : readChain(sections, spec.paths);
    out[name] = v === undefined ? spec.fallback : v;
  }
  return out;
}

/**
 * One ROW, read through a path table — the same mechanism as a field, one level
 * down.
 *
 * 🔴 IT EXISTS SO A `view` CAN CARRY NORMALISED ROWS. Measured on 05/09: the
 * panel reads ~26 vendor field names inside its `.map()` callbacks, on top of
 * the 26 card values. Shipping raw rows would leave the front end knowing that
 * this vendor calls a product's name `catalog_name`, and adding provider B would
 * still be a two-repo change.
 *
 * Deliberately NOT a new engine: it is `resolveFields` with the row as the root,
 * so a vendor edits `row-paths.ts` exactly as it edits `field-paths.ts`, and the
 * `??` rule (a falsy value is an ANSWER) holds in both.
 */
export function resolveRow(
  row: unknown,
  table: FieldPathMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(table)) {
    const v = readChain(row, spec.paths);
    out[name] = v === undefined ? spec.fallback : v;
  }
  return out;
}

/** Every row in a list, normalised. Order is preserved — several cards sort. */
export function resolveRows(
  rows: unknown,
  table: FieldPathMap,
): Record<string, unknown>[] {
  return Array.isArray(rows) ? rows.map((r) => resolveRow(r, table)) : [];
}

/** The two halves of a provider that this engine drives. Structural on purpose:
 *  the engine must not import the port, or the port could not import the engine. */
export interface FieldSource<T> {
  readonly paths: PathDeclaration;
  deriveFields(sections: Sections, resolved: Record<string, unknown>): T;
}

/**
 * 🔴 THE ONE PLACE THE TWO HALVES MEET. Paths first, then the provider's
 * algorithms over the result.
 *
 * It exists so that the ORDER is written once. `CustomerProviderService.fieldsOf`
 * and every spec call through here, so a spec can never prove an assembly the
 * runtime does not perform — which is precisely how a green suite ends up
 * describing code nobody runs. หนึ่งนิยาม ทั้ง service และเทสใช้ตัวเดียวกัน
 */
export function composeFields<T>(src: FieldSource<T>, blob: unknown): T {
  const sections = resolveSections(blob, src.paths);
  return src.deriveFields(
    sections,
    resolveFields(sections, src.paths.fieldPaths),
  );
}
