/**
 * The flex RENDER path — legacy `webhookController.js:1246-1487`.
 *
 * This is where the four render-time content-fashion functions plug in. Legacy
 * does it at line 1407 inside `renderFlexDoc`; `renderFlexDoc` below is that
 * function, and it is why `buildContentTagMap` / `stripContentMarkers` now have
 * a call site in this repo.
 *
 * Everything here is PURE — no database, no HTTP. The document and the profile
 * data are handed in already fetched, exactly as legacy hands them in.
 */

import {
  buildContentTagMap,
  stripContentMarkers,
} from './flex-content-markers.util';
import {
  FALLBACK_IMAGE_URL,
  isUsableImageUrl,
} from './flex-image-fallback.util';
// [FEAT-20260814-PROMODROP] the site-rules spec walker — same import seam
// flex-data-vars.util.ts uses; the promo-fashion tag set below is DERIVED from the
// spec so it can never drift from the tags the var-map actually produces.
import { walkSiteRulesSpec } from '../../system';

// ───────────────────────────────────────────────────────────────────────────
// Context variables — legacy config/flexVarSources.js:90-195
// ───────────────────────────────────────────────────────────────────────────

/**
 * Variables that come from the conversation rather than any API.
 *
 * ⚠️ This set must stay SMALL AND CLOSED. Anything sourced from an API belongs
 *    in the source registry, never here, or this becomes a junk drawer.
 * ⚠️ `empty` differs per variable and is not a detail: `{{content}}` falls back
 *    to `'-'` like every other variable, but the three hook fields fall back to
 *    `''`. They get concatenated into sentences ("เข้าเว็บ {{hook_domain}}"),
 *    where a stray dash reads worse than a gap.
 */
interface ContextVarDef {
  empty: string;
  build: (ctx: FlexContextInput) => unknown;
}

export interface FlexContextInput {
  hook?: Record<string, unknown> | null;
  content?: unknown;
}

const FLEX_CONTEXT_VARS: Record<string, ContextVarDef> = {
  content: { empty: '-', build: (ctx) => ctx.content },
  hook_domain: { empty: '', build: (ctx) => ctx.hook?.['domain_name'] },
  hook_name: { empty: '', build: (ctx) => ctx.hook?.['company_name'] },
  hook_detail: { empty: '', build: (ctx) => ctx.hook?.['description'] },
};

/**
 * Build the context variable map. Legacy flexVarSources.js:179-195.
 *
 * ⚠️ Must match `formatFlexVar` exactly: `trim()` decides only WHETHER the
 *    value is empty. The value returned is the ORIGINAL string, untrimmed —
 *    `{{content}}` has always behaved this way and must keep doing so.
 * ⚠️ An array joins with ', '; any other object is treated as empty; a thrown
 *    builder is treated as empty. None of these can take the reply path down.
 */
export function buildContextVarMap(
  ctx: FlexContextInput = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(FLEX_CONTEXT_VARS)) {
    let raw: unknown;
    try {
      raw = v.build(ctx);
    } catch {
      raw = null;
    }
    if (raw === null || raw === undefined) {
      out[k] = v.empty;
      continue;
    }
    if (Array.isArray(raw)) {
      out[k] = raw.length ? raw.join(', ') : v.empty;
      continue;
    }
    if (typeof raw === 'object') {
      out[k] = v.empty;
      continue;
    }
    const s = String(raw);
    out[k] = s.trim() === '' ? v.empty : s;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Source roles — legacy config/flexVarSources.js:209-227
// ───────────────────────────────────────────────────────────────────────────

/** The source used when a card names none. */
export const DEFAULT_SOURCE = 'profile';

/**
 * What the card stored → which sources to read, across three shapes:
 *   `source_roles` (current, array) → `source_role` (older, single) → [profile]
 *
 * ⭐ [FIX-20260802-NSBASE] The implicit source is ALWAYS included, even when the
 *    card selected only extra sources. Un-prefixed tags (`{{bank_account_name}}`)
 *    must resolve at all times; drop the base and a card that picked only
 *    `site_rules` leaks raw `{{...}}` to the customer. Costs nothing when there
 *    is no data — every fashion just renders as '-'.
 *
 * Names absent from the registry are filtered out, so a stale or deleted source
 * in the document degrades instead of throwing.
 */
export function resolveSourceRoles(
  doc: { source_roles?: unknown; source_role?: unknown } | null | undefined,
  registry: Record<string, unknown>,
): string[] {
  const raw: unknown[] =
    Array.isArray(doc?.source_roles) && doc.source_roles.length
      ? (doc.source_roles as unknown[])
      : doc?.source_role
        ? [doc.source_role]
        : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [DEFAULT_SOURCE, ...raw]) {
    const k = String(r ?? '').trim();
    if (!k || seen.has(k) || !registry[k]) continue;
    seen.add(k);
    out.push(k);
  }
  return out.length ? out : [DEFAULT_SOURCE];
}

