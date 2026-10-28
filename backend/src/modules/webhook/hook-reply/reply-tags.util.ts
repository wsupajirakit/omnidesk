/**
 * Turning the model's raw answer into what actually goes to LINE.
 * Legacy `webhookController.js:999-1118, 1508-1591, 4487-4529, 4648-4712`.
 *
 * ⚠️ ORDER IS THE CONTRACT here, not an implementation detail. Every tag must
 *    be detected BEFORE it is stripped (detection is what selects the reply
 *    shape), and every tag must be stripped BEFORE the 4000-character truncation
 *    — otherwise a tag sitting at the end of a long answer survives the cut and
 *    the customer sees brackets. `resolveReplyTags` performs the whole sequence
 *    in one place so the order cannot drift between call sites.
 */

/* [FEAT-20260831-MENUMAINTAG] the menu card-tag spelling, from the neutral leaf.
   NOT from `@/modules/menu`: that module's importer list is closed by
   `menu-isolation-census.spec.ts` and adding to it would be a coupling with no
   off switch. */
import { MENU_CARD_TAG_PREFIX } from '@/common/utils/menu-card-tag';

import { stripNowBlocks } from '../now-block/now-block.strip';

/** `[[customer-helper]]` or `[[[customer-helper]]]`. Legacy:999. */
const CUSTOMER_HELPER_TAG = /\[\[\[?customer-helper\]\]\]?/gi;
/** `[[[flex_profile]]]`. Legacy:1130. */
const FLEX_PROFILE_TAG = /\[\[\[?flex_profile\]\]\]?/gi;
/** `[[[flex_m00001]]]` — copied from the Flex Message page. Legacy:1508. */
const FLEX_TAG_REF = /\[\[\[?(flex_m\d{5})\]\]\]?/gi;
/** `[[[flex_pc00001]]]` — profile-semi-custom card. Legacy:1578. */
const FLEX_PC_TAG_REF = /\[\[\[?(flex_pc\d{5})\]\]\]?/gi;

/**
 * [FEAT-20260831-MENUMAINTAG] `[[[menu_main_00001]]]` / `[[[menu_sub_00011]]]` —
 * the MINTED reference of one stored menu card, copied from the Flex page.
 *
 * ⚠️ Built from `MENU_CARD_TAG_PREFIX`, never typed out: that constant is the
 * single spelling of this family (`menu-tag.util.ts` forbids a second literal in
 * its own header), so a rename there reaches this reader with no edit here.
 * ⚠️ UNDERSCORES. The scenario marker `[[[menu-primary]]]` uses hyphens and names
 * a DEFINITION, not a card; the two must never match each other's text, which is
 * why this alternation is built from the full prefixes rather than from `menu`.
 */
const MENU_CARD_TAG_REF = new RegExp(
  /* the alternation is grouped with `(?: … )` before the digits — without it the
     `\d+` binds to the LAST branch only, and `[[[menu_main_00001]]]` silently
     stops matching. Caught by running the built regex, not by reading it. */
  `\\[\\[\\[?((?:${Object.values(MENU_CARD_TAG_PREFIX)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\d+)\\]\\]\\]?`,
  'gi',
);

/**
 * The central text sent alongside the quick reply when the hook set none.
 * Legacy:1050.
 */
export const CUSTOMER_HELPER_DEFAULT_TEXT =
  'หากต้องการลงทะเบียน กรุณากดปุ่มลงทะเบียนเพื่อตรวจสอบข้อมูลนะคะ';

/**
 * Appended ONLY when writing chat history. Legacy:1058.
 *
 * Quick-reply buttons are not stored and the history page cannot show them, so
 * an admin reading back would never know buttons went out with that message.
 * ⚠️ Must never be appended to the text sent to the customer.
 */
export const CUSTOMER_HELPER_HISTORY_NOTE = ' ปุ่มลงทะเบียน quick reply ';

/** LINE message length guard. Legacy:4525. */
export const MAX_LENGTH = 4000;

/**
 * ⚠️ These regexes carry /g, so `lastIndex` persists between calls and must be
 *    reset before every `.test` / `.exec`. This has been got wrong before.
 */
