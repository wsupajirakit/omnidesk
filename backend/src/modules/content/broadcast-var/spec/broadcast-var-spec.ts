/**
 * [FEAT-20260822-BCASTSPECCLONE] Our own copy of the flex variable spec.
 * ===========================================================================
 * 🧬 A CLONE, ON PURPOSE (owner, 2026-08-22: "clone spec var มา (ต้อง sync ด้วย)
 * … ห้ามกระทบ original var").
 *
 * SOURCE: `src/modules/system/dict-spec/flex-var-spec.ts`
 * The row tables and their constructors below were COPIED from that file
 * verbatim rather than retyped — a retyped table is already drifting on the day
 * it is written. Nothing here imports the original at runtime, which is the
 * whole reason for cloning instead of calling.
 *
 * 🔴 WHAT KEEPS THIS HONEST
 * `z-test/unit/broadcast-var-spec-drift.spec.ts` walks BOTH the original and
 * this copy and fails if their tag sets differ by a single entry. That spec is
 * the only place the two are allowed to meet, and `broadcast-guards.spec.ts`
 * refuses to let it be deleted or skipped while this folder exists.
 *   · the original gains a variable  → the drift spec goes red and names it
 *   · WE follow THEM, never the other way round
 * สำเนาที่ไม่มีตัวจับดริฟต์ = หนี้ · ตัวจับอยู่ในเทส ไม่ใช่ในคอมเมนต์.
 *
 * ⚠️ DO NOT "improve" these tables. A difference from the original is a bug
 *    here even when it looks like a fix — take it upstream instead.
 *
 * revert: delete this folder and the drift spec that guards it.
 */

import { FLEX_VAR_SPEC } from './spec-rows.profile';
import { SITE_RULES_VAR_SPEC } from './spec-rows.site-rules';
import { FLEX_VAR_LIST_ROWS, type SpecRow } from './spec-rows.types';

/** A visitor over the spec: called once per variable with its tag and path. */
export type SpecVisitor = (tag: string, path: string, desc: string) => void;

/**
 * The walk — COPIED from `walkFlexVarSpec` in the original, not rewritten.
 *
 * 🔴 An earlier version of this file wrote its own loop and produced 12 tags
 * the original does not have while missing 12 it does: the `indexed` rows build
 * their tag from a SUFFIX (`prefix_key + suffix`), not from `prefix_key_field`.
 * The drift spec caught it on the first run, which is the whole reason it
 * exists. ตัวเดินก็ต้อง clone ไม่ใช่เขียนเอง.
 *
 * Parameterised over the table so both specs share one implementation, exactly
 * as the original does.
 */
function walk(spec: readonly SpecRow[], visit: SpecVisitor): void {
  for (const row of spec) {
    if (row.kind === 'one') {
      visit(row.tag, row.path, row.desc);
      continue;
    }
    if (row.kind === 'each') {
      for (const [k, label] of row.keys) {
        visit(
          row.tagTpl.replace('{k}', k),
          row.pathTpl.replace('{k}', k),
          row.descTpl.replace('{label}', label),
        );
      }
      continue;
    }
    if (row.kind === 'list') {
      for (let i = 1; i <= FLEX_VAR_LIST_ROWS; i++) {
        for (const [field, fieldLabel] of row.fields) {
          visit(
            `${row.prefix}_${i}_${field}`,
            `${row.path}[${i - 1}].${field}`,
            `${row.label} รายการที่ ${i}${i === 1 ? ' (ล่าสุด)' : ''} — ${fieldLabel}`,
          );
        }
      }
      continue;
    }
    for (const [k, keyLabel] of row.keys) {
      for (const [suffix, field, fieldLabel] of row.fields) {
        visit(
          `${row.prefix}_${k}${suffix}`,
          `${row.path}[${row.by}=${k}].${field}`,
          `${fieldLabel} — ${keyLabel}`,
        );
      }
    }
  }
}

/** Every profile variable this clone knows. Mirrors `walkFlexVarSpec`. */
export function walkBroadcastVarSpec(visit: SpecVisitor): void {
  walk(FLEX_VAR_SPEC, visit);
}

/** Every site-rules variable this clone knows. Mirrors `walkSiteRulesSpec`. */
export function walkBroadcastSiteRulesSpec(visit: SpecVisitor): void {
  walk(SITE_RULES_VAR_SPEC, visit);
}

/**
 * Tags this clone deliberately does NOT carry.
 *
 * Empty today. Any entry must be explained beside it — otherwise "we chose not
 * to" and "we forgot" look identical, which is precisely what the drift spec
 * exists to tell apart.
 */
export const INTENTIONALLY_NOT_CLONED: readonly string[] = [];
