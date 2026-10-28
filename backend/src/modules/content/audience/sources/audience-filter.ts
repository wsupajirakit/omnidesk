/**
 * [FEAT-20260822-BCASTAUDFILTER] Rules → a Mongo filter, without the builder
 * ever learning a single field name.
 * ===========================================================================
 * A pure decision. It builds a filter; it never queries.
 *
 * 🔑 THE BUILDER KNOWS THE REGISTRY, NOT THE FIELDS. That is the whole trick:
 * adding `member.whatever_new` is one registry entry, and this file does not
 * change. ตัวสร้างไม่รู้จักคีย์ รู้จักแค่ทะเบียน.
 *
 * 🔴 AN UNKNOWN KEY FAILS CLOSED. Skipping a rule it cannot build would drop a
 * FILTER, and a dropped filter makes the audience WIDER — a campaign meant for
 * 200 people reaching 20,000, with no error anywhere. So an unknown or
 * un-buildable rule refuses the whole selection.
 *
 * 🔴 NO `$exists` IN THE OUTPUT. §6 measured that it destroys a covered read.
 * The registry offers ranges instead, which answer the same question with an
 * index. Asserted by a spec, not just written here.
 *
 * revert: delete this file with the rest of `sources/`.
 */
import { getAudienceSource } from './audience-source.registry';
import type { AudienceOp, AudienceSource } from './audience-source.types';
/* [FEAT-20260824-BCASTTIMEDOOR] one reader for every admin-supplied time */
import { parseAdminTime } from '../../broadcast-time';
import { forceNoProfileClause } from './force-no-profile.policy';
/* [FEAT-20260827-FORCENOFOLLOWUP] the second forced-condition policy — see below */
import { forceNoFollowUpClause } from './force-no-follow-up.policy';
import { guardWindowBoundFor } from './guard-window.policy';

export interface AudienceRule {
  readonly key: string;
  readonly op: AudienceOp;
  readonly value?: unknown;
}

export interface AudienceQuery {
  /** Combine the rules with AND or OR. */
  readonly match: 'and' | 'or';
  readonly rules: readonly AudienceRule[];
  /**
   * [FEAT-20260825-BCASTSKIPASSIST] LINE ids ที่งานใบนี้ขอข้าม
   *
   * 🔴 อยู่บน **audience** ไม่ใช่พารามิเตอร์ของฟังก์ชัน — และนั่นคือทั้งหมดของ
   *    การออกแบบชิ้นนี้ · ตัวกรองถูกสร้าง **สองครั้ง** ต่อการส่งหนึ่งรอบ
   *    (ที่ `new-send.service.ts` และอีกครั้งที่ `run-broadcast.ts` เพื่อคิด
   *    จำนวนผู้รับต่อ OA) และทั้งสองครั้งอ่านจาก `pre.audience` ตัวเดียวกัน
   *    ⇒ ติดไว้กับ object นี้ = ทั้งสองที่เห็นเหมือนกันโดยอัตโนมัติ
   *    ถ้าส่งเป็นพารามิเตอร์แยก จะมีที่หนึ่งที่ลืมส่ง แล้ว "นับผู้รับได้อย่าง
   *    ส่งจริงอีกอย่าง" ซึ่งเป็นความพังที่เงียบที่สุดของระบบนี้
   * ⚠️ ไม่ใส่ / ว่าง = ไม่มีเงื่อนไขเพิ่มเลย ⇒ งานทุกใบที่มีอยู่ได้คิวรี่เดิมเป๊ะ
   */
  readonly skip_line_user_ids?: readonly string[];
  /**
   * [FEAT-2708-GUARDWINDOW] "stamp ต้องสดใน N ชม." ของ job ใบนี้
   *
   * 🔴 อยู่บน **audience** ด้วยเหตุผลเดียวกับ `skip_line_user_ids` ข้างบนเป๊ะ:
   *    ตัวกรองถูกสร้างสองครั้งต่อรอบ (pager + นับผู้รับต่อ OA) และทั้งคู่ต้องเห็น
   *    `reference` ตัวเดียวกัน — ไม่งั้น "นับได้อย่าง ส่งจริงอีกอย่าง"
   * ⚠️ ไม่ใส่ = ไม่มี guard = คิวรี่เดิมทุก byte (job เก่าทุกใบ) · นโยบายว่า
   *    ครอบคีย์ไหน/ช่วงไหน อยู่ที่ `guard-window.policy.ts` ไฟล์เดียว
   */
  readonly guard_window?: {
    readonly hours: unknown;
    readonly reference: unknown;
  };
}

