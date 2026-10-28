/**
 * [FEAT-20260822-BCASTCARDBUILD] From a saved card to what LINE receives.
 * ===========================================================================
 * The last mile of the variable work: take the card the admin saved, put this
 * recipient's values in, hand the result to the payload builder core already
 * has. It ADDS no builder to core. ต่อของที่มีอยู่ ไม่สร้างใหม่ในคอร์.
 *
 * ⚠️ WHY `plain` RENDERS ONCE AND `personal` PER CHUNK: a plain card has no
 *    per-recipient tag, so rendering it 10,000 times makes 10,000 identical
 *    objects. A personal card rides `recipientsPerRequest: 1`
 *    (`send-matrix.registry.ts`) — one id per chunk. If that cell ever allowed a
 *    batch, this file would address the batch with ONE person's data, which is
 *    why the executor pins the size and this builder refuses a batch outright.
 *
 * revert: delete this file and drop it from `adapters/index.ts`.
 */
import { buildBroadcastMessage, type LineMessage } from '@/infra/line';
import { resolveTitle, type TitleRejection } from './title-rule';

/**
 * 🔴 [FIX-20260823-BCASTONEDASH] THE ONE EMPTINESS RULE BOTH CARD PATHS USE.
 * Repair only what LINE REFUSES — an empty string. It takes `-`, `0`, `false`.
 *
 * WAS TWO OPPOSITE RULES IN ONE FILE, both measured: the FLEX path kept
 * `text:'-'` (as its docblock promises) while the TEXT path ran `asText` →
 * `isEmptyForBroadcast('-')`, so a broadcast whose whole body was `-` shipped as
 * `N/A`. The DASH rule won: `normalizeEmpties` turns every "no value" marker
 * into `N/A` BEFORE substitution, so a dash still here is content the admin
 * typed, and the original repair WRITES `'-'` as its own filler — sweeping it
 * would fight the path we mirror. ขีดที่พิมพ์เอง = เนื้อหา ไม่ใช่ค่าว่าง.
 *
 * ⚠️ `isEmptyForBroadcast` stays right for a VAR VALUE and is untouched: values
 *    are normalised, card text is not. Different jobs, on purpose.
 * ⚠️ `.trim()`, so a `text:' '` spacer becomes a visible `N/A` — what the
 *    ORIGINAL does (flex-render.util.ts:314-317). Accepting a blank instead
 *    turns a var that rendered to one space into an invisible gap where a value
 *    belongs, and fails silently. revert: test `v === ''`. เลือกให้เห็น ดีกว่าเงียบ.
 * ⚠️ Invisibles (U+200B …) are not this gate's business — LINE accepts them;
 *    `empty-value.ts` catches them on the value side, where they arrive.
 */
const isUnsendableText = (v: string): boolean => v.trim() === '';

/** `substituteCard` answers `unknown` — it walks whatever shape it was given. A
 *  text card put a string IN, so a string comes out; `String(x)` on anything
 *  else would stamp `[object Object]` into a card and SEND it, so narrowing
 *  refuses instead. ห้ามแปลง object เป็นข้อความยัดลงการ์ด. */
const asText = (v: unknown): string =>
  typeof v === 'string' && !isUnsendableText(v) ? v : BROADCAST_VAR_EMPTY;

/**
 * Repair a rendered flex card so LINE cannot refuse it.
 * 🔴 DECIDES BY COMPONENT TYPE, NEVER BY KEY NAME. The first version keyed on
 * `text`/`altText`, and that one inversion cost four escapes at once — a text
 * component with no `text` key, `text: 0`, an empty button `label`, a
 * quickReply's `text` rewritten (pinned E1-E4 / O3 in
 * `z-test/unit/broadcast-card-builder.spec.ts`). The original repair
 * (`webhook/flex/flex-render.util.ts:311-350`) has keyed on `type` since it was
 * written; this mirrors its structure instead of inventing a second rule set.
 * ตัดสินด้วยชนิด component ไม่ใช่ชื่อ field.
 *
 * ⚠️ LEFT ALONE ON PURPOSE: a `-` the admin typed (see `isUnsendableText`), and
 *    `uri` — `N/A` is not a URL, and one broken link swapped for another helps
 *    nobody; that belongs to whoever validates the card at save time.
 */