export function hasCustomerHelperTag(text: unknown): boolean {
  if (!text) return false;
  CUSTOMER_HELPER_TAG.lastIndex = 0;
  return CUSTOMER_HELPER_TAG.test(String(text));
}

export function stripCustomerHelperTag(text: unknown): string {
  return String(text ?? '')
    .replace(CUSTOMER_HELPER_TAG, '')
    .trim();
}

/**
 * [FIX-20260901-OFFMENUTAG] The ONE spelling of `[[link]]`.
 *
 * It used to exist only as a literal inside `resolveReplyTags`. The `off` branch
 * of `resolveHookTextReply` now needs the same substitution WITHOUT the rest of
 * that function — its catch-all deletes every `[[…]]`, which would blank a
 * `[[odk_s_*]]` amount. Writing the pattern a second time there would mean two
 * places to keep in step, so it is hoisted here and both callers share it.
 *
 * `resolveReplyTags` is unchanged in behaviour: it now references this constant
 * instead of an inline literal of the same pattern.
 */
const ANSWER_LINK_TAG = /\[\[link\]\]/gi;

/**
 * [FIX-20260901-OFFMENUTAG] Replace `[[link]]` with the OA's `answer_link`.
 *
 * ⚠️ A missing or non-string link REMOVES the tag rather than writing the word
 *    "undefined" into a customer's sentence. That mirrors the inline version —
 *    `resolveReplyTags` receives `''` when `answer_link` is not a string — and it
 *    is the safer failure of the two.
 * ⚠️ `lastIndex` reset for the reason the file header gives.
 */
export function substituteAnswerLink(text: unknown, link: unknown): string {
  ANSWER_LINK_TAG.lastIndex = 0;
  return String(text ?? '').replace(
    ANSWER_LINK_TAG,
    typeof link === 'string' ? link : '',
  );
}

export function hasFlexProfileTag(text: unknown): boolean {
  if (!text) return false;
  FLEX_PROFILE_TAG.lastIndex = 0;
  return FLEX_PROFILE_TAG.test(String(text));
}

export function stripFlexProfileTag(text: unknown): string {
  return String(text ?? '')
    .replace(FLEX_PROFILE_TAG, '')
    .trim();
}

/** First `flex_mNNNNN` in the text, lowercased. Null when absent. Legacy:1512. */
export function findFlexTagRef(text: unknown): string | null {
  if (!text) return null;
  FLEX_TAG_REF.lastIndex = 0;
  const m = FLEX_TAG_REF.exec(String(text));
  return m ? m[1]!.toLowerCase() : null;
}

/** Strips EVERY occurrence — the customer must never see brackets, even when
 *  the card cannot be found. Legacy:1520. */
export function stripFlexTagRefs(text: unknown): string {
  return String(text ?? '')
    .replace(FLEX_TAG_REF, '')
    .trim();
}

/**
 * [FEAT-20260831-MENUMAINTAG] The menu card this reply names, or null.
 * Same shape as its siblings, including the `lastIndex` reset the header warns
 * about — these regexes carry /g and remember where they stopped.
 */
export function findMenuCardTagRef(text: unknown): string | null {
  if (!text) return null;
  MENU_CARD_TAG_REF.lastIndex = 0;
  const m = MENU_CARD_TAG_REF.exec(String(text));
  return m ? (m[1] as string) : null;
}

/**
 * [FIX-20260901-OFFMENUTAG] Remove ONLY the menu markers, leaving everything else
 * byte-identical — the strip sibling `findMenuCardTagRef` never had.
 *
 * WHY IT EXISTS NOW. `resolveReplyTags` never needed one: its
 * `[FIX-20260807-NOMARKERLEAK]` catch-all sweeps every unknown `[[[…]]]`, so a
 * dedicated pass there would have removed nothing extra — a mutation proved that
 * and the note at the menu detection site records it.
 *
 * The `off` branch of `resolveHookTextReply` needs something the catch-all cannot
 * give it. That branch must remove the menu marker and NOTHING else, because the
 * catch-all's second line also deletes every `[[…]]` — and a hook field may
 * legitimately carry `[[odk_s_00001]]`, whose value is substituted much earlier,
 * on the model's input. Running the full sweep in `off` would blank the amount:
 * measured on production 01/09, a customer was told the deposit minimum was
 * nothing at all. ลบเฉพาะ marker ของเมนู ห้ามกวาดตัวอื่น.
 *
 * ⚠️ Uses `MENU_CARD_TAG_REF`, the same constant `findMenuCardTagRef` reads, so
 *    detection and removal can never disagree about what a menu tag looks like.
 *    A literal copy of that pattern here would rot the day a prefix is added.
 * ⚠️ `lastIndex` is reset for the reason the header gives — the regex carries /g
 *    and remembers where it stopped, so a second call on a different string can
 *    silently skip the first match.
 *
 * revert: delete this function and the `off` branch that calls it.
 */
