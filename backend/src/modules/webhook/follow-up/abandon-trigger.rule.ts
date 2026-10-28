/**
 * Was this customer just asked to register, and are they still ignoring it?
 * ===========================================================================
 * A pure decision. No database, no I/O, no clock — give it rows, it answers.
 * That is what makes it testable without a fixture and reusable from anywhere.
 *
 * This is the rule the retired abandon ALERT used, minus the profile condition:
 * the owner's new instruction is simply "ถ้าในประวัติ 3 อันล่าสุดมี customer helper".
 * Nothing here interrupts anybody any more — it only decides whether a member
 * gets stamped. `todo/be_todo27_20082026.md` records what the old alert did and
 * why it went. เงื่อนไขเดิมของ alert อยู่ในโน้ตนั้น.
 *
 * revert: delete this folder and its call in webhook.service.
 */

/**
 * The marker the bot's registration card carries.
 *
 * Read from a REAL row, not guessed: every customer-helper message in the
 * database is `sender_type: 'bot'`, `message_type: 'flex'`, and carries
 * `metadata.auto_reply_type = 'flex_customerhelper'` (19 of 19 at the time it
 * was checked). ดูจากแถวจริง ไม่ได้เดาชื่อ field.
 */
/* ═══════════════════════════════════════════════════════════════════════════
 * [MAINPORT-20260823-ABANDONFIX] IF THE ABANDON FIX IS CHERRY-PICKED TO `main`
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE MERGING `dev` INTO `main`. It is not a warning about this
 * file's behaviour — the code below is fine. It is about a MERGE that will
 * conflict, and about the two-command resolution that is provably correct.
 *
 * ── WHY THIS NOTE EXISTS ───────────────────────────────────────────────────
 * The bug: a customer sends a slip, is refused because they have no linked
 * account, receives the customer-helper card — and then writes back, and
 * abandon LEVEL 1 does not fire. Seen live in production 20/08/2026. Fixed on
 * `dev` by commit `f4e0d81` (the slip path used to name its history row after
 * the operator's TEXT field, so `wasSentRegistrationCard` never recognised it).
 *
 * That fix is on `dev` and NOT on `main`, so production still has the bug while
 * it deploys from `main`. The owner asked whether the ONE fix could be taken to
 * `main` on its own, ahead of the full merge. It can. This note records what
 * that costs later, because the cost lands on whoever does the next merge —
 * probably not the person who did the cherry-pick.
 *
 * ── WHAT IS TRUE TODAY (verified 23/08/2026, not assumed) ──────────────────
 * `origin/main` is an ANCESTOR of `dev` (`git merge-base --is-ancestor
 * origin/main dev` succeeds; `git rev-list --count dev..origin/main` is 0).
 * So a `dev` → `main` merge right now is a fast-forward: ZERO conflicts.
 *
 * A cherry-pick changes that. `main` gains a commit `dev` does not have, the
 * merge stops being a fast-forward, and git has to three-way merge files that
 * BOTH sides have since edited.
 *
 * ── WHAT CONFLICTS, MEASURED BY SIMULATION (not by reading) ────────────────
 * A throwaway worktree was branched from `origin/main`, the fix applied and
 * committed there, then `dev` merged in. Result — three files:
 *
 *   src/modules/webhook/follow-up/abandon-trigger.helper.ts   CONFLICT
 *   src/modules/webhook/follow-up/abandon-trigger.rule.ts     CONFLICT  (this file)
 *   src/modules/webhook/follow-up/follow-up.gate.ts           CONFLICT
 *
 *   src/modules/webhook/webhook.service.ts                    auto-merged
 *   z-test/unit/abandon-trigger.spec.ts                       auto-merged
 *
 * Causes, one per file:
 *   · helper.ts / rule.ts — `dev` moved on after `f4e0d81` with `1654e92`
 *     (notice hardening), so `main` would sit at an intermediate state.
 *   · follow-up.gate.ts — `f4e0d81` edits a type introduced by `6a8504a`
 *     (`ignore_abandon_assist`), which is NOT on `main`. The port has to
 *     re-declare the `hook?: { flex_customerhelper_id?: unknown }` field by
 *     hand, so the two sides differ by construction.
 *
 * ⚠️ `webhook.service.ts` auto-merged only because the edited regions happened
 *    not to overlap — it carries 14 further `dev` commits. That luck is not a
 *    guarantee. RE-RUN THE SIMULATION before the real merge rather than
 *    trusting this list.
 *
 * ── HOW TO RESOLVE (proven, not guessed) ──────────────────────────────────
 * `dev` is a strict superset here: it has the fix AND everything after it.
 * Take `dev` whole for each conflicted file:
 *
 *     git checkout --theirs -- src/modules/webhook/follow-up/abandon-trigger.helper.ts
 *     git checkout --theirs -- src/modules/webhook/follow-up/abandon-trigger.rule.ts
 *     git checkout --theirs -- src/modules/webhook/follow-up/follow-up.gate.ts
 *     git add -A && git commit
 *
 * Verified in the simulation: after this, all five files hash-match `dev`
 * (sha256, one by one), `git diff dev HEAD -- src/ z-test/` is empty, and
 * `tsc --noEmit` is clean. Do NOT hand-merge the hunks — the goal is simply
 * "become `dev`", and taking the whole file is what achieves that exactly.
 *
 * ── HOW TO CHECK BEFORE MERGING, INSTEAD OF FINDING OUT DURING ────────────
 *     git worktree add --detach /tmp/wt-mergesim origin/main
 *     cd /tmp/wt-mergesim && git merge --no-commit --no-ff dev
 *     git diff --name-only --diff-filter=U      # the real conflict list
 *     git merge --abort && cd - && git worktree remove /tmp/wt-mergesim
 *
 * ── IF THE CHERRY-PICK NEVER HAPPENS ──────────────────────────────────────
 * None of the above applies: the merge stays a fast-forward and this note is
 * dead weight. Delete it then.
 *
 * Cost, stated plainly so the trade is visible: cherry-picking buys production
 * a fix now and charges three `git checkout --theirs` commands at the next
 * merge. Not cherry-picking costs nothing at merge time and leaves the bug live
 * until `dev` ships.
 * ═══════════════════════════════════════════════════════════════════════════ */