// ───────────────────────────────────────────────────────────────────────────
// Profile extraction — legacy services/core-bot/flexProfileFieldsService.js
// ───────────────────────────────────────────────────────────────────────────

export interface FlexProfileFields {
  fullName: string;
  phone: string;
  hasProfile: boolean;
  profile: Record<string, unknown> | null;
}

/**
 * Find the customer profile inside the combined external-API result.
 *
 * ⚠️⚠️ [FIX-20260801-FLEXPROFILEPATH] The block SHAPE has been got wrong before.
 *   `customToolService` stores `combined[key] = { success, status, data: r.data,
 *   is_profile }` where `r.data` is the API's WHOLE body, i.e.
 *   `{ data: { profile: {...} }, success: true }`. The real path is therefore
 *   `block.data.data.profile`, not `block.data.profile`. Several shapes are
 *   tried rather than relying on one.
 *
 * ⚠️ The block must carry the `is_profile` flag AND actually hold a profile. A
 *   flag-only test picks a flagged block whose request failed, and the fallback
 *   below never runs — yielding empty fields while another block had the data.
 */
export function extractFlexProfileFields(
  profileData: unknown,
): FlexProfileFields {
  const pickProfile = (b: unknown): Record<string, unknown> | null => {
    const blk = b as Record<string, unknown> | null | undefined;
    const d = blk?.['data'] as Record<string, unknown> | undefined;
    const dd = d?.['data'] as Record<string, unknown> | undefined;
    return (
      (dd?.['profile'] as Record<string, unknown> | undefined) ??
      (d?.['profile'] as Record<string, unknown> | undefined) ??
      (blk?.['profile'] as Record<string, unknown> | undefined) ??
      null
    );
  };

  const blocks: unknown[] =
    profileData && typeof profileData === 'object'
      ? Object.values(profileData as Record<string, unknown>)
      : [];

  const block =
    blocks.find(
      (b) =>
        (b as Record<string, unknown> | null)?.['is_profile'] && pickProfile(b),
    ) ??
    blocks.find((b) => pickProfile(b)) ??
    null;

  const p = pickProfile(block);
  const bank = p?.['bank'] as Record<string, unknown> | undefined;
  return {
    fullName: (bank?.['account_name'] as string) ?? '',
    phone: (p?.['phone'] as string) ?? '',
    hasProfile: Boolean(p),
    profile: p ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Variable substitution — legacy webhookController.js:1256-1361
// ───────────────────────────────────────────────────────────────────────────

/**
 * Marker meaning "delete this component".
 *
 * ⚠️ MUST NOT escape to the caller. A Symbol that reached `JSON.stringify`
 *    would become a malformed payload and LINE would reject the whole message.
 *    `applyFlexProfileVars` converts a top-level drop to `null` for exactly
 *    this reason, and there is a test pinning it.
 */
const FLEX_DROP = Symbol('drop-flex-component');

export interface ApplyFlexVarsOptions {
  /**
   * Tag names whose component is REMOVED when they render empty — i.e. only the
   * content slots the card declares.
   *
   * ⭐ A card declaring nothing passes an empty Set, `isOnlyDeclaredTags` then
   *    always returns false, `FLEX_DROP` can never be produced, and every line
   *    added for this feature is a no-op. That is a STRUCTURAL proof that legacy
   *    cards are untouched, not an incidental outcome.
   *
   * ⚠️ Why slots are removed rather than filled with '-' like other variables:
   *    a card declaring 10 slots where the model fills 3 would show 7 dashes on
   *    every send. An ordinary variable keeps '-' because it sits next to a
   *    label that would otherwise dangle.
   */
  dropWhenEmpty?: Set<string>;
}

/**
 * Substitute `{{...}}` throughout a flex document.
 *
 * ⚠️ Always works on a COPY — the document read from Mongo is never mutated.
 * ⚠️ Values only, never keys: a flex key is a LINE property name.
 * ⚠️ An unknown tag keeps its original text rather than blanking, so a typo is
 *    visible instead of silent. (The save-time allowlist normally prevents one.)
 */
export function applyFlexProfileVars(
  node: unknown,
  vars: Record<string, string> | null | undefined,
  opts: ApplyFlexVarsOptions = {},
): unknown {
  const dropWhenEmpty =
    opts.dropWhenEmpty instanceof Set ? opts.dropWhenEmpty : new Set<string>();
  const map: Record<string, string> =
    vars && typeof vars === 'object' ? vars : {};

  /**
   * ⚠️ The regex carries /g but is only ever used with `.replace`, which resets
   *    `lastIndex` itself. It must never be handed to `.test`.
   * ⚠️ `.` is accepted in tag names to allow namespaces (`{{site_rules.dep_min}}`).
   *    No pre-existing tag contains a dot, so this widening cannot change them.
   */
  const replaceIn = (s: unknown): string =>
    String(s).replace(
      /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
      (whole: string, name: string) => {
        const key = String(name).toLowerCase();
        return Object.prototype.hasOwnProperty.call(map, key)
          ? map[key]!
          : whole;
      },
    );

  /**
   * Is this string made up ONLY of content slots this card declares?
   * Decides "delete when empty" (a content fashion) from "render '-'" (any other
   * variable).
   *
   * ⚠️ Must be judged on the text BEFORE substitution — afterwards an empty
   *    result is indistinguishable from a genuinely blank label.
   * ⚠️ `'{{content.a}} บาท'` does NOT qualify and still renders '-', because
   *    deleting it would take the word "บาท" with it.
   */
  const isOnlyDeclaredTags = (s: unknown): boolean => {
    if (!dropWhenEmpty.size || typeof s !== 'string') return false;
    let sawDeclared = false;
    const leftover = s.replace(
      /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
      (whole: string, name: string) => {
        if (dropWhenEmpty.has(String(name).toLowerCase())) {
          sawDeclared = true;
          return '';
        }
        return whole;
      },
    );
    return sawDeclared && !leftover.trim();
  };

  const walk = (n: unknown): unknown => {
    if (typeof n === 'string') return replaceIn(n);
    // An array is the only place a member can actually be removed; a box left
    // with no children is removed by the rule further down.
    if (Array.isArray(n)) return n.map(walk).filter((c) => c !== FLEX_DROP);
    if (n && typeof n === 'object') {
      const src = n as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) out[k] = walk(v);

      /**
       * ⚠️⚠️ [FIX-20260801-FLEXEMPTYTEXT] LINE returns 400 for a `type:"text"`
       *   component whose `text` is empty — "A message (messages[0]) in the
       *   request body is invalid" — and the customer then gets NOTHING, though
       *   the rest of the card was fine. Happened for real when a customer had
       *   no name or phone on file.
       *
       *   '-' shows "no data" while keeping the card sendable.
       *   ⚠️ Only real text COMPONENTS — never a `text` property on some other
       *      component type, and never an unrelated empty string.
       */
      if (
        out['type'] === 'text' &&
        (typeof out['text'] !== 'string' || !out['text'].trim())
      ) {
        // A declared content fashion the model did not fill → drop the component.
        // Everything else keeps '-' exactly as before.
        if (isOnlyDeclaredTags(src['text'])) return FLEX_DROP;
        out['text'] = '-';
      }

      /**
       * ⚠️⚠️ [FEAT-20260804-FLEXIMGFALLBACK] Same reasoning as empty text: an
       *   unusable image url makes LINE reject the entire message.
       */
      if (
        (out['type'] === 'image' || out['type'] === 'icon') &&
        !isUsableImageUrl(out['url'])
      ) {
        out['url'] = FALLBACK_IMAGE_URL;
      }

      /**
       * A box whose children were all removed removes itself, cascading upward.
       * ⚠️ Necessary: LINE rejects a box with empty `contents`.
       * ⚠️ Guarded on `dropWhenEmpty.size` ON PURPOSE — an existing card that
       *    deliberately holds an empty box must keep its exact behaviour rather
       *    than start disappearing because of a feature it does not use.
       */
      if (
        dropWhenEmpty.size &&
        out['type'] === 'box' &&
        Array.isArray(out['contents']) &&
        (out['contents'] as unknown[]).length === 0
      ) {
        return FLEX_DROP;
      }
      return out;
    }
    return n;
  };

  const result = walk(node);

  // The root asked to be dropped → return null so the caller falls back to a
  // plain text reply. Never return the Symbol (see the warning on FLEX_DROP).
  if (result === FLEX_DROP) return null;

  // A whole empty section must VANISH rather than be sent as an empty box.
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    for (const sec of ['header', 'hero', 'body', 'footer']) {
      if (obj[sec] === FLEX_DROP) delete obj[sec];
    }
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// [FEAT-20260814-PROMODROP] promo-scoped empty-bubble drop
// ───────────────────────────────────────────────────────────────────────────

/**
 * The site-rules PROMO FASHION tags (`site_rules.promo_0_name` …
 * `site_rules.promo_4_use_true_money`), lowercased, built ONCE from the same
 * spec walk that builds the var-map itself.
 *
 * ⚠️ Derived, not hand-written: if `PROMO_SLOTS` in the dict-spec ever grows a
 *    sixth fashion, this set follows automatically — a hardcoded regex would
 *    silently miss the new tags.
 * ⚠️ `site_rules.`-prefixed ONLY. Bare `promo_*` tags belong to the PROFILE
 *    namespace (the member's own promotion: `promo_name`, `promo_act_home_living`)
 *    and have no numeric fashion; the prefix + digit pair is what makes a web-promo
 *    fashion unmistakable. Verified against both spec halves before this was built.
 */
let promoSlotTags: Set<string> | null = null;
function getPromoSlotTags(): Set<string> {
  if (!promoSlotTags) {
    const set = new Set<string>();
    walkSiteRulesSpec((tag) => {
      if (/^promo_\d+_/.test(tag)) set.add(`site_rules.${tag}`.toLowerCase());
    });
    promoSlotTags = set;
  }
  return promoSlotTags;
}

/** Every `{{tag}}` name in a node, lowercased — judged on the TEMPLATE, before
 *  substitution, the same rule `isOnlyDeclaredTags` follows. */
function collectTagNames(node: unknown, acc: string[]): string[] {
  if (typeof node === 'string') {
    for (const m of node.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
      acc.push(m[1]!.toLowerCase());
    }
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectTagNames(child, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) collectTagNames(v, acc);
  }
  return acc;
}

/**
 * Remove carousel bubbles that hold NOTHING but empty web-promo slots — the
 * "-" cards a 5-fashion promo template shows on a web that has fewer promotions.
 *
 * The rule is deliberately narrow, provable per clause:
 *   · root must be a `carousel` — bubble docs and every other card shape are
 *     returned UNTOUCHED (same object, `===`);
 *   · a bubble is dropped only when it has at least one tag AND every tag is a
 *     `site_rules.promo_N_*` fashion AND every one resolves empty. One static-only
 *     bubble, one profile tag, one filled value — any of these keeps the bubble;
 *   · at least one bubble ALWAYS survives. A web with zero promotions keeps the
 *     first bubble exactly as it renders today (all '-'), so the worst case is
 *     the current behaviour on one card instead of five. LINE requires 1–12
 *     bubbles and uniform bubble width; whole-bubble removal with a floor of 1
 *     cannot violate either.
 *
 * ⚠️ Called BEFORE `applyFlexProfileVars` — the decision needs the raw `{{…}}`
 *    names, which substitution destroys. `vars` is the same finished map the
 *    substitution pass will receive, so both passes see identical values — a
 *    content-fashion override that fills a promo tag keeps the bubble.
 * ⚠️ Empty means '-' (the site-rules formatter's null sentinel) or whitespace.
 *    Checked against all 163 live promotions across 52 webs: no real field
 *    carries a literal '-', so the sentinel cannot collide with data.
 * ⚠️ Never mutates: kept bubbles are the caller's own objects, only the
 *    carousel wrapper is rebuilt.
 */
export function dropEmptyPromoBubbles(
  node: unknown,
  vars: Record<string, string> | null | undefined,
): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const doc = node as Record<string, unknown>;
  if (doc['type'] !== 'carousel' || !Array.isArray(doc['contents'])) {
    return node;
  }

  const bubbles = doc['contents'] as unknown[];
  const map = vars && typeof vars === 'object' ? vars : {};
  const slots = getPromoSlotTags();
  const isEmpty = (name: string): boolean => {
    const v = map[name];
    return v === undefined || v === '-' || String(v).trim() === '';
  };

  const kept = bubbles.filter((bubble) => {
    const tags = collectTagNames(bubble, []);
    const droppable =
      tags.length > 0 &&
      tags.every((t) => slots.has(t)) &&
      tags.every((t) => isEmpty(t));
    return !droppable;
  });

  // Nothing dropped → hand back the original object so callers (and tests) can
  // prove untouched-ness by identity, not by deep comparison.
  if (kept.length === bubbles.length) return node;
  // Everything dropped → the floor: keep the first bubble, rendering '-' just
  // as every bubble does today. Never an empty carousel.
  return { ...doc, contents: kept.length ? kept : [bubbles[0]] };
}

// ───────────────────────────────────────────────────────────────────────────
// renderFlexDoc — legacy webhookController.js:1394-1424
// ───────────────────────────────────────────────────────────────────────────

export interface RenderableFlexDoc {
  content_json?: unknown;
  content_tags?: unknown;
  source_roles?: unknown;
  source_role?: unknown;
}

/**
 * Substitute every variable into one card's `content_json`.
 *
 * Order is load-bearing and matches legacy exactly:
 *   1. data-source variables (namespaced, e.g. `profile.bank_code`)
 *   2. context variables, applied OVER them — these names are reserved and a
 *      data source must not be able to steal their meaning
 *   3. the card's own content slots, applied last — a card's own slots outrank
 *      system-wide variables
 *
 * ⚠️⚠️ [FIX-20260805-STRIPALL] `{{content}}` ALWAYS receives marker-stripped
 *   text. The first version stripped only for cards that declare slots, on the
 *   theory that this left legacy cards untouched. Wrong trade: one OA holds
 *   both kinds of card, so once the model is taught the marker format, an answer
 *   routed to a legacy card carries `[[[custom_content_1]]]` straight to the
 *   customer. "ลูกค้าห้ามเห็นวงเล็บ" is the stronger rule, and the one
 *   `stripFlexProfileTag` / `stripFlexTagRefs` already follow.
 *   Safe because `stripContentMarkers` returns the string untouched when no
 *   marker is present ([FIX-20260805-STRIPNOOP]) — ordinary replies keep every
 *   space.
 *
 * @param dataVars the namespaced source variable map, already built. Passed in
 *   rather than built here so this function stays pure and testable; legacy
 *   calls `buildFlexVarMaps` at this point.
 */
export function renderFlexDoc(
  doc: RenderableFlexDoc,
  dataVars: Record<string, string>,
  content: unknown,
  hook: Record<string, unknown> | null | undefined,
): unknown {
  const vars: Record<string, string> = { ...dataVars };

  // The card's own content slots — this is the call site legacy has at :1407-1408.
  const { map: contentTagMap, declared } = buildContentTagMap(
    doc.content_tags,
    content,
  );

  const ctxContent = stripContentMarkers(content);
  Object.assign(vars, buildContextVarMap({ hook, content: ctxContent }));
  Object.assign(vars, contentTagMap);

  // [FEAT-20260814-PROMODROP] prune all-empty web-promo bubbles while the
  // `{{…}}` names are still visible; every non-promo card passes through by
  // identity. Must stay ABOVE applyFlexProfileVars — substitution erases the
  // tag names the decision reads.
  const pruned = dropEmptyPromoBubbles(doc.content_json, vars);

  return applyFlexProfileVars(pruned, vars, {
    dropWhenEmpty: declared,
  });
}