const DROP = Symbol('flex-drop');

/** A text slot LINE will accept: a real string, or a primitive spelled out. */
function repairedText(v: unknown): string {
  // 🔴 The SAME predicate `asText` uses — one rule, one place, no drift.
  if (typeof v === 'string')
    return isUnsendableText(v) ? BROADCAST_VAR_EMPTY : v;
  // 🔴 `0` and `false` are REAL values — a balance of zero is a balance.
  // Sweeping them to `N/A` would be a worse bug than the one this fixes.
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return BROADCAST_VAR_EMPTY;
}

/**
 * What one repaired subtree came back as.
 * 🔴 [FIX-20260823-BCASTIMGCOUNT] THE COUNT TRAVELS WITH THE NODE.
 * `countImageRepairs` diffed the before/after url lists BY INDEX afterwards, so
 * one dropped node shortened the "after" list and every later pair read as a
 * mismatch — measured `imagesReplaced: 2` on a card where ZERO pictures were
 * replaced, and that number goes into a history row people trust. Counting at
 * the swap cannot mis-align; a subtree that DROPS returns 0 because nothing in
 * it ever shipped. นับตอนเปลี่ยนจริง ไม่ใช่เทียบลำดับทีหลัง.
 */
interface RepairedNode {
  /** The repaired node, or `DROP` — which must never leave this module. */
  readonly node: unknown;
  readonly imagesReplaced: number;
  /**
   * Why the job's own `title_detail` was not used.
   *
   * Absent means it WAS used, or none was set. Present means we fell back —
   * and the admin needs to hear it, or they will keep sending a title that
   * never appears. ต้องบอกแอดมิน ไม่งั้นเขาจะส่งซ้ำแบบเดิมตลอดไป.
   */
  readonly titleRejected?: TitleRejection;
}

/** The one answer every drop returns. ⚠️ The count dies WITH the node: a caller
 *  discards a dropped subtree whole, so a picture repaired inside it was never
 *  sent and no history row may claim it. A mutation writing a real number here
 *  SURVIVES because nothing can read it — design, not an untested branch. */
const DROPPED: RepairedNode = { node: DROP, imagesReplaced: 0 };

/** Containers LINE refuses when they hold no children. */
const CHILD_CONTAINERS = new Set(['box', 'carousel']);
/** A bubble must keep one of these, or LINE refuses the bubble. */
const BUBBLE_SECTIONS = ['header', 'hero', 'body', 'footer'] as const;

function repairCard(node: unknown): RepairedNode {
  if (Array.isArray(node)) {
    const kept: unknown[] = [];
    let images = 0;
    for (const child of node) {
      const r = repairCard(child);
      if (r.node === DROP) continue;
      kept.push(r.node);
      images += r.imagesReplaced;
    }
    return { node: kept, imagesReplaced: images };
  }
  if (node === null || typeof node !== 'object') {
    return { node, imagesReplaced: 0 };
  }

  const out: Record<string, unknown> = {};
  let images = 0;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const r = repairCard(v);
    // A dropped value takes its KEY with it — how an empty `body` VANISHES
    // rather than shipping as `body: null`.
    if (r.node === DROP) continue;
    out[k] = r.node;
    images += r.imagesReplaced;
  }

  // A real text COMPONENT — never a `text` property on something else.
  if (out['type'] === 'text') out['text'] = repairedText(out['text']);

  // An unusable picture refuses the message just like empty text does;
  // `safeImageUrl` only ever reached the `image` CARD type before.
  if (out['type'] === 'image' || out['type'] === 'icon') {
    // ⚠️ Counted on `isUsableImageUrl`, not `before !== after`: `safeImageUrl`
    //    TRIMS a good url, and a trim is not a replacement. ตัดช่องว่าง ≠ เปลี่ยนรูป.
    if (!isUsableImageUrl(out['url'])) images += 1;
    out['url'] = safeImageUrl(out['url']);
  }

  // Empty visible labels are rejected too, and unlike a URL they CAN be
  // repaired: `N/A` is perfectly good text.
  for (const f of ['label', 'displayText', 'data'] as const) {
    if (typeof out[f] === 'string' && !out[f].trim())
      out[f] = BROADCAST_VAR_EMPTY;
  }

  /**
   * ⚠️⚠️ [FIX-20260823-BCASTEMPTYBOX] A container with no children removes itself
   *   and cascades upward. THREE holes measured, each a LINE 400 costing the
   *   whole message for every recipient: the test required `Array.isArray`, so a
   *   box carrying NO `contents` key rode through (LINE requires the key —
   *   missing is as unsendable as empty); `carousel` was not covered at all; and
   *   a BUBBLE that lost its only section shipped as `{"type":"bubble"}`.
   *
   *   🔒 The ORIGINAL (`flex-render.util.ts:342-349`) keeps the array test and
   *   guards the rule on `dropWhenEmpty.size`, so a LEGACY reply card holding a
   *   deliberately empty box cannot change. It is proven and off limits. This
   *   file has no legacy cards to protect and promises "LINE cannot refuse it",
   *   so it CLOSES the hole rather than inheriting it — a narrow, deliberate
   *   divergence, written here so nobody "restores parity" and re-opens a 400.
   *   revert: drop the two clauses below, restore the `Array.isArray` test.
   */
  const type = out['type'];
  if (typeof type === 'string' && CHILD_CONTAINERS.has(type)) {
    const contents = out['contents'];
    if (!Array.isArray(contents) || contents.length === 0) return DROPPED;
  }
  if (type === 'bubble' && !BUBBLE_SECTIONS.some((sec) => sec in out)) {
    return DROPPED;
  }
  return { node: out, imagesReplaced: images };
}