export const CUSTOMER_HELPER_REPLY_TYPE = 'flex_customerhelper';

/**
 * How far back to look, counted in BOT messages.
 *
 * WHY BOUNDED — "was the card ever sent, at any point in history" made a
 * customer who was asked to register six months ago, and has chatted normally
 * ever since, qualify today. The card has to be RECENT to mean anything: it is
 * the bot's last word that the customer is walking past.
 *
 * WHY BOT MESSAGES AND NOT ALL MESSAGES — a customer who sends ten lines in a
 * row would otherwise push the card out of a window counted over everything.
 * นับเฉพาะข้อความบอท ลูกค้าพิมพ์รัวไม่ดันการ์ดหลุดกรอบ.
 *
 * Owner-set: 3. Tune here — it is the only place the number appears.
 */
export const ABANDON_BOT_LOOKBACK = 3;

/**
 * [FIX-20260822-NOTICEHARDEN] Reply-type prefixes the lookback SKIPS.
 *
 * The window above answers one question: *was this customer handed the
 * registration card?* A deposit/withdraw SCREENING card (the notice mode,
 * `flex_notice_a`…`_f`) answers a different one — *is the deposit or withdraw
 * system open right now?* — so it is not part of that conversation and must
 * not occupy a slot in it. Owner, 22/08: a screening reply is screening, and
 * screening is what gets skipped.
 *
 * WHAT GOES WRONG WITHOUT IT: customer gets the registration card, then writes
 * "เงินไม่เข้า", "ถอนไม่ได้", "เครดิตไม่ขึ้น" — three screening cards, three
 * slots — and the registration card falls out of the window. The next ordinary
 * message then finds no card in the last three rows, `abandon_trigger_at` is
 * never stamped, and the follow-up ladder never engages for a customer who is
 * demonstrably stuck. การ์ด screening เบียดการ์ดลงทะเบียนหลุดหน้าต่าง.
 *
 * ⭐ PLUGGABLE, NOT HARDCODED — three ways to change it, cheapest first:
 *   1. EDIT THE LIST below. One line, no other file, no rebuild of anything
 *      else. Empty it and the lookback query is byte-identical to what it was
 *      before this fix, which is what makes the switch provably free.
 *   2. PASS YOUR OWN at the call site: `abandonBotRowFilter(['my_prefix_'])`.
 *      The function takes the list as an argument and only falls back to the
 *      constant, so a caller can override without touching this file.
 *   3. INJECT IT PER CALL: `stampAbandonTriggerOnce` accepts
 *      `deps.skippedReplyPrefixes`, threaded straight into the query — so a
 *      different lane, an experiment or a test can run its own policy with no
 *      edit to production code at all.
 *
 * ⭐ AND IT OWNS NOTHING FROM THE NOTICE FEATURE. This is a plain string
 * prefix; `abandon-trigger` imports nothing from `notice-runtime` and never
 * will. Delete the notice mode entirely and this list simply matches nothing.
 * เสียบเปลี่ยนได้ 3 ทาง · ไม่ hardcode · ไม่ผูกกับฟีเจอร์ไหนเลย.
 */