export function stripMenuCardTagRefs(text: unknown): string {
  MENU_CARD_TAG_REF.lastIndex = 0;
  return String(text ?? '')
    .replace(MENU_CARD_TAG_REF, '')
    .trim();
}

export function findFlexPcTagRef(text: unknown): string | null {
  if (!text) return null;
  FLEX_PC_TAG_REF.lastIndex = 0;
  const m = FLEX_PC_TAG_REF.exec(String(text));
  return m ? m[1]!.toLowerCase() : null;
}

export function stripFlexPcTagRefs(text: unknown): string {
  return String(text ?? '')
    .replace(FLEX_PC_TAG_REF, '')
    .trim();
}

/**
 * Does this reply LOOK like a flex_pc wrapper JSON? Legacy:4526, 4707.
 *
 * ⚠️ Judged from the CONTENT, not from whether a tag was found: a reply that is
 *    a flex_pc JSON body must be guarded even if the tag was lost. Narrow on
 *    purpose — "starts with {" AND "contains flex_pcNNNNN" — so it can never
 *    fire on the flex_profile or flex_m paths, whose replies are ordinary text.
 */
export function looksLikeFlexPcJson(text: unknown): boolean {
  const s = String(text ?? '');
  return /^\s*\{/.test(s) && /flex_pc\d{5}/i.test(s);
}

/** The text sent with the quick reply — hook's own, else the central one.
 *  Legacy:1065. */
export function resolveCustomerHelperText(
  hook: Record<string, unknown> | null | undefined,
): string {
  const custom = String(hook?.['customer_helper_text'] ?? '').trim();
  return custom || CUSTOMER_HELPER_DEFAULT_TEXT;
}

export interface QuickReplyAction {
  type: 'action';
  action:
    | { type: 'uri'; label: string; uri: string }
    | { type: 'message'; label: string; text: string };
}

export interface QuickReply {
  items: QuickReplyAction[];
}

/**
 * The two-button quick reply. Legacy:1032-1045.
 *
 * ⚠️ `registerUri` must be a string beginning http(s) or LINE rejects the whole
 *    message with 400 and BOTH the buttons and the text vanish. Anything else
 *    falls back to the message-action button, which still works: it sends
 *    "customer-register", which the existing keyword handler answers with the
 *    registration flex.
 */
export function buildCustomerHelperQuickReply(
  registerUri: string | null | undefined,
): QuickReply {
  const uriOk =
    typeof registerUri === 'string' && /^https?:\/\//i.test(registerUri);
  return {
    items: [
      {
        type: 'action',
        action: uriOk
          ? { type: 'uri', label: 'ลงทะเบียน', uri: registerUri }
          : { type: 'message', label: 'ลงทะเบียน', text: 'customer-register' },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: 'ติดต่อ admin',
          text: 'ติดต่อแอดมิน ขอความช่วยเหลือ',
        },
      },
    ],
  };
}

/**
 * `[[[assist]]]` / `[[assist]]`, the ONE marker the admin row is required to keep.
 *
 * ⚠️ CAPTURING on purpose. `String.split` with a capturing group keeps the
 *    delimiters in the result, so the sweep can skip them and put the marker back
 *    EXACTLY as written — three brackets or two, same position, same case.
 *
 *    The first version used a sentinel string instead, and it was wrong twice
 *    over: it invented a value that could in principle survive into a customer's
 *    message, and the literal chosen contained NUL bytes, which made this whole
 *    source file read as BINARY to `grep`, `diff` and `git diff` — every search
 *    over it silently returned nothing. No sentinel means neither can happen.
 *    ⇒ ไม่มีตัวแทน = ไม่มีอะไรหลุด และไฟล์ยังเป็น text อยู่
 */
