/**
 * [PROG-20260905-LADDER] The gate ladder's contract: a step, the turn it reads, and the
 * collaborators it is given.
 *
 * WHY THIS EXISTS — the finding that produced it. `processLockedEvent` holds **65 guards**
 * (not the 25 a top-level scan reports) and the bodies behind them have been moved into
 * role directories over thirty-odd save points. What is LEFT in the spine is the ORDER and
 * the WIRING, and both are expressed the same way: as physical line position inside one
 * function. That has three consequences, measured rather than assumed:
 *
 *   · the order can only be DEFENDED in prose — which is why the method carries 1,598
 *     comment lines against 1,794 code lines;
 *   · the wiring is re-bound at every call site — 29 collaborator names are bound more
 *     than once, 136 lines, **107 of them redundant repeats** (`log` 17×, `error` 15×,
 *     `logMessage` 8×, `chatRoomModel` 6×…);
 *   · adding one feature costs five edits: an `if`+`return`, a 20-60 line deps literal, a
 *     method-scope `let`, a block of assign-backs, and a comment defending the position.
 *
 * A ladder step turns all five into one: a file, and one row in `ladder-order.ts`.
 *
 * 📖 `docs/flow/webhook-flow-and-gates.md` §7 is the step-by-step for adding one, and §8 is
 * what keeps the method from growing back. Both are generated from this code.
 *
 * ⚠️ IT IS A LADDER STEP, NOT A "GATE", AND THE DIFFERENCE IS LOAD-BEARING. The dive found
 * the ladder is INTERLEAVED: real computation sits between the guards (the model call, the
 * prompt assembly, the reply-tag resolution). A registry that held only guards could not
 * express the ladder at all — it would have to leave the computation behind and the order
 * would be split across two mechanisms. So a step may end the turn (`'done'`, the spine's
 * `return`) or carry on (`'continue'`), and a step that only computes is still a step.
 * บันไดมีทั้งด่านและงานคั่นกลาง ต้องรับทั้งสองอย่าง
 *
 * ⚠️ THE PATTERN IS ALREADY IN THIS REPO, CHOSEN TWICE — `event-handlers/handler-entries.ts`
 * and `slip/providers/provider-entries.ts` (a money path). The spine itself instructs the
 * reader to use it, at `webhook.service.ts:2622`: *"IT IS A NEW CASE, NOT A NEW `if` HERE."*
 * This makes that sentence true for the spine's own ladder.
 */

import type { Types } from 'mongoose';

import type { RequestCredentials } from '../ai-vendors/request-credentials';
import type { DocContext } from '../doc-retrieval/doc-retrieval.provider';

/** `'done'` is the spine's `return`. `'continue'` falls through to the next step. */
export type StepVerdict = 'continue' | 'done';

/**
 * The LINE event as the ladder reads it.
 *
 * ⚠️ Declared structurally rather than imported: the spine's `LineEvent` is module-private
 * to `webhook.service.ts`, and a role file importing back into the service would be a
 * cycle. TypeScript's structural typing makes the spine's value assignable to this without
 * a cast, and tsc still checks every field access — which is the whole guarantee.
 */
export interface LadderEvent {
  type?: string;
  eventId?: string;
  replyToken?: string;
  timestamp?: number;
  source?: { userId?: string; type?: string };
  message?: {
    type?: string;
    id?: string;
    text?: string;
    packageId?: string;
    stickerId?: string;
    quoteToken?: string;
    quotedMessageId?: string;
  };
  postback?: { data?: string };
}

/**
 * The state of one turn, shared by every step.
 *
 * ⚠️ IT IS NOT A BAG, AND THAT WAS MEASURED BEFORE IT WAS WRITTEN. The method holds 136
 * declarations; **114 of them are block-local** — born and dead inside one guard. Only
 * about thirty cross a gate boundary with three or more consumers, and those cluster into
 * six groups. The sections below ARE those groups: a new field has to pick one, which is
 * the cheapest available defence against this becoming the next thing that bloats.
 * ๑๓๖ ตัวแปร แต่ข้ามด่านจริงแค่ ~๓๐ · ปลายทางต้องจัดด้วย ไม่ใช่ย้ายไปบวมที่ใหม่
 *
 * ⚠️ `readonly` means "the ladder does not write it", not "it never changes". `userId` is
 * reassigned by the spine twice (at the event re-read and again at the rate limiter); a
 * step that needed to change it would have to say so by dropping the modifier, which is
 * exactly the edit a reviewer should be made to see.
 */
