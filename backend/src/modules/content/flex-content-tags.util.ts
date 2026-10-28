/**
 * Content slots a Flex card declares for itself.
 *
 * Ported from legacy `src/config/flexContentTags.js`.
 * That file documents itself as the single owner of these rules, so the same
 * property holds here: the schema stores, this file decides.
 *
 * A card may declare up to 10 slots, each with a permanent number:
 *   {{custom_content_1}} .. {{custom_content_10}}   what the admin types
 *   [[[custom_content_1]]]                          what the model emits
 *
 * ⭐ `no` is stored per row and never derived from array position. Were it
 * index-derived, deleting slot 2 would renumber slot 3 and a card written with
 * `{{custom_content_3}}` would silently start reading a different slot with no
 * error anywhere. ลบช่อง 2 → เหลือ [1, 3] · ช่องใหม่ได้เลข 2 (เลขว่างน้อยสุด)
 */

/** Per-card ceiling; slot numbers run 1..10. The frontend reads it from the API. */
export const CONTENT_TAG_MAX = 10;

/** Tag prefix — `{{}}` form and the marker form both derive from it. */
export const CONTENT_TAG_PREFIX = 'custom_content_';

/** Value for an unfilled slot. */
export const CONTENT_TAG_EMPTY = '';

/** Marker the model emits — [[[custom_content_1]]] or [[custom_content_1]]. */
export const CONTENT_MARKER_SRC = `\\[\\[\\[?${CONTENT_TAG_PREFIX}(10|[1-9])\\]\\]\\]?`;

/** {{custom_content_N}} — used to decide whether a string holds content slots. */
export const CONTENT_TOKEN_SRC = `\\{\\{\\s*${CONTENT_TAG_PREFIX}(10|[1-9])\\s*\\}\\}`;

/** One validated slot, in the shape stored on the document. */
export interface ContentTag {
  no: number;
  label: string;
  hint?: string;
}

export type NormalizeContentTagsResult =
  | { value: ContentTag[]; error?: undefined }
  | { value?: undefined; error: string };

/** 1 → "custom_content_1" (the key inside the variable map) */
export const contentTagName = (no: number | string): string =>
  `${CONTENT_TAG_PREFIX}${Number(no)}`;

/** 1 → "{{custom_content_1}}" (what the admin types in the card) */
export const contentTagToken = (no: number | string): string =>
  `{{${contentTagName(no)}}}`;

/** 1 → "[[[custom_content_1]]]" (what the model emits) */
export const contentTagMarker = (no: number | string): string =>
  `[[[${contentTagName(no)}]]]`;

/** Lowest free number in 1..MAX, so an auto-assigned slot never steals one. */
function nextFreeSlotNo(used: Set<number>): number | null {
  for (let i = 1; i <= CONTENT_TAG_MAX; i += 1) {
    if (!used.has(i)) return i;
  }
  return null;
}

/**
 * String coercion matching legacy `String(x ?? '')`.
 *
 * Legacy uses `String(x ?? '')` everywhere (L134, L154, L155, L188, L218), which
 * calls `.toString()` on objects/arrays (`{a:1}` → `"[object Object]"`, `[1,2]` → `"1,2"`).
 */
function toLegacyString(value: unknown): string {
  if (value === undefined || value === null) return '';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Accepts any of the shapes legacy accepts and returns something safe to store.
 *
 *   [{ no: 1, label: 'ทักทาย', hint: '…' }]   canonical, stored as-is
 *   [{ label: 'ทักทาย' }, { label: 'ปิดท้าย' }] no numbers → auto-assigned
 *   ['ทักทาย', 'ปิดท้าย']                       labels only
 *   { '1': 'ทักทาย', '3': 'ปิดท้าย' }           explicit numbers, gaps allowed
 *
 * absent / null / '' / [] all mean "this card declares nothing", which is the
 * pre-feature behaviour. That must stay distinguishable from "sent but
 * invalid" — the latter is a 400 with a reason, never a silent collapse to [].
 *
 * Every message string below is compared by value in the golden suite, so
 * rewording one is a contract change, not a cosmetic edit.
 */
export function normalizeContentTags(raw: unknown): NormalizeContentTagsResult {
  if (raw === undefined || raw === null || raw === '') return { value: [] };

  let input: unknown = raw;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') return { value: [] };
    try {
      input = JSON.parse(trimmed);
    } catch {
      return {
        error: 'content_tags ต้องเป็น JSON ที่อ่านได้ (array หรือ object)',
      };
    }
  }

  // { '1': 'label' } → canonical array; the object key is the slot number.
  if (isRecord(input)) {
    input = Object.entries(input).map(([no, v]) =>
      isRecord(v) ? { no, ...v } : { no, label: v },
    );
  }

  if (!Array.isArray(input)) {
    return { error: 'content_tags ต้องเป็น array หรือ object' };
  }
  if (input.length > CONTENT_TAG_MAX) {
    return {
      error: `content_tags ได้สูงสุด ${CONTENT_TAG_MAX} ช่อง (ส่งมา ${input.length})`,
    };
  }

  // `input` widens to any[] after Array.isArray on an unknown, so it is
  // re-narrowed here rather than letting `any` leak into the loop below.
  const rows: unknown[] = (input as unknown[]).map((row) =>
    typeof row === 'string' ? { label: row } : row,
  );

  // Pass one: claim every explicitly given number first, so an auto-assigned
  // row cannot take a number a later row asked for by name.
  const used = new Set<number>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const at = `ช่องที่ ${i + 1}`;
    // The Array.isArray guard matters: typeof [] === 'object', so a nested
    // array would otherwise slip through and become a blank slot เงียบ ๆ.
    if (!isRecord(row)) {
      return { error: `${at}: ต้องเป็น object { no, label } หรือข้อความป้าย` };
    }
    const rawNo = row['no'];
    if (rawNo === undefined || rawNo === null || rawNo === '') continue;
    const n = Number(rawNo);
    if (!Number.isInteger(n) || n < 1 || n > CONTENT_TAG_MAX) {
      return {
        error: `${at}: เลขช่องต้องเป็นจำนวนเต็ม 1-${CONTENT_TAG_MAX} (ได้ "${toLegacyString(rawNo)}")`,
      };
    }
    if (used.has(n)) return { error: `${at}: เลขช่อง ${n} ซ้ำกับช่องก่อนหน้า` };
    used.add(n);
  }

  // Pass two: rows without a number take the lowest free one.
  const out: ContentTag[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as Record<string, unknown>;
    const at = `ช่องที่ ${i + 1}`;
    const rawNo = row['no'];
    let no: number;
    if (rawNo === undefined || rawNo === null || rawNo === '') {
      const free = nextFreeSlotNo(used);
      if (free === null) {
        return {
          error: `${at}: เกิน ${CONTENT_TAG_MAX} ช่อง ไม่มีเลขว่างแล้ว`,
        };
      }
      no = free;
      used.add(no);
    } else {
      no = Number(rawNo);
    }
    // An empty label falls back to the slot name — nobody should fail a save
    // over a missing label.
    const label = toLegacyString(row['label']).trim() || `ช่อง ${no}`;
    const hint = toLegacyString(row['hint']).trim();
    out.push(hint ? { no, label, hint } : { no, label });
  }

  out.sort((a, b) => a.no - b.no);
  return { value: out };
}

