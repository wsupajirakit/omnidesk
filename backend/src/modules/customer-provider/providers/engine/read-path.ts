/**
 * [FEAT-20260905-CUSTPROV] The provider chain rule — `??` over N paths.
 *
 * 📖 PLAN: `todo/task/05092026/todo3_05092026_profile_panel_module.md` (PART 7)
 *
 * ## 🔴 THE PATH READER ITSELF IS NOT HERE ANY MORE
 * This file first shipped its own `readPath`, supporting `a.b` and `[k=v]`. That
 * was a FOURTH copy of something the back end already had three of — and the
 * weakest: the existing one also resolves `[0]` and repeated groups `[a][b]`.
 * Found on 05/09 by looking for the existing one instead of assuming there was
 * none. It now imports `@/common`'s canonical reader, which is measured against
 * the three deliberate clones by `read-path-canonical.spec.ts`.
 * หาของเดิมก่อน — ที่เขียนใหม่ไปคือชุดที่ 4 และอ่อนที่สุด
 *
 * What stays here is the part that IS this module's own: the chain rule.
 *
 * revert: inline `readPath` back from `@/common/utils/read-path`.
 */

import { readPath } from '@/common/utils/read-path';

/**
 * The first path that yields a value which is neither `null` nor `undefined`.
 *
 * 🔴 THIS IS `??`, NOT `||`, AND THE DIFFERENCE IS LOAD-BEARING. Today's mapping
 * chains its two vendor shapes with `??` throughout, so a credit balance of `0`,
 * an empty-string name and a `false` flag are ANSWERS and stop the chain. Switch
 * this to truthiness and a customer with zero credit silently falls through to
 * the other vendor's key — which is how a card shows a stale number instead of
 * `0`. ห้ามเปลี่ยนเป็น || — 0 กับ '' คือคำตอบ ไม่ใช่ค่าว่าง
 *
 * ⚠️ `tierPaths` deliberately uses the OTHER rule (first TRUTHY) — see
 * `member-tier-key.util.ts:38-48`. Two rules, each written where it is true;
 * do not "unify" them.
 */
export function readChain(root: unknown, paths: readonly string[]): unknown {
  for (const p of paths) {
    const v = readPath(root, p);
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}