export const ABANDON_SKIPPED_REPLY_PREFIXES: readonly string[] = [
  'flex_notice_',
];

/**
 * The extra Mongo condition for the lookback query, or `{}` when the list is
 * empty — which is exactly the pre-fix query, so switching this off is
 * provably a no-op. Kept beside the list so the two can never drift.
 */
/**
 * Is this reply type one the lookback ignores? Reads the same list the query
 * filter uses, so the two layers can never disagree. Empty list = nothing is
 * skipped = the exact pre-fix behaviour, at both layers.
 */
export function isSkippedReplyType(
  type: string,
  prefixes: readonly string[] = ABANDON_SKIPPED_REPLY_PREFIXES,
): boolean {
  return prefixes.some((p) => p && type.startsWith(p));
}

export function abandonBotRowFilter(
  prefixes: readonly string[] = ABANDON_SKIPPED_REPLY_PREFIXES,
): Record<string, unknown> {
  const list = prefixes.filter(Boolean);
  if (list.length === 0) return {};
  return {
    'metadata.auto_reply_type': {
      $not: new RegExp(
        `^(${list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
      ),
    },
  };
}

/**
 * The name a slip refusal used to carry even when a CARD is what went out.
 *
 * [FIX-20260821-SLIPHELPERMARK] `webhook.service.ts` now names that row
 * `flex_customerhelper` like every other sender, but rows written before the
 * fix keep this one and are not going to be rewritten. Owner: *"งาน cus A
 * จะต้องรองรับแบบเก่าด้วยนะ ห้ามพัง"*.
 *
 * ⚠️ THE NAME ALONE IS NOT ENOUGH TO ACCEPT IT — an OA with the card mode off
 * sends plain TEXT and its row carries this same name. What separates them is
 * that the card fields are written only inside `...(refusalCard && { … })`, so
 * `flex_doc_id` IS PRESENT AS A KEY exactly when a card went out — including
 * when its value is `null`, which is what an OA that binds no card stores.
 * มีคีย์ = การ์ดออกจริง · ไม่มีคีย์ = ข้อความล้วน.
 */
export const LEGACY_SLIP_REFUSAL_REPLY_TYPE = 'slip_require_profile_text';

/** One history row, in either shape the callers hold it. */
export interface AbandonHistoryRow {
  auto_reply_type?: unknown;
  flex_doc_id?: unknown;
  metadata?: {
    auto_reply_type?: unknown;
    flex_doc_id?: unknown;
  } | null;
}

/**
 * `auto_reply_type` is read from the TOP LEVEL and from `metadata`: it is stored
 * under `metadata` today, and the flattened form is accepted so a caller that has
 * already unwrapped a row does not silently miss.
 */
export function replyTypeOf(row: AbandonHistoryRow | null | undefined): string {
  const meta = row?.metadata ?? null;
  const raw = row?.auto_reply_type ?? meta?.auto_reply_type;
  // Only a string counts. Coercing whatever turns up would turn an object into
  // "[object Object]" and compare it happily against nothing.
  return typeof raw === 'string' ? raw : '';
}

/**
 * Is the card id on this row present at all? `null` counts as present.
 *
 * Reading the KEY rather than a value is the whole point: an OA that binds no
 * card stores `flex_doc_id: null`, and a row where no card went out has no such
 * key. Both are falsy; only one means "a card was sent".
 */
function carriesCardId(row: AbandonHistoryRow | null | undefined): boolean {
  if (!row) return false;
  if ('flex_doc_id' in row) return true;
  const meta = row.metadata;
  return !!meta && typeof meta === 'object' && 'flex_doc_id' in meta;
}

/**
 * An id as a comparable string, or `''` when there is nothing comparable.
 *
 * ⚠️ NOT `String(x)`. A lean row's id is a Mongo ObjectId — an object with a
 * real `toString` — while the value threaded from the hook may already be a
 * string. Anything ELSE that turns up (a plain object, an array) would
 * stringify to `[object Object]` and could then compare EQUAL to another such
 * value, which is the same trap `replyTypeOf` above refuses by taking strings
 * only. Accept the two shapes that exist and reject the rest.
 * ObjectId กับ string เทียบกันได้ · อย่างอื่นตัดทิ้ง ไม่ปล่อยให้กลายเป็น [object Object].
 */
function idText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (
    raw !== null &&
    typeof raw === 'object' &&
    typeof (raw as { toString?: unknown }).toString === 'function' &&
    (raw as { toString: () => string }).toString !== Object.prototype.toString
  ) {
    return (raw as { toString: () => string }).toString();
  }
  return '';
}

/** The card id on this row, as a comparable string. `''` when there is none. */
function cardIdOf(row: AbandonHistoryRow | null | undefined): string {
  return idText(row?.flex_doc_id ?? row?.metadata?.flex_doc_id);
}

/**
 * Did the bot hand this customer the registration card inside the window?
 *
 * Three ways to say yes, and each covers what the others cannot:
 *
 *  1. NAMED — `flex_customerhelper`. Every sender writes it, including the slip
 *     refusal since [FIX-20260821-SLIPHELPERMARK]. Covers every OA.
 *  2. LEGACY — the old slip-refusal name WITH the card fields beside it. Covers
 *     rows already in the database, which nobody is going to rewrite.
 *  3. BOUND ID — the row carries the id of the card THIS OA has bound. Covers a
 *     future sender that forgets to name its row — but ONLY for the OAs that
 *     bind a card at all. On the dev database that is 5 of 10; the other 5 fall
 *     back to the hard-coded card and store `flex_doc_id: null`, which is
 *     exactly why this could never be the only rule.
 *
 * ⚠️ (3) REQUIRES BOTH SIDES TO BE NON-EMPTY. `null === null` would otherwise
 * make every bot row a registration card for half the OAs — 609 rows in the dev
 * database carry no `flex_doc_id` key at all. Measured, not reasoned.
 *
 * ⚠️ `flex_doc_id` is NOT exclusive to this card: `webhook.service.ts:4755`
 * writes `flex_profile_id` into the same key. That is why (2) is tied to the
 * legacy NAME and (3) to an id MATCH, and why neither accepts "has an id".
 *
 * @param boundHelperCardId `hook.flex_customerhelper_id`, or null/undefined for
 *   an OA that binds none. Optional — callers that do not have a hook keep
 *   working on rules 1 and 2 alone.
 */
export function wasSentRegistrationCard(
  history: AbandonHistoryRow[] | null | undefined,
  boundHelperCardId?: unknown,
  /* [FIX-20260822-NOTICEHARDEN] the skip list, injectable — WITHOUT THIS THE
     DOC ABOVE WAS A LIE: a caller that passed its own prefixes to
     `stampAbandonTriggerOnce` got a QUERY filtered by its list and a RULE
     filtered by the module constant, so "one list, both layers" held only for
     callers that changed nothing. Defaulted, so every existing call is
     unchanged. ชั้นอ่านแถวต้องเปลี่ยนตามได้จริง ไม่ใช่แค่ชั้น query. */
  prefixes: readonly string[] = ABANDON_SKIPPED_REPLY_PREFIXES,
): boolean {
  const bound = idText(boundHelperCardId);

  return (history ?? []).some((row) => {
    const type = replyTypeOf(row);
    /* [FIX-20260822-NOTICEHARDEN] SCREENING ROWS ARE SKIPPED HERE TOO, not only
     * in the query — and this layer is the one that matters. Rule 3 below
     * matches on "the row carries the id of the card THIS OA has bound", and an
     * operator may legally point a screening card at the SAME flex document as
     * the registration card. Such a row would then read as "the customer was
     * asked to register" and stamp somebody who never was. Filtering only in
     * the query would leave that hole open for any caller that hands rows in
     * directly. One list, both layers. การ์ด screening ไม่ใช่การ์ดลงทะเบียน
     * ต่อให้เป็นเอกสารใบเดียวกัน. */
    if (isSkippedReplyType(type, prefixes)) return false;
    if (type === CUSTOMER_HELPER_REPLY_TYPE) return true;
    if (type === LEGACY_SLIP_REFUSAL_REPLY_TYPE && carriesCardId(row)) {
      return true;
    }
    return bound !== '' && cardIdOf(row) === bound;
  });
}

/**
 * The whole rule, in one place: the card is in the recent bot history.
 *
 * ⚠️ Deliberately says nothing about tickets, and nothing about whether the
 * customer has a profile. The old alert refused to fire for a registered
 * customer; this stamp is a record of "was asked, kept talking", and CLEARING it
 * when they finally register is a separate step the owner has not asked for yet
 * — see `clearMemberConfig`, which already exists for exactly that.
 * ยังไม่ล้างตอนลงทะเบียน · เพิ่มทีหลังได้ด้วยการเรียกตัวเดียว.
 */
export function shouldStampAbandonTrigger(
  history: AbandonHistoryRow[] | null | undefined,
  boundHelperCardId?: unknown,
  /** same injectable skip list as the layer below — one list, both layers. */
  prefixes?: readonly string[],
): boolean {
  return wasSentRegistrationCard(history, boundHelperCardId, prefixes);
}
