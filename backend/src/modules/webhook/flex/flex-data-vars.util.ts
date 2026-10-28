/**
 * [FIX-20260808-FLEXVARMAP] RUNTIME flex variable-map assembly.
 *
 * This is the reply-path twin of the frozen preview util
 * (`content/flex-var/flex-var-guidelines.ts`). The preview util walks the spec
 * over a COMMITTED demo profile to build the `/variables` example column; this
 * file walks the SAME spec over the REAL customer profile so a card renders
 * "Bangkok Bank" / "judy" / "0" instead of "-".
 *
 * Ported from `legacy-api@dev_sec`:
 *   · `buildFlexVarMaps`        — controllers/core-bot/webhookController.js:1486-1521
 *   · `buildFlexProfileVarMap`  — config/flexVarSpec.js:445-529
 *   · `buildSiteRulesVarMap`    — config/siteRulesVarSpec.js:270-290
 *   · `pickByRole`              — services/core-bot/customToolService.js:983-994
 *   · `FLEX_VAR_SOURCES`        — config/flexVarSources.js:37-64
 *   · the formatters           — config/flexVarSpec.js:360-378 (profile),
 *                                config/siteRulesVarSpec.js:221-245 (site_rules),
 *                                config/flexVarFormatRules.js (shared rule engine)
 *
 * PURE — no I/O, no DB, no HTTP, no @Injectable. Everything it needs (the real
 * profile data, the hook, and `translate`) is passed in as an argument, exactly
 * as legacy hands them in. The caller (webhook.service) closes over the
 * translation-dict cache's `translate` and injects the orchestrator as the
 * `buildDataVars` dep of the flex reply builder.
 *
 * ⚠️⚠️ FORMATTER COPY — DELIBERATE, DO NOT "TIDY". The two formatters
 *   (`formatFlexVar` / `formatSiteRulesVar`) plus their helpers (`applyFormat`,
 *   `pickRule`, `formatDateTime`, `primitiveText`) are COPIED here from the
 *   frozen preview util rather than imported or shared. Sharing would mean
 *   editing `flex-var-guidelines.ts`, which is frozen because its exports feed
 *   the flex-save allowlist. The two formatters MUST stay byte-behaviour in sync
 *   with their legacy sources and with the preview copy — profile vs site_rules
 *   differ ON PURPOSE (site_rules has a boolean→เปิด/ปิด net and a different
 *   array/object-vs-dict ordering; profile does not). One shared formatter would
 *   silently change values on one side.
 *
 *   ต่างจากไฟล์ preview ตรงเดียว: ที่นี่เป็น RUNTIME จึงร้อย `tool` เข้า translate
 *   ด้วย (ตาม legacy flexVarSpec.js:374-375 / siteRulesVarSpec.js:232-233) — ชั้น
 *   preview ตั้ง tool=null เสมอ เลยตัด tool ทิ้งได้ แต่ runtime ต้องมี ไม่งั้นชั้น
 *   คำแปลเฉพาะ custom tool จะตายเงียบ.
 */

import { resolveBankNiceName } from '../../content/bank-directory';
import {
  FORMAT_RULES,
  canonicalFlexPath,
  pickShop,
  walkFlexVarSpec,
  walkSiteRulesSpec,
} from '../../system';
import {
  extractFlexProfileFields,
  resolveSourceRoles,
} from './flex-render.util';

/** Shown wherever a value is null/undefined/'' — legacy `FLEX_VAR_EMPTY`. */
const FLEX_VAR_EMPTY = '-';

/**
 * Translates a value for a layered dictionary, or null when the word is unknown.
 *
 * ⚠️ `scope`/`path`/`tool` are not decoration — the dictionary is layered, and a
 *    site-specific (scope), path-specific, or tool-specific override only applies
 *    when the matching key is passed. Legacy runtime threads all three
 *    (flexVarSpec.js:374-375); the preview path passes tool as null.
 *
 * This is the shape the copied `applyFormat` calls, and a SUPERSET-compatible
 * subset of `TranslationDictCacheService.translate` — the caller passes that
 * method (bound) straight in.
 */