const ASSIST_TAG_SPLIT = /(\[\[\[?assist\]\]\]?)/gi;

/**
 * ==== [FIX-20260807-NOMARKERLEAK] catch-all: no marker may reach a customer ====
 *
 * Every NAMED strip removes ONE marker it knows. Anything else the model emits
 * survives to the customer's screen — verified against the built service, six
 * shapes leaked: `[[[history]]]`, `[[[customer-register]]]`, `[[[img_promo]]]`,
 * `[[[END_OF_BASIC_INFO]]]`, an invented `[[[unknown_tag]]]`, and the two-bracket
 * `[[bracket2]]`. Legacy leaks all six identically — it has no catch-all either —
 * so this is a shared defect, not a porting one.
 *
 * The owner's rule is absolute: a reply sent to a customer must never contain
 * `[[[...]]]` or `[[...]]`. Named strips cannot deliver that, because the set of
 * markers is OPEN — the model can invent one, and a prompt edit can add one
 * without anybody touching this file.
 *
 * ⚠️ CALLERS MUST RUN IT LAST. Every named strip above it is what decides the
 *    reply SHAPE (`wantsFlexProfile`, `wantedFlexTag`, …). Sweeping first would
 *    erase a tag before it had been read and the card it selects would never be
 *    sent. Likewise `[[link]]` and the dynamic tags must already be SUBSTITUTED —
 *    by the time we get here they are a URL and a number, so this cannot eat them.
 *
 * ⚠️ Exempts a flex_pc JSON wrapper for the same reason the length cap does: that
 *    payload is PARSED into a card rather than sent as text, and removing bracket
 *    pairs inside it would corrupt the JSON.
 *
 * Three-bracket first: `[[[x]]]` would otherwise match the two-bracket pattern
 * and leave a stray `[` and `]` behind.
 *
 * ── The single-bracket block delimiters ──────────────────────────────────────
 * The Training Document is assembled from boxes fenced by SINGLE brackets —
 * `DOC_BLOCKS` in legacy webhookController.js:1168-1172:
 *
 *   [START_OF_BASIC_INFO]      … [END_OF_BASIC_INFO]
 *   [START_OF_COMPANY_INFO]    … [END_OF_COMPANY_INFO]
 *   [START_OF_NO_PROFILE_DATA] … [END_OF_NO_PROFILE_DATA]
 *
 * The model sees those fences in its own prompt, so it echoes them back more
 * readily than an invented tag — and they are a DIFFERENT shape from the `[[[…]]]`
 * family, so the bracket-pair rules never touch them. Matched by the `[A-Z0-9_]+`
 * SHAPE, not by a list of names: a fourth box is one row in legacy's table, and a
 * name-based strip would silently stop covering it. Restricted to SCREAMING_CASE
 * so ordinary bracketed prose ("[ดูรูป]", "[1]") survives.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * [FIX-20260901-OFFRAWGUARD] EXTRACTED from `resolveReplyTags`, unchanged.
 * ═══════════════════════════════════════════════════════════════════════════
 * The `off` hook-field path needs this exact sweep and must not grow a second
 * one — an open marker set with two owners drifts the day a shape is added.
 * `resolveReplyTags` calls it with no options and is behaviourally identical to
 * the inline chain it replaced.
 *
 * @param keepAssist preserve `[[[assist]]]`. The AI path does NOT want this: it
 *   strips assist by name earlier, so the marker is already gone by the time the
 *   sweep runs. The hook-field path DOES: the admin row is REQUIRED to carry the
 *   marker (owner, 12/08) and the ticket decision reads it off the raw field.
 *   Held through the sweep behind a bracket-free stand-in rather than by a
 *   negative lookahead, so the six replace rules below stay byte-identical to the
 *   ones that were audited against legacy. ⇒ assist ต้องรอด ที่เหลือห้ามดิบ
 */
