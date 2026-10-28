/* Relative, not `@/modules/webhook/...`: a deep alias into another feature
   module is a layering error the linter rejects. Same shape
   `close-case-follow-up.helper.ts` next door already uses. */
import {
  NOTICE_DEPOSIT_AT_KEY,
  NOTICE_WITHDRAW_AT_KEY,
} from '../webhook/notice-runtime/notice.keys';
/* Relative, not an alias: a deep alias into another feature module is a
   layering error the linter rejects, and `webhook`'s barrel does not export
   these. Same path shape `close-case-follow-up.helper.ts` uses beside it. */
import {
  ABANDON_TRIGGER_KEY,
  CUSTOMER_HELPER_TRIGGER_KEY,
  REQUEST_REG_KEY,
} from '../webhook/follow-up/follow-up.keys';

/**
 * [FEAT-20260827-PATCHAFTERCLOSE] "patch after close ticket" — what an admin
 * decided about this customer's follow-ups, at the moment the case was closed.
 * ===========================================================================
 * Owner, 27/08/2026. The close-case confirm grew from ONE question into a
 * dialog of independent SECTIONS, each of which appears only when the member
 * actually carries the stamp it talks about:
 *
 *   section "การติดตามลงทะเบียน"  — shown when the member carries ANY ONE of
 *       `abandon_trigger_at` / `request_reg_at` / `customer_helper_trigger_at`
 *       AND has NO `raw_profile_data`   ([FEAT-20260904-REGANYSTAMP])
 *       · stop  ⇒ `members.ignore_abandon_assist = true` AND all three stamps
 *                 are cleared            ([FIX-20260831-STOPCLEARSSTAMPS])
 *       · keep  ⇒ nothing
 *
 *   section "การติดตามฝากถอน"     — two INDEPENDENT pairs
 *       · deposit,  shown when `notice_deposit_at`  is set
 *       · withdraw, shown when `notice_withdraw_at` is set
 *       · unfollow ⇒ clear that one stamp · follow ⇒ nothing
 *
 * 🔴 THIS HEADER WAS STALE AND MISLED A READER ON 04/09. It still described the
 * 27/08 rule — "stop ⇒ the flag alone", pair-gated — three days after
 * `[FIX-20260831-STOPCLEARSSTAMPS]` had already restored the clearing below.
 * Anyone answering "does close-case clear the stamps?" out of this block got the
 * wrong answer while the code did the opposite. If the behaviour moves again,
 * THIS BLOCK MOVES WITH IT. คอมเมนต์หัวไฟล์ที่ค้างอยู่ = คำตอบผิดที่ดูน่าเชื่อ
 *
 * 🔴 THE RULE THAT OUTRANKS EVERY OTHER LINE HERE — owner, twice, in the same
 * conversation: **a section that does not appear must change nothing.** Not the
 * dialog, not the button, not one field on the member. A close with no section
 * shown is byte-for-byte the close that shipped before this feature existed.
 * ⇒ every answer is OPTIONAL, and `undefined` means "not asked", never a default.
 * ⇒ and this file re-checks the stamp itself: an answer naming a stamp the
 *   member does not carry is DROPPED, silently and on purpose. The FE decides
 *   what to show; the BE never trusts that decision, because a stale tab or a
 *   hand-made call can send anything. section ไหนไม่ขึ้น = ปิดเคสปกติ ไม่แตะอะไรเลย
 *
 * 🔴 WHAT CHANGED FROM `[FEAT-20260826-CLOSECLEARFU]`, AND WHY IT MATTERS.
 * The 26/08 version answered "stop" by `$unset`-ing BOTH registration stamps —
 * an approved exception to the standing rule that `request_reg_at` is a RECORD
 * nothing ever clears. Owner reversed that on 27/08: **"ทำแค่อย่างเดียว =
 * ignore_abandon_assist=true"**. The flag already stops the chase on its own —
 * `webhook/follow-up/ignore-abandon.rule.ts` reads it in `abandonIsSwitchedOff`
 * and the gate turns quiet — so destroying the record bought nothing and cost
 * the registration insight card its bucket split (a member WITH the stamp counts
 * as "สมัครโดย Bot ช่วย Admin", without it as "สมัครโดยแอดมิน", and the move is
 * one-way). The old clearing path was deliberately LEFT IN PLACE, unreachable
 * from this dialog, because the owner asked to keep it "เผื่อเปลี่ยนใจ".
 * ⇒ AND THEY DID CHANGE THEIR MIND, on 31/08: `[FIX-20260831-STOPCLEARSSTAMPS]`
 *   reconnected that path, so "stop" clears the three stamps again today. This
 *   paragraph is kept as the RECORD of the 26→27/08 reversal, not as a
 *   description of current behaviour — the summary at the top is.
 *
 * WHY A PURE FUNCTION AND NOT `if`s AT THE CALL SITE: deciding WHEN to act is
 * where this goes wrong — a ghost key, a half-stamped member, a stale tab, a
 * section that was never shown. Each of those is invisible to a type checker.
 * A function returns a plan a test can read. ส่วนที่พลาดง่ายคือ "เมื่อไหร่"
 *
 * revert: delete this file, its spec, `patch_after_close` on `UpdateTicketDto`,
 *         and the block that calls this in `tickets.service.ts`. The 26/08
 *         `clear_follow_up` path is independent and keeps working.
 */