/**
 * Split the model's answer into slots on [[[custom_content_N]]].
 * Returns Map(slotNumber → text) holding only slots the model filled.
 */
export function parseContentMarkers(text: unknown): Map<number, string> {
  const found = new Map<number, string>();
  const raw = toLegacyString(text);
  if (!raw) return found;

  const re = new RegExp(CONTENT_MARKER_SRC, 'gi');
  let m: RegExpExecArray | null;
  let lastNo: number | null = null;
  let lastPos = 0;

  const push = (no: number | null, from: number, to: number): void => {
    if (no === null) return;
    const v = raw.slice(from, to).trim();
    if (!v) return;
    const existing = found.get(no);
    found.set(no, existing ? `${existing}\n${v}` : v);
  };

  while ((m = re.exec(raw)) !== null) {
    push(lastNo, lastPos, m.index);
    lastNo = Number(m[1]);
    lastPos = m.index + m[0].length;
  }
  push(lastNo, lastPos, raw.length);
  return found;
}

/**
 * Strip markers from text — the customer must never see [[[custom_content_1]]].
 *
 * ⚠️ The `.test()` RegExp MUST NOT carry the `g` flag: a `/g` regex remembers
 * `lastIndex` between calls, causing consecutive calls on the same string to fail.
 */
export function stripContentMarkers(text: unknown): string {
  const s = toLegacyString(text);
  if (!new RegExp(CONTENT_MARKER_SRC, 'i').test(s)) return s;
  return s
    .replace(new RegExp(CONTENT_MARKER_SRC, 'gi'), ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface BuildContentTagMapResult {
  map: Record<string, string>;
  declared: Set<string>;
}

/**
 * Build the content-slot map for one card.
 *   tags    = doc.content_tags (what the card declares)
 *   aiText  = the model's full answer
 */
export function buildContentTagMap(
  tags: unknown,
  aiText: unknown,
): BuildContentTagMapResult {
  const list = Array.isArray(tags) ? (tags as ContentTag[]) : [];
  const declared = new Set<string>();
  const map: Record<string, string> = {};
  if (!list.length) return { map, declared };

  const parsed = parseContentMarkers(aiText);
  const fallbackAll = parsed.size === 0 ? stripContentMarkers(aiText) : '';
  const lowest = list.reduce<number | null>((min, t) => {
    const n = Number(t?.no);
    return Number.isInteger(n) && n >= 1 && n <= CONTENT_TAG_MAX
      ? min === null || n < min
        ? n
        : min
      : min;
  }, null);

  for (const t of list) {
    const no = Number(t?.no);
    if (!Number.isInteger(no) || no < 1 || no > CONTENT_TAG_MAX) continue;
    const name = contentTagName(no);
    declared.add(name);
    let val = parsed.has(no) ? (parsed.get(no) ?? '') : '';
    if (!val && no === lowest && fallbackAll) val = fallbackAll;
    map[name] = val || CONTENT_TAG_EMPTY;
  }
  return { map, declared };
}

export interface ContentTagGuideline {
  tag: string;
  desc: string;
  source: string;
  example: string;
  noPrefix: boolean;
}

/**
 * Table rows for the slots this card declares.
 */
export function buildContentTagGuidelines(
  tags: unknown,
): ContentTagGuideline[] {
  const list = Array.isArray(tags) ? (tags as ContentTag[]) : [];
  return list
    .filter((t) => {
      const n = Number(t?.no);
      return Number.isInteger(n) && n >= 1 && n <= CONTENT_TAG_MAX;
    })
    .sort((a, b) => Number(a.no) - Number(b.no))
    .map((t) => ({
      tag: contentTagToken(t.no),
      desc: t.hint
        ? `${t.label || `ช่อง ${t.no}`} — ${t.hint}`
        : `${t.label || `ช่อง ${t.no}`} (ช่องเนื้อหาของการ์ดนี้)`,
      source: `content_tags[no=${t.no}]`,
      example: `AI ใส่ผ่าน ${contentTagMarker(t.no)}`,
      noPrefix: true,
    }));
}