export interface TurnContext {
  // ── identity ────────────────────────────────────────────────────────────────
  /**
   * ⚠️ NOT `readonly`, and the modifier came off deliberately at L6. The event re-read
   * REASSIGNS this: the locked run re-takes `body.events[0]` rather than trusting the
   * event the caller passed, and the multi-event loop is built around that (iteration 0
   * gets the original body, later ones a one-event slice). The turn's identity genuinely
   * changes underneath the ladder, once, at a known step — and a reviewer should be made
   * to see that rather than be reassured by a `readonly` that was never true.
   */
  event: LadderEvent;
  readonly hook: Record<string, unknown> | undefined;
  readonly alias: string | undefined;
  /** ⚠️ Reassigned TWICE — at the event re-read, and again in the rate limiter. */
  userId: string | undefined;
  /** The delivery body verbatim. The re-read takes `events[0]` from it. */
  readonly body: Record<string, unknown>;
  /** `'cache'` or `'db'` — where the hook came from. The signature warn names it. */
  readonly hookSource: string | undefined;
  /**
   * The request facts the signature re-check needs.
   *
   * Declared structurally rather than as `WebhookRequestMeta`: that interface lives in
   * `webhook.service.ts`, and a role file importing back from the service is the cycle
   * every file in this directory avoids. The real `meta` satisfies this shape.
   */
  readonly meta: {
    signature?: string;
    /**
     * ⚠️ `Buffer | string`, NOT `string`. These are the exact bytes LINE signed, and the
     * HMAC is computed over them — narrowing to `string` here would have forced a cast at
     * the one place that matters, and a re-serialised body hashes differently from the one
     * that was signed. That difference IS the disagreement the re-check exists to report.
     */
    rawBody?: Buffer | string;
    baseUrl: string;
  };
  /**
   * Everything `deriveRequestCredentials` resolved for this hook: the access token, the
   * channel id, the vendor's key and model, the Telegram pair, `docId`.
   *
   * ⚠️ CARRIED AS ONE OBJECT ON PURPOSE. Listing its fifteen fields here would be a second
   * copy of a contract that already exists, and the next credential would then have to be
   * added in two places — which is how the two halves of a pair drift apart. It is also
   * the shape SP9 already chose for exactly this reason.
   *
   * ⚠️ `logContext` is deliberately NOT read through here even though `creds` carries it:
   * the spine keeps its own `let`, the OUTER CATCH reads that `let`, and the two are the
   * same object. One access path, not two.
   */
  readonly creds: RequestCredentials;
  /** The bag every log row spreads. The outer catch reads the same object. */
  readonly logContext: Record<string, unknown>;
  /**
   * `LINE_REPLY_ENDPOINT`, passed through rather than redeclared.
   *
   * ⚠️ It travels as a value on purpose. The constant is already spelled out in four
   * handler files, and `out-of-hours-reply.handler.ts` takes it as an input for exactly
   * this reason — *"passed in so this file redeclares nothing"*. A fifth copy here would
   * be the `errText` mistake again, which reached twelve before it was caught.
   */
  readonly lineReplyEndpoint: string;
  /** `HELPER_ALT_TEXT` — passed through for the same reason as the endpoint above. */
  readonly helperAltText: string;

  /**
   * `IGNORE_DOC_ID` — legacy's fleet-wide retrieval off switch, compared against `'1'`.
   * Config rather than a collaborator, so it travels with the turn and not with the deps.
   */
  readonly ignoreDocId: string | undefined;

  // ── profile ─────────────────────────────────────────────────────────────────
  /*
   * ⚠️ NOT `readonly`, for the same reason as the reply group: the SPINE fills these, and
   * it fills them LATE — inside the big `if (userId)` block, hundreds of lines after the
   * context is constructed. The context is built at the top of the turn now, so the honest
   * initial value for a profile nobody has fetched yet is the empty one, and the spine
   * assigns the real values at the point it learns them. A `readonly` here would be a lie
   * about who writes and when. เขียนทีหลังจริง ๆ อย่าติด readonly ไว้หลอกตัวเอง
   */
  /** The COMBINED custom-tool result, one block per endpoint — not "the customer". */
  profileData: Record<string, unknown>;
  /** The member row this customer already had, or null. The notice guard reads it. */
  existingUser: Record<string, unknown> | null;
  /**
   * The three display fields every chat row carries — `{}` when LINE gave us no profile.
   *
   * ⚠️ `unknown`, matching the handlers that consume it. It is a shape the LINE SDK owns
   * and this file has no business restating; the one place it is built is the spine.
   */
  profileForLog: unknown;
  /**
   * The ONE block picked out of `profileData` that answered the profile endpoint.
   *
   * ⚠️ `undefined` means the fetch NEVER RAN, which the gates treat as "we do not know" and
   * fail open on. That is not the same as a fetch that answered 404, and conflating them
   * would refuse slips from customers whose profile was simply never asked for.
   */
  profileBlock: Record<string, unknown> | null | undefined;
  /** The external-profile circuit breaker. Open ⇒ the gates fail open. */
  profileCircuitOpen: boolean;

  // ── message ─────────────────────────────────────────────────────────────────
  /**
   * The customer's text. `''` until `require-user-text` sets it, and that step ends the
   * turn when there is none — so past it, this is the same non-empty string the spine's
   * `const userText = event.message?.text` narrowed to. Typed `string` rather than
   * `string | undefined` for exactly that reason: no cast, and no duplicate guard that
   * would be dead code.
   */
  userText: string;

