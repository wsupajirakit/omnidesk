/**
 * Which per-member settings exist, and what type each one holds.
 * ===========================================================================
 * `members.config` is a bag so that a new setting costs a line here instead of a
 * schema change, a migration and a deploy. The bag is the flexible part; THIS
 * FILE is the part that stops it becoming a junk drawer — a key that is not
 * listed here cannot be written, and a value of the wrong type cannot be
 * written either. ถุงยืดหยุ่นได้ แต่ต้องมีบัญชีคุม ไม่งั้นกลายเป็นที่ทิ้งของ.
 *
 * ⚠️ WHAT DOES **NOT** BELONG IN THE BAG
 *   Put it in a real column instead when it needs any of these:
 *     · uniqueness enforced by the database
 *     · a TTL / expiry index
 *     · sorting as the PRIMARY axis of a query
 *     · an array that grows without a fixed ceiling (a member document is
 *       380 bytes on average today — keep it that way)
 *   The bag is for small, bounded, per-member switches and numbers.
 *
 * ⚠️ SEARCHING BY A KEY
 *   Reading is free: load the member by `_id` / `line_user_id` as every caller
 *   already does, then read the key out of the document in hand. But
 *   `find({ 'config.x': ... })` on a path with no index is a collection scan
 *   that grows with the member count. If a screen ever needs to search by a
 *   key, add a PARTIAL index for that key at that moment — never in advance,
 *   and never for a key no code searches on.
 *
 * revert: delete this folder and the `config` Prop in `member.schema.ts`.
 *
 * 📖 THIS FILE IS THE LAW; `docs/follow-up-status-spec.md` IS THE MAP. That
 * document explains, without code, what every `follow_up` stamp means, which
 * of the four screens shows it, which questions each screen can and cannot
 * answer, and the counts taken from the live database. Send anyone who is
 * merely trying to understand the feature there first — they arrive here only
 * when they intend to change a key. อ่านภาพรวมที่นั่น · มาที่นี่ตอนจะแก้จริง.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADDING A NEW KEY — the checklist, so the bag does not become debt
 * ═══════════════════════════════════════════════════════════════════════════
 * [DOC-20260821-BAGRULES] Written down here rather than in a note, because this
 * is the file anyone adding a key already has open. Every step is enforced by
 * something real — a compiler, an assertion or a test — and each says which.
 *
 * STEP 0 — DOES IT BELONG IN THE BAG AT ALL?
 *   Re-read "WHAT DOES NOT BELONG" above. If it needs uniqueness, a TTL, sorting
 *   as the PRIMARY axis, or an unbounded array, it is a COLUMN on
 *   `member.schema.ts`, not a key here. Nothing below rescues a wrong answer to
 *   this one. ตอบข้อนี้ผิด ข้ออื่นช่วยไม่ได้.
 *
 * STEP 1 — DECLARE IT HERE, WITH THE REASON.
 *   The type is checked at runtime by `assertMemberConfigValue`, and the key by
 *   `assertMemberConfigKey` — both are called by ALL FOUR doors in
 *   `member-config.helper.ts` (`read` :55, `write` :92, `writeOnce` :117,
 *   `clear` :145), so an undeclared key cannot be written by any path. The
 *   comment is not decoration: say whether it is a FLAG (cleared when the
 *   condition ends) or a RECORD (never cleared), because that decides step 5.
 *
 * STEP 2 — GROW THE LIST IN `z-test/unit/member-config.spec.ts`.
 *   That spec pins `Object.keys(MEMBER_CONFIG_KEYS)` exactly, and its own
 *   comment says the list going red is the test doing its job. Add the key AND
 *   the reason there. คีย์งอกต้องมีเหตุผลจดไว้.
 *
 * STEP 3 — GIVE THE PATH A CONSTANT, IN THE FEATURE THAT OWNS IT.
 *   Never type the dotted string at a call site. `follow-up/follow-up.keys.ts`
 *   is the shape to copy: a file that imports NOTHING, so one part of a feature
 *   can be lifted out without dragging the rest.
 *   ONE PLACE HOLDS THE LITERAL INSTEAD, CORRECTLY:
 *   `customer-link/clear-follow-up-on-register.helper.ts` names the
 *   `abandon_trigger_at` path as a string of its own. That is not a shortcut and
 *   not a rule being broken — `customer-link/` and `webhook/follow-up/` are
 *   FORBIDDEN to import each other (folder rule 8: either must be removable
 *   without the other noticing), so importing the constant is the one thing it
 *   may not do. It still goes through this registry: `clearMemberConfig` asserts
 *   the key, so a typo there throws instead of silently clearing nothing.
 *   ⇒ A key rename is a two-place edit by design: the constant, and that
 *   literal. Grep the path, not just the constant name.
 *   ทำถูกตามกฎแล้ว ไม่ใช่ข้อยกเว้นแบบมักง่าย — แค่ต้อง grep ให้ครบตอนเปลี่ยนชื่อ.
 *
 * STEP 4 — PICK THE RIGHT WRITER. They are not interchangeable:
 *     `writeMemberConfig`     (:86)  — can be set and re-set. A switch.
 *     `writeMemberConfigOnce` (:111) — first writer wins, guard is IN THE
 *                                      FILTER, so there is no read-then-write
 *                                      window. "When did this FIRST happen".
 *
 * STEP 5 — NAME BOTH ENDS. EVERY WRITE, EVERY CLEAR, EVERY READ.
 *   ⭐ THE RULE, IN ONE LINE: a value with only one end written down is a value
 *   nobody can safely change later. เขียนค่าไว้ต้องบอกด้วยว่าใครเอาไปใช้ · ล้างค่าต้องบอกว่าล้างของใคร.
 *
 *   AT THE SOURCE (the file that writes or clears) say WHERE IT GOES:
 *     · a write must name its READERS — "who takes this". A value nobody reads
 *       is either dead weight or a reader that was deleted and nobody noticed.
 *       `request_reg_at` is the honest case: its writer says outright that
 *       NOTHING reads it and it is counted from mongosh instead.
 *     · a clear must name WHOSE key it is clearing and on WHICH ROUTE, because
 *       a flag reached by two routes needs a clearer on both.
 *   AT THE DESTINATION (the file that reads) say WHERE IT CAME FROM:
 *     · a read must name its WRITER, so "why is this always empty" is one hop
 *       away instead of a repo-wide grep.
 *   AND HERE, in the CONSUMERS block below, both directions are written once
 *   more so the whole picture is on one screen. The pointer notes at each
 *   consumer link back to it, and a test keeps the two in step.
 *
 * STEP 5b — DECIDE WHO CLEARS IT, AND SAY SO.
 *   A FLAG needs an owner for its removal or it strands: `abandon_trigger_at` is
 *   cleared in TWO places (`follow-up/clear-follow-up.helper.ts` on the webhook
 *   path and `customer-link/clear-follow-up-on-register.helper.ts` on the link
 *   path) — miss one and the customer stays marked for ever on that route.
 *   A RECORD is cleared by nothing, and that must be stated, or somebody will
 *   'tidy' it later (`request_reg_at` says so in its own comment).
 *
 * STEP 6 — INDEX ONLY WHEN SOMETHING REALLY SEARCHES BY IT, AND GET THE SHAPE
 *          RIGHT FIRST TIME.
 *   Measured on this machine, 200,000 members, throwaway collections:
 *
 *     · nested-in-the-bag vs a top-level column: IDENTICAL — 1ms/4ms/33ms at
 *       200/2,000/20,000 flagged, same key counts, same index size. Path depth
 *       costs nothing. ความลึกของ path ไม่มีผล.
 *     · TOTAL member count is irrelevant; the FLAGGED count is everything:
 *       2,000 flagged answered in 3ms whether the collection held 50,000,
 *       200,000 or 500,000 rows (index stayed 40KB). At 200,000 members:
 *       500 flagged 1ms · 5,000 6ms · 50,000 60ms · 200,000 237ms.
 *     · A COMPOUND index `{ 'config.<path>': 1, line_user_id: 1 }` lets a job
 *       that only wants ids read them out of the index — `PROJECTION_COVERED`,
 *       ZERO documents fetched (22ms vs 33ms, 20,000 docs vs 0).
 *     · ⚠️ `$exists` IN THE QUERY DESTROYS THAT. `{path: {$exists: true, $lte: d}}`
 *       plans as `FETCH → IXSCAN` and reads every document; `{path: {$lte: d}}`
 *       plans as `PROJECTION_COVERED → IXSCAN` and reads none. A stored date
 *       already means "set", so asking again costs the whole optimisation.
 *       `$exists` belongs in `partialFilterExpression` — that decides who the
 *       index HOLDS — and nowhere near the query. ใส่ $exists ใน query = เสีย covered.
 *
 *   The two indexes that exist today are single-field on purpose: they answer
 *   "who is stuck, longest first", which needs the document anyway. A key meant
 *   for a broadcast that only needs `line_user_id` should be compound from the
 *   start — adding the second field later means rebuilding the index.
 *
 * STEP 7 — SEAMLESS, AND HOW EACH PART IS ENFORCED:
 *     · rows without the key read as absent — `readMemberConfig` invents no
 *       default and treats a WRONG-TYPED value as absent rather than trusting
 *       it (spec :78, :98);
 *     · writes are one dot-path leaf, so another feature's sibling key survives
 *       (spec :118);
 *     · `config` must keep NO schema default, or an upsert's insert half writes
 *       an empty bag onto every new row (spec :210);
 *     · nothing outside `chat/config` may touch `member.config` (spec :225).
 *       ⚠️ That check reads a HARD-CODED list of five files. A NEW file that
 *       writes `'config.…'` directly would not be seen by it. Verified
 *       2026-08-21 by scanning all of `src/`: nobody bypasses the door today.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NAMING A NEW VALUE OR KEY — USE AN UNDERSCORE. COUNTED, NOT PREFERRED.
 * ═══════════════════════════════════════════════════════════════════════════
 * Applies to every stored string in this repo, not only to this bag: keys in
 * here, values in a `… as const` list, statuses, reasons, source names.
 *
 *     underscore: 260 values      hyphen: 0 values      (scan of src/, 2026-08-21)
 *
 * This is not a style preference, it is what the code already assumes. Reading
 * a value list back out of source with a regular expression is a HABIT here,
 * and the class those expressions use is `[a-z_]`:
 *   · `omnidesk-console/test/registrationSource.value.test.ts` (cross-repo
 *      guard over `REGISTERED_BY`)
 *   · `z-test/unit/webhook-log-emitter.spec.ts:146` (status values)
 *   · `z-test/unit/log-ticket-slim.spec.ts:155` (field names)
 * A hyphenated name simply does not match. It is not an error — the value
 * disappears from the list and the check goes on passing over the shorter one.
 *
 * ⚠️ THIS ALREADY HAPPENED, ON 2026-08-21. `semi-admin` was added to
 * `REGISTERED_BY` (`customer-link/registration-stamp.helper.ts`) and the
 * cross-repo guard kept reporting green while reading FIVE values out of a list
 * of SIX — proven by running both expressions side by side, not deduced. The
 * value was renamed to `semi_admin` and the guard's class widened to `[a-z_-]`
 * anyway, so the next person who does reach for a hyphen is caught rather than
 * silently unchecked.
 *
 * If a name really must carry a hyphen, grep `[a-z_]` across BOTH repos FIRST
 * and widen every expression that would read it. Otherwise: underscore.
 * ตั้งชื่อค่าใหม่ = ขีดล่างเสมอ · ขีดกลางทำให้ตัวกันหลุดแบบไม่มี error ให้เห็น.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH KEYS HAVE AN INDEX, WHO ADDED IT, AND WHEN
 * ═══════════════════════════════════════════════════════════════════════════
 * Every index below lives in `src/modules/chat/schemas/member.schema.ts`, not
 * here — this is the ledger, that file is the declaration. Checked against the
 * running database 2026-08-21.
 *
 *   `config.follow_up.line.abandon_trigger_at_1`
 *     added   2026-08-20 · commit fb20820 · tag [FEAT-20260820-ABANDONTRIGGER]
 *     shape   single field, PARTIAL on `$exists`
 *     for     "who is stuck, longest first" — the screen reads the documents
 *             anyway, so a covered read would buy nothing
 *     live    24 KB
 *
 *   `config.follow_up.line.request_reg_at_1`
 *     added   2026-08-20 · commit 42d036f · tag [FEAT-20260820-REQUESTREG]
 *     shape   single field, PARTIAL on `$exists`
 *     for     `countDocuments` — "how many people came through"
 *     live    24 KB
 *
 *   `config.follow_up.line.notice_deposit_at_1`
 *     added   2026-08-22 · commit fcf45d1 · tag [FEAT-20260822-NOTICERUNTIME]
 *     shape   single field, PARTIAL on `$exists`
 *     for     owner's standing order ("member > follow up ทุกอย่างข้างในทำ index
 *             ไว้เผื่อเลย") + future "who was noticed lately" sweeps
 *     live    0 KB (new — nothing stamps it until the runtime R3 wiring)
 *
 *   `config.follow_up.line.notice_withdraw_at_1`
 *     added   2026-08-22 · commit fcf45d1 · tag [FEAT-20260822-NOTICERUNTIME]
 *     shape   single field, PARTIAL on `$exists`
 *     for     same as above
 *     live    0 KB (new)
 *
 *   `config.follow_up.line.notice_payment_at_1`
 *     added   2026-08-22 · commit fcf45d1 · tag [FEAT-20260822-NOTICERUNTIME]
 *     shape   single field, PARTIAL on `$exists`
 *     for     same as above
 *     live    0 KB (new)
 *
 *   `config.follow_up.line.customer_helper_trigger_at_1`
 *     added   2026-08-25 · tag [FEAT-20260825-HELPERTRIGGER]
 *     shape   single field, PARTIAL on `$exists`
 *     for     the broadcast audience source `follow_up.customer_helper_at`,
 *             and the owner's standing order that everything inside
 *             member > follow up carries an index
 *     live    0 KB (new — nothing carries the key until the first offer goes out)
 *     ⚠️ Single-field because the question needs the document anyway. A job that
 *        only wants `line_user_id` would need a COMPOUND index from day one —
 *        see the warning below.
 *
 *   `raw_profile_cleared_at_1`   ⚠️ NOT a `config` key — a TOP-LEVEL column
 *     added   2026-08-25 · tag [FEAT-20260825-CLEAREDAT]
 *     shape   single field, PARTIAL on `$exists`
 *     for     "who has had their profile wiped, and when?" — written only by
 *             the developer-only remove button (`chat/members.service.ts` →
 *             `clearRawProfile`), so the indexed population is expected to stay
 *             near zero and the index costs almost nothing to keep
 *     live    0 KB (new — no row carries the field yet)
 *     ⚠️ listed here even though it is not in the `config` bag, because this
 *        block is where anyone looks to find out which member indexes exist and
 *        who added them. An index nobody can attribute is one nobody dares drop.
 *     ⚠️ IT SERVES ONE DIRECTION ONLY. "Who WAS cleared" uses it. "Who has
 *        NEVER been cleared" is `$exists: false` / `: null`, which no index can
 *        serve — measured 25/08/2026, `explain()` on the equivalent query
 *        reported COLLSCAN with docsExamined equal to the whole collection.
 *        That is a property of the question, not of this index; do not add a
 *        second index hoping to fix it, and do not give the column a default
 *        in the hope that it helps (it would only make this index cover every
 *        document instead of the few that matter).
 *
 *   No other key is indexed, and that is deliberate: an index for a key nothing
 *   searches on costs writes and buys nothing (see the SEARCHING note above).
 *
 * ⚠️ A NEW KEY MEANT FOR A BROADCAST SHOULD NOT COPY THESE TWO. They are
 * single-field because their questions need the document. A job that only wants
 * `line_user_id` should be COMPOUND from the first day — see STEP 6's measured
 * numbers. Adding the second field later means rebuilding the index.
 * ⚠️ ADDING AN INDEX = ADDING AN ENTRY HERE, with who and when. An index nobody
 * can attribute is one nobody dares drop. เพิ่ม index ต้องจดว่าใครเพิ่ม เพิ่มเมื่อไหร่ เพื่ออะไร.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHO USES THE BAG TODAY — 6 keys, 10 files that go through the door, and FOUR
 * consumers that do not. Re-counted 2026-08-29 (`members.service.ts` joined that
 * day as the first HUMAN-driven writer of the notice stamps — see its entry).
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ THIS HEADING USED TO END "FE: none", AND IT HAD BEEN FALSE SINCE 24/08.
 * The drift was found while writing `docs/follow-up-status-spec.md` and is
 * corrected here rather than left as a footnote. Nothing caught it because
 * `member-config-consumers.spec.ts` can only see files that IMPORT the door,
 * and not one of the four below does:
 *
 *   QUERY-ONLY, in this repo
 *     · the tickets insight aggregation — reads `request_reg_at` with `$type`
 *       inside a `$group` (named in that key's entry below)
 *     · the broadcast audience filter — turns six `follow_up.*` sources into
 *       plain Mongo paths (`content/audience/sources/audience-filter.ts`)
 *   FE, in `omnidesk-console`
 *     · `components/contact/ContactHeaderInfo.tsx` — `notice_deposit_at` and
 *       `notice_withdraw_at`, raw, on the contact header
 *     · `components/member/follow-up/followStamps.ts` — those same two as
 *       always-visible rows, PLUS `abandon_trigger_at`, `request_reg_at` and
 *       `customer_helper_trigger_at` as three CONDITIONAL alert rows, each
 *       gated on `raw_profile_data` being empty
 *   ⇒ 5 of the 6 keys are on an admin's screen today. Only `notice_payment_at`
 *     is not: its old label read as "slip follow-up", which was wrong about
 *     what the card actually means, so the row was hidden rather than renamed.
 * ⇒ A CONSUMER A MACHINE CANNOT SEE IS ONE ONLY THIS LIST CAN PROTECT. Name
 *   every future query-only or FE reader here BY HAND, the moment it ships.
 *   ตัวกันหลุดมองไม่เห็นคนพวกนี้ · บัญชีนี้คือสิ่งเดียวที่กันได้.
 *
 * Full paths on purpose, so this can be pasted into a `grep` without guessing.
 *
 * Each entry names BOTH ENDS on purpose (step 5): a writer without its readers,
 * or a reader without its writer, is half a fact.
 *
 * `follow_up.line.abandon_trigger_at`  — FLAG (cleared when the condition ends)
 *   write  `src/modules/webhook/follow-up/abandon-trigger.helper.ts`
 *          via writeMemberConfigOnce — first stamp wins
 *   read   `src/modules/webhook/follow-up/follow-up.gate.ts`
 *          its presence IS level 2's entire condition
 *   clear  `src/modules/webhook/follow-up/clear-follow-up.helper.ts`
 *          the WEBHOOK path, when the customer turns out to have a profile
 *   write  `src/modules/content/broadcast-follow-up/stamp-abandon-on-multicast.ts`
 *          [FEAT-20260825-MCASTABANDON] a SECOND writer, added 25/08. A multicast
 *          whose audience filter is "was shown the register card and still has
 *          not registered", and which does NOT open cases itself, arms this flag
 *          for everyone it reached — so a customer who replies is handed to the
 *          register scenario the same way the webhook path hands one over.
 *          🔴 CONSEQUENCE, because this flag is read for a decision and not for
 *          counting: the armed customer's NEXT inbound message opens a case and
 *          ends the flow, whatever that message is (`scenario-a.ts` declares
 *          `endsFlow: true` unconditionally since [FEAT-20260820-AALWAYSENDS]).
 *          Reaching N people therefore queues a case for every one of them who
 *          answers at all. That is the intent; it is also why the trigger is
 *          scoped to one audience filter and one unticked checkbox.
 *          Uses `writeMemberConfigOnce` like the writer above, so "since when"
 *          survives a second campaign round.
 *   clear  `src/modules/customer-link/clear-follow-up-on-register.helper.ts`
 *          the CUSTOMER-LINK path, when they register through the link
 *          ⚠️ TWO CLEARERS IS NOT DUPLICATION — they are different routes into
 *          the same outcome, and a customer can arrive by either. Remove one
 *          and that route strands the flag for ever. ลบตัวใดตัวหนึ่ง = เส้นนั้นค้าง.
 *   clear  `src/modules/tickets/tickets.service.ts`
 *          ⚠️ SINCE 31/08 THERE ARE TWO ROUTES THROUGH THIS FILE, and they are
 *          not the same one: `clear_follow_up` (26/08, below) and
 *          `patch_after_close` with `registration: 'stop'`
 *          ([FIX-20260831-STOPCLEARSSTAMPS], `REGISTRATION_CLEARED_KEYS` in
 *          `patch-after-close.helper.ts`). The dialog drives the SECOND one; the
 *          first is kept working for older clients. The second also raises the
 *          member's ignore-abandon COLUMN (a real column, deliberately not named
 *          here: `ignore-abandon-assist.spec.ts` asserts this registry never
 *          mentions it, because a column must not look like a bag entry) and
 *          also clears `customer_helper_trigger_at` — see that key.
 *          [FEAT-20260826-CLOSECLEARFU] a THIRD clearer, added 26/08, and the
 *          only one a HUMAN drives: the admin ticks "ไม่ต้องติดตามการสมัคร
 *          ลูกค้านี้อีก" in the close-case confirm. The other two fire because
 *          the customer registered; this one fires because an admin judged the
 *          customer does not want to. Decision logic and its boundaries live in
 *          close-case-follow-up.helper.ts, beside that service.
 *          ⚠️ It only fires when the member carries BOTH this flag AND
 *          `request_reg_at`, and it clears the pair together — see that key.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 [DOC-20260825-REGSTATUS] A STAMP IS NOT A STATUS. READ THIS BEFORE USING
 *    ANY `follow_up` KEY TO ANSWER "HAS THIS CUSTOMER REGISTERED?"
 * ═══════════════════════════════════════════════════════════════════════════
 * Owner, 25/08/2026: *"config.follow_up.line.request_reg_at จะตรงไม่ถูก
 * เคลียร์ ไม่ว่าจุดใด · ถ้าเช็คว่าลงทะเบียนไปแล้วรึยัง ให้เช็คเพิ่มจาก
 * raw profile data"* — and the same warning is now written at every consumer.
 *
 * THE RULE, IN ONE LINE:
 *   registration status is answered by `members.raw_profile_data`, NEVER by a
 *   `follow_up` stamp.
 *
 * WHY THIS IS EASY TO GET WRONG. FIVE OF THE SIX keys in this bag are RECORDS,
 * not FLAGS — the census read "four of five" until `customer_helper_trigger_at`
 * landed on 25/08, and it will keep moving, so count the entries below rather
 * than trusting the number in this sentence. A RECORD answers "did this ever
 * happen?" and NOTHING THE CUSTOMER DOES removes it.
 * ⚠️ "Never removed" is not the same as "has no clearer". Since 24/08 a
 * successful MULTICAST clears `notice_deposit_at` and `notice_withdraw_at` for
 * the members it reached. That does not promote them to FLAGS and does not
 * rescue them for this question: the trigger is an outgoing campaign, never the
 * customer registering, so their absence still means "never notified, OR
 * notified and since told otherwise". มีคนล้าง ≠ เป็นธง.
 * `request_reg_at` in particular is deliberately kept even when the customer
 * unlinks (verified 2026-08-21 by walking every route that can remove a key).
 * So a customer who was chased in June, registered in July, and unlinked in
 * August STILL carries `request_reg_at`. Reading it as "has not registered"
 * gives an answer that looks entirely reasonable and is wrong, with no error,
 * no exception, and nothing in any log to trace. The only symptom is a human
 * being chased for something they already did.
 *
 * THE ONE EXCEPTION, AND WHY IT IS STILL NOT ENOUGH ON ITS OWN.
 * `abandon_trigger_at` IS a FLAG: two clearers remove it the moment the
 * customer registers (webhook route + customer-link route), so its presence
 * does mean "still stuck" — TODAY. It depends on both clearers firing. Pair it
 * with the profile check anyway: the extra read is one property access, and
 * the failure it prevents is telling an admin that a registered customer never
 * registered. `omnidesk-console/components/member/follow-up/followStamps.ts`
 * (`showAbandonAlert`) is the reference implementation of that pairing.
 *
 * WHAT "HAS A PROFILE" MEANS, PRECISELY — an empty object is NOT a profile:
 *
 *     const raw = member.raw_profile_data;
 *     const registered =
 *       !!raw && typeof raw === 'object' && Object.keys(raw).length > 0;
 *
 * `raw_profile_data` is `$unset` on unlink (`customer-link.service.ts`) and on
 * the admin clear (`chat/members.service.ts`), so it tracks the CURRENT state —
 * which is exactly what makes it the right column and the stamps the wrong ones.
 *
 * ⚠️ AUDIENCE FILTERS INHERIT THIS TRAP. The six `follow_up.*` sources in
 * `content/audience/sources/audience-source.registry.ts` filter on these same
 * paths. Five of them select "was ever X", not "is still X". Targeting a
 * register-me campaign at `follow_up.request_reg_at` will therefore include
 * people who registered long ago. Use `follow_up.abandon_at` for that campaign
 * — it is the FLAG — and see the note beside those sources.
 * ⇒ SINCE 25/08 THE FILTER DEFENDS ITSELF, PARTLY.
 *   `content/audience/sources/force-no-profile.policy.ts` ANDs
 *   `{raw_profile_data: null}` onto ANY job whose rules mention
 *   `follow_up.abandon_at`, `follow_up.request_reg_at` or
 *   `follow_up.customer_helper_at`, so those three campaigns now carry the
 *   profile check whether the admin thought of it or not. It is one boolean
 *   wide: switch `FORCE_NO_PROFILE_ENABLED` off and every one of those
 *   campaigns silently starts reaching registered customers again, with the
 *   labels still promising it does not. And it closes only HALF the question —
 *   read PART 2.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 [DOC-20260825-REGSTATUS] PART 2 — THE HOLE A PROFILE CHECK STILL LEAVES,
 *    AND THE ONE CONDITION THAT CLOSES IT. ⚠️ NOT WIRED TODAY.
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything above says: stop reading stamps, read `raw_profile_data`. That is
 * right, and it is still not sufficient, because `raw_profile_data` can be
 * taken away from a customer who genuinely DID register.
 *
 * HOW A REGISTERED CUSTOMER COMES TO LOOK UNREGISTERED
 *   An admin presses the developer-only remove button, which reaches
 *   `chat/members.service.ts` → `clearRawProfile`. ONE atomic `updateOne` does
 *   two things: `$unset` of `raw_profile_data`, and `$set` of the TOP-LEVEL
 *   column `raw_profile_cleared_at` (ledger entry above; it is not a bag key).
 *   From that instant the customer is indistinguishable — to every "has no
 *   profile" test in this codebase, FE and BE alike — from somebody who never
 *   registered at all.
 *   ⇒ A campaign aimed at "people who were shown the register card and still
 *     have not registered" reaches them AGAIN, asking them to do something
 *     they already did. Same failure class as reading a RECORD as a status:
 *     plausible count, successful send, every log line green, and the only
 *     party who notices is the customer.
 *
 * THE CLOSING CONDITION — one clause, and it is cheap to state
 *   For that class of campaign, require the profile to be absent AND never to
 *   have been wiped:
 *
 *       { raw_profile_data: null, raw_profile_cleared_at: null }
 *
 *   In MongoDB `{field: null}` matches BOTH a missing field and an explicit
 *   null, so the second half reads exactly as "was never wiped" without asking
 *   for `$exists`. That is not a stylistic preference: `$exists` IS BANNED in
 *   this subsystem's queries — `content/audience/sources/audience-filter.ts`
 *   states the promise at the top of the file and a spec asserts it, and STEP 6
 *   above carries the measurement it rests on (it turns PROJECTION_COVERED into
 *   FETCH and reads every document). The null form is the one to use.
 *   ⇒ IN WORDS: "this customer has no profile BECAUSE THEY NEVER REGISTERED,
 *     not because somebody wiped it."
 *
 * 🔴 IT IS NOT WIRED, AND THIS SENTENCE IS HERE SO NOBODY ASSUMES IT IS.
 *   `force-no-profile.policy.ts` forces ONLY `{raw_profile_data: null}` today.
 *   `raw_profile_cleared_at` is written, is indexed, and is offered as a
 *   selectable audience source — but nothing pairs the two automatically.
 *
 * WHERE IT WOULD GO, AND WHAT IT WOULD COST
 *   · ONE PLACE: `NO_PROFILE_CLAUSE` in that policy file — a second key in the
 *     object. Nothing else changes: `audience-filter.ts` only ANDs whatever
 *     the policy hands back, and the FE never learns the clause exists.
 *   · QUERY COST: nothing worth measuring. That clause is already a COLLSCAN
 *     on its own (measured 25/08) and is only ever ANDed onto an INDEXED
 *     `follow_up` rule, so the planner still drives from the indexed side and
 *     applies this afterwards. A second null test on an already-fetched
 *     document adds no new scan.
 *   · AUDIENCE COST: campaigns shrink by exactly the number of wiped members.
 *     That population is near zero today because the route is developer-only —
 *     which is both why leaving it unwired has been survivable and why turning
 *     it on is close to free.
 *   · THE COST WORTH ARGUING ABOUT — MEANING. A customer can be wiped and then
 *     register again; `raw_profile_cleared_at` is not cleared by that, so it
 *     becomes stale history. If such a customer later unlinks, they are
 *     genuinely unregistered and the strict clause would still exclude them.
 *     Pick the error you prefer for the campaign in hand: chasing somebody who
 *     already registered, or missing somebody who registered, was wiped, and
 *     drifted back out. No single column answers both, and inventing one that
 *     tries would be a third thing to keep in sync.
 *   · AVAILABLE TODAY WITHOUT SHIPPING ANYTHING: an admin gets the strict
 *     meaning per campaign by adding a SECOND rule — the
 *     `raw_profile_cleared_at` source with the `no_value` operator — beside the
 *     follow-up rule. It works now; it simply has to be remembered every single
 *     time, which is the whole argument for wiring it instead.
 *
 * `follow_up.line.customer_helper_trigger_at` — ROLLING RECORD (overwritten;
 *   cleared ONLY by the admin's own hand, since 31/08)
 *   write  `src/modules/webhook/follow-up/customer-helper-trigger.helper.ts`
 *          via writeMemberConfig — the OVERWRITING door, on purpose
 *   clear  `src/modules/tickets/tickets.service.ts`
 *          [FIX-20260831-STOPCLEARSSTAMPS] the FIRST clearer this key has ever
 *          had, and the only one a HUMAN drives: the admin ticks *"ไม่ต้อง
 *          ติดตามการสมัครลูกค้านี้อีก"* in the close-case confirm. The plan is
 *          built by `tickets/patch-after-close.helper.ts`
 *          (`REGISTRATION_CLEARED_KEYS`) and fires only for a member carrying
 *          BOTH registration stamps; this key is added to the plan only when it
 *          is actually present.
 *          ⚠️ Owner, 31/08, reversing the 27/08 decision: *"แอดมินตั้งใจกด มันคือ
 *          การตั้งใจเคลียร์"* — and on the cost, *"หลุดจาก audience ไม่เป็นไร"*.
 *          The broadcast filter below therefore stops matching that member: it
 *          is a consequence that was weighed, not an oversight.
 *   rule   the single editable predicate that decides WHEN lives beside that
 *          writer, in customer-helper-trigger.rule.ts (same folder).
 *          ⚠️ Its path is deliberately NOT written in the backticked src/ form
 *          here, for the same reason the aggregation reader below is not: the
 *          machine-read list above means "files that import the bag door", and
 *          that file imports nothing at all — it is pure, by design. Backticking
 *          it would fail the door-import check while proving nothing.
 *   read   NOBODY in `src/`. Exposed to broadcast targeting as the audience
 *          source `follow_up.customer_helper_at`
 *          (`content/audience/sources/audience-source.registry.ts`), which
 *          reaches it by QUERY and never through this door — so the door guards
 *          are blind to that use, exactly as they are for `request_reg_at`.
 *          ⚠️ CONSEQUENCE: renaming or reshaping this key breaks that filter
 *          SILENTLY. Before touching it, grep the DOTTED STRING
 *          `follow_up.line.customer_helper_trigger_at` across BOTH repos.
 *          ⚠️ SUCH A CAMPAIGN DOES NOT RUN THE FILTER THE ADMIN PICKED:
 *          `content/audience/sources/force-no-profile.policy.ts` ANDs
 *          `{raw_profile_data: null}` onto any job naming that source, because
 *          this key survives registration. PART 2 above explains the wipe that
 *          even the forced clause cannot see.
 *   shown  `omnidesk-console/components/member/follow-up/followStamps.ts` —
 *          the follow-up card's THIRD conditional alert row
 *          (`CUSTOMER_HELPER_ROW`), rendered only while `raw_profile_data` is
 *          empty. The FE closes the RECORD trap on the DISPLAY side the same
 *          way the policy closes it on the QUERY side, and the two must not
 *          drift: the row's Thai wording is pinned character-for-character
 *          against the audience source's `label_th` by a cross-repo test,
 *          because ONE admin reads both screens and two wordings read as two
 *          different conditions.
 *          ⚠️ An FE consumer, so no guard in this repo can see it either — it
 *          is named here by hand, like the query-only readers.
 *   clear  NOBODY, by design — owner: *"ไม่มีเคลียร์ เก็บไว้"*.
 *
 * `follow_up.line.request_reg_at`      — RECORD (nothing ever clears it)
 *   write  `src/modules/webhook/gates/follow-up-flow.ts`
 *          via writeMemberConfigOnce — the FIRST time is the answer
 *          ⚠️ MOVED 2026-09-05 [PROG-20260905-G23]. It used to be
 *          `webhook/webhook.service.ts`; the spine reduction program lifted the
 *          follow-up flow into its own file and the write went with it. Nothing
 *          about the key, the helper or the first-writer-wins rule changed.
 *          The move was caught by `member-config-consumers.spec.ts` — but only
 *          three save points later, because that spec was not in the gate set
 *          of the save point that moved the code. WHEN A WRITER MOVES, THIS
 *          LINE MOVES IN THE SAME COMMIT. ย้ายโค้ดแล้วต้องแก้บัญชีทันที
 *   read   NOBODY through the door — but NOT nobody at all. Corrected
 *          2026-08-22 (owner: "อัพเดทตัวกลางให้รู้ด้วย"): the tickets module
 *          reads this key inside a RAW AGGREGATION —
 *          insight-registrations.service.ts:217 (tickets module), as
 *          { $type: '$config.follow_up.line.request_reg_at' } in a $group.
 *          That path never calls readMemberConfig, so BOTH door guards are
 *          blind to it (the consumers spec greps for door calls; the deny
 *          list names five files by hand). Its path is deliberately NOT
 *          written in the backticked src/ form here: the machine-read list
 *          above is "files that import the door", and this reader does not —
 *          backticking it would fail the door-import check while proving
 *          nothing. ⚠️ CONSEQUENCE: renaming this key, moving it, or changing
 *          its shape breaks that aggregation SILENTLY — before touching it,
 *          grep the DOTTED STRING `follow_up.line.request_reg_at` across
 *          src/, never only the constant. The same blindness applies to any
 *          future key read by aggregation — name such readers here BY HAND.
 *          It is also counted from mongosh with `countDocuments`; the exact
 *          command is in `member.schema.ts` beside its index.
 *   clear  NOBODY, AND THAT IS THE DESIGN — not an omission, not "not yet".
 *          Verified 2026-08-21 by walking every route that can remove a key:
 *            · `clearMemberConfig` is the ONLY function in the codebase that
 *              removes a config leaf, and it has exactly two callers —
 *              `webhook/follow-up/clear-follow-up.helper.ts` and
 *              `customer-link/clear-follow-up-on-register.helper.ts`. BOTH list
 *              `abandon_trigger_at` and nothing else.
 *            · every other `$unset` in `src/` names top-level columns, never the
 *              `config` bag: `chat/members.service.ts` (raw_profile_data) and
 *              `customer-link/customer-link.service.ts` (the unlink, which drops
 *              the profile and the link stamp). ⇒ EVEN UNLINKING KEEPS THIS KEY.
 *          ⚠️ IF YOU ARE ABOUT TO ADD IT TO A CLEAR LIST, DON'T. The whole point
 *          is that it answers "was this customer ever asked", which must survive
 *          the registration that ends the asking — remove it on register and the
 *          count it exists to serve silently loses everyone who succeeded, which
 *          is precisely the population worth counting.
 *          Owner: "request_reg_at = ห้ามเคลียร์ห้ามยุ่ง คงค่าเดิม".
 *          Pinned from both sides, so this cannot drift quietly:
 *            `z-test/unit/clear-follow-up-on-register.spec.ts:40` — the key is
 *              absent from the declared list AND from the actual call payload
 *            `z-test/unit/customer-link-reg-source.spec.ts:291` — the unlink
 *              payload must not mention it either
 *          ⚠️ ITS LIFETIME IS THE OPPOSITE OF THE KEY ABOVE, on purpose. A FLAG
 *          says "stuck right now" and needs an owner for its removal. A RECORD
 *          says "this happened" and needs nobody. Mixing the two up is how a
 *          count quietly becomes a snapshot. ธงต้องมีคนล้าง · บันทึกห้ามมีคนล้าง.
 *
 * `follow_up.line.notice_deposit_at` / `…notice_withdraw_at` / `…notice_payment_at`
 *      — ROLLING RECORD (overwritten per notice; aging IS the reset)
 *   write  `src/modules/webhook/notice-runtime/notice-guard.helper.ts`
 *          via writeMemberConfig, AFTER a successful card send — the stamp
 *          must MOVE per notice or the cooldown blocks for ever
 *   read   the same file, same run — noticeCooldownBlocks compares the
 *          stamp's age against NOTICE_COOLDOWN_MINUTES before a new card may
 *          fire. One file holds both ends of these keys on purpose.
 *          ⚠️ 22/08 — THE READ IS INERT IN PRODUCTION: the guard passes
 *          NOTICE_COOLDOWN_ENABLED (notice-runtime/notice-policy.ts), which
 *          ships `false`, so the stamp is read and never blocks. The WRITE is
 *          unchanged and unconditional, which is precisely what keeps bringing
 *          the cooldown back a one-line change. อ่านอยู่ แต่ไม่บล็อกแล้ว.
 *   read   ALSO `src/modules/chat/chat.service.ts` (listContacts) since
 *          23/08 — tag [FEAT-20260823-CONTACTFOLLOW]: the contacts listing
 *          filters members by the deposit/withdraw stamps (`?follow=`), through
 *          `memberConfigPath` + the notice runtime's own key constants. A pure
 *          `$exists` read on the partial indexes above; writes nothing.
 *          และ FE โชว์ค่าดิบของสองตัวแรกบน header หน้า contact
 *          (`ContactHeaderInfo.tsx`, [FEAT-20260823-FOLLOWSTAMP]) — เสิร์ฟผ่าน
 *          `$lookup` ของ listContacts ที่ส่ง member ทั้งก้อนอยู่แล้ว.
 *          ⭐ ผู้อ่านฝั่ง FE ตัวที่ 2 ตั้งแต่ 24/08 — การ์ด "การติดตาม" ในแท็บ
 *          ดำเนินการ (`components/member/follow-up/followStamps.ts`,
 *          [FEAT-20260824-FOLLOWUP]) แสดง **สองตัวนี้เท่านั้น** (ไม่แสดง
 *          `notice_payment_at` — ป้ายเดิมสื่อผิดว่าเป็น "ติดตามสลิป" ทั้งที่คือ
 *          การ์ด ALL OFF-TIME/ALL DISABLE เจ้าของสั่งซ่อน)
 *          ⚠️ สองงานนี้มาคนละ lane วันเดียวกัน ⇒ **หลัง multicast ที่ล้าง stamp
 *          การ์ดจะกลายเป็น n/a ทันที** ซึ่งถูกต้องตามความหมาย (เลิกบอกว่าธนาคารเสีย
 *          แล้ว = ไม่เคยบอก) แต่ตัวนับบนหัวการ์ดจะลดลงเองโดยไม่มีใครไปกด.
 *   write  `src/modules/chat/members.service.ts`
 *          [FEAT-20260829-MANUALFOLLOWSTAMP] a SECOND writer, added 29/08, and the
 *          only one a HUMAN drives: `setFollowUpStamp`, behind
 *          `PATCH api/{line,channel}-users/:id/follow-up-stamp`, writes ONE of
 *          `notice_deposit_at` / `notice_withdraw_at` with `writeMemberConfig`
 *          when an admin presses the `n/a` row on the customer panel.
 *          🔴 IT ONLY WRITES AN EMPTY ONE. Unlike the notice runtime above, which
 *          MUST move the stamp per card, this writer REFUSES a stamp that already
 *          has a value — the runtime's meaning of the key ("we last told them at
 *          T") is a record other screens report on, and a human press must not
 *          rewrite it. The rules live beside the service in
 *          `member-follow-stamp.helper.ts` (same folder as members.service.ts —
 *          not listed as a consumer here because it never calls the door: it
 *          reads the value straight off the lean member document).
 *          🔴 `kind` IS AN ALLOW-LIST OF TWO, never a key off the wire — so
 *          `notice_payment_at` is unreachable from this route even though it is
 *          in the same family. เจ้าของสั่งไว้สองตัวเท่านั้น.
 *          Every press leaves an audit row (`parent: 'line_user'`), which is the
 *          only thing that later tells a manual stamp from a runtime one.
 *   clear  `src/modules/content/broadcast-follow-up/clear-notice-on-multicast.ts`
 *          since 24/08 — tag [FEAT-20260824-BCASTCLEARNOTICE]. Clears
 *          `notice_deposit_at` and `notice_withdraw_at` (NOT `notice_payment_at`)
 *          for every member a MULTICAST actually reached, via
 *          `clearMemberConfigMany`, in the post-run block of
 *          `broadcast-run/new-send.service.ts` beside the transcript write.
 *          WHY IT IS CORRECT rather than a contradiction: the stamp is written
 *          when the BANK HAS A PROBLEM (notice-runtime cases A-D: deposit/
 *          withdraw off-time or disabled), so it means "we already told them
 *          the bank is broken". A campaign that goes out to say the bank is
 *          working again ends the reason for the stamp, and a NEW bank problem
 *          re-stamps it through the normal path — the loop closes itself.
 *          Owner 24/08: *"ถ้ามันติดค่า notice มาเพราะแบงค์มีปัญหาใหม่ไง …
 *          เราจะยิงช่วยที่แบงค์ปกติไง … เพราะมันเคลียร์ค่านะถูกแล้ว"*.
 *          ⚠️ ONLY MEMBERS LINE ACCEPTED — a chunk that failed reached nobody,
 *          and those people have not been told, so their stamp must survive.
 *          ⚠️ MULTICAST ONLY. `/message/broadcast` carries no recipient list, so
 *          there is nobody it could truthfully clear.
 *          ⚠️ CONSEQUENCE FOR THE COOLDOWN, stated rather than discovered later:
 *          `notice-guard.helper.ts` reads these stamps for
 *          NOTICE_COOLDOWN_MINUTES. Clearing resets that window, so once
 *          NOTICE_COOLDOWN_ENABLED is switched on a member could receive a
 *          notice card again right after a campaign. That is the owner's
 *          intent — a new bank problem SHOULD notify again.
 *          ⚠️ CONSEQUENCE FOR THE CONTACTS SCREEN: `chat.service.ts`
 *          (listContacts `?follow=`) filters on `$exists` of these stamps, and
 *          `ContactHeaderInfo.tsx` renders them, so a cleared member drops out
 *          of that filter and shows a blank stamp. Also intended.
 *          ── HISTORY ── until 24/08 this line read "clear NOBODY, AND THAT IS
 *          THE DESIGN — age makes an old stamp inert". That was the state, not
 *          a prohibition; the owner decided on 24/08 that clearing is correct
 *          and asked for it to be declared here.
 *          (Declared 2026-08-22 ahead of the wiring; the writer landed the
 *          same day — tag [FEAT-20260822-NOTICERUNTIME], plan
 *          todo/task/22082026/todo6_22082026_notice-runtime-plan.md.)
 *   clear#2 `src/modules/tickets/tickets.service.ts` — tag
 *          [FEAT-20260827-PATCHAFTERCLOSE], since 27/08. Clears
 *          `notice_deposit_at` and/or `notice_withdraw_at` (NEVER
 *          `notice_payment_at`) for ONE member, via `clearMemberConfig`, when an
 *          ADMIN ticks "ไม่ติดตาม" for that topic in the close-case confirm.
 *          The decision is `tickets/patch-after-close.helper.ts`.
 *          ⚠️ SECOND CLEARER OF THE SAME PAIR — the multicast one above is
 *          campaign-driven and touches many members; this one is human-driven
 *          and touches exactly one. Both are load-bearing: removing either
 *          leaves that route with no way to end the stamp. คนละเส้น ต้องมีทั้งคู่
 *          ⚠️ IT RE-CHECKS THE STAMP ITSELF. The section only appears when the
 *          member carries that stamp, and the helper drops an answer naming a
 *          stamp the member does not have — so a stale tab cannot clear a key
 *          the admin was never shown.
 *          ⚠️ STILL NOT A FLAG. Same reasoning as the clearer above: an admin
 *          closing a case is not the customer doing anything, so "no stamp"
 *          keeps meaning "either never notified, or notified and since told
 *          otherwise". Both readers (`chat.service.ts` `?follow=`, and the
 *          cooldown in `notice-guard.helper.ts`) behave exactly as documented
 *          for the multicast clear.
 *          An audit row names the member and the keys — `parent: 'line_user'`,
 *          note "หยุดติดตามฝาก/ถอน — เคลียร์ตอนปิดเคส #<id>". Without it a missing
 *          stamp is indistinguishable from one that was never written.
 *
 * ─── CAN ONE FEATURE DAMAGE ANOTHER'S KEY? NO, AND HERE IS WHY ─────────────
 * A question worth answering once so nobody has to worry about it again.
 *
 * Every write and every clear addresses ONE DOTTED LEAF: `writeMemberConfig`
 * and `writeMemberConfigOnce` `$set` the single path, `clearMemberConfig`
 * `$unset`s the single path. Nothing in this folder ever writes the `config`
 * object whole, so a sibling key belonging to another feature is not merely
 * left alone — it is not addressable from that call at all. `member-config.spec`
 * pins both halves: a write keeps a sibling ("writes a DOT PATH, so a sibling
 * key of another feature survives") and a clear removes only the leaf.
 *
 * ⇒ A consumer needs to know exactly two things, and neither is about anyone
 *   else's key:
 *     1. who clears ITS OWN key — for a FLAG, every route must have a clearer;
 *        `abandon_trigger_at` has two and both are load-bearing;
 *     2. whether its key is a FLAG or a RECORD — a RECORD with a clearer is a
 *        bug that erases history, and this list is where that is stated.
 *   Everything else in the bag is somebody else's business and is structurally
 *   out of reach. ไม่ต้องห่วงคีย์คนอื่น เขียนทีละ leaf อยู่แล้ว · ห่วงแค่ว่าใครล้างของตัวเอง.
 *
 * ⚠️ THIS LIST IS CHECKED, NOT TRUSTED. `z-test/unit/member-config-consumers.spec.ts`
 * greps the code both ways — a file named here that no longer imports the door,
 * or an importer that is missing from here, turns it red. When it does, the
 * comment is what is wrong. อัปเดตพร้อมโค้ดเสมอ.
 */

