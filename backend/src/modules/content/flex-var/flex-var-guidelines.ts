/**
 * The variable guideline table behind `GET /api/flex-messages/variables`.
 *
 * Source: legacy-api `src/config/flexVarSpec.js` (`buildFlexProfileVarMap`,
 * `buildFlexVarGuidelines`), `src/config/flexVarSources.js` and the formatter
 * half of `src/config/flexVarFormatRules.js`.
 *
 * ── WHAT WAS ALREADY HERE, AND WHY THIS FILE IS SMALL ────────────────────────
 * The spec itself — 451 rows of tag/path/desc — was ported for the
 * translation-dict `/usage` endpoint and lives in
 * `@/modules/system/dict-spec/flex-var-spec`. It was verified row-for-row
 * against the live legacy response before this file was written: 451 rows,
 * zero tag/path/desc mismatches. So nothing here re-declares a variable. This
 * file adds only the two things `/usage` never needed:
 *
 *   1. the `example` column — the spec walk gives no values, and legacy
 *      computes every example by running the REAL formatter over a committed
 *      demo profile. Hand-writing them would drift silently the day a rule
 *      changes, which is exactly why legacy refuses to.
 *   2. the source registry (`profile` / `site_rules`) and the context rows.
 *
 * ── WHY THE EXAMPLES ARE COMPUTED, NOT COPIED ────────────────────────────────
 * Legacy's own comment on the sample file is emphatic: the example column is
 * "ผลลัพธ์จริงเสมอ" — always the real result. A field the demo profile has no
 * value for shows `-`, because that is what the card would render. Copying the
 * 451 strings out of a captured response would produce an identical payload
 * today and a lying one after the first rule change.
 */

import {
  FORMAT_RULES,
  SITE_RULES_SAMPLE,
  canonicalFlexPath,
  pickShop,
  walkFlexVarSpec,
  walkSiteRulesSpec,
} from '@/modules/system';

import { resolveBankNiceName } from '../bank-directory';
import SAMPLE_RAW from './customer-profile-sample.json';

/** Shown wherever the demo profile has no value — legacy `FLEX_VAR_EMPTY`. */
const FLEX_VAR_EMPTY = '-';

/** Card types the endpoint accepts; anything else falls back to `normal`. */
export const FLEX_VAR_TYPES = [
  'normal',
  'profile',
  'custom',
  'profile-semi-custom',
  // [FEAT-20260810-CUSHELPERTYPE] ต้องอยู่ในลิสต์นี้ ไม่งั้น getFlexVariableGuidelines
  // จะ normalize ทิ้งเป็นค่า default ก่อนถึงเงื่อนไขที่แจก {{cus_land_url}}
  // (ได้ชุด tag ของ profile แทน แล้ว tag ใหม่จะไม่โผล่เลย — เจอตอนยิงจริง)
  'customerhelper',
  /* [FEAT-20260831-MENUVARSET] `menu` is a REAL type here now, and that single
     line is what stops a menu card inheriting the customer-variable catalogue:
     while it was absent, `getFlexVariableGuidelines` coerced it to `'normal'`
     and handed it every `{{profile.*}}` / `{{site_rules.*}}` row. Being listed
     only makes the type recognised — which rows it gets is decided at the call
     site, where the sources are skipped for it.
     revert: remove this entry (menu falls back to the normal catalogue). */
  'menu',
] as const;

/**
 * `{{content}}` — the bot's own reply, substituted into the card instead of
 * being sent as a separate message. Only profile-shaped cards carry it, so it
 * is pushed conditionally and always first.
 */
const CONTENT_VAR = {
  tag: 'content',
  desc: 'ข้อความที่บอทกำลังจะตอบ (ถูกแทนลงในการ์ดแทนการส่งเป็นข้อความ)',
  source: 'คำตอบของบอทในรอบนั้น',
  example: 'ยอดเครดิตคงเหลือ 572.41 บาทค่ะ',
  noPrefix: true,
} as const;

/** A row as the guideline builders produce it, before the controller wraps it. */
export interface GuidelineRow {
  tag: string;
  desc: string;
  source: string;
  example?: unknown;
  noPrefix?: boolean;
}