export type TranslateFn = (
  dict: string,
  key: unknown,
  opts: { scope?: string; path?: string; tool?: string },
) => string | null;

/**
 * legacy resolveDictTool (webhookController.js:1482-1484) — `String(x)` when the
 * id is present, else null. `custom_tool_id` is a primitive or a Mongo ObjectId;
 * both have a real `toString`, so `String()` is faithful. Guarded to satisfy the
 * `no-base-to-string` lint without changing the runtime answer for those types.
 */
function stringifyToolId(id: unknown): string | null {
  if (id === null || id === undefined || id === '') return null;
  if (typeof id === 'object') {
    // ObjectId / any wrapper with a meaningful toString → String(id) equivalent.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(id);
  }
  return primitiveText(id);
}

// ───────────────────────────────────────────────────────────────────────────
// Path reading — legacy readFlexPath / readPath, adapted for expanded paths
// ───────────────────────────────────────────────────────────────────────────

/**
 * [FIX-20260808-FLEXVARMAP] Reads an ALREADY-EXPANDED spec path out of a data
 * object. This mirrors the private `readSpecPath` in the frozen preview util
 * (flex-var-guidelines.ts) — it is copied for the same reason the formatters
 * are: importing it would touch the frozen file.
 *
 * Legacy `readFlexPath` only splits on `.`, because it never sees a bracketed
 * segment: legacy's own build walks the raw spec and resolves `list`/`indexed`
 * rows structurally before reading. This port drives off `walkFlexVarSpec`,
 * which hands over the expanded path, so the two bracket forms legacy generates
 * are understood here instead:
 *   finance.balances[0].amount          list    → element 0
 *   finance.balances[asset_code=cash].amount  indexed → element whose key matches
 * Equivalent to legacy's `arr[i-1]` and its `map[item[by]] = item` index.
 */
function readSpecPath(root: unknown, path: string): unknown {
  let current: unknown = root;

  for (const segment of String(path).split('.')) {
    if (current === null || current === undefined) return undefined;

    const head = /^([^[]*)((?:\[[^\]]*\])*)$/.exec(segment);
    if (!head) return undefined;

    const [, name, brackets] = head;
    current = name ? (current as Record<string, unknown>)[name] : current;
    if (!brackets) continue;

    for (const group of brackets.match(/\[[^\]]*\]/g) ?? []) {
      if (current === null || current === undefined) return undefined;
      const selector = group.slice(1, -1);
      if (!Array.isArray(current)) return undefined;

      const equals = selector.indexOf('=');
      if (equals === -1) {
        current = current[Number(selector)];
      } else {
        const key = selector.slice(0, equals);
        const wanted = selector.slice(equals + 1);
        current = current.find(
          (item) =>
            item !== null &&
            item !== undefined &&
            (item as Record<string, unknown>)[key] !== undefined &&
            (item as Record<string, unknown>)[key] !== null &&
            String((item as Record<string, unknown>)[key]) === wanted,
        );
      }
    }
  }

  return current;
}

// ───────────────────────────────────────────────────────────────────────────
// FORMATTER COPY — byte-behaviour copy of flex-var-guidelines.ts (frozen).
// Keep in sync with that file AND with legacy flexVarSpec.js:360-378 (profile),
// siteRulesVarSpec.js:221-245 (site_rules), flexVarFormatRules.js (rule engine).
// The ONLY runtime-specific change vs the preview copy: `tool` is threaded into
// the translate opts (legacy flexVarSpec.js:374-375). See file header.
// ───────────────────────────────────────────────────────────────────────────

/**
 * String form of a non-object value. Copied from flex-var-guidelines.ts.
 * Positive typeof checks (not `String(value)` after negative guards) so what
 * reaches `String()` is provably a primitive; anything unforeseen degrades to
 * the empty marker.
 */
function primitiveText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'bigint':
    case 'boolean':
    case 'symbol':
      return String(value);
    default:
      return FLEX_VAR_EMPTY;
  }
}