export type FilterResult =
  | {
      readonly ok: true;
      readonly filter: Record<string, unknown>;
      readonly usedSources: readonly AudienceSource[];
    }
  | { readonly ok: false; readonly reason: string; readonly badKey?: string };

/**
 * Build the `members` filter for one set of rules.
 *
 * ⚠️ An EMPTY rule list is `{}` — every member. That is a real answer (a
 * campaign to everyone the OA knows), not an accident, and the caller still has
 * to pass the result through the per-OA narrowing and the recipient ceilings.
 * The ceilings are what stop "everyone" from being unlimited.
 */
/**
 * [FEAT-20260823-BCASTAUDCAP] How many conditions one campaign may carry.
 *
 * 🔴 A CEILING, ADDED WITH THE UI THAT MADE IT REACHABLE. Until 23/08 nothing
 *    could send rules at all, so an unbounded list cost nothing. The rule
 *    builder now has an "add condition" button with no natural stop, and every
 *    rule is another clause in an `$and` against `members` — the collection
 *    with the largest row count in this database.
 *
 *    Eight was chosen to be far above any real campaign and far below anything
 *    that could hurt. It was a POLICY number, not a measured one — the point is
 *    that a ceiling exists, not where exactly it sits.
 *    เพดานต้องมี ไม่งั้นปุ่ม "เพิ่มเงื่อนไข" ไม่มีจุดจบ.
 *
 * 🔴 RAISED 8 → 20 on 25/08/2026, on the owner's explicit instruction after a
 *    live run measured the refusal ("อนุญาติแล้วปลดสิ"). What was measured that
 *    day, against the real collection:
 *      · the registry offers 14 sources and 24 source×operator combinations,
 *        so eight could not even express one rule per source — the reason the
 *        ceiling was hit by an ordinary campaign rather than an abusive one
 *      · every combination builds a valid filter and none throws
 *    Twenty covers every source with headroom and is still a hard stop, which
 *    is the property this constant exists for. It remains a POLICY number:
 *    change it here and nowhere else.
 *
 * ⚠️ REFUSED, NOT TRIMMED. Silently dropping the twenty-first rule would make
 *    the audience WIDER than the admin asked for — the same failure this file
 *    refuses an unknown key to avoid. ตัดทิ้ง = ยิงกว้างกว่าที่สั่ง.
 *
 * revert: set this back to 8. Nothing else knows the number.
 */
export const MAX_AUDIENCE_RULES = 20;

