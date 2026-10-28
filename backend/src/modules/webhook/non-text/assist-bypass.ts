import {
  buildReplyFlexMessage,
  buildReplyTextMessage,
  type LineSendResult,
} from '@/infra/line';

import { errText, formatThaiDateTime } from '../logging/coerce-mask.util';

import {
  handleCustomerRegisterKeyword,
  type CustomerRegisterDeps,
  type CustomerRegisterEvent,
} from '../hook-reply/customer-register.handler';
import { isCustomerRegisterKeyword } from '../webhook-routing';
import { slipFlexReply } from '../hook-reply/reply-via-core';
import {
  handleSlipFlex,
  type SlipFlexDeps,
  type SlipFlexInput,
} from '../slip-flex/slip-flex.handler';

type Doc = Record<string, unknown>;

/* Redeclared per file rather than exported from the service — the precedent this module
   already follows in customer-register.handler.ts and chat/channels/outbound-audit.ts. */
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/**
 * [PROG-20260905-G25] The assist bypass: what still happens while an operator holds the
 * room.
 *
 * WHEN IT RUNS. `skipBotProcessing` is set — a human is handling this conversation — so
 * the bot must not answer. That is NOT the same as doing nothing, and the difference is
 * this whole file:
 *
 *   · A SLIP still gets verified and its result still filed. The customer paid; the money
 *     side does not wait for the operator to notice.
 *   · The REGISTER keyword still answers, because it hands the customer a link only the
 *     bot can mint, and an operator cannot type one.
 *   · Everything else stays silent.
 *
 * ⚠️ THIS IS ONE HALF OF A PINNED TWIN. `slip-answer-twin-sites.spec.ts` requires this
 * site and its counterpart in the ordinary path to call the same three helpers with
 * argument objects that normalise identical — a one-sided edit is exactly the defect the
 * spec exists to catch. Change one, change both, or the spec will say so.
 *
 * ⚠️ IT ENDS THE TURN ON EVERY PATH the caller cares about; the caller hoists the
 * `return`.
 */

/** The LINE event, as this block reads it. */
interface BypassEvent {
  type?: string;
  replyToken?: string;
  eventId?: string;
  message?: { type?: string; id?: string };
  postback?: { data?: string };
}

export interface AssistBypassArgs {
  /* The slip verdict from the verify gate above — the money side does not wait for the
     operator to notice. Types mirror what `handleSlipFlex` declares, so this file cannot
     drift from the handler it feeds. */
  slipVerifyResult: SlipFlexInput['slipVerifyResult'];
  slipRecordId: SlipFlexInput['slipRecordId'];
  slipCreatedAt: SlipFlexInput['slipCreatedAt'];
  /** The stored image URL for the slip. */
  mediaUrl: SlipFlexInput['mediaUrl'];
  /** The OA's OWN AI key — never the env fallback (the vendor rule lives downstream). */
  hookAiKey: string;
  /* What the slip callback reports alongside the verdict. */
  profileData: Doc;
  /** [FEAT-20261019-CALLBACKLINEPROFILE] the turn's LINE profile (`ctx.profileForLog`), for
   *  the callback. Same name as the context field so both twin call sites spell it alike. */
  profileForLog?: unknown;
  customerName?: string;
  customerTel?: string;
  /** [FEAT-20261014-CALLBACKCONTRACT] the turn's customer code, for the callback. */
  contractCode?: string;
  slipStorageFilePath?: string | null;
  hook: Doc | null | undefined;
  event: BypassEvent;
  userId?: string;
  accessToken: string;
  channelId?: string;
  logContext: Doc;
  /** `meta.baseUrl` — the absolute media URL base, from the request. */
  baseUrl: string;
}

/**
 * The collaborators, typed as the SERVICE declares them.
 *
 * ⚠️ These are the real classes rather than structural stand-ins, and that is deliberate:
 * this block hands most of them straight to `handleSlipFlex` and the register handler,
 * which take the concrete types. A loose type here would be re-cast at every call, and a
 * cast is where a wrong collaborator gets in unnoticed.
 */
/**
 * The collaborators, DERIVED from the contract of the thing they are handed to.
 *
 * ⚠️ Not re-declared. Almost everything this block touches ends up inside
 * `handleSlipFlex`, which already publishes `SlipFlexDeps`. Writing a parallel interface
 * here would be a second source of truth that drifts the first time that handler gains a
 * dependency — and the drift would show up as a cast, not as a type error. Deriving means
 * this file cannot fall behind.
 */