/**
 * 🔴 THE LAST GATE, ACTUALLY WALKED THROUGH. `findLeftoverTags` called itself
 * "the last gate before a card is handed to LINE" while nothing in production
 * called IT — a gate nobody walks through is decoration. It fires only on braces
 * substitution could not read at all, which is what a customer sees as `{{...}}`
 * in their chat. ปีกกาหลุดถึงลูกค้า = ของที่เส้นเดิมทำ ห้ามทำซ้ำ.
 */
function sweepLeftovers(card: unknown): {
  readonly card: unknown;
  readonly leftover: readonly string[];
} {
  const leftover = findLeftoverTags(card);
  if (leftover.length === 0) return { card, leftover };

  /**
   * 🔴 ITS OWN MECHANISM, deliberately — not `substituteCard`, not its regex.
   * ⚠️⚠️ [FIX-20260823-BCASTNESTBRACE] Until now this comment described what the
   *   code did NOT do: `strip` INLINED a copy of the substituter's own
   *   `\{\{[^{}]*\}\}`, so both layers went blind on the same input and
   *   `{{ {tag} }}` was delivered verbatim by both — two locks, one key. It now
   *   uses `stripBraceRuns`, an index SCANNER with no character class to get
   *   wrong (`render/substitute.ts`). ด่านสำรองต้องใช้กลไกคนละตัว.
   */
  const strip = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return stripBraceRuns(node, BROADCAST_VAR_EMPTY);
    }
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[strip(k) as string] = strip(v);
    }
    return out;
  };
  return { card: strip(card), leftover };
}

import { BROADCAST_VAR_EMPTY } from '../../broadcast-var/checks/empty-value';
import {
  isUsableImageUrl,
  safeImageUrl,
} from '../../broadcast-var/checks/image-url.shape';
import {
  findLeftoverTags,
  stripBraceRuns,
  substituteCard,
} from '../../broadcast-var/render/substitute';
import type { BroadcastChunk } from '../chunk';
import type { ChunkMessageBuilder, ChunkMessages } from '../sinks/inline.sink';

/** The card as the admin saved it, before any value is put in. */
export interface SavedCard {
  readonly type?: string;
  readonly text?: string;
  readonly image_url?: string;
  readonly flex_json?: unknown;
}

