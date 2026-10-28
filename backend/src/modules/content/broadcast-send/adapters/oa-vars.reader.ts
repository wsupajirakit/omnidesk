/**
 * [FEAT-20260823-BCASTOAVARS] The values a card can fill in on a BROADCAST.
 * ===========================================================================
 * 🔴 WHY THIS FILE IS ABOUT *OA* VARIABLES AND NOT *RECIPIENT* ONES.
 *
 * `/message/broadcast` is ONE request that LINE fans out to every follower.
 * There is no recipient list, so there is no place to put a different value
 * for a different person — that is LINE's design, not our limitation. A
 * variable can therefore only be filled here when it is **the same for
 * everyone in one OA**:
 *
 *   ✅ `hook_*` (domain, company, description) · `site_rules.*`  — per OA
 *   ❌ `member.*` · `profile.*`                                  — per person
 *
 * The per-person family still RENDERS: `buildBroadcastVars` turns a missing
 * value into `N/A`, so the customer sees a readable card instead of a literal
 * `{{profile.bank_code}}`, which is what the old sender ships.
 *
 * 🔴 CORRECTED 31/08 — this used to add "and every tag it could not fill comes
 *    back in `unknownTags` so an admin is told rather than left guessing".
 *    THE OPPOSITE IS TRUE, and believing it is how a reader mis-reads the whole
 *    plain path: `buildBroadcastVars` pre-fills EVERY tag in the spec and
 *    `normalizeEmpties` guarantees none is `''`, so `substitute.ts` sees them
 *    as resolved and they NEVER reach `unknownTags`. Only a tag outside the
 *    spec (a typo) is reported. An admin who ticks plain on a card full of
 *    `{{profile.*}}` is told NOTHING — which is exactly why the save-time gate
 *    `[FIX-20260831-BCASTPROFILEGATE]` had to exist.
 *    ไม่มีใครเตือน เพราะระบบถือว่าเติมค่าแล้ว (เป็น N/A) — ไม่ใช่ tag ที่ไม่รู้จัก.
 * ⇒ การ์ดที่ต้องใช้ค่าเฉพาะคน ต้องส่งทาง multicast เท่านั้น.
 *
 * WHY THE WHOLE MAP IS BUILT UP FRONT, not looked up during the run:
 * `PlainCardMessageBuilder` renders in its constructor on purpose — a card
 * that cannot be rendered must fail BEFORE the job is claimed, not halfway
 * through a send. Reading the rows lazily would move that failure inside the
 * run. A job has a handful of OAs, so one `$in` read costs nothing.
 * อ่านทีเดียวก่อนเริ่ม ⇒ พังตั้งแต่ยังไม่จอง job.
 *
 * revert: delete this file, drop it from `adapters/index.ts`, and hand
 * `PlainCardMessageBuilder` a plain `{}` again.
 */
import {
  buildBroadcastVars,
  siteRulesScopeOf,
  HOOK_WEB_CODE_COLUMN,
  type TranslateFn,
} from '../../broadcast-var';

/**
 * The hook columns this reader needs — and NOTHING else.
 *
 * ⚠️ Names verified against `hook.schema.ts` (`raw_site_rules_data:431`) and
 * `HOOK_CONTEXT_COLUMNS`, not from memory: a guessed column name would select
 * nothing, `buildBroadcastVars` would fill `N/A` for every tag, and the card
 * would ship looking "correctly empty" with no error anywhere.
 * เดาชื่อคอลัมน์ = การ์ดว่างแบบเงียบ ๆ ไม่มี error ให้ตาม.
 */
export const OA_VAR_COLUMNS = {
  _id: 1,
  raw_site_rules_data: 1,
  domain_name: 1,
  company_name: 1,
  description: 1,
  /* [FEAT-20260903-BCASTOASCOPE] the dictionary scope for `site_rules.*` — the
     same column the site-rules request is built from. Verified against
     `hook.schema.ts:963` AND a real row (`local_db_10_aug_26`: `sim_beta`,
     `demo-omnidesk`), because a column that only exists in the source selects
     nothing and leaves the scope null — the exact bug this closes. */
  [HOOK_WEB_CODE_COLUMN]: 1,
  /* [FEAT-20260903-BCASTSRFRESH] when the blob was last fetched. Feeds the
     freshness decision AND `site_rules_age_days`, which had no producer at all
     before today. Absent on most real rows — that is the common case, not the
     edge one. */
  site_rules_updated_at: 1,
} as const;