export function stripUnknownMarkers(
  text: string,
  opts: { keepAssist?: boolean } = {},
): string {
  if (looksLikeFlexPcJson(text)) return text;

  /* `keepAssist` sweeps the segments AROUND each assist marker and leaves the
     marker itself alone. `split` on a CAPTURING regex yields
     [text, marker, text, marker, …], so the odd indices are the markers. The
     per-segment sweep must not `trim()` — that would eat the spaces either side
     of a marker sitting mid-sentence — so the trim happens once, on the join. */
  if (opts.keepAssist) {
    return text
      .split(ASSIST_TAG_SPLIT)
      .map((part, i) => (i % 2 === 1 ? part : sweepMarkers(part)))
      .join('')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  return sweepMarkers(text).trim();
}

/** The replace chain itself, without the final trim. See `stripUnknownMarkers`.
 *  [FIX-20261018-NOWLEAK] a now block goes FIRST and WHOLE (fence + its lines) — the fence rule
 *  below only removes fences, which left the block's `key = value` lines in the customer's bubble.
 *  Every other rule is unchanged. */
function sweepMarkers(text: string): string {
  return (
    stripNowBlocks(text)
      .replace(/\[\[\[[^\]]*\]\]\]?/g, '')
      .replace(/\[\[[^\]]*\]\]/g, '')
      .replace(/\[(?:START|END)_OF_[A-Z0-9_]+\]/g, '')
      // [FIX-20260808-UNCLOSEDMARKER] The pair strips above need a CLOSING run, so
      // a marker the model opened but never closed ("[[[assist" with no "]]]")
      // reaches the customer verbatim. A naive bracket sweep is WRONG here: it
      // would leave the inner word ("[[[assist" -> "assist"), which is worse — a
      // stray tag name reads as real answer text. Decision (owner, 2026-08-08):
      // strip only a KNOWN marker — the opener plus its single identifier token —
      // and stop at the first space, so the real sentence after an unclosed marker
      // survives ("[[[assist world" -> "world"). The token class [A-Za-z0-9_*]
      // matches every marker shape in use (assist, history, img_*, custom_content_N,
      // flex_*, dynamic [[[name]]]); the START/END fences are handled on the line
      // above. The second line clears a stray closing run left with no opener
      // ("]]]broken" -> "broken"). Single-bracket prose never matches. Kept
      // byte-identical with legacy webhookController.js.
      .replace(/\[\[\[?[A-Za-z0-9_*]*\]{0,3}/g, '')
      .replace(/\]{2,}/g, '')
      // Collapse the blank line a stripped marker leaves on its own line, and the
      // doubled space it leaves mid-sentence.
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
  );
}

export interface ResolvedReplyTags {
  /** The text after every tag has been stripped and the length guard applied. */
  finalReplyForLine: string;
  /** Attach the customer-helper quick reply? */
  wantsHelperQuickReply: boolean;
  /** Reply with the hook's `flex_profile_id` card? */
  wantsFlexProfile: boolean;
  /** `flex_mNNNNN` to render, or null. */
  wantedFlexTag: string | null;
  /** `flex_pcNNNNN` to render, or null. */
  wantedFlexPcTag: string | null;
  /**
   * [FIX-20260815-IMGTAGSTRIPPED] `img_xxx` carousel to send, or null.
   * Read before the strip like its siblings; null whenever a card won, since a
   * flex reply replaces the text and only one shape can be sent.
   */
  imageTag: string | null;
  /**
   * [FEAT-20260831-MENUMAINTAG] the stored menu card to open, or null.
   * Null whenever a card above it won: a flex reply REPLACES the text, so only
   * one shape can go out — the same precedence `imageTag` already obeys.
   */
  wantedMenuCardTag: string | null;
}

/**
 * The whole tag resolution sequence, in legacy's exact order (4494-4529).
 *
 * @param replyText the model's answer AFTER the not_found/default-text swap —
 *   NOT the raw text. Legacy builds from `replyText` so that what is SENT
 *   matches what was stored in chat history.
 * @param answerLink `hook.answer_link`, substituted for `[[link]]`.
 *
 * Precedence between the three flex routes is strict and one-way:
 *   flex_profile wins → flex_m only if no flex_profile → flex_pc only if
 *   neither. Only ONE card can be sent per answer, because a flex reply
 *   REPLACES the text rather than accompanying it. Extra tags are stripped, so
 *   the customer never sees brackets whichever route wins.
 */