/** Everything known about ONE recipient, already read from Mongo. */
export interface RecipientVars {
  readonly vars: Readonly<Record<string, string>>;
}
export interface CardBuildResult {
  readonly messages: LineMessage[];
  /** Tags nothing knew about — now `N/A`, and the run should report them. */
  readonly unknownTags: readonly string[];
  /**
   * How many broken pictures were swapped for the fallback. ⚠️ WAS A BOOLEAN:
   * a card carries many images and `true` cannot say how many; worse, the flex
   * branch hardcoded `false`, so a history row claimed `images_replaced: 0`
   * about a card nothing had looked at. นับ ไม่ใช่ตอบใช่/ไม่ใช่.
   */
  readonly imagesReplaced: number;
  /**
   * Why the job's `title_detail` was not used — absent means it WAS used, or
   * none was set.
   *
   * ⚠️ WAS RETURNED BUT NOT DECLARED (fixed 23/08). The flex branch put this on
   *    the object through a spread, which skips excess-property checking, so it
   *    shipped every send and NO CALLER COULD READ IT — `r.titleRejected` was a
   *    compile error. A value that exists at runtime and not in the type is
   *    worse than a missing one: it looks wired. คืนค่าแล้วแต่ไม่ประกาศ = ไม่มีใครอ่านได้.
   */
  readonly titleRejected?: TitleRejection;
}

/**
 * Render one card for one set of values. Never throws, and never puts an empty
 * string into a card: LINE rejects a flex `text` of `''`, so one missing value
 * would cost the whole card. `N/A` is the floor. ค่าว่างส่งไม่ได้ ต้องเป็น N/A เสมอ.
 */
export function buildCardMessage(
  card: SavedCard | undefined,
  vars: Readonly<Record<string, string>>,
  /** The job's `title_detail`. Ignored by text and image cards — see below. */
  titleDetail?: unknown,
): CardBuildResult {
  const type = card?.type;

  if (type === 'text') {
    const r = substituteCard(card?.text ?? '', vars, BROADCAST_VAR_EMPTY);
    const swept = sweepLeftovers(r.card);
    return {
      messages: [
        buildBroadcastMessage({ type: 'text', text: asText(swept.card) }),
      ],
      unknownTags: [...r.unknown, ...swept.leftover],
      imagesReplaced: 0,
    };
  }

  if (type === 'image') {
    const r = substituteCard(card?.image_url ?? '', vars, BROADCAST_VAR_EMPTY);
    const raw = asText(r.card);
    const url = safeImageUrl(raw);
    return {
      messages: [buildBroadcastMessage({ type: 'image', image_url: url })],
      unknownTags: r.unknown,
      /* ⚠️ compare TRIMMED. `safeImageUrl` trims; the saved value may not,
         so `'https://x/a.jpg\n'` reported a replacement that never happened. */
      imagesReplaced: url !== raw.trim() ? 1 : 0,
    };
  }

  const r = substituteCard(card?.flex_json, vars, BROADCAST_VAR_EMPTY);

  /* 🔴 A card with no `flex_json` is REFUSED, not shipped hopefully.
     `buildBroadcastMessage` passes it through, so `contents: undefined` reaches
     LINE and the whole message dies. ไม่มีเนื้อการ์ด = ปฏิเสธเสียงดัง. */
  if (r.card === null || typeof r.card !== 'object') {
    return { messages: [], unknownTags: r.unknown, imagesReplaced: 0 };
  }

  const swept = sweepLeftovers(r.card);
  const repaired = repairCard(swept.card);
  const title = resolveTitle(titleDetail);

  /**
   * 🔴🔴 [FIX-20260823-BCASTDROPLEAK] THE SYMBOL NEVER LEAVES THIS FUNCTION.
   * MEASURED: a card that repaired down to nothing returned `DROP`, nobody
   * looked, and the wire got `{"type":"flex","altText":"Broadcast message"}` —
   * `JSON.stringify` silently DROPS a key holding a Symbol. LINE 400, and every
   * recipient of that broadcast got nothing.
   *
   * The original turns a root drop into `null` so its caller falls back to a
   * plain text reply (`flex-render.util.ts:357-359`). A broadcast has no such
   * fallback — a card the admin wrote must not become a message they did not
   * write — so the answer is this file's existing refusal: zero messages, a
   * failed chunk the sink reports. Loud, attributable, and honest about the
   * counts (nothing shipped ⇒ nothing repaired). ปฏิเสธเสียงดัง ดีกว่าโดน LINE ตีกลับ.
   */
  if (repaired.node === DROP) {
    return {
      messages: [],
      unknownTags: [...r.unknown, ...swept.leftover],
      imagesReplaced: 0,
    };
  }

  /**
   * 🔴 `altText` IS OVERWRITTEN HERE, AFTER CORE BUILT THE MESSAGE.
   *
   * `build-payload.broadcast.ts:38` hardcodes `'Broadcast message'`, and its
   * own header says that quirk is preserved on purpose — so it is not ours to
   * change. Setting the field on the object core returns leaves core running
   * exactly as it always has, for every one of its callers.
   * ไม่แตะคอร์ · ทับค่าหลังคอร์สร้างเสร็จ.
   */
  const message = buildBroadcastMessage({
    type: 'flex',
    flex_json: repaired.node,
  }) as Record<string, unknown>;
  message['altText'] = title.title;

  return {
    messages: [message],
    unknownTags: [...r.unknown, ...swept.leftover],
    imagesReplaced: repaired.imagesReplaced,
    ...(title.rejected ? { titleRejected: title.rejected } : {}),
  };
}

