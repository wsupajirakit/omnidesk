/**
 * follow-up — deciding when a customer has stopped registering and started
 * talking past us, and what should happen about it.
 * ===========================================================================
 *
 * ## THE RULES THIS FOLDER LIVES BY
 *
 * They are not style preferences. Each one exists so that any single piece can
 * be lifted out, reused elsewhere, or deleted outright without the rest
 * noticing — and every one of them is checked by
 * `z-test/unit/follow-up-boundaries.spec.ts`, which reads the real import graph.
 * A rule that is only written down decays; these are enforced.
 *
 * 1. NOTHING HERE KNOWS WHAT A WEBHOOK IS.
 *    No `@nestjs`, no LINE client, no `webhook.service`. Every dependency —
 *    a model, a logger, a language model — arrives as an argument. That is what
 *    lets a cron, a CLI or a test ask the same questions the webhook asks.
 *
 * 2. EVERY FUNCTION RETURNS A VERDICT. IT NEVER ACTS.
 *    Nothing here replies to a customer, publishes an event or stops a flow.
 *    The caller reads the verdict and decides. Acting from in here would weld
 *    the module to whoever calls it first.
 *
 * 3. DECIDING IS SEPARATE FROM STORING.
 *    `abandon-trigger.rule.ts` touches no database and imports nothing at all;
 *    it can be run anywhere on plain rows. The helpers own the storage, and
 *    they reach it ONLY through `chat/config` — never a schema, never a service.
 *
 * 4. SHARED NAMES LIVE ALONE.
 *    `follow-up.keys.ts` and `follow-up.copy.ts` import nothing, so taking the
 *    clear step does not drag in the rule, and editing the wording does not mean
 *    opening the logic. This one was learned the hard way: the key used to live
 *    in the level-1 helper, which quietly made the module all-or-nothing.
 *
 * 5. ONLY THE GATE COMPOSES.
 *    Helpers never import each other. `follow-up.gate.ts` is the single place
 *    that knows there is an order, and it is also optional — the helpers stand
 *    on their own if a caller wants only one of them.
 *
 * 6. ONE LEAF AT A TIME.
 *    Writes are dot-path `$set`, clears are dot-path `$unset`. A member's other
 *    settings — including the same key name under a different channel — are
 *    never touched. Proved against the real database, not assumed.
 *
 * 7. NEVER THROW, NEVER DELAY.
 *    This runs beside a live customer conversation. Every failure is swallowed
 *    and logged; nothing here is on the path of a reply.
 *
 * 8. THE ARROW POINTS ONE WAY.
 *    This folder never imports `register/`, and `register/` never imports this.
 *    The webhook calls both. Either can be deleted without the other noticing.
 *
 * ## REMOVING THE WHOLE FEATURE — the exact steps, verified 2026-08-20
 *
 * Not a sketch: each step below was executed on this tree, the result was
 * typechecked, and the suite was run. `tsc` came back clean and 188 of 189
 * suites stayed green — the one failure being this feature's own reader entry
 * in `member-config.spec.ts` (step 5). ทดลองถอดจริงแล้ว ไม่ใช่เขียนลอย ๆ.
 *
 * 1. `webhook.service.ts` — delete the `[FEAT-20260820-FOLLOWUP] gate` block,
 *    from its opening comment down to and including the closing brace of the
 *    `if (followUp.memberNeedRegister) { … return; }` branch.
 * 2. `webhook.service.ts` — delete the imports that block owned. THE COMPILER
 *    NAMES THEM ALL, so do not hunt by eye: run `tsc --noEmit` and delete what
 *    it calls unused. On 2026-08-20 that was exactly six —
 *    `runFollowUpGate`, `FOLLOW_UP_REGISTER_ASK_TEXT`, `handoffToRegister` +
 *    `ACTIVE_REGISTER_SCENARIO`, `REQUEST_REG_KEY`, `writeMemberConfigOnce`,
 *    `openTicketBySystem` — plus the two locals nothing else read,
 *    `inboundRoom` and `followUpHasProfile` (delete their assignments too).
 * 3. Delete this folder and `../register/`. They never import each other, so
 *    either can go alone; the webhook is the only thing that calls both.
 * 4. Delete this feature's specs in `z-test/unit/`: `abandon-trigger` ·
 *    `follow-up-*` · `register-*` · `build-member-info` · `resolve-info-*` ·
 *    `open-ticket-by-system`.
 *    ⚠️ NOT `clear-follow-up-on-register.spec.ts` — the name matches but it
 *    belongs to `customer-link/`, which is independent of this folder. A first
 *    removal attempt deleted it by pattern and produced a misleading result.
 * 5. `z-test/unit/member-config.spec.ts` — drop this folder's files from the
 *    "ONE feature reads the bag" reader list.
 *
 * ── [FEAT-20260821-IGNOREABANDON] added to this recipe when the switch landed ──
 * The "leave this one alone" switch rides along inside this folder, but it is a
 * separate feature with its own removal path. Removing THIS folder takes it with
 * you; removing only the switch is steps 6-9 alone.
 *
 * 6. `follow-up.gate.ts` — delete the `[FEAT-20260821-IGNOREABANDON]` guard block
 *    and the `hook?:` field on `FollowUpGateInput`. Both carry the tag.
 * 7. Delete `./ignore-abandon.rule.ts` and its `export *` line below. Nothing
 *    else in this folder imports it — the boundaries spec proves that.
 * 8. `webhook.service.ts` — delete the one `hook,` line inside the
 *    `runFollowUpGate({…})` argument. ⚠️ NOT the `const followUp = await
 *    runFollowUpGate(` line itself: four specs slice on that exact text
 *    (`follow-up-gate` · `abandon-trigger` · `sticker-follow-up-path` ·
 *    `follow-up-boundaries`).
 * 9. Delete `z-test/unit/ignore-abandon-assist.spec.ts`.
 *
 * OUTSIDE THIS FOLDER, and only if the whole feature goes — these are its
 * storage and its screen, and they are harmless if left in place:
 *   · `hooks/schemas/hook.schema.ts` + `chat/schemas/member.schema.ts` — the two
 *     `ignore_abandon_assist` columns. Rows keep their values; nothing reads
 *     them once step 6 is done.
 *   · `hooks/hook-field-tabs.ts` — the `FIELD_TAB` line (clone stops copying it).
 *   · `hooks/hooks.service.ts` — the `ALLOWED_UPDATES` entry and the two
 *     `parseIgnoreAbandonAssist` call sites; `hook-write.helpers.ts` — the parser.
 *   · `omnidesk-console` — `types/hook.ts` (TWO interfaces), the two lines in
 *     `HookFormModal.tsx`, the block in `form/tabs/HookAiTab.tsx`, four i18n keys
 *     in each of `en.json`/`th.json`, and the four cases in
 *     `HookFormModal.value.test.tsx`.
 * ถอดสวิตช์อย่างเดียว = ข้อ 6-9 · ถอดทั้งฟีเจอร์ = บวกรายการนอกโฟลเดอร์ข้างบน
 *
 * OPTIONAL, and only for tidiness — nothing breaks if they stay:
 *   · `../resolve-info/` (used only by `register/`)
 *   · the two keys in `chat/config/member-config.registry.ts`
 *   · the two partial indexes in `chat/schemas/member.schema.ts`
 *     (`dropIndex` on the live DB removes them; rows keep their values)
 *
 * ## WHAT REMOVAL LEAVES BEHIND — and why nothing breaks
 * Customers stop being marked and stop being asked; the bot answers everyone as
 * it did before this existed. Rows already carrying
 * `config.follow_up.line.abandon_trigger_at` are harmless — nothing reads them
 * once the gate is gone. `customer-link/clear-follow-up-on-register.helper.ts`
 * KEEPS WORKING, because it reaches the key through `chat/config` and never
 * imports this folder: verified by removing this folder with that helper left in
 * place — its 15 cases stayed green. ถอดตัวนี้ ตัวฝั่ง cuslink ยังทำงานได้
 *
 * ## PUTTING IT BACK
 * `git revert` the commit, or restore the two folders and re-add the gate block.
 * The gate is the ONLY integration point — there is no registration, no module
 * wiring and no config to redo. เอากลับ = คืนโฟลเดอร์ + บล็อก gate จุดเดียว.
 *
 * เขียนกฎไว้เพราะโมดูลนี้ต้องถอดทีละชิ้นได้จริง — และมีเทสบังคับ ไม่ใช่แค่ตั้งใจ.
 */
export * from './follow-up.keys';
export * from './abandon-trigger.rule';
export * from './ignore-abandon.rule';
export * from './abandon-trigger.helper';
/* [FEAT-20260825-HELPERTRIGGER] rule = เงื่อนไขล้วน (แก้นโยบายที่นั่นที่เดียว)
   helper = ตัวเขียนจริง · แยกสองไฟล์แบบเดียวกับ abandon-trigger ข้างบน */
export * from './customer-helper-trigger.rule';
export * from './customer-helper-trigger.helper';
export * from './clear-follow-up.helper';
export * from './follow-up.gate';
export * from './follow-up.copy';
