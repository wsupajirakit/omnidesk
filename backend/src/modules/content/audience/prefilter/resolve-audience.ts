/**
 * [FEAT-20260824-BCASTTAGPRE] The pre-step: rules that live in another
 * collection, turned into member ids, IN PLACE.
 * ===========================================================================
 * เจ้าของ 24/08: *"seamless ไหมกระทบไหม ห้ามพังระบบนะ ออกแบบดีๆ ห้ามสร้างหนี้"* ·
 * *"ต้องคิวรี่เร็วไม่สร้างหนี้บวม"* · *"อย่าลืมว่า multicast เรามีเพดานช่วยกันอยู่แล้ว ·
 * เราแค่กันบวมชั้นสอง แต่อย่าโอเวอร์ engineer"*
 *
 * ─── WHAT IT DOES ────────────────────────────────────────────────────────────
 * It REWRITES the rule, it does not merge onto the finished filter:
 *
 *     before   { key: 'customer_tag', op: 'in', value: [<tag ids>] }
 *     after    { key: 'customer_tag', op: 'in', value: [<member ids>] }
 *
 * The key never changes, so `audience-source.registry.ts` still resolves it and
 * still builds `{_id: {$in: […]}}` from its `path: '_id'`.
 *
 * 🔴 WHY IN PLACE, AND NOT `$and`-ING AN ID LIST ONTO THE WHOLE FILTER — THIS IS
 *    THE `or` ANSWER. The obvious merge, `{$and:[<filter>, {_id:{$in:S}}]}`, is
 *    correct for `match:'and'` and WRONG for `match:'or'`: "tagged VIP OR tier
 *    gold" would become "(tagged VIP OR tier gold) AND tagged VIP", which drops
 *    every gold customer who is not VIP. It fails NARROW rather than wide, so
 *    nothing would ever complain — the campaign just quietly reaches fewer
 *    people than the admin asked for, every time.
 *    Substituting the rule's VALUE leaves the boolean tree exactly as the admin
 *    built it, so `and` and `or` are both right for free and `buildAudienceFilter`
 *    keeps being the only thing that knows what `match` means.
 *    แทนค่าในกฎเดิม ⇒ or ถูกอัตโนมัติ · เอา $in ไปครอบทั้งก้อน = or ผิด แต่ผิดแบบเงียบ.
 *
 * 🔴 THE SAME REWRITTEN QUERY GOES TO BOTH READERS. `new-send.service.ts` builds
 *    the filter for the pager and `run-broadcast.ts:195` builds it AGAIN for the
 *    per-OA recipient count. Handing the count the ORIGINAL rules would cost the
 *    campaign against one audience and send it to another — and with tag ids in
 *    an `_id` clause the count would be 0, `run-plan.ts` would call every OA
 *    `empty`, and the campaign would report success having reached nobody.
 *    นับกับส่งต้องใช้ชุดเดียวกัน ไม่งั้นแผนกับของจริงคนละชุด.
 *
 * 🔴 AN EMPTY RESULT MEANS NOBODY — IT MUST NEVER MEAN EVERYONE. A tag nobody
 *    carries is a real answer, and the dangerous version of it is dropping the
 *    rule: the filter then has one condition fewer and the campaign goes to the
 *    whole OA. So an empty resolve keeps the clause and fills it with ONE
 *    freshly generated ObjectId-shaped id that is never written anywhere, i.e. a
 *    clause that is guaranteed to match no member. It also stays correct under
 *    `or`, where the other conditions must still fire.
 *    (`buildAudienceFilter` cannot express `$in: []` — `audience-filter.ts:162`
 *    turns an empty array into a refusal — and that file belongs to another
 *    lane, so this is done with a value rather than an edit.)
 *    tag ที่ไม่มีใครใช้ = ไม่ถึงใคร ห้ามกลายเป็นถึงทุกคน.
 *
 * ─── กันบวม, THE SECOND LAYER ────────────────────────────────────────────────
 * The FIRST layer already exists and this file does not duplicate it:
 * `send-matrix.registry.ts` gives each cell a `maxRecipientsPerOa`
 * (multicast:plain 10,000 · multicast:personal 300) and `run-plan.ts:163` skips
 * an OA that exceeds it. So a resolve can never usefully exceed what the send
 * itself accepts, and the bound here is READ FROM THAT TABLE rather than being a
 * new constant — a second number would drift from the first and nobody would
 * know which one was authoritative. ใช้เพดานเดิม ไม่ตั้งเลขใหม่.
 *
 * 🔴 REFUSED, NOT TRIMMED. Cutting the id list would pick an arbitrary subset by
 *    `_id` order — an admin cannot see who was dropped, and the run would report
 *    a success. The refusal names the count and the ceiling, and travels the
 *    channel that already exists (`refuse()` → `results[].error` → the history
 *    tab). ตัดรายชื่อเงียบ ๆ ไม่ได้ ต้องบอกว่าเกินเท่าไหร่.
 *
 * MEASURED, lane db `boardcast_lane_24aug`, 2026-08-24, explain executionStats,
 * `members` (25 rows) with synthetic ids, `.sort({_id:1}).limit(500)` — the exact
 * shape the pager runs:
 *
 *     $in size    plan          keysExamined   docsExamined   ms
 *        100      IXSCAN _id_        25             0          0
 *      1,000      IXSCAN _id_        25             0          5
 *      5,000      IXSCAN _id_        25             0          6
 *     20,000      IXSCAN _id_        25             0         21
 *     50,000      IXSCAN _id_        25             0        244
 *
 * The ceiling that already exists (10,000) sits in the flat part of that curve;
 * the knee is past 20,000, which the send would refuse anyway.
 *
 * The join itself is one indexed seek and does not grow with the audience — on
 * a real tag (`a0d000000000000000000007`, 3 join rows):
 *     customer_tags.find({tag_id: {$in: […]}})
 *       → IXSCAN `tag_id_1`, totalKeysExamined 3, totalDocsExamined 3,
 *         nReturned 3, 0 ms warm (10 ms on the first, cold, run)
 * and the empty-resolve clause is free: `{_id: {$in: [<sentinel>]}}` →
 * nReturned 0, totalKeysExamined 0, 0 ms.
 *
 * NO INDEX WAS ADDED, no schema was touched, and nothing here writes.
 * ไม่ได้เพิ่ม index · ไม่ได้แตะ schema · ไม่เขียนอะไรลง db.
 *
 * 🔴 NEVER THROWS. A scheduled run must not crash because a lookup failed; every
 *    failure comes back as `{ok:false, reason}` and the caller refuses the job
 *    with it. ล้ม = ปฏิเสธพร้อมเหตุผล ไม่ใช่ crash.
 *
 * revert: delete this folder and the four lines naming it in
 * `new-send.service.ts`. Behaviour returns to exactly what it is today.
 */