const TZ = 'Asia/Bangkok';
let dateFormatter: Intl.DateTimeFormat | undefined;
let timeFormatter: Intl.DateTimeFormat | undefined;

/**
 * ⚠️ `th-TH-u-ca-gregory`, not `th-TH`. Plain `th-TH` defaults to the Buddhist
 * calendar and would render 2569 where legacy renders 2026. Copied from
 * flex-var-guidelines.ts.
 */
function dateTimeFormatters(): [Intl.DateTimeFormat, Intl.DateTimeFormat] {
  if (!dateFormatter || !timeFormatter) {
    dateFormatter = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: TZ,
    });
    timeFormatter = new Intl.DateTimeFormat('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: TZ,
    });
  }
  return [dateFormatter, timeFormatter];
}

/** Copied from flex-var-guidelines.ts. Null → caller keeps the raw value. */
function formatDateTime(value: unknown): string | null {
  let date: Date;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    date = new Date(String(value));
  }
  if (Number.isNaN(date.getTime())) return null;
  try {
    const [formatDate, formatTime] = dateTimeFormatters();
    return `${formatDate.format(date)} ${formatTime.format(date)}`;
  } catch {
    return null;
  }
}

/**
 * Context a value carries while being rendered. Copied from
 * flex-var-guidelines.ts, plus `tool` — the RUNTIME dictionary lookup narrows on
 * the hook's custom tool as well as scope/path (legacy flexVarSpec.js ctx).
 */
interface FormatContext {
  path: string;
  field: string;
  canonical: string;
  fullPath: string;
  scope?: string;
  tool?: string;
}

/**
 * Which rule governs this value, or null. Copied from flex-var-guidelines.ts.
 *
 * ⚠️ Rule ORDER is behaviour. FORMAT_RULES is already ordered; do not sort it.
 */
function pickRule(
  raw: unknown,
  ctx: FormatContext,
): (typeof FORMAT_RULES)[number] | null {
  for (const rule of FORMAT_RULES) {
    if (rule.isBoolean) {
      const lowered = typeof raw === 'string' ? raw.toLowerCase() : raw;
      if (typeof raw === 'boolean' || lowered === 'true' || lowered === 'false')
        return rule;
      continue;
    }
    if (rule.canonical && rule.canonical === ctx.canonical) return rule;
    if (
      rule.field &&
      (rule.field instanceof RegExp
        ? rule.field.test(ctx.field)
        : rule.field === ctx.field)
    ) {
      return rule;
    }
  }
  return null;
}

/**
 * Applies the matching rule; null means "no rule, keep the raw value". Copied
 * from flex-var-guidelines.ts, with the RUNTIME `tool` threaded into translate —
 * legacy flexVarSpec.js:374-375 / siteRulesVarSpec.js:232-233 both pass
 * `{ tool: ctx.tool, scope: ctx.scope, path: ctx.fullPath || ctx.path }`.
 */