/**
 * [FIX-20260831-STOPCLEARSSTAMPS] The three stamps a "stop" removes, in the
 * order the audit row reports them.
 *
 * Exported for the same reason `CLOSE_CASE_CLEARED_KEYS` is: the caller, the
 * audit entry and the tests must name ONE list. Every key here is declared in
 * `MEMBER_CONFIG_KEYS`, so `clearMemberConfig` accepts it and a typo throws
 * instead of silently clearing nothing.
 */
export const REGISTRATION_CLEARED_KEYS = [
  ABANDON_TRIGGER_KEY,
  REQUEST_REG_KEY,
  CUSTOMER_HELPER_TRIGGER_KEY,
] as const;

/** The stamps the deposit/withdraw section can clear, keyed by its answer. */
export const NOTICE_KEY_BY_TOPIC = {
  deposit: NOTICE_DEPOSIT_AT_KEY,
  withdraw: NOTICE_WITHDRAW_AT_KEY,
} as const;

export type NoticeTopic = keyof typeof NOTICE_KEY_BY_TOPIC;

/** What the admin picked in each section. Every one is optional — see the rule. */
export interface PatchAfterCloseAnswers {
  /** "stop" = stop chasing this customer's registration. */
  registration?: 'stop' | 'keep';
  deposit?: 'follow' | 'unfollow';
  withdraw?: 'follow' | 'unfollow';
}

export interface PatchAfterCloseInput {
  /** Did THIS write take the ticket to closed? A re-save of a closed case is not a close. */
  becameClosed: boolean;
  /**
   * `dto.patch_after_close`, passed through untouched.
   *
   * ⚠️ Compare every field by VALUE. `main.ts` runs the pipe with
   * `transform: true`, which materialises declared properties as `undefined`
   * even when the client never sent them — `[FIX-20260824-CASGHOST]` records
   * that exact trap breaking case hand-over on stg.
   */
  answers: PatchAfterCloseAnswers | undefined;
  /** The member document as it stood BEFORE the close. `null` is a valid answer. */
  member: unknown;
}

export interface PatchAfterClosePlan {
  /** Set `members.ignore_abandon_assist = true`. */
  setIgnoreAbandon: boolean;
  /** Member-config keys to `$unset`, in a stable order. Empty is the normal case. */
  clearKeys: string[];
  /** True when this plan would touch nothing — the caller can skip every query. */
  isNoop: boolean;
}

const EMPTY: PatchAfterClosePlan = {
  setIgnoreAbandon: false,
  clearKeys: [],
  isNoop: true,
};

/** A stamp counts as present only when it holds a real value — null is absent. */
function hasStamp(line: Record<string, unknown> | null, leaf: string): boolean {
  const v = line?.[leaf];
  return v !== undefined && v !== null && v !== '';
}

/** `config.follow_up.line`, or null when any step of the path is missing. */
function followUpLine(member: unknown): Record<string, unknown> | null {
  const config = (member as { config?: unknown } | null)?.config;
  const followUp = (config as { follow_up?: unknown } | undefined)?.follow_up;
  const line = (followUp as { line?: unknown } | undefined)?.line;
  return line && typeof line === 'object'
    ? (line as Record<string, unknown>)
    : null;
}

/** The last segment of a dotted key — `follow_up.line.x` → `x`. */
const leafOf = (key: string): string => key.slice(key.lastIndexOf('.') + 1);

/**
 * [FEAT-20260904-REGANYSTAMP] Is this member REGISTERED?
 *
 * The one column that answers it is `raw_profile_data`: present AND a non-empty
 * object ([DOC-20260825-REGSTATUS]). It is `$unset` on unlink and on the admin's
 * profile wipe, which is what makes it CURRENT STATE rather than history — and
 * why no follow-up stamp can stand in for it.
 *
 * ⚠️ Empty object counts as NOT registered, matching the FE's `hasRawProfile`.
 *    A row can carry `raw_profile_data: {}` after a failed refresh (seen live:
 *    "profile endpoint not successful — skip updating raw_profile_data"), and
 *    treating that as registered would silently stop the chase for someone the
 *    system never actually got details for.
 */
