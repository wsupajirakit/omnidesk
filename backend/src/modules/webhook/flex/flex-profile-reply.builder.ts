/**
 * [FIX-20260808-FLEXBUILDER] The flex profile / tag reply BUILDERS.
 *
 * These assemble a real flex card from the customer's profile data — the piece
 * that feeds `flexProfileContents` in webhook.service.ts (wired at the reply
 * branch; the earlier "always null" was the [FIX-20260808-FLEXGATE] inversion,
 * now fixed). Three routes, each returning a ready-to-send flex message object or
 * `null` when no card applies:
 *
 *   · buildFlexProfileReply        — legacy `buildFlexProfileReply`
 *                                    (webhookController.js, the `[[[flex_profile]]]` route)
 *   · buildFlexTagReply            — legacy `buildFlexTagReply`
 *                                    (the `[[[flex_mNNNNN]]]` route)
 *   · buildFlexProfileCustomReply  — legacy `buildFlexProfileCustomReply`
 *                                    (the `[[[flex_pcNNNNN]]]` profile-semi-custom route)
 *
 * TRANSCRIBED, not redesigned — a "nicer" card is a defect. The card JSON must
 * match legacy byte-for-byte (same fields, same fallbacks, same image handling).
 *
 * ── What is REUSED (not re-implemented) ─────────────────────────────────────
 *   · `renderFlexDoc`   (flex-render.util.ts) — the whole var-substitution
 *     pipeline: context vars, content slots, empty-text '-' guard, image
 *     fallback, empty-box removal. Legacy calls it `renderFlexDoc` too.
 *   · `FALLBACK_IMAGE_URL` (flex-image-fallback.util.ts) — the flex_pc body
 *     sanitizer's image fallback, legacy [FEAT-20260804-FLEXIMGFALLBACK].
 *
 * ── DEPS-INJECTED, not imported (deps-object style, like assist-notification) ─
 *   · `flexModel`     — the FlexMessage Mongoose model, for the id / tag lookup.
 *   · `buildDataVars` — the NAMESPACED source var-map assembly, legacy
 *     `buildFlexVarMaps(doc, profileData, hook)`. Its RUNTIME form
 *     (`FLEX_VAR_SOURCES[role].pick/.build` over REAL `profileData`) lives in
 *     `flex-data-vars.util.ts` (`buildFlexVarMaps`, :582) and the caller injects
 *     it rather than importing it here — that keeps this builder testable with a
 *     faked deps-object and free of the flex-var util. `renderFlexDoc` already
 *     takes the built `dataVars`, so this is the exact seam legacy has at that
 *     point.
 *
 * ⚠️ ห้าม throw — อยู่บนเส้นตอบลูกค้า. Every builder returns `null` on any
 *    failure so the caller falls through to the plain-text reply, exactly as
 *    legacy does (each legacy function wraps its whole body in try/catch → null).
 */

import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';

import { FALLBACK_IMAGE_URL } from './flex-image-fallback.util';
import { renderFlexDoc as defaultRenderFlexDoc } from './flex-render.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A flex document as read from Mongo (only the fields the builders touch). */
import { report, type FlexReplyOut } from './flex-reply-out';
export interface FlexReplyDoc {
  content_json?: unknown;
  content_tags?: unknown;
  source_roles?: unknown;
  source_role?: unknown;
  [k: string]: unknown;
}

/**
 * Dependencies the builders need but do not own.
 *
 * ⚠️ `buildDataVars` is the unported runtime var-map assembly (see file header).
 *    It must be PURE — no I/O — because it runs inside the reply path and legacy
 *    builds it from data already fetched (`profileData`), never re-fetching.
 */
