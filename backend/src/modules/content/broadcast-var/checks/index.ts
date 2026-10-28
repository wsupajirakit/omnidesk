/**
 * [FEAT-20260822-BCASTCHECKS] Barrel for the pre-send checkers.
 * ===========================================================================
 * RULES OF THIS FOLDER (เจ้าของ 22/08: "ทุกอย่างอิสระแยกกันทั้งหมด")
 *  · one checker = one file = one switch (`checks.config.ts`) = one revert
 *  · checkers do NOT import one another — the caller decides the order
 *  · no checker throws: each returns an answer, so a bad value costs one slot,
 *    never the whole campaign
 *  · nothing here imports the original var path — not the spec, not the
 *    formatters, not the renderer (🔒 "ห้ามแก้ไข original truth")
 *
 * ORDER THE CALLER MUST USE: shape → (optional liveness) → fallback, and
 * `normalizeEmpties` LAST, after every value is resolved but BEFORE the values
 * are substituted into the card.
 *
 * 🟢 WIRED — corrected 03/09/2026. This line said "NOT WIRED YET — nothing in
 *    the running system imports this barrel", and it has been false since
 *    31/08: `broadcasts.service.ts` imports `checkProfileMatch` through the
 *    parent barrel (`./broadcast-var`), which re-exports this one, and that
 *    gate returns a 400 to real admins today. A comment that was true once and
 *    never revisited is worse than none — the next reader budgets their care
 *    against dead code that is actually live.
 *    คอมเมนต์ที่เคยจริงแล้วไม่ได้ตามแก้ อันตรายกว่าไม่เขียนเลย.
 *
 * ⚠️ ONE DECLARED EXCEPTION to "checkers do NOT import one another":
 *    `site-rules-freshness.ts` imports `collectTags` from
 *    `needs-per-recipient.ts`. That rule exists so no checker depends on
 *    another's VERDICT — order stays the caller's to choose. `collectTags` is
 *    a shared READER of the card, not a verdict, and duplicating it would put
 *    a second `{{tag}}` scanner in this folder, which is the debt the rule is
 *    ultimately protecting against. ยืมตัวอ่าน ไม่ได้ยืมคำตัดสิน.
 *
 * revert: delete this folder. Nothing outside it refers to these names.
 */
export * from './checks.config';
export * from './empty-value';
export * from './image-fallback.config';
export * from './image-url.shape';
export * from './needs-per-recipient';
/* [FEAT-20260903-BCASTSRFRESH] is this OA's site-rules blob fresh enough? */
export * from './site-rules-freshness';
