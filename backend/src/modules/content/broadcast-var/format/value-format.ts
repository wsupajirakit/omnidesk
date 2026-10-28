/**
 * [FEAT-20260822-BCASTFORMATCLONE] Our own copy of the value formatters.
 * ===========================================================================
 * 🧬 A CLONE, by the owner's decision (D38, 2026-08-22: "clone ทั้งสเปกและ
 * formatter") — so the broadcast path shares NO runtime code with the original
 * var path and cannot change its behaviour by accident.
 *
 * SOURCES, copied verbatim rather than retyped:
 *   · `webhook/flex/flex-data-vars.util.ts`   — readSpecPath, primitiveText,
 *     dateTimeFormatters, formatDateTime, pickRule, applyFormat,
 *     formatFlexVar, formatSiteRulesVar
 *   · `system/dict-spec/flex-var-format-rules.ts` — the FORMAT_RULES table
 *
 * ⚠️ THE ORIGINAL ALREADY KEEPS TWO COPIES ON PURPOSE (runtime + the frozen
 *    preview), and its header forbids merging them because profile and
 *    site_rules format differently. This is the third, and it is only safe
 *    because `broadcast-var-format-drift.spec.ts` feeds the SAME inputs to both
 *    ours and the original and requires the SAME outputs.
 *
 * 🔴 THE ONE INTENTIONAL DIFFERENCE, AND IT IS NOT IN THIS FILE.
 *    The empty marker stays `-` here, exactly as upstream. Our `N/A` is applied
 *    afterwards by `checks/empty-value.ts`, as a separate pass over the finished
 *    map. Putting it here would make every drift comparison fail for a reason
 *    that has nothing to do with drift. ต่างกันตรงไหน ต้องอยู่นอกไฟล์นี้.
 *
 * ⚠️ Do not "improve" anything below. A difference from the original is a bug.
 *
 * revert: delete this folder and its drift spec.
 */

import { FORMAT_RULES } from './format-rules';

/** The dictionary lookup the formatters call. Same shape as upstream. */
export type TranslateFn = (
  dict: string,
  key: unknown,
  opts: { scope?: string; path?: string; tool?: string },
) => string | null;

/** Shown wherever a value is null/undefined/'' — upstream's `FLEX_VAR_EMPTY`. */
export const FLEX_VAR_EMPTY = '-';

export interface FlexBuildOpts {
  tool?: string | null;
  scope?: string | null;
}

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

export { readSpecPath, formatFlexVar, formatSiteRulesVar, applyFormat };