  // ── reply ───────────────────────────────────────────────────────────────────
  /** legacy:3922 — a failed profile fetch, remembered but not fatal. */
  apiErrorTrigger: unknown;
  /** The Thai clock string. Re-stamped when the profile fetch failed. */
  bangkokTime: string;
  /**
   * The document context for the prompt. `''` for every OA that has not turned
   * `doc_retrieval` on — the default path costs nothing and must keep costing nothing.
   */
  relatedText: string;
  /**
   * [FEAT-20261026-RAGENGINE] `replace` mode only: the reduced Training Doc that stands in for
   * the full one. Null/absent for every OA not in that mode ⇒ `ask-model` builds the suggestion
   * exactly as before.
   */
  suggestionOverride?: string | null;
  /** What the model answered, raw. Null when it had nothing or the provider rejected. */
  replyTextRaw: string | null | undefined;
  /** `resolveReplyText(...)` — the answer AFTER the not-found / generative-error choice. */
  replyText: string | null | undefined;
  /**
   * The model's verdict on the answer tag. `'not_found'` is what pages Telegram.
   *
   * ⚠️ The UNION, not `string`. `resolveReplyText` takes exactly these three values, and a
   * widened field here would have forced a cast at the one place that reads it — which is
   * how a contract stops being checked. tsc caught this on the first build.
   */
  tagStatus: 'found' | 'not_found' | null;
  /** `aiResponse.response_data ?? null`, carried to the audit row and the send. */
  responseAi: unknown;
  /** How long the model call took. The spine's perf summary reads it back. */
  aiMs: number;
  /**
   * What ONLY the `generate_response` audit row reads, grouped rather than spread across
   * six top-level fields. A top-level field is a promise that anything in the ladder may
   * read it; a named group says who it is for — and keeping this context from becoming
   * the next bag is the whole reason the design was measured before it was written.
   */
  modelAudit?: {
    noData: boolean;
    errorMessage?: string | null;
    httpStatus?: number | null;
    promptDocMeta: unknown;
    thaiNow: string;
    /** `Date.now()` before the model call — the audit row's duration is measured from it. */
    startedAt: number;
  };

  // ── profile, filled by the spine before the ladder runs ─────────────────────
  /** `'N/A'` until the combined profile fetch answers. Read by the Telegram hand-off. */
  customerName: string;
  customerTel: string;
  contractCode: string;
  /** `event.type` refined to the message type — the assist site reports it. */
  msgType: string;
  /** What the chat row stores: the text, the postback payload, or `[type]`. */
  msgContent: string;
  /**
   * `assist_status` — an operator is holding this room, so the bot stays quiet.
   *
   * ⚠️ Seven gates read it. It is the single most consequential boolean in the turn: a
   * step that reads it before the assist-state gate has written it sees `false` and talks
   * over a human. That is the chain `assertDataChain` exists for.
   */
  skipBotProcessing: boolean;
  /** The room this request already loaded, kept for the admin doors. Not a second query. */
  inboundRoom: Record<string, unknown> | null;

  // ── the media lane ──────────────────────────────────────────────────────────
  /*
   * Grouped rather than spread across twenty top-level fields, for the reason `modelAudit`
   * already set: only the non-text lane reads these, and a named group says who they are
   * for. A top-level field is a promise that anything in the ladder may read it.
   *
   * ⚠️ `slip` is written by the IMAGE branch, which is still inline, and read by the
   * non-text lane. That is chain 9 from the dive — the one that crosses branches — and it
   * is the reason these travel on the context at all.
   */
  slip: {
    verifyResult: unknown;
    recordId: unknown;
    createdAt: Date | null;
    condition: string | null;
    storageFilePath: string | null;
    /** `[FEAT-20260812-QRPRESCAN]` — the pre-scan was confident there is no QR. */
    noQrPhoto: boolean;
    /** The pre-scan verdict, whole. The notice guard reads its `reason`. */
    prescan: {
      skipSlipVerify: boolean;
      reason: string;
      ms: number;
      mode: string;
    };
    /** `[FEAT-20260809-REQUIREPROFILE]` — refuse this slip: no account, and a QR was read. */
    blockUnlinked: boolean;
    /**
     * `[FEAT-20260907-UNKNOWNPROFILEREVIEW]` — do not auto-check this slip: the
     * profile call RAN and FAILED, so who sent it is unknown. A different answer
     * from `blockUnlinked`, which means "we know they have no account", and the
     * two can never both be true — `shouldReviewUnknownProfile` returns the 404
     * case to its sibling.
     */
    reviewUnknownProfile: boolean;
    /**
     * The stored image row's `_id`, EXACTLY as the download returned it.
     *
     * ⚠️ NOT narrowed to `string`, and that is deliberate. `verifySlip` writes this value
     * straight into `internal_content_id`, which is an `ObjectId` column
     * (`slip-verification.schema.ts:70`). Handing it a hex string would work only because
     * mongoose casts — a behaviour change smuggled in under a type simplification. The
     * `ObjectId` travels untouched. ค่าเดิมต้องเป็นค่าเดิม ไม่ใช่ค่าที่ mongoose แปลงให้
     */
    storageId: Types.ObjectId | string | null;
  };
  media: {
    incomingType: string;
    /** The OA's canned reply to media. Empty ⇒ the whole branch is skipped. */
    rawImageAnswer: string | undefined;
    mediaUrl: string | null;
    internalContentId: string | null;
    /** Set by the slip flex branch when a card actually went out. */
    isFlexSent: boolean;
    flexDoc: Record<string, unknown> | null;
    /** The QR-fail text the flex branch may substitute for `image_answer_text`. */
    textReplyOverride: string | null;
    isQrCodeSlip: boolean;
    violationDetected: boolean;
    /** What the customer will actually be told, markers stripped. */
    cleanImageAnswer: string;
  };
  /** `customerMsg?._id` — undefined when the row was not written (a postback). */
  customerMsgId: unknown;
  /** The bot's own chat row, written before the send so the flex patch can rewrite it. */
  botChatMsg: { _id?: unknown; room_id?: unknown } | null;

