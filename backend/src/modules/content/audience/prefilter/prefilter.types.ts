/**
 * [FEAT-20260824-BCASTTAGPRE] What one pre-resolved audience source declares.
 * ===========================================================================
 * A pre-filter answers ONE question the `members` filter cannot: "which member
 * ids does this rule name, when the answer lives in another collection?"
 *
 * 🔑 IT IS A PLANNER, NOT A READER. A resolver returns a query SHAPE — the same
 * house style as `audience/oa-scope.ts` — so the whole decision is testable with
 * no database, and the ONE place that touches Mongo is the send path's injected
 * reader. ตัว resolver สร้างรูป query ไม่ยิงเอง.
 *
 * revert: delete this folder and its line in the audience barrel.
 */
import type { AudienceRule } from '../sources';

/**
 * One lookup against one collection, and where to read the member id from.
 *
 * ⚠️ `model` is the MONGOOSE MODEL NAME (`connection.model(name)`), not the
 *    collection name. The send path has no schema of its own; it borrows the
 *    model another module registered, and a collection string would give it a
 *    raw handle with no casting — a hex string would then never match an
 *    ObjectId. ใช้ชื่อ model ไม่ใช่ชื่อ collection ไม่งั้น string จะไม่ match ObjectId.
 */
export interface PrefilterLookup {
  /** Which rule in `AudienceQuery.rules` this answers, by position. */
  readonly ruleIndex: number;
  readonly model: string;
  readonly filter: Record<string, unknown>;
  /**
   * Only the member id is read.
   *
   * ⚠️ `_id: 0` matters: without it every join row drags its own ObjectId back
   *    for nothing, and this runs once per tag rule per send.
   */
  readonly projection: Record<string, 0 | 1>;
  /** The column on the returned rows that holds the member `_id`. */
  readonly memberIdField: string;
  /** For the refusal message — what the admin actually picked. */
  readonly describe: string;
}

/**
 * A source whose rule is answered by another collection before the filter runs.
 *
 * 🔑 THE SEAM. Adding a second one (see the note in `index.ts` about ticket
 * type / status) is one entry in `prefilter.registry.ts` plus one file here —
 * the filter builder, the pager and the send path do not change.
 */
export interface AudiencePrefilterResolver {
  /** The `AudienceSource.key` this answers for. Must exist in the registry. */
  readonly key: string;
  /**
   * Turn one rule into one lookup, or explain why it cannot be built.
   *
   * 🔴 NEVER RETURNS "SKIP". A rule this resolver owns but cannot plan must be
   * an error, because a skipped rule is a DROPPED filter and a dropped filter
   * makes the audience WIDER — the failure the whole audience subsystem is
   * shaped around. ข้ามเงื่อนไข = ยิงกว้างกว่าที่สั่ง.
   */
  planLookup(
    rule: AudienceRule,
    ruleIndex: number,
  ): PrefilterLookup | { readonly error: string };
}

/** Read one planned lookup. Supplied by the send path; may reject. */
export type PrefilterReader = (
  lookup: PrefilterLookup,
) => Promise<readonly unknown[]>;