export function resolveReplyTags(
  replyText: string | null | undefined,
  answerLink: string,
): ResolvedReplyTags {
  // Detected BEFORE stripping — the tag is what selects the reply shape.
  const wantsHelperQuickReply = hasCustomerHelperTag(replyText);

  let finalReplyForLine = String(replyText ?? '')
    .replace(/\[\[\[assist\]\]\]?/gi, '')
    .replace(ANSWER_LINK_TAG, answerLink)
    .trim();

  // Stripped unconditionally, whether or not the buttons could be attached.
  finalReplyForLine = stripCustomerHelperTag(finalReplyForLine);

  const wantsFlexProfile = hasFlexProfileTag(finalReplyForLine);
  finalReplyForLine = stripFlexProfileTag(finalReplyForLine);

  const wantedFlexTag = wantsFlexProfile
    ? null
    : findFlexTagRef(finalReplyForLine);
  finalReplyForLine = stripFlexTagRefs(finalReplyForLine);

  const wantedFlexPcTag =
    wantsFlexProfile || wantedFlexTag
      ? null
      : findFlexPcTagRef(finalReplyForLine);
  finalReplyForLine = stripFlexPcTagRefs(finalReplyForLine);

  /**
   * ==== [FIX-20260815-IMGTAGSTRIPPED] read the carousel tag BEFORE it is erased ====
   *
   * THE DEFECT THIS CLOSES: `[[[img_xxx]]]` binds a set of images an operator
   * uploaded, and the bot is meant to send that carousel INSTEAD of the text.
   * It never did. Every other marker is detected here, before stripping, because
   * "the tag is what selects the reply shape" — the image tag was the one left
   * out. `[FIX-20260807-NOMARKERLEAK]`'s catch-all below then removes any
   * `[[[…]]]` it does not know, and its own comment even lists `[[[img_promo]]]`
   * among the shapes it strips. The consumer called
   * `findImageTag(tags.finalReplyForLine)` — searching text the tag had already
   * been deleted from — so it always found nothing. Silent since 7 Aug 2026: no
   * error, no log, the customer simply received the plain sentence.
   *
   * ⚠️ PRECEDENCE — a card beats the carousel. A flex reply REPLACES the text
   * rather than accompanying it, so only ONE shape can be sent per answer; the
   * same reason `wantsFlexProfile` already beats `flex_m` and `flex_pc` above.
   * The customer-helper tag is NOT in this list on purpose: it attaches quick
   * reply buttons TO a reply instead of replacing it, so it does not compete.
   *
   * ⚠️ DETECTION ONLY. No strip line is added — the catch-all below already
   * removes the marker, and it must keep doing so: reading the tag here must not
   * change one character of what the customer sees. อ่านอย่างเดียว ไม่ลบซ้ำ.
   *
   * revert: delete this const and the `imageTag` field on the return, then have
   * the consumer call `findImageTag(finalReplyForLine)` again — which is the
   * broken behaviour this replaces.
   */
  /* [FEAT-20260831-MENUMAINTAG] a stored menu card, read BEFORE any stripping
     like every other shape. It loses to the three card shapes above for the
     reason stated there — a card replaces the text, and only one can go out —
     and it beats the image carousel for the same reason a flex card does.
     ⚠️ DETECTION ONLY, exactly like `imageTag` above: no strip line of its own.
        The `[FIX-20260807-NOMARKERLEAK]` catch-all removes ANY `[[[…]]]` it does
        not know, so a dedicated strip here would be a second pass that changes
        nothing — and a mutation proved it: deleting it left all 87 cases green,
        which is the definition of a line nobody is holding. ตัวกวาดท้ายไฟล์ดูแลอยู่แล้ว */
  const wantedMenuCardTag =
    wantsFlexProfile || wantedFlexTag || wantedFlexPcTag
      ? null
      : findMenuCardTagRef(finalReplyForLine);

  const imageTag =
    wantsFlexProfile || wantedFlexTag || wantedFlexPcTag || wantedMenuCardTag
      ? null
      : findImageTag(finalReplyForLine);

  /* [FIX-20260807-NOMARKERLEAK] the catch-all — now `stripUnknownMarkers`, whose
     header carries the full account. Extracted so the `off` hook-field path can
     reuse the SAME sweep instead of growing a second one; the call here is
     unchanged in behaviour. Still runs LAST, after every named strip, because
     those strips are what decide the reply SHAPE. */
  finalReplyForLine = stripUnknownMarkers(finalReplyForLine);

  /**
   * ==== [FIX-20260902-MDBOLD] LINE does not render markdown ====================
   *
   * THE DEFECT. The bot sent `**"ฝากเงิน"**` and the customer read the asterisks.
   * A LINE text message is plain text — there is no bold.
   *
   * WHY IT HAPPENS, both halves verified rather than assumed:
   *   1. NOTHING strips markdown anywhere on the outbound path. Grepped across
   *      `modules/webhook/` and `modules/ai/`: the only hit for "markdown" is
   *      `rag-engine.service.ts:2021`, which peels ```json fences off a tool
   *      response and never touches a reply.
   *   2. THE PROMPT NEVER FORBIDS IT. `ai-reply/reply-blocks.ts:59-69` is the
   *      whole system instruction — three lines, all about `[[[FOUND]]]`,
   *      `[[[NOT_FOUND]]]` and `[[[assist]]]`. No formatting rule exists, so the
   *      model has no reason not to reach for bold.
   * The model is not misbehaving; nobody ever told it, and nobody cleans up.
   *
   * WHY NOT FIX IT IN THE PROMPT. `buildInstruction` is transcribed byte-for-byte
   * from legacy and its own header states the W0 snapshot fails on ANY drift.
   * Adding a line there rewrites the prompt of every OA and breaks that contract
   * to solve a display problem. The reply is the right place.
   *
   * ⚠️ DELIBERATELY NARROW — PAIRED `**` ONLY. A lone `*` is left alone: it is a
   *    multiplication sign, a bullet an operator typed, or a footnote marker, and
   *    a customer may legitimately receive one. `__x__`, `#` headings and
   *    backticks are NOT handled either — none has been observed, and every extra
   *    rule is another way to mangle real text. Widen only on evidence.
   *
   * ⚠️ PLACED AFTER the marker sweep and BEFORE the length cap, for the reason the
   *    file header gives: the sweep can leave `**` newly adjacent once a marker
   *    between them is gone, and anything that shortens the text must happen
   *    before the 4000-character cut.
   *
   * ⚠️ flex_pc JSON is exempt, like every other rule here — that payload is parsed
   *    into a card, and `**` inside a JSON string is data, not formatting.
   *
   * revert: delete this block. The customer reads the asterisks again.
   * ⇒ LINE ไม่มีตัวหนา · ถอดเฉพาะคู่ `**` ห้ามแตะดอกจันเดี่ยว
   */
  if (!looksLikeFlexPcJson(finalReplyForLine)) {
    finalReplyForLine = finalReplyForLine
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .trim();
  }

  /**
   * ⚠️ [FEAT-20260802-FLEXPCWRAP] A flex_pc reply is a whole JSON wrapper that
   *   gets PARSED into a card, not sent as text. Truncating it mid-object makes
   *   it unparseable and the card fails. flex_pc has its own 40000-byte limit in
   *   the sanitizer, so it is exempt here.
   */
  if (
    !looksLikeFlexPcJson(finalReplyForLine) &&
    finalReplyForLine.length > MAX_LENGTH
  ) {
    finalReplyForLine = finalReplyForLine.substring(0, MAX_LENGTH);
  }

  return {
    finalReplyForLine,
    wantsHelperQuickReply,
    wantsFlexProfile,
    wantedFlexTag,
    wantedFlexPcTag,
    imageTag,
    // [FEAT-20260831-MENUMAINTAG]
    wantedMenuCardTag,
  };
}

/** `[[[img_xxx]]]` carousel tag. Legacy:4534. */
export function findImageTag(text: unknown): string | null {
  const m = String(text ?? '').match(/\[\[\[(img_[a-z0-9_]+)\]\]\]/i);
  return m ? m[1]! : null;
}