export function buildAudienceFilter(query: AudienceQuery): FilterResult {
  if (!query || (query.match !== 'and' && query.match !== 'or')) {
    return { ok: false, reason: 'match must be "and" or "or"' };
  }
  if (!Array.isArray(query.rules)) {
    return { ok: false, reason: 'rules must be a list' };
  }
  if (query.rules.length > MAX_AUDIENCE_RULES) {
    return {
      ok: false,
      reason: `too many audience conditions — at most ${MAX_AUDIENCE_RULES}`,
    };
  }
  if (query.rules.length === 0) {
    return { ok: true, filter: {}, usedSources: [] };
  }

  const clauses: Record<string, unknown>[] = [];
  const usedSources: AudienceSource[] = [];

  for (const raw of query.rules) {
    // A rule that is not even an object is treated the same as an unknown key:
    // we cannot build it, so we refuse rather than quietly drop a filter.
    const rule: AudienceRule | null =
      raw !== null && typeof raw === 'object' ? (raw as AudienceRule) : null;
    const source = rule ? getAudienceSource(rule.key) : null;
    if (!rule || !source) {
      return {
        ok: false,
        reason:
          'unknown audience key — refusing rather than sending to a wider list than intended',
        badKey: typeof rule?.key === 'string' ? rule.key : '',
      };
    }
    if (!source.ops.includes(rule.op)) {
      return {
        ok: false,
        reason: `"${rule.op}" is not allowed on "${source.key}"`,
        badKey: source.key,
      };
    }
    const clause = clauseFor(source, rule);
    if (!clause) {
      return {
        ok: false,
        reason: `the value for "${source.key}" cannot be used with "${rule.op}"`,
        badKey: source.key,
      };
    }
    /* [FEAT-2708-GUARDWINDOW] the freshness bound merges into THIS rule's own
       clause — never onto an outer `$and`, or a deposit+withdraw `match:'or'`
       job (4 real ones in the DB) would demand BOTH stamps fresh and silently
       drop people who qualify through one leg. `$gte` only NARROWS the rule,
       so the original condition survives inside the same object. Absent
       guard_window ⇒ this whole block is a no-op and the clause is untouched.
       นโยบาย/ช่วง/คีย์ อยู่ที่ guard-window.policy.ts — แก้ที่โน่นไฟล์เดียว */
    if (query.guard_window !== undefined && query.guard_window !== null) {
      const gw = guardWindowBoundFor(
        source.key,
        query.guard_window.hours,
        query.guard_window.reference,
      );
      /* fail closed — a guard the admin ordered that cannot be built must
         refuse the job, not silently widen the audience (same stance as an
         unknown key at the top of this loop). */
      if (!gw.ok) return { ok: false, reason: gw.reason, badKey: source.key };
      if (gw.bound) {
        const inner = clause[path0(clause)];
        clause[path0(clause)] = {
          ...(inner as Record<string, unknown>),
          $gte: gw.bound.$gte,
        };
      }
    }
    /* [FIX-20260828-FORCEPERLEG] THE FORCED CONDITIONS BELONG TO THE RULE THAT
       ASKED FOR THEM — merged into THIS leg, never onto an outer `$and`.
       ===================================================================
       Owner, 28/08, from a job that sent to nobody: a campaign reading
       "was notified about deposits OR about withdrawals OR was shown the
       register card" refused with `this OA was skipped: empty`. The third rule
       is a FORCE_NO_PROFILE key, and the forced `raw_profile_data: null` used to
       be ANDed at the OUTERMOST level — so it also silenced the deposit and
       withdraw legs, which have nothing to do with registering. Every member who
       had linked their profile was dropped from a campaign that was never about
       registration. Measured on the real data at the time: 6 members matched the
       rules, 3 had a room on the OA, and the outer clauses took it to 0.

       The rule now: "must not be linked" applies to the REGISTER-CHASING leg
       only; the deposit/withdraw legs stay unconstrained. This is the same
       placement the guard window already uses a few lines above, and for the
       same reason.

       🔴 WHAT THIS IS NOT, and the distinction the old comment was protecting:
       the danger was never "AND it into the leg" — it was making the forced
       condition a SEPARATE MEMBER of the `$or`, which turns "must not be linked"
       into "or is not linked" and lets linked members qualify. Merging into the
       triggering leg's own object keeps it a hard AND *for that leg*, so the
       register-chasing rule can still never reach a linked member.
       ── CHANGING THE CONDITIONS LATER — where to edit, and where NOT to ──
       This file only ASKS the policies what to force and merges the answer. It
       holds no list of keys and no definition of "not linked". So:
         · which rules force something, and what they force
             → `force-no-profile.policy.ts`   (FORCE_NO_PROFILE_KEYS, NO_PROFILE_CLAUSE)
             → `force-no-follow-up.policy.ts` (FORCE_NO_FOLLOW_UP_RULES)
           Add or drop a key there and this loop picks it up with no edit here.
         · turning a policy off entirely → its own `*_ENABLED` flag, same files
         · a NEW policy of the same shape → give it a `clauseFor(usedKeys)`
           function and add it to the `[legNoProfile, legNoFollowUp.clause]`
           array below; everything else (merge, collision refusal) is generic.
       The ONE thing that must not move again is the PLACEMENT: a forced
       condition belongs to its triggering leg. Outer placement silences the
       other legs (the bug above); a separate `$or` member turns it into an
       escape hatch (the older bug the previous comment guarded).

       ⚠️ For `match: 'and'` this is a no-op by construction — every leg is ANDed
       anyway, so per-leg and outer placement select the same members.
       revert: drop this block and restore `forced` / `noFollowUp.clause` into
       the `extra` array at the bottom of this function. */
    const legNoProfile = forceNoProfileClause([source.key]);
    const legNoFollowUp = forceNoFollowUpClause([source.key]);
    /* fail closed, exactly as the outer call used to: a forced condition that
       cannot be built must refuse the job, never widen it silently. */
    if (!legNoFollowUp.ok) return { ok: false, reason: legNoFollowUp.reason };
    for (const forcedClause of [legNoProfile, legNoFollowUp.clause]) {
      if (!forcedClause) continue;
      for (const [forcedPath, forcedValue] of Object.entries(forcedClause)) {
        /* No policy today forces a path that its own trigger rule also filters
           on, so this cannot fire. It exists because the alternative — letting
           `Object.assign` win — would REPLACE the operator the admin chose with
           a bare `null`, changing the audience while looking correct. Loud
           beats silent. */
        if (forcedPath in clause) {
          return {
            ok: false,
            reason:
              `"${source.key}" forces a condition on "${forcedPath}", which the same rule already filters on — ` +
              'refusing rather than overwriting the condition that was asked for',
            badKey: source.key,
          };
        }
        clause[forcedPath] = forcedValue;
      }
    }

    clauses.push(clause);
    usedSources.push(source);
  }

  /* [FEAT-20260825-FORCENOPROFILE] + [FEAT-20260827-FORCENOFOLLOWUP]
     Both policies are now applied INSIDE the loop above, on the leg of the rule
     that triggers them — see [FIX-20260828-FORCEPERLEG] there for why, for what
     the "never a member of `$or`" warning actually protects against, and for
     where to edit when the conditions themselves need to change. */

  const base: Record<string, unknown> =
    clauses.length === 1
      ? (clauses[0] as Record<string, unknown>)
      : query.match === 'and'
        ? { $and: clauses }
        : { $or: clauses };

  /* [FEAT-20260825-BCASTSKIPASSIST] "ข้ามคนที่แอดมินกำลังคุยอยู่"
     ⚠️ ต่อ **นอกสุด** ด้วยเหตุผลเดียวกับ `forced` ข้างบนเป๊ะ ๆ: ถ้าเอาไปยัดเป็น
        สมาชิกตัวหนึ่งของ `$or` มันจะกลายเป็น "หรือไม่ได้ถูกดูแล" ⇒ คนที่กำลัง
        ถูกดูแลอยู่จะหลุดเข้ามาแทนที่จะถูกกรองออก ซึ่งตรงข้ามกับที่สั่งพอดี
     ⚠️ ใช้ `$nin` บน `line_user_id` ซึ่งเป็นคอลัมน์จริงของ `members` และมีดัชนี
        อยู่แล้ว · ไม่มีการเพิ่มดัชนีใด ๆ จากฟีเจอร์นี้ */
  const skipIds = (query.skip_line_user_ids ?? []).filter(
    (id) => typeof id === 'string' && id.length > 0,
  );
  const skipClause =
    skipIds.length > 0 ? { line_user_id: { $nin: [...skipIds] } } : null;

  /* `skipClause` is the only clause left at the outer level, and it belongs
     there: "skip whoever an admin is talking to right now" is about the PERSON,
     not about any one rule, so it must hold for every leg of an `$or`.
     [FIX-20260828-FORCEPERLEG] the two forced policies used to sit here too. */
  const extra: Record<string, unknown>[] = skipClause ? [skipClause] : [];

  return {
    ok: true,
    filter: extra.length > 0 ? { $and: [base, ...extra] } : base,
    usedSources,
  };
}