export interface FlexReplyDeps {
  /** FlexMessage model — the lookup by `_id` (profile) / `flex_tag` (tag routes). */
  flexModel: Model<any>;
  /**
   * Legacy `buildFlexVarMaps(doc, profileData, hook)` — the namespaced
   * `{profile.bank_code, bank_code, site_rules.dep_min, …}` map from REAL
   * profile data. Injected because its runtime form is not yet in this repo.
   */
  buildDataVars: (
    doc: FlexReplyDoc,
    profileData: unknown,
    hook: Record<string, unknown> | null | undefined,
  ) => Record<string, string>;
  /**
   * The ported render pipeline. Defaults to `flex-render.util.renderFlexDoc`;
   * overridable only so tests can assert the builders' own control flow without
   * exercising the whole substitution walk.
   */
  renderFlexDoc?: (
    doc: FlexReplyDoc,
    dataVars: Record<string, string>,
    content: unknown,
    hook: Record<string, unknown> | null | undefined,
  ) => unknown;
  /** Optional logger; defaults to `console`. Legacy uses `console.warn/error`. */
  logger?: { warn: (m: string) => void; error: (m: string) => void };
}

/** Shared shape of every builder's positional args. */
export interface FlexReplyArgs {
  /** [FIX-20260822-FLEXHISTORYTYPE] filled with the rendered doc's id/name; see flex-reply-out.ts */
  out?: FlexReplyOut;
  hook: Record<string, unknown> | null | undefined;
  profileData: unknown;
  content: unknown;
  /** `flex_mNNNNN` / `flex_pcNNNNN` — only the tag routes pass this. */
  flexTag?: string | null;
}

/** Default logger — legacy uses `console.warn/error`; we use Nest's `Logger`
 *  so the reply path shares one log format. Overridable via deps for tests. */
const defaultLogger = new Logger('FlexProfileReply');
const noopLogger = {
  warn: (m: string): void => defaultLogger.warn(m),
  error: (m: string): void => defaultLogger.error(m),
};

/**
 * Coerce an arbitrary reply value to a string. `content` on the reply path is
 * text (or a JSON string the AI authored); an object is never a valid answer, so
 * it degrades to '' rather than the useless '[object Object]' legacy's
 * `String(x || '')` would produce. Numbers/booleans stringify normally.
 */
function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v);
}

/**
 * Render a doc through the ported pipeline. Mirrors legacy `renderFlexDoc`'s
 * call site inside each builder: build the namespaced data vars first (legacy
 * `buildFlexVarMaps` at webhookController.js), then substitute.
 *
 * `// [FEAT-20260802-HOOKDOMAIN]` — `hook` is threaded through so `{{hook_domain}}`
 * resolves, exactly as legacy passes it.
 */
function render(
  doc: FlexReplyDoc,
  args: FlexReplyArgs,
  deps: FlexReplyDeps,
): unknown {
  report(args.out, doc);
  const renderFlexDoc = deps.renderFlexDoc ?? defaultRenderFlexDoc;
  const dataVars = deps.buildDataVars(doc, args.profileData, args.hook) || {};
  return renderFlexDoc(doc, dataVars, args.content, args.hook);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) buildFlexProfileReply — legacy `buildFlexProfileReply`
//    `[[[flex_profile]]]` → the ONE card the hook pins via `flex_profile_id`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors legacy `async function buildFlexProfileReply({ hook, profileData, content })`.
 * Returns `null` (fall through to text) when: no `flex_profile_id`, the card is
 * deleted / not found, or its `content_json` is missing — legacy's exact gates.
 */