function hasRawProfile(member: unknown): boolean {
  const raw = (member as { raw_profile_data?: unknown } | null)
    ?.raw_profile_data;
  return !!raw && typeof raw === 'object' && Object.keys(raw).length > 0;
}

/**
 * Turn what the admin picked into what to do.
 *
 * Each section is judged ALONE: a member carrying only `notice_deposit_at` gets
 * a deposit decision and nothing else, and the registration section — which was
 * never shown — cannot be acted on even if an answer for it arrives.
 * แต่ละหัวข้อตัดสินแยกกัน อันที่ไม่ได้ขึ้นทำอะไรไม่ได้เลย
 */
export function buildPatchAfterClose(
  input: PatchAfterCloseInput,
): PatchAfterClosePlan {
  if (!input.becameClosed) return EMPTY;
  const answers = input.answers;
  if (!answers || typeof answers !== 'object') return EMPTY;

  const line = followUpLine(input.member);

  /* The registration section is shown only for a member carrying BOTH stamps,
     so "stop" from a half-stamped member came from a stale tab — dropped. The
     pair is checked here rather than trusted from the request. */
  /* [FEAT-20260904-REGANYSTAMP] ANY ONE stamp is enough, and a profile blocks it.
     ─────────────────────────────────────────────────────────────────────────
     🔴 WHY THE PAIR RULE WAS WRONG. `request_reg_at` is written only when the
     customer ACTUALLY sent a phone and an account (`follow-up.keys.ts`), so a
     customer who was chased and never answered carries `abandon_trigger_at`
     alone — and demanding BOTH hid the section from exactly the people still
     being chased hardest. `customer_helper_trigger_at` was not consulted at all,
     so a member offered only the helper card could not be stopped either.
     ⇒ any one of the three now qualifies. คนที่โดนตามหนักสุดคือคนที่เคยหลุดจากเงื่อนไขเดิม

     🔴 AND `!hasProfile` IS MANDATORY, not a nicety. Registration status is
     `members.raw_profile_data` and NEVER a stamp ([DOC-20260825-REGSTATUS]) —
     every one of the three keys survives registration, `request_reg_at` and
     `customer_helper_trigger_at` by design. Without this gate a customer who
     registered months ago would still be offered "stop chasing", and answering
     it would wipe records that nothing can rebuild.

     ⚠️ `raw_profile_data` MUST BE IN THE PROJECTION or this gate reads
        `undefined` and silently passes for everyone. It was added to the
        `.select()` in `tickets.service.ts` in the same change — the two lines
        only work as a pair. ไม่ใส่ใน select = เกตนี้ตายเงียบ
     revert: restore the AND-pair above and drop `hasProfile` + the projection. */
  const carriesAnyRegistrationStamp =
    hasStamp(line, 'abandon_trigger_at') ||
    hasStamp(line, 'request_reg_at') ||
    hasStamp(line, 'customer_helper_trigger_at');
  const setIgnoreAbandon =
    answers.registration === 'stop' &&
    carriesAnyRegistrationStamp &&
    !hasRawProfile(input.member);

  /* Order is fixed (registration stamps, then deposit, then withdraw) so the
     audit row and the tests read the same way every time. Object key order
     would not survive a refactor. */
  const clearKeys: string[] = [];

  /* [FIX-20260831-STOPCLEARSSTAMPS] "stop" now REMOVES the registration stamps
     as well as setting the flag.
     ─────────────────────────────────────────────────────────────────────────
     🔴 THIS REVERSES THE 27/08 DECISION, ON THE OWNER'S WORD, 31/08:
     *"แอดมินตั้งใจกด มันคือการตั้งใจเคลียร์"* — and, asked directly about the
     cost: *"หลุดจาก audience ไม่เป็นไร"*.

     What the owner was shown before deciding, and accepted:
       · `request_reg_at` is a RECORD. `insight-registrations.service.ts` splits
         its card on exactly this key — WITH it a member counts as "สมัครโดย Bot
         ช่วย Admin", without it as "สมัครโดยแอดมิน". The move is ONE-WAY: no
         other column records that the customer was ever asked.
       · broadcast audiences select on `request_reg_at` / `abandon_trigger_at`
         ("who was EVER asked"), so a cleared member drops out of those lists.
       · registration STATUS is not affected: that is answered by
         `members.raw_profile_data`, never by a stamp ([DOC-20260825-REGSTATUS]).

     ⚠️ The pair gate is unchanged — the section only appears for a member
        carrying BOTH, so a "stop" without them is a stale tab and is dropped.
     ⚠️ `customer_helper_trigger_at` is cleared only when it is actually there:
        a customer can be chased without ever having been sent the helper card,
        and `clearMemberConfig` must not be handed a key with nothing behind it.
        This is a NEW clearer for that key — the first one it has ever had — so
        it is declared at `chat/config/member-config.registry.ts`, which
        `member-config.spec.ts` greps and enforces.
     revert: delete this loop; "stop" goes back to setting the flag alone. */
  if (setIgnoreAbandon) {
    for (const key of REGISTRATION_CLEARED_KEYS) {
      if (hasStamp(line, leafOf(key))) clearKeys.push(key);
    }
  }

  for (const topic of ['deposit', 'withdraw'] as const) {
    if (answers[topic] !== 'unfollow') continue;
    const key = NOTICE_KEY_BY_TOPIC[topic];
    if (!hasStamp(line, leafOf(key))) continue;

    clearKeys.push(key);
  }

  return {
    setIgnoreAbandon,
    clearKeys,
    isNoop: !setIgnoreAbandon && clearKeys.length === 0,
  };
}