  // ── the reply as it will actually go out ────────────────────────────────────
  /*
   * ⚠️ NOT `readonly`, and the reason is the split ladder rather than a step needing to
   * write them. The SPINE fills these BETWEEN the two slices — after the flex build, which
   * sits between them and cannot move (below). `readonly` here would be a lie about who
   * writes, and the modifier is only useful while it stays true.
   */
  /*
   * ⚠️⚠️ THESE ARE FILLED BY THE SPINE, NOT BY A STEP, AND THAT IS NOT A CHOICE.
   *
   * The flex-card build (`flexDeps` → `flexArgs` → `flexOut` → `flexKind` →
   * `flexProfileContents`) is ONE expression whose tail lives inside
   * `docs/menu-plug-in.patch` — the box at `webhook.service.ts:4449-4472` contains
   * `flexKind === 'menu'`, `tags.wantedMenuCardTag`, `flexOut` and the closing
   * `: null) ?? null) as Record<string, unknown> | null;`. Those are frozen bytes, so
   * `flexKind`, `tags` and `flexOut` must stay LOCALS OF THE SPINE with exactly those
   * names, and an expression cannot be cut in half. The build moves at Phase 5 or not at
   * all. What the ladder can do is read the result. ตัดครึ่งนิพจน์ไม่ได้ ท้ายมันเป็น byte ของ patch
   */
  /** `resolveReplyTags(replyText, answer_link)` — which card family the answer asked for. */
  tags: ReplyTagsLike;
  /** The card, once built. `null` when none could be. */
  flexProfileContents: Record<string, unknown> | null;
  /** Which builder won — `'profile' | 'tag' | 'pc' | 'menu' | null`. */
  flexKind: string | null;
  /**
   * The builder's own out-param: which doc it rendered, for the history row.
   *
   * ⚠️ `unknown`, not `Record<string, unknown>`. The real value is `FlexReplyOut`, which
   * has named fields and no index signature, so widening it here would force a cast at the
   * assignment — and the ladder only ever forwards this value to the send. A type that
   * would need a cast to hold the real thing is not describing the real thing.
   */
  flexOut: unknown;
  /** `[FIX-20260801-HELPEREMPTY]` — the model answered with only a helper tag. */
  useHelperQr: boolean;
  /** legacy's dead flag. Constant `false`; every branch testing it is dead code. */
  replyViaPush: boolean;
  /** legacy's already-resolved default for the category analysis that is NOT ported. */
  categorySettled: Promise<unknown>;
  /** `Date.now()` at the top of the turn — the perf summary measures from it. */
  perfT0: number;
  /** How long the profile fetch took. Log-only. */
  perfProfileMs: number;
  /** `REPLY_STALE_MS` — passed through rather than redeclared, like the endpoint. */
  replyStaleMs: number;

  /** The text as the tag resolver left it. The flex_pc guard may blank it. */
  finalReplyForLine: string;
  /** What is actually SENT — differs from the above exactly when customer-helper fires. */
  replyBodyForLine: string;
}

/**
 * What `resolveReplyTags` answers, as the ladder reads it.
 *
 * Structural rather than imported for the usual reason — a role file importing back from
 * the service would be a cycle — and the real value satisfies it, so tsc still checks
 * every field the steps touch.
 */
export interface ReplyTagsLike {
  wantsFlexProfile?: boolean;
  /* Typed as strings rather than `unknown`: the TAG-STRIP probe puts them through
     `String(...)`, and `unknown` makes that a lint error for the honest reason — an object
     would stringify to `[object Object]` in an operator's log. Naming the real type is the
     fix; silencing the rule would not be. */
  wantedFlexTag?: string | null;
  wantedFlexPcTag?: string | null;
  wantedMenuCardTag?: string | null;
  /** `[FIX-20260815-IMGTAGSTRIPPED]` — read BEFORE the marker strip, never after. */
  imageTag?: string | null;
  wantsHelperQuickReply?: boolean;
  finalReplyForLine?: string;
}

/** What `sendTextReply` answers — the shape the reply handlers already agree on. */
export interface LadderReplyResponse {
  status?: number;
  data?: unknown;
}

/**
 * The collaborators, bound ONCE for the turn.
 *
 * ⚠️ THIS IS THE ANSWER TO THE 107 REDUNDANT BINDING LINES. Every one of these names was
 * being re-bound at each call site — `log` seventeen times, `error` fifteen. A step takes
 * them from here instead, so a site's own deps literal carries only what is genuinely
 * particular to it.
 *
 * ⚠️ `sendTextReply` IS ALREADY BOUND TO THIS TURN'S ACCESS TOKEN. The token is decrypted
 * per hook, so it cannot live in a module singleton — binding it here is what lets the
 * steps stay ignorant of it.
 */
