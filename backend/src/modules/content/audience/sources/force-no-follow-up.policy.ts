/**
 * [FEAT-20260827-FORCENOFOLLOWUP] Force "and nobody has chased them yet" onto
 * the register-card audience.
 * ===========================================================================
 * WHAT. One audience source — "ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน"
 * (`follow_up.customer_helper_at`) — must additionally require that the member
 * carries NO value in either follow-up stamp the system uses to chase them:
 *
 *     config.follow_up.line.abandon_trigger_at   must be empty
 *     config.follow_up.line.request_reg_at       must be empty
 *
 * Owner, 27/08/2026: the people this campaign is for are the ones who were shown
 * the card and were NOT followed up on afterwards. Someone already chased has had
 * their turn; chasing them again is the same "the label is a lie" failure that
 * `force-no-profile.policy.ts` beside this file exists to prevent.
 *
 * ⭐ WHY IT CLOSES A REAL LOOP, not just a wish. A multicast built on this source
 *    that does NOT tick "open a case" stamps `abandon_trigger_at` on everyone it
 *    reached (`content/broadcast-follow-up/stamp-abandon-on-multicast.ts`
 *    → `TRIGGER_SOURCE_KEYS`). With this policy on, those people fall OUT of the
 *    audience on the next run by themselves. ตามครั้งเดียว ไม่ทวงซ้ำ — and the
 *    two files are what make that true together; neither does it alone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 📌 CHANGING YOUR MIND LATER — every case is ONE edit in THIS FILE
 * ═══════════════════════════════════════════════════════════════════════════
 *   · stop forcing entirely      → `FORCE_NO_FOLLOW_UP_ENABLED = false` (one line)
 *   · drop one of the two rules  → remove that key from the array below
 *   · force another source too   → add an entry to `FORCE_NO_FOLLOW_UP_RULES`
 *   · a path moved               → nothing here: the path is read from
 *                                  `audience-source.registry.ts` at build time
 * `audience-filter.ts` never needs to change for any of them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔑 WHY THIS IS A SECOND FILE AND NOT A SECOND KEY IN `NO_PROFILE_CLAUSE`
 * ═══════════════════════════════════════════════════════════════════════════
 * `force-no-profile.policy.ts` applies ONE clause to a LIST of three source keys.
 * This rule belongs to ONE key only, and putting it there would break the other
 * two: a job selecting on `follow_up.abandon_at` asks for "abandon_trigger_at HAS
 * a value", so ANDing "abandon_trigger_at is empty" onto it produces a query that
 * contradicts itself — zero recipients, for ever, with no error anywhere.
 * ⇒ per-key table here; shared clause there. คนละรูปคำถาม ต้องอยู่คนละไฟล์.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔑 WHY THE TABLE HOLDS SOURCE KEYS AND NOT DOTTED MONGO PATHS
 * ═══════════════════════════════════════════════════════════════════════════
 * `audience-source.registry.ts` already declares the path for every selectable
 * field, and its own header warns that a dotted string typed a second time is
 * checked by NO compiler — rename the key at the writer and the filter breaks
 * SILENTLY: no error, no empty-result warning, just a campaign that reaches the
 * wrong people. So this file stores KEYS and asks the registry for the PATH.
 * One source of truth; a path move is a registry edit and nothing else.
 *
 * 🔴 AND THEREFORE IT MUST FAIL CLOSED. A lookup can miss (someone deletes an
 * entry, someone mistypes a key). Skipping the clause would DROP a condition, and
 * a dropped condition makes the audience WIDER — a campaign meant for a handful
 * reaching everybody. So a miss returns `ok: false` and `buildAudienceFilter`
 * refuses the whole job, exactly as it does for an unknown rule key.
 * ⚠️ IT RETURNS, IT NEVER THROWS — that is `audience-filter.ts`'s contract.
 *
 * ⚠️ AND IT IS INVISIBLE FROM THE FORM, by the same design as the file beside it.
 * The admin sees the rule they typed; the query that runs carries two more
 * clauses. Preview counts and the real send go through the SAME builder, so the
 * number shown is the number reached — it is just smaller than a hand-written
 * version of the same rule, and this file is why.
 *
 * ⚠️ SWITCHING IT OFF IS SILENT. Nothing errors, nothing logs; the audience
 * simply grows again by everyone who was already chased, and that group only
 * gets bigger over time because `request_reg_at` is a RECORD nobody clears.
 * ปิดแล้วไม่มีอะไรเตือน — จำนวนผู้รับจะโตขึ้นเฉย ๆ
 *
 * 📖 Plan, live counts and the affected saved jobs:
 *    `todo/task/27082026/todo4_27082026_card-audience-force-no-follow-up.md`
 * 📖 The law on these keys (FLAG vs RECORD, who writes, who clears):
 *    `src/modules/chat/config/member-config.registry.ts` — [DOC-20260825-REGSTATUS]
 *
 * revert: delete this file, plus the `[FEAT-20260827-FORCENOFOLLOWUP]` block in
 *         `audience-filter.ts` and `z-test/unit/broadcast-audience-force-no-follow-up.spec.ts`.
 */
