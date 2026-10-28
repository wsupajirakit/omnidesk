/**
 * The member-config keys this feature owns. Nothing else, no logic, no imports.
 * ===========================================================================
 * They live alone so that any ONE part of the follow-up flow can be taken
 * without dragging the others in. Before this file existed the key was exported
 * from the level-1 helper, which meant the clear step — a few lines that only
 * `$unset` a path — could not be reused without pulling in the level-1 rule and
 * its chat-history read. That is the sort of dependency that looks harmless and
 * quietly makes a module all-or-nothing.
 * แยกไว้เพื่อให้หยิบไปใช้ทีละชิ้นได้จริง.
 *
 * The key must also be declared in `chat/config`'s registry, which is what
 * validates it; this file is only the name.
 *
 * 📖 THE HUMAN-READABLE OVERVIEW IS `docs/follow-up-status-spec.md` — what each
 * stamp means in plain words, which of the four screens shows it, and the live
 * counts taken from the real database. Start there if you arrived asking "what
 * is this key FOR"; start at the registry if you are about to change one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 [DOC-20260825-REGSTATUS] NO KEY IN THIS FILE ANSWERS "HAS THIS CUSTOMER
 *    REGISTERED?" — not one of the three, not even the FLAG.
 * ═══════════════════════════════════════════════════════════════════════════
 * Registration status is `members.raw_profile_data`: present and a NON-EMPTY
 * object = registered. It is `$unset` on unlink and on the admin's profile
 * wipe, and that is precisely what makes it CURRENT STATE instead of history.
 *
 * The three keys below carry three different lifetimes and not one of them
 * tracks that state:
 *     ABANDON_TRIGGER_KEY          FLAG            cleared on register, twice
 *     REQUEST_REG_KEY              RECORD          nothing ever removes it
 *     CUSTOMER_HELPER_TRIGGER_KEY  ROLLING RECORD  overwritten, never removed
 *
 * The FLAG is the closest thing here to "still stuck", and even its ABSENCE is
 * not "registered": a customer nobody ever chased has no flag either, so an
 * empty slot is two different people wearing the same face.
 * ธงหาย ≠ สมัครแล้ว · แปลได้แค่ว่าตอนนี้ไม่ได้ค้างอยู่ในสายตาของ gate.
 *
 * ⚠️ AND A PROFILE CHECK ALONE IS STILL NOT AIRTIGHT. An admin can WIPE a
 * customer's profile, which makes someone who genuinely registered look
 * unregistered to every "has no profile" test. The column that tells the two
 * apart is `members.raw_profile_cleared_at`, and nothing pairs them today —
 * the full account of that hole, and what closing it would cost, is in
 * `src/modules/chat/config/member-config.registry.ts` under the same tag.
 *
 * revert: delete with the rest of `follow-up/`.
 */

/**
 * When the customer was first seen ignoring the registration card.
 *
 * Its presence is the whole of level 2's condition, and its absence is what
 * level 1 looks for. Cleared the moment the customer has a real profile.
 */
export const ABANDON_TRIGGER_KEY = 'follow_up.line.abandon_trigger_at';

/**
 * [FEAT-20260820-REQUESTREG] When this customer actually sent their details.
 *
 * Written only when scenario A read BOTH a phone and an account out of what they
 * wrote. Someone who was chased and never answered is not stamped — this counts
 * people who came through, not people who were asked.
 * Owner: "request_reg_at เอาไว้นับคนที่ส่งข้อมูลมาจริง ๆ ไง".
 *
 * ⚠️ THE OPPOSITE LIFETIME FROM THE KEY ABOVE, and that is the whole point.
 * `ABANDON_TRIGGER_KEY` is a FLAG — it says "stuck right now" and is removed the
 * instant the customer registers. This one is a RECORD — it says "was asked at
 * some point" and is never removed by anything, which is what makes counting
 * them possible after the fact. Owner: "ห้ามเคลียร์ห้ามยุ่ง คงค่าเดิม".
 *
 * ⚠️ NOT part of any gate condition. Nothing branches on it; it exists to be
 * counted. If something ever does read it for a decision, that decision inherits
 * a value that survives registration — which is almost never what a live rule
 * wants. อ่านเพื่อ "นับ" ไม่ใช่เพื่อ "ตัดสิน".
 */