/**
 * A card with no per-recipient tag.
 *
 * 🔴 STILL RENDERED EAGERLY IN THE CONSTRUCTOR — one card per OA, all of them
 * up front. That property is not decoration: a card that cannot be rendered
 * must fail BEFORE the run claims the job, never halfway through a send.
 * Rendering per OA on demand would have moved that failure inside the run.
 * พังตั้งแต่ยังไม่จอง job ดีกว่าพังกลางทาง.
 *
 * 🔴 [FEAT-20260823-BCASTOAVARS] WHY ONE CARD PER OA. `hook_*` and
 * `site_rules.*` differ between OAs, so one rendered card cannot serve a job
 * that sends to two of them — it would show OA-A's domain to OA-B's followers.
 * A job has a handful of OAs, so rendering each is cheap; the alternative
 * (render once, hope they match) is silently wrong.
 * การ์ดใบเดียวใช้ข้าม OA ไม่ได้ ค่ามันคนละชุด.
 *
 * ⚠️ THE NO-OA CARD IS STILL BUILT. A caller that passes no map at all, and a
 *    `hookId` this builder has never heard of, both get the same fallback card
 *    rendered with no values — which is exactly what every caller got before
 *    this change. Falling back rather than refusing keeps the widening
 *    additive. ไม่รู้จัก OA นั้น = ใช้ใบพื้นฐาน ไม่ใช่ล้ม.
 */
export class PlainCardMessageBuilder implements ChunkMessageBuilder {
  /** The card with no OA values — the answer for an unknown or absent hook. */
  private readonly built: CardBuildResult;
  /** hookId → that OA's card, rendered in the constructor alongside `built`. */
  private readonly perOa: ReadonlyMap<string, CardBuildResult>;

  constructor(
    card: SavedCard | undefined,
    vars: Readonly<Record<string, string>>,
    titleDetail?: unknown,
    /**
     * hookId → the values every recipient of that OA sees
     * (`oa-vars.reader.ts`). Omit it and this class behaves exactly as it did
     * before OA variables existed.
     */
    oaVars?: Readonly<Record<string, Readonly<Record<string, string>>>>,
  ) {
    this.built = buildCardMessage(card, vars, titleDetail);
    const perOa = new Map<string, CardBuildResult>();
    for (const [hookId, hookVars] of Object.entries(oaVars ?? {})) {
      /* `vars` first so a caller-supplied value still wins: this parameter is
         the run-wide map and the OA map fills in around it. */
      perOa.set(
        hookId,
        buildCardMessage(card, { ...vars, ...hookVars }, titleDetail),
      );
    }
    this.perOa = perOa;
  }

  messagesFor(_chunk?: BroadcastChunk, hookId?: string): ChunkMessages {
    const built =
      (hookId === undefined ? undefined : this.perOa.get(hookId)) ?? this.built;
    return {
      messages: built.messages,
      imagesReplaced: built.imagesReplaced,
      unknownTags: built.unknownTags,
    };
  }

  /** The no-OA card. Kept for callers that only ask "did this card render?". */
  get result(): CardBuildResult {
    return this.built;
  }

  /** What ONE OA's card came out as — `undefined` if that OA was not built. */
  resultFor(hookId: string): CardBuildResult | undefined {
    return this.perOa.get(hookId);
  }
}

/** A refusal: zero messages ⇒ the sink reports a failed chunk, loud. The zero
 *  counts are honest — nothing rendered, so nothing was measured. */
const NOTHING: ChunkMessages = {
  messages: [],
  imagesReplaced: 0,
  unknownTags: [],
};