export interface TurnDeps {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  /** `sendTextReply(accessToken, replyToken, text)` with the token already applied. */
  sendTextReply: (
    replyToken: string,
    text: string,
  ) => Promise<LadderReplyResponse>;
  /** Awaited by its caller: the row must exist before the turn ends. */
  emitWlog: (row: Record<string, unknown>) => Promise<void>;
  /**
   * Fire-and-forget history write.
   *
   * ⚠️ `tag` is not decoration. Each site's failure line reads
   * `` `${tag} Log failed: ${e.message}` `` and those strings are what an operator greps
   * for; a shared helper without the tag would silently rewrite them all to one wording.
   * ป้ายต้องติดมาด้วย ไม่งั้น log ที่คนใช้ grep เปลี่ยนหมด
   */
  logBotMessage: (row: Record<string, unknown>, tag: string) => void;

  // ── bound once, used by exactly ONE step each ───────────────────────────────
  /*
   * These are not shared the way `log` and `error` are. They live here anyway, and the
   * reason is the measurement this design started from: a per-step deps literal is how the
   * method grew 183 lines of pure wiring. Binding them in `turnDeps()` gives the spine ONE
   * wiring site instead of one per gate, and a step that needs a new collaborator adds a
   * line here rather than a twenty-line object at a call site. ผูกที่เดียว ไม่ใช่ผูกทุกด่าน
   */
  /** `this.docRetrieval.retrieve` — the seam. The shipped adapter never throws.
   *  [FEAT-20261026-RAGENGINE] via `retrieveDocContext`: a `DocContext` when the bound provider
   *  has `retrieveContext` (the RAG engine), the plain string otherwise. */
  retrieveDoc: (args: Record<string, unknown>) => Promise<string | DocContext>;
  /** `assemblePrompt(...)` with the two chat models already bound. */
  assemblePrompt: (input: {
    hook: Record<string, unknown> | undefined;
    userId: string | undefined;
    userText: string;
    thaiNow: string;
    nowInstant: Date;
    suggestion: string;
  }) => Promise<{
    suggestion: string;
    historyBlockText?: string;
    timeContextText?: string;
    nowContextText?: string;
  }>;
  /** `this.aiReply.generate` — the model turn. The default binding REJECTS on failure. */
  generateAiReply: (
    request: AiReplyRequestLike,
  ) => Promise<AiReplyResponseLike>;
  /** `replyApiErrorRefusal(...)` with the service's own shapes already bound. */
  replyApiErrorRefusal: (input: {
    hook: Record<string, unknown> | undefined;
    userId: string | undefined;
    replyToken?: string;
    eventId?: string;
    apiMissingSource: string;
  }) => Promise<void>;
  /**
   * `chatHistory.logMessage` AWAITED, and the row it returns.
   *
   * ⚠️ A separate dep from `logBotMessage` on purpose. That one is fire-and-forget for
   * rows nobody reads back; this one's `_id` travels into the send, where the flex-history
   * patch rewrites the very row it created. Folding the two would silently make the id
   * unavailable, and nothing would fail to compile.
   */
  logMessageAwaited: (
    row: Record<string, unknown>,
  ) => Promise<{ _id?: unknown; room_id?: unknown } | null>;
  /** `notifyTelegramNoAnswer(...)` with `lineApi` and the log door already bound. */
  notifyTelegramNoAnswer: (input: Record<string, unknown>) => Promise<void>;
  /**
   * `runAssistGuarded({ ...assistTurn(), ...siteArgs }, assistDeps())`.
   *
   * ⚠️⚠️ THE SPINE MUST BIND THIS WITH THE ARROW, NOT A VALUE. Nine of `assistTurn()`'s
   * nineteen fields come from `let`s the turn REASSIGNS as it runs (`customerName` at four
   * sites, `bangkokTime` at three). Binding a pre-built object here would freeze whatever
   * they held at bind time and hand this site a stale customer name and an empty clock —
   * with every test still green, because the shape would be right and only the values
   * wrong. ต้องเป็น arrow อ่านตอนเรียก ไม่ใช่ค่าที่แช่ไว้
   */
  runAssist: (siteArgs: Record<string, unknown>) => Promise<void>;
  /** `sendAiReply(input, deps)` with the access token and the four models already bound. */
  sendAiReply: (input: Record<string, unknown>) => Promise<void>;
  /** `replyWithTaggedImages(input, deps)` — true only when the carousel was delivered. */
  replyWithTaggedImages: (input: Record<string, unknown>) => Promise<boolean>;
  /** `this.validateSignature(body, signature, secret)` — the same HMAC the guard ran. */
  validateSignature: (
    body: Buffer | string,
    signature: string | undefined,
    secret: string,
  ) => boolean;
  /** `ensureRoomOnEvent(...)` with the chat-history collaborators already bound. */
  ensureRoom: (input: Record<string, unknown>) => Promise<void>;
  /**
   * `openAdminCase(displayed, …)` — replies, files the row, THEN opens the case.
   *
   * ⚠️ Supplied by the CUSTOMER SLICE, not by `turnDeps`. It is a closure declared inside
   * the big `if (userId)` block and does not exist when the deps object is built.
   */
  openAdminCase: (displayed: string) => Promise<boolean>;
  /** `this.tryNoticeGuard(...)` — true when a notice card was sent and the turn is over. */
  tryNoticeGuard: (input: Record<string, unknown>) => Promise<boolean>;
  /**
   * The abandon flow. A thunk because the frozen silent-type gate calls it too — and
   * supplied by the customer slice for the same reason as `openAdminCase`.
   */
  runFollowUpFlow: () => Promise<boolean>;
  /** `handleCustomerRegisterKeyword(...)` — mints the link token and sends the card. */
  handleCustomerRegister: () => Promise<{ handled: boolean }>;
  /** `this.runPaymentForSlip(...)` — decides whether the slip card must be suppressed. */
  runPaymentForSlip: (input: Record<string, unknown>) => Promise<{
    suppress: boolean;
    lockedDuplicate: boolean;
  }>;
  /** `handleSlipFlex(input, deps)` — picks and sends the OA's slip card. */
  handleSlipFlex: (input: Record<string, unknown>) => Promise<{
    isFlexSent: boolean;
    flexDoc: Record<string, unknown> | null;
    textReplyOverride: string | null;
    isQrCodeSlip: boolean;
    violationDetected: boolean;
    slipCondition: string | null;
  }>;
  /** `this.slipFlow.handleSlipCallback(...)` — fire-and-forget, never costs the reply. */
  handleSlipCallback: (input: Record<string, unknown>) => void;
  /** `replyMissingProfileData(...)` — helper door S2. Every path ends the turn. */
  replyMissingProfileData: () => Promise<void>;
  /**
   * `runAssistBypass(input, deps)` with the eleven collaborators already bound.
   *
   * ⚠️ THE INPUT IS NOT BOUND HERE, only the deps. The step builds it from the context so
   * that its `reads` declaration names the fields it really consumes — a data-chain fence
   * checking a list the code no longer matches is worse than no fence.
   */
  runAssistBypass: (input: Record<string, unknown>) => Promise<void>;