/**
 * [FEAT-20260830-AUDITLINEID] the human-readable half of the clear audit row.
 *
 * Names WHOSE follow-up was cleared and on which ticket. A member with no LINE
 * id still gets a sentence — it does not print `undefined` where an id belongs.
 */
/**
 * [FIX-20260901-NOTESAYSWHAT] What the note says is now derived from the keys
 * that were actually cleared, instead of one hardcoded sentence.
 *
 * THE BUG. Every row read `หยุดติดตามฝาก/ถอน` no matter what happened, because
 * this builder was never told which keys the plan removed. On 01/09 the audit
 * page showed three rows side by side — one that cleared only
 * `notice_withdraw_at`, one that cleared only the three registration stamps,
 * and one that cleared deposit and withdraw together — all three claiming the
 * same thing. The note is the only part of a row a person reads without
 * expanding it, so the log was actively misleading about which follow-up an
 * admin had stopped. โน้ตเดิมบอกเหมือนกันหมด ทั้งที่ล้างคนละอย่าง.
 *
 * WHAT IT DOES NOT FIX: rows written before this change keep their old text —
 * the note is stored, not rendered. แถวเก่าแก้ไม่ได้ เพราะข้อความถูกเก็บไปแล้ว.
 *
 * The caller already holds `plan.clearKeys` (it maps the same list into
 * `changed_fields` two lines above), so this costs no extra query and no new
 * lookup. `keys` is optional so an older caller keeps compiling; omitted or
 * empty falls back to the original sentence rather than inventing a new one.
 *
 * revert: drop the `keys` parameter and return the single hardcoded string —
 * and restore the three pinned strings in
 * `z-test/unit/audit-note-wording.spec.ts`.
 */
const NOTE_LABEL_BY_KEY: ReadonlyArray<readonly [string, string]> = [
  [NOTICE_DEPOSIT_AT_KEY, 'ฝาก'],
  [NOTICE_WITHDRAW_AT_KEY, 'ถอน'],
  [ABANDON_TRIGGER_KEY, 'การสมัคร'],
  [REQUEST_REG_KEY, 'การสมัคร'],
  [CUSTOMER_HELPER_TRIGGER_KEY, 'การสมัคร'],
];

/** The subject of the sentence — 'ฝาก/ถอน' when the keys say nothing else. */
function clearedSubject(keys?: readonly string[]): string {
  if (!keys || keys.length === 0) return 'ฝาก/ถอน';
  const labels: string[] = [];
  for (const [key, label] of NOTE_LABEL_BY_KEY) {
    if (keys.includes(key) && !labels.includes(label)) labels.push(label);
  }
  /* An unknown key is not worth a wrong sentence: say the generic thing rather
     than name a subject the plan never touched. คีย์ที่ไม่รู้จัก = ใช้คำกลาง */
  if (labels.length === 0) return 'ฝาก/ถอน';
  /* 'ฝาก' + 'ถอน' reads as the familiar pair, not as a list. */
  const pair =
    labels.length === 2 && labels[0] === 'ฝาก' && labels[1] === 'ถอน';
  return pair ? 'ฝาก/ถอน' : labels.join(' และ ');
}

export function buildClearFollowUpNote(
  ticketId: string,
  lineUserId?: string | null,
  keys?: readonly string[],
): string {
  const who =
    typeof lineUserId === 'string' && lineUserId.trim()
      ? ` · Channel LINE user ${lineUserId.trim()}`
      : '';
  return `หยุดติดตาม${clearedSubject(keys)} — เคลียร์ตอนปิดเคส #${ticketId}${who}`;
}
