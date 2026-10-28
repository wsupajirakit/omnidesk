/**
 * Content slots at SEND time — the render-time half of legacy
 * `src/config/flexContentTags.js`.
 *
 * The write-time half (`normalizeContentTags` and the two constants) already
 * lives in `@/modules/content/flex-content-tags.util`, ported by another agent.
 * That file states these four functions were left out on purpose because "the
 * webhook renderer is not part of this service yet". This file is that
 * renderer's half, and it is the reason `renderFlexDoc` below can exist.
 *
 * ⚠️ Why a separate file rather than an addition to the content util:
 * `flex-content-tags.util.ts` is owned by another agent in this migration and
 * is explicitly off limits to edits. The constants are IMPORTED from it so
 * there is still exactly one definition of the slot ceiling and the tag prefix
 * — a second copy would be free to drift, which is the failure this split is
 * meant to avoid.
 *
 * Legacy source lines are cited per function. Behaviour is byte-faithful,
 * including the two fixes legacy carries markers for:
 *   [FIX-20260805-STRIPNOOP]  no marker present → the string is returned untouched
 *   [FIX-20260805-STRIPALL]   the caller strips for EVERY card, not only declaring ones
 */

import {
  CONTENT_TAG_MAX,
  CONTENT_TAG_PREFIX,
} from '@/modules/content/flex-content-tags.util';

/**
 * What the model emits: `[[[custom_content_1]]]`. Two or three brackets both
 * match, as legacy accepts either — `\[\[\[?` then `\]\]\]?`.
 *
 * `(10|[1-9])` and not `\d+`: slot 11 does not exist, and `1` must not swallow
 * the `0` of `10`. Legacy flexContentTags.js:57.
 */
export const CONTENT_MARKER_SRC = `\\[\\[\\[?${CONTENT_TAG_PREFIX}(10|[1-9])\\]\\]\\]?`;

/** What the admin types in the card: `{{custom_content_1}}`. Legacy:59. */
export const CONTENT_TOKEN_SRC = `\\{\\{\\s*${CONTENT_TAG_PREFIX}(10|[1-9])\\s*\\}\\}`;

/**
 * The value a declared-but-unfilled slot takes.
 *
 * Empty string, NOT `'-'` like every other flex variable: an empty slot is
 * removed along with its component (see `dropWhenEmpty` in the renderer), so it
 * never reaches the customer as a dash. Legacy:65.
 */
export const CONTENT_TAG_EMPTY = '';

/** 1 → `custom_content_1` — the key inside the variable map. Legacy:168. */
export const contentTagName = (no: number | string): string =>
  `${CONTENT_TAG_PREFIX}${Number(no)}`;

/** 1 → `{{custom_content_1}}` — what the admin types. Legacy:170. */
export const contentTagToken = (no: number | string): string =>
  `{{${contentTagName(no)}}}`;

/** 1 → `[[[custom_content_1]]]` — what the model emits. Legacy:172. */
export const contentTagMarker = (no: number | string): string =>
  `[[[${contentTagName(no)}]]]`;

/** One declared slot, as stored on the flex document. */
export interface ContentTagRow {
  no: number;
  label?: string;
  hint?: string;
}

/**
 * Split the model's answer into slots on `[[[custom_content_N]]]`.
 * Legacy:186-207.
 *
 * Returns only the slots the model actually filled.
 *
 * ⚠️ No markers at all → an empty Map. What to do about that is the caller's
 *    policy, not this function's.
 * ⚠️ Text before the first marker has no owner and is dropped.
 * ⚠️ The same slot marked twice joins with a newline rather than overwriting —
 *    a model may split one slot across lines.
 */
export function parseContentMarkers(text: unknown): Map<number, string> {
  const found = new Map<number, string>();
  const raw = String(text ?? '');
  if (!raw) return found;

  const re = new RegExp(CONTENT_MARKER_SRC, 'gi');
  let lastNo: number | null = null;
  let lastPos = 0;

  const push = (no: number | null, from: number, to: number): void => {
    if (no === null) return;
    const v = raw.slice(from, to).trim();
    if (!v) return;
    const prev = found.get(no);
    found.set(no, prev === undefined ? v : `${prev}\n${v}`);
  };

  let m: RegExpExecArray | null = re.exec(raw);
  while (m !== null) {
    push(lastNo, lastPos, m.index);
    lastNo = Number(m[1]);
    lastPos = m.index + m[0].length;
    m = re.exec(raw);
  }
  push(lastNo, lastPos, raw.length);
  return found;
}