  // ── the image lane ─────────────────────────────────────────────────────────
  /**
   * `this.lineContent.downloadAndSaveImage(messageId, accessToken)` — the access token is
   * already applied, so the step never sees a credential.
   *
   * @returns the new `image_storages` `_id`, or `null` on any failure. The `ObjectId` is
   *          returned unconverted; see `slip.storageId` for why that matters.
   */
  downloadImage: (messageId: string) => Promise<Types.ObjectId | string | null>;
  /**
   * Read the row the download just wrote.
   *
   * ⚠️ IT RESOLVES `null` ON FAILURE INSTEAD OF REJECTING, and the try/catch that makes
   * that true is in the BINDING, not the step. A failed read must not cost the customer
   * their reply — the image is already stored and already paid for. Putting the catch in
   * the step would let a second caller reintroduce the throw. ดักที่จุดผูก ไม่ใช่ที่ด่าน
   */
  readImageStorage: (
    storageId: Types.ObjectId | string,
  ) => Promise<Record<string, unknown> | null>;
  /** `shouldSkipSlipVerify(...)` — the QR pre-scan. Fails open on every uncertainty. */
  shouldSkipSlipVerify: (input: {
    filePath: string | null;
    hook: Record<string, unknown> | undefined;
  }) => Promise<{
    skipSlipVerify: boolean;
    reason: string;
    ms: number;
    mode: string;
  }>;