/* 🔴 [DOC-20260825-REGSTATUS] NEVER READ THIS KEY AS "HAS NOT REGISTERED".
   Owner, 25/08/2026: *"request_reg_at จะตรงไม่ถูก เคลียร์ ไม่ว่าจุดใด ถ้าเช็คว่า
   ลงทะเบียนไปแล้วรึยัง ให้เช็คเพิ่มจาก raw profile data"*

   This is a RECORD: it answers "was this customer ever asked?" and NOTHING
   removes it — not registering, not unlinking, not an admin clearing the
   profile. A customer who registered months ago still carries it.

   Registration status lives in `members.raw_profile_data` (present and
   non-empty = registered). It is `$unset` on unlink and on the admin clear, so
   it tracks the CURRENT state — which is what makes it the right column here.

   The FLAG you probably want instead is `ABANDON_TRIGGER_KEY` above: two
   clearers remove it the moment the customer registers, so its presence really
   does mean "still stuck". Pair it with the profile check anyway — one extra
   property read, and it stops a registered customer from being chased again.

   Full reasoning: `src/modules/chat/config/member-config.registry.ts`
   Reference implementation of the pairing:
   `omnidesk-console/components/member/follow-up/followStamps.ts` */
export const REQUEST_REG_KEY = 'follow_up.line.request_reg_at';

/**
 * [FEAT-20260825-HELPERTRIGGER] WHEN this customer was last shown the
 * customer-helper — the offer to link their account, sent as a quick reply or
 * as the customer-helper card.
 *
 * ⚠️ ROLLING RECORD. Written with `writeMemberConfig` (the overwriting door),
 * never `...Once`: owner, 25/08/2026 — *"ทับเวลาไปทุกครั้งที่เข้าเงื่อนไข"*.
 * The question it answers is "when did we LAST offer", not "when did we first",
 * so a customer offered again next week must move the timestamp forward.
 * Same lifetime as the `notice_*` keys, and deliberately NOT the same as
 * `ABANDON_TRIGGER_KEY` above, which is written once and then cleared.
 *
 * ⚠️ NOBODY CLEARS IT, AND THAT IS THE DESIGN — owner: *"ไม่มีเคลียร์ เก็บไว้"*.
 * It is history, not state. A customer who registers keeps it, which is exactly
 * what makes "how many people did we ever offer this to" answerable afterwards.
 *
 * 🔴 THEREFORE: NEVER READ IT AS "HAS NOT LINKED THEIR ACCOUNT". It survives
 * registration like every RECORD in this bag — see [DOC-20260825-REGSTATUS] in
 * `chat/config/member-config.registry.ts`. Registration status is
 * `members.raw_profile_data`.
 *
 * WHEN it is written is decided by ONE editable predicate, on purpose:
 * `customer-helper-trigger.rule.ts` → `shouldStampCustomerHelper`. Change the
 * policy there; no call site needs to know.
 *
 * ── WHERE THE VALUE GOES, END TO END ──────────────────────────────────────
 * WRITTEN BY the webhook reply path through `customer-helper-trigger.helper.ts`
 *   — the only writer — and only once the customer-helper has ACTUALLY reached
 *   the customer (LINE accepted it). An offer LINE refused is an offer nobody
 *   saw, and stamping it would put a stranger in every audience built on this
 *   key.
 * READ BY nothing in `src/`. That is not an oversight to be tidied away: the
 *   key was declared ahead of a code reader so that the timestamps exist on
 *   disk by the time somebody finally asks the question. It IS consumed
 *   already, twice, and NEITHER consumer goes through the member-config door:
 *     · BROADCAST / MULTICAST TARGETING — the audience source
 *       `follow_up.customer_helper_at`
 *       (`content/audience/sources/audience-source.registry.ts`) points its
 *       `path` at the dotted string below, and the filter builder drops that
 *       path straight into a Mongo query. Nothing calls `readMemberConfig`, so
 *       BOTH door guards are blind to this use — the same blindness
 *       `REQUEST_REG_KEY` above records for its raw-aggregation reader.
 *     · THE ADMIN'S FOLLOW-UP CARD — `omnidesk-console/components/member/
 *       follow-up/followStamps.ts` shows it as the third of three conditional
 *       alert rows, reached by the same dotted path off the room payload.
 *   🔴 CONSEQUENCE, AND IT IS THE REASON THIS PARAGRAPH EXISTS: renaming this
 *   constant, moving the key, or changing its shape breaks both of them
 *   SILENTLY. No compiler error, no exception, no empty-result warning — just
 *   a campaign that reaches nobody, or reaches the wrong people, and a card
 *   row that quietly stops appearing. Before touching it, grep the DOTTED
 *   STRING `follow_up.line.customer_helper_trigger_at` across BOTH REPOS
 *   (`omnidesk-api` and `omnidesk-console`), never only the constant name.
 * ⚠️ A CAMPAIGN THAT PICKS THAT SOURCE DOES NOT GET LITERALLY WHAT IT ASKED
 *   FOR, ON PURPOSE. `content/audience/sources/force-no-profile.policy.ts`
 *   ANDs "and has no profile" onto any job whose rules mention it, because
 *   this key is a RECORD and would otherwise select everyone who linked their
 *   account months ago. That policy is one boolean; switching it off widens
 *   every such campaign the next time it runs, with nothing to announce it.
 */
export const CUSTOMER_HELPER_TRIGGER_KEY =
  'follow_up.line.customer_helper_trigger_at';
