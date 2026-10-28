/**
 * [PROG-20260905-LADDER] What a turn STARTS as — the forty-odd empty seats, beside the
 * type that declares them.
 *
 * WHY IT IS ITS OWN FILE. The seeds and `TurnContext` are one fact written twice, and they
 * were two thousand lines apart: adding a field meant editing `ladder.types.ts` and then
 * finding the literal buried inside `processLockedEvent`. tsc did catch a missed seed —
 * but only after the second edit was hunted down, and the hunt is the cost. Now the two
 * files sit next to each other and the seed is written where the field is declared.
 * ค่าเริ่มต้นควรอยู่ข้างประกาศ ไม่ใช่ห่างกันสองพันบรรทัด
 *
 * ⚠️ IT IS NOT A DEFAULTS OBJECT AND MUST NEVER BECOME ONE. Every field the spine already
 * knows is REQUIRED in `TurnSeed`, so a caller cannot forget one and silently get a
 * plausible blank. The only values with a literal here are the ones that genuinely are not
 * known yet at the top of the turn, and each of the three that are easy to get wrong says
 * why below.
 *
 * ⚠️ THE SEED TYPE IS A `Pick` OF `TurnContext`, not a second interface. A parallel shape
 * would be a contract to keep in sync, and this program has already paid for one of those
 * (the two file paths in `slip-flex-lock-duplicate-first.spec.ts`, which quietly dropped to
 * one site when a file moved). `Pick` cannot drift: rename a field on the context and this
 * fails to compile.
 */

import type { TurnContext } from './ladder.types';

/**
 * What the spine knows by the time the credentials are resolved.
 *
 * These are exactly the fields marked `readonly` on `TurnContext` plus the four the turn
 * genuinely owns from the first line (`event`, `userId`, `perfT0`, `replyStaleMs`).
 */
export type TurnSeed = Pick<
  TurnContext,
  | 'event'
  | 'hook'
  | 'alias'
  | 'userId'
  | 'creds'
  | 'logContext'
  | 'body'
  | 'meta'
  | 'hookSource'
  | 'lineReplyEndpoint'
  | 'helperAltText'
  | 'ignoreDocId'
  | 'perfT0'
  | 'replyStaleMs'
>;

export function buildTurnContext(seed: TurnSeed): TurnContext {
  return {
    ...seed,

    // ── empty until the turn learns them ──────────────────────────────────────
    profileData: {},
    existingUser: null,
    msgContent: '',
    skipBotProcessing: false,
    inboundRoom: null,
    /* `{}` is what the spine builds when LINE returned no profile, so the empty turn and
       the profile-less turn agree rather than differing by null-vs-object. */
    profileForLog: {},
    /* ⚠️ `undefined`, NOT `null`, and the two are not interchangeable. The gates read
       `undefined` as "the profile fetch never ran ⇒ fail open" and `null` as "it ran and
       found nothing". Seeding `null` would make every event that never reaches the fetch
       look like a customer with no account. */
    profileBlock: undefined,
    profileCircuitOpen: false,

    /* The media lane's own state. The IMAGE SLICE fills the top half (store, pre-scan,
       refusal decision); the slip VERIFY block below it is still inline — a strike-plug
       hunk owns bytes in the notice guard that separates them — and hands its four fields
       over at the customer handover. */
    slip: {
      verifyResult: null,
      recordId: null,
      createdAt: null,
      condition: null,
      storageFilePath: null,
      noQrPhoto: false,
      /* Same reading as `profileBlock`: `not_run` is the honest starting verdict, and it
         is the exact shape `shouldSkipSlipVerify` returns when the mode is off. */
      prescan: { skipSlipVerify: false, reason: 'not_run', ms: 0, mode: 'off' },
      blockUnlinked: false,
      /* [FEAT-20260907-UNKNOWNPROFILEREVIEW] `false` for the same reason its
         neighbour is: an empty turn has learned nothing, and "we could not
         identify the sender" must be earned by a failed lookup, never assumed. */
      reviewUnknownProfile: false,
      storageId: null,
    },
    media: {
      incomingType: '',
      rawImageAnswer: undefined,
      mediaUrl: null,
      internalContentId: null,
      isFlexSent: false,
      flexDoc: null,
      textReplyOverride: null,
      isQrCodeSlip: false,
      violationDetected: false,
      cleanImageAnswer: '',
    },

    customerName: 'N/A',
    customerTel: 'N/A',
    contractCode: 'N/A',
    msgType: '',
    customerMsgId: undefined,
    perfProfileMs: 0,
    bangkokTime: '',

    // ── the model lane ───────────────────────────────────────────────────────
    userText: '',
    apiErrorTrigger: null,
    relatedText: '',
    suggestionOverride: null, // [FEAT-20261026-RAGENGINE] replace mode only
    replyTextRaw: null,
    replyText: null,
    tagStatus: null,
    responseAi: null,
    aiMs: 0,
    botChatMsg: null,

    /* The reply group starts empty and is filled by the spine BETWEEN the two ladder
       slices — the flex build sits between them and cannot move, because its tail is a
       `docs/menu-plug-in.patch` box that owns `flexKind === 'menu'`,
       `tags.wantedMenuCardTag` and `flexOut` as bytes. */
    tags: {},
    flexProfileContents: null,
    flexKind: null,
    flexOut: {},
    useHelperQr: false,
    replyViaPush: false,
    categorySettled: Promise.resolve(),
    finalReplyForLine: '',
    replyBodyForLine: '',
  };
}