/** The one path key of a single-clause object — guarded sources are locked to
 *  `has_value`, whose clause is always `{path: {...}}` (see guard block above). */
const path0 = (clause: Record<string, unknown>): string =>
  Object.keys(clause)[0] as string;

/** One rule → one clause, or null when the value does not fit the operator. */
function clauseFor(
  source: AudienceSource,
  rule: AudienceRule,
): Record<string, unknown> | null {
  const { path } = source;

  switch (rule.op) {
    case 'lte':
    case 'gte': {
      const when = asDate(rule.value);
      if (!when) return null;
      return { [path]: { [`$${rule.op}`]: when } };
    }
    case 'eq': {
      const v = asPrimitive(rule.value);
      return v === null ? null : { [path]: v };
    }
    case 'in': {
      if (!Array.isArray(rule.value) || rule.value.length === 0) return null;
      const values = rule.value.map(asPrimitive).filter((v) => v !== null);
      if (values.length === 0) return null;
      // ⚠️ Also the right operator for an array field: Mongo matches a multikey
      // array against `$in` element-wise, which is what "has any of these" means.
      return { [path]: { $in: values } };
    }
    case 'contains': {
      const v = asPrimitive(rule.value);
      // On an array field, plain equality matches "the array contains this".
      return v === null ? null : { [path]: v };
    }
    /* [FEAT-20260825-HASVALUE] Presence, not magnitude. `rule.value` is IGNORED
       on purpose — the question carries no value, and a rule that arrived with
       a stale one from a previous operator must still build. That is why these
       two are the only cases that can never return null.

       ⭐ NO `$exists`, DELIBERATELY. A bare `null` match already means "missing
       OR explicitly null", which is the whole question, and it keeps this file's
       promise at the top of the file intact. Measured 25/08/2026:
       `{$ne: null}` plans FETCH ← IXSCAN; `{path: null}` plans COLLSCAN — see
       the note on `AudienceOp` for why the second one is unavoidable rather
       than unfixed. */
    case 'has_value':
      return { [path]: { $ne: null } };
    case 'no_value':
      return { [path]: null };
    default:
      return null;
  }
}