/**
 * The shape `TranslationDictCacheService.translate` really has.
 *
 * ⚠️ Declared here rather than imported so this file stays a leaf: everything
 *    in `broadcast-send/` is pure, and reaching into `@/modules/system` for a
 *    type would be the first thread of a module dependency.
 */
export type DictTranslate = (
  dict: string,
  key: string | number | boolean | null | undefined,
  opt?: { tool?: string; scope?: string; path?: string },
) => string | null;

/**
 * Adapt the dictionary service to the `TranslateFn` the var path expects.
 *
 * 🔴 A REAL NARROWING, NOT A CAST. `TranslateFn` hands `key: unknown` while
 * the service accepts only primitives, so `as DictKey` would compile and then
 * hand the service an object, whose `String(key)` lookup silently misses every
 * dictionary entry — a wrong translation with nothing to trace. Converting
 * here makes the one case that cannot be looked up (`{}`, an array) explicit
 * and gives it defined behaviour. `as` ทำให้ผ่าน compile แล้วแปลไม่เจอแบบเงียบ ๆ.
 */
function asDictKey(key: unknown): string | number | boolean | null | undefined {
  if (
    key === null ||
    key === undefined ||
    typeof key === 'string' ||
    typeof key === 'number' ||
    typeof key === 'boolean'
  ) {
    return key;
  }
  /* `[object Object]` is the RIGHT answer here: it is a key no dictionary
     holds, so the lookup misses and the caller keeps the raw value — the same
     outcome as any other unknown key, reached deliberately. */
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(key);
}

export function toTranslateFn(translate: DictTranslate): TranslateFn {
  return (dict, key, opts) => translate(dict, asDictKey(key), opts);
}

/** One hook row, as this reader needs it. */
export interface OaVarRow {
  readonly _id: unknown;
  readonly raw_site_rules_data?: unknown;
  readonly [column: string]: unknown;
}

/** hookId → the values every recipient of that OA sees. */
export type OaVarMap = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/**
 * Build the per-OA value map for one run.
 *
 * Never throws: a hook row that cannot be read contributes an empty map, and
 * the card still renders with `N/A` where that OA's values would have gone.
 * One unreadable OA must not cost the other OAs their campaign.
 */
/**
 * The hook's id as a string. `_id` is an ObjectId or a string and both have a
 * meaningful `toString` — the same reasoning (and the same guard shape) as
 * `stringifyToolId` in `flex-data-vars.util.ts:83-91`.
 */
function idText(id: unknown): string {
  if (id === null || id === undefined) return '';
  if (typeof id === 'string') return id;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(id);
}

export function buildOaVarMap(
  rows: readonly OaVarRow[],
  translate: TranslateFn,
): OaVarMap {
  const out: Record<string, Readonly<Record<string, string>>> = {};
  for (const row of rows) {
    const id = idText(row?._id);
    if (id === '') continue;
    const scope = siteRulesScopeOf(row);
    out[id] = buildBroadcastVars({
      storedProfile: undefined,
      storedSiteRules: row['raw_site_rules_data'],
      /* 🔴 `null` ON PURPOSE — see the header. A broadcast has no single
         recipient, so every `member.*` tag becomes `N/A` and is reported. */
      member: null,
      hook: row,
      translate,
      /* [FEAT-20260903-BCASTOASCOPE] the one thing a broadcast can say about
         WHICH SITE it is talking about. Without it every site-specific word in
         `site_rules.*` fell back to its raw value — silently, on this path
         only. `undefined` when the hook has no web code, which is the same
         null the code reached before. */
      ...(scope === undefined ? {} : { scope }),
    });
  }
  return out;
}