/** The row shape actually sent to the dashboard. */
export interface VariableRow extends GuidelineRow {
  legacy_tag?: string;
  source_role: string;
  source_label: string;
}

/**
 * Translates a value for a dictionary, or null when the word is unknown.
 *
 * ⚠️ `scope` and `path` are not optional decoration — the dictionary is layered,
 * and a site-specific or path-specific entry only applies when both are passed.
 * Dropping them silently downgrades every example to the base layer, which is a
 * difference the value diff catches but the shape diff would not.
 */
export type TranslateFn = (
  dict: string,
  key: unknown,
  opts: { scope?: string; path?: string },
) => string | null;

// ───────────────────────────────────────────────────────────────────────────
// Value reading
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reads a spec path out of the demo profile.
 *
 * Legacy's `readFlexPath` only splits on `.`, because the bracketed segments
 * never reach it — `buildFlexProfileVarMap` walks the raw spec and resolves
 * `list` and `indexed` rows structurally before reading. This port drives off
 * `walkFlexVarSpec`, which hands over the ALREADY-EXPANDED path, so the
 * brackets have to be understood here instead. The two forms legacy generates:
 *
 *   deposit[0].amount             list      → element 0 of the array
 *   balances[asset_code=cash].amount   indexed → the element whose key matches
 *
 * Resolving them here is equivalent to legacy's `arr[i - 1]` and its
 * `map[item[by]] = item` index, and it avoids exporting the raw spec purely so
 * this file could re-walk it a second way.
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

    // Repeated groups, so `products[0][1]` resolves rather than silently yielding
    // "-" — the failure legacy's own comment records having shipped once.
    for (const group of brackets.match(/\[[^\]]*\]/g) ?? []) {
      if (current === null || current === undefined) return undefined;
      const selector = group.slice(1, -1);
      if (!Array.isArray(current)) return undefined;

      const equals = selector.indexOf('=');
      if (equals === -1) {
        // A list row past the end of the array is legitimately absent and
        // becomes "-", exactly as `item ? item[field] : null` does.
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

/**
 * String form of a non-object value.
 *
 * Written as POSITIVE typeof checks rather than `String(value)` after a chain of
 * negative guards, because `unknown` minus null/undefined narrows only to `{}`
 * — which the compiler still treats as object-shaped, so `String()` on it is a
 * potential `[object Object]`. Listing the primitives makes the safety checkable
 * instead of asserted, and anything unforeseen degrades to the empty marker.
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

// ───────────────────────────────────────────────────────────────────────────
// Formatting — the half of flexVarFormatRules.js that /usage did not need
// ───────────────────────────────────────────────────────────────────────────

const TZ = 'Asia/Bangkok';
let dateFormatter: Intl.DateTimeFormat | undefined;
let timeFormatter: Intl.DateTimeFormat | undefined;

/**
 * ⚠️ `th-TH-u-ca-gregory`, not `th-TH`. Plain `th-TH` defaults to the Buddhist
 * calendar and would render 2569 where legacy renders 2026. Forcing the
 * calendar is also why date and time are formatted separately rather than with
 * one `toLocaleString` call.
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

/**
 * The three time units the upstream API genuinely sends — milliseconds,
 * seconds, and ISO. Anything unguessable returns null so the caller keeps the
 * raw value; returning empty would blank a card field.
 */
function formatDateTime(value: unknown): string | null {
  let date: Date;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Below 1e12 cannot be a millisecond timestamp in any plausible year.
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    date = new Date(String(value));
  }
  if (Number.isNaN(date.getTime())) return null;
  try {
    const [formatDate, formatTime] = dateTimeFormatters();
    return `${formatDate.format(date)} ${formatTime.format(date)}`;
  } catch {
    // ICU without the Thai locale — keep the raw value rather than emit junk.
    return null;
  }
}

/**
 * Context a value carries while being rendered.
 *
 * `path`/`field`/`canonical` select the RULE; `fullPath`/`scope` narrow the
 * DICTIONARY lookup. `fullPath` is the `data.profile.`-prefixed spelling that
 * `translation_dict.path` actually stores — the bare spec path would miss.
 */
interface FormatContext {
  path: string;
  field: string;
  canonical: string;
  fullPath: string;
  scope?: string;
}

/**
 * Which rule governs this value, or null.
 *
 * ⚠️ Rule ORDER is behaviour. The boolean catch-all sits last, so a path with
 * its own rule (`promotion.has_active_promotion` → `yesno`) is not swallowed by
 * the generic `bool`. FORMAT_RULES is already ordered; do not sort it.
 */
function pickRule(
  raw: unknown,
  ctx: FormatContext,
): (typeof FORMAT_RULES)[number] | null {
  for (const rule of FORMAT_RULES) {
    if (rule.isBoolean) {
      // The upstream API sends booleans as real booleans in some fields and as
      // the strings "true"/"false" in others; both must translate.
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

/** Applies the matching rule; null means "no rule, keep the raw value". */
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
 * One value, rendered as the card would render it.
 *
 * ⚠️ Every layer here fails safe to the raw value. Returning an empty string is
 * never acceptable: LINE rejects a whole flex card if any text field is empty,
 * so a dictionary miss or a thrown formatter must degrade to the original.
 */
function formatFlexVar(
  value: unknown,
  ctx: FormatContext | null,
  translate: TranslateFn,
): string {
  if (value === null || value === undefined) return FLEX_VAR_EMPTY;
  if (Array.isArray(value))
    return value.length ? value.join(', ') : FLEX_VAR_EMPTY;
  // An object has no sensible one-line rendering. `function` is folded in with
  // it so that what reaches String() below is provably a primitive — JSON data
  // never carries one, and legacy's object branch is the same answer.
  if (typeof value === 'object' || typeof value === 'function')
    return FLEX_VAR_EMPTY;

  if (ctx) {
    try {
      const hit = applyFormat(value, ctx, translate);
      if (hit) return hit;
    } catch {
      // Deliberately silent: the raw value below is a correct answer.
    }
  }

  const text = primitiveText(value);
  return text.trim() === '' ? FLEX_VAR_EMPTY : text;
}

// ───────────────────────────────────────────────────────────────────────────
// The demo profile
// ───────────────────────────────────────────────────────────────────────────

/**
 * `{ data: { profile } }`, `{ profile }` and a bare profile are all accepted,
 * because the file is regenerated by pasting a real API response wholesale.
 */
const SAMPLE_PROFILE: Record<string, unknown> = (() => {
  const raw = SAMPLE_RAW as Record<string, unknown>;
  const data = raw['data'] as Record<string, unknown> | undefined;
  const fromData = data?.['profile'] as Record<string, unknown> | undefined;
  const fromRoot = raw['profile'] as Record<string, unknown> | undefined;
  return fromData ?? fromRoot ?? raw ?? {};
})();

/**
 * Every profile tag mapped to its rendered example.
 *
 * `scope` is the demo account's `web_code`, which lets a site-specific
 * dictionary entry apply to the examples exactly as it would to a real card.
 * `tool` is null here — no hook is in play — so only the base dictionary layer
 * is consulted, which is legacy's behaviour when the endpoint is called.
 */
export function buildFlexProfileVarMap(
  translate: TranslateFn,
): Record<string, string> {
  const out: Record<string, string> = {};
  const scopeValue = readSpecPath(SAMPLE_PROFILE, 'web_code');
  const scope = typeof scopeValue === 'string' ? scopeValue : undefined;

  walkFlexVarSpec((tag, path) => {
    out[tag] = formatFlexVar(
      readSpecPath(SAMPLE_PROFILE, path),
      {
        path,
        // Legacy computes the field the same way for every row kind: the last
        // dotted segment. `deposit[0].amount` → `amount`.
        field: String(path).split('.').pop() ?? '',
        canonical: canonicalFlexPath(path),
        fullPath: `data.profile.${path}`,
        scope,
      },
      translate,
    );
  });

  /**
   * ⚠️ Deliberately OVERWRITES the value the walk just wrote.
   *
   * `{{bank_code}}` must show the pretty name (`bbl` → `Bangkok Bank`), not the
   * raw code. An unknown code keeps its original value rather than blanking.
   */
  const rawBankCode = readSpecPath(SAMPLE_PROFILE, 'bank.code');
  out['bank_code'] = formatFlexVar(
    rawBankCode ? resolveBankNiceName(rawBankCode) : rawBankCode,
    null,
    translate,
  );

  return out;
}

/** Profile rows: `{{content}}` first for profile cards, then the whole spec. */
export function buildFlexVarGuidelines(
  flexType: string,
  translate: TranslateFn,
): GuidelineRow[] {
  const sample = buildFlexProfileVarMap(translate);
  const rows: GuidelineRow[] = [];

  if (flexType === 'profile' || flexType === 'profile-semi-custom') {
    rows.push({ ...CONTENT_VAR, tag: `{{${CONTENT_VAR.tag}}}` });
  }

  walkFlexVarSpec((tag, path, desc) => {
    rows.push({
      tag: `{{${tag}}}`,
      desc,
      source: `profile.${path}`,
      example: sample[tag],
    });
  });

  return rows;
}

// ───────────────────────────────────────────────────────────────────────────
// Site rules — the second source
// ───────────────────────────────────────────────────────────────────────────

/**
 * As `formatFlexVar`, with two deliberate differences that are NOT tidy-able.
 *
 *   1. the array / object checks run AFTER the dictionary rather than before,
 *      which is the opposite of the profile side;
 *   2. there is a boolean safety net below the dictionary, so a raw `true`
 *      still renders เปิด/ปิด even if the dictionary is unavailable.
 *
 * Both were verified against the live response. Sharing one formatter between
 * the two sources would silently change values on one of them.
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

/**
 * ⚠️ No `scope`. The shop block, unlike the profile, carries no `web_code`, so
 * legacy can only scope these when a caller passes one — and this endpoint has
 * no hook in hand, so it does not. Site-specific words therefore do not apply
 * to the site-rules examples, on legacy exactly as here.
 */
function buildSiteRulesGuidelines(translate: TranslateFn): GuidelineRow[] {
  const shop = pickShop(SITE_RULES_SAMPLE);
  const rows: GuidelineRow[] = [];

  walkSiteRulesSpec((tag, path, desc) => {
    rows.push({
      tag: `{{${tag}}}`,
      desc,
      source: `site_rules.${path}`,
      example: formatSiteRulesVar(
        readSpecPath(shop, path),
        {
          path,
          field: String(path).split('.').pop() ?? '',
          canonical: canonicalFlexPath(path),
          // `data.shop.`, not `data.profile.` — a different stored prefix.
          fullPath: `data.shop.${path}`,
        },
        translate,
      ),
    });
  });

  return rows;
}

// ───────────────────────────────────────────────────────────────────────────
// Source registry
// ───────────────────────────────────────────────────────────────────────────

/** The source used when a card names none. */
export const DEFAULT_SOURCE = 'profile';

interface FlexVarSource {
  label: string;
  /** An implicit source needs no `<role>.` prefix on its tags. Exactly one. */
  implicit: boolean;
  guide: (flexType: string, translate: TranslateFn) => GuidelineRow[];
}

/**
 * ⚠️ `site_rules` is REGISTERED BUT NOT BUILDABLE — see `listFlexVarSources`.
 *
 * Namespacing is the whole design: `profile` is implicit, so `{{bank_code}}`
 * and `{{profile.bank_code}}` are the same tag, and every other source must be
 * written out. Two sources therefore cannot collide structurally, which is why
 * there is no precedence rule to get wrong.
 */
export const FLEX_VAR_SOURCES: Record<string, FlexVarSource> = {
  profile: {
    label: 'โปรไฟล์ลูกค้า',
    implicit: true,
    guide: (flexType, translate) => buildFlexVarGuidelines(flexType, translate),
  },
  site_rules: {
    label: 'กติกา/ตั้งค่าเว็บ',
    implicit: false,
    guide: (_flexType, translate) => buildSiteRulesGuidelines(translate),
  },
};

/** Selectable sources for the form's chips — implicit first, as legacy sorts. */
export function listFlexVarSources(): {
  value: string;
  label: string;
  implicit: boolean;
}[] {
  return Object.entries(FLEX_VAR_SOURCES)
    .map(([value, source]) => ({
      value,
      label: source.label,
      implicit: Boolean(source.implicit),
    }))
    .sort((a, b) => (b.implicit ? 1 : 0) - (a.implicit ? 1 : 0));
}

// ───────────────────────────────────────────────────────────────────────────
// Context variables — appended to every response, whatever the source
// ───────────────────────────────────────────────────────────────────────────

/**
 * Values that come from the conversation rather than from any API: the hook
 * being talked to. They are never namespaced, because `{{site_rules.hook_name}}`
 * would resolve to nothing.
 *
 * ⚠️ Empty is `''`, NOT `'-'`. These get concatenated into sentences
 * ("เข้าเว็บ {{hook_domain}}"), where a stray dash reads worse than a gap.
 */
const CTX_SAMPLE_HOOK: Record<string, string> = {
  domain_name: 'example.com',
  company_name: 'ชื่อเว็บของคุณ',
  description: 'คำอธิบายเว็บสั้น ๆ',
};

const CONTEXT_VARS: {
  tag: string;
  label: string;
  field: keyof typeof CTX_SAMPLE_HOOK;
}[] = [
  { tag: 'hook_domain', label: 'โดเมนเว็บของ hook', field: 'domain_name' },
  { tag: 'hook_name', label: 'ชื่อเว็บของ hook', field: 'company_name' },
  { tag: 'hook_detail', label: 'คำอธิบายเว็บของ hook', field: 'description' },
];

/**
 * ⚠️ `{{content}}` is NOT here even though legacy registers it alongside these.
 * It depends on the card type, so the profile guide emits it via `flexType`;
 * listing it twice would duplicate the row.
 */
/**
 * ==== [FEAT-20260810-CUSHELPERTYPE] tag เฉพาะการ์ด customer-helper ====
 *
 * `{{cus_land_url}}` = ลิงก์หน้า customer-landing ที่ mint ให้ลูกค้าคนนั้นโดยเฉพาะ
 * (mintLinkToken + buildCustomerRegisterUrl — เส้นเดียวกับ customer-register)
 *
 * ⚠️ เปิดให้ **เฉพาะ flexType 'customerhelper'** ตามที่เจ้าของสั่ง เพราะ:
 *   - token ผูกกับ hook + ผู้ใช้ + เวลา ใช้ได้ครั้งเดียวช่วงสั้น ๆ
 *   - การ์ดชนิดอื่นถูกส่งคนละจังหวะ ลิงก์จะหมดอายุก่อนลูกค้าเห็น
 *   - ตารางนี้เป็น allowlist ตอน validate ด้วย ⇒ พิมพ์ tag นี้ในการ์ดชนิดอื่น
 *     จะถูกตีกลับตั้งแต่ตอนเซฟ ไม่ใช่ไปโผล่เป็น {{...}} ดิบที่ลูกค้า
 *
 * HOW TO CHANGE LATER: อยากให้ชนิดอื่นใช้ได้ ⇒ แก้เงื่อนไขในผู้เรียก
 * (flex-messages.service.ts ตรงที่เรียกฟังก์ชันนี้) ไม่ต้องแก้ที่นี่
 * revert: ลบฟังก์ชันนี้ + จุดที่เรียก ⇒ tag หายไปจากตารางและถูกตีกลับเหมือนเดิม
 */
export function buildCustomerHelperVarGuidelines(): GuidelineRow[] {
  return [
    {
      tag: '{{cus_land_url}}',
      desc: 'ลิงก์เชื่อมต่อข้อมูล (mint ให้ลูกค้าคนนั้นโดยเฉพาะ ใช้ได้ชั่วคราว)',
      source: 'ระบบสร้างให้ตอนส่ง (customer-landing)',
      example: 'https://customer.example.com/?t=<token>',
      noPrefix: true,
    },
  ];
}

export function buildContextVarGuidelines(): GuidelineRow[] {
  return CONTEXT_VARS.map(({ tag, label, field }) => {
    const raw = CTX_SAMPLE_HOOK[field];
    return {
      tag: `{{${tag}}}`,
      desc: `${label} (ไม่ได้ตั้ง = ค่าว่าง ไม่ใช่ -)`,
      source: `hook.${field}`,
      // Same emptiness test as formatFlexVar, but the empty value is '' here.
      example:
        raw === undefined || String(raw).trim() === '' ? '' : String(raw),
      noPrefix: true,
    };
  });
}