/**
 * [FEAT-20260824-BCASTTIMEDOOR] The fifth door, routed through the same reader.
 *
 * 🔴 A RULE'S DATE HAD THE SAME SILENT BUG AS THE FORM'S. This read
 *    `new Date(value)` directly, so a condition typed as "opened a case before
 *    2026-08-24T15:00" meant a different instant depending on the server's
 *    timezone — and unlike a `scheduled_at`, a wrong audience boundary shows up
 *    as "the campaign reached the wrong people", which nobody traces back to a
 *    clock. เงื่อนไขเวลาที่เพี้ยน = ยิงผิดคน และไม่มีใครโยงกลับมาที่นาฬิกา.
 *
 * ⚠️ IT RETURNS `null`, IT DOES NOT THROW — that is this file's contract, and it
 *    matters: `buildAudienceFilter` turns `null` into a REFUSED job rather than
 *    a dropped condition, which is the narrower failure. `parseAdminTime`
 *    throws, so it is caught and converted here.
 *    ไฟล์นี้ต้องคืน null ไม่ใช่โยน — ตัวเรียกจะได้ปฏิเสธทั้ง job แทนที่จะทิ้งเงื่อนไข.
 */
function asDate(value: unknown): Date | null {
  try {
    return parseAdminTime(value, 'rule value') ?? null;
  } catch {
    return null;
  }
}

function asPrimitive(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return null;
}

/**
 * Which of these rules read a field with no index?
 *
 * For the dry-run preview: an un-indexed field is allowed, but the admin should
 * be told the run will be slow BEFORE they schedule it, not after.
 */
export function unindexedKeys(sources: readonly AudienceSource[]): string[] {
  return sources.filter((s) => !s.indexed).map((s) => s.key);
}