import { getAudienceSource } from './audience-source.registry';

/** One switch. `false` = nothing is forced and every other behaviour is untouched. */
export const FORCE_NO_FOLLOW_UP_ENABLED = true;

/**
 * trigger source key → the source keys whose path must hold NO value.
 *
 * ⚠️ BOTH SIDES ARE AUDIENCE SOURCE KEYS (as stored in `audience.rules[].key`),
 *    never member paths. The path is resolved from the registry — see the header.
 * ⚠️ Deliberately ONE trigger entry. Every other filter, the other follow-up ones
 *    included, must keep behaving exactly as it did.
 */
export const FORCE_NO_FOLLOW_UP_RULES: Readonly<
  Record<string, readonly string[]>
> = {
  'follow_up.customer_helper_at': [
    /* FLAG — set when the customer is seen ignoring the register card, and
       cleared the moment they register. Present = the system already chased. */
    'follow_up.abandon_at',
    /* RECORD — set when the bot asked for their details. Nobody ever clears it. */
    'follow_up.request_reg_at',
  ],
};

/** Either the clause to AND on (possibly `null` = force nothing), or a refusal. */
export type ForceNoFollowUpResult =
  | { readonly ok: true; readonly clause: Record<string, unknown> | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Overrides, for tests only.
 *
 * 🔴 Here so the two branches that MUST work can be proven without mocking a
 * module: the fail-closed refusal (`rules`) and the off switch (`enabled`).
 * A guard nobody can test is a guard nobody can trust. Production callers pass
 * nothing and get the constants above. ของจริงไม่ต้องส่งอะไร.
 */
export interface ForceNoFollowUpOptions {
  readonly rules?: Readonly<Record<string, readonly string[]>>;
  readonly enabled?: boolean;
}

/**
 * What must be ANDed on, given the source keys this job's rules actually used.
 *
 * The clause is ONE object holding every required path — `{pathA: null, pathB:
 * null}` — because a plain `null` match in MongoDB already means "the field is
 * missing OR explicitly null", which is the whole question. No `$exists`: the
 * audience system forbids it (measured — it destroys a covered read; see
 * `audience-filter.ts`).
 */
export function forceNoFollowUpClause(
  usedKeys: readonly string[],
  options: ForceNoFollowUpOptions = {},
): ForceNoFollowUpResult {
  const enabled = options.enabled ?? FORCE_NO_FOLLOW_UP_ENABLED;
  const rules = options.rules ?? FORCE_NO_FOLLOW_UP_RULES;
  if (!enabled) return { ok: true, clause: null };

  /* Collect once and de-duplicate: two rules naming the same trigger must not
     produce the clause twice. */
  const required: string[] = [];
  for (const used of usedKeys) {
    for (const key of rules[used] ?? []) {
      if (!required.includes(key)) required.push(key);
    }
  }
  if (required.length === 0) return { ok: true, clause: null };

  const clause: Record<string, unknown> = {};
  for (const key of required) {
    const source = getAudienceSource(key);
    if (source === null) {
      /* Fail closed — dropping it would widen the audience. See the header. */
      return {
        ok: false,
        reason:
          `the forced condition "${key}" is not a known audience source — ` +
          'refusing rather than sending to a wider list than intended',
      };
    }
    clause[source.path] = null;
  }
  return { ok: true, clause };
}