/**
 * Every settable key, with the type its value must have.
 *
 * The dotted string is the path INSIDE `config` — `follow_up.line.abandon`
 * lives at `config.follow_up.line.abandon`. The `<feature>.<channel>.<key>`
 * shape is not decoration: this system really is multi-channel, and the routes
 * say so (`api/line-users/:id` and `api/channel-users/:id` are aliases of the
 * same handler, `members.controller.ts`).
 *
 * ⚠️ THESE ARE READ ON THE LIVE WEBHOOK PATH. An earlier version of this note
 * said nothing read them; that stopped being true when the follow-up gate began
 * checking `abandon_trigger_at` on every event (`follow-up.gate.ts:90`).
 * Adding or renaming a key here is therefore a change to customer-facing
 * behaviour, not a declaration. คีย์พวกนี้ถูกอ่านจริงบนเส้น webhook แล้ว.
 */
export const MEMBER_CONFIG_KEYS = {
  /**
   * WHEN this customer was last seen ignoring the registration card.
   *
   * A date and not a `true`: both answer "is this customer stuck", but only a
   * date answers "for how long", and that question cannot be recovered later if
   * it was never stored — the same lesson `profile_data_updated_at` records.
   * The `_at` suffix follows the house naming (`link_registered_at`,
   * `last_synced_at`). เก็บวันที่ ไม่ใช่ true · ย้อนถามทีหลังได้.
   */
  /* 🔴 [FEAT-20260904-REGANYSTAMP] THE CLOSE-CASE DIALOG CLEARS THIS KEY, and
     the two below it, in one `$unset`.
     ═══════════════════════════════════════════════════════════════════════
     Answering "ไม่ต้องติดตามการสมัครลูกค้านี้อีก" on the close-case confirm
     sets `members.ignore_abandon_assist = true` AND removes all THREE
     registration stamps — see `tickets/patch-after-close.helper.ts`
     (`REGISTRATION_CLEARED_KEYS`, `[FIX-20260831-STOPCLEARSSTAMPS]`).

     ⚠️ SAY IT HERE BECAUSE THIS FILE IS WHERE PEOPLE COME TO ASK. The comments
     on `request_reg_at` and `customer_helper_trigger_at` below still describe
     them as records "nothing ever removes" — that was true when written and is
     the reason those keys were trusted for counting. An admin pressing one
     button now removes them, so any reader planning to count on them must know
     the population can shrink. ตัวกลางต้องบอกว่ามีคนลบ ไม่งั้นคนอ่านจะเชื่อว่ามันอยู่ตลอด

     WHO can trigger it, as of 04/09: a member carrying ANY ONE of the three
     AND holding no `raw_profile_data`. A registered member is never offered the
     option, on either side — the FE hides the section and the BE refuses the
     answer independently.

     WHAT IT COSTS, accepted by the owner on 31/08 (*"หลุดจาก audience ไม่เป็นไร"*):
       · `insight-registrations.service.ts` splits its card on `request_reg_at`;
         a cleared member moves bucket, ONE-WAY.
       · broadcast audiences built on `follow_up.abandon_at` /
         `follow_up.customer_helper_at` stop selecting that member.
     WHAT IT DOES NOT TOUCH: registration STATUS, which is `raw_profile_data`
     and never a stamp ([DOC-20260825-REGSTATUS]). */
  'follow_up.line.abandon_trigger_at': 'date',

  /**
   * [FEAT-20260820-REQUESTREG] WHEN this customer ACTUALLY SENT THEIR DETAILS —
   * the moment scenario A read both a phone and an account out of what they
   * wrote, and a case was opened for a human to take over.
   *
   * ⚠️ IT COUNTS SENDERS, NOT PEOPLE WHO WERE ASKED. Owner: "request_reg_at เอาไว้
   * นับคนที่ส่งข้อมูลมาจริง ๆ ไง". A customer who was chased and never answered —
   * or answered with only half of it — is deliberately NOT stamped, so
   * `countDocuments` on this key is the count of people who came through, not the
   * count of people the bot talked to. `abandon_trigger_at` is what marks the
   * second group, and it is cleared when they register.
   * นับ "คนที่ส่งมาจริง" ไม่ใช่ "คนที่ถูกถาม" — คนละคำถาม คนละคีย์.
   *
   * ⚠️ IT IS A RECORD, NOT A FLAG. `abandon_trigger_at` answers "is this customer
   * stuck right now" and is removed the moment they register; this one answers
   * "were they ever asked", which stays true through a registration and is what
   * makes counting them afterwards possible. Owner, 2026-08-20:
   * "request_reg_at = ห้ามเคลียร์ห้ามยุ่ง >>> คงค่าเดิม".
   *
   * 🔴 THAT RULE NOW HAS EXACTLY ONE EXCEPTION — [FEAT-20260826-CLOSECLEARFU].
   * ═══════════════════════════════════════════════════════════════════════════
   * This block used to read "AND NOTHING CLEARS IT", and that stopped being true
   * on 26/08/2026. It is corrected here rather than deleted, because the reason
   * the rule existed still applies everywhere else.
   *
   *   WHO CAN CLEAR IT — one door, and a human drives it: an admin ticking
   *   "ไม่ต้องติดตามการสมัครลูกค้านี้อีก" in the close-case confirm on
   *   `/ticket-support`. `src/modules/tickets/tickets.service.ts`, decided by
   *   close-case-follow-up.helper.ts beside it. It fires only when
   *   the member carries this key AND `abandon_trigger_at`, and clears both.
   *   (the decision itself lives beside it in close-case-follow-up.helper.ts,
   *   which holds no door call of its own — it only returns a plan)
   *   No automatic path clears it — registering still does not, and the two
   *   register-time clearers above still leave it alone on purpose.
   *
   *   WHY — the owner was shown this note and the consequence below, and
   *   confirmed on 26/08/2026: a customer who plainly does not want to register
   *   should stop being chased, and should start clean from the next card.
   *
   *   🔴 WHAT AN ABSENT VALUE MEANS NOW — TWO THINGS, NOT ONE:
   *     · this customer was never asked, or
   *     · they were asked, and an admin decided to stop chasing them.
   *   Reading a missing value as "never asked" is therefore WRONG from 26/08 on.
   *   The audit log is the only place that tells the two apart: the clear writes
   *   one row naming the admin, the time and both keys.
   *   ค่าที่หายไปแปลได้สองอย่างแล้ว · แยกได้จาก audit เท่านั้น
   *
   *   🔴 IT MOVES A REPORT. `tickets/insight-registrations/insight-registrations.service.ts`
   *   splits its card on exactly this key — WITH it the row counts as "สมัครโดย
   *   Bot ช่วย Admin", without it as "สมัครโดยแอดมิน". Every tick moves one
   *   member between those buckets, permanently. Anyone comparing that card
   *   across 26/08 is comparing two different populations.
   *
   * ⚠️ WRITTEN ONCE. A customer whose case is closed and who gets stuck again
   * keeps the FIRST date — `writeMemberConfigOnce` enforces that in its filter,
   * so "when were they first asked" cannot be overwritten by a later round.
   *
   * A partial index on this path exists (`member.schema.ts`) so the count can be
   * taken without a collection scan. เก็บไว้ตลอด · เขียนครั้งเดียว · นับได้.
   */
  'follow_up.line.request_reg_at': 'date',

  /**
   * [FEAT-20260825-HELPERTRIGGER] WHEN this customer was LAST shown the
   * customer-helper — the offer to link their account, delivered either as the
   * quick reply or as the customer-helper card.
   *
   * ⚠️ ROLLING RECORD — overwritten on every qualifying event, cleared by
   * NOBODY. Owner, 25/08/2026: *"ไม่มีเคลียร์ เก็บไว้ + ทับเวลาไปทุกครั้งที่เข้า
   * เงื่อนไข"*. Written with `writeMemberConfig`, never `...Once`: the question
   * is "when did we LAST offer", and `...Once` would freeze the first one and
   * quietly answer something else. Same lifetime as the `notice_*` keys below,
   * deliberately NOT the same as `abandon_trigger_at` above.
   *
   * 🔴 NEVER READ IT AS "HAS NOT LINKED THEIR ACCOUNT" — it survives
   * registration like every RECORD here. See [DOC-20260825-REGSTATUS] above.
   *
   * WHEN it is written is one editable predicate, on purpose (owner: *"ห้าม
   * hard code โง่ ๆ"*): `webhook/follow-up/customer-helper-trigger.rule.ts` →
   * `shouldStampCustomerHelper(offered, sent)`. Today: offered AND actually
   * accepted by LINE. Change the policy there; no call site needs editing.
   *
   * Declared 2026-08-25 with its writer wired in the same commit. Nothing in
   * `src/` reads it yet — an audience source exposes it to broadcast targeting,
   * which is a query, not a code reader.
   */
  'follow_up.line.customer_helper_trigger_at': 'date',

  /**
   * [FEAT-20260822-NOTICERUNTIME] WHEN this member last received each notice
   * card — one ROLLING stamp per side: deposit (runtime cases A/B), withdraw
   * (C/D), payment/all (E/F). The notice cooldown compares their AGE against
   * NOTICE_COOLDOWN_MINUTES, so the value must MOVE on every card sent —
   * written with `writeMemberConfig` (the overwriting door), never `...Once`.
   *
   * ⚠️ ROLLING RECORD — overwritten per notice. The cooldown reads age, so an
   * old stamp goes inert on its own; two routes also remove it outright (see
   * the CORRECTION below and the CONSUMERS block for who and when).
   * Declared 2026-08-22 AHEAD of the wiring — until the runtime's R3 step
   * ships, nothing writes or reads these keys and every row simply lacks them.
   *
   * TIME NOTE (owner-mandated): stored as UTC Date instants like every stamp
   * here; consumers convert to Asia/Bangkok (+7, fixed) for DISPLAY ONLY —
   * cooldown math and queries stay in UTC. Full note:
   * webhook/notice-runtime/notice.keys.ts.
   *
   * ⚠️ CORRECTION 27/08/2026 — this block used to end "cleared by NOBODY, and
   * that is the design". That stopped being true on 24/08 and the CONSUMERS
   * block above has said so ever since; only these lines were left behind.
   * `notice_deposit_at` and `notice_withdraw_at` now have TWO clearers (the
   * multicast campaign, and an admin ticking "ไม่ติดตาม" while closing a case);
   * `notice_payment_at` still has NONE, and that part IS the design.
   * They remain ROLLING RECORDS either way — a clearer does not make a FLAG.
   * บัญชีข้างบนถูกอยู่แล้ว บรรทัดตรงนี้ค้างมา
   */
  'follow_up.line.notice_deposit_at': 'date',
  'follow_up.line.notice_withdraw_at': 'date',
  'follow_up.line.notice_payment_at': 'date',
} as const;