  // ── the helper-card doors ──────────────────────────────────────────────────
  /**
   * `this.buildHookHelperFlexFor(rawText, hook, event.source?.userId, mode)` with the hook
   * and the source user already applied.
   *
   * ⚠️⚠️ THE NAME IS THE SERVICE METHOD'S, NOT A TIDIER ONE, and that is a rule rather
   * than a habit. `helper-stamp-doors.spec.ts` counts the four helper-card doors across
   * the spine and its role directories by matching `await this.buildHookHelperFlexFor(` OR
   * `await deps.buildHookHelperFlexFor(`. Shortening the dep once made that census see
   * THREE doors instead of four — a door that had merely MOVED read as a door that had
   * been deleted. ชื่อ collaborator ต้องคงเดิมข้ามขอบเขต
   */
  buildHookHelperFlexFor: (
    rawText: string,
    mode: 'off' | 'strip' | 'button' | 'flex',
  ) => Promise<Record<string, unknown> | null>;
  /**
   * `[FEAT-20260907-UNKNOWNPROFILEREVIEW]` `this.flexModel.findById(id).lean()` — the
   * lookup `resolveStateFlex` needs, bound once for the turn like every other
   * collaborator here.
   *
   * ⚠️ IT IS THE SAME LOOKUP `sendPaymentReply` ALREADY PASSES to that resolver
   * (`webhook.service.ts:4877`), deliberately: one reader of `payment_flex_ids`
   * means a state's card cannot be resolved two ways. A step must never reach for
   * the model itself — the ladder gets collaborators, not the container.
   */
  findFlexById: (id: string) => Promise<Record<string, unknown> | null>;
  /** `this.sendFlexReply(accessToken, …)` — the token is already applied. */
  sendFlexReply: (
    replyToken: string,
    card: Record<string, unknown>,
    altText: string,
    userId: string | undefined,
  ) => Promise<LadderReplyResponse>;
  /** `[FIX-20260827-HELPERSTAMPDOORS]` door S1 — stamp only what actually went out. */
  stampIfHelperCardDelivered: (
    card: Record<string, unknown> | null,
    userId: string | undefined,
    status?: number,
  ) => void;
  /**
   * `this.chatHistory.logSystemMessage(row)` — the SYSTEM row (the suppressed-check
   * divider), a different collaborator writing a different row type from `logBotMessage`.
   * Folding the two would turn an admin-facing divider into an ordinary bot message in
   * the customer's history.
   *
   * ⚠️ IT RETURNS THE PROMISE AND DOES NOT CATCH, unlike `logBotMessage`. The caller owns
   * the `void` and the `.catch`, because the failure line is the caller's:
   * `[SUPPRESSEDCHECK] เก็บผลตรวจไม่สำเร็จ (flow เดิมไม่กระทบ)` is what an operator greps
   * for, and a shared catch here would rewrite it to something generic. The same reasoning
   * put the `tag` parameter on `logBotMessage`; this site needs a whole sentence rather
   * than a prefix, so it keeps the catch instead. ข้อความ log เป็นของจุดที่เรียก
   */
  logSystemMessage: (row: Record<string, unknown>) => Promise<unknown>;
}

/**
 * The model request, as the ladder passes it through.
 *
 * ⚠️ Structural, not imported from `@/modules/ai`: `gates/` is a role directory of the
 * webhook module and the layering lint keeps it from reaching across. The real type is
 * checked where the binding is made, in the spine — which is exactly one place.
 */
export type AiReplyRequestLike = Record<string, unknown>;

export interface AiReplyResponseLike {
  text: string | null;
  noData: boolean;
  tagStatus: 'found' | 'not_found' | null;
  error_message?: string | null;
  http_status?: number | null;
  response_data?: unknown;
}

/**
 * One rung of the ladder.
 *
 * The shape follows `event-handlers/handler-entries.ts` deliberately: a self-describing
 * entry, on/off by flipping `enabled`, and a boot-time refusal for a list that cannot be
 * trusted. What is added here — and it is the part that makes the ladder SAFE to reorder —
 * is the declared ordering constraint.
 */
export interface LadderStep {
  /** Stable id. Specs, logs and `ladder-order.ts` name the step by this and nothing else. */
  readonly id: string;
  /** One line: what this step decides. Surfaced by the order spec's failure messages. */
  readonly describe: string;
  /** `false` = shipped but switched off, exactly like an event-handler entry. */
  readonly enabled: boolean;
  /**
   * Cheap and PURE — no IO, no awaits. It answers "is this step's case in play at all".
   *
   * ⚠️ A scope precondition folds in here. The spine's `if (userId) { …30 gates… }` is not
   * a gate, it is a shared precondition; carrying it as a `when` on each child keeps the
   * precondition exactly while removing 934 CODE of nesting.
   */
  readonly when?: (ctx: TurnContext) => boolean;
  /** The work. `'done'` ends the turn. */
  readonly run: (
    ctx: TurnContext,
    deps: TurnDeps,
  ) => Promise<StepVerdict> | StepVerdict;

  /**
   * ⚠️⚠️ THE FIELD THIS WHOLE DESIGN STANDS ON.
   *
   * A registry alone would make the ladder EASIER TO REORDER AND THEREFORE EASIER TO
   * BREAK, because most of what pins this order is invisible to any tool. The dive sorted
   * the constraints into three classes:
   *
   *   DATA   a step reads what an earlier one writes. Visible — `gate-graph.py --pins`
   *          computes each gate's floor line from exactly this.
   *   EFFECT something already happened in the world. **Invisible to every tool**, and
   *          this is most of them: strike-suspend must sit above the first
   *          `getOrCreateRoom` because that call CREATES a member and a room; the rate
   *          limiter is an `INCR` and must run exactly once; the admin door must reply
   *          BEFORE it opens the case, because opening it mutes the bot; `substituteCtxVars`
   *          must run AFTER retrieval, because retrieval caches by `doc_id` and two hooks
   *          sharing a document could otherwise read each other's domain.
   *   PATCH  the bytes belong to a plug patch and cannot move at all.
   *
   * Today an EFFECT constraint is enforced by whoever notices a comment. Declared here, it
   * is enforced by `gate-ladder-order.spec.ts`, which proves the shipped order is a
   * topological sort of every declaration. เขียนเหตุผลไว้ให้เครื่องตรวจ ไม่ใช่ให้คนจำ
   */
  readonly mustFollow?: readonly string[];
  readonly mustPrecede?: readonly string[];
  /** WHY the constraint exists, for the person who wants to move it. One or two lines. */
  readonly orderNote?: string;

