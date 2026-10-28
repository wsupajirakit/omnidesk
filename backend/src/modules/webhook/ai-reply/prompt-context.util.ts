/**
 * Context building — assembling what the model is told, before it is asked.
 * Legacy `webhookController.js:1168-1218, 4104-4211`.
 *
 * Pure. The chat history is passed in already fetched, so the assembly order —
 * which is the part that has broken before — is testable without a database.
 */

import { buildContextVarMap } from '../flex/flex-render.util';
import { asString } from '../logging/coerce-mask.util';

/**
 * Which box goes into which block, in the order they reach the model.
 * ⚠️ A fourth box is one row here and no logic change anywhere.
 */
export const DOC_BLOCKS = [
  {
    field: 'suggestion_text',
    start: '[START_OF_BASIC_INFO]',
    end: '[END_OF_BASIC_INFO]',
  },
  {
    field: 'suggestion_company_text',
    start: '[START_OF_COMPANY_INFO]',
    end: '[END_OF_COMPANY_INFO]',
  },
  // [PROMPT-20260813-DROPNOPROFILE] Owner order 2026-08-13: stop sending the
  // `suggestion_text_no_profile` box into the model prompt. The DB column stays
  // (dashboard still loads/saves it, hook.schema default ''), and every OTHER
  // box is byte-identical — only this one row is removed here, so the prompt
  // loses [START_OF_NO_PROFILE_DATA] and nothing else.
  // revert: re-add the row below.
  //   { field: 'suggestion_text_no_profile',
  //     start: '[START_OF_NO_PROFILE_DATA]', end: '[END_OF_NO_PROFILE_DATA]' },
] as const;

/**
 * Which blocks get sent — today, all of them, every time. Legacy:1181-1183.
 *
 * ⚠️ The code USED to pick one of two based on `hasProfile`, but `hasProfile`
 *    comes from a bare HTTP 200: the shop-api answers 200 with an EMPTY profile for
 *    a customer who has not linked an account, so `hasProfile` was true almost
 *    always and `suggestion_text_no_profile` was effectively dead — which
 *    matched what the system owner had noticed. All blocks are now sent and the
 *    Training Document itself tells the model which to use when.
 *
 * `hasProfile` is kept in the signature: it is the seam for changing that
 * decision in one place, and the caller should not have to learn about it.
 */
export function pickDocBlocks(
  _hook: Record<string, unknown> | null | undefined,
  _hasProfile: boolean,
): readonly { field: string; start: string; end: string }[] {
  return DOC_BLOCKS;
}

/**
 * Assemble the Training Document. Legacy:1203-1218.
 *
 * TWO SHAPES live in the database at once, on purpose — there is no migration:
 *
 *   LEGACY  `suggestion_text` still carries `[END_OF_BASIC_INFO]`, because the
 *           old dashboard concatenated box 1 and box 2 into it. Such a row is
 *           sent UNTOUCHED, so a hook nobody re-saves keeps a byte-identical
 *           prompt.
 *   NEW     every box is a clean column with no tags (the save-time normaliser
 *           strips them), so each non-empty one is wrapped and joined.
 *
 * ⚠️ The discriminator is "does the data contain a tag", not a version field.
 *    That works only because the normaliser removes tags on every write, so a
 *    new-shape row can never carry one.
 * ⚠️ The caller prepends "Today is …" and substitutes `[[[history]]]` AFTER
 *    this. Order must not be swapped — a block added later then gets history
 *    substitution for free.
 */