export type AssistBypassDeps = SlipFlexDeps & {
  logger: {
    log: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
  wlogEmit: (row: Doc) => Promise<void>;
  /* The register handler builds its own deps from these three, exactly as the spine did. */
  memberModel: CustomerRegisterDeps['memberModel'];
  chatHistory: { logMessage: (row: Doc) => Promise<unknown> };
  /* The three the slip card path needs directly. Declared structurally, not as the Nest
     classes: this file must not import the service, and these are the only members it
     touches. */
  flexModel: {
    findById: (id: unknown) => {
      lean: <T>() => { exec: () => Promise<T | null> };
    };
  };
  /** A factory: the dispatcher is resolved per send, as the spine does. */
  paymentSender: () => {
    dispatch: (req: unknown) => Promise<LineSendResult>;
  };
  qrVision: { checkIfSlipWithQrCode: (...a: unknown[]) => Promise<boolean> };
  slipFlow: { handleSlipCallback: (input: Doc) => Promise<unknown> };
  /** The payment side runs even while an operator holds the room. */
  runPaymentForSlip: (input: Doc) => Promise<{
    suppress?: boolean;
    lockedDuplicate?: boolean;
  }>;
  customerLink: {
    mintLinkToken: (input: {
      hookId: unknown;
      channelUserId?: unknown;
      channelType?: string | null;
    }) => string;
  };
  replyViaCore: (
    accessToken: string,
    replyToken: string,
    messages: unknown[],
  ) => Promise<{ status?: number; data?: unknown }>;
};

/**
 * Runs the bypass. The caller keeps the `if (skipBotProcessing)` guard and the `return`
 * that follows, so the gate's POSITION in the ladder is unchanged.
 */
export async function runAssistBypass(
  args: AssistBypassArgs,
  deps: AssistBypassDeps,
): Promise<void> {
  const {
    hook,
    event,
    userId,
    accessToken,
    channelId,
    logContext,
    slipVerifyResult,
    slipRecordId,
    slipCreatedAt,
    mediaUrl,
    hookAiKey,
    profileData,
    profileForLog,
    customerName,
    customerTel,
    contractCode,
    slipStorageFilePath,
  } = args;

  // [FIX-20260729-CUSTREGASSIST] the registration keyword is the ONE
  // thing still answered while an admin holds the room — it is the
  // moment a customer is most likely to type it, and the real keyword
  // block below sits after this return, so it never used to fire.
  //
  // Ports legacy:3042-3067 (`handleCustomerRegisterKeyword`). The quota
  // INCR legacy performs here is deliberately NOT performed: `isRateLimited`
  // uses INCR, and counting here while the real limiter below is unreachable
  // would double-charge.
  // [FIX-20260808-CUSTREG] The keyword fires even mid-assist (legacy
  // handles it inside the assist bypass too). On `handled` it replied
  // with the register card and we stop; otherwise fall through to the
  // silent assist path unchanged.
  if (isCustomerRegisterKeyword(event, hook)) {
    const custreg = await handleCustomerRegisterKeyword(
      {
        userId,
        hook,
        event: event as unknown as CustomerRegisterEvent,
        accessToken,
        logContext,
        channelId,
      },
      {
        memberModel: deps.memberModel,
        mintLinkToken: (i) => deps.customerLink.mintLinkToken(i),
        // [FEAT-20260828-PUSHCORE-G] through the core; same shape back.
        sendLineReplyMessage: (t, r, txt) =>
          deps.replyViaCore(t, r, [buildReplyTextMessage(txt)]),
        sendLineFlexReply: (t, r, f, alt) =>
          deps.replyViaCore(t, r, [buildReplyFlexMessage(f, alt)]),
        persistWebhookLog: (entry) => deps.wlogEmit(entry),
        logMessage: (input) => deps.chatHistory.logMessage(input),
      },
    );
    if (custreg.handled) return;
  }

  deps.logger.log(
    `[ASSIST] User ${userId} message logged to history. Bypassing other bot replies.`,
  );
  // [FIX-20260808-ASSISTSLIP] H-C2 — port legacy's assist-mode slip
  // callback (legacy:3073-3271). The slip is ALREADY verified above
  // (:1350, which runs even in assist mode by design), so
  // `slipVerifyResult` is NOT null here — the old comment claiming it was
  // always null was stale. Legacy still SENDS the slip flex card AND fires
  // the deposit callback while a room is in assist mode; without this a
  // customer who uploads a slip mid-operator-chat gets it verified but
  // never CREDITED. We reuse the exact `handleSlipFlex` + `handleSlipCallback`
  // the non-assist path uses, and both self-gate: handleSlipFlex is a
  // no-op when slipVerifyResult is null, and handleSlipCallback returns
  // early when `hook.callback_slip` is empty — that array IS the OA's
  // callback on/off switch (legacy webhookController.js:2099), so no extra
  // condition is needed. runAssistGuarded is deliberately NOT called (the
  // room is already assisted), and the handoff dispatch (handoffPlanForSlip)
  // is deferred here exactly as it is on the non-assist path.
  //
  // The flex deps are inlined (mirroring the non-assist call site) on
  // purpose: it keeps the already-verified non-assist money path untouched.
  if (slipVerifyResult) {
    // [FEAT-20260808-PAYTOOL-P3] Same seam as the non-assist path: a
    // slip uploaded mid-operator-chat must still be CREDITED, so
    // payment runs here too. The room being assisted changes who talks
    // to the customer, not whether their money is processed.
    const assistPaySuppress = await deps.runPaymentForSlip({
      hook,
      slipRecordId,
      accessToken,
      replyToken: event.replyToken ?? '',
      userId,
      logContext,
      // [FEAT-20260810-PAYSTATEFLEX] same three values handleSlipFlex
      // gets below — needed to substitute a bound card's slip tags.
      slipVerifyResult,
      slipCreatedAt,
      baseUrl: args.baseUrl,
    });

    const assistSlipFlex = await handleSlipFlex(
      {
        slipVerifyResult,
        hook: hook,
        slipCreatedAt,
        slipRecordId,
        userId,
        mediaUrl,
        geminiApiKey: hookAiKey || undefined, // [P2] own key; vendor rule decides the fallback
        accessToken,
        replyToken: event.replyToken ?? '',
        eventId: event.eventId,
        incomingType: event.message?.type ?? 'unknown',
        baseUrl: args.baseUrl,
        logContext,
        // Payment already answered ⇒ do not also send the slip card.
        suppressSlipReply: assistPaySuppress.suppress,
        /* [FEAT-20260820-LOCKDUPFIRST] the lock decides, not the room
         state — a customer resending an already-paid slip must get
         the same card whether or not an admin is holding the room.
         ห้องอยู่สถานะไหนไม่เกี่ยว · ล็อกเป็นตัวตัดสิน. */
        duplicateFirst: assistPaySuppress.lockedDuplicate,
      },
      {
        findFlexById: (id) =>
          deps.flexModel.findById(id).lean<Record<string, unknown>>().exec(),
        /* [FEAT-20260828-PUSHCORE-A1] through the core. `replyViaCore`
         keeps the THROW the slip flow depends on: this send sits
         inside the handler's outer try/catch (slip-flex.handler.ts
         :550-955), which logs "Failed in result processing logic"
         and lets the flow continue. Without a throw a refused card
         would fall through as if it had been delivered. */
        /* [FIX-20260906-ASSISTSLIPPUSH] `userId` LAST, and it is not decoration:
           `reply-via-core.ts:436-438` reads it as the switch — with it the send is
           `replyThenPush`, without it plain `replyViaCore` and there is no push leg.

           🔴 IT WAS MISSING, and the lane lost a fix `dev` carries. Commit 980aedf on
           `dev` passed `userId` at BOTH slip call sites; the spine cut moved the assist
           half into this file and the lane's own fix (1e45a70) patched only the other
           one — its message claims "ONE binding, not the two `dev` carries", which is
           false: `turnDeps()` binds the ordinary path, and the assist deps are inlined
           HERE. Two bindings, one fix, one silent regression.

           What it costs once the token has expired — and on this path it regularly has,
           because the paid Swiftcheck verify and the QR read run first: the reply is
           refused, the send throws, and `isFlexSent` (set at `slip-flex.handler.ts:893`,
           AFTER the send) stays false. The card is lost AND `if (assistSlipFlex.isFlexSent)`
           below never fires `handleSlipCallback` — the deposit callback. For an OA that
           credits through `callback_slip` that is money, not a missing card.
           โทเคนหมดอายุ = การ์ดหาย + callback ไม่ยิง = เครดิตหาย */
        sendLineFlexReply: (t, r, f, alt, qr) =>
          slipFlexReply(
            (req) => deps.paymentSender().dispatch(req),
            t,
            r,
            f,
            alt,
            qr,
            userId,
          ),
        persistWebhookLog: (entry) => deps.wlogEmit(entry),
        logMessage: (i) => deps.chatHistory.logMessage(i),
        checkQrCode: (url, key) =>
          deps.qrVision.checkIfSlipWithQrCode(url, key),
        formatThaiDateTime: (d) => formatThaiDateTime(d),
        lineReplyEndpoint: LINE_REPLY_ENDPOINT,
      },
    );
    if (assistSlipFlex.isFlexSent) {
      void deps.slipFlow
        .handleSlipCallback({
          hook: hook,
          flexDoc: assistSlipFlex.flexDoc,
          condition: assistSlipFlex.slipCondition,
          slipVerifyResult,
          profileData,
          userId,
          lineProfile: profileForLog,
          customerName,
          customerTel,
          contractCode,
          storagePath: slipStorageFilePath,
          mediaUrl,
          slipRecordId,
        })
        .catch((e: unknown) =>
          deps.logger.error(`[CALLBACK-TRIGGER] Error (assist): ${errText(e)}`),
        );
    }
  }
  return;
}