export type MemberConfigKey = keyof typeof MEMBER_CONFIG_KEYS;

/** The value type a given key accepts. */
export type MemberConfigValue = boolean | number | string | Date;

export const MEMBER_CONFIG_ROOT = 'config';

/**
 * Reject a key nobody declared, loudly.
 *
 * A typo is the failure this exists for: `follow_up.line.abandonn` would
 * otherwise be written happily, read back as absent for ever, and look like a
 * feature that silently does not work. Throwing turns a silent wrong answer
 * into an obvious one. พิมพ์ผิดต้องดังทันที ไม่ใช่เงียบแล้วค่าหาย.
 */
export function assertMemberConfigKey(
  key: string,
): asserts key is MemberConfigKey {
  if (!Object.prototype.hasOwnProperty.call(MEMBER_CONFIG_KEYS, key)) {
    throw new Error(
      `[MEMBER-CONFIG] unknown key "${key}" — add it to MEMBER_CONFIG_KEYS first`,
    );
  }
}

/** Reject a value whose type does not match what the key was declared to hold. */
export function assertMemberConfigValue(
  key: MemberConfigKey,
  value: unknown,
): void {
  const expected = MEMBER_CONFIG_KEYS[key];
  /* `date` is not a `typeof` result, so it gets its own arm. Worth the two extra
     lines: a timestamp stored as a string sorts and compares as text, and the
     bag is `Mixed`, so nothing downstream would notice. */
  const ok =
    expected === 'date'
      ? value instanceof Date && Number.isFinite(value.getTime())
      : typeof value === expected;
  if (!ok) {
    throw new Error(
      `[MEMBER-CONFIG] key "${key}" expects ${expected}, got ${
        value instanceof Date ? 'invalid date' : typeof value
      }`,
    );
  }
}
