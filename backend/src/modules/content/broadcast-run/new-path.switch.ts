/**
 * [FEAT-20260822-BCASTSWITCH] The one flag that decides which sender runs.
 * ===========================================================================
 * The owner approved migrating `POST /broadcasts/:id/send` to the new pipeline
 * after the seamless dive (แผน §PH.31). This is how that migration ships
 * without a deploy changing anything: **off**.
 *
 * 🔴 TWO GATES, AND BOTH MUST OPEN. `send_kind` landed on 23/08, so the plan's
 *    per-job design is now the one in force:
 *
 *      1. this module flag — "the new pipeline is available at all"
 *      2. the job's own `send_kind` — "THIS campaign opts in"
 *
 *    A job that names no kind stays on the sender it has always used, whatever
 *    this flag says. That is what makes turning the flag on a no-op for every
 *    campaign that exists today: none of them carry the column.
 *    เจ้าของสั่ง 23/08: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด" — เปิดธงแล้วงานเดิมไม่ขยับสักใบ.
 *
 *    The flag keeps earning its place as the kill switch: setting it back to
 *    `false` returns every job to the old sender in one edit, without touching
 *    a single stored row. ปิดธง = กลับหมดทุกงาน ไม่ต้องแก้ข้อมูล.
 *
 * ⚠️ TYPED `boolean`, NOT the literal `false`. With a literal type TypeScript
 *    narrows every `if (FLAG)` body to unreachable code, no test can enter the
 *    on-branch, and the new path would ship completely unexercised. The same
 *    trap `run-guard.ts` records for `SENDING_ENABLED`.
 *
 * TO TURN IT ON (stg first, never prod first):
 *   1. confirm `webhook_logs` still receives `action_type: 'send_broadcast'`
 *      rows — the admin history tab filters on exactly that, and it goes blank
 *      with no error if the new path forgets (แผน §PH.31.2)
 *   2. flip this to `true`. **Nothing changes yet** — no stored job carries a
 *      `send_kind`, so every campaign still takes the old sender.
 *   3. set `send_kind` on ONE test campaign, preview it, then send it to 2-3
 *      test recipients and compare the row the old path would have written
 *   4. widen one campaign at a time
 *
 * revert: set to `false`. Nothing else to undo; the old sender is untouched.
 */
export const BROADCAST_NEW_PATH_ENABLED: boolean = true;

/**
 * Does this run take the new pipeline?
 *
 * Deliberately a function rather than reading the constant at each call site:
 * when `send_kind` lands, the per-job decision goes HERE and every caller keeps
 * working. เผื่อท่อไว้แล้ว ตอนมีคอลัมน์ค่อยมาตัดสินใจที่นี่ที่เดียว.
 */
/**
 * The kinds that reach the new pipeline. A value outside this set is treated
 * exactly like an absent one — the old sender — because an unrecognised kind
 * is far more likely to be a typo or a stale row than a request for something
 * new, and guessing wrong here sends a campaign down an untested path.
 * ค่าที่ไม่รู้จัก = ใช้ท่อเดิม ไม่ใช่เดาว่าน่าจะหมายถึงอะไร.
 */
export const NEW_PATH_SEND_KINDS: readonly string[] = [
  'broadcast',
  'multicast',
];

/**
 * Does THIS job take the new pipeline?
 *
 * 🔴 BOTH GATES. The module flag says the pipeline exists; `send_kind` says
 *    this campaign asked for it. Absent, empty, unknown, or not a string at
 *    all ⇒ the old sender, every time.
 *
 * ⚠️ THE SIGNATURE CHANGED on 23/08: the first parameter used to be the flag
 *    override. It is now the job's kind, and the override moved to second.
 *    A caller written against the old shape passes a boolean where a kind is
 *    expected and gets `false` — the SAFE answer, and one the existing switch
 *    spec catches immediately rather than letting it ship.
 *    สลับพารามิเตอร์แล้ว — ของเก่าที่ไม่ได้แก้จะตกไปทางเดิม ซึ่งปลอดภัย.
 */
export function usesNewSendPath(
  sendKind?: unknown,
  enabled: boolean = BROADCAST_NEW_PATH_ENABLED,
): boolean {
  if (enabled !== true) return false;
  return typeof sendKind === 'string' && NEW_PATH_SEND_KINDS.includes(sendKind);
}