export async function buildFlexProfileReply(
  args: FlexReplyArgs,
  deps: FlexReplyDeps,
): Promise<unknown> {
  const log = deps.logger ?? noopLogger;
  try {
    const flexProfileId = args.hook?.['flex_profile_id'];
    if (!flexProfileId) return null;

    const doc = (await deps.flexModel
      .findOne({
        _id: flexProfileId,
        deleted_at: { $exists: false },
      })
      .lean()
      .exec()) as FlexReplyDoc | null;
    if (!doc?.content_json) return null;

    return render(doc, args, deps);
  } catch (err) {
    // legacy: "[FLEXPROFILE] ประกอบ flex ไม่สำเร็จ (ตอบข้อความปกติแทน)"
    log.error(
      `[FLEXPROFILE] ประกอบ flex ไม่สำเร็จ (ตอบข้อความปกติแทน): ${
        (err as Error)?.message
      }`,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) buildFlexTagReply — legacy `buildFlexTagReply`
//    `[[[flex_mNNNNN]]]` → a card the hook explicitly allow-lists in
//    `flex_custom_ids`. A doc may only send cards its OWN hook bound.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors legacy `async function buildFlexTagReply({ hook, profileData, content, flexTag })`.
 *
 * ⚠️ Scope gate is byte-for-byte legacy: the card must be in `hook.flex_custom_ids`
 *    (`_id: { $in: allowed }`). An empty allow-list, or a tag not in it, returns
 *    `null` — never silently pulls a card from another OA.
 */
export async function buildFlexTagReply(
  args: FlexReplyArgs,
  deps: FlexReplyDeps,
): Promise<unknown> {
  const log = deps.logger ?? noopLogger;
  const flexTag = args.flexTag;
  try {
    if (!flexTag) return null;

    const raw = args.hook?.['flex_custom_ids'];
    const allowed = Array.isArray(raw) ? raw : [];
    if (allowed.length === 0) {
      log.warn(
        `[FLEXTAGREPLY] doc อ้าง ${flexTag} แต่ hook ยังไม่ได้เลือก flex ไว้เลย → ตอบข้อความปกติ`,
      );
      return null;
    }

    const doc = (await deps.flexModel
      .findOne({
        flex_tag: flexTag,
        _id: { $in: allowed },
        deleted_at: { $exists: false },
      })
      .lean()
      .exec()) as FlexReplyDoc | null;
    if (!doc?.content_json) {
      log.warn(
        `[FLEXTAGREPLY] ไม่พบการ์ด ${flexTag} ในรายการที่ hook เลือกไว้ → ตอบข้อความปกติ`,
      );
      return null;
    }

    return render(doc, args, deps);
  } catch (err) {
    log.error(
      `[FLEXTAGREPLY] ประกอบ flex ไม่สำเร็จ (ตอบข้อความปกติแทน): ${
        (err as Error)?.message
      }`,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) buildFlexProfileCustomReply — legacy `buildFlexProfileCustomReply`
//    `[[[flex_pcNNNNN]]]` → profile-semi-custom: render the template, then
//    OVERRIDE only `body` with the AI-authored (sanitized) box.
// ─────────────────────────────────────────────────────────────────────────────

// ==== flex_pc body sanitizer — legacy `sanitizeFlexNode` / `parseFirstFlexJson`
//   / `transformProfileCustomContent`. Ported HERE (not a shared util) because
//   it belongs solely to the flex_pc build flow and is pure (no I/O). The AI
//   authors a `body` box of REAL values (no `{{}}`); we whitelist + validate
//   every node, then override only `body`. body is NOT var-substituted.
//   revert: delete this block + return the template unchanged.

// prettier-ignore
const FLEXPC_SIZE_KEYWORDS = new Set(['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', '3xl', '4xl', '5xl']);
// prettier-ignore
const FLEXPC_SPACING_KEYWORDS = new Set(['none', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl']);
const FLEXPC_HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FLEXPC_PX = /^\d+(\.\d+)?px$/;
const FLEXPC_PX_OR_PCT = /^\d+(\.\d+)?(px|%)$/;
const FLEXPC_RATIO = /^\d+(\.\d+)?:\d+(\.\d+)?$/;
const FLEXPC_MAX_DEPTH = 8;
const FLEXPC_MAX_NODES = 60;
const FLEXPC_MAX_BYTES = 40000; // body only (whole LINE card limit ~50KB)

const fpcHex = (v: unknown): boolean =>
  typeof v === 'string' && FLEXPC_HEX.test(v);
const fpcSize = (v: unknown): boolean =>
  typeof v === 'string' &&
  (FLEXPC_SIZE_KEYWORDS.has(v) || FLEXPC_PX.test(v) || v === 'full');
const fpcSpacing = (v: unknown): boolean =>
  typeof v === 'string' &&
  (FLEXPC_SPACING_KEYWORDS.has(v) || FLEXPC_PX.test(v));
const fpcDim = (v: unknown): boolean =>
  typeof v === 'string' && FLEXPC_PX_OR_PCT.test(v);
const fpcRatio = (v: unknown): boolean =>
  typeof v === 'string' && FLEXPC_RATIO.test(v);
const fpcHttps = (v: unknown): boolean =>
  typeof v === 'string' && /^https:\/\//i.test(v) && v.length <= 2000;
const fpcBool = (v: unknown): boolean => v === true || v === false;
const fpcInt = (v: unknown): boolean =>
  Number.isInteger(v) && (v as number) >= 0;
const fpcOneOf =
  (arr: unknown[]) =>
  (v: unknown): boolean =>
    arr.includes(v);

function fpcCopy(
  out: Record<string, unknown>,
  node: Record<string, unknown>,
  key: string,
  ok: (v: unknown) => boolean,
): void {
  if (node[key] !== undefined && ok(node[key])) out[key] = node[key];
}

/**
 * Whitelist-sanitizer: returns a safe node, or `null` (dropped). Walks every
 * child. Supports only `box | text | separator | image | icon`. Legacy
 * `sanitizeFlexNode`.
 */
function sanitizeFlexNode(
  node: unknown,
  depth: number,
  counter: { n: number },
): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  if (depth > FLEXPC_MAX_DEPTH || counter.n >= FLEXPC_MAX_NODES) return null;
  const n = node as Record<string, unknown>;
  const type = n['type'];

  if (type === 'box') {
    counter.n++;
    const out: Record<string, unknown> = {
      type: 'box',
      layout: fpcOneOf(['vertical', 'horizontal', 'baseline'])(n['layout'])
        ? n['layout']
        : 'vertical',
    };
    const contents: unknown[] = [];
    const kids = Array.isArray(n['contents'])
      ? (n['contents'] as unknown[])
      : [];
    for (const child of kids) {
      if (counter.n >= FLEXPC_MAX_NODES) break;
      const s = sanitizeFlexNode(child, depth + 1, counter);
      if (s) contents.push(s);
    }
    out['contents'] = contents;
    fpcCopy(out, n, 'spacing', fpcSpacing);
    fpcCopy(out, n, 'margin', fpcSpacing);
    [
      'paddingAll',
      'paddingTop',
      'paddingBottom',
      'paddingStart',
      'paddingEnd',
    ].forEach((k) => fpcCopy(out, n, k, fpcSpacing));
    fpcCopy(out, n, 'backgroundColor', fpcHex);
    fpcCopy(out, n, 'borderColor', fpcHex);
    fpcCopy(out, n, 'borderWidth', fpcSpacing);
    fpcCopy(out, n, 'cornerRadius', fpcSpacing);
    ['width', 'height', 'maxWidth', 'maxHeight'].forEach((k) =>
      fpcCopy(out, n, k, fpcDim),
    );
    fpcCopy(out, n, 'flex', fpcInt);
    fpcCopy(
      out,
      n,
      'justifyContent',
      fpcOneOf([
        'flex-start',
        'center',
        'flex-end',
        'space-between',
        'space-around',
        'space-evenly',
      ]),
    );
    fpcCopy(
      out,
      n,
      'alignItems',
      fpcOneOf(['flex-start', 'center', 'flex-end']),
    );
    return out;
  }

  if (type === 'text') {
    const text = typeof n['text'] === 'string' ? n['text'] : '';
    if (!text.trim()) return null; // empty text = LINE reject → drop
    counter.n++;
    const out: Record<string, unknown> = { type: 'text', text };
    fpcCopy(out, n, 'size', fpcSize);
    fpcCopy(out, n, 'color', fpcHex);
    fpcCopy(out, n, 'weight', fpcOneOf(['regular', 'bold']));
    fpcCopy(out, n, 'align', fpcOneOf(['start', 'center', 'end']));
    fpcCopy(out, n, 'gravity', fpcOneOf(['top', 'center', 'bottom']));
    fpcCopy(out, n, 'wrap', fpcBool);
    fpcCopy(out, n, 'scaling', fpcBool);
    fpcCopy(out, n, 'maxLines', fpcInt);
    fpcCopy(out, n, 'margin', fpcSpacing);
    fpcCopy(out, n, 'flex', fpcInt);
    fpcCopy(
      out,
      n,
      'decoration',
      fpcOneOf(['none', 'underline', 'line-through']),
    );
    fpcCopy(out, n, 'style', fpcOneOf(['normal', 'italic']));
    fpcCopy(out, n, 'lineSpacing', fpcSpacing);
    return out;
  }

  if (type === 'separator') {
    counter.n++;
    const out: Record<string, unknown> = { type: 'separator' };
    fpcCopy(out, n, 'margin', fpcSpacing);
    fpcCopy(out, n, 'color', fpcHex);
    return out;
  }

  if (type === 'image' || type === 'icon') {
    // [FEAT-20260804-FLEXIMGFALLBACK] an unusable url → fallback image (legacy
    //   used to drop the node silently, leaving a hole in the layout).
    const url = fpcHttps(n['url']) ? n['url'] : FALLBACK_IMAGE_URL;
    counter.n++;
    const out: Record<string, unknown> = { type, url };
    fpcCopy(out, n, 'size', fpcSize);
    fpcCopy(out, n, 'aspectRatio', fpcRatio);
    fpcCopy(out, n, 'margin', fpcSpacing);
    if (type === 'image') {
      fpcCopy(out, n, 'aspectMode', fpcOneOf(['cover', 'fit']));
      fpcCopy(out, n, 'align', fpcOneOf(['start', 'center', 'end']));
      fpcCopy(out, n, 'gravity', fpcOneOf(['top', 'center', 'bottom']));
      fpcCopy(out, n, 'flex', fpcInt);
    }
    return out;
  }

  return null; // outside whitelist (header/footer/button/video/filler/action/span) → drop
}

/**
 * First balanced JSON object in the text (bracket-counting, so leading/trailing
 * prose is ignored). Returns `null` when unparseable. Legacy `parseFirstFlexJson`.
 */
function parseFirstFlexJson(text: unknown): unknown {
  const s = toStr(text);
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Legacy `stripFlexPcTagRefs` — the flex_pc build path strips its own tag before
 * parsing so a `{{flex_pcNNNNN}}` opener cannot be mistaken for the JSON body.
 * Accepts the same wrappers legacy did: `[[…]] [[[…]]] {{…}} {{{…}}}`.
 */
const FLEX_PC_TAG_REF_ALL =
  /(?:\[\[\[?|\{\{\{?)(flex_pc\d{5})(?:\]\]\]?|\}\}\}?)/gi;
function stripFlexPcTagRefs(text: unknown): string {
  return toStr(text).replace(FLEX_PC_TAG_REF_ALL, '').trim();
}

/**
 * AI text → a 100%-safe `body` box, or `null` (caller keeps the template body).
 * ⚠️ NOT var-substituted here — the body is already real values from the AI.
 * Legacy `transformProfileCustomContent`.
 */
function transformProfileCustomContent(
  aiText: unknown,
): Record<string, unknown> | null {
  const parsed = parseFirstFlexJson(stripFlexPcTagRefs(toStr(aiText)));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const p = parsed as Record<string, unknown>;
  // Two shapes: a bare box, or a wrapper `{ tag, body }`.
  const candidate: unknown =
    p['type'] === 'box'
      ? p
      : p['body'] && typeof p['body'] === 'object' && !Array.isArray(p['body'])
        ? p['body']
        : null;
  if (!candidate || (candidate as Record<string, unknown>)['type'] !== 'box') {
    return null;
  }
  const safe = sanitizeFlexNode(candidate, 0, { n: 0 });
  if (
    !safe ||
    safe['type'] !== 'box' ||
    !Array.isArray(safe['contents']) ||
    (safe['contents'] as unknown[]).length === 0
  ) {
    return null;
  }
  try {
    if (JSON.stringify(safe).length > FLEXPC_MAX_BYTES) return null;
  } catch {
    return null;
  }
  return safe;
}

/**
 * Mirrors legacy `async function buildFlexProfileCustomReply({ hook, profileData, content, flexTag })`.
 *
 * ⚠️ Scope gate: card must be in `hook.flex_profile_custom_ids` AND
 *    `flex_type: 'profile-semi-custom'` AND not deleted — legacy's exact filter.
 * Steps (byte-for-byte legacy):
 *   1. render the template (substitutes `{{}}` across header/hero/footer + the
 *      template body, which is the fallback). If `content` LOOKS like JSON, a
 *      neutral message stands in for `{{content}}` so raw JSON never leaks.
 *   2. sanitize the AI-authored body and override ONLY `rendered.body`. If it is
 *      unusable, keep the template body (fallback) — the card still sends.
 */
export async function buildFlexProfileCustomReply(
  args: FlexReplyArgs,
  deps: FlexReplyDeps,
): Promise<unknown> {
  const log = deps.logger ?? noopLogger;
  const flexTag = args.flexTag;
  try {
    if (!flexTag) return null;

    const raw = args.hook?.['flex_profile_custom_ids'];
    const allowed = Array.isArray(raw) ? raw : [];
    if (allowed.length === 0) {
      log.warn(
        `[FLEXPCTAG] doc อ้าง ${flexTag} แต่ hook ยังไม่ได้เลือก flex_profile_custom ไว้ → ตอบข้อความปกติ`,
      );
      return null;
    }

    const doc = (await deps.flexModel
      .findOne({
        flex_tag: flexTag,
        _id: { $in: allowed },
        flex_type: 'profile-semi-custom',
        deleted_at: { $exists: false },
      })
      .lean()
      .exec()) as FlexReplyDoc | null;
    if (!doc?.content_json) {
      log.warn(
        `[FLEXPCTAG] ไม่พบการ์ด ${flexTag} ในรายการที่ hook เลือกไว้ → ตอบข้อความปกติ`,
      );
      return null;
    }

    // 1) render the template first. If content looks like JSON, don't let raw
    //    JSON leak into `{{content}}` on the fallback path.
    const looksJson = /^\s*\{/.test(toStr(args.content));
    const safeContent = looksJson
      ? 'ขออภัย ระบบแสดงข้อมูลไม่ได้ชั่วคราวค่ะ'
      : args.content;
    const rendered = render(doc, { ...args, content: safeContent }, deps);
    if (!rendered || typeof rendered !== 'object') return null;

    // 2) override only `body` with the sanitized AI body; keep template on miss.
    const aiBody = transformProfileCustomContent(args.content);
    if (aiBody) {
      (rendered as Record<string, unknown>)['body'] = aiBody;
    } else {
      log.warn(
        `[FLEXPCTAG] body จาก AI ใช้ไม่ได้ (${flexTag}) → ใช้ body เทมเพลตเดิมแทน (fallback)`,
      );
    }
    return rendered;
  } catch (err) {
    log.error(
      `[FLEXPCTAG] ประกอบ flex ไม่สำเร็จ (ตอบข้อความปกติแทน): ${
        (err as Error)?.message
      }`,
    );
    return null;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Test-only exports — mirror legacy's `__buildFlexProfileReply` etc.
export const __test = {
  transformProfileCustomContent,
  sanitizeFlexNode,
  parseFirstFlexJson,
  stripFlexPcTagRefs,
};
