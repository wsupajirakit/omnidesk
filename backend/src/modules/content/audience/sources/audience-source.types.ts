/**
 * [FEAT-20260822-BCASTAUDSRC] What one selectable member field must declare.
 * ===========================================================================
 * เจ้าของ 22/08: "เป้าหมาย member เราเลือกได้ว่าคือ member.follow_up.xxxx หรือ
 * member.x ก็ได้ · ต้อง flexible ถอดเสียบได้".
 *
 * 🔑 A REGISTRY, NOT FREE PATHS — and the reason is not tidiness (§0c.3):
 *   · security   — a free path lets a request read anything on the row,
 *                  including `raw_profile_data` and `meta`, and opens the door
 *                  to operator injection
 *   · performance — the registry is the only place that knows whether a field
 *                  has an index; a free path is a collection scan nobody saw
 *                  coming
 *   · the UI      — the form is built FROM this table, so a new field appears
 *                  in the dropdown without an FE deploy
 *   · one answer  — "what can we select on?" is this file, not a code hunt
 *
 * 🔑 BOTH SHAPES ARE ONE SHAPE HERE. `member.display_name` (a column) and
 * `member.follow_up.abandon_at` (a nested path) differ only in the `path` they
 * declare. The filter builder never learns the difference, which is what makes
 * adding either one a single entry. ทั้ง column และ path ซ้อน = entry เดียวกัน.
 *
 * revert: delete this folder and its line in the audience barrel.
 */

/** What kind of value the field holds — decides which operators make sense. */
export type AudienceValueType = 'date' | 'string' | 'string[]' | 'number';

/**
 * Operators a rule may use.
 *
 * ⚠️ `exists` is deliberately ABSENT. §6 measured that adding `$exists` to a
 * selection query destroys a covered read and turns it back into a full fetch.
 * A partial INDEX may use `$exists` in its definition; a QUERY may not. Ask for
 * a range instead — `lte: <now>` says "has one, and it is due" in one condition
 * that an index can answer. ห้าม $exists ในตัว query.
 */
export type AudienceOp =
  | 'lte'
  | 'gte'
  | 'eq'
  | 'in'
  | 'contains'
  /* [FEAT-20260825-HASVALUE] "มีค่า" / "ไม่มีค่า" — for columns whose question is
     presence, not magnitude. Owner, 25/08/2026: the broadcast needs to find the
     people who have no value in a column, and *"เงื่อนไขคือมีหรือไม่มี ไม่ใช่
     น้อยหรือมาก"*.

     ⭐ THESE DO NOT BREAK THE RULE ABOVE — THEY OBEY IT. Neither operator emits
     `$exists`. `has_value` builds `{path: {$ne: null}}` and `no_value` builds
     `{path: null}`, and in MongoDB a bare `null` match already covers BOTH a
     missing field and an explicit null, which is exactly the question being
     asked. Measured on the live collection 25/08/2026:

       {path: {$ne: null}}  →  FETCH ← IXSCAN   keysExamined 1   (index used)
       {path: null}         →  COLLSCAN         docsExamined = whole collection

     ⚠️ THE SECOND LINE IS NOT A DEFECT TO BE FIXED, and no index can fix it:
     proving a field is absent means looking at every document. A source whose
     expected use is `no_value` must therefore declare `indexed: false` even
     when a partial index exists for the other direction — `indexed` is one
     boolean covering both, and the form shows a "slow" warning from it. Saying
     `true` would be a lie for the half the operator is actually used for.

     ⚠️ Do not name a future operator `exists`: four specs across both repos
     assert that no source advertises that name, and they are what keeps
     `$exists` out of queries. ห้ามตั้งชื่อ op ว่า exists.

     revert: drop these two members, their two cases in `clauseFor`, the
     `raw_profile_cleared_at` entry in the registry, and the FE half named in
     `todo/be_todo64_25082026.md`. */
  | 'has_value'
  | 'no_value';

export interface AudienceSource {
  /** Stored on the job in `audience.rules[].key`. NEVER rename once in use. */
  readonly key: string;
  readonly label_th: string;
  readonly label_en: string;
  /** Where it lives on the member document. A column or a dotted path. */
  readonly path: string;
  readonly type: AudienceValueType;
  readonly ops: readonly AudienceOp[];
  /**
   * Does the collection this reads carry `hook_id` itself?
   *
   * 🔴 `false` for everything on `members`, because that collection has NO
   * `hook_id` at all — its ids must still be narrowed through `chat_rooms`
   * (`audience/oa-scope.ts`). Only a source reading a collection that stores
   * the OA, such as `customer_tags`, may say `true`.
   */
  readonly scope_by_hook: boolean;
  /**
   * Is there an index for this path?
   *
   * 🔴 Declared, never assumed. An un-indexed field is still allowed — some
   * questions are worth a slow answer — but it must be VISIBLE, so the UI can
   * warn and a reviewer can object. ไม่มี index ไม่ผิด แต่ต้องบอก.
   */
  readonly indexed: boolean;
  /** Set instead of deleting an entry that live jobs still reference (D48). */
  readonly deprecated?: boolean;
}