/**
 * Strip markers — the customer must never see `[[[custom_content_1]]]`.
 * Legacy:217-224.
 *
 * ⚠️⚠️ [FIX-20260805-STRIPNOOP] With no marker present the string comes back
 *   **untouched**. An earlier version collapsed repeated spaces and trimmed on
 *   every call, so `'สวัสดี  ครับ'` became `'สวัสดี ครับ'`. This runs against
 *   `{{content}}` for every card including legacy ones, so that amounted to
 *   rewriting customer-visible text nobody asked to change.
 * ⚠️ The `.test` regex must NOT carry `/g` — a `/g` regex remembers `lastIndex`
 *   between calls and would skip every other hit.
 */
export function stripContentMarkers(text: unknown): string {
  const s = String(text ?? '');
  if (!new RegExp(CONTENT_MARKER_SRC, 'i').test(s)) return s;
  return s
    .replace(new RegExp(CONTENT_MARKER_SRC, 'gi'), ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface ContentTagMapResult {
  /** `custom_content_N` → the text for that slot. */
  map: Record<string, string>;
  /** The tag names this card owns — an empty slot takes its component away. */
  declared: Set<string>;
}

/**
 * Build the content-slot map for one card. Legacy:248-271.
 *
 * @param tags   `doc.content_tags` — what the card declares
 * @param aiText the model's full answer, the same text that feeds `{{content}}`
 *
 * ⚠️ A card declaring nothing yields `{ map: {}, declared: Set(0) }`. Assigning
 *    an empty map changes nothing, so pre-feature behaviour holds BY
 *    CONSTRUCTION — there is no special case anywhere in the renderer.
 * ⚠️ Model emitted no markers but the card declares slots → the whole answer
 *    goes to the LOWEST-NUMBERED slot. A model that ignores the format must
 *    still produce a usable card rather than an empty one.
 * ⚠️ A marker naming a slot this card does not declare has nowhere to land and
 *    its text is dropped. The card decides which slots exist, not the model.
 */
export function buildContentTagMap(
  tags: unknown,
  aiText: unknown,
): ContentTagMapResult {
  const list: unknown[] = Array.isArray(tags) ? tags : [];
  const declared = new Set<string>();
  const map: Record<string, string> = {};
  if (!list.length) return { map, declared };

  const parsed = parseContentMarkers(aiText);
  const fallbackAll = parsed.size === 0 ? stripContentMarkers(aiText) : '';

  const slotNo = (t: unknown): number =>
    Number((t as ContentTagRow | null | undefined)?.no);

  const lowest = list.reduce<number | null>((min, t) => {
    const n = slotNo(t);
    return Number.isInteger(n) && (min === null || n < min) ? n : min;
  }, null);

  for (const t of list) {
    const no = slotNo(t);
    if (!Number.isInteger(no) || no < 1 || no > CONTENT_TAG_MAX) continue;
    const name = contentTagName(no);
    declared.add(name);
    let val = parsed.has(no) ? (parsed.get(no) as string) : '';
    if (!val && no === lowest && fallbackAll) val = fallbackAll;
    map[name] = val || CONTENT_TAG_EMPTY;
  }
  return { map, declared };
}

/** A row of the guidelines table the dashboard shows and saves against. */
export interface ContentTagGuidelineRow {
  tag: string;
  desc: string;
  source: string;
  example: string;
  noPrefix: true;
}

/**
 * Table rows for the slots this card declares. Legacy:282-297.
 *
 * ⚠️ `noPrefix: true` always — these tags come from no data source, so the
 *    dashboard must not prepend one. `{{profile.custom_content_1}}` would never
 *    resolve.
 */
export function buildContentTagGuidelines(
  tags: unknown,
): ContentTagGuidelineRow[] {
  const list: unknown[] = Array.isArray(tags) ? tags : [];
  return list
    .filter((t) => {
      const n = Number((t as ContentTagRow | null | undefined)?.no);
      return Number.isInteger(n) && n >= 1 && n <= CONTENT_TAG_MAX;
    })
    .map((t) => t as ContentTagRow)
    .sort((a, b) => Number(a.no) - Number(b.no))
    .map((t) => ({
      tag: contentTagToken(t.no),
      desc: t.hint
        ? `${t.label || `ช่อง ${t.no}`} — ${t.hint}`
        : `${t.label || `ช่อง ${t.no}`} (ช่องเนื้อหาของการ์ดนี้)`,
      source: `content_tags[no=${t.no}]`,
      example: `AI ใส่ผ่าน ${contentTagMarker(t.no)}`,
      noPrefix: true as const,
    }));
}