function applyFormat(
  raw: unknown,
  ctx: FormatContext,
  translate: TranslateFn,
): string | null {
  const rule = pickRule(raw, ctx);
  if (!rule) return null;
  if (rule.dict)
    return (
      translate(rule.dict, raw, {
        scope: ctx.scope,
        path: ctx.fullPath || ctx.path,
        tool: ctx.tool,
      }) || null
    );
  if (rule.format === 'datetime') {
    try {
      return formatDateTime(raw) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * PROFILE formatter. Copied from flex-var-guidelines.ts (`formatFlexVar`),
 * legacy flexVarSpec.js:360-378.
 *
 * ⚠️ Every layer fails safe to the raw value. Returning '' is never acceptable:
 *    LINE rejects a whole flex card if a text field is empty. Null/undefined and
 *    a whitespace-only string become '-'; a real `0` / `false` survives via
 *    `primitiveText`.
 */
function formatFlexVar(
  value: unknown,
  ctx: FormatContext | null,
  translate: TranslateFn,
): string {
  if (value === null || value === undefined) return FLEX_VAR_EMPTY;
  if (Array.isArray(value))
    return value.length ? value.join(', ') : FLEX_VAR_EMPTY;
  if (typeof value === 'object' || typeof value === 'function')
    return FLEX_VAR_EMPTY;

  if (ctx) {
    try {
      const hit = applyFormat(value, ctx, translate);
      if (hit) return hit;
    } catch {
      // Raw value below is a correct answer.
    }
  }

  const text = primitiveText(value);
  return text.trim() === '' ? FLEX_VAR_EMPTY : text;
}

/**
 * SITE_RULES formatter. Copied from flex-var-guidelines.ts
 * (`formatSiteRulesVar`), legacy siteRulesVarSpec.js:221-245.
 *
 * ⚠️ TWO deliberate differences from the profile formatter — NOT tidy-able:
 *   1. the array / object checks run AFTER the dictionary, opposite of profile;
 *   2. a boolean safety net below the dictionary renders เปิด/ปิด even when the
 *      dictionary is unavailable.
 * Both verified against the live response. Sharing one formatter would silently
 * change values on one source.
 */
function formatSiteRulesVar(
  value: unknown,
  ctx: FormatContext,
  translate: TranslateFn,
): string {
  if (value === null || value === undefined) return FLEX_VAR_EMPTY;

  try {
    const hit = applyFormat(value, ctx, translate);
    if (hit) return hit;
  } catch {
    // Raw value below is a correct answer.
  }

  if (typeof value === 'boolean') return value ? 'เปิด' : 'ปิด';
  if (Array.isArray(value))
    return value.length ? value.join(', ') : FLEX_VAR_EMPTY;
  if (typeof value === 'object' || typeof value === 'function')
    return FLEX_VAR_EMPTY;

  const text = primitiveText(value);
  return text.trim() === '' ? FLEX_VAR_EMPTY : text;
}

// ───────────────────────────────────────────────────────────────────────────
// REAL-DATA builds
// ───────────────────────────────────────────────────────────────────────────

/** opts threaded down to the format layer — legacy `{ tool, scope }`. */
export interface FlexBuildOpts {
  tool?: string | null;
  scope?: string | null;
}

/**
 * [FIX-20260808-FLEXVARMAP] REAL-DATA profile map — legacy
 * `buildFlexProfileVarMap` (config/flexVarSpec.js:445-529). The preview form in
 * flex-var-guidelines.ts is the TEMPLATE; this takes the injected `profile` and
 * `opts.{tool,scope}` instead of the demo sample. Same spec-walk, same
 * indexed-cache intent (handled inside `readSpecPath` per row), same per-value
 * ctx (path/field/canonical/fullPath/scope/tool), same `bank_code` nice-name
 * override at the end.
 *
 * รับ null / ก้อนพัง / ก้อนไม่ครบได้หมด — ช่องที่ไม่มี = "-" ไม่ throw.
 */
export function buildFlexProfileVarMap(
  profile: unknown,
  opts: FlexBuildOpts = {},
  translate: TranslateFn,
): Record<string, string> {
  const p = profile && typeof profile === 'object' ? profile : {};
  const out: Record<string, string> = {};

  // legacy flexVarSpec.js:466 — scope = profile.web_code, override-able by opts.
  //   ⚠️ opts.scope wins so the shop block (no web_code of its own) and the
  //      profile block share ONE scope, set by the orchestrator.
  const scopeFromProfile = readSpecPath(p, 'web_code');
  const scope =
    opts.scope ??
    (typeof scopeFromProfile === 'string' ? scopeFromProfile : undefined);
  const tool = opts.tool ?? undefined;

  walkFlexVarSpec((tag, path) => {
    out[tag] = formatFlexVar(
      readSpecPath(p, path),
      {
        path,
        // legacy computes field the same for every row kind: last dotted segment
        field: String(path).split('.').pop() ?? '',
        canonical: canonicalFlexPath(path),
        fullPath: `data.profile.${path}`,
        scope,
        tool,
      },
      translate,
    );
  });

  // [FEAT-20260802-BANKNICE] legacy flexVarSpec.js:524-527 — {{bank_code}} shows
  //   the pretty name (bbl → Bangkok Bank), overwriting the raw code the walk
  //   just wrote. Unknown code keeps its original value (never blank / throw).
  const rawBankCode = readSpecPath(p, 'bank.code');
  out['bank_code'] = formatFlexVar(
    rawBankCode ? resolveBankNiceName(rawBankCode) : rawBankCode,
    null,
    translate,
  );

  return out;
}

/**
 * [FIX-20260808-FLEXVARMAP] REAL-DATA site_rules map — legacy
 * `buildSiteRulesVarMap` (config/siteRulesVarSpec.js:270-290). Reuses
 * `pickShop` (finds the shop block in any response shape) and `walkSiteRulesSpec`.
 *
 * ⚠️ The shop block carries no `web_code`, so `scope` MUST come from opts — the
 *    orchestrator passes the profile's web_code. Without it, site-specific words
 *    die silently on this source only (legacy siteRulesVarSpec.js:277-284).
 * ⚠️ `data.shop.` fullPath prefix, not `data.profile.` — different stored key.
 */
export function buildSiteRulesVarMap(
  raw: unknown,
  opts: FlexBuildOpts = {},
  translate: TranslateFn,
): Record<string, string> {
  const shop = pickShop(raw);
  const out: Record<string, string> = {};
  const tool = opts.tool ?? undefined;
  const scope = opts.scope ?? undefined;

  walkSiteRulesSpec((tag, path) => {
    out[tag] = formatSiteRulesVar(
      readSpecPath(shop, path),
      {
        path,
        field: String(path).split('.').pop() ?? '',
        canonical: canonicalFlexPath(path),
        fullPath: `data.shop.${path}`,
        scope,
        tool,
      },
      translate,
    );
  });

  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// pickByRole — the runtime block picker
// ───────────────────────────────────────────────────────────────────────────

/**
 * [FIX-20260808-FLEXVARMAP] Find a data block by its declared `role`, then by a
 * fallback key regex — legacy `customToolService.pickByRole`
 * (services/core-bot/customToolService.js:983-994). Used by the site_rules
 * `pick` below: `pickByRole(profileData, 'site_rules', /site.?rule/i)?.block?.data`.
 */
export function pickByRole(
  combined: unknown,
  role: string,
  fallbackKeyRe: RegExp | null = null,
): { key: string; block: Record<string, unknown> } | null {
  if (!combined || typeof combined !== 'object' || !role) return null;
  const entries = Object.entries(combined as Record<string, unknown>);
  for (const [key, block] of entries) {
    if (block && (block as Record<string, unknown>)['role'] === role)
      return { key, block: block as Record<string, unknown> };
  }
  if (fallbackKeyRe) {
    for (const [key, block] of entries) {
      if (fallbackKeyRe.test(key))
        return { key, block: block as Record<string, unknown> };
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Source registry — legacy config/flexVarSources.js:37-64
// ───────────────────────────────────────────────────────────────────────────

/**
 * A runtime source: `pick` extracts this source's data block from the combined
 * external-API result; `build` turns that block into a `{ tag → string }` map.
 * `implicit` (exactly one) means its tags need no `<role>.` prefix.
 */
interface FlexVarSource {
  implicit?: boolean;
  pick: (profileData: unknown) => unknown;
  build: (
    data: unknown,
    opts: FlexBuildOpts,
    translate: TranslateFn,
  ) => Record<string, string>;
}

/**
 * [FIX-20260808-FLEXVARMAP] The RUNTIME source registry — legacy
 * `FLEX_VAR_SOURCES` (config/flexVarSources.js:37-64), wired to the real-data
 * builds above. `profile` is implicit + always first (added by
 * `resolveSourceRoles`).
 *
 * ⚠️ Exactly ONE implicit source. `profile`'s tags double as un-prefixed
 *    (`{{bank_code}}` === `{{profile.bank_code}}`); every other source must be
 *    written out. Two sources therefore cannot collide structurally.
 */
export const FLEX_VAR_SOURCES: Record<string, FlexVarSource> = {
  profile: {
    implicit: true,
    // legacy flexVarSources.js:52-58 — the profile block is found by is_profile,
    //   handled inside extractFlexProfileFields (flex-render.util.ts).
    pick: (profileData) => extractFlexProfileFields(profileData).profile,
    build: (data, opts, translate) =>
      buildFlexProfileVarMap(data, opts, translate),
  },
  site_rules: {
    // legacy flexVarSources.js:60-63 — find the endpoint by role, fallback key.
    pick: (profileData) =>
      pickByRole(profileData, 'site_rules', /site.?rule/i)?.block?.['data'] ??
      null,
    build: (data, opts, translate) =>
      buildSiteRulesVarMap(data, opts, translate),
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Orchestrator — legacy webhookController.js:1486-1521
// ───────────────────────────────────────────────────────────────────────────

/**
 * [FIX-20260808-FLEXVARMAP] Build the full namespaced var-map for one card —
 * legacy `buildFlexVarMaps` (controllers/core-bot/webhookController.js:1486-1521).
 *
 * @param doc         the card (its `source_roles` / `source_role` decide sources)
 * @param profileData the combined external-API result (all data blocks)
 * @param hook        the OA hook — its `custom_tool_id` names the dictionary tool
 * @param translate   the layered dictionary lookup (webhook.service closes over
 *                    `translationDict.translate`)
 * @returns `{ 'profile.bank_code': 'Bangkok Bank', 'bank_code': 'Bangkok Bank',
 *            'site_rules.dep_min': '100', … }`
 *
 * ⚠️⚠️ [FIX-20260802-FLEXNSEMPTY] legacy webhookController.js:1502-1514 — a source
 *   that is SELECTED but whose `pick` returns null/undefined MUST NOT be skipped.
 *   `build(null, opts, translate)` still runs so every one of its tags becomes
 *   "-". Skip it and the card leaks raw `{{bank_account_name}}` braces to the
 *   customer. Real case: customer has no linked account (no profile) but the card
 *   uses profile + site_rules — profile slots become "-", site_rules keeps real
 *   values, the card does not break.
 *
 * ⚠️ dictOpts is built ONCE (legacy :1495-1498): `scope` = the profile block's
 *    web_code, shared with BOTH sources (the shop block has no web_code of its
 *    own — [REFACTOR-20260803-DICTIDENTITY] P4).
 *
 * ⚠️ Each source is wrapped in try/catch: on throw, skip THAT source, never
 *    throw out of the map build (legacy :1516-1518).
 */
export function buildFlexVarMaps(
  doc: { source_roles?: unknown; source_role?: unknown } | null | undefined,
  profileData: unknown,
  hook: Record<string, unknown> | null | undefined,
  translate: TranslateFn,
): Record<string, string> {
  // profile implicit + always first — resolveSourceRoles injects DEFAULT_SOURCE.
  const roles = resolveSourceRoles(doc ?? null, FLEX_VAR_SOURCES);
  const out: Record<string, string> = {};

  const webCode = extractFlexProfileFields(profileData).profile?.['web_code'];
  const dictOpts: FlexBuildOpts = {
    // legacy resolveDictTool — String(hook.custom_tool_id) when present, else null.
    tool: stringifyToolId(hook?.['custom_tool_id']),
    scope: typeof webCode === 'string' ? webCode : null,
  };

  for (const role of roles) {
    const src = FLEX_VAR_SOURCES[role];
    if (!src) continue;
    try {
      const data = src.pick(profileData);
      // ⚠️ Even when pick returns null, STILL build — every tag → "-".
      const map = src.build(data ?? null, dictOpts, translate) || {};
      for (const [k, v] of Object.entries(map)) {
        out[`${role}.${k}`] = v; // always namespaced
        if (src.implicit && !(k in out)) out[k] = v; // implicit → also bare tag
      }
    } catch {
      // Skip this source; never take the whole map down (legacy :1516-1518).
    }
  }

  return out;
}