/** Looks up one recipient's values. Mongo in production, a map in specs. */
export interface RecipientVarSource {
  /**
   * @param hookId Which OA this recipient is being sent to.
   *
   * 🔴 [FEAT-20260823-BCASTCARDTYPE] ADDED, OPTIONAL. `hook_*` and
   * `site_rules.*` differ per OA, so a source serving a run that touches two
   * of them needs to know which one — the same reason `messagesFor` gained a
   * `hookId`. Optional so a single-OA source can ignore it.
   * ค่าต่างกันต่อ OA ⇒ ต้องรู้ว่ากำลังส่งให้ OA ไหน.
   */
  varsFor(
    lineUserId: string,
    hookId?: string,
  ): Readonly<Record<string, string>> | null;
}
/**
 * A card carrying `{{member.*}}` / `{{profile.*}}`: rendered per recipient.
 * 🔴 REFUSES A BATCH. More than one id in a chunk means `recipientsPerRequest`
 * was ignored upstream, and rendering "the first one" would send that person's
 * name and balance to everyone else. Nothing = a failed chunk the sink reports,
 * which is loud; guessing is silent. ยอมให้ chunk ล้ม ดีกว่าส่งผิดคน.
 */
export class PersonalCardMessageBuilder implements ChunkMessageBuilder {
  /**
   * [FIX-20260831-PERSONALCOPY] what each person was ACTUALLY sent.
   *
   * The transcript copy needs the substituted card per recipient, and this
   * class used to render inside `messagesFor` and throw the result away — so
   * the send loop had nothing to hand the chat-room copy, and a personal run
   * stored the RAW `{{profile.*}}` card in every room (stg, 30/08, job
   * "เชคโปรทดสอบ"). Re-rendering later is NOT an option: the paged var source
   * forgets each member page as the next one loads, so after the run only the
   * last page could answer. เก็บตอน render — ทีหลังไม่มีของให้ถามแล้ว.
   *
   * Bounded by construction, not by hope: a personal run sends at most
   * `MAX_REQUESTS_PER_RUN` (300) recipients per OA across at most 2 OAs
   * (send-profile/limits), and only `messages[0]` is kept — the same message
   * the transcript writes.
   *
   * ⚠️ Refusals are NEVER stored: an empty render must stay a failed chunk,
   *    and a later retry that succeeds simply overwrites the key.
   */
  private readonly sent = new Map<string, LineMessage>();

  constructor(
    private readonly card: SavedCard | undefined,
    private readonly source: RecipientVarSource,
    private readonly titleDetail?: unknown,
  ) {}

  messagesFor(chunk: BroadcastChunk, hookId?: string): ChunkMessages {
    if (chunk.to.length !== 1) return NOTHING;
    const id = chunk.to[0];
    if (id === undefined) return NOTHING;

    /* 🔴 `hookId` FORWARDED, not dropped. Without it a multi-OA source cannot
       tell which OA's values to use and answers `null` for everyone — every
       chunk refused, with nothing in the logs pointing here.
       ไม่ส่งต่อ = ทุก chunk ถูกปฏิเสธเงียบ ๆ. */
    const vars = this.source.varsFor(id, hookId);
    if (vars === null) return NOTHING;

    const built = buildCardMessage(this.card, vars, this.titleDetail);
    /* [FIX-20260831-PERSONALCOPY] captured HERE, from the very render that is
       sent — never by calling `varsFor` again (a spec counts those calls). */
    const first = built.messages[0];
    if (first !== undefined) {
      this.sent.set(`${hookId ?? ''}\u0000${id}`, first);
    }
    return {
      messages: built.messages,
      imagesReplaced: built.imagesReplaced,
      unknownTags: built.unknownTags,
    };
  }

  /**
   * [FIX-20260831-PERSONALCOPY] the first message THIS person was sent on THIS
   * OA — `undefined` for anyone whose chunk never rendered (refused/failed),
   * which the caller treats as "fall back to the saved card", never as blank.
   * Param order mirrors `RecipientVarSource.varsFor`.
   */
  sentPayloadFor(lineUserId: string, hookId?: string): LineMessage | undefined {
    return this.sent.get(`${hookId ?? ''}\u0000${lineUserId}`);
  }
}