  /**
   * ⚠️⚠️ THE DATA CHAIN — the half `mustFollow` cannot see.
   *
   * `mustFollow`/`mustPrecede` capture the EFFECT chain: something already happened in the
   * world. They say nothing about VALUES, and nothing else checks those either — **a step
   * that reads `ctx.skipBotProcessing` before the step that writes it compiles perfectly
   * and reads `false`.** tsc cannot help: the field exists, it has the right type, and its
   * initial value is a legitimate one. The turn simply answers as though an operator were
   * not holding the room.
   *
   * The remaining migration has twelve of these chains — `event` and `userId` are
   * reassigned mid-ladder, `skipBotProcessing` feeds seven gates, `noQrPhoto` is written in
   * the image branch and read in the non-text branch. Declaring them is what makes moving
   * those safe rather than merely careful.
   *
   * `keyof TurnContext` on purpose: a renamed field fails at COMPILE time, so a declaration
   * cannot quietly rot into a lie the way a string list would.
   * ประกาศว่าอ่านอะไร เขียนอะไร แล้วให้เครื่องตรวจว่าใครมาก่อน
   */
  readonly reads?: readonly (keyof TurnContext)[];
  readonly writes?: readonly (keyof TurnContext)[];
}

/**
 * Context fields the SPINE fills before the ladder runs.
 *
 * A step may read any of these without an earlier writer inside the ladder, because they
 * are already true when the first step is asked. Everything NOT listed here has to be
 * written by an earlier step, and `gate-ladder-order.spec.ts` proves it.
 *
 * ⚠️ It is a list of what is READY, not of what is READ-ONLY. `bangkokTime` is here — the
 * spine stamps it during the profile fetch — and `api-error-trigger` still re-stamps it.
 */
export const SPINE_PROVIDED_FIELDS: readonly (keyof TurnContext)[] = [
  'event',
  'hook',
  'alias',
  'userId',
  'creds',
  'logContext',
  'body',
  'meta',
  'hookSource',
  'lineReplyEndpoint',
  'helperAltText',
  'ignoreDocId',
  'profileData',
  'customerName',
  'customerTel',
  'contractCode',
  'msgType',
  'customerMsgId',
  'bangkokTime',
  /*
   * ⚠️ FILLED LATE — inside `if (userId)`, immediately above the customer slice, at the
   * first line where all of them are final. They are listed here because the SPINE writes
   * them and no step does.
   *
   * ⚠️⚠️ AND THAT IS A REAL LIMIT OF THIS FENCE, stated rather than hidden:
   * `assertDataChain` proves step→step chains. It cannot prove a SPINE→step handover,
   * because the spine is not in the list it walks. If the handover block were moved back
   * below `if (userId)` — where it originally sat — the customer slice would read the
   * INITIAL values: the notice guard told no operator holds the room, the admin doors
   * finding no room to open a case against. Nothing throws, nothing fails to compile, and
   * this fence stays green. What catches THAT is the golden transcripts.
   * ด่านนี้ตรวจ step ต่อ step · ช่วงที่ spine ส่งค่าให้ ต้องพึ่ง golden
   */
  'existingUser',
  'msgContent',
  'skipBotProcessing',
  'inboundRoom',
  'profileBlock',
  'profileCircuitOpen',
  /* Built at `webhook.service.ts:2650` and handed over three lines below the profile
     fetch, because the image lane's refusal step reads it long before the customer
     handover runs. */
  'profileForLog',
  /* Written by the image branch, which is still inline because a strike-plug hunk owns
     bytes inside it. Handed over with the rest, above the customer slice. */
  'slip',
  'media',
  /* Filled by the spine after the flex build, which cannot move — see the reply section.
     `tags`, `finalReplyForLine`, `useHelperQr` and `replyBodyForLine` are NOT here: steps
     write them, and listing a written field as spine-provided would silence the very chain
     the fence exists to check. */
  'flexProfileContents',
  'flexKind',
  'flexOut',
  'useHelperQr',
  'replyViaPush',
  'categorySettled',
  'perfT0',
  'perfProfileMs',
  'replyStaleMs',
];

/**
 * A ladder position that is still written inline in `webhook.service.ts`.
 *
 * WHY IT HAS TO EXIST. The migration is incremental — patch-free segment by patch-free
 * segment — so a step that has moved will often need to declare a constraint against one
 * that has not. Two bad answers were available and both were refused:
 *
 *   · drop the constraint until both ends have moved — the rule goes back to being a
 *     comment, which is the problem this design was built to end;
 *   · let a constraint name anything — then a typo passes silently, and a fence that
 *     cannot fail is not a fence.
 *
 * So an inline position is DECLARED, with the one fact a checker can actually use: whether
 * it sits before or after this ladder slice, and at which line, so the claim can be
 * re-checked by hand in ten seconds. The list shrinks to nothing as the migration
 * finishes — it is a to-do list that fails loudly if it lies.
 */
export interface InlineSpineStep {
  readonly id: string;
  /** Where it sits relative to the ladder slice being checked. */
  readonly relativeToLadder: 'before' | 'after';
  /** The `webhook.service.ts` line it currently occupies. */
  readonly at: number;
  readonly describe: string;
}
