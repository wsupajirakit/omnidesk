/**
 * [FEAT-20260821-IGNOREABANDON] "leave this one alone" — the switch that turns
 * the abandon chase off, per OA or per customer.
 * ===========================================================================
 * OWNER'S WORDS (20/08/2026):
 *   · *"ไม่ใช่ follow up มันเปน column ใหม่"* — the value is a column of its own
 *     on `hooks` and on `members`, not a follow-up setting. This file only READS
 *     it; it does not own it, name a path to it, or store anything.
 *   · *"เงื่อนไขการวางก็วางไว้ตรงที่เชค abadnon นั้นแหละ"* — so the gate asks this
 *     question at the abandon check, AFTER level 0. That ordering is the gate's
 *     to keep (rule 5); this file has no opinion about when it is called.
 *   · *"ทุกอย่างต้อง seamless + อิสระ ถอดได้กระไม่กระทบ ฟังก์ชั่นใหม่แยกเดี่ยวๆ เลย"*
 *     — hence a leaf of its own rather than an `if` grafted into an existing
 *     helper. Deleting this file and the two lines that call it removes the
 *     feature completely.
 *
 * ⚠️ WHY `=== true` AND NOTHING ELSE. Both columns are declared
 * `default: false`, and that default is a LIE on the read path: hooks and
 * members are read with `.lean()` (`hook-cache.service.ts`,
 * `webhook.service.ts`, `tickets.service.ts`), and Mongoose does not apply
 * schema defaults to a lean result. Every row that predates the column answers
 * `undefined`. So `!== false` or `?? true` would report "switched off" for the
 * entire existing database the moment this deploys — the feature would turn
 * ITSELF on everywhere, silently, with no error to trace.
 * Measured 21/08/2026 on the dev db: 0 of 10 hooks and 0 of 4 members carry the
 * column, while `doc_retrieval` — a field of the same shape added on 10/08 —
 * is present on only 5 of 10. ค่าเก่าอ่านได้ undefined ไม่ใช่ false.
 *
 * This file imports NOTHING, on purpose (folder rule 3): it decides, it does not
 * store, and it can be run over plain rows by a cron, a CLI or a test.
 *
 * revert: delete this file, its `export *` line in `index.ts`, and the guard in
 * `follow-up.gate.ts`. Nothing else refers to it — steps 6-9 of the removal
 * recipe in `index.ts`, which was executed end to end on 21/08/2026: `tsc` came
 * back clean and 169 tests across 10 suites stayed green.
 */

export interface IgnoreAbandonInput {
  /**
   * The OA the message arrived on, and the customer's member row.
   *
   * Both are `unknown` rather than a row shape, because that is what they
   * honestly are: the gate declares `member: unknown` and a populated field can
   * come back as an id string, `null`, or a lean object. Naming a shape here
   * would force every caller to cast — and a cast is a promise the database
   * does not keep. `readSwitch` below does the narrowing once, safely.
   * รับ unknown เพราะของจริงมาได้ทุกแบบ.
   */
  hook?: unknown;
  member?: unknown;
}

/**
 * Is the abandon chase switched off for this message?
 *
 * EITHER side can switch it off and NEITHER can switch it back on: an OA that
 * chases nobody outranks a customer who was never marked, and a customer opted
 * out individually stays out even on a chasing OA. There is no "force on" —
 * adding one would mean deciding which side wins, and nobody has asked for that.
 * ฝั่งไหนปิดก็คือปิด ไม่มีฝั่งไหนเปิดกลับได้.
 *
 * Returns a verdict and does nothing else (folder rule 2). The caller decides.
 */
export function abandonIsSwitchedOff(
  input: IgnoreAbandonInput | null | undefined,
): boolean {
  if (!input) return false;
  return readSwitch(input.hook) === true || readSwitch(input.member) === true;
}

/**
 * A row can arrive as anything the database hands back — including `null`, a
 * string id that was never populated, or a lean object. Reaching into it must
 * never throw beside a live conversation (folder rule 7).
 */
function readSwitch(row: unknown): unknown {
  if (!row || typeof row !== 'object') return undefined;
  return (row as { ignore_abandon_assist?: unknown }).ignore_abandon_assist;
}