import { randomBytes } from 'node:crypto';

import type { AudienceQuery, AudienceRule } from '../sources';
import { getPrefilterResolver, needsPrefilter } from './prefilter.registry';
import type { PrefilterLookup, PrefilterReader } from './prefilter.types';

export interface PrefilterDeps {
  /** Runs one planned lookup. The ONLY thing here that touches Mongo. */
  readonly read: PrefilterReader;
  /**
   * The cell's `maxRecipientsPerOa`, passed straight through.
   *
   * `null`/`undefined` = this combination does not address recipients one by
   * one (`broadcast:*`, where LINE fans out and the id list only ever answers
   * "is it empty"), so there is no list to bloat and no bound to apply.
   */
  readonly maxMembers?: number | null;
  /** Seam for the spec — production uses a real random id. */
  readonly newSentinelId?: () => string;
}

export type PrefilterOutcome =
  | {
      readonly ok: true;
      /** The SAME object when nothing needed resolving. */
      readonly audience: AudienceQuery;
      readonly resolved: false;
    }
  | {
      readonly ok: true;
      readonly audience: AudienceQuery;
      readonly resolved: true;
      /** Distinct member ids the pre-step found, across every rule. */
      readonly matched: number;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * An id that cannot belong to any member: 12 random bytes, generated per
 * resolve and never written to any collection. The chance of colliding with a
 * real `_id` are the same 2^-96 the driver already relies on to make `_id`
 * unique in the first place — this is not a new assumption.
 */
const freshSentinel = (): string => randomBytes(12).toString('hex');

export async function resolveAudiencePrefilter(
  audience: AudienceQuery,
  deps: PrefilterDeps,
): Promise<PrefilterOutcome> {
  try {
    /* 🔴 THE ZERO-COST PATH. A campaign with no pre-resolved rule returns the
       SAME object, having asked no question of any collection. Everything below
       this line is unreachable for every campaign that exists today.
       ไม่มีกฎ tag = ไม่มี query เพิ่ม และได้ object เดิมกลับไป. */
    /* Read into a local of the declared type: `Array.isArray` on a
       `readonly T[]` property narrows it to `any[]`, and an `any` walking into
       the substitution below would let a malformed rule through untyped. */
    const rules: readonly AudienceRule[] =
      audience !== null &&
      typeof audience === 'object' &&
      Array.isArray(audience.rules)
        ? (audience.rules as readonly AudienceRule[])
        : [];
    if (rules.length === 0 || !needsPrefilter(rules)) {
      return { ok: true, audience, resolved: false };
    }

    /* ── plan every rule BEFORE reading anything ──────────────────────────
       One refusal beats a half-run pre-step: if the second tag rule is
       unbuildable we would rather not have queried for the first. */
    const lookups: PrefilterLookup[] = [];
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      if (rule === null || rule === undefined || typeof rule !== 'object') {
        continue;
      }
      const resolver = getPrefilterResolver(rule.key);
      if (resolver === null) continue; // an ordinary `members` rule
      const planned = resolver.planLookup(rule, i);
      if ('error' in planned) return { ok: false, reason: planned.error };
      lookups.push(planned);
    }
    // `needsPrefilter` said yes, so this cannot be empty — but a resolver that
    // is removed while a saved job still names its key would land here, and
    // walking on would leave the rule holding foreign ids.
    if (lookups.length === 0) {
      return {
        ok: false,
        reason:
          'this campaign selects by a source that is no longer resolvable — ' +
          'refusing rather than sending to a wider list than intended',
      };
    }

    const bound =
      typeof deps.maxMembers === 'number' && deps.maxMembers > 0
        ? deps.maxMembers
        : null;
    const sentinel = (deps.newSentinelId ?? freshSentinel)();
    const byRule = new Map<number, string[]>();
    const everyone = new Set<string>();

    for (const lookup of lookups) {
      let rows: readonly unknown[];
      try {
        rows = await deps.read(lookup);
      } catch (e) {
        return {
          ok: false,
          reason:
            `could not read ${lookup.describe}: ` +
            `${e instanceof Error ? e.message : 'unknown error'}`,
        };
      }
      if (!Array.isArray(rows)) {
        return { ok: false, reason: `could not read ${lookup.describe}` };
      }

      /* Deduped per rule: one member carrying two of the named tags returns two
         join rows, and an `$in` with the id twice is the same query with a
         bigger document. คนเดียวติดสอง tag = แถวซ้ำ ต้องตัดออก. */
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const id = idText(
          row !== null && typeof row === 'object'
            ? (row as Record<string, unknown>)[lookup.memberIdField]
            : undefined,
        );
        if (id === null || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        everyone.add(id);
      }

      if (bound !== null && everyone.size > bound) {
        return {
          ok: false,
          reason:
            `${lookup.describe} matches more than ${bound} members, and this ` +
            'send combination allows ' +
            `${bound} for one OA — narrow the campaign before sending`,
        };
      }
      byRule.set(lookup.ruleIndex, ids);
    }

    return {
      ok: true,
      resolved: true,
      matched: everyone.size,
      audience: {
        match: audience.match,
        rules: rules.map((rule, i) => {
          const ids = byRule.get(i);
          if (ids === undefined) return rule;
          return {
            key: rule.key,
            /* Always `in`, even when the admin picked one tag with `eq`: the
               answer is a LIST of members either way. */
            op: 'in' as const,
            // 🔴 The empty case. See the header — never an empty list, never a
            // dropped rule. ว่าง = ใส่ id ที่ไม่มีทางตรงกับใคร.
            value: ids.length > 0 ? ids : [sentinel],
          };
        }),
      },
    };
  } catch (e) {
    /* The contract is that this never rejects — the send path calls it inside a
       method whose whole promise is that it answers instead of throwing. */
    return {
      ok: false,
      reason: `the audience pre-step failed: ${e instanceof Error ? e.message : 'unknown error'}`,
    };
  }
}

/**
 * The hex of an id, whatever wrapper it arrived in.
 *
 * ⚠️ `String(value)` is avoided for the same reason `oa-selection.ts` avoids it:
 * an object without `toHexString` yields `'[object Object]'`, and a list of
 * those dedupes to ONE entry — a tag with 500 members would resolve to a single
 * bogus id and the campaign would reach nobody. ห้าม String() ตรง ๆ.
 */
function idText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toHexString?: unknown }).toHexString === 'function'
  ) {
    return (value as { toHexString: () => string }).toHexString();
  }
  return null;
}