export function buildSuggestionForHook(
  hook: Record<string, unknown> | null | undefined,
  hasProfile: boolean,
): string {
  const legacy = String(hook?.['suggestion_text'] ?? '').includes(
    '[END_OF_BASIC_INFO]',
  );
  if (legacy) {
    // [PROMPT-20260813-DROPNOPROFILE] A legacy row returns its `suggestion_text`
    // for BOTH profile states now — the no-profile branch used to fall back to
    // `suggestion_text_no_profile`, which is the one box we intentionally stop
    // sending. `suggestion_text` (basic info) is unchanged, byte for byte.
    // revert: restore the hasProfile ternary with the no_profile fallback.
    return String(hook?.['suggestion_text'] ?? '');
  }
  return pickDocBlocks(hook, hasProfile)
    .map((b) => {
      const body = String(hook?.[b.field] ?? '').trim();
      // An empty box must not grow an empty block.
      return body ? `${b.start}\n${body}\n${b.end}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * [FEAT-20261026-RAGENGINE] The same Training Document, as the boxes it is built from.
 *
 * The RAG engine indexes EXACTLY what `buildSuggestionForHook` sends — and in `replace` mode it
 * rebuilds the suggestion in that same shape. Invariant (pinned by `rag-engine-wiring.spec.ts`):
 *   sections.map(s => s.start ? `${s.start}\n${s.text}\n${s.end}` : s.text).join('\n')
 *     === buildSuggestionForHook(hook, hasProfile)
 * A legacy row (box 1 already carries its markers) is one section with no wrapper.
 * ⚠️ Change one function, change the other — the spec goes red if they drift.
 * ต้องตรงกับ buildSuggestionForHook ทุกไบต์ — แก้ตัวหนึ่ง ต้องแก้อีกตัว
 */
export function buildSuggestionSections(
  hook: Record<string, unknown> | null | undefined,
  hasProfile: boolean,
): { start: string; end: string; text: string }[] {
  /* String(x ?? '') on purpose — byte-identical to buildSuggestionForHook, same coercion. */
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const raw = String(hook?.['suggestion_text'] ?? '');
  if (raw.includes('[END_OF_BASIC_INFO]')) {
    return raw ? [{ start: '', end: '', text: raw }] : [];
  }
  return pickDocBlocks(hook, hasProfile)
    .map((b) => ({
      start: b.start,
      end: b.end,
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      text: String(hook?.[b.field] ?? '').trim(),
    }))
    .filter((s) => s.text);
}

/**
 * Does the combined result contain a usable profile? Legacy:4131-4133.
 *
 * Two ways, because the custom-tool path finds its profile block by the
 * `is_profile` flag (the endpoint key is whatever the admin named it), while
 * the original path still addresses the block by its literal path key.
 */
export function hasProfileData(profileData: unknown): boolean {
  const data =
    profileData && typeof profileData === 'object'
      ? (profileData as Record<string, unknown>)
      : {};
  const flagged = Object.values(data).some((b) => {
    const blk = b as Record<string, unknown> | null;
    return blk?.['is_profile'] && blk?.['success'] === true;
  });
  if (flagged) return true;
  const legacyBlock = data['Path : api/v1/customer'] as
    Record<string, unknown> | undefined;
  return legacyBlock?.['success'] === true;
}

/** History rows in the shape the formatter needs. */
export interface HistoryMessage {
  sender_type?: string;
  content?: unknown;
}

/** Default and ceiling for `[[[history]]]`. Legacy:4162-4166. */
export const HISTORY_LIMIT_DEFAULT = 5;
export const HISTORY_LIMIT_MAX = 30;

/**
 * How many past messages `[[[history]]]` should carry, per OA.
 *
 * Falls back to 5 for every unusable value — column absent on an older hook,
 * null, non-numeric, 0, negative — then clamps to 30 so a bad row in the
 * database cannot pull thousands of messages into a prompt.
 *
 * ⚠️ This is the customer-reply history only. The "summarise for the admin"
 *    path (limit 10) and the "categorise the room" path (limit 5) are separate
 *    and must stay untouched.
 */
export function resolveHistoryLimit(
  hook: Record<string, unknown> | null | undefined,
): number {
  const raw = Number(hook?.['ai_history_limit']);
  return Number.isFinite(raw) && raw > 0
    ? Math.min(Math.trunc(raw), HISTORY_LIMIT_MAX)
    : HISTORY_LIMIT_DEFAULT;
}

/**
 * Render fetched history for the prompt. Legacy:4174-4191.
 *
 * @param messages newest-first, as the query returns them; reversed here so the
 *   model reads oldest → newest.
 *
 * ⚠️ A stored `[[[img_a…]]]` answer becomes "[Image sent to customer]" — the
 *    raw tag would teach the model to emit tags conversationally.
 * ⚠️ Long messages are cut at 250 characters. The history is context, not a
 *    transcript, and one long message must not crowd out four others.
 */
export function formatHistory(messages: HistoryMessage[]): string {
  if (!messages.length) {
    return '[start-of-history]\nnone\n[end-of-history]';
  }
  const body = [...messages]
    .reverse()
    .map((m) => {
      let content: unknown = m.content;
      if (typeof content === 'string') {
        content = describeMarkers(content);
        if ((content as string).length > 250) {
          content = `${(content as string).substring(0, 250)}...`;
        }
      }
      return `${m.sender_type === 'customer' ? 'Customer' : 'Bot'}: ${String(content)}`;
    })
    .join('\n');
  return `[start-of-history]\n${body}\n[end-of-history]`;
}

/* ===========================================================================
 * [FIX-20260821-HISTMARKERS] internal markers, described instead of quoted
 * ===========================================================================
 * WHAT THIS IS FOR. A stored history line can carry a marker that means
 * something to US and nothing to a customer — `[Flex]` says "a card went out",
 * `[[[assist]]]` says "this was handed to a human". They are stored ON PURPOSE:
 * `webhook.service.ts:2237-2241` records the owner's instruction that the chat
 * room must show the whole sentence INCLUDING the marker, so an operator can
 * see why a room reached them. This function does not change that. It changes
 * only what the MODEL is shown, in memory, on the way into one prompt.
 *
 * WHY IT MATTERS — measured, not theorised. Production 2026-08-20, room
 * a0d000000000000000000008: a customer asked the same question twice, 34
 * seconds apart. The first answer went out as a card, so the stored line read
 * `[Flex] ข้อมูลส่วนนี้ต้องลงทะเบียน…`. On the second question the model
 * REPEATED THAT LINE BACK, marker and all — 117 characters, identical byte for
 * byte. The customer received a LINE message beginning `[Flex] `, and the
 * dashboard painted a red error card because the row had no `flex_json` to
 * render. โมเดลไม่ได้หลอน มันลอกสิ่งที่เราป้อนให้มันเอง.
 *
 * ⚠️ `[[[assist]]]` IS THE DANGEROUS ONE, not `[Flex]`. Copied back by the
 * model it claims the room, opens a ticket and fires a Telegram card with
 * nobody having asked. 71 rows in the database carry it in `content` today.
 *
 * ⚠️ A PROMPT INSTRUCTION DOES NOT FIX THIS. The OA whose room this happened in
 * already writes, right under its `[[[history]]]` marker: "ต้องไม่ตอบคำตอบเดิม ๆ
 * / ใช้อ้างอิงเท่านั้น". The model copied anyway. The input has to change.
 *
 * TWO SHAPES, TWO TREATMENTS — and they are not interchangeable:
 *   · A LEADING marker labels the whole line, so the line is relabelled.
 *   · An INLINE marker sits at the end of a real sentence, so only the marker
 *     is removed. Dropping the sentence would lose what the bot actually said.
 *
 * ⚠️ LEADING MARKERS MATCH AT THE START ONLY. `[image]` (81 rows) and
 * `[sticker]` (5 rows) are what a CUSTOMER's own message looks like and must
 * reach the model unchanged; and a sentence that merely mentions `[Flex]`
 * mid-way keeps its meaning. Verified against 633 real rows: 52 lines start
 * with `[Flex`, ALL of them bot rows, and ZERO rows carry it anywhere else.
 *
 * PRECEDENT: `[[[img_a…]]]` was already handled exactly this way, for exactly
 * this reason — its note said the raw tag "would teach the model to emit tags
 * conversationally". This generalises that one case; it does not invent a rule.
 *
 * ADDING A MARKER LATER: put a LEADING one in `LEADING_MARKERS` (longest prefix
 * first is not required — the first match wins and they do not overlap) or an
 * INLINE one in `INLINE_MARKERS`. Nothing else changes.
 *
 * revert: delete this function and restore the two-line `[[[img_a` check inside
 * `formatHistory` above. Nothing is persisted, so a revert is complete at once.
 */
const LEADING_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['[[[img_a', '[Image sent to customer]'],
  ['[Flex-Error]', '[ส่งการ์ดให้ลูกค้าแล้ว (การ์ดมีปัญหา)]'],
  ['[Flex]', '[ส่งการ์ดให้ลูกค้าแล้ว]'],
];

/**
 * Markers that sit inside a real sentence — remove the marker, keep the words.
 *
 * ⚠️ THE LOOSE BRACKETS ARE DELIBERATE, and they are not this file's invention:
 * every consumer in the system already accepts a malformed marker —
 * `/\[\[\[?customer-helper\]\]\]?/gi`, `/\[\[\[?flex_profile\]\]\]?/gi`,
 * `/\[\[\[?(flex_m\d{5})\]\]\]?/gi` — so `[[assist]]` ACTS exactly like
 * `[[[assist]]]` does. A stripper that only understood the tidy form would let
 * the loose one through into the prompt, where the model could copy it and the
 * consumer would then fire on it. Match the same set they match, or the hole
 * simply moves. ตัวรับยอมรับแบบหลวม ⇒ ตัวถอดต้องยอมรับแบบหลวมด้วย.
 * (Real data holds 71 tidy markers and zero loose ones today — this is about
 * what the model can EMIT, not about what is already stored.)
 */
const INLINE_MARKERS = /\[\[\[?[a-z0-9_-]+\]\]\]?/gi;

export function describeMarkers(text: string): string {
  for (const [prefix, label] of LEADING_MARKERS) {
    if (text.startsWith(prefix)) {
      // `[[[img_a…]]]` carries no readable words after it, so the whole line
      // becomes the label. The card markers DO — keep what the bot said.
      const rest = prefix === '[[[img_a' ? '' : text.slice(prefix.length);
      return `${label}${rest}`.trim();
    }
  }
  return text
    .replace(INLINE_MARKERS, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Substitute `{{hook_domain}}` and friends into free text.
 * Legacy:4104-4119 [FEAT-20260804-DOCCTXVAR] / [FIX-20260804-SUGGESTCTXVAR].
 *
 * ⚠️ There are TWO texts that reach the model, not one: `relatedText` (from a
 *    Google Doc, present only when the hook sets `doc_id`) and
 *    `processedSuggestion` (the Training Document typed into the form). The
 *    first version substituted only the former — and most hooks set no
 *    `doc_id`, so it did nothing at all and a bot shipped the literal string
 *    "{{hook_domain}}" to customers. Both paths must go through here.
 *
 * ⚠️ Applied to the document text AFTER retrieval, never before: retrieval
 *    caches by `doc_id`, so substituting first would make the cached body
 *    hook-specific and two hooks sharing a doc could read each other's domain.
 * ⚠️ No `{{` at all → the original string is returned, byte for byte.
 * ⚠️ An unknown name keeps its literal text rather than blanking, so a typo is
 *    visible instead of silent.
 * ⚠️ Never throws — this sits on the reply path, and a failure here must not
 *    silence the bot.
 */
export function substituteCtxVars(
  text: string,
  hook: Record<string, unknown> | null | undefined,
  content: string,
): string {
  if (!text || !text.includes('{{')) return text;
  try {
    const ctxVars = buildContextVarMap({ hook, content });
    return text.replace(
      /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
      (whole: string, name: string) =>
        Object.prototype.hasOwnProperty.call(ctxVars, name)
          ? ctxVars[name]!
          : whole,
    );
  } catch {
    return text;
  }
}

/**
 * Inject the history block. Legacy:4196 and 4200.
 *
 * ⚠️ [FIX-20260803-HISTALL] `replaceAll`, not `replace`. A prompt containing two
 *    `[[[history]]]` markers leaked the second one to the model as raw text.
 *    Byte-identical for the single-marker prompts that are the norm.
 */
export function injectHistory(
  suggestion: string,
  historyBlock: string,
): string {
  return suggestion.replaceAll('[[[history]]]', historyBlock);
}

export function needsHistory(suggestion: string): boolean {
  return suggestion.includes('[[[history]]]');
}

/**
 * legacy:1448 — the OA's vocabulary is its bound custom tool, or none.
 *
 * [PROG-20260905-LADDER] Moved out of `webhook.service.ts` where it was module-private:
 * the model request is assembled by a ladder step now, and a role file cannot import from
 * the service without creating a cycle. Same body, same one call site.
 *
 * ⚠️ `flex-data-vars.util.ts:594` implements the same legacy rule for the flex path and is
 * deliberately NOT merged with this: it coerces with `String(x)` where this one uses the
 * module's `asString`, and the two have different null behaviour for a non-string column.
 * Merging them is a behaviour decision, not a tidy-up.
 */
export function resolveDictTool(
  hook: Record<string, unknown> | null,
): string | null {
  /* 🔴 THE FIRST VERSION OF THIS MOVE RE-IMPLEMENTED `asString` INLINE as
     `typeof value === 'string' && value ? value : null` — and that is not the same
     function. `custom_tool_id` is a Mongo column and arrives as an ObjectId, which
     `asString` stringifies and the inline version answered `null` for: every OA with a
     bound tool would silently have lost its vocabulary, with nothing failing to compile.
     An empty string differs too (`asString` keeps `''`, the rewrite made it `null`).
     ยกมาทั้งฟังก์ชัน อย่าเขียนใหม่ให้เหมือน */
  return asString(hook?.['custom_tool_id']) ?? null;
}
