/*
 * ⚠️⚠️ DO NOT RUN A FORMATTER OVER THIS FILE ⚠️⚠️
 *
 * Not `prettier --write`, not `eslint --fix`, not "format on save".
 *
 * WHY: several suites assert on the SOURCE TEXT of this file, not on its
 * behaviour — they read it with `readFileSync` and match exact strings, which
 * is how they pin that a guard is still written the way it has to be:
 *   · z-test/unit/customer-helper-flex-history.spec.ts
 *   · z-test/unit/card-ticket-flag.spec.ts
 *   · z-test/unit/paylink-warn-filter.spec.ts
 * Re-wrapping a line those tests quote turns them red even though nothing
 * behaved differently. There is a `// prettier-ignore` at ~:3911 for exactly
 * that reason, but it only covers the one line it sits on.
 *
 * TRIED IT, IT BROKE, TWICE (2026-08-12):
 *   `eslint --fix`      removed the `LineFlexContents` import as "unused" —
 *                       it is used through a type assertion — tsc then failed.
 *   `prettier --write`  re-wrapped a quoted line; the flex-history suite failed.
 * Both were reverted. The file therefore carries ~82 formatting lint errors ON
 * PURPOSE (21 of them predate this work). Leave them.
 *
 * Same applies to the other files read as text by tests:
 *   src/modules/hooks/hooks.service.ts · src/modules/hooks/hook-field-tabs.ts
 *   src/modules/webhook/line-content.service.ts
 *
 * If you must reformat: run the unit suite first, reformat, run it again, and
 * expect to fix the quoted strings inside those specs by hand.
 *
 * ─── EXTENSION RULE — owner-mandated, 2026-08-22 ──────────────────────────
 * Any addition or change to this file MUST NOT touch the main flow.
 * New behaviour ships as an INDEPENDENT, DETACHABLE function in its own
 * module folder (payment-reply/, qr-prescan/, follow-up/, notice-runtime/,
 * ...) and reaches this file as ONE guarded call that early-returns — never
 * as logic inlined here. Seamless is mandatory: switched off, not configured,
 * or data absent must behave byte-identical to before the change, and
 * payment and every other main-flow leg must keep running exactly as before.
 * Removing a feature must cost only: delete its folder + delete its single
 * call line here. Prove it, don't promise it: capture a BEFORE pack (full
 * suite + flow test), insert, and show the AFTER run equal with the feature
 * off. Do not cram code into this file — แยก module ให้สวย ห้ามยัดเข้ามาถื่อ ๆ.
 */

/**
 * 📖 DOC: `docs/flow/ticket-and-customer-provider-flow.md`
 *
 * ⚠️ THE CUSTOMER-PROVIDER FLOW DOES NOT PASS THROUGH HERE, and that is worth
 * saying out loud because it is the first place people look. Inbound LINE
 * traffic never touches `MembersService`, so nothing in the profile-scoping
 * chain can refuse a webhook, and no provider switch can change what this file
 * does. The customer profile is fetched on the DASHBOARD's request path
 * (`GET /api/line-users/:id/raw-profile`), not on ingress.
 * เส้น LINE ไม่ได้ผ่านตรงนี้ — อย่าตามหา provider ในไฟล์นี้
 *
 * What the two DO share is the hook: a hook is the OA a room belongs to, and
 * `getAllowedHookIds` is what scopes a profile read to the OAs a caller may
 * see. See §2 and §10 of the doc above.
 */
// [FIX-20260817-RETRYRESUME] shared result→reply→card bridge
import {
  replyWithResume,
  resumeContext,
} from './payment-reply/payment-reply-resume';
// [FEAT-20260827-PUSHCORE-B] the reply→push rungs, extracted (see that file's header)
import { deliverPaymentReply } from './payment-reply/payment-send.ladder';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';

import {
  aiConfig,
  channelConfig,
  integrationConfig,
} from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
/* [FEAT-20260827-PUSHCORE-B] the ONE LINE sender. The WRAPPER, never
   `LinePushService` — that leak is pinned at zero by docs/core-push.md and is
   the seam a real queue slots into (line-push-dispatcher.ts:24-27). */
import {
  buildReplyFlexMessage,
  buildReplyTextMessage,
  LinePushDispatcher,
  /* [FEAT-20260831-QUOTESRC] the ids LINE returns for a message it accepted.
     Spread into the history write so the bot's own row can be quoted back. */
  sentMessageIds,
  type LineSendRequest,
} from '@/infra/line';
// [FEAT-20260828-PUSHCORE-G] the throw-on-refusal rule, testable on its own
import {
  flexReply,
  noticeFlexReply,
  replyThenPush,
  replyViaCore,
  slipFlexReply,
  textReply,
} from './hook-reply/reply-via-core';
import { RealtimePublisherService } from '@/infra/realtime/realtime-publisher.service';
import { LEGACY_RATE_LIMIT_TEXT } from './rate-limit/user-rate-ladder';
import { UserRateLadderService } from './rate-limit/user-rate-ladder.service';
import { RedisService } from '@/infra/redis/redis.service';
import {
  AssignHistory,
  ChatHistoryService,
  ChatMessage,
  ChatRoom,
  Member,
} from '@/modules/chat';
import {
  ImageStorage,
  ObjectImage,
} from '@/modules/content';
import { CustomerLinkService } from '@/modules/customer-link';
import { CustomToolService, ExternalApiService } from '@/modules/external';
// [FEAT-20260904-VENDORSECCOL] resolveVendorPair — which two columns the hook's
// vendor owns (gemini: ai_model/custom_ai_key · deepseek: the _sec pair).
import {
  FlexMessage,
  Hook,
  HookCacheService,
  resolveVendorColumns,
} from '@/modules/hooks';
import {
  ConfigCacheInvalidator,
  SystemConfigService,
  TranslationDictCacheService,
  WebhookLogService,
} from '@/modules/system';
import { Ticket } from '@/modules/tickets';

import type { ChatRoom as ChatRoomType } from '@/modules/chat';

/* [PROG-20260905-LADDER] `AiReplyRequest`, `AiReplyResponse`, `resolveReplyText` and
   `shouldBlockForApiError` left with the model lane — `gates/ask-model.step.ts`,
   `gates/resolve-reply-text.step.ts` and `gates/api-error-refusal.step.ts` each import
   what they alone need. */
import {
  AI_REPLY_PROVIDER,
  type AiReplyProvider,
} from './ai-reply/ai-reply.provider';
/* [FIX-20260816-WLOGVENDOR] The audit row's vendor name + endpoint label come from the
 * registry that picks the transport, never from the raw hook field — the rule moved to
 * `logging/ai-audit-row.ts` with the row, and the two imports went with it. */
// [FEAT-20260810-DOCRETRIEVAL] the retrieval seam + its inert stand-in.
import {
  DOC_RETRIEVAL_PROVIDER,
  NO_DOC_RETRIEVAL,
  retrieveDocContext,
  type DocRetrievalProvider,
} from './doc-retrieval/doc-retrieval.provider';
// [FEAT-20260815-WLOGDOOR] the single exit for webhook_logs rows + its contract.
/* [FEAT-20260815-WLOGDOOR] the single exit for webhook_logs rows + its contract.
   `WebhookLogStatus` is intentionally NOT imported: `sendPaymentReply`'s helper
   spells the union inline (`[FIX-20260815-UNDELIVEREDSTATUS]`), which is the same
   three values and is the form dev settled on — matching it byte-for-byte keeps
   that line from colliding on every merge. The alias still exists in the contract
   for anything that takes a whole event. */
import { WebhookLogEmitter, type WebhookLogEvent } from './logging';

import {
  type AssistDeps,
  runAssistGuarded,
} from './assist/assist-notification';
// [FEAT-20260819-ABANDON] the whole decision lives in this module — one call below
import {
  AI_ASSIST_SUMMARY_PROVIDER,
  type AssistSummaryProvider,
} from './ai-vendors/gemini/assist-summary.provider';
import { renderFlexDoc } from './flex/flex-render.util';
import {
  LineApiService,
  type LineFlexContents,
  type LineQuickReply,
} from './line-api.service';
import { LineContentService } from './line-content.service';
import {
  NON_TEXT_AUTO_REPLY_TYPES,
  REPLY_STALE_MS,
  SILENT_MESSAGE_TYPES,
} from './webhook-routing';
// [FIX-20260808-CUSTREG] The ported keyword handler (was a fall-through stub).
import {
  type CustomerRegisterEvent,
  handleCustomerRegisterKeyword,
} from './hook-reply/customer-register.handler';
// [FEAT-20260810-HELPERFLEX] การ์ด flex ของ customer-helper (hard-code ชั่วคราว)
import {
  HELPER_ALT_TEXT,
  stripHelperUriForHistory,
} from './hook-reply/customer-helper-flex';
// [FIX-20260808-FLEXBUILDER] The three flex reply builders + the runtime var-map
// assembly that fills the card with the customer's REAL values.
import { buildFlexVarMaps, pickByRole } from './flex/flex-data-vars.util';
import {
  buildFlexProfileCustomReply,
  buildFlexProfileReply,
  buildFlexTagReply,
} from './flex/flex-profile-reply.builder';
import type { FlexReplyOut } from './flex/flex-reply-out';
// [FIX-20260822-FLEXHISTORYTYPE] the history fields of a sent card, derived once.
import { type FlexCardKind } from './flex/flex-history-meta';
// [FEAT-20260822-NOTICERUNTIME] the notice guard — ONE call at each of the two
// insertion points below; everything it does lives in ./notice-runtime.
// revert: delete this import, tryNoticeGuard, and the two call blocks.
import {
  runNoticeGuard,
  NOTICE_ALT_TEXT,
  type NoticeCase,
  /* [PROG-20260905-LADDER] `noticeTextEventAllowed` and `WITHDRAW_CASE_ORDER` left with
     the steps that read them — `gates/notice-text-guard.step.ts` and
     `gates/admin-doors.step.ts`. Each step imports what it alone needs, which is what
     stops this block growing one line per feature forever. */
} from './notice-runtime';
// [FIX-20260808-SLIPFLOW] The Swiftcheck verify flow (SlipFlowService) and the
// customer-facing slip flex branch (handleSlipFlex). QrVisionService is the ONE
// billed seam; it reaches this file only through the flex handler's `checkQrCode`
// dep, so a test can hand it a canned boolean and never issue a Gemini call.
import { PaymentRunnerService } from '@/modules/payment';
// [FEAT-20260810-PAYSTATEFLEX] resolves the card bound to a reply state; returns
// null whenever it cannot, which means "reply exactly as before".
import {
  resolveStateFlex,
  // [FEAT-20260823-TOPUPDUP] default การ์ด duplicate ให้ state topup_duplicate
  withSwiftcheckDuplicateFallback,
} from '@/modules/payment/payment-state-flex.resolver';
// [FEAT-20260810-CARDTICKET] open or retitle the ticket a bound card asks for.
import {
  openPaymentTicketIfIdle,
  retitleDirectTicket,
} from '@/modules/payment/payment-ticket.helper';
/* [FEAT-20260829-MENUTAG-S3] plug. see docs/menu-plug-in.patch
   ⚠️ ANCHORED HERE ON PURPOSE — NOT beside the strike plug further down. The
   first draft sat directly under it and landed inside the CONTEXT LINES of
   docs/strike-plug-in.patch, which then stopped reverting: strike lost its off
   switch and strike-plug-patch.spec.ts went red on the full run. Two
   independent plugs must never share an anchor.
   revert: git apply -R docs/menu-plug-in.patch */
import {
  MENU_CARD_SOURCE,
  buildMenuContext,
  createMenuEngine,
  type StoredMenuCard,
  NOT_SILENCED,
  type StoredMenuCardSource,
  /* [FEAT-20260902-MENUPRESSONCE] mint one id per SEND; read the two parts of a
     press back out of the payload. The mechanism is the menu module's; WHICH
     cards get a budget is decided here, at the seat. */
  mintRenderId,
  pressItemOf,
  pressRenderOf,
} from '@/modules/menu';
/* [FEAT-20260902-MENUPRESSONCE] the press budget. Optional on purpose: unbound
   ⇒ every press is allowed and nothing is written, so the seat behaves exactly
   as it did before this feature existed.
   revert: git apply -R docs/menu-plug-in.patch */
import { MenuPressService } from '@/modules/menu-press';

/* [FEAT-20260902-MENUPRESSONCE] The one card type the press budget covers —
   owner 02/09, scoped by TYPE and not by tag, so every card on the FE's
   "เมนู (Flex Menu)" tab is covered the day it is created. One spelling, read by
   both stamp sites below. */
const MENU_PRESS_FLEX_TYPE = 'menu';
// [FEAT-20260831-MENUSLIPQR] plug-side: which stored card ships a quick reply
import { quickReplyForCardSlug } from './flex/menu-card-quick-reply';
// [FIX-20260811-PAYDIVIDER] เขียนเส้นคั่นเมื่อห้องถูก claim แล้ว (ไม่เปิด ticket ซ้ำ)
import { upgradeTicketCategoryOnSlip } from '@/modules/tickets/ticket-category-upgrade.helper';
import {
  retitleLatestDivider,
  writeTicketDivider,
} from '@/modules/tickets/ticket-divider.helper';
import type { SlipTagContext } from './slip-flex/flex-slip-tags.util';
import { QrVisionService, SlipFlowService } from '@/modules/slip';
// [FEAT-20260824-STRIKESESSION] plug. see docs/strike-plug-in.patch
import { STRIKE_SINK, type StrikeSink } from '@/modules/strike';
// [FEAT-20260808-PAYTOOL-P3] the payment reply layer: the retry-postback
// handler + the mint flex builder. Both are pure/injected-deps helpers, so this
// service gains a seam rather than a subsystem.
import {
  buildMintFlex,
  // [FEAT-20260810-PAYSTATEFLEX] mints {{paylink.*}} into an admin's card.
  mintPayLinks,
  handlePaymentPostback,
  MINT_FLEX_ALT_TEXT,
} from './payment-reply';
/* [FEAT-20260826-STRIKESUSPEND] the suspend gate's only import.
   ⚠️ DELIBERATELY NOT BESIDE THE OTHER STRIKE IMPORT. Each feature ships as its
   own plug-in patch, `git apply` matches on three lines of surrounding context,
   and two patches whose hunks touch cannot be reverted independently.
   ⚠️ AND NOTHING HERE MAY SPELL THE OTHER FEATURE'S TOKEN, not even in prose:
   `strike-plug-patch.spec.ts` asserts the file keeps no trace of it after a
   revert, and that assertion runs BEFORE its restore step — so a mention here
   both fails that suite and leaves the tree half-unwired.
   ห้ามเอ่ยชื่อ token ของอีกฟีเจอร์ แม้ในคอมเมนต์ */
import { STRIKE_GATE, type StrikeGate } from '@/modules/strike';
/* [FEAT-20260812-QRPRESCAN] local QR pre-scan — the single import of that feature.
   revert: delete this import + the `[FEAT-20260812-QRPRESCAN]` block below
   (grep QRPRESCAN) + the `qr-prescan/` folder. */
import { shouldSkipSlipVerify } from './qr-prescan';
/* [OBS-20260812-IMGPROBE] dev-only image-flow probe. Log-only, off unless
   IMG_FLOW_PROBE=on. revert: delete this import + every `imgProbe`/`imgProbeSettings`
   call (grep IMGPROBE) + the file it comes from — the calls now live in this file AND in
   `gates/*.step.ts`, so grep the module, not just the spine. */
import { imgProbe } from './logging/img-flow-probe';
/* [PROG-20260905-STEP0] `maskToken` + `asString` moved out of this file so handlers in
   role directories can reach them; exporting them from here would be a cycle. */
import {
  asString,
  errText,
  formatThaiDateTime,
} from './logging/coerce-mask.util';
import { syncMemberProfile } from './room-bootstrap/sync-member-profile';
import { replyWithTaggedImages } from './hook-reply/tagged-image-reply.handler';
import { deriveRequestCredentials } from './ai-vendors/request-credentials';
import { assistAiFields } from './assist/assist-ai-fields';
import { runAssistStateGate } from './assist/assist-state.gate';
/* [PROG-20260905-LADDER] the ladder tail. `replyOutOfHours`, `dispatchRegisteredEvent` and
   `resolveStatusOffReply` left with it — each step imports what it alone needs, which is
   what stops this import block growing one line per feature forever. */
import {
  ASSIST_BYPASS_LADDER,
  CUSTOMER_LADDER,
  IMAGE_LADDER,
  IMAGE_REFUSAL_LADDER,
  MEDIA_LADDER,
  PROLOGUE_LADDER,
  REPLY_LADDER,
  TAIL_LADDER,
} from './gates/ladder-order';
/* 📖 [PROG-20260905-FLOWDOC] THE MAP FOR EVERYTHING BELOW is
   `docs/flow/webhook-flow-and-gates.md`: the whole turn end to end, all gates in the order
   they run with the reason for each position, the data chain, and the rules for adding one
   without this method growing back. It is GENERATED from `gates/ladder-order.ts`, so it
   cannot describe an order the code does not have. อ่านไฟล์นั้นก่อนแก้เมธอดนี้ */
import { buildTurnContext } from './gates/build-turn-context';
import { runLadder } from './gates/ladder-runner';
import type { TurnContext, TurnDeps } from './gates/ladder.types';
import { notifyTelegramNoAnswer } from './assist/telegram-no-answer-notify';
import { replyApiErrorRefusal } from './hook-reply/api-error-reply.handler';
import { assemblePrompt } from './ai-reply/prompt-assembly';
import { fetchCombinedProfile } from './room-bootstrap/combined-profile';
import { storeInboundChatRow } from './room-bootstrap/inbound-chat-row';
import { openAdminCaseDirect as openAdminCase } from './ticket/open-admin-case';
import { runAssistBypass } from './non-text/assist-bypass';
import { runFollowUpFlow as runFollowUpFlowImpl } from './gates/follow-up-flow';
import { buildIncomingDeliveryRow } from './logging/incoming-delivery-row';
/* [FIX-20260812-HELPERMARKERLEAK] revert: delete this import and the three
   `[FIX-20260812-HELPERMARKERLEAK]` blocks that use it (grep the tag). */
import {
  resolveHookTextReply,
  resolveHookTextReplyMode,
  type HookTextReplyMode,
} from './hook-reply/hook-text-reply';
// [FIX-20260819-REFUSALMARKERMODE] the slip-refusal field's marker-driven mode.
// [FIX-20260819-DIVIDERHELPERLABEL] the admin-facing text of the suppressed-check divider.
/* [FEAT-20260812-HOOKHELPERFLEX] revert: delete this import, the
   `buildHookHelperFlexFor` method and the three `[FEAT-20260812-HOOKHELPERFLEX]`
   call sites (grep the tag) + the file it comes from. */
import { buildHookHelperFlex } from './hook-reply/hook-helper-flex';
// [FEAT-20260813-EAGERROOM] eager room-on-event — see room-bootstrap/ folder.
import { ensureRoomOnEvent } from './room-bootstrap/ensure-room-on-event';
import { buildRoomFilter } from './room-bootstrap/room-filter';
import { sendAiReply } from './ai-reply/send-ai-reply.handler';
import { replyMissingProfileData } from './hook-reply/missing-profile-data-reply.handler';
import type { AssistTurnArgs } from './assist/assist-turn-args';
import { runDeliveryEvents } from './event-iteration/run-delivery-events';
/* [PROG-20260905-LADDER] `isPaymentFlexCard` left with the assist hand-off it feeds —
   `gates/image-assist-handoff.step.ts`. */
import {
  handleSlipFlex,
  SLIP_QUICK_REPLY,
} from './slip-flex/slip-flex.handler';
import {
  // [FEAT-20260825-HELPERTRIGGER] ตัวประทับเวลา — เงื่อนไขอยู่ในไฟล์ rule ของมันเอง
  stampCustomerHelperTrigger } from './follow-up';
/* [DOC-20260821-BAGRULES] ⭐ THE BAG HAS A CENTRAL REGISTRY — READ IT BEFORE
   TOUCHING A KEY: `src/modules/chat/config/member-config.registry.ts`.

   ⚠️ THIS FILE NO LONGER WRITES `follow_up.line.request_reg_at`. It did until
   [PROG-20260905-G23] lifted the follow-up flow into `gates/follow-up-flow.ts`,
   which took the `writeMemberConfigOnce` call with it — the full BOTH ENDS note
   for that key now lives there, beside the call it describes. The registry's
   CONSUMERS list and `member-config.spec.ts` were updated in the same commit as
   this note, three save points late, because neither spec was in the gate set of
   the save point that moved the code.

   THIS FILE STILL REACHES THE BAG INDIRECTLY, through
   `stampCustomerHelperTrigger` (`follow-up/customer-helper-trigger.helper.ts`,
   which is on the registry's list in its own right). That is why the rule below
   still applies here.

   ⚠️ CHANGING WHAT THIS FILE DOES WITH A KEY MEANS UPDATING THAT LIST in the
   same commit — adding a read, dropping a write, MOVING THE CALL TO ANOTHER
   FILE. แตะคีย์เมื่อไหร่ ต้องไปอัปเดตบัญชีที่จุดกลางด้วยเสมอ. */

/* [FEAT-20260902-ADMINPOSTBACK] recognises a contact-button PRESS. The doors far
   below match this payload instead of the customer's words, which is what makes
   typing the sentence stop working. Builder + parser live in one leaf file.
   ⚠️ ANCHORED HERE ON PURPOSE, at the END of the import list. The obvious spot —
      beside the `CONTACT_ADMIN_*` copy imports it belongs with — sits inside the
      CONTEXT LINES of docs/menu-plug-in.patch, and touching a line there stops
      that patch reverting: the menu plug loses its off switch and
      menu-plug-patch.spec.ts goes red. `docs/menu-plug-in.patch` carries the same
      warning for the same reason. Two plugs, and now this import, must never
      share an anchor. ⇒ ห้ามแทรก/แก้บรรทัดในเขต context ของ patch
   ⚠️ DO NOT run `prettier --write` over this whole file either — it reflows lines
      the patches quote verbatim (on 02/09 it rewrapped a long strike-tracking call
      and strike-plug-patch.spec.ts went red). Format the block you edited, never
      the file.
   ⚠️ AND DO NOT NAME THE PLUGGED-IN SYMBOLS IN A COMMENT HERE. `strike-plug-patch.spec.ts`
      asserts that unplugging leaves NO trace of them anywhere in this file, so a
      comment merely mentioning one keeps the spec red after a clean revert — which
      reads exactly like a broken patch and cost a round trip to diagnose.
      ⇒ ห้ามพิมพ์ชื่อ symbol ของปลั๊กลงในคอมเมนต์ เทสจะเห็นว่ายังถอดไม่หมด */
/* [FIX-20260902-ADMINDIVIDER] the sentence the ADMIN reads when a contact-button
   case opens. Anchored HERE, not beside the other `CONTACT_ADMIN_*` imports, for
   the reason spelled out just above — that block is patch context. */
/* [FEAT-20260902-NOWBLOCK] ⚠️ The import MOVED at [PROG-20260905-G34]: the now-block is
   assembled inside `ai-reply/prompt-assembly.ts` along with the rest of the prompt, so
   this file no longer touches the feature at all. Removing the feature is now: delete
   `now-block/`, the import in `ai-reply/prompt-assembly.ts`, and its guarded call there.
   Left as a note rather than deleted because the old instruction pointed HERE, and a
   revert instruction that sends someone to the wrong file is worse than none. */

/**
 * =====================================================================
 * LINE webhook ingest — the wiring.
 * =====================================================================
 *
 * TRANSCRIBED, not redesigned. Source of truth:
 *   legacy-api/src/controllers/core-bot/webhookController.js
 *   · handleWebhook   2293-2318
 *   · withUserLock    2174-2280
 *   · _processWebhook 2320-4970
 *
 * The DECISIONS live in `webhook-routing.ts` and the pure utils beside it; the
 * SENDING lives in `line-api.service.ts`; the WRITES live in
 * `chat-history.service.ts` and `webhook-log.service.ts`. This file is the
 * order those are driven in — which is the part legacy encodes as 2,650 lines
 * of straight-line control flow, and the part that has to match.
 *
 * ⚠️⚠️ THE MODEL IS NEVER CALLED FROM HERE. The one outbound generative call
 * sits behind `AiReplyProvider.generate`, and the binding in `webhook.module.ts`
 * is `UnavailableAiReplyProvider`, which rejects. `custom_ai_key` is decrypted
 * ONLY to be masked into a webhook_logs row (legacy does the same) and is never
 * placed in an `AiReplyRequest` — there is no field on that interface for it.
 * See ai-reply.provider.ts for why that is a hard seam and not a convenience.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT IS PORTED, AND WHAT IS NOT
 * ─────────────────────────────────────────────────────────────────────
 * Ported end to end:
 *   lock · hook resolve/refresh · raw incoming webhook_log · signature re-check
 *   · assist + auto-unassist + AssignHistory · loading indicator · Member
 *   profile sync · external/custom-tool profile fetch · Member phone/contract
 *   write · inbound media download · inbound chat_messages row · silent types ·
 *   assist skip · rate limit · non-text / image_answer_text · out-of-hours ·
 *   no-text · prompt assembly · the AI seam · reply-text resolution · reply-tag
 *   pipeline · img_* carousel · the 120s staleness guard · the send · every
 *   webhook_logs row on those paths · forceReAssistAfterReply.
 *
 * The register-keyword, slip verification / slip flex, assist notification, and
 * the three flex-card builders are now ported and wired here. What still remains
 * UNPORTED is marked at each site with its legacy line number, and each falls
 * through exactly the way legacy falls through when its guard is false:
 *   · handoffChainPostback.handlePostback      legacy:2487-2493
 *   · ragService doc retrieval (relatedText)   legacy:4021-4078
 *   · analyzeCategoryFromRoom                  legacy:4470-4484
 *
 * ⚠️ DELIBERATELY NOT PORTED — legacy:3395-3411. That block reads the room's
 *    last message, computes `isWaitingForAssist`, and NEVER USES IT: its only
 *    consumer is commented out at 3405-3408 ("[TEMPORARILY DISABLED] - Allow
 *    slip check and flex processing even in assist mode"). Restoring it would
 *    suppress `image_answer_text` in assisted rooms, which is the behaviour the
 *    comment says was deliberately switched off. Anyone diffing this file
 *    against legacy will notice the gap — this note is why it is a gap.
 */

/**
 * The parts of the Express request the pipeline reads that are not the body.
 *
 * Legacy reads them straight off `req`. Passing them in keeps this service
 * free of an Express dependency, which is what lets the whole pipeline be
 * driven from a unit test with no HTTP server.
 */
export interface WebhookRequestMeta {
  /** `req.method` — copied into the incoming and error webhook_logs rows. */
  method: string;
  /** `req.originalUrl` — same two rows. */
  originalUrl: string;
  /** The exact bytes LINE signed. Legacy: `req.rawBody || req.body`. */
  rawBody?: Buffer | string;
  /** `req.headers['x-line-signature']`. */
  signature?: string;
  /**
   * `process.env.BASE_URL || `${req.protocol}://${req.get('host')}``, trailing
   * slashes stripped — legacy:2807. Used to build the absolute media URL.
   */
  baseUrl: string;
  /** `req.ip` / `req.headers['user-agent']` — legacy `buildErrorPayload`. */
  ip?: string;
  userAgent?: string;
}

/* legacy:250 — `buildRoomFilter` now lives in `room-bootstrap/room-filter.ts`. It had
   grown FOUR identical copies (here plus three role files this program created), and the
   `$or` it carries is a schema fact, not a formatting choice — see that file. */

/** legacy:177 — "วันอังคารที่ 05 สิงหาคม 69 14:03:21". */
/**
 * [FEAT-20260810-PAYSTATEFLEX] Swiftcheck's `rawSlip` out of a verify result.
 *
 * Named rather than inlined because the path is two optional hops deep and the
 * cast chain buried the intent. This is the SAME subtree the slip card
 * substitutes from (`slip-flex.handler.ts:396`), so a card using `{{amount}}`
 * renders identically whether it answers as a slip card or a payment card.
 * Absent ⇒ `undefined`, and the resolver then substitutes nothing.
 */
function rawSlipOf(verifyResult: unknown): never {
  const data = (verifyResult as { data?: { rawSlip?: unknown } } | null)?.data;
  return data?.rawSlip as never;
}


/* [PROG-20260905-LADDER] `resolveDictTool` moved to `ai-reply/prompt-context.util.ts`
   with the model request it feeds: a role file cannot import from this service without
   creating a cycle, and the request is assembled by `gates/ask-model.step.ts` now. */

/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

/** A LINE event, read the way legacy reads it: optionally, everywhere. */
interface LineEvent {
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
    /** [FEAT-20260821-QUOTEREPLY] LINE's quote handle for this message
     *  (text · sticker · image · video) and, when the customer quoted one of
     *  ours, the quoted message's id. Read once, at the two logMessage calls. */
    quoteToken?: string;
    quotedMessageId?: string;
  };
  postback?: { data?: string };
}

type HookLike = Record<string, unknown>;

/**
 * [FEAT-20260820-LOCKDUPFIRST] What `runPaymentForSlip` answers.
 *
 * It used to be a bare `boolean` meaning "did payment already reply". It still
 * carries that, unchanged, as `suppress`. The second field exists because the
 * CARD LAYER needs one fact the boolean threw away: the runner stepped aside
 * because this slip already paid and was locked, so the card that answers should
 * say "already used" rather than complain about the recipient or the clock.
 * เดิมเป็น boolean · เพิ่มมาอีกค่าเดียว เพื่อบอกว่า "ถอยเพราะจ่ายไปแล้ว".
 */
interface PaymentForSlipOutcome {
  /** Payment produced its own reply ⇒ do not also send the slip card. */
  suppress: boolean;
  /**
   * A prior slip with this `trans_ref` is locked with `lock_reason:'success'`.
   * True ONLY from `skipped === 'duplicate_after_success'` — one line in the
   * runner, one condition. Never true together with `suppress`.
   */
  lockedDuplicate: boolean;
}

/** Nothing ran: the slip card answers exactly as it did before payment existed. */
const NO_PAYMENT_RUN: PaymentForSlipOutcome = {
  suppress: false,
  lockedDuplicate: false,
};

/**
 * legacy:2172 — the in-memory half of the user lock, module scope so it is
 * shared across every request the way legacy's `const activePromises` is.
 */
const activePromises = new Map<string, Promise<void>>();

@Injectable()
export class WebhookService implements OnModuleInit {
  private readonly logger = new Logger(WebhookService.name);

  /**
   * [FEAT-20260826-STRIKESUSPEND] the suspend gate — "should I stay silent".
   * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
   *
   * ⚠️ A PROPERTY, NOT A CONSTRUCTOR PARAMETER, and that is not a style choice.
   * `docs/strike-plug-in.patch` (24/08) already edits the tail of the
   * constructor; a second parameter beside it makes the two patches overlap, and
   * reverting either one then leaves the other unappliable — which happened, and
   * is how this landed here.
   * สองฟีเจอร์ต้องไม่แก้บรรทัดเดียวกัน ไม่งั้นถอดตัวหนึ่งอีกตัวพัง
   *
   * ⚠️ `@Optional()` as everywhere else: an unbound token leaves this
   * `undefined`, the call site becomes `undefined?.`, and the feature costs
   * nothing — no query, no branch, byte-identical to not having it.
   */
  @Optional()
  @Inject(STRIKE_GATE)
  private readonly strikeGate?: StrikeGate;

  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomType>,
    // ⚠️ Typed loosely on purpose. Every query this pipeline makes against
    //    chat_messages filters on `room_id` values that arrive as `unknown` off
    //    a lean document, and the strict document type rejects them without any
    //    added safety — the schema still validates on write.
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<Record<string, unknown>>,
    @InjectModel(Member.name)
    private readonly memberModel: Model<Record<string, unknown>>,
    @InjectModel(AssignHistory.name)
    private readonly assignHistoryModel: Model<Record<string, unknown>>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<Record<string, unknown>>,
    @InjectModel(ObjectImage.name)
    private readonly objectImageModel: Model<Record<string, unknown>>,
    @InjectModel(ImageStorage.name)
    private readonly imageStorageModel: Model<Record<string, unknown>>,
    private readonly crypto: CryptoService,
    private readonly hookCache: HookCacheService,
    private readonly chatHistory: ChatHistoryService,
    private readonly lineApi: LineApiService,
    private readonly lineContent: LineContentService,
    private readonly webhookLogs: WebhookLogService,
    private readonly externalApi: ExternalApiService,
    private readonly customTool: CustomToolService,
    /* [FEAT-20260821-RATELADDER] the limiter's slot now holds the per-customer
       ladder, which wraps it. Same position, and `consume()` keeps the verdict
       shape, so every spec handing in `{ consume: () => ({ limited: false }) }`
       is untouched. */
    private readonly rateLimit: UserRateLadderService,
    private readonly redis: RedisService,
    @Inject(AI_REPLY_PROVIDER)
    private readonly aiReply: AiReplyProvider,
    @Inject(AI_ASSIST_SUMMARY_PROVIDER)
    private readonly assistSummary: AssistSummaryProvider,
    private readonly systemConfig: SystemConfigService,
    @Inject(channelConfig.KEY)
    private readonly channel: ConfigType<typeof channelConfig>,
    @Inject(aiConfig.KEY)
    private readonly ai: ConfigType<typeof aiConfig>,
    @Inject(integrationConfig.KEY)
    private readonly integration: ConfigType<typeof integrationConfig>,
    // [FIX-20260808-ASSISTTICKETRT] Global realtime publisher — lets an
    // assist-created ticket emit `ticket:new` so it lands on the operator board
    // live, matching the API create path. RealtimeModule is @Global, no import.
    private readonly realtimePublisher: RealtimePublisherService,
    // [FIX-20260808-CUSTREG] Mints the customer-link token the register keyword
    // handler puts in its reply. CustomerLinkModule is imported by webhook.module.
    private readonly customerLink: CustomerLinkService,
    // [FIX-20260808-FLEXBUILDER] The FlexMessage model (card lookup by id/tag)
    // and the dictionary cache (translate) the flex builders + var-map need.
    @InjectModel(FlexMessage.name)
    private readonly flexModel: Model<Record<string, unknown>>,
    private readonly translationDict: TranslationDictCacheService,
    // [FIX-20260808-SLIPFLOW] The ported inbound slip flow. `slipFlow.verifySlip`
    // is the Swiftcheck call (legacy:2818-2943); `qrVision.checkIfSlipWithQrCode` is
    // the Gemini seam the flex branch consults on the VALIDATION_ERROR path
    // (legacy:3660). Both are provided/exported by SlipModule, imported by
    // webhook.module. Injected LAST so existing positional `new WebhookService`
    // test constructions are unaffected.
    private readonly slipFlow: SlipFlowService,
    private readonly qrVision: QrVisionService,
    // [FEAT-20260808-P3CFGINVAL] Registry the AI-category cache subscribes to so
    // a system_configs write invalidates it immediately (not only via the 60s
    // TTL), matching legacy's aiCategoryConfig.invalidate() wired into every
    // config write. Injected LAST + optional so existing positional
    // `new WebhookService(...)` test constructions are unaffected.
    private readonly configCacheInvalidator?: ConfigCacheInvalidator,
    // [FEAT-20260808-PAYTOOL-P3] The topup/walletpay runner + the [ลองใหม่] resume.
    // OPTIONAL and injected LAST for the same reason as the two above: dozens of
    // existing specs build this service positionally, and a required param would
    // break every one of them. Absent ⇒ every payment seam below no-ops, so the
    // slip flow behaves exactly as it did before this feature existed.
    private readonly paymentRunner?: PaymentRunnerService,
    /**
     * [FEAT-20260810-DOCRETRIEVAL] The Training-Document retrieval seam.
     *
     * OPTIONAL and LAST for the same reason `paymentRunner` above is: the
     * existing specs build this service positionally, so a required parameter
     * would break every one of them. Absent ⇒ `docRetrieval` below falls back to
     * the inert provider, which resolves `''` — exactly the value this path
     * produced before the feature existed.
     */
    @Optional()
    @Inject(DOC_RETRIEVAL_PROVIDER)
    private readonly docRetrievalProvider?: DocRetrievalProvider,
    // [FEAT-20260824-STRIKESESSION] OPTIONAL + LAST, like the three above:
    // unbound => `undefined?.` => byte-identical to not having this feature.
    @Optional()
    @Inject(STRIKE_SINK)
    private readonly strike?: StrikeSink,
    /* [FEAT-20260827-PUSHCORE-B] candidate B's sender — the push core's wrapper.
     *
     * OPTIONAL + LAST for the same reason as the four above, and this file says
     * why in its own words at `paymentRunner`: dozens of specs build this service
     * POSITIONALLY, so a required parameter would break every one of them.
     *
     * ⚠️ UNLIKE the four above, absent does NOT mean "feature off". Those seams
     * no-op into the previous behaviour; this one is the only way the payment
     * reply reaches the customer. So `paymentSender()` below refuses loudly
     * instead of silently sending nothing — a wiring mistake on the money path
     * must be an error, never a quiet non-delivery. ไม่ผูก = พังเสียงดัง ห้ามเงียบ. */
    @Optional()
    private readonly linePush?: LinePushDispatcher,
    /* [FEAT-20260829-MENUTAG-S3] the menu engine.
     *
     * OPTIONAL + LAST for the same reason as every seam above: dozens of specs
     * build this service POSITIONALLY, so a required parameter would break all
     * of them. Absent ⇒ the two seats below are skipped entirely and this file
     * behaves byte-identically to not having the feature — the menu adds no
     * branch to any existing path, it only declines to run. */
    @Optional()
    @Inject(MENU_CARD_SOURCE)
    private readonly menuCards?: StoredMenuCardSource,
    /* [FEAT-20260902-MENUPRESSONCE] @Optional so an unwired build still boots —
       the guard then never runs and every press is allowed. */
    @Optional()
    private readonly menuPress?: MenuPressService,
  ) {}

  /**
   * [FEAT-20260729-CUSTOOL] ONE spelling of "which tool does this OA use".
   * Read by the profile fetch on the main path and by the menu seat, which must
   * not decide it a second time — two spellings drift the day a third tool
   * arrives. Behaviour unchanged: every pre-existing hook has
   * `custom_tool_status = false` and takes the else.
   */
  private usesCustomTool(
    hook: Record<string, unknown> | null | undefined,
  ): boolean {
    return hook?.['custom_tool_status'] === true && !!hook?.['custom_tool_id'];
  }

  /**
   * The combined profile payload — the SAME call the main path makes, in the
   * same fork. Extracted so the menu seat can ask for it without restating
   * either half. Timing/logging stays with the caller: the main path measures
   * it, the menu seat does not because it only calls this when a card actually
   * needs variables.
   */
  private loadCombinedProfile(
    userId: string,
    hook: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown>> {
    /* [FEAT-20261016-CUSTCACHE] a customer's message may be answered from the per-customer
       cache — only where the provider declares one (loan); shop-api ignores the option. */
    return this.usesCustomTool(hook)
      ? this.customTool.getCombinedData(userId, hook, { customerCache: 'use' })
      : this.externalApi.getCombinedData(userId, hook);
  }

  /** [FEAT-20260827-PUSHCORE-B] see the constructor note — unbound is a wiring
   *  bug, not a mode. WebhookModule binds it via `LineModule`. */
  private paymentSender(): LinePushDispatcher {
    if (!this.linePush) {
      throw new Error(
        'WebhookService: LinePushDispatcher is not bound — import LineModule in WebhookModule',
      );
    }
    return this.linePush;
  }

  /**
   * ==== [FEAT-20260831-MENUMAINTAG] a stored MENU card, named by its tag ====
   *
   * `[[[menu_main_00001]]]` in an answer means "send THAT card". The card is
   * chosen by the menu module — so the group-ownership rule, the alt-text rule
   * and the button preservation its stored renderer enforces all apply — and the
   * CONTENTS come back here to be sent by the ordinary reply path, which is what
   * keeps the history row, the audit and the reply→push ladder intact.
   *
   * ⚠️ A REFUSAL MUST NOT BECOME A CARD. The renderer answers a refusal with its
   *    fallback menu rather than with null (`stored-card.renderer.ts:142`), and
   *    sending a fallback where the model asked for a specific card would be
   *    worse than sending the plain sentence. The refusal callback therefore sets
   *    a flag for THIS request and the answer drops to null — the caller then
   *    behaves exactly as when a `flex_m` card cannot be built: text only, plus
   *    the rare-event log line.
   * ⚠️ Built per request like the postback seat, and for the same reason: the
   *    access token is decrypted per hook, so a shared engine would hold a stub.
   *
   * revert: delete this method and the `flexKind === 'menu'` branch.
   */
  /**
   * [FIX-20260831-MENUPOSTBACKROW] File the card a menu postback just sent.
   * ==========================================================================
   * Every other outgoing card lands in `chat_messages` because it goes out
   * through the reply path, which files the row on the way. The menu engine
   * sends through its own `coreSend`, so this one reply — the card a customer
   * gets when they press a button — was the only thing the dashboard never
   * showed. Owner 31/08.
   *
   * ⚠️ The row carries the RESOLVED card, the same object handed to LINE, so an
   *    operator reads back exactly what the customer saw and never a raw
   *    `{{...}}`. That is only true because the resolver above runs first.
   * ⚠️ `auto_reply_type: 'flex_menu'` — the same label the image-answer path
   *    files a menu card under, and deliberately NOT `flex_customerhelper`: a
   *    helper label also means "a helper offer went out" and the abandon
   *    lookback reads it.
   * ⚠️ Never throws and never awaited by the send. A history failure must cost
   *    the log line and nothing else.
   *
   * revert: delete this method and the `void` call in the postback seat.
   */
  private async logMenuPostbackCard(
    messages: unknown,
    hook: Record<string, unknown> | null | undefined,
    userId: string,
    channelId: string | undefined,
    /* LINE's answer. No row is written unless it accepted the message — see the
       send site for why writing one first was wrong. */
    lineResponse: Parameters<typeof sentMessageIds>[0],
  ): Promise<void> {
    try {
      const status = (lineResponse as { status?: number } | null | undefined)
        ?.status;
      if (typeof status === 'number' && (status < 200 || status >= 300)) return;
      const first = Array.isArray(messages)
        ? (messages[0] as Record<string, unknown> | undefined)
        : undefined;
      if (!first) return;
      const isFlex = first['type'] === 'flex';
      const alt = typeof first['altText'] === 'string' ? first['altText'] : '';
      await this.chatHistory.logMessage({
        userId,
        senderType: 'bot',
        messageType: isFlex ? 'flex' : 'text',
        content: isFlex
          ? `[Flex] ${alt || 'menu'}`
          : String(first['text'] ?? ''),
        hookId: asString(hook?.['_id']),
        channelType: hook?.['channel_type'] as string | undefined,
        channelId,
        // [FEAT-20260831-QUOTESRC] the same spread every other send site uses
        ...sentMessageIds(lineResponse),
        metadata: {
          auto_reply_type: 'flex_menu',
          ...(isFlex && { flex_json: first['contents'] }),
        },
      });
    } catch (err) {
      this.logger.warn(
        `[MENUPOSTBACKROW] history write failed: ${errText(err)}`,
      );
    }
  }

  /**
   * [FIX-20260831-MENUCARDVARS] Resolve a stored menu card's `{{...}}`.
   * ==========================================================================
   * THE CENTRAL PAIR, NOT A SECOND IMPLEMENTATION. These are the same two calls
   * `tryNoticeGuard`'s `loadCard` makes (see it below), in the same order:
   *
   *     buildFlexVarMaps(doc, profileData, hook, translate)   ← which sources
   *     renderFlexDoc   (doc, vars, '', hook)                 ← the drawing
   *
   * ⚠️ `doc` IS THE CARD ROW. `buildFlexVarMaps` reads `source_roles` off it to
   *    decide which variable sources to build; handed only `content_json` it
   *    falls back to the default source and a card's `{{site_rules.*}}` reach
   *    the customer RAW. That is exactly what shipped at 17:14 and what the
   *    owner caught: `{{site_rules.promo_0_name}}` printed on a promo card.
   * ⚠️ `profileData` IS REQUIRED, not optional dressing: `site_rules`,
   *    `promotion` and `profile` all `pick()` their block out of that payload.
   *    Without it every one of them renders '-' or stays raw.
   * ⚠️ `translate` is closed over exactly as `loadCard` and the flex reply path
   *    do it — one spelling of that call, not three.
   *
   * `getProfile` is a THUNK so the caller decides what a fetch costs: the AI
   * path already holds the payload and hands it over; the postback seat has none
   * yet and fetches only when the card really carries a `{{` (see that seat).
   */
  private menuCardResolver(
    hookBag: Record<string, unknown>,
    getProfile: () => Promise<unknown>,
  ): (card: StoredMenuCard) => Promise<unknown> {
    return async (card) => {
      const doc = card as unknown as Parameters<typeof renderFlexDoc>[0];
      const vars = buildFlexVarMaps(
        doc,
        await getProfile(),
        hookBag,
        (dict, key, opts) =>
          this.translationDict.translate(dict, key as never, opts),
      );
      const drawn = renderFlexDoc(doc, vars, '', hookBag);
      /* [FIX-20260831-MENUPAYLINK] `{{paylink.*}}` is a second grammar with a
         second minter, and a menu card is allowed to carry one — the owner's own
         allow-set for this type permits `{{paylink.contact_admin}}`. It is not
         a variable, so `renderFlexDoc` leaves it alone; unminted it stays in the
         BUTTON'S DATA, which is why pressing that button posted the literal
         string `{{paylink.contact_admin}}` back and filled the ticket chat
         with it. The central minter is the same one the payment card uses.
         ⚠️ AFTER the variable pass and BEFORE `mintButtons`: the minter writes
            real payloads, and no substitution pass may ever walk one. */
      return mintPayLinks(drawn, {}).contents;
    };
  }

  /**
   * [FIX-20260831-MENUCARDVARS] "does this card need variables at all?"
   *
   * The postback seat runs BEFORE the profile fetch on purpose (a button press
   * must not cost quota or an API call). Most menu cards are plain text and
   * buttons, so asking this first keeps that promise for them and pays the one
   * call only for the cards that would otherwise print `{{...}}` at a customer.
   * ไม่มี {{ = ไม่ยิง API เลย.
   */
  private cardNeedsVars(card: StoredMenuCard): boolean {
    try {
      return JSON.stringify(card.content_json ?? '').includes('{{');
    } catch {
      return true; // unreadable ⇒ assume it does; a wasted call beats a raw tag
    }
  }

  private async renderMenuCardByTag(
    tag: string,
    accessToken: string,
    hook: Record<string, unknown> | null | undefined,
    userId: string | null | undefined,
    out: FlexReplyOut,
    /* [FIX-20260831-MENUCARDVARS] the payload this request ALREADY fetched. Not
       optional in practice — without it `{{site_rules.*}}` on the card reach the
       customer raw — but typed loosely because both call sites are inside the
       reply block where it is always in scope. No second fetch happens here. */
    profileData?: unknown,
  ): Promise<Record<string, unknown> | null> {
    if (!this.menuCards || !userId) return null;
    let refused = false;
    try {
      const engine = createMenuEngine({
        // [FIX-20260831-MENUCARDVARS] see menuCardResolver() above — the card
        // ROW and the profile payload, through the central pair.
        resolveCard: this.menuCardResolver(hook ?? {}, () =>
          Promise.resolve(profileData),
        ),
        coreSend: (replyToken, messages) =>
          this.replyViaCore(accessToken, replyToken, messages),
        cards: this.menuCards,
        /* [FEAT-20260902-MENUPRESSONCE] the tag door renders here and the CALLER
           sends, so the stamp has to be applied on this path too — otherwise a
           card summoned by `[[[menu_main_00010]]]` would quietly carry no press
           budget while the same card opened by a button carries one. */
        renderStamp: (card: StoredMenuCard) =>
          card.flex_type === MENU_PRESS_FLEX_TYPE ? mintRenderId() : undefined,
        onCardRefused: (reason, detail) => {
          refused = true;
          this.logger.warn(`[MENUCARDTAG] card refused (${reason}) ${detail}`);
        },
      });
      const message = await engine.renderCardByTag(
        tag,
        buildMenuContext({
          hook: hook ?? {},
          lineUserId: userId,
          member: null,
          siteRules: null,
          /* Silence is enforced upstream long before this line runs — the same
             statement the postback seat makes about itself. */
          silence: NOT_SILENCED,
        }),
      );
      if (!message || refused) return null;
      const contents = (message as Record<string, unknown>)['contents'];
      if (!contents || typeof contents !== 'object') return null;
      /* The history row names the card the operator sees, not the tag. */
      const alt = (message as Record<string, unknown>)['altText'];
      out.name = typeof alt === 'string' ? alt : tag;
      return contents as Record<string, unknown>;
    } catch (err) {
      /* A menu that cannot be drawn must cost the customer the CARD, never the
         answer — the same contract every builder on this path keeps. */
      this.logger.warn(
        `[MENUCARDTAG] ${tag} could not be rendered: ${errText(err)}`,
      );
      return null;
    }
  }


  /* ==== [FEAT-20260828-PUSHCORE-A2] the fourteen direct reply sites ==========
   *
   * These two mirror `LineApiService.sendLineFlexReply` / `sendLineReplyMessage`
   * ARGUMENT FOR ARGUMENT, defaults included ('Bank Transfer Details', a null
   * quickReply). That is deliberate: the fourteen call sites then change by the
   * receiver's NAME ONLY, so a reviewer sees a rename rather than fourteen
   * rewritten calls — and the source-text specs that pin argument ORDER at those
   * sites (refused-helper-flex.spec.ts:68,75) keep pinning the same thing.
   *
   * They throw on refusal, like the senders they replace and for the same reason
   * every candidate before this one needed: the callers write their
   * `status:'success'` webhook_logs row on the line AFTER the send.
   * เปลี่ยนแค่ชื่อคนรับสาย ลำดับอาร์กิวเมนต์ห้ามขยับ
   *
   * revert: rename the fourteen sites back to `this.lineApi.sendLine*` and
   *         delete these two methods.
   */
  private sendFlexReply(
    accessToken: string,
    replyToken: string,
    flexContents: LineFlexContents,
    altText = 'Bank Transfer Details',
    quickReply: LineQuickReply | null = null,
    /* [FEAT-20260830-REPLYPUSH] pass a LINE user id to enable the
       reply → push ladder. Omitted ⇒ byte-identical to today, which is why the
       other thirteen call sites did not have to change. */
    userId?: string | null,
  ): Promise<{ status: number; data?: unknown; via?: 'reply' | 'push' }> {
    return flexReply(
      (req) => this.paymentSender().dispatch(req),
      accessToken,
      replyToken,
      flexContents,
      altText,
      quickReply,
      userId,
    );
  }

  private sendTextReply(
    accessToken: string,
    replyToken: string,
    text: string,
    quickReply: LineQuickReply | null = null,
    /* [FEAT-20260830-REPLYPUSH] see sendFlexReply above. */
    userId?: string | null,
  ): Promise<{ status: number; data?: unknown; via?: 'reply' | 'push' }> {
    return textReply(
      (req) => this.paymentSender().dispatch(req),
      accessToken,
      replyToken,
      text,
      quickReply,
      userId,
    );
  }

  /* [FEAT-20260828-PUSHCORE-G] the reply-through-the-core rule lives in
   * `hook-reply/reply-via-core.ts` — see that file for WHY it throws and why it
   * had to leave this class (two mutations survived the whole radius while it was
   * a private method here, because every harness replaces the collaborator).
   * This wrapper only supplies the dispatcher. */
  private replyViaCore(
    accessToken: string,
    replyToken: string,
    messages: Array<Record<string, unknown>>,
    /**
     * [FIX-20260902-FLEXLADDER] omit ⇒ today's behaviour exactly, which is what
     * keeps every other caller of this method unchanged. Supply a LINE id and a
     * refused reply token is retried as a PUSH, the same ladder `flexReply` and
     * `textReply` already offer.
     *
     * WHY IT WAS NEEDED HERE. The menu POSTBACK seat sends its card through this
     * method, so a refused token lost the menu card outright — and unlike the
     * other seats the failure escaped as a `/webhook error` rather than
     * degrading quietly. Measured 02/09 on the live stack.
     *
     * ⚠️ `replyThenPush` still THROWS when the card did not arrive — no userId,
     *    a refusal a push cannot fix, or both legs failing. Callers that rely on
     *    that throw are unaffected. ⇒ การ์ดไม่ถึงยัง throw เหมือนเดิม
     */
    userId?: string | null,
  ): Promise<{ status: number; data?: unknown }> {
    const send = (req: LineSendRequest) => this.paymentSender().dispatch(req);
    return userId
      ? replyThenPush(send, accessToken, replyToken, userId, messages)
      : replyViaCore(send, accessToken, replyToken, messages);
  }

  /**
   * [FEAT-20260810-DOCRETRIEVAL] The seam, with its no-op stand-in.
   *
   * Resolving here rather than at the call site keeps the reply path free of a
   * null check, and keeps "unbound ⇒ empty context" true in one place instead of
   * at every future caller. ไม่ผูก provider = คืนค่าว่าง = พฤติกรรมเดิม.
   */
  /**
   * [FEAT-20260808-TICKETRTMOVE] The one `ticket:new` emit this service owns.
   *
   * Extracted so the assist path and a system-opened case announce a new ticket
   * in exactly the same shape — the dashboard cannot tell them apart, and there
   * is no second payload to keep in step. Carries `job_status` + `category` so
   * the waiting badge and the chip appear live (legacy payload).
   * ประกาศ ticket ใหม่ที่เดียว · สองเส้นทางส่งรูปเดียวกัน.
   */
  private publishTicketCreated(
    ticketId: unknown,
    hookId: unknown,
    jobStatus: number,
    category: string | null,
  ): void {
    const hid =
      typeof hookId === 'string' ? hookId : (hookId?.toString?.() ?? '');
    if (!hid) return;
    void this.realtimePublisher.publish('ticket:new', {
      _id: ticketId,
      hook_id: hid,
      hook_name: '',
      job_status: jobStatus,
      category: category ?? null,
    });
  }

  private get docRetrieval(): DocRetrievalProvider {
    return this.docRetrievalProvider ?? NO_DOC_RETRIEVAL;
  }

  /**
   * [FEAT-20260808-P3CFGINVAL] Register the AI-category cache for immediate
   * invalidation on any system_configs write. Guarded so a positional test
   * construction without the registry is a no-op rather than a crash.
   */
  onModuleInit(): void {
    this.configCacheInvalidator?.register(() =>
      this.invalidateAiCategoryCache(),
    );
  }

  /**
   * [FEAT-20260808-P3CFGINVAL] Drops the cached AI-category flag so the next
   * `isAiSumCategoryEnabled()` re-reads from the DB — legacy
   * `aiCategoryConfigService.invalidate()` (aiCategoryConfigService.js:60-63).
   */
  invalidateAiCategoryCache(): void {
    this.aiCategoryCache = null;
    this.aiCategoryInFlight = null;
  }

  /**
   * legacy `aiCategoryConfigService.js` — the `acme_category` flag, cached.
   *
   * The webhook consults this on every hand-off, so it must not add a database
   * round-trip to that path. Legacy holds it in memory behind a 60s TTL and a
   * shared in-flight promise so a cold cache under concurrent events issues one
   * query rather than N; both are reproduced here.
   *
   * ⚠️ Default is OFF, and every failure mode resolves to OFF — absent row, DB
   *    error, malformed value. Legacy's comment: "A database blip must not
   *    silently flip behaviour". Defaulting ON would start writing model-chosen
   *    categories on a deployment that never opted in.
   */
  private aiCategoryCache: { value: boolean; at: number } | null = null;
  private aiCategoryInFlight: Promise<boolean> | null = null;

  private async isAiSumCategoryEnabled(): Promise<boolean> {
    const TTL_MS = 60_000;
    if (this.aiCategoryCache && Date.now() - this.aiCategoryCache.at < TTL_MS) {
      return this.aiCategoryCache.value;
    }
    if (!this.aiCategoryInFlight) {
      this.aiCategoryInFlight = this.systemConfig
        .getConfigByKey('acme_category')
        .then((doc) => {
          const v = doc?.['value'];
          // legacy:26-27 — ON only on an explicit truthy flag.
          const enabled =
            v === true ||
            v === 1 ||
            (typeof v === 'string' && v.trim().toLowerCase() === 'true');
          this.aiCategoryCache = { value: enabled, at: Date.now() };
          this.aiCategoryInFlight = null;
          return enabled;
        })
        .catch((err: unknown) => {
          this.logger.error(
            `[AI-CATEGORY] failed to read acme_category, assuming disabled: ${errText(err)}`,
          );
          this.aiCategoryInFlight = null;
          return false;
        });
    }
    return this.aiCategoryInFlight;
  }

  /**
   * The collaborators `runAssistGuarded` needs, assembled in one place so both
   * call sites pass an identical set and a test can swap any one of them.
   */
  private assistDeps(): AssistDeps {
    return {
      chatRoomModel: this.chatRoomModel,
      chatMessageModel: this.chatMessageModel,
      ticketModel: this.ticketModel,
      // [FIX-20260808-FIRSTMSGTICKET] Lets the assist path materialise a Member
      // when the customer's first-ever message triggers assist before any
      // profile sync created one — so the ticket is no longer silently dropped.
      memberModel: this.memberModel,
      summaryProvider: this.assistSummary,
      isAiCategoryEnabled: () => this.isAiSumCategoryEnabled(),
      persistWebhookLog: (entry) => this.wlogEmit(entry),
      // [FIX-20260808-ASSISTTICKETRT] Same `ticket:new` envelope the API create
      // path emits (tickets.service.ts:502), so the FE (useTicketWS) refreshes
      // the board immediately. Fire-and-forget; hook_id scopes it to the OA.
      publishTicketEvent: (ticketId, hookId, jobStatus, category) =>
        this.publishTicketCreated(ticketId, hookId, jobStatus, category),
      logSystemMessage: (a) =>
        this.chatHistory.logSystemMessage({
          memberId: a.memberId as never,
          hookId: a.hookId as never,
          messageType: a.messageType,
          content: a.content,
          metadata: a.metadata,
        }),
    };
  }

  /**
   * [PROG-20260905-LADDER] The ladder's collaborators, bound ONCE for the turn.
   *
   * WHY IT EXISTS, measured rather than felt: 29 collaborator names in
   * `processLockedEvent` are bound more than once — 136 lines, **107 of them redundant
   * repeats** (`log` 17×, `error` 15×, `logMessage` 8×, `warn` 7×). Every extraction so
   * far paid that toll again at its new call site, which is why the method is now ~10%
   * pure wiring. A ladder step takes these from here and its own deps literal carries only
   * what is genuinely particular to it.
   *
   * ⚠️ IT TAKES THE ACCESS TOKEN because the token is decrypted per hook, so it cannot
   * live in a module singleton. Binding it here is exactly what lets the steps stay
   * ignorant of it — the same reason the menu engine is built per request.
   *
   * ⚠️ `logBotMessage` CARRIES ITS CALLER'S TAG. Each site's failure line reads
   * `` `${tag} Log failed: ${e.message}` `` and those strings are what an operator greps
   * for; folding them into one wording would be a silent change to an operational surface.
   */
  private turnDeps(
    ctx: TurnContext,
    assistTurn: () => AssistTurnArgs,
  ): TurnDeps {
    const { accessToken, channelId } = ctx.creds;
    const logContext = ctx.logContext;
    return {
      log: (m) => this.logger.log(m),
      warn: (m) => this.logger.warn(m),
      error: (m) => this.logger.error(m),
      sendTextReply: (replyToken, text) =>
        this.sendTextReply(accessToken, replyToken, text),
      emitWlog: (row) => this.wlogEmit(row as never),
      logBotMessage: (row, tag) => {
        void this.chatHistory
          .logMessage(row as never)
          .catch((e: Error) =>
            this.logger.error(`${tag} Log failed: ${e.message}`),
          );
      },
      logMessageAwaited: (row) =>
        this.chatHistory.logMessage(row as never),
      // [FEAT-20261026-RAGENGINE] retrieveContext when the provider has it, else retrieve()
      retrieveDoc: (a) => retrieveDocContext(this.docRetrieval, a as never),
      assemblePrompt: (input) =>
        assemblePrompt(input, {
          logger: {
            log: (m) => this.logger.log(m),
            error: (m) => this.logger.error(m),
          },
          chatRoomModel: this.chatRoomModel as never,
          chatMessageModel: this.chatMessageModel as never,
        }),
      generateAiReply: (request) =>
        this.aiReply.generate(request as never),
      replyApiErrorRefusal: (input) =>
        replyApiErrorRefusal(
          {
            ...input,
            accessToken,
            channelId,
            logContext,
          },
          {
            logger: {
              log: (m) => this.logger.log(m),
              error: (m) => this.logger.error(m),
            },
            resolveHookTextReply: (i) =>
              resolveHookTextReply(i as never),
            resolveHookTextReplyMode: (h) =>
              resolveHookTextReplyMode(h),
            /* Bound rather than wrapped: these keep their own signatures, and the
               handler's deps type is deliberately loose so this file stays the only
               place that knows the service's shapes. */
            buildHookHelperFlexFor: this.buildHookHelperFlexFor.bind(
              this,
            ) as never,
            stampIfHelperCardDelivered:
              this.stampIfHelperCardDelivered.bind(this) as never,
            sendFlexReply: this.sendFlexReply.bind(this) as never,
            sendTextReply: this.sendTextReply.bind(this) as never,
            sentMessageIds: (response) => ({
              ...sentMessageIds(response as never),
            }),
            wlogEmit: (row) => this.wlogEmit(row as never),
            chatHistory: {
              logMessage: (row) => this.chatHistory.logMessage(row as never),
            },
          },
        ),
      notifyTelegramNoAnswer: (input) =>
        notifyTelegramNoAnswer(input as never, {
          lineApi: this.lineApi,
          logger: {
            log: (m) => this.logger.log(m),
            warn: (m) => this.logger.warn(m),
            error: (m) => this.logger.error(m),
          },
          wlogEmit: (row) => this.wlogEmit(row as never),
        }),
      /* ⚠️ THE ARROW IS THE CONTRACT. `assistTurn()` is CALLED here, at the moment the
         step runs — nine of its nineteen fields come from `let`s the turn reassigns, and
         a pre-built object would freeze them. See `assist/assist-turn-args.ts`. */
      runAssist: (siteArgs) =>
        runAssistGuarded(
          { ...assistTurn(), ...siteArgs } as never,
          this.assistDeps(),
        ),
      /* ⚠️ `openAdminCase` and `runFollowUpFlow` CANNOT be bound here. Both are closures
         declared INSIDE the big `if (userId)` block — they do not exist at this line, and
         hoisting them would mean hoisting everything they close over. The customer slice
         supplies the real ones, spread over this object, where they are real.

         They are stubbed rather than left out so `TurnDeps` stays complete: a step that
         reached one of them outside that slice would otherwise get `undefined` and fail as
         "not a function" three frames away from the cause. This says the cause. */
      /* [PROG-20260905-LADDER] one body, two doors — bound ONCE here rather than as a
         closure inside the block. Every input it needs is on the context now, which is
         exactly what the context lift bought: `inboundRoom` was the reason the doors could
         not sit further up, and it travels with the turn. The order it guarantees — reply,
         then history row, then case, and the case opens even if the reply failed — lives in
         `ticket/open-admin-case.ts`, next to the code that keeps it. */
      openAdminCase: (displayed) =>
        openAdminCase(
          displayed,
          {
            userId: ctx.userId,
            hook: ctx.hook,
            accessToken,
            replyToken: ctx.event.replyToken,
            channelId,
            postbackData: ctx.event.postback?.data,
            eventId: ctx.event.eventId,
            logContext,
            inboundRoom: ctx.inboundRoom,
          },
          {
            logger: {
              log: (m: string) => this.logger.log(m),
              warn: (m: string) => this.logger.warn(m),
              error: (m: string) => this.logger.error(m),
            },
            chatRoomModel: this.chatRoomModel,
            chatMessageModel: this.chatMessageModel,
            ticketModel: this.ticketModel,
            assignHistoryModel: this.assignHistoryModel,
            chatHistory: {
              logMessage: (row: unknown) =>
                this.chatHistory.logMessage(row as never),
            },
            sendTextReply: (...a: unknown[]) =>
              this.sendTextReply(...(a as [string, string, string])),
            publishTicketCreated: (...a: unknown[]) =>
              this.publishTicketCreated(
                ...(a as Parameters<WebhookService['publishTicketCreated']>),
              ),
          },
        ),
      runFollowUpFlow: () => {
        throw new Error(
          '[LADDER] runFollowUpFlow is only available inside the customer slice — it is a ' +
            'closure declared inside `if (userId)` and does not exist before it',
        );
      },
      tryNoticeGuard: (input) =>
        this.tryNoticeGuard({
          ...input,
          accessToken,
          channelId,
        } as never),
      handleCustomerRegister: () =>
        handleCustomerRegisterKeyword(
          {
            /* Read off the CONTEXT, not off the method's locals — which is what lets this
               one stay hoisted while its two neighbours cannot. */
            userId: ctx.userId,
            hook: ctx.hook,
            event: ctx.event as unknown as CustomerRegisterEvent,
            accessToken,
            logContext,
            channelId,
          },
          {
            memberModel: this.memberModel,
            mintLinkToken: (i) => this.customerLink.mintLinkToken(i),
            // [FEAT-20260828-PUSHCORE-G] through the core; same shape back.
            sendLineReplyMessage: (t, r, txt) =>
              this.replyViaCore(t, r, [buildReplyTextMessage(txt)]),
            sendLineFlexReply: (t, r, f, alt) =>
              this.replyViaCore(t, r, [buildReplyFlexMessage(f, alt)]),
            persistWebhookLog: (entry) => this.wlogEmit(entry),
            logMessage: (input) => this.chatHistory.logMessage(input as never),
          },
        ),
      runPaymentForSlip: (input) =>
        this.runPaymentForSlip({ ...input, accessToken } as never),
      handleSlipFlex: (input) =>
        handleSlipFlex({ ...input, accessToken } as never, {
          findFlexById: (id) =>
            this.flexModel.findById(id).lean<Record<string, unknown>>().exec(),
          /* [FEAT-20260828-PUSHCORE-A1] through the core. `replyViaCore` keeps the THROW
             the slip flow depends on: the send sits inside the handler's outer try/catch,
             which logs and lets the flow continue. Without a throw a refused card would
             fall through as if it had been delivered. */
          /* [FEAT-20260906-SLIPPUSH] `ctx.userId` LAST turns this into a reply-then-push
             ladder — without it a slip card answered on an already-expired token was
             simply lost. Kept on ONE line: this file is in `.prettierignore` and the
             ratchet counts CODE lines, so wrapping the arguments would have cost +8 and
             a file-ceiling raise for a one-argument fix. ไม่ขึ้นบรรทัดใหม่ = ไม่ต้องยกเพดาน */
          sendLineFlexReply: (t, r, f, alt, qr) =>
            slipFlexReply((req) => this.paymentSender().dispatch(req), t, r, f, alt, qr, ctx.userId),
          persistWebhookLog: (entry) => this.wlogEmit(entry),
          logMessage: (i) => this.chatHistory.logMessage(i as never),
          // The one billed seam — a mocked boolean in tests.
          checkQrCode: (url, key) => this.qrVision.checkIfSlipWithQrCode(url, key),
          formatThaiDateTime: (d) => formatThaiDateTime(d),
          lineReplyEndpoint: LINE_REPLY_ENDPOINT,
        }) as never,
      handleSlipCallback: (input) => {
        void this.slipFlow
          .handleSlipCallback(input as never)
          .catch((e: unknown) =>
            this.logger.error(`[CALLBACK-TRIGGER] Error: ${errText(e)}`),
          );
      },
      replyMissingProfileData: () =>
        replyMissingProfileData(
          {
            hook: ctx.hook,
            accessToken,
            userId: ctx.userId,
            channelId,
            replyToken: ctx.event.replyToken,
            sourceUserId: ctx.event.source?.userId,
            eventId: ctx.event.eventId,
            logContext,
          },
          {
            logger: {
              log: (m: string) => this.logger.log(m),
              error: (m: string) => this.logger.error(m),
            },
            resolveHookTextReply: (i: unknown) =>
              resolveHookTextReply(i as never),
            resolveHookTextReplyMode: (h: unknown) =>
              resolveHookTextReplyMode(h as never),
            /* Bound rather than wrapped, exactly as the sibling api-error site does it:
               these keep their own signatures, and the handler's deps type is deliberately
               loose so this file stays the only place that knows the service's shapes. */
            buildHookHelperFlexFor: this.buildHookHelperFlexFor.bind(this) as never,
            stampIfHelperCardDelivered:
              this.stampIfHelperCardDelivered.bind(this) as never,
            sendFlexReply: this.sendFlexReply.bind(this) as never,
            sendTextReply: this.sendTextReply.bind(this) as never,
            sentMessageIds: (r: unknown) => ({ ...sentMessageIds(r as never) }),
            wlogEmit: (row: unknown) => this.wlogEmit(row as never),
            chatHistory: {
              logMessage: (row: unknown) =>
                this.chatHistory.logMessage(row as never),
            },
          },
        ),
      /* `runAssistBypass` — the eleven collaborators bound once. The INPUT is built by
         the step from the context, so its `reads` declaration stays honest. */
      runAssistBypass: (input) =>
        runAssistBypass(input as never, {
          logger: {
            log: (m: string) => this.logger.log(m),
            warn: (m: string) => this.logger.warn(m),
            error: (m: string) => this.logger.error(m),
          },
          chatHistory: {
            logMessage: (row: unknown) =>
              this.chatHistory.logMessage(row as never),
          },
          customerLink: this.customerLink as never,
          flexModel: this.flexModel as never,
          memberModel: this.memberModel as never,
          paymentSender: () => this.paymentSender() as never,
          qrVision: this.qrVision as never,
          replyViaCore: (t: string, r: string, m: unknown) =>
            this.replyViaCore(t, r, m as never) as never,
          runPaymentForSlip: (i: unknown) =>
            this.runPaymentForSlip(i as never) as never,
          slipFlow: this.slipFlow as never,
          wlogEmit: (row: unknown) => this.wlogEmit(row as never),
        } as never),
      /* ── the image lane ─────────────────────────────────────────────────── */
      downloadImage: (messageId) =>
        this.lineContent.downloadAndSaveImage(messageId, accessToken),
      /* ⚠️ THE CATCH IS HERE, NOT IN THE STEP, and it is load-bearing: a failed read must
         not cost the customer their reply — the image is already stored and already paid
         for. Keeping it at the binding means a second caller cannot reintroduce the throw,
         and the failure line stays the one operators grep (`[ImageDownload] Storage
         retrieval failed`). */
      readImageStorage: async (storageId) => {
        try {
          return await this.imageStorageModel
            .findById(storageId)
            .lean<Record<string, unknown>>()
            .exec();
        } catch (err) {
          this.logger.error(
            `[ImageDownload] Storage retrieval failed: ${errText(err)}`,
          );
          return null;
        }
      },
      shouldSkipSlipVerify: (input) => shouldSkipSlipVerify(input),
      /* ── the helper-card doors ────────────────────────────────────────────
         ⚠️ `buildHookHelperFlexFor` KEEPS THE SERVICE METHOD'S NAME. `helper-stamp-doors.
         spec.ts` counts the four doors by matching `this.buildHookHelperFlexFor(` OR
         `deps.buildHookHelperFlexFor(`; a shorter dep name once made that census read a
         door that had MOVED as a door that had been DELETED. */
      buildHookHelperFlexFor: (raw, mode) =>
        this.buildHookHelperFlexFor(raw, ctx.hook, ctx.event.source?.userId, mode),
      /* [FEAT-20260907-UNKNOWNPROFILEREVIEW] the SAME lookup `sendPaymentReply`
         hands `resolveStateFlex` below, bound once for the turn. Two bindings of
         one query would let a state's card be resolved two ways. */
      findFlexById: (id) => this.flexModel.findById(id).lean<never>().exec(),
      sendFlexReply: (replyToken, card, altText, uid) =>
        this.sendFlexReply(accessToken, replyToken, card, altText, null, uid),
      stampIfHelperCardDelivered: (card, uid, status) =>
        this.stampIfHelperCardDelivered(card, uid, status),
      /* Returns the promise UNCAUGHT on purpose — the `[SUPPRESSEDCHECK]` failure line
         belongs to the site that writes the row, not to this binding. */
      logSystemMessage: (row) => this.chatHistory.logSystemMessage(row as never),
      validateSignature: (body, signature, secret) =>
        this.validateSignature(body, signature, secret),
      ensureRoom: (input) =>
        ensureRoomOnEvent(
          {
            getOrCreateRoom: (u, p, c, h, t) =>
              this.chatHistory.getOrCreateRoom(u, p, c, h, t),
            logError: (m) => this.logger.error(m),
          },
          input as never,
        ),
      replyWithTaggedImages: (input) =>
        replyWithTaggedImages(
          { ...input, accessToken } as never,
          {
            objectImageModel: this.objectImageModel as never,
            imageStorageModel: this.imageStorageModel as never,
            wlogEmit: (row) => this.wlogEmit(row as never),
            logger: {
              log: (m) => this.logger.log(m),
              error: (m) => this.logger.error(m),
            },
          },
        ),
      /* [PROG-20260905-LADDER] the send, bound once for the turn like every other
         collaborator. Its deps were a 37-line literal at the call site — the exact
         shape the wiring measurement counted. */
      sendAiReply: (input) =>
        sendAiReply(input as never, {
          log: (m) => this.logger.log(m),
          warn: (m) => this.logger.warn(m),
          error: (m) => this.logger.error(m),
          errText,
          mintLinkToken: (a) => this.customerLink.mintLinkToken(a),
          findFlexById: (id) =>
            this.flexModel
              .findById(String(id))
              .lean<Record<string, unknown>>()
              .exec(),
          sendFlexReply: (replyToken, contents, altText, quickReply, uid) =>
            this.sendFlexReply(
              accessToken,
              replyToken,
              contents,
              altText,
              quickReply as never,
              uid,
            ),
          sendTextReply: (replyToken, t, quickReply, uid) =>
            this.sendTextReply(
              accessToken,
              replyToken,
              t,
              quickReply as never,
              uid,
            ),
          emitWlog: (row) => this.wlogEmit(row as never),
          /* Passed unwrapped now that the handler's deps are typed structurally rather
             than as `never`: tsc checks that these models really have the methods the
             handler calls, which is the point of a deps interface. */
          memberModel: this.memberModel,
          chatMessageModel: this.chatMessageModel,
          chatRoomModel: this.chatRoomModel,
          realtimePublisher: this.realtimePublisher,
        }),
    };
  }

  /**
   * [FEAT-20260815-WLOGDOOR] The ONE door out, built lazily from the sink this
   * service already holds — so the positional constructor that dozens of specs
   * build by hand gains no parameter and nothing rewires. ประตูเดียว ไม่แตะ constructor.
   */
  private wlogDoor?: WebhookLogEmitter;

  /**
   * [FEAT-20260815-WLOGDOOR] The ONLY way a webhook_logs row leaves this service.
   *
   * `persistWebhookLog` retired once the last site moved across; its swallow and
   * its exact error string live in the catch below, so a failed audit write still
   * cannot take a customer's reply down. The gain is the compiler:
   * `action_type` / `channel` / `method` are required and `channel` and `status`
   * are unions, so a typo is a build error rather than a row nobody can filter
   * for — which is how two audit rows were lost silently this month.
   *
   * ⚠️ The handler files still receive this as a dep NAMED `persistWebhookLog`
   * (assist, customer-register, slip-flex, ticket-upgrade). That name is their
   * public contract; only the implementation behind it changed.
   *
   * revert: restore the old `persistWebhookLog` method from git history and point
   *         the six dep wirings back at it.
   */
  private async wlogEmit(event: WebhookLogEvent): Promise<void> {
    try {
      this.wlogDoor ??= new WebhookLogEmitter(this.webhookLogs);
      await this.wlogDoor.write(event);
    } catch (err) {
      // The swallow moved here verbatim when `persistWebhookLog` retired: same
      // logger, same message, same guarantee that a failed log write can never
      // take the reply path down. Keep the string — greps and runbooks use it.
      this.logger.error(`Webhook log persist failed: ${errText(err)}`);
    }
  }

  /**
   * [FEAT-20260824-SLIPRATEPEEK] Should the PAID slip verification be skipped
   * because this customer is already over their rate window?
   *
   * WHAT IT FIXES: the Swiftcheck call sits ~600 lines above the limiter, and every
   * branch of the limited path RETURNS before the slip card is built or payment
   * runs. So for a customer who is already over quota the verification was
   * bought and then thrown away — the customer saw exactly the same thing either
   * way. This asks the counter first and skips the purchase. Nothing the
   * customer sees changes; only the bill does.
   *
   * ⚠️ `assisted` IS LOAD-BEARING, NOT A CONVENIENCE. While an admin holds the
   * room the main limiter is never reached at all (see the note at
   * `[FIX-20260729-CUSTREGASSIST]`: "the real limiter below is unreachable"), so
   * the counter is frozen at whatever it held when the operator took over. A
   * customer who tripped the limit one second before an admin picked up would
   * peek as "limited" forever, and their slip would go unverified inside a live
   * human conversation — directly against the rule at the assist payment site
   * ("a slip uploaded mid-operator-chat must still be CREDITED"). So an assisted
   * room never asks. ห้องที่คนคุยอยู่ = ไม่ถามเลย ตรวจเหมือนเดิมทุกใบ.
   *
   * ⚠️ READ-ONLY. `peek` performs no INCR and adds no strike, so the counter
   * still moves in exactly one place — the block that says of itself "THIS BLOCK
   * MUST EXIST EXACTLY ONCE".
   *
   * The log line is the only way this shows up in production: a skipped purchase
   * leaves no other trace, and "we saved money" must be countable.
   *
   * revert: delete this method and the one conjunct that calls it. The verify
   *         condition returns to its three original terms.
   */
  private async slipVerifyBlockedByRate(
    userId: string | undefined,
    messageType: string | null | undefined,
    assisted: boolean,
  ): Promise<boolean> {
    if (assisted || !userId) return false;

    const v = await this.rateLimit.peek(userId, messageType);
    if (v.limited) {
      this.logger.log(
        `[SLIPRATEPEEK] user=${userId} already over quota at level ${v.level} ` +
          `(${String(v.current)}/${v.limit}) — paid slip verification skipped. ` +
          `The limiter below answers exactly as it does today.`,
      );
    }
    return v.limited;
  }

  /** legacy `buildErrorPayload` — what the error rows carry about the request. */
  private buildErrorPayload(
    meta: WebhookRequestMeta,
    eventId: string | undefined,
  ): Record<string, unknown> {
    return {
      method: meta.method,
      endpoint: meta.originalUrl,
      ip: meta.ip,
      user_agent: meta.userAgent,
      event_id: eventId,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // legacy:2174 — withUserLock
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Serialise processing per customer.
   *
   * ⚠️⚠️ `actionFn` RUNS EVEN WHEN THE LOCK IS NOT ACQUIRED. After
   *    `maxWaitTimeMs` the loop simply exits and the work proceeds unlocked.
   *    This is a stampede damper, not mutual exclusion, and the comment at
   *    legacy:2186 says so: the hard guarantee lives in an atomic claim further
   *    down (`triggerAssistNotification`), and this is "the second layer, so it
   *    does not reach that point in the first place".
   *
   * ⚠️ 90s, not 45s. On 2026-07-27 a 45s lock expired mid-request; the customer
   *    messaged again at 60s, two requests ran concurrently on one user, and a
   *    duplicate ticket was created. The worst-case budget is a 30s model call +
   *    25s assist + 15s LINE ≈ 70s, so the lock has to outlive it. The cost of
   *    the change is stated in legacy too: a process that dies holding the lock
   *    strands that user for 90s instead of 45s.
   *
   * ⚠️ The in-memory fallback's wait on the PREVIOUS promise is capped by
   *    `Promise.race` with a `maxWaitTimeMs` timer. Waiting uncapped is what
   *    turned one stalled request (986s, observed) into a queue of stalled
   *    requests behind it.
   *
   * ⚠️ Release is compare-and-delete: read the value back and only `DEL` if it
   *    is still ours, so a request whose lock already expired cannot delete the
   *    lock a later request now holds.
   */
  private async withUserLock<T>(
    userId: string | undefined,
    actionFn: () => Promise<T>,
  ): Promise<T> {
    if (!userId) {
      return await actionFn();
    }

    let redisAcquired = false;
    const redisLockKey = `lock:webhook:user:${userId}`;
    const redisLockValue = `${Date.now()}_${Math.random()}`;
    // [FIX-20260728-LOCK] เดิม 45000 — สั้นกว่างานที่มันคุมจริง
    const lockTimeoutMs = 90000;
    const maxWaitTimeMs = 25000;
    const retryIntervalMs = 150;
    /**
     * [PERF-20260824-LOCKBACKOFF] The gap between attempts grows instead of
     * staying at 150 ms.
     *
     * WHAT WAS WRONG: the wait is up to 25 s and the gap was fixed, so one
     * request waiting behind another from the same customer issued up to
     * ~166 `SET NX` round-trips to Redis doing nothing but asking again. Under a
     * burst from one user that is O(N × 166) commands spent on polling.
     *
     * WHAT IS UNCHANGED — and this is the part that matters: the loop condition,
     * `maxWaitTimeMs`, `lockTimeoutMs`, every `break`, and what happens when the
     * wait expires. The total window a caller can wait is exactly what it was;
     * `lock-wait-vs-stale-budget.spec.ts` reads those two constants out of this
     * source and must stay green untouched.
     *
     * WHAT IT COSTS, stated plainly: a waiter now notices a released lock within
     * `retryMaxIntervalMs` rather than within 150 ms. That is up to ~850 ms of
     * extra latency, and ONLY for the second message of a customer whose first
     * one is still being processed — a path that is already seconds long because
     * it contains a model call. The trade is ~6× fewer Redis commands for that.
     * รอสูงสุดเท่าเดิม · แค่ถามถี่น้อยลง · จังหวะรู้ว่าว่างช้าลงได้ถึง ~0.85 วิ.
     *
     * revert: delete these two constants and put `retryIntervalMs` back as the
     *         sole argument of the `setTimeout` at the bottom of the loop.
     */
    const retryMaxIntervalMs = 1000;
    const retryBackoffFactor = 1.5;

    let client: ReturnType<RedisService['getClient']> | null = null;
    try {
      client = this.redis.getClient();
    } catch (err) {
      this.logger.warn(
        `[LOCK] Redis not available, using In-Memory lock: ${errText(err)}`,
      );
    }

    const startTime = Date.now();
    // [PERF-20260824-LOCKBACKOFF] starts at the old fixed value, so the FIRST
    // retry is timed exactly as it was before this change.
    let retryWaitMs = retryIntervalMs;
    while (Date.now() - startTime < maxWaitTimeMs) {
      if (client) {
        try {
          // ioredis spells legacy's `{ NX: true, PX: ms }` as positional args.
          const result = await client.set(
            redisLockKey,
            redisLockValue,
            'PX',
            lockTimeoutMs,
            'NX',
          );
          if (result === 'OK') {
            redisAcquired = true;
            break;
          }
        } catch (err) {
          this.logger.warn(
            `[LOCK] Redis set failed, falling back to In-Memory: ${errText(err)}`,
          );
          client = null;
        }
      }

      if (!client) {
        if (!activePromises.has(userId)) break;
      }

      await new Promise((resolve) => setTimeout(resolve, retryWaitMs));
      // [PERF-20260824-LOCKBACKOFF] grow, then hold at the ceiling. The while
      // condition above still owns when the waiting stops.
      retryWaitMs = Math.min(
        Math.round(retryWaitMs * retryBackoffFactor),
        retryMaxIntervalMs,
      );
    }

    let inMemoryResolve: (() => void) | null = null;
    let p: Promise<void> | null = null;
    if (!redisAcquired) {
      p = new Promise<void>((resolve) => {
        inMemoryResolve = resolve;
      });
      const previous = activePromises.get(userId);
      if (previous) {
        let waitTimer: NodeJS.Timeout | null = null;
        try {
          await Promise.race([
            previous,
            new Promise<void>((resolve) => {
              waitTimer = setTimeout(resolve, maxWaitTimeMs);
            }),
          ]);
        } catch {
          /* ตัวก่อนหน้าพัง ไม่ใช่เรื่องของเรา เดินต่อ */
        } finally {
          if (waitTimer) clearTimeout(waitTimer);
        }
      }
      activePromises.set(userId, p);
    }

    try {
      return await actionFn();
    } finally {
      try {
        if (redisAcquired && client) {
          const currentVal = await client.get(redisLockKey);
          if (currentVal === redisLockValue) {
            await client.del(redisLockKey);
          }
        }
      } catch (err) {
        this.logger.error(
          `[LOCK] Failed to release Redis lock: ${errText(err)}`,
        );
      } finally {
        if (inMemoryResolve) {
          (inMemoryResolve as () => void)();
          if (activePromises.get(userId) === p) {
            activePromises.delete(userId);
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // legacy:2320 — _processWebhook
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Background processing for one LINE delivery.
   *
   * ⚠️ [FEAT-20260905-MULTIEVENT] THIS IS THE ONLY PLACE THE EVENT ARRAY IS UNPACKED.
   *    Legacy read `req.body.events?.[0]` at 2321 and again at 2479 and never iterated;
   *    every later event in a batched delivery was discarded without a trace. The port
   *    reproduced that on purpose. It now runs each event through `runDeliveryEvents`,
   *    sequentially and in array order, and the WHOLE difference is one switch:
   *    `WEBHOOK_MULTI_EVENT=off` (the default) selects a one-event prefix and hands
   *    iteration 0 the original body — the same two calls with the same arguments legacy
   *    made, so nothing about a single-event delivery changes. Anything dropped is now
   *    said out loud in either mode. See `event-iteration/` for why sequential, why the
   *    cap is code-owned, and why iteration 0 must not get a copy of the body.
   *
   * ⚠️ The empty-delivery return below stays FIRST, byte-identical. LINE's "Verify"
   *    button posts `events: []`, and that return precedes the lock and every log row —
   *    an empty delivery must keep having zero side effects.
   *
   * ⚠️ There is no HTTP surface here. The controller has already answered
   *    200 "OK"; legacy hands `_processWebhook` a mock `res` whose `status`,
   *    `send`, `json` and `end` all return `this`. Every `res.status(404)` and
   *    `res.status(500)` inside the legacy body is therefore INVISIBLE — the
   *    caller always saw 200. Those sites are plain `return`s here, and the
   *    status they would have "sent" is recorded in the log line instead.
   */
  async processWebhook(
    body: Record<string, unknown>,
    hook: HookLike | undefined,
    hookSource: string | undefined,
    alias: string | undefined,
    meta: WebhookRequestMeta,
  ): Promise<void> {
    const events = body['events'] as LineEvent[] | undefined;
    const firstEvent = events?.[0];
    // legacy:2321-2322 — before the lock, before the signature re-check.
    if (!firstEvent) return;

    await runDeliveryEvents(
      { body, events, multiEvent: this.channel.multiEventDelivery },
      {
        warn: (message) => this.logger.warn(message),
        // The lock is taken per event, on THAT event's user: one acquisition could not
        // outlive its 90s TTL across a batch, and a mixed-user delivery would otherwise
        // run every event under the first user's key.
        run: (event, eventBody, index) =>
          this.withUserLock(event.source?.userId, () =>
            this.processLockedEvent(eventBody, event, hook, hookSource, alias, meta, {
              suppressDeliveryRow: index > 0,
            }),
          ),
      },
    );
  }

  /**
   * Everything legacy runs inside `withUserLock`'s `actionFn` (2326-4969).
   *
   * `opts` is the ONLY thing the multi-event loop tells this method about the batch it
   * belongs to, and it carries exactly one fact: whether the `incoming_line_webhook` row
   * has already been written for this delivery. Absent (every caller before the loop
   * existed, and the loop's own first iteration) means "write it" — so the default is
   * byte-identical to the behaviour that had no parameter at all.
   */
  private async processLockedEvent(
    body: Record<string, unknown>,
    event: LineEvent,
    hookIn: HookLike | undefined,
    hookSourceIn: string | undefined,
    alias: string | undefined,
    meta: WebhookRequestMeta,
    opts?: { suppressDeliveryRow?: boolean },
  ): Promise<void> {
    /* ═══════════════════════════════════════════════════════════════════════
       🔌 [PROG-20260905-FROZEN] THE TEN PLACES IN THIS METHOD THAT CANNOT MOVE.
       ═══════════════════════════════════════════════════════════════════════
       Written HERE, once, rather than as ten comments beside the boxes themselves — a
       comment inserted into a hunk's context sequence is exactly what stops the patch
       locating, so the safe place to describe them is a patch-free line at the top.
       รวมไว้ที่เดียว เพราะไปเขียนติดกล่องคือทำให้ patch พัง

       Three `docs/*-plug-in.patch` files are the OFF SWITCHES for three features. They
       add lines and delete none, so `git apply -R` returns the tree byte-identical, and
       `git apply` puts it back. They locate by CONTENT, not by line number — which is why
       thirty save points of surgery never broke them, and why the bytes they quote are
       frozen: edit or move one and the switch stops working, silently.

       Measured 05/09 by matching each hunk's full line SEQUENCE against this file:

         menu-plug-in.patch          6 hunks here · 229 CODE · the menu engine
         strike-plug-in.patch        3 hunks here ·   9 CODE · strike tracking
         strike-suspend-plug-in.patch 1 hunk here ·   8 CODE · the suspend gate

       ⚠️ WHAT THIS MEANS BEFORE YOU CUT ANYTHING. Run
       `python3 z-test/tools/cut-preflight.py <from> <to>` FIRST. It refuses a span that
       carries patch bytes, and it also refuses one whose extraction would ORPHAN an
       import that is itself a patch context byte — the trap that makes the paid slip
       verify and the payment postback permanently un-cuttable. Both were tried; both were
       refused with the patch line quoted.

       ⚠️ A BOX FREEZES ITS ENCLOSING SYNTAX TOO. Where one sits inside an expression, the
       whole expression is frozen; an expression cannot be cut in half. That is why the
       gate ladder is in slices — the slices are the gaps BETWEEN the boxes, not a design
       preference.

       ✅ PHASE 5 — regenerating the patches so these bytes stop being frozen — IS CLOSED,
       not deferred. The owner declined it on 05/09, and the dive that followed agreed:
       the reduction program projected ~1,040-1,100 CODE (61-63%) AFTER Phase 5 and this
       method is already at 923 (67.4%) WITHOUT it, while the program's own correction #2
       records that its headline goal is not expressible — the spine must statically
       import the handler, and that import cannot compile in the plug-OFF state, so the
       call site and the import stay hunks either way. Only ONE of the ten boxes holds a
       real body worth extracting (the menu seat, ~144 CODE); the other nine are seats and
       read-only taps of 3-18 CODE, where moving relocates a literal and buys nothing.
       Reopening needs a NEW reason, and the full accounting is in
       `docs/flow/webhook-flow-and-gates.md` §6.
       ปิดแล้วด้วยตัวเลข ไม่ใช่เพราะขี้เกียจ — จะรื้อใหม่ต้องมีเหตุผลใหม่ */
    // [PERF-20260802-TIMING] stage timing — log only, never affects flow.
    const perfT0 = Date.now();
    let perfProfileMs = 0;

    let hook: HookLike | undefined = hookIn;
    let hookSource: string | undefined = hookSourceIn;
    let userId = event.source?.userId;
    let docId: string | undefined;
    let logContext: Record<string, unknown> = {};

    /**
     * legacy:2435 + 2440-2452 — `forceReAssistAfterReply`.
     *
     * ⚠️⚠️ Legacy implements this by MONKEY-PATCHING `res.send` on the mock
     *    response. Every terminal in the function ends in `res.send(...)` or
     *    `res.status(n).send(...)` — and `res.status()` returns the mock, so the
     *    patched `send` runs on those too. The effect is: re-assist fires on
     *    EVERY terminal return, not only the one that answered the customer.
     *
     *    There is no `res` here, so the equivalent is a `try/finally` around the
     *    whole terminal body, installed at the point legacy installs the patch —
     *    after alias/404 resolution, before the signature re-check — and inside
     *    the lock but OUTSIDE the big try/catch, so legacy's outer catch
     *    (4950-4967, which also calls the patched `send`) is covered.
     *
     *    Exactly one terminal fires per request, so one `finally` reproduces the
     *    patch exactly. The four terminals easiest to miss, all covered:
     *      · 3851 the image_answer_text send THREW and legacy answered
     *             status(500) — `.status()` returns the mock, so `send` still ran
     *      · 4717 nothing was sent at all (empty reply, no flex)
     *      · 4737 the reply was suppressed as stale
     *      · 4967 the outer catch
     */
    let forceReAssistAfterReply = false;
    // [FEAT-20260729-AUTOTICKET] the threshold that fired, so the ticket created
    // later in this same request can name it in its divider. null on every path
    // where the timeout did not trigger — that null is what suppresses it.
    let autoUnassistTriggeredMinutes: number | null = null;

    try {
      /* ===============================================================
         0) Resolve Hook by Alias — legacy:2334-2378
      =============================================================== */
      if (!hook && alias) {
        const resolved = await this.hookCache.getHookByAliasWithSource(alias);
        hook = resolved.hook ?? undefined;
        hookSource = resolved.source ?? undefined;
      }

      // legacy:2346 — the raw inbound payload, logged fire-and-forget. NOT
      // awaited: a slow log must not delay the reply. The row itself is built in
      // `logging/incoming-delivery-row.ts`, beside the two rows the reply
      // produces; the `void` stays here because WHEN it is written is the
      // spine's contract. Key order is unchanged — see that file's header.
      // ⚠️ Exactly ONE of these per DELIVERY, carrying the whole body. The
      //    multi-event loop suppresses it for every event after the first, which
      //    is what keeps the one-row-per-delivery accounting true.
      if (!opts?.suppressDeliveryRow) {
        void this.wlogEmit(buildIncomingDeliveryRow({ hook, alias, meta, body }));
      }

      // legacy:2358 — 404 "Unknown alias". The guard rejects this case before we
      // are reached, so this is the defensive twin of that check; either way the
      // caller already has its 200.
      //
      // ⚠️ BEFORE the re-assist finally is installed, exactly as in legacy
      //    (the `res.send` patch lands at 2441, twelve lines below this return).
      if (alias && !hook) {
        this.logger.warn(`[WEBHOOK] 404 Unknown alias: ${alias}`);
        return;
      }

      /* ══ [FEAT-20260826-STRIKESUSPEND] the customer is locked out ═══════════
       * 📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md`
       *
       * Owner, 26/08: a customer who earns the configured number of rate-limit
       * strikes inside the configured window stops being answered —
       * *"webhook จะเงียบทันที ไม่ตอบและไม่เก็บ chat ใดๆทั้งสิ้น"*.
       *
       * ⚠️ THE POSITION IS THE FEATURE. The first write on this path is
       * `chatHistory.getOrCreateRoom` ~245 lines below, and that call CREATES a
       * member and a room. Anywhere beneath it and the customer is already in
       * the database — silent, but recorded, which is not what was asked for.
       * `strike-suspend-plug.spec.ts` pins the ordering so a later edit cannot
       * drift it downwards. ต้องอยู่เหนือจุดเขียนจุดแรกเสมอ
       *
       * ⚠️ It is ALSO above the rate limiter, so a locked customer never reaches
       * the ladder and never earns another strike: the more they send, the less
       * each message costs, instead of more.
       *
       * ⚠️ The gate never throws (`strike-gate.service.ts`); a failed read
       * answers `false` and the event carries on exactly as it does today.
       *
       * revert: `git apply -R docs/strike-suspend-plug-in.patch`.
       */
      if (userId && (await this.strikeGate?.isSuspended(userId))) {
        /* The only trace this event leaves anywhere. Nothing reaches the
           database on this path, so without this line a silent bot is
           indistinguishable from an outage. */
        this.logger.warn(
          `[STRIKESUSPEND] silent for ${userId} on ${alias ?? '(no alias)'} — session is suspended`,
        );
        return;
      }

      // legacy:2361 — a cached entry that predates a doc_id / custom_ai_key edit
      // is missing fields the engine needs. Re-read, re-cache, and record that
      // the answer came from the database.
      /* ⚠️ [FEAT-20260904-VENDORSECCOL] Asks for the key column of THIS hook's
       * vendor. Hard-coding `custom_ai_key` here would make every DeepSeek OA —
       * whose key lives in `custom_ai_key_sec` — look permanently incomplete, so
       * this branch would fire on EVERY message and re-read Mongo each time. The
       * reply would still be correct, which is what makes it the kind of
       * regression nobody notices. ถามคอลัมน์ของค่ายตัวเอง ไม่งั้น cache ไม่ทำงานเลย
       *
       * ⚠️ THE THREE `//` LINES ABOVE ARE BYTE-LOAD-BEARING. They are the trailing
       * context of hunk 3 in `docs/strike-suspend-plug-in.patch`; rewriting them
       * as a block comment (the first attempt here) rotted that patch and turned
       * another feature's on/off switch red. Add below them, never through them.
       * ห้ามแก้สามบรรทัดนั้น มันเป็น context ของ patch ฟีเจอร์อื่น */
      const cacheKeyField = resolveVendorColumns(
        hook?.['ai_vendor'] as string | null | undefined,
      ).keyField;
      if (alias && hook && !(hook['doc_id'] && hook[cacheKeyField])) {
        const fresh = await this.hookModel
          .findOne({ alias })
          .lean<Record<string, unknown>>()
          .exec();
        if (fresh) {
          hook = { ...hook, ...fresh };
          await this.hookCache.cacheHook(fresh);
          hookSource = 'db';
        }
      }

      /* ⚠️ [FAST-MODE-PAIR 1/2] — noted 2026-08-13. `hook.fast_mode` is LOGGED
       * here, NOT obeyed.
       *
       * Every hook in the DB carries `fast_mode: 1` (verified by query 2026-08-13,
       * all 7 rows) — set on purpose so every OA runs ONE flow. But this value only
       * ever reaches this log line; it never drives the model call. The value that
       * DOES is the hard-coded constant at the paired site below
       * (grep `FAST-MODE-PAIR 2` / 2), and it is `0` (full mode).
       * ⇒ to predict model behaviour read the constant, NOT `hook.fast_mode`.
       *   fast_mode=1 ทุกตัว = บังคับ flow เดียว · effectiveFastMode=0 = ตัวจริงที่ยิง model.
       *   อ่านคู่กัน 2 จุด. */
      this.logger.log(
        `hook resolved ${JSON.stringify({
          alias,
          hook_source: hookSource,
          fast_mode: hook?.['fast_mode'],
          doc_id: hook?.['doc_id'],
          /* [FEAT-20260904-VENDORSECCOL] "does this OA have a key" must mean the
             key of the vendor that will answer — reading the Gemini column for a
             DeepSeek hook logs `false` next to a working OA, and this line is the
             first thing read when someone asks why an OA went quiet. */
          ai_vendor: hook?.['ai_vendor'] ?? null,
          custom_ai_key: Boolean(hook?.[cacheKeyField]),
        })}`,
      );

      /* ===============================================================
         Credentials — legacy:2380-2415
      =============================================================== */
      /* [PROG-20260905-C5] Derivation moved to ai-vendors/request-credentials.ts.
         Pure: no awaits, no IO, no rows. `docId` and `logContext` are assigned back to
         the method-scope lets because the OUTER CATCH reads both — keeping them inside
         the returned object would leave the catch with defaults on the failure path. */
      const creds = deriveRequestCredentials(hook, {
        crypto: this.crypto,
        geminiApiKey: this.ai.geminiApiKey,
        logger: { log: (m) => this.logger.log(m) },
      });
      const {
        accessToken,
        channelId,
        hookAiKey,
        telegramKey,
        telegramChatId,
        /* [PROG-20260905-LADDER] the rest of the bundle is no longer unpacked here: the
           ladder takes `creds` WHOLE and each step reads the field it needs. Unpacking
           fifteen names to hand eight of them straight back down was the same "re-bind at
           every site" habit the turn-deps object exists to end. */
      } = creds;
      docId = creds.docId;
      logContext = creds.logContext;

      // legacy:2417-2433 — the request-scoped state every branch below writes to.
      let userProfile: { displayName?: string; pictureUrl?: string } | null =
        null;
      let profileData: Record<string, unknown> = {};
      let customerName = 'N/A';
      let customerTel = 'N/A';
      let contractCode = 'N/A';
      let bangkokTime = '';
      let mediaUrl: string | null = null;
      let existingUser: Record<string, unknown> | null = null;

      /**
       * [PROG-20260905-ASSISTTURN] The nineteen fields every `runAssistGuarded` call in
       * this method passed identically, written once. Contract and reasoning:
       * `assist/assist-turn-args.ts`.
       *
       * ⚠️⚠️ AN ARROW, NOT A VALUE, AND THAT IS BEHAVIOUR — NOT STYLE. Nine of these come
       * from `let`s declared just above that the turn REASSIGNS as it runs
       * (`customerName` at four sites, `bangkokTime` at three, `contractCode` and
       * `customerTel` at two, plus `mediaUrl`, `userProfile`, `existingUser`, `logContext`
       * and `autoUnassistTriggeredMinutes`). The three call sites are ~1,000 and ~2,000
       * lines below this point. Building the object here as a VALUE would freeze whatever
       * those held at this line and hand the later sites a stale customer name and an
       * empty clock — with every test still green, because the shape would be right and
       * only the values wrong. The arrow re-reads them at the moment of the call, which is
       * precisely what the three literals it replaces did.
       *
       * ⚠️ The type makes all nineteen REQUIRED even though the consumer marks most of
       * them optional. That is deliberate: `triggerAssistNotification` destructures with
       * defaults (`customerName = 'N/A'`, `bangkokTime = ''`, `mediaUrl = null`), so a
       * field dropped here would not fail — it would quietly become a placeholder in an
       * operator's Telegram summary. Required means tsc refuses the omission instead.
       */
      const assistTurn = (): AssistTurnArgs => ({
        // `?? ''` matches how every other room lookup in this function narrows `userId`;
        // the filter then matches nothing, which is the same outcome legacy gets passing
        // undefined.
        userId: userId ?? '',
        eventTimestamp: event.timestamp,
        aiNeedDetailLimit:
          (hook?.['ai_need_detail_limit'] as number | string | null) ?? null,
        // [P2-20260813] per-hook vendor + model, so a hand-off summary uses the same
        // vendor the OA answers with.
        // [FEAT-20260909-DSREASONING] and the reasoning setting alongside them —
        // one spread instead of two lines, so the method SHRINKS by one while
        // carrying one more field. See `assist/assist-ai-fields.ts` for why the
        // ratchet makes that the only acceptable shape.
        ...assistAiFields(creds),
        autoUnassistMinutes: autoUnassistTriggeredMinutes,
        telegramKey,
        telegramChatId,
        customerName,
        customerTel,
        contractCode,
        bangkokTime,
        geminiApiKey: hookAiKey || undefined, // [P2] own key; vendor rule decides the fallback
        alias,
        eventId: event.eventId,
        logContext,
        mediaUrl,
        lineDisplayName: userProfile?.displayName || 'N/A',
        userMongoId: existingUser?.['_id'],
      });

      // ═══════════════════════════════════════════════════════════════
      // The re-assist finally is installed HERE — legacy:2440-2452.
      // ═══════════════════════════════════════════════════════════════
      /* ═══════════════════════════════════════════════════════════════
         [PROG-20260905-LADDER] THE TURN CONTEXT, built here — at the top, where the
         credentials become known — rather than a thousand lines below.
         ═══════════════════════════════════════════════════════════════
         WHY IT MOVED UP, and it buys no lines by itself. A ladder step can only read
         a context that already exists, so while this was constructed just above the
         first `runLadder` call, NOTHING ABOVE THAT LINE COULD EVER BECOME A STEP —
         the whole head, and every gate inside `if (userId)`, was locked in place by
         the position of one `const`. This is the change that unlocks them.

         ⚠️ THE FORTY EMPTY SEATS ARE IN `gates/build-turn-context.ts`, beside the type
            that declares them. They used to be a literal here, two thousand lines from
            `TurnContext` — so adding a field meant editing one file and then hunting for
            the other. What stays in the spine is what the SPINE knows: fourteen values,
            and `TurnSeed` is a `Pick` of the context, so it cannot drift from it. */
      const ladderCtx: TurnContext = buildTurnContext({
        event,
        hook,
        alias,
        userId,
        creds,
        logContext,
        body,
        meta,
        hookSource,
        lineReplyEndpoint: LINE_REPLY_ENDPOINT,
        helperAltText: HELPER_ALT_TEXT,
        ignoreDocId: this.integration.ignoreDocId,
        perfT0,
        replyStaleMs: REPLY_STALE_MS,
      });

      /* Bound ONCE for the turn and reused by ALL THREE slices — the collaborators do not
         change between them, and re-binding at each site would be the very habit this
         design replaced. It is built here, beside the context, because the prologue slice
         runs long before the other two. */
      const ladderDeps = this.turnDeps(ladderCtx, assistTurn);

      try {
        /* ═══════════════════════════════════════════════════════════════════
           [PROG-20260905-LADDER] THE PROLOGUE — the ladder's FIRST slice.
           ═══════════════════════════════════════════════════════════════════
           Three decisions used to sit here as raw statements: the LINE signature
           re-check (legacy:2457-2474), the event re-read (legacy:2476-2482) and the
           eager room bootstrap. All three are about IDENTITY — is this body really
           from LINE, which event is it actually about, and does the customer have a
           room — and everything below depends on all three.

           ⚠️ THE RE-READ REASSIGNS `event` AND `userId` ON THE CONTEXT, which is why
              those two are the only fields that are not `readonly`. The turn's
              identity genuinely changes here, once, at a named step — and a reviewer
              should be made to see that rather than be reassured by a modifier that
              was never true.

           ⚠️ THE SLICE STOPS BEFORE THE PAYMENT SEAT. That seat and the menu seat
              under it are inside `docs/menu-plug-in.patch`'s box —
              `if (payPb.handled) return;` is a frozen byte — so the ladder resumes
              after them. Three slices, ONE context, ONE deps object.
        =============================================================== */
        if (await runLadder(PROLOGUE_LADDER, ladderCtx, ladderDeps)) return;
        event = ladderCtx.event;
        userId = ladderCtx.userId;

        // UNPORTED — legacy:2487-2493, `handoffChainPostback.handlePostback`.
        // The chain's own retry-button postback is consumed here and the request
        // ends. `handoff-chain.service.ts` in this repo is the CRUD half; the
        // postback half is not ported. With it absent every postback falls
        // through to the normal flow, which is exactly what legacy does when
        // `handoffChainCfg.chains` is off or the payload carries no "hoc:" prefix
        // — the documented seamless case.

        // ═══════════════════════════════════════════════════════════════════
        // [FEAT-20260808-PAYTOOL-P3] THE [ลองใหม่] BUTTON LANDS HERE
        // ═══════════════════════════════════════════════════════════════════
        // WHY THIS EXACT SPOT: it is the same seam legacy uses for its own
        // retry postback (2487, the comment directly above) — after the
        // signature check and the event extraction, but BEFORE the profile
        // fetch, the assist logic, the rate limiter and the AI. A retry tap is
        // not a conversation: it must not spend the customer's message quota,
        // must not reach the AI, and must not be logged as a chat message.
        //
        // WHAT IT DOES: resumes the paused payment run at the NEXT statement
        // with the SAME stored slip image, then answers with the fresh reply
        // token this postback carries. เอาสลิปเดิมมายิงใหม่กับ statement ถัดไป.
        //
        // SEAMLESS WHEN NOT OURS: `handlePaymentPostback` returns handled=false
        // for any payload without the `pay:` prefix — including the chain's own
        // `hoc:` — so every other postback falls through exactly as before. The
        // runner is also OPTIONAL (positional test constructions omit it), and
        // absent ⇒ this whole block is skipped.
        if (event.type === 'postback' && this.paymentRunner) {
          const payPb = await handlePaymentPostback(event, {
            // The payment tool's OWN switch — never the handoff chain flag.
            // Re-read per event so a kill-switch flip takes effect immediately.
            paymentEnabled: !!(await this.paymentRunner.resolvePaymentTool(
              hook,
            )),
            resume: (runId, nextIdx, replyToken) =>
              this.paymentRunner!.resumeForRetry({
                runId,
                nextIdx,
                replyToken,
              }),
            sendReply: (reply, ctx) => {
              /* [FEAT-20260810-PAYSTATEFLEX] The runner attaches the card inputs on
               * resume because this branch has no slip of its own — only the run id
               * off the button. `baseUrl` is the one piece it cannot know, and it is
               * in scope here. Without this the retry tap would answer with the
               * built-in card while a fresh slip answered with the admin's: one state,
               * two different answers depending on how it was reached.
               * ⚠️ Absent ⇒ no card resolved ⇒ previous behaviour. */
              const sf = ctx.stateFlex as
                | {
                    boundIds: Record<string, unknown> | undefined;
                    vData: unknown;
                    slipCreatedAt: Date | null;
                  }
                | undefined;
              return this.sendPaymentReply(reply, {
                accessToken,
                replyToken: ctx.replyToken,
                userId: ctx.userId,
                logContext,
                ...(sf
                  ? {
                      stateFlex: {
                        boundIds: sf.boundIds,
                        tagContext: {
                          vData: sf.vData as never,
                          baseUrl: meta.baseUrl,
                          slipCreatedAt: sf.slipCreatedAt,
                          formatThaiDateTime: (d) => formatThaiDateTime(d),
                        },
                      },
                    }
                  : {}),
              });
            },
          });
          // Consumed ⇒ stop. The payload must never reach the text pipeline,
          // where a raw `pay:resume:...` would be shown to the customer or fed
          // to the AI.
          if (payPb.handled) return;
        }

        /* ═══════ [FEAT-20260829-MENUTAG-S3] the menu postback seat ═══════
         *
         * WHY HERE: the same seam the payment retry uses directly above, and for
         * the same reasons — after the signature check and event extraction, but
         * BEFORE the profile fetch, assist, the rate limiter and the AI. Tapping
         * a menu button is not a conversation: it must not spend the customer's
         * quota, must not reach the AI, and must not be logged as a chat message.
         *
         * SEAMLESS WHEN NOT OURS: `handlePostback` answers `handled:false` for
         * any payload without our prefix, so every other postback — `pay:`,
         * `hoc:`, and anything a future feature adds — falls through exactly as
         * before. The engine is OPTIONAL too, so unbound skips the block.
         *
         * revert: git apply -R docs/menu-plug-in.patch */
        if (event.type === 'postback' && this.menuCards && userId) {
          /* Built per request: `coreSend` closes over THIS request's access
             token and the module cannot know it (it is decrypted per hook), so
             a singleton engine would have to hold a stub and would silently
             send nothing. Construction is a few object literals — no IO. */
          /* [FIX-20260831-MENUCARDVARS] This seat runs BEFORE the profile fetch
             on purpose, so it has no payload to hand over. Fetching one for
             every button press would put an API call on a path that makes none
             — so the card is asked first: no `{{` in it, no call at all. Only a
             card that would otherwise print `{{site_rules.…}}` at a customer
             pays for one, and it is the same central fetch the main path uses.
             ไม่มีตัวแปร = ไม่ยิง API */
          let menuProfile: unknown;
          let menuProfileLoaded = false;
          const menuCardVars = this.menuCardResolver(hook ?? {}, async () => {
            if (!menuProfileLoaded) {
              menuProfileLoaded = true;
              try {
                menuProfile = await this.loadCombinedProfile(
                  String(userId),
                  hook,
                );
              } catch (err) {
                /* a card with '-' in it still beats no card at all */
                this.logger.warn(
                  `[MENUCARDVARS] profile fetch failed: ${errText(err)}`,
                );
              }
            }
            return menuProfile;
          });
          const menuEngine = createMenuEngine({
            /* [FEAT-20260831-MENUSLIPQR] the picker rides on the MESSAGE, because
               LINE refuses a flex that carries one as a button (its own validate
               endpoint answered `{0} action is not available for flex message`
               on 31/08). WHICH card gets one is a lookup table, so a second card
               or a different picker is one row — see the table.
               ⚠️ The slip path's own quick reply is untouched: this only READS
                  the same constant. */
            quickReplyFor: (card) => quickReplyForCardSlug(card.flex_slug),
            resolveCard: (card) =>
              this.cardNeedsVars(card) ? menuCardVars(card) : card.content_json,
            /* [FIX-20260831-MENUPOSTBACKROW] the card this seat sends is written
               to the chat history like every other outgoing card. It was the one
               reply the dashboard never showed: the engine sends through
               `coreSend`, which bypasses the reply path that normally files the
               row. Owner 31/08: ต้องเก็บสิ่งที่ตอบจาก postback ด้วย.
               ⚠️ The row carries the RESOLVED card — the same object LINE gets —
                  so what an operator reads back is what the customer saw, never
                  a raw `{{...}}`.
               ⚠️ Fire-and-forget: a history failure must not cost the reply. */
            coreSend: async (replyToken, messages) => {
              /* ⚠️ [FIX-20260831-MENUSENDFIRST] SEND FIRST, LOG AFTER. Logging
                 before the send writes a row for a message the customer never
                 got: LINE answers 400 for a card it will not render (a flex
                 button carrying a quick-reply-only action, for one), and the
                 dashboard then shows a card the phone never received. Seen for
                 real 31/08 on `sub-slip-request`. The ordinary reply path has
                 always written its row after the send for this reason, and
                 stamps the id LINE returned. */
              const res = await this.replyViaCore(
                accessToken,
                replyToken,
                messages,
                /* [FIX-20260902-FLEXLADDER] `userId` is non-null here — the seat
                   is guarded on it at the top of this block. Without this the
                   menu card was lost whenever the reply token was refused. */
                userId,
              );
              void this.logMenuPostbackCard(
                messages,
                hook,
                String(userId),
                channelId,
                res,
              );
              return res;
            },
            cards: this.menuCards,
            /* [FEAT-20260902-MENUPRESSONCE] ONLY a menu card gets a budget.
               Anything else renders byte-identically to before, because an
               absent stamp is an absent feature. */
            renderStamp: (card: StoredMenuCard) =>
              card.flex_type === MENU_PRESS_FLEX_TYPE
                ? mintRenderId()
                : undefined,
            onCardRefused: (reason, detail) =>
              this.logger.warn(`[MENU] card refused (${reason}) ${detail}`),
          });
          /* [FEAT-20260902-MENUPRESSONCE] ONE PRESS PER BUTTON PER RENDERED CARD.
             ─────────────────────────────────────────────────────────────────
             Asked BEFORE the engine acts, because the whole point is that the
             engine must not act. Refused ⇒ `return`, exactly like `handled`
             below: the payload is consumed, so it can never fall through to the
             text pipeline and be answered by something else, and the customer
             gets NOTHING — silent by policy (owner 02/09).

             SCOPE IS THE STAMP. A payload with no `@<render>` — every card sent
             before this shipped, and every card sent by a path that does not
             stamp — is allowed through untouched. That is what keeps buttons
             that worked yesterday working today, on a platform where a sent
             card can never be edited or withdrawn.
             ⚠️ `item` is the payload's own destination, so it cannot disagree
             with the button; `hookId`/`userId` come from the EVENT and are
             deliberately not in the payload, where they would be forgeable. */
          const pressData = String(event.postback?.data ?? '');
          const pressRender = pressRenderOf(pressData);
          const pressItem = pressItemOf(pressData);
          const pressHookId = asString(hook?.['_id']);
          let pressClaim: string | undefined;
          if (pressRender && pressItem && pressHookId && this.menuPress) {
            const decision = await this.menuPress.attempt({
              render: pressRender,
              item: pressItem,
              lineUserId: String(userId),
              hookId: pressHookId,
            });
            if (!decision.allowed) return;
            pressClaim = decision.claimId;
          }
          /* [FEAT-20260902-MENUPRESSONCE] RESERVE → SETTLE, and the settle is
             this block. The press was claimed above so two taps cannot both get
             through; it is given BACK whenever the card did not actually reach
             the customer:
               · `coreSend` throws through by design (menu-engine.service.ts) —
                 a refused LINE reply token is the common case, and it is OUR
                 failure, so the customer must not pay a press for it;
               · the door answered `silent` (suspended / policy) — nothing was
                 sent, so nothing was spent.
             Only `action: 'sent'` keeps the press, and the engine returns that
             value only after `coreSend` resolved. ส่งไม่ถึง = คืนสิทธิ์ */
          let menuPb;
          try {
            menuPb = await menuEngine.handlePostback({
              data: pressData,
              replyToken: String(event.replyToken ?? ''),
              context: buildMenuContext({
                hook: hook ?? {},
                lineUserId: userId,
                member: null,
                siteRules: null,
                /* The webhook has already enforced silence upstream by the time
                   this line runs, so this states a fact rather than skipping a
                   check — see menu-context.ts's header. */
                silence: NOT_SILENCED,
              }),
            });
          } catch (err) {
            if (pressClaim) await this.menuPress?.release(pressClaim);
            throw err;
          }
          if (pressClaim && menuPb.action !== 'sent') {
            await this.menuPress?.release(pressClaim);
          }
          if (menuPb.handled) return;
        }

        /* ===============================================================
           Assist state + auto-unassist — legacy:2495-2580
        =============================================================== */
        let skipBotProcessing = false;
        /* [FEAT-20260820-ABANDONTRIGGER] the room this request already loads, kept
           for the follow-up stamp further down. A reference, not a second query.
           ยืมของที่โหลดอยู่แล้ว ไม่ยิง query เพิ่ม. */
        let inboundRoom: Record<string, unknown> | null = null;
        /* [FEAT-20260820-FOLLOWUP] the profile verdict this request already
           computed, carried down to the gate. A copy of an existing value, not a
           second check — `profileOk` itself is block-scoped where it is used.
           ยืมผลเดิม ไม่ได้เช็คซ้ำ. */
        let followUpHasProfile = false;
        if (userId) {
          /* [PROG-20260905-C2] Body moved to assist/assist-state.gate.ts. The gate has
             zero exits and throws nothing outward, so this is one await in the same slot.
             The four assign-backs are the contract: thirteen later code lines read
             `skipBotProcessing`, the finally reads `forceReAssistAfterReply`, and the
             follow-up gate reads `inboundRoom` — which the gate deliberately sets BEFORE
             its later awaits so a caught failure still leaves the room it had found. */
          const assist = await runAssistStateGate(
            userId,
            hook,
            event.message?.text ||
              event.postback?.data ||
              event.message?.type ||
              '[Unknown]',
            {
              chatRoomModel: this.chatRoomModel as never,
              chatMessageModel: this.chatMessageModel as never,
              ticketModel: this.ticketModel as never,
              assignHistoryModel: this.assignHistoryModel as never,
              logger: {
                log: (m) => this.logger.log(m),
                error: (m) => this.logger.error(m),
              },
            },
          );
          inboundRoom = assist.inboundRoom;
          skipBotProcessing = assist.skipBotProcessing;
          forceReAssistAfterReply = assist.forceReAssistAfterReply;
          autoUnassistTriggeredMinutes = assist.autoUnassistTriggeredMinutes;
        }

        // legacy:2582 — the typing animation. Fire-and-forget with its own
        // swallow; a cosmetic indicator must never be able to abort a reply.
        if (
          userId &&
          !skipBotProcessing &&
          (event.type === 'message' || event.type === 'postback')
        ) {
          void this.lineApi
            .sendLineLoadingIndicator(accessToken, userId)
            .catch(() => {});
        }

        /* ===============================================================
           The big `if (userId)` block — legacy:2587-3857
        =============================================================== */
        if (userId) {
          /* ═══════════════════════════════════════════════════════════════
             [PROG-20260905-WIDELOCAL] ELEVEN LOCALS THAT LIVED AT METHOD SCOPE.
             ═══════════════════════════════════════════════════════════════
             They were declared 480-950 lines above their first use, at the top of a
             method that is now 924 CODE. That is not a style complaint: a reader holding
             nineteen names for five hundred lines cannot tell which of them a given
             branch may touch, and neither can a tool.

             MEASURED, THEN MOVED. Every one of these has BOTH its first and its last use
             inside this block, so `if (userId)` is their real lifetime and the method
             scope was simply wider than the truth. `profileData` is the one that stayed
             behind, and it stayed for a reason worth writing down: its last read is in
             the perf summary AFTER this block closes, so method scope is genuinely
             forced there.

             ⚠️ THE MEASUREMENT NEEDED TWO CORRECTIONS, both worth remembering. A
                line-based scan called `if (userId) {` the block at :2545 — it appears
                TWICE in this method, exactly as `z-test/fixtures/gate-anchors.json` warns, and
                the first one is a 29-line decoy. And it read `slipCreatedAt: Date | null`
                (a type) and `slipCreatedAt: sf.slipCreatedAt` (a property key) as uses of
                the local, which would have stranded one of the four slip variables above
                its three siblings. ตัวเลขจากสคริปต์ต้องตรวจซ้ำ ไม่ใช่เชื่อทันที */
          let profileCircuitOpen = false;
          let msgContent = '';
          let msgType = '';
          let internalContentId: string | null = null;
          let customerMsg: { _id?: unknown; room_id?: unknown } | null = null;
          // [FIX-20260808-SLIPFLOW] legacy:2451-2465 — the four enclosing slip variables.
          // `verifySlip` (the Swiftcheck call) fills them in the image branch below when
          // `slip_check` is on; every downstream slip branch reads them and is a no-op
          // while they stay at these null defaults, which is exactly legacy's behaviour
          // for an OA with slip checking off.
          let slipVerifyResult: unknown = null;
          let slipRecordId: Types.ObjectId | null = null;
          let slipCreatedAt: Date | null = null;
          let slipCondition: string | null = null;
          // The stored slip's `file_path`, captured in the image branch so the flex
          // branch can read it (legacy reads `storage.file_path` off the same row).
          let slipStorageFilePath: string | null = null;

          /* [PROG-20260905-C3] Body moved to room-bootstrap/sync-member-profile.ts.
             The QUERIES deliberately stay here, behind arrows:
             member-user-id-index.spec.ts proves the live path still reads by
             `member_user_id`, and moving the literal out would redden a spec for a
             change that altered no behaviour. */
          const uid = userId;
          const synced = await syncMemberProfile(uid, {
            findMember: () =>
              this.memberModel
                .findOne({ member_user_id: uid })
                .lean<Record<string, unknown>>()
                .exec(),
            fetchLineProfile: () => this.lineApi.getLineProfile(accessToken, uid),
            upsertMember: async (set) => {
              await this.memberModel
                .updateOne(
                  { line_user_id: uid },
                  { $set: set },
                  {
                    upsert: true,
                  },
                )
                .exec();
            },
            logError: (err) =>
              this.logger.error(`Error tracking Member/Profile: ${errText(err)}`),
          });
          existingUser = synced.existingUser;
          userProfile = synced.userProfile;

          const profileForLog = userProfile
            ? {
                displayName: userProfile.displayName,
                pictureUrl: userProfile.pictureUrl,
                nickname:
                  (existingUser?.['nickname'] as string | undefined) ||
                  userProfile.displayName,
              }
            : {};

          // legacy:2645-2652 — what goes in the chat_messages row.
          msgType = event.type ?? '';
          msgContent = `[${event.type}]`;
          if (event.type === 'message') {
            msgType = event.message?.type ?? '';
            msgContent = event.message?.text || `[${event.message?.type}]`;
          } else if (event.type === 'postback') {
            msgContent = event.postback?.data ?? '';
          }

          /* [PROG-20260905-G16B] Body moved to room-bootstrap/combined-profile.ts.
             NINE values come back, not eight: `profileCircuitOpen` is written at a
             shallower indent than its neighbours and a mechanical scan missed it — the
             compiler caught it, and three gates below read it. The result is mutated in
             place inside the helper so a part-way failure still returns what it derived;
             the gates treat undefined as "the fetch never ran ⇒ fail open". */
          const profile = await fetchCombinedProfile(
            { hook, userId },
            {
              logger: {
                log: (m) => this.logger.log(m),
                error: (m) => this.logger.error(m),
              },
              usesCustomTool: (h) => this.usesCustomTool(h),
              loadCombinedProfile: (uid, h) =>
                this.loadCombinedProfile(uid as never, h),
              memberModel: this.memberModel as never,
              customTool: this.customTool as never,
            },
          );
          profileData = profile.profileData;
          perfProfileMs = profile.perfProfileMs as never;
          /* [FEAT-20260809-REQUIREPROFILE] what the profile lookup actually answered.
             `undefined` means "the fetch never ran", which the gates read as "we do not
             know" ⇒ fail open — and that value comes from the helper, not from a
             deferred declaration here. `const`, because there is exactly one writer and
             the reader is three lines down; the `let` this replaced was a habit left
             over from when the declaration sat 460 lines further up. */
          const profileBlock = profile.profileBlock;
          customerName = profile.customerName as never;
          customerTel = profile.customerTel as never;
          contractCode = profile.contractCode as never;
          bangkokTime = profile.bangkokTime as never;
          followUpHasProfile = profile.followUpHasProfile as never;
          profileCircuitOpen = profile.profileCircuitOpen;

          /* ═══════════════════════════════════════════════════════════════
             [PROG-20260905-LADDER] THE VALUES THE PROFILE FETCH JUST PRODUCED.
             ═══════════════════════════════════════════════════════════════
             Handed over HERE, three lines after they are learned, because the image slice
             below reads all three — and the customer handover a thousand lines down is far
             too late. That exact mistake was made once already in this program: the first
             handover sat below `if (userId)`, so the customer slice would have read
             `skipBotProcessing: false` and been told no operator was holding the room.
             It compiled, and every test stayed green. ค่าต้องส่งก่อนคนอ่าน */
          ladderCtx.customerName = customerName;
          ladderCtx.profileBlock = profileBlock;
          ladderCtx.profileCircuitOpen = profileCircuitOpen;
          /* And the four the unlinked-slip refusal reads, all of them final by this line:
             `skipBotProcessing` at :2599, `profileForLog` at :2650, the two message fields
             at :2661-2668. The customer handover far below re-stamps `msgType` and
             `msgContent` — NOT a redundant write: the video branch rewrites `msgType` to
             `video_pending` between here and there, and the media slice must read that
             one. ส่งซ้ำเพราะค่ามันเปลี่ยนจริงระหว่างทาง ไม่ใช่เพราะลืม */
          ladderCtx.skipBotProcessing = skipBotProcessing;
          ladderCtx.profileForLog = profileForLog;
          ladderCtx.msgType = msgType;
          ladderCtx.msgContent = msgContent;

          // legacy:2800-2813 — inbound image.
          if (event.message?.type === 'image' && event.message.id) {
            /* ═══════════════════════════════════════════════════════════════
               [PROG-20260905-LADDER] THE IMAGE SLICE — store, pre-scan, decide.
               ═══════════════════════════════════════════════════════════════
               Three steps, and the ORDER IS THE FEATURE (owner, 12/08): store the
               picture → ask whether it carries a QR at all → only then consult
               "รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว". Reading the account setting first
               would refuse an ordinary photo with "please link your account", which is
               a live defect this order was written to fix. Each step names the one
               before it in `mustFollow`, so the order is now checked rather than
               defended in prose.

               ⚠️ THE SLICE STOPS BEFORE THE NOTICE GUARD, and it is not a judgement
                  call: the guard's `consumeQuota` closure contains a
                  `docs/strike-plug-in.patch` box — the read-only strike tap. Those
                  are frozen bytes, so the guard, the refusal it gates and the slip
                  verify below them stay inline until Phase 5.
                  🔴 AND DO NOT NAME THE TAP'S METHOD HERE. `strike-plug-patch.spec.ts`
                  reverts the patch and asserts the reverted file contains no trace of
                  it; a comment that spells the name makes that check fail on PROSE
                  while the switch itself is perfectly fine. Cost: one red suite, 05/09.
                  ชื่อ method ของ plug ห้ามพิมพ์ในคอมเมนต์ เทสมันกวาดทั้งไฟล์

               ⚠️ IT ONLY DECIDES — nothing here replies. `blockUnlinked` is computed
                  and deliberately left unused until past the notice guard, because the
                  notice runtime must get the first turn (owner, 24/08). Moving the
                  refusal up here would silently undo that.

               ⚠️ `'done'` FROM A STEP RETURNS THE WHOLE TURN, which at this position
                  means the inbound chat row below is never written. No step does that
                  today; a future one that wants to must write the row itself, the way
                  the unlinked-slip refusal does. */
            if (await runLadder(IMAGE_LADDER, ladderCtx, ladderDeps)) return;
            /* The spine locals the still-inline blocks below read. `qrPrescan` and
               `blockUnlinked` keep their exact old names because the notice guard, the
               refusal and the verify gate quote them, and one of those sites is inside a
               patch box. เปลี่ยนชื่อไม่ได้ ชื่อเป็น byte ของ patch */
            mediaUrl = ladderCtx.media.mediaUrl;
            internalContentId = ladderCtx.media.internalContentId;
            slipStorageFilePath = ladderCtx.slip.storageFilePath;
            const storageId = ladderCtx.slip.storageId;
            const qrPrescan = ladderCtx.slip.prescan;

            /* [FEAT-20260822-NOTICERUNTIME] slip-path notice guard (cases E/F)
               — after jsQR, before Swiftcheck and payment, firing ONLY when a
               case matches; every other slip proceeds untouched (owner: the
               guard never leaves the payment flow permanently). This branch
               sits above the shared inbound-row write, so the guard stores
               the customer's own image row itself, the refusal branch's way.

               🔴 [FEAT-20260824-NOTICEFIRST] MOVED ON 24/08 — IT USED TO SIT
               BELOW `if (blockUnlinked)`, AND THAT IS THE ONE THING THIS
               CHANGE DID. Owner's reasoning, verbatim: "notice ต้องใหญ่สุด
               ไม่ใช่หรอ เพราะเคสนี้คือ ส่งรูปมา = jsqr ตรวจเป็น qr แล้ว >
               ต้องเจอด่าน notice ก่อน slip_require_profile".

               WHAT IT CHANGES — EXACTLY ONE CLASS OF EVENT, and the shape of
               the code is why: the refusal below is a one-step ladder slice
               whose `when` is `slip.blockUnlinked`, and NOTHING else stands
               between it and this guard. So when `blockUnlinked` is false,
               control already jumped straight here and the move is a no-op,
               byte for byte. The only event whose
               outcome moves is A SLIP FROM A CUSTOMER WHO HAS NOT LINKED AN
               ACCOUNT: it now meets the notice runtime first, and only falls
               through to the refusal when no case matched.
               ย้ายแล้วกระทบเคสเดียว — สลิปของคนที่ยังไม่ผูกบัญชี.

               WHY THAT IS SAFE TO FALL THROUGH: this guard is fail-open and
               writes NOTHING before it commits to sending — `logCustomerRow`
               runs at `notice-guard.helper.ts:221`, after every `return
               false` above it. No case, no card, unloadable card ⇒ `false` ⇒
               the refusal branch runs exactly as it always did, its own rows
               included. There is no double write.

               WHICH CASES BENEFIT — BOTH E AND F. Case E (all-offtime,
               `cases/case-e-all-offtime.ts:27`) reads only the hook flags, the
               scope, the jsQR verdict and the Thai clock. Case F (all-disable)
               additionally needs `depositOff`, which comes from the site-rules
               block — and that block IS in hand here even for a customer with
               no account.

               ⚠️ CORRECTED 24/08, AND THE MISTAKE IS WORTH KEEPING WRITTEN DOWN:
               this comment first claimed F could never match without a profile.
               That read `profileData` as "the customer's profile". It is not —
               it is the COMBINED custom-tool result, one block per endpoint,
               each carrying its own `role` (`flex-data-vars.util.ts:483`
               `pickByRole`). `profileBlock`, the thing that answered 404, is
               merely ONE block picked out of it (:1675/:1679). A failed profile
               endpoint only skips writing the hook's `raw_profile_data` cache
               (`external/custom-tool.service.ts:1403-1409`) — it removes
               nothing from the bag. So `pickByRole(profileData,'site_rules')
               ?.block?.data` (:5449) still hands the notice runtime the real
               site rules, and the log of the very event above proves they were
               fetched: `[CUSTOM TOOL] [SITE_RULES] cache HIT (ttl=30s)` sits two
               lines above the 404.
               profileData = ถุงรวมผลทุก tool ไม่ใช่โปรไฟล์ลูกค้า · 404 ก้อนเดียวไม่ทำให้ก้อนอื่นหาย.

               ⇒ AN UNLINKED CUSTOMER'S SLIP CAN NOW MEET EITHER CARD — the
               off-hours one (E, on the clock) or the closed-for-service one
               (F, on the site rules, which is exactly the `is_view` /
               `status === 'enable'` reading in `notice-site-rule-check.ts`).
               That is a WIDER surface than the first version of this note
               claimed, so judge the trade below against both, not just E.

               THE EVENT THAT PROMPTED IT — real, on `allwingame9`, 2026-08-23
               18:56:28 UTC (01:56:28 Thai). Slip in, profile 404, customer got
               the customer-helper card. Five of case E's six conditions are
               provable from the stored hook and the clock: `notice_deposit_status`
               true, scope `slip`, `notice_deposit_time_check` absent (= ON),
               eventKind image, and 01:56 inside the 23:00-02:00 window. The
               sixth, `qrReason === 'qr_found'`, is NOT provable from that log —
               `imgProbe` is gated behind `IMG_FLOW_PROBE=on`, which was off, so
               the pre-scan line was never written. ห้าในหก พิสูจน์ได้ · ข้อหก ไม่มี log.

               ⚠️ WHAT THIS COSTS, STATED SO NOBODY REDISCOVERS IT: when a case
               matches, the refusal below never runs — and the refusal is what
               raises a ticket for an OA whose refusal copy carries
               `[[[assist]]]` (`refusalWantsAssist`). Such an OA stops getting
               tickets for unlinked slips during the notice window. It also
               means the customer is told "outside service hours" instead of
               being invited to link. In the very event above the customer DID
               link, 11 minutes later, after tapping that card — so this is a
               product trade the owner made knowingly, not an oversight.

               🔁 REVERT — ONE MOVE, NO OTHER EDIT. Cut this whole block (this
               comment plus the `if (await this.tryNoticeGuard({…})) { return; }`
               under it) and paste it back DIRECTLY BELOW the
               `runLadder(IMAGE_REFUSAL_LADDER, …)` call, which is the next
               statement down. (It was `if (blockUnlinked) { … }` until 05/09,
               when the refusal's wiring became a ladder step; the statement
               changed shape, the position did not.)
               Nothing else changes: no argument, no dep, no order inside either
               block. Everything the guard reads (`qrPrescan`, `hook`,
               `existingUser`, `profileData`, `skipBotProcessing`, …) is declared
               far above both positions, so it compiles in either place.
               revert = ย้ายบล็อกนี้กลับลงไปใต้บล็อก blockUnlinked เท่านั้น. */

            /* 🔌 [SEAM-20260824-NOPROFILEQR] THE JOINT A FUTURE BRANCH WOULD USE —
               NOT BUILT, AND DELIBERATELY NOT BUILT YET. Owner, 24/08: the pair
               "ไม่มี profile" + "jsQR says QR" may one day deserve its OWN notice,
               separate from the ordinary off-hours card. Today it does not: such a
               customer takes case E like everybody else, and if no case matches
               they fall through to the refusal below. ตอนนี้ยังไม่แยก.

               THIS LINE IS THE JOINT. Right here, between the guard above and the
               refusal below, is the only place in this method where BOTH facts are
               already in hand and NOTHING has been sent yet:
                 · `blockUnlinked` — computed, still unused (unlinked + require-profile)
                 · `qrPrescan.reason` — the jsQR verdict, `'qr_found'` when a code read
               Above this point the profile verdict is not yet folded in; below it the
               refusal has already replied and returned. ที่นี่ที่เดียวที่มีครบสองอย่าง.

               IF IT IS EVER SPLIT — THE SHAPE, so nobody redesigns it from scratch:

               1. IT IS A NEW CASE, NOT A NEW `if` HERE. Adding a branch in this
                  method would put a second decision-maker beside the runtime, and
                  the whole point of `notice-runtime/` is that the six cases are the
                  only place a notice is decided. Add `cases/case-g-*.ts`, register
                  it in `cases/index.ts`, and give it a slot in `NOTICE_CASE_ORDER`.
                  เพิ่มเป็นเคส ไม่ใช่เพิ่ม if ตรงนี้.

               2. ORDER DECIDES WHO WINS, and that is the whole design question. The
                  order is data (`NOTICE_CASE_ORDER`), and one event yields one card.
                  Put G BEFORE E and an unlinked customer stops seeing the off-hours
                  card during 23:00-02:00; put G AFTER E and G only ever speaks
                  outside the window. There is no "both". เลือกได้ทางเดียว.

               3. IT NEEDS ONE CONTEXT FIELD THAT DOES NOT EXIST YET. `NoticeContext`
                  (`cases/notice-case.types.ts`) carries no notion of a linked account.
                  Add ONE optional boolean — `unlinked?: boolean` — fed from
                  `buildNoticeContext`, and pass it from `tryNoticeGuard`'s args the
                  way `qrReason` and `assisted` already travel. Optional on purpose:
                  every existing case ignores it, and every existing test literal
                  still compiles unchanged, which is the proof that A-F did not move.
                  ⚠️ Derive it from THIS turn's `profileBlock`/404, never from a
                  member column — the member row can be stale, the turn cannot.

               4. IT NEEDS ITS OWN CARD COLUMN. Follow the existing shape exactly:
                  a `notice_*_flex_id` on the hook, defaulting absent, plus the FE
                  field list (`NOTICE_FORM_FIELDS` in `components/hook/form/
                  noticeCardGate.ts` — a notice field that is not on that list SAVES
                  NOTHING AND SAYS NOTHING, which cost a day on 23/08) and a case
                  chip + a panel in `NoticeCaseInfoModal.tsx`.

               5. WHAT IT TAKES AWAY. A G that fires before the refusal takes the
                  same two things this move already takes — the `[[[assist]]]` ticket
                  and the invitation to link — but takes them from a customer who by
                  definition CANNOT be credited. Decide that in the open: telling an
                  unlinked customer only "outside hours" leaves them with no next
                  step at all. คนที่ยังไม่ผูกบัญชี ถ้าไม่ชวนผูก เขาไม่มีทางไปต่อ.

               6. HOW TO PROVE IT DID NOT DISTURB A-F. Same method as 23/08: the
                  BEFORE pack `z-test/fixtures/notice-before-20260823.json` replays
                  every decision cell. Regenerate against the new `NOTICE_CASE_ORDER`
                  and the only cells allowed to move are the ones G is meant to own.
                  Anything else that moves is a bug, not a side effect. */
            if (
              await this.tryNoticeGuard({
                eventKind: 'image',
                hook,
                member: existingUser,
                userId: userId ?? '',
                accessToken,
                replyToken: event.replyToken ?? '',
                eventId: event.eventId,
                channelId,
                profileData,
                logContext,
                qrReason: qrPrescan.reason,
                assisted: skipBotProcessing,
                consumeQuota: async () => {
                  const v = userId
                    ? await this.rateLimit.consume(userId, event.message?.type)
                    : null;
                  // [FEAT-20260824-STRIKESESSION] read-only tap; verdict unchanged.
                  void this.strike
                    ?.recordFromVerdict(v, userId, asString(hook?.['_id']), event.message?.type, null, asString(hook?.['alias']))
                    .catch(() => {});
                  return { limited: v?.limited ?? false };
                },
                logCustomerRow: () =>
                  this.chatHistory.logMessage({
                    userId,
                    senderType: 'customer',
                    messageType: msgType,
                    content: msgContent,
                    hookId: asString(hook?.['_id']),
                    channelType: hook?.['channel_type'] as string | undefined,
                    channelId,
                    providerMsgId: event.message?.id,
                    replyToken: event.replyToken,
                    quoteToken: event.message?.quoteToken,
                    quotedProviderMsgId: event.message?.quotedMessageId,
                    profile: profileForLog,
                    metadata: { event_id: event.eventId },
                    rawContent: body,
                    internalContentId,
                  }),
              })
            ) {
              return;
            }

            /* ═══════════════════════════════════════════════════════════════
               [PROG-20260905-LADDER] THE IMAGE SLICE, RESUMED — one step.
               ═══════════════════════════════════════════════════════════════
               THE UNLINKED-SLIP REFUSAL. The body has been in
               `hook-reply/unlinked-slip-refusal.handler.ts` since SP28; what left the
               spine now is the WIRING — a seventeen-field input literal and nineteen
               lines of deps, thirteen of whose collaborators were already bound once for
               this turn a thousand lines above.

               ⚠️ WHY IT IS A SLICE OF ITS OWN rather than the fourth step of the image
                  slice: the notice guard sits between them and cannot move, because its
                  `consumeQuota` closure holds a `docs/strike-plug-in.patch` box. And the
                  guard MUST stay between them — `[FEAT-20260824-NOTICEFIRST]`, owner
                  24/08: an unlinked customer's slip meets the off-hours card before it
                  meets "please link your account". Merging the two slices would undo
                  that with nothing failing on behaviour.

               ⚠️ ITS `when` IS `slip.blockUnlinked`, which the decide step wrote before
                  the guard ran. That is the `if` this replaces, moved onto the step.

               revert: paste the handler call back in place of this line and delete
                       `gates/unlinked-slip-refuse.step.ts`. */
            if (await runLadder(IMAGE_REFUSAL_LADDER, ladderCtx, ladderDeps))
              return;


            /* [FEAT-20260824-SLIPRATEPEEK] the fourth term is LAST on purpose:
               `&&` short-circuits, so the extra Redis read happens only on an
               event that was otherwise about to spend money. A hook without slip
               checking, a photo with no QR, an event with no file — none of them
               ask. See `slipVerifyBlockedByRate` for why an assisted room never
               asks either. เงื่อนไขที่สี่ต้องอยู่ท้ายสุด ไม่งั้นอ่าน Redis ฟรีทุกรูป. */
            if (
              this.slipFlow.isSlipVerifyEnabled(hook) &&
              slipStorageFilePath &&
              !qrPrescan.skipSlipVerify &&
              !(await this.slipVerifyBlockedByRate(
                userId,
                event.message?.type,
                skipBotProcessing,
              ))
            ) {
              /* [OBS-20260812-IMGPROBE] about to spend a Swiftcheck call. */
              imgProbe('swiftcheck-call', {
                slip_check: hook?.['slip_check'],
                hasFilePath: Boolean(slipStorageFilePath),
              });
              const verify = await this.slipFlow.verifySlip({
                hook: hook,
                storage: { file_path: slipStorageFilePath },
                storageId,
                userId: userId ?? '',
                messageId: event.message.id,
              });
              slipVerifyResult = verify.slipVerifyResult;
              slipRecordId = verify.slipRecordId;
              slipCreatedAt = verify.slipCreatedAt;
              slipCondition = verify.slipCondition;

              /* [FEAT-20260815-CATUPGRADE] a slip proves the case is about money.
               *
               * An assist ticket opens as `Other` because at that moment nobody
               * knows what the customer wants. If a slip then arrives while the
               * room is still unclaimed, the admin queue is showing the wrong
               * label. The helper upgrades it to `Payment`, once, and only when
               * all four owner-stated conditions hold — see the file for the
               * full rule and why `job_status` is the claim signal.
               *
               * PLACED HERE ON PURPOSE: this is past the QR pre-scan
               * (`!qrPrescan.skipSlipVerify` ⇒ the image really is a slip) and
               * past the unlinked-slip refusal, which returns earlier. Putting
               * it any earlier would relabel tickets for photos that turned out
               * not to be slips at all.
               *
               * Fire-and-forget: the helper swallows every error and the reply
               * to the customer must not wait on a label.
               *
               * revert: delete this call and the import. Nothing else reads it. */
              void upgradeTicketCategoryOnSlip(
                {
                  channelUserId: userId ?? '',
                  hookId: hook?.['_id'],
                  /* [FEAT-20260815-CATUPGRADELOG] so the audit row carries the
                     same hook/group/mask columns as its neighbours and is
                     filterable on the Webhook Logs page. */
                  logContext,
                  slipRecordId,
                },
                {
                  ticketModel: this.ticketModel as never,
                  chatRoomModel: this.chatRoomModel as never,
                  memberModel: this.memberModel as never,
                  /* [FEAT-20260815-WLOGDOOR] The ONE widening cast in this file,
                     at a module boundary on purpose: the tickets helper declares
                     this dep with the legacy loose signature
                     (`ticket-category-upgrade.helper.ts:84`) and cannot adopt
                     `WebhookLogEvent` without importing a webhook-internal module,
                     which the layering lint forbids and the barrel deliberately
                     does not export. Its row was checked against live data before
                     this was allowed: `ticket_category_upgrade`, `channel:'system'`,
                     no `endpoint` because nothing was called — which is exactly why
                     the contract now permits both. */
                  persistWebhookLog: (e) => this.wlogEmit(e as WebhookLogEvent),
                  /* [FEAT-20260815-CATUPGRADEWS] the card relabels itself; the
                     FE has handled `ticket:updated` since
                     [FIX-20260728-REALTIME-SCALE] and only this emitter was
                     missing. The service swallows its own errors. */
                  publishTicketUpdated: (d) =>
                    void this.realtimePublisher.publish(
                      'ticket:updated',
                      d as never,
                    ),
                  log: (m: string) => this.logger.log(m),
                  warn: (m: string) => this.logger.warn(m),
                },
              );
            }

            // legacy:2818-2943 NOTE — the VALIDATION_ERROR failure path calls
            //    `qrVisionService.checkIfSlipWithQrCode` (legacy:3660), which
            //    builds a Gemini `generateContent` URL. That call is NOT made
            //    here; it lives in the flex branch below, behind the
            //    `checkQrCode` seam, so this ingest point never bills Gemini.
          }

          // legacy:2969-2977 [FIX-20260728-VIDEO-PENDING] — inbound video.
          // ONE attempt, no retry and no polling: a retry here would stall the
          // whole webhook. When LINE is still transcoding the body is empty, and
          // the message is marked `video_pending` so the chat UI can offer the
          // admin a "download" button instead of rendering an empty bubble.
          // `provider_msg_id` is already stored below, so the retry endpoint
          // needs no new field.
          if (event.message?.type === 'video' && event.message.id) {
            const storageId = await this.lineContent.downloadAndSaveVideo(
              event.message.id,
              accessToken,
            );
            if (storageId) {
              internalContentId = String(storageId);
            } else {
              this.logger.log(
                `[VIDEO-PENDING] LINE ยังไม่พร้อมส่งไฟล์ (transcoding) messageId=${event.message.id} — ตั้งเป็น video_pending ให้แอดมินกดโหลดเองทีหลัง`,
              );
              msgType = 'video_pending';
            }
          }

          // legacy:2980-3008 — the inbound chat_messages row. Awaited: the id it
          // returns is carried into the assist/ticket payload further down.
          /* [FIX-20260831-NOPOSTBACKROW] …except for a POSTBACK, which is a
             button press and not a message. Owner 31/08: postback ห้ามเก็บเข้า
             ประวัติ. Seen live the same day — the ticket chat filled with rows
             reading `{{paylink.contact_admin}}`: a machine payload, raw
             variable name and all, shown as if the customer had typed it.
             ⚠️ A DELIBERATE divergence from legacy, which did write the row. The
                case that pinned it in `webhook-ingest-flow.spec.ts` was FLIPPED,
                not deleted, and says why.
             ⚠️ Skipping the write also skips what `logMessage` does around it:
                no `room.last_message` bump, no `unread_count` increment, no
                `message:new` publish. All correct — there is no message.
             ⚠️ `customerMsg` stays null, so `chatMsgId` on the assist/ticket
                payloads below is undefined. That is a value they already carried
                whenever this write threw, and both read sites use `?.`.
             ⚠️ The event is NOT lost: `webhook_logs` still records it (with
                `postback_data`), and the seats that ACT on a postback — the
                payment retry and the menu — run further up and are untouched.
             revert: delete this `if` block and its `else`. */
          /* [PROG-20260905-G22] The postback rule and the swallow moved to
             room-bootstrap/inbound-chat-row.ts; the ROW stays here because the spine owns
             every value in it. A postback is deliberately not stored, and a failed write
             leaves `customerMsg` null — a value both read sites already handle with `?.`. */
          customerMsg = (await storeInboundChatRow(
            event,
            {
                  userId,
                  senderType: 'customer',
                  messageType: msgType,
                  content: msgContent,
                  hookId: asString(hook?.['_id']),
                  channelType: hook?.['channel_type'],
                  channelId,
                  providerMsgId: event.message?.id,
                  replyToken: event.replyToken,
                  quoteToken: event.message?.quoteToken,
                  quotedProviderMsgId: event.message?.quotedMessageId,
                  profile: profileForLog,
                  metadata: {
                    event_id: event.eventId,
                    ...(event.postback && { postback_data: event.postback.data }),
                    // Stickers keep their LINE ids so the chat UI can render the
                    // actual sticker rather than the "[sticker]" placeholder.
                    ...(event.message?.type === 'sticker' && {
                      packageId: event.message.packageId,
                      stickerId: event.message.stickerId,
                    }),
                  },
                  rawContent: body,
                  internalContentId,
            },
            {
              chatHistory: {
                logMessage: (r) => this.chatHistory.logMessage(r as never) as never,
              },
              logger: {
                log: (m) => this.logger.log(m),
                error: (m) => this.logger.error(m),
              },
            },
          ));

          /* ═══════════════════════════════════════════════════════════════
             THE VALUES THE TURN LEARNED ON THE WAY DOWN.
             ═══════════════════════════════════════════════════════════════
             Every one of these is written inside this block — the member sync, the
             profile fetch, the message-type branch, the assist-state gate, the inbound
             chat row — and this is the first line at which they are ALL final.

             ⚠️ THE HANDOVER SITS HERE, NOT BELOW THE BLOCK, AND THAT IS THE WHOLE
                POINT. The customer slice below reads `skipBotProcessing`,
                `existingUser`, `inboundRoom` and `msgContent`. Left where it was —
                after `if (userId)` closes — those four would still hold their INITIAL
                values when the slice ran: the notice guard would be told no operator
                was holding the room, and the admin doors would find no room to open a
                case against. Nothing would throw and nothing would fail to compile.
                ค่าต้องส่งก่อนคนอ่าน ไม่ใช่ส่งตอนจบ

             🔴 AND IT MOVED UP AGAIN ON 05/09, ~330 LINES, TO EXACTLY THIS LINE.
                It used to sit just above the customer slice, which is far later than any
                value in it becomes final — and "later than necessary" is not harmless: a
                step placed between the last write and this block reads the context's
                INITIAL value, compiles, and is silently wrong. That is not hypothetical;
                it is the same failure this comment already describes, one position down.

                THIS IS THE EARLIEST LEGAL POSITION, and it was measured rather than
                guessed. `customerMsg` is the last of the eighteen to be decided, and the
                statement above is the one that decides it. Everything else was final
                further up: the profile fetch (:2593-2642), the message-type branch
                (:2607-2613), the assist gate (:2545), the slip verify (:2967-2970), the
                video branch (:3051-3056).

                ⚠️ MOVING IT EARLIER STILL WOULD BE A BUG, not an improvement — it would
                hand over a null `customerMsg`, and the assist ticket's `chatMsgId` would
                quietly stop pointing at the customer's own message.
                ตำแหน่งนี้คือเร็วที่สุดที่ยังถูก · เร็วกว่านี้ = customerMsg ยังไม่เกิด */
          ladderCtx.profileData = profileData;
          ladderCtx.existingUser = existingUser;
          ladderCtx.customerName = customerName;
          ladderCtx.customerTel = customerTel;
          ladderCtx.contractCode = contractCode;
          ladderCtx.msgType = msgType;
          ladderCtx.msgContent = msgContent;
          ladderCtx.skipBotProcessing = skipBotProcessing;
          ladderCtx.inboundRoom = inboundRoom;
          ladderCtx.customerMsgId = customerMsg?._id;
          ladderCtx.perfProfileMs = perfProfileMs;
          ladderCtx.bangkokTime = bangkokTime;
          /* The four values the SLIP VERIFY block produced. That block is still inline —
             the strike-plug box in the notice guard above it freezes it there — so this is
             chain 9 from the dive, the one that crosses branches: written in the image
             branch, read in the non-text branch.

             ⚠️ FIELD BY FIELD, NOT `ladderCtx.slip = {…}`. A whole-object literal here
                would silently DISCARD everything the image slice already wrote onto the
                context — `storageFilePath`, `noQrPhoto`, `prescan`, `blockUnlinked`,
                `storageId` — because those are written at `:2743` and this line runs eight
                hundred lines later. tsc catches the missing fields today; it would NOT
                catch a future field that happens to be spelt in both places.
                เขียนทีละช่อง ไม่งั้นของที่ด่านเขียนไว้หายทั้งก้อน */
          ladderCtx.slip.verifyResult = slipVerifyResult;
          ladderCtx.slip.recordId = slipRecordId;
          ladderCtx.slip.createdAt = slipCreatedAt;
          ladderCtx.slip.condition = slipCondition;
          ladderCtx.media.mediaUrl = mediaUrl;
          ladderCtx.media.internalContentId = internalContentId;

          /* [FEAT-20260820-STICKERFOLLOWUP] the follow-up flow, in ONE place,
             callable from the two points that may reach it.
             ===========================================================
             WHY IT MOVED (owner, 2026-08-20): "ห้าม sticker ไหลไปทางอื่น
             อนุญาตให้แค่มาหาเรา abandon เลเวล 2" and then "เลเวล 1 ด้วย".

             A sticker never used to get here at all. `SILENT_MESSAGE_TYPES`
             returns a few lines below — some 250 lines ABOVE where this block
             used to sit — so sticker/file/video/audio were stored and then
             dropped. Levels 1 and 2 only ever saw text and images.

             ⚠️ WHY A CLOSURE AND NOT A REORDER. The flow has to stay BELOW the
             assist branch: an admin holding the room silences the bot, and
             hoisting this above that would take the silence away. It also has
             to stay BELOW the rate limiter for text. So the block could not
             simply move — it is still called from exactly where it always ran,
             and a second time from the silent-type gate, which returns on the
             next line. A sticker therefore CANNOT reach the limiter, the
             keyword handler, the AI or the non-text branch: not because a guard
             forbids it, but because no path exists.
             ห้ามไหลไปทางอื่น = ทำให้ไม่มีทางให้ไหล ไม่ใช่ตั้งการ์ดกั้นทีละใบ.

             @returns true when the flow is over and the caller must return.

             revert: paste this body back at its call site below, drop the call
             in the silent-type gate. Stickers die before the gate again. */
          /* [PROG-20260905-G23] The gate's body moved to follow-up/follow-up-flow.ts.
             What stays is the BINDING — one closure so both call sites below pass exactly
             the same values, which is what `follow-up-boundaries.spec.ts` counts. The
             position rules travel with the body: after the customer's message is stored
             and published, above the register keyword. */
          const runFollowUpFlow = (): Promise<boolean> =>
            runFollowUpFlowImpl(
              {
                hook,
                userId,
                event: event,
                accessToken,
                channelId,
                inboundRoom,
                followUpHasProfile,
                existingUser,
                msgContent,
              },
              {
                logger: {
                  log: (m: string) => this.logger.log(m),
                  warn: (m: string) => this.logger.warn(m),
                  error: (m: string) => this.logger.error(m),
                },
                chatHistory: {
                  logMessage: (row: unknown) =>
                    this.chatHistory.logMessage(row as never),
                },
                chatRoomModel: this.chatRoomModel as never,
                chatMessageModel: this.chatMessageModel as never,
                memberModel: this.memberModel as never,
                ticketModel: this.ticketModel as never,
                assignHistoryModel: this.assignHistoryModel as never,
                aiReply: this.aiReply as never,
                sendTextReply: (...a: unknown[]) =>
                  this.sendTextReply(...(a as [string, string, string])),
                publishTicketCreated: (...a: unknown[]) =>
                  this.publishTicketCreated(
                    ...(a as [never, never, never, never]),
                  ),
              },
            );

          // legacy:3010-3013 — stored, then silence. ⚠️ This sits BEFORE the
          // rate limiter, so a sticker is neither answered nor charged quota.
          if (
            event.message?.type &&
            SILENT_MESSAGE_TYPES.includes(event.message.type)
          ) {
            /* [OBS-20260812-IMGPROBE] sticker/file/video/audio die here, BEFORE the
               image_answer branch. That is why only a real `image` can ever reach
               SETTING 3 even though NON_TEXT_AUTO_REPLY_TYPES also lists the others. */
            imgProbe('silent-type-return', { incomingType: event.message.type });
            /* [FEAT-20260820-STICKERFOLLOWUP] a sticker from a customer who is IN
               the abandon flow reaches levels 1 and 2 — and nothing else, because
               this gate still returns on the very next line.
               ⚠️ `!followUpHasProfile` keeps every registered customer on exactly
               the old path: no gate call, no extra read, no write. The flow can
               only ever concern customers with no raw profile, so asking here
               costs everyone else nothing. คนที่มีโปรไฟล์แล้ว = เหมือนเดิมเป๊ะ
               ⚠️ `!skipBotProcessing` preserves the other half of today: a sticker
               sent while an admin holds the room stays silent, as it always was.
               revert: delete these three lines — the return below is untouched. */
            if (!skipBotProcessing && !followUpHasProfile) {
              await runFollowUpFlow();
            }
            /* [FEAT-20260821-RATELADDER] Owner: "รวมทั้ง text + sticker + image + vdo
               (ทุก event)". These types used to leave here UNCHARGED — a sticker
               storm cost nothing and a text right after it still had a full window.
               They are charged now and STAY SILENT (owner's call, 21/08: "นับ แต่
               เงียบเหมือนเดิม"): the verdict is recorded, the return below is
               untouched, no reply, no log row. One call per message — this branch
               returns, so the limiter below never sees these types (no double INCR).
               Each type is its own switch in user-rate-ladder.ts `countedTypes`;
               off = this call is a no-op for that type.

               ⭐ [OWNER-20260823-ASSISTFLOOD] ไม่มี `!skipBotProcessing` ที่นี่ —
               **ตั้งใจ ไม่ใช่บั๊ก** เจ้าของยืนยัน 23/08/2026: *"มันไม่ได้ผิด
               ตั้งใจ กัน flood"*.

               ผลที่ได้คือ ตอนแอดมินรับเคสอยู่ (`assist_status === true`):
                 · text / image  → **ไม่ถูกนับ** (ออกทาง `return` ที่ :3159
                   ก่อนถึงตัวนับหลัก :3174) — เพราะมันคือ *บทสนทนาจริง*
                   ระหว่างลูกค้ากับคน จะไปจำกัดไม่ได้
                 · sticker / file / video / audio → **ยังถูกนับที่บรรทัดล่างนี้**
                   — เพราะไม่ใช่บทสนทนา เป็นของที่ยิงรัวได้ไม่จำกัดและเป็น
                   ช่องทาง flood ที่เหลืออยู่ช่องเดียวตอนบอทเงียบ

               ⚠️ ใครที่มาเห็นความไม่เท่ากันนี้ทีหลังแล้วคิดจะ "แก้ให้ตรงกัน" —
                  อย่าแก้ นี่คือเส้นที่เจ้าของขีดไว้เอง. ถ้าจะเปลี่ยนจริง
                  ต้องถามเจ้าของก่อน และดู `todo/task/23082026/todo14_*.md`. */
            if (event.type === 'message' && event.source?.userId) {
              const v = await this.rateLimit.consume(
                event.source.userId,
                event.message.type,
              );
              // [FEAT-20260824-STRIKESESSION] tap
              void this.strike
                ?.recordFromVerdict(v, event.source.userId, asString(hook?.['_id']), event.message.type, null, asString(hook?.['alias']))
                .catch(() => {});
              if (v.limited) {
                this.logger.log(
                  `[RATELIMIT] ${event.message.type} from ${event.source.userId} limited at level ${v.level} — silent type, not answered`,
                );
              }
            }
            return;
          }

            /* ═══════════════════════════════════════════════════════════════
               [PROG-20260905-LADDER] THE ASSIST-BYPASS SLICE — one step.
               ═══════════════════════════════════════════════════════════════
               An operator is holding the room. WHERE this sits is the feature: below the
               slip verify, so the customer's money is still checked and filed; above the
               rate limiter, the keyword handler, the AI and the non-text branch, so none
               of those speak. The step declares that as `mustFollow`, so it is checked
               rather than defended by this comment alone.

               ⚠️ IT ONLY BECAME MOVABLE WHEN THE HANDOVER MOVED UP. Six of the sixteen
                  values it forwards — the three slip-verify results, `profileData`,
                  `customerTel` and the media url — reached the context ~330 lines BELOW
                  this line until 05/09. Cutting this block before that would have
                  compiled and handed the operator's room an empty slip result.
                  ย้ายบล็อกนี้ได้เพราะ handover ขึ้นมาก่อน ไม่ใช่เพราะบล็อกมันง่าย */
            if (await runLadder(ASSIST_BYPASS_LADDER, ladderCtx, ladderDeps))
              return;

          // [FIX-20260728-RATELIMIT] — legacy:3295-3337. This block was MOVED
          // here, not written: it used to sit below the non-text branch, so an
          // image with `image_answer_text` slipped past it entirely and a
          // customer could spam images without limit while text was capped.
          //
          // ⚠️ It is BELOW the sticker/file/video/audio return, so those stay
          //    silent — and this block never sees them.
          //    [FEAT-20260821-RATELADDER] แก้คอมเมนต์ 23/08: เดิมเขียนว่า
          //    "and uncounted" ซึ่ง**ไม่จริงแล้ว** — ตั้งแต่ 21/08 สี่ชนิดนั้น
          //    ถูกหักโควตาที่ `:2996` ก่อน `return` (เจ้าของ: "นับ แต่เงียบ
          //    เหมือนเดิม") ด้วย **คีย์ใบเดียวกับ text/image** คือ
          //    `ratelimit:<env>:default:<userId>` ⇒ ทุกชนิดนับรวมถังเดียว.
          //    ที่ยังจริงคือ "หนึ่งข้อความ หนึ่ง INCR" — สองจุดนี้ไม่มีทาง
          //    ทำงานพร้อมกันเพราะ `:3005` return ไปแล้ว.
          // ⚠️ `event.type === "message"` was added at the same time: without it
          //    follow/unfollow/postback consumed quota and got answered
          //    "กรุณารอสักครู่".
          // ⚠️ THIS BLOCK MUST EXIST EXACTLY ONCE. The check is an INCR; a second
          //    copy would charge two units per message.
          if (event.type === 'message') {
            userId = event.source?.userId;
            /* [FEAT-20260821-RATELADDER] the ladder decides the window for THIS
               customer (level from strikes, reset 12 h after the first) and hands
               back the sentence to say — or null for silence. With the ladder's
               config at its defaults a customer on level 1 is charged against the
               exact key, limit and window as before, and answered the exact text. */
            const rateVerdict = userId
              ? await this.rateLimit.consume(userId, event.message?.type)
              : null;
            // [FEAT-20260824-STRIKESESSION] tap
            void this.strike
              ?.recordFromVerdict(rateVerdict, userId, asString(hook?.['_id']), event.message?.type, null, asString(hook?.['alias']))
              .catch(() => {});
            const limited = rateVerdict?.limited ?? false;

            if (limited) {
              /* [FIX-20260814-RATELIMITOFF] A switched-off OA stays silent here
               * too. Owner, 14/08, after a live transcript showed an off hook
               * answering "กรุณารอสักครู่" three times in three seconds:
               * "ถ้า hook off limit ติดก็ไม่ต้องตอบ ย้ำว่าถ้า off".
               *
               * This block sits ABOVE every status gate — [FIX-20260728-RATELIMIT]
               * moved it up so images would be counted as well — so it was the
               * one reply that still escaped while the OA was quiet.
               *
               * ⚠️ The `consume()` above is deliberately NOT skipped: the quota
               *    must keep charging while off, or a switched-off hook becomes a
               *    free spam window and the counter is wrong the moment it is
               *    switched back on. Only the ANSWER is suppressed.
               * ⚠️ Returns early, exactly like the answered path, so a limited
               *    message never falls through to the AI below.
               * ⚠️ No webhook_logs row and no chat row either: both would record
               *    a reply that was never sent, and the admin screen would show a
               *    bot bubble the customer never received.
               * revert: delete this `if` block. */
              if (hook?.['status'] === 0) {
                this.logger.log(
                  `[RATELIMIT] hook off — limited but silent (hook=${asString(hook?.['_id'])})`,
                );
                return;
              }
              /* [FEAT-20260821-RATELADDER] the sentence that was hard-coded here now
                 comes from the ladder (`reply.text`, or a level's own `replyText`);
                 `null` = the owner chose silence for that level — return exactly like
                 the hook-off branch above: no send, no row. */
              // `undefined` (a verdict that predates the field, e.g. a spec's bare
              // `{ limited: true }`) = the legacy sentence; ONLY an explicit `null`
              // is silence. ไม่มี field = ข้อความเดิม · null = เงียบ.
              const rateLimitText =
                rateVerdict?.replyText === undefined
                  ? LEGACY_RATE_LIMIT_TEXT
                  : rateVerdict.replyText;
              if (rateLimitText === null) {
                this.logger.log(
                  `[RATELIMIT] level ${rateVerdict?.level ?? 1} — limited, silent by config (user=${userId})`,
                );
                return;
              }
              const lineResponse = await this.sendTextReply(
                accessToken,
                // Passed through EXACTLY as legacy passes it: possibly undefined, which
                // JSON.stringify then drops from the body and LINE answers 400 for. A
                // guard here would skip the call AND the webhook_logs row legacy writes.
                event.replyToken as string,
                rateLimitText,
              );
              await this.wlogEmit({
                ...logContext,
                channel: 'line_api',
                action_type: 'rate_limit_reply',
                method: 'POST',
                endpoint: LINE_REPLY_ENDPOINT,
                status: 'success',
                http_status: lineResponse.status,
                payload_summary: {
                  reply_token: event.replyToken,
                  text: rateLimitText,
                },
                response_summary: lineResponse.data,
                line_event_id: event.eventId,
              });
              void this.chatHistory
                .logMessage({
                  userId,
                  senderType: 'bot',
                  messageType: 'text',
                  content: rateLimitText,
                  hookId: asString(hook?.['_id']),
                  channelType: hook?.['channel_type'] as string | undefined,
                  channelId,
                  replyToken: event.replyToken,
                  // [FEAT-20260831-QUOTESRC] LINE refused ⇒ no keys ⇒ the row of today
                  ...sentMessageIds(lineResponse),
                  metadata: { event_id: event.eventId, reason: 'rate_limit' },
                })
                .catch((e: Error) =>
                  this.logger.error(`[RATELIMIT] Log failed: ${e.message}`),
                );
              return;
            }
          }

          /* ═══════════════════════════════════════════════════════════════
             [PROG-20260905-LADDER] THE CUSTOMER SLICE — the ladder inside
             `if (userId)`, after the rate limiter.
             ═══════════════════════════════════════════════════════════════
             Five decisions used to sit here as raw statements: the two admin
             buttons ([FEAT-20260831-ADMINDIRECT] and
             [FEAT-20260831-ADMINVIAWITHDRAW]), the notice guard for ordinary text
             (cases A-D), the abandon flow, and the `customer-register` keyword.

             ⚠️ THE SLICE STARTS HERE, not at the top of `if (userId)`, because a
                `strike-plug` hunk owns bytes inside the rate limiter above; and it
                STOPS below, because four `menu-plug` hunks own bytes inside the
                non-text branch. Both stay inline until Phase 5.

             ⚠️ ONE COLLABORATOR IS SUPPLIED HERE AND NOWHERE ELSE. The abandon
                flow HAS to stay a closure: the FROZEN silent-type gate calls it too,
                and a linear ladder cannot say "also runs inside that one". So
                `turnDeps` stubs it with a throw that names the reason, and this
                spread replaces it with the real one. `openAdminCase` used to need
                the same treatment and no longer does — every input it wants is on
                the context now, which is what the context lift bought.
          =============================================================== */
          if (
            await runLadder(CUSTOMER_LADDER, ladderCtx, {
              ...ladderDeps,
              runFollowUpFlow,
            })
          ) {
            return;
          }

          /* ===========================================================
             Non-text message — legacy:3388-3856
          =========================================================== */
          /* ===========================================================
             Non-text message — legacy:3388-3856
          =========================================================== */
          if (event.type === 'message' && event.message?.type !== 'text') {
            /* ═══════════════════════════════════════════════════════════════
               [PROG-20260905-LADDER] THE MEDIA SLICE — inside the non-text
               branch, inside `if (userId)`.
               ═══════════════════════════════════════════════════════════════
               Five decisions used to sit here as raw statements: the payment run
               and the slip card (legacy:3439-3734), the `[[[assist]]]` hand-off on
               the image path (legacy:3736-3745), the flex-sent exit
               (legacy:3781-3798), the missing-API-data reply (legacy:3766-3800) and
               the media reply text (legacy:3836-3846).

               ⚠️ EVERY PATH THROUGH THIS BRANCH ENDS THE TURN. That is what makes
                  it a terminal sub-ladder rather than a detour, and why a `'done'`
                  from any of these steps behaves exactly as the original `return`.

               ⚠️ THE SLICE STOPS AT THE SEND. The `try` immediately below belongs
                  to `docs/menu-plug-in.patch` — four hunks own the menu card, the
                  stamp, the wlog row and the history row inside it — so the send
                  stays inline and reads `media.cleanImageAnswer` off the context.
                  Phase 5 or nothing.

               ⚠️ THE SLIP VALUES CROSS A BRANCH to get here: they are written in the
                  IMAGE branch above, which is also frozen, and handed to the context
                  with the rest. That is chain 9 from the dive — the only one that
                  crosses branches, and the reason `slip` is a context group at all.
            =============================================================== */
            const incomingType = event.message?.type ?? 'unknown';
            const isAutoReplyType =
              NON_TEXT_AUTO_REPLY_TYPES.includes(incomingType);
            const rawImageAnswer = hook?.['image_answer_text'] as
              | string
              | undefined;
            ladderCtx.media.incomingType = incomingType;
            ladderCtx.media.rawImageAnswer = rawImageAnswer;

            /* [OBS-20260812-IMGPROBE] SETTING 3 "ค่าตอบกลับเมื่อพบรูปภาพ" as a GATE.
               Empty value ⇒ this whole branch is skipped and the image gets no reply
               at all — and SETTING 2 never gets a turn either, because its guard sits
               inside this block. */
            imgProbe('gate-image-answer', {
              incomingType,
              isAutoReplyType,
              setting_image_answer_text: rawImageAnswer,
              hasValue: Boolean(rawImageAnswer),
              entersBranch: Boolean(
                hook?.['status'] !== 0 && isAutoReplyType && rawImageAnswer,
              ),
            });
            /* [FEAT-20260814-STATUSOFFQUIET] hook off ⇒ no assist, no media reply. One
               condition closes everything this branch contains — the image_answer_text
               reply, the slip flex cards and the assist site. The flow then falls through
               to the non-text return below = fully silent, no ticket, no room claim.
               `!== 0` keeps the ON path byte-identical (owner: "on ห้ามแก้ไข"). */
            if (hook?.['status'] !== 0 && isAutoReplyType && rawImageAnswer) {
              if (await runLadder(MEDIA_LADDER, ladderCtx, ladderDeps)) return;
              const {
                cleanImageAnswer,
                isQrCodeSlip,
                textReplyOverride,
                violationDetected,
                rawImageAnswer,
              } = ladderCtx.media;
              try {
                // [FIX-20260808-SLIPFLOW] legacy:3844-3845 — the camera quick
                // reply is attached only when a QR slip errored/violated.
                const hasSlipError =
                  isQrCodeSlip &&
                  (!slipVerifyResult ||
                    (slipVerifyResult as { success?: boolean }).success !==
                      true ||
                    violationDetected);
                /* [FEAT-20260812-HOOKHELPERFLEX] site 2 of 3 — the helper CARD for
                   `image_answer_text`.
                   ⚠️ Only when there is NO slip error: that branch attaches
                   SLIP_QUICK_REPLY ("send the photo again"), which is the more useful
                   action right then, and the card would replace the text carrying it.
                   revert: delete this const and the ternary below. */
                /* [FEAT-20260831-MENUMAINTAG] an operator may point this field at a
                   stored MENU card: `image_answer_text = "[[[menu_main_00010]]]"`.
                   The resolver above strips the marker — it must, a marker may
                   never reach a customer — so what was left was an EMPTY string
                   and LINE refused it with 400. เจอจริง 31/08 ในของเจ้าของเอง.
                   The card is tried FIRST and the helper card remains the
                   fallback, so a field that names no menu behaves exactly as
                   before. The menu module picks the card, which is what applies
                   its group-ownership rule here too. */
                const menuAnswerTag = hasSlipError
                  ? null
                  : resolveHookTextReply({
                      rawText: textReplyOverride || rawImageAnswer || '',
                      hook,
                      mode: resolveHookTextReplyMode(hook),
                    }).wantedMenuCardTag;
                /* 🔴 ITS OWN SLOT, NOT THE HELPER'S. The first cut routed the menu
                   card through `imageAnswerCard` because that variable was already
                   sent as flex — and that was wrong: a non-null `imageAnswerCard`
                   ALSO means "a customer-helper offer went out". It stamps
                   `stampCustomerHelperTrigger` (door S3 below) and labels the chat
                   row `flex_customerhelper`, and the abandon lookback reads both.
                   เจ้าของจับได้ทันที: "นี่ไม่ใช่ customer-helper" · "abandon ทำงานผิด".
                   A menu is a menu: it is sent, stored and counted as one. */
                const menuAnswerCard = menuAnswerTag
                  ? await this.renderMenuCardByTag(
                      menuAnswerTag,
                      accessToken,
                      hook,
                      userId,
                      {},
                      profileData,
                    )
                  : null;
                const imageAnswerCard =
                  hasSlipError || menuAnswerCard
                    ? null
                    : await this.buildHookHelperFlexFor(
                        textReplyOverride || rawImageAnswer || '',
                        hook,
                        event.source?.userId,
                      );
                const lineResponse = (menuAnswerCard ?? imageAnswerCard)
                  ? await this.sendFlexReply(
                      accessToken,
                      event.replyToken ?? '',
                      (menuAnswerCard ??
                        imageAnswerCard) as unknown as LineFlexContents,
                      (cleanImageAnswer || HELPER_ALT_TEXT).slice(0, 400),
                      /* [FIX-20260902-FLEXLADDER] the reply→push ladder, the
                         same one the text sender in the `else` below already
                         had. Without it a refused reply token lost the CARD
                         while the sentence beside it arrived. `userId` is the
                         LINE id — it is what the neighbouring
                         `stampIfHelperCardDelivered(card, userId, …)` uses and
                         what the one already-laddered flex site passes. */
                      null,
                      userId,
                    )
                  : await this.sendTextReply(
                      accessToken,
                      event.replyToken ?? '',
                      cleanImageAnswer,
                      hasSlipError ? SLIP_QUICK_REPLY : null,
                );
                                // [FIX-20260827-HELPERSTAMPDOORS] door S3 — see the method's note.
                /* only a HELPER card is a helper offer — a menu card is not, and
                   stamping one would tell the abandon rule a story that never
                   happened. `imageAnswerCard` is already null whenever a menu card
                   won, so this call is unchanged in meaning; the note is here
                   because that null is now load-bearing. */
                this.stampIfHelperCardDelivered(imageAnswerCard, userId, lineResponse?.status);
await this.wlogEmit({
                  ...logContext,
                  channel: 'line_api',
                  action_type: 'image_answer_reply',
                  method: 'POST',
                  endpoint: LINE_REPLY_ENDPOINT,
                  status: 'success',
                  http_status: lineResponse.status,
                  payload_summary: {
                    reply_token: event.replyToken,
                    text: cleanImageAnswer,
                    incoming_type: incomingType,
                  },
                  response_summary: lineResponse.data,
                  line_event_id: event.eventId,
                });
                /* [FEAT-20260812-HOOKHELPERFLEX] the chat room must show what the
                   customer actually received — owner: *"เห็นตรงกันทั้ง message chat
                   room + ลูกค้า"*. When the card went out, store it as a `flex` row
                   with its json, mirroring what the AI path does
                   ([FIX-20260810-HELPERFLEXHISTORY]); otherwise store the text exactly
                   as before.
                   ⚠️ `stripHelperUriForHistory` deep-copies and blanks the button's
                      uri: that link carries the CUSTOMER's mint token, and an admin
                      clicking it from the chat page would consume it and leave the
                      real customer with a dead button.
                   revert: drop the two ternaries and keep the original text fields. */
                void this.chatHistory
                  .logMessage({
                    userId,
                    senderType: 'bot',
                    /* [FEAT-20260831-MENUMAINTAG] a MENU card is stored as a menu,
                       not as a helper: same `flex` row, its own label and its own
                       doc id below. The room must show what the customer got, and
                       an operator reading the history has to be able to tell the
                       two apart — the abandon lookback reads this field. */
                    messageType:
                      menuAnswerCard || imageAnswerCard ? 'flex' : 'text',
                    content:
                      menuAnswerCard || imageAnswerCard
                        ? `[Flex] ${cleanImageAnswer || HELPER_ALT_TEXT}`
                        : cleanImageAnswer,
                    hookId: asString(hook?.['_id']),
                    channelType: hook?.['channel_type'] as string | undefined,
                    channelId,
                    replyToken: event.replyToken,
                    // [FEAT-20260831-QUOTESRC] same spread as its sibling sites
                    ...sentMessageIds(lineResponse),
                    metadata: {
                      event_id: event.eventId,
                      auto_reply_type: menuAnswerCard
                        ? 'flex_menu'
                        : imageAnswerCard
                          ? 'flex_customerhelper'
                          : 'image_answer_text',
                      incoming_type: incomingType,
                      /* the menu card carries no mint token, so nothing has to be
                         blanked out of it — `stripHelperUriForHistory` exists for
                         the helper's single-use link and would be a lie here. */
                      ...(menuAnswerCard && {
                        flex_json: menuAnswerCard,
                        flex_menu_tag: menuAnswerTag,
                      }),
                      ...(imageAnswerCard && {
                        flex_json: stripHelperUriForHistory(imageAnswerCard),
                        flex_doc_id: hook?.['flex_customerhelper_id'] ?? null,
                      }),
                    },
                  })
                  .catch((err: Error) =>
                    this.logger.error(
                      `[ASSIST] Failed to log image_answer_text to history: ${err.message}`,
                    ),
                  );
                return;
              } catch (err) {
                // legacy:3849-3851 — `res.status(500).send("Reply failed")`.
                // ⚠️ `res.status()` returns the mock, so the PATCHED `send` still
                //    ran: this terminal re-assists. The finally below covers it.
                this.logger.error(
                  `[ASSIST] Failed to send image_answer_text: ${errText(err)}`,
                );
                return;
              }
            }

            // legacy:3855 — non-text with nothing configured to say.
            return;
          }
        }

        /* ═══════════════════════════════════════════════════════════════════
           [PROG-20260905-LADDER] THE LADDER TAIL — `gates/`, ordered by
           `gates/ladder-order.ts`.
           ═══════════════════════════════════════════════════════════════════
           TWELVE decisions used to sit here as raw statements, in this order: the
           switched-off OA (legacy:3859-3913) · the registered-event seat · the
           no-text return (legacy:3916-3920) · the failed-profile stamp
           (legacy:3922-3928) · document retrieval (legacy:4017-4078) · the model
           turn (legacy:4122-4256) · the api-error refusal (legacy:4259-4306) · the
           reply-text choice (legacy:4308-4314) · the bot's chat row
           (legacy:4316-4330) · the audit row · the Telegram page
           (legacy:4368-4427) · the assist hand-off (legacy:4429-4457).

           WHAT ACTUALLY MOVED IS THE ORDER. Most of the bodies were already in role
           directories; what was still only expressible as a LINE NUMBER was which
           runs before which — so each one carried a comment block defending its
           position, and a comment is enforced by whoever happens to read it. Each
           step now declares `mustFollow`/`mustPrecede` with the reason, and
           `gate-ladder-order.spec.ts` proves the shipped order satisfies all of
           them. Three rules that were prose until now and are checked from here on:
           out-of-hours must stay BELOW the non-text branch or a switched-off OA
           stops answering images; the ctx-var substitution must stay AFTER retrieval
           or two hooks sharing a document read each other's domain; the api-error
           refusal can only be asked AFTER the model has answered.

           ⚠️ FOUR VALUES ARE ASSIGNED BACK, and that is not tidiness.
              `bangkokTime` and `perfAiMs` are METHOD-SCOPE `let`s that code below
              still closes over — `assistTurn()` re-reads the clock at the moment of
              each call, and the perf summary prints the model time. A step that
              wrote only the context would leave both stale with every test still
              green, because the shape would be right and only the values wrong.
              `replyText`, `responseAi` and `botChatMsg` are what the send still
              needs. Safe to read after the early return: a step that writes cannot
              also have ended the turn.

           revert: paste the twelve blocks back in this order and delete `gates/`.
        =============================================================== */
        if (await runLadder(TAIL_LADDER, ladderCtx, ladderDeps)) return;
        /* Only `bangkokTime` still has to come back: `assistTurn()` closes over the
           METHOD's local and re-reads it at the moment of each call. Everything else the
           reply needs now travels on the context to the second slice — the assign-backs
           this cut deleted (`userText`, `responseAi`, `botChatMsg`, `perfAiMs`) existed
           only to hand values across code that has since moved. */
        /* Only `bangkokTime` still comes back: `assistTurn()` closes over the METHOD's
           local and re-reads it at the moment of each call. */
        bangkokTime = ladderCtx.bangkokTime;

        // [FIX-20260728-DEADCODE] Not a change — a note. `replyViaPush` can never
        // be true: the only assignment is inside the commented-out auto-reply
        // block (legacy:3936-4015). Every branch that tests it is dead code.
        // Kept so the shape of the send below matches legacy line for line.
        const replyViaPush = false;

        /* UNPORTED ON PURPOSE — legacy:4459-4484, `analyzeCategoryFromRoom`.
         *
         * [NOTE-20260810-CATEGORYUNPORTED] Owner confirmed 2026-08-10: this is a
         * DELIBERATE omission, not a gap waiting to be filled. The classifier is
         * acme's, and its prompt hard-codes acme's own twenty
         * lending/collections categories (`rag-engine.service.ts:1901` —
         * "สอบถามยอดหนี้/ค้างชำระ", "ขอเลื่อน/ผ่อนผันชำระ", "ทวงถาม/ติดตามหนี้"…).
         * acme runs two of these taxonomies, a 4-category one and this
         * 20-category one; neither describes a general OA, so classifying every
         * tenant's rooms with it would label them from a domain they are not in.
         *
         * The `acme_category` flag above (:398) is the switch that gates the
         * feature, and it defaults OFF for exactly this reason — its own comment:
         * "Defaulting ON would start writing model-chosen categories on a
         * deployment that never opted in".
         *
         * ⚠️ DO NOT "finish" this port as tidy-up. Wiring it in would send every
         * hand-off through an extra billed model call AND write a acme
         * category onto rooms that never asked for one. If it is ever wanted, it
         * belongs behind the flag and behind its own seam — see
         * `todo/be_todo17_10082026.md` §3.
         *
         * `categorySettled` is legacy's already-resolved default for the case
         * where category analysis did not run — the value the history rewrites
         * chain off. ตั้งใจไม่พอร์ต ไม่ใช่ของค้าง.
         */
        /* [PROG-20260905-LADDER] `categorySettled` is built with the context now — it is
           legacy's already-resolved default for the category analysis that is deliberately
           NOT ported, and the send is its only reader. */

        /* [PROG-20260905-LADDER] the reply tags (legacy:4487-4529), the tag-based image
           carousel (legacy:4534-4646) and the customer-helper swap (legacy:4648-4671) are
           now steps in the first slice. What comes back are the three values the FROZEN
           flex build below reads by name — `tags` is a byte of `docs/menu-plug-in.patch`
           (`tags.wantedMenuCardTag`), so it has to stay a local spelled exactly this way.
           `finalReplyForLine` is no longer read here at all: the flex_pc guard and the
           staleness warn are both steps now, and they read it off the context. */
        const tags = ladderCtx.tags;
        const replyBodyForLine = ladderCtx.replyBodyForLine;


        // [FIX-20260808-FLEXBUILDER] The three card routes — legacy:4688-4696.
        // Picks profile / tag / profile-custom builder from the reply shape and
        // assembles a real flex card, its variables filled from the customer's
        // profile via buildFlexVarMaps (translate closed over here). null still
        // means "could not build" → fall through to plain text, exactly as before.
        const flexDeps = {
          flexModel: this.flexModel,
          buildDataVars: (
            doc: Parameters<typeof buildFlexVarMaps>[0],
            profileData: unknown,
            hook: Record<string, unknown> | null | undefined,
          ) =>
            buildFlexVarMaps(doc, profileData, hook, (dict, key, opts) =>
              this.translationDict.translate(dict, key as never, opts),
            ),
        };
        const flexArgs = {
          hook: hook ?? null,
          profileData,
          content: replyBodyForLine,
        };
        // [FIX-20260808-FLEXGATE] Restore legacy's per-branch build gate
        // (webhookController.js:4774-4781): each card builds when
        // `<tag> && !(replyViaPush && userId)`, which with `replyViaPush`
        // constant-false means "always build". A prior port collapsed the three
        // guards into one leading `replyViaPush && userId ? … : null` — legacy's
        // condition with the `!` dropped — so `flexProfileContents` was ALWAYS
        // null and every [[[flex_profile]]] / [[[flex_mNNNNN]]] / [[[flex_pcNNNNN]]]
        // answer silently degraded to plain text (or the flex_pc apology). The
        // per-branch `!(replyViaPush && userId)` restores parity exactly.
        /* [FIX-20260822-FLEXHISTORYTYPE] remember WHICH branch built the card and
           which doc it rendered (`flexOut`, filled by the builder). Three kinds
           converge into `flexProfileContents`; the history patch below used to
           tell only helper from "everything else" and labelled every flex_m /
           flex_pc card "flex_profile" with the profile doc's id. */
        const flexOut: FlexReplyOut = {};
        const flexKind: FlexCardKind | null =
          tags.wantsFlexProfile && !(replyViaPush && userId)
            ? 'profile'
            : tags.wantedFlexTag && !(replyViaPush && userId)
              ? 'tag'
              : tags.wantedFlexPcTag && !(replyViaPush && userId)
                ? 'pc'
                /* [FIX-20260901-MENUKINDMISSING] the rung that was never built.
                   `FlexCardKind` has carried `'menu'` since 31/08 and the sender
                   below already reads `flexKind === 'menu'` — but nothing ever
                   SET it, so that branch was unreachable and a menu tag in an AI
                   answer or in a hook fallback field produced no card at all.
                   Dead since the day it shipped, silently: no error, no log.

                   LAST on purpose. A card replaces the text and only one can go
                   out, so the three flex families keep the precedence they had;
                   adding a rung below them cannot change what they answer.

                   Same `!(replyViaPush && userId)` guard as its siblings: on the
                   push path a card is not sent, and claiming a kind here would
                   mislabel the history row.
                   revert: delete this rung — the sender goes back to unreachable. */
                : tags.wantedMenuCardTag && !(replyViaPush && userId)
                  ? 'menu'
                  : null;
        const flexProfileContents = ((flexKind === 'profile'
          ? await buildFlexProfileReply({ ...flexArgs, out: flexOut }, flexDeps)
          : flexKind === 'tag'
            ? await buildFlexTagReply(
                { ...flexArgs, flexTag: tags.wantedFlexTag, out: flexOut },
                flexDeps,
              )
            : flexKind === 'pc'
              ? await buildFlexProfileCustomReply(
                  { ...flexArgs, flexTag: tags.wantedFlexPcTag, out: flexOut },
                  flexDeps,
                )
              : /* [FEAT-20260831-MENUMAINTAG] rendered by the MENU module, sent by
                   this path. The engine picks the card — with the group-ownership
                   check and the button preservation its stored renderer already
                   enforces — and hands back the contents; delivery, history and the
                   reply/push ladder stay here, exactly as for the three families
                   above. การ์ดให้โมดูลเมนูเลือก · ส่งด้วยเส้นเดิม
                   ⚠️ The `: null` line below is left BYTE-IDENTICAL on purpose:
                      `docs/menu-plug-in.patch` must stay add-only, so the menu
                      wiring may never rewrite a line that existed before it. */
                flexKind === 'menu'
                ? await this.renderMenuCardByTag(
                    String(tags.wantedMenuCardTag),
                    accessToken,
                    hook,
                    userId,
                    flexOut,
                    profileData,
                  )
              : null) ?? null) as Record<string, unknown> | null;

        /* [FEAT-20260822-AIPROMPTLOG] rare-event line: the model asked for a
           ═══════════════════════════════════════════════════════════════════
           🔴 THE THREE LINES ABOVE ARE BYTE-LOAD-BEARING — the blank line and the
           `/* [FEAT-20260822-AIPROMPTLOG] rare-event line: the model asked for a`
           line are the TRAILING CONTEXT of the menu plug's hunk
           (`docs/menu-plug-in.patch:810-812`), together with the `: null)` line.
           This cut deleted them and `git apply --check -R docs/menu-plug-in.patch`
           went red immediately — the G20 trap, caught by the gate rather than by
           reading. The probe's own text now continues below; the first line has to
           stay spelled exactly as it is. ห้ามแตะสามบรรทัดนี้ มันเป็น context ของ patch

           [PROG-20260905-LADDER] THE REPLY LADDER — the ladder's SECOND slice.
           ═══════════════════════════════════════════════════════════════════
           Five decisions used to sit here as raw statements: the TAG-STRIP probe
           (a card was asked for and none was built), the flex_pc safe text, the
           empty-reply return, the staleness guard (legacy:4721-4739) and the send
           itself (legacy:4949).

           ⚠️⚠️ WHY THE LADDER IS IN TWO PIECES — it is a plug patch, not a design
              preference. The flex build directly above (`flexDeps` → `flexArgs` →
              `flexOut` → `flexKind` → `flexProfileContents`) is ONE expression whose
              tail is a `docs/menu-plug-in.patch` box: it owns `flexKind === 'menu'`,
              `tags.wantedMenuCardTag`, `flexOut` and the closing
              `: null) ?? null) as Record<string, unknown> | null;` as BYTES. Those
              names must therefore stay locals of this method, and an expression
              cannot be cut in half. The build moves at Phase 5 or not at all — so the
              ladder stops before it and resumes after.
              บันไดขาดเพราะกล่อง patch คั่น ไม่ใช่เพราะออกแบบให้ขาด

           The same context and the same deps are reused, so resuming costs one line
           rather than a second turn's worth of wiring — which is the whole reason the
           split is affordable at all.
        =============================================================== */
        /* Only what the FROZEN flex build produced goes back on the context — `tags`,
           `finalReplyForLine`, `useHelperQr` and `replyBodyForLine` are written by steps
           now, and assigning them here would overwrite a step's work with a stale copy. */
        ladderCtx.flexProfileContents = flexProfileContents;
        ladderCtx.flexKind = flexKind;
        ladderCtx.flexOut = flexOut;
        await runLadder(REPLY_LADDER, ladderCtx, ladderDeps);
        // legacy:4949 — every path through the reply ladder ends the turn.
        return;
      } finally {
        // ═══════════════════════════════════════════════════════════════
        // legacy:2441-2452, the patched `res.send`.
        // Exactly one terminal fires per request, so this runs exactly once —
        // for the reply path, for every early return above, for the image-answer
        // 500 at 3851, and for the outer catch at 4967 (the exception passes
        // through here on its way out).
        // ═══════════════════════════════════════════════════════════════
        if (forceReAssistAfterReply && userId && hook?.['_id']) {
          void this.chatRoomModel
            .updateOne(buildRoomFilter(userId, hook['_id']), {
              $set: {
                assist_status: true,
                last_assist_changed_at: new Date(),
              },
            })
            .exec()
            .then(() => {
              this.logger.log(
                `[ASSIST] Re-enabled assist_status for ${userId} after answering the >${autoUnassistTriggeredMinutes ?? 30} min message.`,
              );
            })
            .catch((e: Error) =>
              this.logger.error(`[ASSIST] Error re-assisting: ${e.message}`),
            );
        }
      }
    } catch (err) {
      // legacy:4950-4967 — the outer catch. Writes one error row and then ends
      // the request "successfully"; there is nobody left to tell.
      // [FEAT-20260815-WLOGDOOR] B1 — typed door. `logContext` is spread FIRST,
      // exactly as before: it carries hook_id/hook_alias/group_id plus the two
      // key masks, and the literal below deliberately overrides nothing in it.
      await this.wlogEmit({
        ...logContext,
        channel: 'webhook',
        action_type: 'handle_webhook',
        method: meta.method,
        endpoint: meta.originalUrl,
        status: 'error',
        error_message: errText(err),
        payload_summary: {
          alias,
          doc_id: docId,
          event_id: event?.eventId,
        },
        request_meta: this.buildErrorPayload(meta, event?.eventId),
      });
      this.logger.error(`/webhook error: ${errText(err)}`);
    }
  }

  /**
   * legacy:2458 — `ragService.validateSignature`.
   *
   * The same HMAC the guard already ran. Kept because legacy runs it twice and
   * the second failure is a distinct, logged condition (the two checks
   * disagreeing about the secret or the body).
   */
  /**
   * [FEAT-20260812-HOOKHELPERFLEX] the customer-helper CARD for a hook-field reply.
   *
   * One wrapper for all three send sites (`missing_api_data_text`,
   * `image_answer_text`, `default_answer_text`) so each of them stays two lines and
   * the mint/lookup wiring is written once. It binds the SAME `mintLinkToken` and flex
   * lookup the AI path uses, so the card and its button are identical on both routes.
   *
   * @returns the card, or `null` meaning "send your text as usual" — returned whenever
   *          `hook_text_reply_mode` is not 'flex', the field has no marker, or anything
   *          failed. Never throws.
   */
  /* [FEAT-20260822-NOTICERUNTIME] deps assembly for the notice guard. The
   * flow touches the feature only through the two call blocks above (text
   * path before abandon; image path between jsQR and Swiftcheck) — everything
   * the guard does lives in ./notice-runtime, injected here the way
   * runFollowUpGate takes its deps. false = proceed byte-identical.
   * revert: delete this method, its import line, and the two call blocks. */
  private async tryNoticeGuard(args: {
    /* [FEAT-20260831-ADMINVIAWITHDRAW] consult only these cases. Omitted ⇒ all
       of them, which is what both original call sites do. */
    cases?: readonly NoticeCase[];
    eventKind: 'text' | 'image';
    hook: Record<string, unknown> | null | undefined;
    member: unknown;
    userId: string;
    accessToken: string;
    replyToken: string;
    eventId?: string;
    channelId?: string;
    profileData: unknown;
    logContext: Partial<WebhookLogEvent>;
    text?: unknown;
    qrReason?: string;
    /* [FIX-20260822-NOTICECOLLIDE] an operator holds this room — the guard
       stays silent (policy NOTICE_RESPECTS_ASSIST), the same way every other
       reply site here already does. */
    assisted?: boolean;
    /* [FIX-20260822-NOTICECOLLIDE] image path only: the guard answers above the
       rate ladder, so it charges the ladder itself rather than letting a slip
       through uncounted. [FIX-20260822-NOTICEQUOTA] it calls this ONLY after a
       card has really gone out — that is what keeps the count at exactly one
       per event, since a guard that sends nothing leaves the counting to the
       limiter below. */
    consumeQuota?: () => Promise<{ limited: boolean }>;
    logCustomerRow?: () => Promise<unknown>;
  }): Promise<boolean> {
    const hookBag = args.hook ?? {};
    const now = new Date();
    return runNoticeGuard(
      {
        eventKind: args.eventKind,
        hook: hookBag,
        text: args.text,
        qrReason: args.qrReason,
        assisted: args.assisted,
        siteRulesRaw: pickByRole(args.profileData, 'site_rules', /site.?rule/i)
          ?.block?.['data'],
        now,
      },
      {
        ...(args.cases ? { cases: args.cases } : {}),
        member: args.member,
        memberModel: this.memberModel as never,
        channelUserId: args.userId,
        loadCard: async (flexId) => {
          const doc = (await this.flexModel
            .findById(String(flexId))
            .lean<Record<string, unknown>>()
            .exec()) as Parameters<typeof renderFlexDoc>[0] | null;
          if (!doc) return null;
          const vars = buildFlexVarMaps(
            doc,
            args.profileData,
            hookBag,
            (dict, key, opts) =>
              this.translationDict.translate(dict, key as never, opts),
          );
          return renderFlexDoc(doc, vars, '', hookBag);
        },
        consumeQuota: args.consumeQuota,
        logCustomerRow: args.logCustomerRow,
        logBotRow: ({ card, flexDocId, caseId }) => {
          void this.chatHistory
            .logMessage({
              userId: args.userId,
              senderType: 'bot',
              messageType: 'flex',
              content: NOTICE_ALT_TEXT,
              hookId: asString(hookBag['_id']),
              channelType: hookBag['channel_type'] as string | undefined,
              channelId: args.channelId,
              replyToken: args.replyToken,
              metadata: {
                event_id: args.eventId,
                reason: `notice_case_${caseId}`,
                auto_reply_type: `flex_notice_${caseId.toLowerCase()}`,
                flex_json: card,
                flex_doc_id: flexDocId,
              },
            })
            .catch((e: Error) =>
              this.logger.error(
                `[NOTICERUNTIME] history log failed: ${e.message}`,
              ),
            );
        },
        /* [FEAT-20260828-PUSHCORE-A1] through the core — and the THROW here is
           load-bearing in a way `notice-guard.helper.ts:229-240` spells out
           itself: it sets `sent = true`, writes the bot row, stamps the member
           as "already warned" and charges the quota ONLY on the lines AFTER this
           call. Its own comment: "a row written beforehand would then claim a
           card the customer never saw — the admin screen and the phone would
           disagree". A non-throwing send would stamp and charge for a card that
           never arrived, and the member would never be warned again.
           ส่งไม่ผ่านต้องไม่ stamp ว่าเตือนแล้ว */
        sendFlex: (card, altText) =>
          noticeFlexReply(
            (req) => this.paymentSender().dispatch(req),
            args.accessToken,
            args.replyToken,
            card,
            altText,
            /* [FIX-20260902-NOTICEPUSH] the reply→push ladder, which this seat
               was the only flex sender to lack. `args.userId` is the LINE id —
               it is what `channelUserId` is set from a few lines below, and the
               guard hands that to `writeMemberConfig({line_user_id})`.
               The throw the block above calls load-bearing is UNCHANGED:
               `replyThenPush` still throws with no userId, still throws when the
               refusal is not a reply-token refusal, and still throws the reply's
               error when both legs fail. Only "the push delivered" is new, and
               stamping on that is right — the customer got the card. */
            args.userId,
          ),
        wlog: async ({ actionType, httpStatus, responseSummary }) => {
          await this.wlogEmit({
            ...args.logContext,
            channel: 'line_api',
            action_type: actionType,
            method: 'POST',
            endpoint: LINE_REPLY_ENDPOINT,
            status: 'success',
            http_status: httpStatus,
            payload_summary: {
              reply_token: args.replyToken,
              notice: actionType,
            },
            response_summary: responseSummary,
            line_event_id: args.eventId,
          });
        },
        warn: (m) => this.logger.warn(m),
        now,
      },
    );
  }

  private buildHookHelperFlexFor(
    rawText: string | null | undefined,
    hook: Record<string, unknown> | null | undefined,
    channelUserId: unknown,
    /* [FIX-20260819-REFUSALMARKERMODE] optional, and omitted by the three
       original callers — they keep reading the hook's own mode exactly as
       before. Only the slip-refusal site passes one. */
    modeOverride?: HookTextReplyMode,
  ): Promise<Record<string, unknown> | null> {
    return buildHookHelperFlex(
      {
        rawText,
        hook,
        channelUserId,
        mode: modeOverride ?? resolveHookTextReplyMode(hook),
      },
      {
        mintLinkToken: (i) => this.customerLink.mintLinkToken(i),
        findFlexById: (id) =>
          this.flexModel
            .findById(String(id))
            .lean<Record<string, unknown>>()
            .exec(),
        warn: (m) => this.logger.warn(m),
      },
    );
  }

  /**
   * [FIX-20260827-HELPERSTAMPDOORS] Stamp the helper offer at EVERY door the
   * card actually leaves through — not only the AI one.
   * 📖 todo/task/27082026/todo7_27082026_helper-stamp-all-doors.md
   * ==========================================================================
   * PROVEN ON STG (27/08, member "ek"): a customer sent a slip with no linked
   * profile, the refusal branch answered with the customer-helper CARD
   * (`slip_refused_no_profile_flex`, LINE 200) — and
   * `customer_helper_trigger_at` stayed null, because the only stamp call sat
   * on the AI path. Four non-AI sites send this same card
   * (`buildHookHelperFlexFor` at the slip-refusal, no-profile guard,
   * image-answer and api-missing branches); every one of them must record the
   * offer, or campaigns keyed on this stamp silently skip those customers.
   *
   * REUSES the existing stamp WHOLE — `stampCustomerHelperTrigger` and its rule
   * are called, never modified (owner's standing order). `offered` here is
   * "the helper card was built" (card !== null): at these four sites that IS
   * the offer, byte for byte.
   * ⚠️ The AI site (:5320) deliberately does NOT use this wrapper — its
   * `offered` is `useHelperQr`, which also covers the text+quick-reply shape
   * with no flex card. Folding it in would change that meaning.
   *
   * 🔴 SEAMLESS, layer on layer — this must never cost a customer their reply:
   *   1. called AFTER the LINE send at every site;
   *   2. fire-and-forget (`void` inside) — nothing on the reply path awaits it;
   *   3. `card == null` returns before touching anything — zero I/O on every
   *      plain-text pass through these branches;
   *   4. the stamp helper itself swallows every error, and the extra catch
   *      here keeps even a synchronous surprise from escaping.
   * revert: delete this method and its four one-line call sites.
   */
  private stampIfHelperCardDelivered(
    card: Record<string, unknown> | null | undefined,
    channelUserId: string | undefined,
    httpStatus: unknown,
  ): void {
    if (!card) return; // no card = no offer — and zero cost on this path
    try {
      void stampCustomerHelperTrigger({
        memberModel: this.memberModel,
        channelUserId: channelUserId ?? '',
        offered: true,
        sent:
          typeof httpStatus === 'number' &&
          httpStatus >= 200 &&
          httpStatus < 300,
        warn: (m: string) => this.logger.warn(m),
      });
    } catch {
      /* the reply is already out — a lost stamp must stay a lost stamp */
    }
  }

  private validateSignature(
    body: Buffer | string,
    signature: string | undefined,
    channelSecret: string,
  ): boolean {
    if (!signature || !channelSecret || !body) return false;
    try {
      const hash = createHmac('SHA256', channelSecret)
        .update(body)
        .digest('base64');
      const a = Buffer.from(hash, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Telegram webhook processing (fully ported)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Handles Telegram webhook callbacks — assist on/off/restore buttons.
   *
   * Ported from: legacy-api/src/controllers/core-bot/telegramWebhookController.js
   *
   * This handler is fully functional — it updates ChatRoom assist_status and
   * sends Telegram API responses. Unlike LINE processing, it has no dependency
   * on unported services.
   */
  async processTelegramWebhook(
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
  ): Promise<void> {
    // [SEC-M3 2026-08-02] verify Telegram secret token — legacy:6-18
    const expectedSecret = this.channel.telegramWebhookSecret;
    if (expectedSecret) {
      const got = headers['x-telegram-bot-api-secret-token'];
      if (got !== expectedSecret) {
        // Throw so the controller can return 403
        throw new TelegramSecretMismatchError();
      }
    }

    const callbackQuery = body.callback_query as
      | {
          data?: string;
          id?: string;
          from?: { first_name?: string; last_name?: string };
          message?: {
            chat?: { id?: number };
            message_id?: number;
            reply_markup?: {
              inline_keyboard?: Array<
                Array<{ text: string; callback_data?: string }>
              >;
            };
          };
        }
      | undefined;
    if (!callbackQuery?.data) return;

    const data = callbackQuery.data;
    const parts = data.split(':');
    if (parts.length !== 3) return;

    const action = parts[0]!;
    const alias = parts[1]!;
    const mongoChatId = parts[2]!;

    let assistStatus: boolean | null = null;
    if (action === 'on') assistStatus = true;
    else if (action === 'off') assistStatus = false;

    let displayName = 'ลูกค้า';

    /**
     * [FIX-20260818-TGSCOPE · plan §2.4 B3 = T2-1 of fix_plan_18_aug, closes C5]
     * The hook is resolved BEFORE the write, not after it. Two things follow:
     *
     * 1. The feature turns ITSELF off. A deployment where no OA has a
     *    `telegram_key` — which is every OA today, 0 of 7 — now does nothing at
     *    all here instead of relying on an env var somebody must remember to set.
     * 2. The write can be scoped. `mongoChatId` arrives inside the callback
     *    payload and used to be trusted on its own: any room id flipped any
     *    room's `assist_status`, and `alias` — the only thing naming an OA — was
     *    never consulted. Now the room must belong to the OA the callback claims.
     *
     * The lookup itself is unchanged (same cache-first `getHookByAlias`, same
     * decrypt); only its position moved. ย้ายที่ ไม่ได้เปลี่ยนวิธี
     */
    let telegramKey: string | null = null;
    let hookConfig: Record<string, unknown> | null = null;
    if (alias) {
      try {
        // Cache-first, same three-layer path as the LINE lookup.
        hookConfig = (await this.hookCache.getHookByAlias(alias));
        if (hookConfig?.['telegram_key']) {
          telegramKey =
            this.crypto.safeDecrypt(hookConfig['telegram_key'] as string) ??
            null;
        }
      } catch (err) {
        this.logger.error(
          `Error fetching hook for alias ${alias}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    /* Gate on the DECRYPTED key, not on the field being present: a row whose
       ciphertext no longer decrypts (a rotated ENCRYPTION_KEY) cannot answer
       Telegram anyway, so treating it as "not configured" is the honest state. */
    if (!telegramKey || !hookConfig) return;

    // Update DB only if action is on or off — legacy:42-58
    if (assistStatus !== null) {
      const updateFields: Record<string, unknown> = {
        assist_status: assistStatus,
        last_assist_changed_at: new Date(),
      };
      if (assistStatus === true) {
        updateFields.recently_assisted_at = new Date();
      }

      /**
       * ⚠️ `.populate('user_id', 'display_name')` is LOAD-BEARING — `displayName`
       * below is read from it and goes into the Telegram card's text. Dropping it
       * would leave every card saying "ลูกค้า".
       *
       * `hook_id` in the filter is the scope: `String(...)` because a cached hook
       * is plain JSON (the cache round-trips it through JSON), and Mongoose casts
       * the string to the ObjectId the schema declares.
       */
      const room = await this.chatRoomModel
        .findOneAndUpdate(
          { _id: mongoChatId, hook_id: String(hookConfig['_id']) },
          { $set: updateFields },
        )
        .populate('user_id', 'display_name')
        .exec();

      this.logger.log(
        `Updated ChatRoom ${mongoChatId} assist_status to ${String(assistStatus)}`,
      );

      if (room) {
        const userDoc = room.user_id as unknown as {
          display_name?: string;
        } | null;
        if (userDoc?.display_name) {
          displayName = userDoc.display_name;
        }
      }
    }

    // (the hook was resolved above — see [FIX-20260818-TGSCOPE])
    const callbackId = callbackQuery.id;
    if (!telegramKey || !callbackId) return;

    try {
      const from = callbackQuery.from;
      const tgFirstName = from?.first_name || '';
      const tgLastName = from?.last_name || '';
      const adminName = `${tgFirstName} ${tgLastName}`.trim() || 'Admin';

      let popupText = '';
      if (action === 'on') {
        popupText =
          `💬 (โดย ${adminName}) อัพเดทสถานะเป็น ตอบด้วย Admin เปิด ✅ ` +
          `สำหรับ member : ${displayName} เรียบร้อยแล้ว ❗ Bot จะไม่ทำการตอบกลับ`;
      } else if (action === 'off') {
        popupText =
          `🤖 ❗ ⭐ (โดย ${adminName}) อัพเดทสถานะเป็น ปิด สำหรับ member : ` +
          `${displayName} เรียบร้อยแล้ว Bot AI จะทำการตอบกลับ auto`;
      } else if (action === 'restore') {
        popupText = `🔄 (โดย ${adminName}) คืนค่าปุ่มเปิด/ปิด เรียบร้อยแล้ว`;
      }

      // 1. Answer the callback query — legacy:90-94
      await fetch(
        `https://api.telegram.org/bot${telegramKey}/answerCallbackQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackId,
            text: popupText,
            show_alert: true,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      // 2. Push message to the group — legacy:97-103
      const message = callbackQuery.message;
      const chatId = message?.chat?.id;
      if (chatId) {
        await fetch(`https://api.telegram.org/bot${telegramKey}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: popupText }),
          signal: AbortSignal.timeout(10_000),
        });
      }

      // 3. Update inline keyboard logic — legacy:106-155
      const messageId = message?.message_id;
      if (chatId && messageId) {
        let newInlineKeyboard: Array<
          Array<{ text: string; callback_data: string }>
        > = [];

        if (action === 'restore') {
          newInlineKeyboard = [
            [
              {
                text: '✅ ตอบด้วย Admin (On)',
                callback_data: `on:${alias}:${mongoChatId}`,
              },
              {
                text: '❌ ปิดการตอบด้วย Admin (Off)',
                callback_data: `off:${alias}:${mongoChatId}`,
              },
            ],
          ];
        } else {
          const replyMarkup = message?.reply_markup;
          const currentKeyboard = replyMarkup?.inline_keyboard ?? [];
          const remainingButtons: Array<{
            text: string;
            callback_data: string;
          }> = [];

          for (const row of currentKeyboard) {
            for (const btn of row) {
              if (
                btn.callback_data &&
                !btn.callback_data.startsWith(`${action}:`)
              ) {
                remainingButtons.push({
                  text: btn.text,
                  callback_data: btn.callback_data,
                });
              }
            }
          }

          if (remainingButtons.length > 0) {
            newInlineKeyboard = [remainingButtons];
          } else {
            newInlineKeyboard = [
              [
                {
                  text: '🔄 คืนค่า',
                  callback_data: `restore:${alias}:${mongoChatId}`,
                },
              ],
            ];
          }
        }

        try {
          await fetch(
            `https://api.telegram.org/bot${telegramKey}/editMessageReplyMarkup`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: newInlineKeyboard },
              }),
              signal: AbortSignal.timeout(10_000),
            },
          );
        } catch (editErr) {
          // Ignore errors like 400 Bad Request: message is not modified
          this.logger.warn(
            `Failed to edit reply markup: ${editErr instanceof Error ? editErr.message : String(editErr)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Error answering callback query or sending message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * ==== [FEAT-20260808-PAYTOOL-P3] run payment for a freshly verified slip ====
   *
   * Called at BOTH slip seams (assist + non-assist) just before
   * `handleSlipFlex`. Returns whether the payment tool ANSWERED this slip, which
   * the caller passes on as `suppressSlipReply` so the customer is not shown two
   * cards for one slip.
   *
   * ⚠️ RETURNS false FOR EVERY "DID NOT RUN" CASE — and that is the property that
   * keeps this feature invisible when it is off. The runner self-gates on:
   * payment tool OFF, slip not Swiftcheck-success, slip flagged duplicate, a run
   * already exists, the slip already locked. In ALL of those `ran` is false ⇒ no
   * reply ⇒ nothing suppressed ⇒ the legacy slip card goes out exactly as
   * before. เปิดหรือปิด ก็ไม่กระทบของเดิม.
   *
   * ⚠️ NEVER THROWS. `runForSlip` already captures its own errors, and this adds
   * a second net: a payment failure must never abort the slip flow, because the
   * legacy card + the deposit callback still have to happen.
   *
   * ORDER MATTERS — payment runs BEFORE the card is sent, not after: the card
   * send is what we may need to suppress, so the decision has to exist first.
   */
  private async runPaymentForSlip(args: {
    hook: Record<string, unknown> | null | undefined;
    slipRecordId: unknown;
    accessToken: string;
    replyToken: string;
    /**
     * [FEAT-20260810-PAYSTATEFLEX] Inputs for the per-state card, taken from the
     * caller's scope because that is where they already exist — the same values
     * `handleSlipFlex` receives. Absent ⇒ no card is resolved and every reply
     * behaves exactly as it did before the feature.
     */
    slipVerifyResult?: unknown;
    slipCreatedAt?: Date | string | number | null;
    baseUrl?: string;
    /** Optional: the assist seam reads it off the event, where it may be absent.
     *  Only used as the PUSH target, so an empty value simply means the reply
     *  ladder stops at the reply token. */
    userId?: string;
    logContext: Record<string, unknown>;
  }): Promise<PaymentForSlipOutcome> {
    const { hook, slipRecordId, accessToken, replyToken, logContext } = args;
    const userId = args.userId ?? '';
    if (!this.paymentRunner || !hook || !slipRecordId) return NO_PAYMENT_RUN;

    try {
      const result = await this.paymentRunner.runForSlip({
        hook: hook,
        slipRecordId: slipRecordId as never,
        replyToken,
      });

      /* [FEAT-20260820-LOCKDUPFIRST] the ONE reason the card layer needs to know
         about. The runner returns it from a single line
         (`payment-runner.service.ts:1026`) after finding a PRIOR slip with this
         `trans_ref` carrying `consumed:true` + `lock_reason:'success'` — the
         customer's money already arrived on an earlier send. Every other
         `skipped` value is still collapsed away; only this one travels.
         มีเหตุผลเดียวที่ส่งต่อ: ใบก่อนหน้าจ่ายไปแล้วและถูกล็อก. */
      const lockedDuplicate = result?.skipped === 'duplicate_after_success';

      // `ran:false` covers every gate above — nothing was attempted, so the
      // legacy card must still answer the customer.
      if (!result?.ran || !result.reply) {
        return { suppress: false, lockedDuplicate };
      }

      /* [FIX-20260817-RETRYRESUME] `result.reply` alone LOST the resume target
         (it lives on the RESULT, not inside reply), so the [ลองใหม่] button was
         removed from every card while the copy told the customer to press it.
         The shared bridge keeps the two in step. See payment-reply-resume.ts. */
      await this.sendPaymentReply(replyWithResume(result) as never, {
        accessToken,
        replyToken,
        userId,
        logContext,
        // [FEAT-20260810-CARDTICKET] so a bound card retitles the ticket this run
        // already opened instead of creating a second one.
        directTicketId: result.directTicketId,
        // [FIX-20260811-PAYDIVIDER] runner เขียนเส้นแล้วหรือยัง — กันเส้นซ้ำ
        dividerDone: result.dividerDone,
        /* [FEAT-20260810-PAYSTATEFLEX] `vData` is Swiftcheck's `rawSlip`, the same
         * subtree the slip card substitutes from (`slip-flex.handler.ts:396`), so
         * a card written with `{{amount}}` renders identically on both paths. */
        stateFlex: {
          /* [FEAT-20260823-TOPUPDUP] เติม default ให้ state `topup_duplicate`
             ยืมการ์ด `hook.flex_duplicate` ของ Swiftcheck เมื่อ OA ไม่ได้ผูกเอง
             ⇒ เปิดใช้ได้ทันทีโดยไม่ต้องตั้งอะไรเพิ่มในหน้าเว็บ
             ⚠️ ของที่ผูกเองชนะเสมอ · state อื่นไม่ถูกแตะ (ดู note ที่ตัวฟังก์ชัน) */
          boundIds: withSwiftcheckDuplicateFallback(
            args.hook?.['payment_flex_ids'],
            args.hook?.['flex_duplicate'],
          ),
          tagContext: {
            vData: rawSlipOf(args.slipVerifyResult),
            baseUrl: args.baseUrl ?? '',
            slipCreatedAt: args.slipCreatedAt ?? null,
            formatThaiDateTime: (d) => formatThaiDateTime(d),
          },
        },
      });
      /* payment answered ⇒ suppress the slip card. `lockedDuplicate` is false
         here by construction: the runner cannot both step aside for a lock and
         produce a reply. */
      return { suppress: true, lockedDuplicate: false };
    } catch (err) {
      // Money work (if any) is already recorded by the runner's own log rows.
      // Falling back to the legacy card is the safe outcome: the customer gets
      // an answer rather than silence.
      this.logger.error(`[PAYRUN] slip run failed: ${errText(err)}`);
      return NO_PAYMENT_RUN;
    }
  }

  /**
   * ==== [FEAT-20260808-PAYTOOL-P3] deliver a payment reply ====
   *
   * 📍 [DOC-20260810-PAYSTATES] This is the LAST hop before LINE. Every state it
   * can be handed — flex vs text, where the words come from, which knob overrides
   * them — is mapped in `docs/payment-states.md` (LOCAL ONLY, not pushed:
   * `.gitignore:46` ignores `*.md` repo-wide by policy). `reply.kind` is obeyed
   * here, never re-decided: the runner already chose it from REPLY_STATE_DEFAULTS.
   * ปลายทางสุดท้ายก่อนส่ง LINE · แผนที่ state: `docs/payment-states.md`.
   *
   * The runner DECIDES what to say; this sends it. Split that way so the money
   * logic never touches LINE and stays unit-testable without a network.
   *
   * THE LADDER (owner-decided 2026-08-09):
   *   1. reply token  — flex or text, whichever KIND the runner chose.
   *   2. push         — SAME KIND, for EVERY state (owner: "ทุก state"). A
   *      spent/expired reply token must not silently drop the message. The flex
   *      keeps its buttons because push carries flex too
   *      (`sendLinePushFlexMessage`), so a fallback never degrades a card with a
   *      working [ลองใหม่] button into plain text.
   *   3. both failed  — the customer gets NOTHING, so leave a REVIEW trail with
   *      a DISTINCT reason (`delivery_failed`) and the failure text, so an
   *      operator can tell a delivery problem apart from a business review.
   *      Owner: "ถ้า reply token หมด แล้วบังเอิญ push ไม่ได้อีก (เงินหมด/quota)
   *      ก็เก็บ log review + detail บอกว่าเป็น quota".
   *
   * ⚠️ NEVER THROWS. A delivery failure must not abort the webhook: the money
   * work already happened and is already recorded. Losing the reply is bad;
   * losing the run record would be worse.
   */
  private async sendPaymentReply(
    reply: {
      state: string;
      kind: 'text' | 'flex';
      text: string;
      actions?: string[];
      detail: string;
      resume?: { run_id: string; next_idx: number };
    },
    ctx: {
      accessToken: string;
      replyToken: string;
      userId: string;
      logContext: Record<string, unknown>;
      /**
       * [FEAT-20260810-PAYSTATEFLEX] What the per-state card needs, passed in
       * rather than fetched here.
       *
       * WHY PASSED IN: the resolver needs hook + slip + baseUrl together. This
       * service has no `slipModel` and no `baseUrl` in scope, while both callers
       * of `runPaymentForSlip` (`:1699`, `:1903`) already hold all three — it is
       * the same scope `handleSlipFlex` takes them from (`:1721`). Fetching here
       * would mean a new model dependency and a second slip read; threading it
       * from the runner would mean touching `_result`'s eleven call sites on the
       * money path. Optional, so a caller without a slip simply gets the previous
       * behaviour. ส่งลงมาแทนที่จะ query ใหม่.
       */
      stateFlex?: {
        boundIds: Record<string, unknown> | null | undefined;
        tagContext: SlipTagContext;
      };
      /**
       * [FEAT-20260810-CARDTICKET] The direct ticket this run already opened, if
       * any. Present only for the two states that ticket inside the runner; when
       * set, a card's own reason RETITLES that row instead of opening a second one.
       */
      directTicketId?: unknown;
      /**
       * [FIX-20260811-PAYDIVIDER] `true` = runner เขียน divider ไปแล้วในการตรวจครั้งนี้
       * ⇒ `cardTicket()` ต้องไม่เขียนซ้ำ (การตรวจ 1 ครั้ง = 1 เส้น)
       */
      dividerDone?: boolean;
    },
  ): Promise<void> {
    const { accessToken, replyToken, userId, logContext } = ctx;

    /* ==== [FEAT-20260810-PAYSTATEFLEX] the card bound to THIS reply state ====
     * Owner's rule: 1 state = 1 card. When the OA bound one, it replaces both the
     * mint flex and the plain-text reply; when it did not — every hook today —
     * `bound` is null and everything below runs exactly as before.
     *
     * `mintPayLinks` runs on the resolved card so `{{paylink.retry}}` becomes
     * the real postback payload, and the button is REMOVED when this run has
     * nowhere to resume to (the rule `buildAction` already enforces for the mint
     * card). `reply.resume` is passed through untouched — the runner supplies it
     * only for `no_match_retry`, and inventing one here would hand the customer a
     * button that fails the atomic claim and answers nothing.
     * ⚠️ Never throws: the resolver returns null on a deleted card, a wrong
     * `flex_type` or unrenderable JSON, and null means "reply the way you did
     * before". ตั้งการ์ด = ใช้การ์ด · ไม่ตั้ง = เหมือนเดิมทุกอย่าง. */
    const bound = ctx.stateFlex
      ? await resolveStateFlex(
          {
            state: reply.state,
            boundIds: ctx.stateFlex.boundIds,
            tagContext: ctx.stateFlex.tagContext,
          },
          {
            findFlexById: (id) =>
              this.flexModel.findById(id).lean<never>().exec(),
            warn: (m: string) => this.logger.warn(m),
          },
        )
      : null;

    const boundCard = bound
      ? mintPayLinks(bound.contents, {
          // [FIX-20260817-RETRYRESUME] one shared mapping — it used to be written
          // out twice in this method and both copies read an always-undefined value
          resume: resumeContext(reply),
        })
      : null;

    if (boundCard) {
      // Only `card:*` entries mean the card itself is broken. A dropped
      // `paylink.retry` is the DESIGN firing on a state with no resume target,
      // so warning on it would warn on every `review` reply.
      const broken = boundCard.dropped.filter((d) => d.startsWith('card:'));
      if (broken.length) {
        this.logger.warn(
          `[PAYFLEX] card '${bound!.cardName}' for state '${reply.state}' had problems: ${broken.join(', ')}`,
        );
      }
      /* [FIX-20260810-PAYLINKWARN] `leftover` is measured by the slip-tag pass
       * inside `resolveStateFlex`, which runs BEFORE `mintPayLinks` above — so
       * every `{{paylink.*}}` still looked unresolved at that point even though
       * the mint had just filled it. The warning fired on every card carrying a
       * retry/contact-admin button and named a tag the customer never saw, which
       * sends the next reader hunting a bug that does not exist (and teaches them
       * to ignore this line — the real cost).
       *
       * `paylink` is the MINT's namespace: an unmintable one is already reported
       * as a `card:*` entry in `dropped` just above, so dropping it here loses no
       * signal. Everything else — a real unknown or unfillable slip tag — still
       * warns exactly as before.
       * กรองเฉพาะ paylink เพราะ mint รายงานเองอยู่แล้ว tag อื่นยังเตือนปกติ */
      const unresolved = bound!.leftover.filter(
        (t) => !/^\{\{\s*paylink\./i.test(t),
      );
      if (unresolved.length) {
        this.logger.warn(
          `[PAYFLEX] card '${bound!.cardName}' still has unresolved tags: ${unresolved.join(', ')}`,
        );
      }
    }

    // A flex reply only carries a WORKING retry button when the runner supplied
    // a resume target; otherwise the builder omits it rather than rendering a
    // dead control (see payment-mint-flex.builder).
    // [FEAT-20260810-PAYSTATEFLEX] A bound card WINS over the mint card, and also
    // over a plain-text state: the admin chose a card, so a card is what is sent.
    const flex = boundCard
      ? (boundCard.contents as never)
      : reply.kind === 'flex'
        ? buildMintFlex(reply as never, {
            // [FIX-20260817-RETRYRESUME] see the sibling call above
            resume: resumeContext(reply),
          })
        : null;

    /* [FEAT-20260810-PAYSTATEFLEX] What was ACTUALLY sent. A bound card turns a
     * text state into a flex send, so logs and chat history must say `flex` —
     * `reply.kind` alone would record `text` for a message the customer received
     * as a card. */
    const sentKind: 'text' | 'flex' = flex ? 'flex' : reply.kind;

    /* [FIX-20260815-UNDELIVEREDSTATUS] `status` is typed to the schema enum on
       purpose. It used to be a bare `string`, and that is how two call sites came
       to pass `'failed'` — a value `webhook-log.schema.ts:99` does not accept.
       Mongoose rejected those documents, `persistWebhookLog` swallowed the
       rejection by design, and the rows disappeared with no error anywhere; the
       count on the live DB was 20 / 25 / 0 across the three actions this helper
       writes. Narrowing the parameter makes the same mistake a compile error
       instead of a silent data loss. ห้ามเปลี่ยนกลับเป็น `string`.
       Adding a value here means adding it to the schema enum FIRST — see the
       warning on `tickets.category` for the same trap. */
    const log = (
      action: string,
      status: 'success' | 'error' | 'suppressed',
      extra: Record<string, unknown> = {},
    ) =>
      this.wlogEmit({
        ...logContext,
        channel: 'line_api',
        action_type: action,
        method: 'POST',
        endpoint: LINE_REPLY_ENDPOINT,
        status,
        payload_summary: {
          reply_token: replyToken,
          payment_state: reply.state,
          kind: sentKind,
          ...(boundCard ? { bound_card: bound!.cardName } : {}),
        },
        ...extra,
      });

    /* ==== [FIX-20260810-SUPPRESSHISTORY] record what the customer RECEIVED ====
     * The transcript must show payment's own reply. Until now this function wrote
     * only a webhook_logs row, while the slip handler wrote the Swiftcheck success
     * card into chat history even when it had been suppressed — so a customer told
     * "บัญชีผู้รับไม่ตรงบัญชีระบบ" left a history saying "สลิปถูกต้อง". That card is
     * no longer logged when suppressed (`slip-flex.handler.ts:582`), and this is the
     * other half: without it the conversation would simply have a hole.
     *
     * Called ONLY after a send actually succeeded, so history never claims a message
     * the customer did not get. Fire-and-forget and never throws — losing a history
     * row must not abort a reply that already went out.
     * เก็บให้เหมือนที่ลูกค้าได้รับ.
     */
    const logHistory = (via: 'reply' | 'push') =>
      void this.chatHistory
        .logMessage({
          userId,
          senderType: 'bot',
          messageType: sentKind,
          content:
            sentKind === 'flex'
              ? `[Flex] ${boundCard ? bound!.cardName : reply.text}`
              : reply.text,
          hookId: logContext['hook_id'] as string | undefined,
          replyToken,
          metadata: {
            auto_reply_type: 'payment_reply',
            payment_state: reply.state,
            delivered_via: via,
            /* Store the BUBBLE WE ACTUALLY SENT for the two flex states
             * (`no_match_retry`, `review`). Without it the dashboard falls back to
             * synthesising a bubble from `content`, which loses the buttons and
             * paints every card red — so a paused-with-retry state reads as an
             * error. `metadata` is free-form, and `flex_profile` already stores its
             * card the same way (`:3253`), so this is the established shape.
             * Safe to keep verbatim: the mint card's actions are `postback` and
             * `message` only, with NO `uri` — the reason `stripHelperUriForHistory`
             * exists for the helper card does not apply here.
             * `flex` is null on the six text states, so nothing is added there.
             * เก็บการ์ดที่ส่งจริง ⇒ ประวัติตรงกับที่ลูกค้าเห็น. */
            ...(flex ? { flex_json: flex } : {}),
            ...(reply.detail && reply.detail !== '-'
              ? { detail: reply.detail }
              : {}),
          },
        })
        .catch((e: Error) =>
          this.logger.error(`[PAYRUN] history log failed: ${e.message}`),
        );

    /* ==== [FEAT-20260810-CARDTICKET] the card asked for a ticket ====
     * Runs ONLY after a send actually succeeded — a reply that reached nobody must
     * not promise an admin. That is why this sits on the success path beside
     * `logHistory` and not in a `finally`.
     *
     * Two shapes, one rule ("the card's reason wins"):
     *   · the run already opened a ticket (member_not_match / statement_not_found)
     *     ⇒ RETITLE it, keeping the existing detail — `statement_not_found` carries
     *       the real amounts, which cannot be recomputed here.
     *   · no ticket yet (the other six states) ⇒ open one.
     * Fire-and-forget and never throws: the customer has already been answered.
     * ⚠️ Flow is untouched — this cannot change a state, a lock, or whether walletpay
     * ran. ไม่กระทบ flow · ทำงานเฉพาะเมื่อส่งสำเร็จ. */
    const cardTicket = () => {
      if (!boundCard || !bound?.ticketOnReply) return;
      const reason =
        bound.ticketText ||
        `ระบบเปิดเคสจากการ์ด '${bound.cardName}' (state: ${reply.state})`;

      if (ctx.directTicketId) {
        void retitleDirectTicket(
          { ticketId: ctx.directTicketId, reason },
          {
            ticketModel: this.ticketModel,
            /* [FIX-20260815-DIVIDERRETITLE] the card's reason now reaches the
               DIVIDER too, not just the ticket row. Before this, the retitle
               succeeded but the admin kept reading the runner's wording in the
               transcript, because the two live in different collections —
               owner-reported 15/08/2026 and verified against live rows.
               Both models are optional in the helper: dropping these two lines
               reverts to ticket-only with no other change. */
            chatMessageModel: this.chatMessageModel as never,
            chatRoomModel: this.chatRoomModel as never,
            warn: (m: string) => this.logger.warn(m),
          },
        );
        return;
      }

      void openPaymentTicketIfIdle(
        {
          channelUserId: userId,
          hookId: logContext['hook_id'],
          needDetail: reason,
          directDetail: reason,
        },
        {
          chatRoomModel: this.chatRoomModel as never,
          ticketModel: this.ticketModel,
          memberModel: this.memberModel as never,
          publishTicketNew: (d) =>
            void this.realtimePublisher.publish('ticket:new', d as never),
          /* [FIX-20260811-PAYDIVIDER] เขียนเส้นที่นี่ **เฉพาะเมื่อ runner ไม่ได้เขียน**
           *
           * กฎที่เจ้าของสั่ง: divider เกิดทุกครั้งที่ตรวจสลิป — **1 เส้นต่อการตรวจ**
           * ปัญหาคือการตรวจครั้งเดียวอาจวิ่งผ่าน helper นี้ 2 รอบ:
           *   รอบ runner  — เฉพาะ state ที่ ticket เอง (`member_not_match`,
           *                 `statement_not_found`) ⇒ เขียนเส้นไปแล้ว
           *   รอบการ์ด    — `cardTicket()` เมื่อการ์ดที่ผูกมี flag เปิด (state ไหนก็ได้)
           *
           * 🔴 เจอจริงตอนเทส 5 เคส (2026-08-11): การ์ด `PAYstatementnotfound` flag ON
           * ⇒ ทั้งสองรอบวิ่งในการตรวจเดียวกัน ⇒ divider เพิ่ม **2 ต่อครั้ง**
           * (`ยอดในสลิป 888 …` จาก runner + `ยอดที่โอนมา …` จากการ์ด)
           * ตอนแรกผมต่อสายทั้ง 3 call site เพราะคิดว่ายิ่งครบยิ่งดี — ที่ถูกคือ
           * **ต้องมีเจ้าของเส้นชัดเจนต่อการตรวจหนึ่งครั้ง**
           *
           * ตัวชี้ขาดคือ `ctx.dividerDone` ที่ runner ส่งมาบอกว่า **รอบนี้เขียนเส้นแล้ว**
           * ⇒ ที่นี่ข้าม · ถ้า runner ไม่ได้เขียน (หกสถานะที่ไม่ ticket เอง หรือเส้น
           * `statement_not_found` ที่ออกก่อนถึงจุด ticket เช่นไม่มีรูปสลิป
           * `payment-runner.service.ts:1102`) ที่นี่เขียนให้ ⇒ ไม่ซ้ำ และไม่มีเคสไหนเงียบ
           *
           * ⚠️ ห้ามตัดสินด้วย `reply.state`: `statement_not_found` มีทั้งเส้นที่ ticket
           * และเส้นที่ไม่ ticket (`:1102` vs `:1957`) ⇒ ตัดด้วย state จะพลาดเส้นแรก
           * ⚠️ ห้ามตัดสินด้วย `ctx.directTicketId`: ตอนห้องถูก claim runner เปิด ticket
           * ไม่ได้ ค่านั้นเป็น null ทั้งที่ runner เขียนเส้นไปแล้ว = เคสหลักของงานนี้ */
          writeDivider: ctx.dividerDone
            ? undefined
            : (i) =>
                writeTicketDivider(i, {
                  chatMessageModel: this.chatMessageModel,
                  chatRoomModel: this.chatRoomModel as never,
                  warn: (m: string) => this.logger.warn(m),
                }),
          log: (m: string) => this.logger.log(m),
          warn: (m: string) => this.logger.warn(m),
        },
      );

      /* [FIX-20260815-DIVIDERRETITLE] …and when the runner ALREADY wrote the
       * divider, retitle that existing line with the card's reason.
       *
       * WHY HERE AND NOT ONLY IN `retitleDirectTicket`: there are two ways in,
       * and the common one never reaches that function. When the room is already
       * claimed, `openPaymentTicketIfIdle` cannot open a ticket, so
       * `ctx.directTicketId` is null and the branch above (`if
       * (ctx.directTicketId)`) is skipped entirely — control lands HERE. The
       * runner had already written a divider in the same check
       * (`ctx.dividerDone === true`), so `writeDivider` is correctly suppressed
       * by `[FIX-20260811-PAYDIVIDER]` — and the admin was left reading the
       * runner's wording forever. Verified on run 6a802de9…3c05: the bot replied
       * with the card's sentence while the divider still said
       * "ยอดในสลิป 2,354 บาท · รายการรอฝาก ไม่มี".
       *
       * ⚠️ THIS EDITS, IT NEVER CREATES. The one-divider-per-check rule is
       * untouched: the row already exists, only its text changes. Guarded on
       * `ctx.dividerDone` precisely so it runs ONLY when a line is there to edit
       * — with no divider written this round there is nothing to retitle and we
       * do nothing, rather than adding a second line. แก้ข้อความ ไม่สร้างเส้นใหม่.
       *
       * FALLBACK (owner: "ถ้า text จาก ticket null empty fallback เดิม"): a blank
       * reason, a missing room or a missing row all leave the existing divider
       * exactly as it was. Fire-and-forget and swallowed — the customer has
       * already been answered, so a cosmetic failure must not surface.
       *
       * revert: delete this block; the divider goes back to the runner's wording. */
      if (ctx.dividerDone && reason) {
        void retitleLatestDivider(
          {
            channelUserId: userId,
            hookId: logContext['hook_id'],
            reason,
          },
          {
            memberModel: this.memberModel as never,
            chatRoomModel: this.chatRoomModel as never,
            chatMessageModel: this.chatMessageModel as never,
            warn: (m: string) => this.logger.warn(m),
          },
        );
      }
    };

    /* ==== [FEAT-20260827-PUSHCORE-B] the reply→push ladder now lives next door ====
     *
     * `payment-reply/payment-send.ladder.ts` owns the two rungs and NOTHING else.
     * Everything that writes something — the four `await log(...)` rows below,
     * `logHistory`, `cardTicket`, the two logger lines — deliberately stayed HERE.
     *
     * WHY THE LOG CALLS DID NOT MOVE WITH THE LADDER:
     * `z-test/unit/payment-reply-undelivered-status.spec.ts:53-57` reads THIS FILE
     * as text and matches every call to the `log` closure below, deriving the
     * allowed statuses from the schema itself. (Its regex is literal, so this
     * comment must not spell one out — doing so once made it count a fifth,
     * imaginary call. คอมเมนต์ห้ามเขียนรูปแบบที่ regex จับ.) It exists because this exact
     * row was once written with `status:'failed'` — a value the enum rejects — so
     * Mongoose dropped it, `persistWebhookLog` swallowed the rejection by design,
     * and the rows vanished with only a console line to show for it. Moving these
     * calls into another file would leave that guard matching zero call sites and
     * reporting green. ห้ามย้าย log ออกจากไฟล์นี้.
     *
     * WHAT CHANGED IN BEHAVIOUR: nothing. The old rungs decided by exception —
     * `LineApiService` let the axios rejection escape and `catch` was the edge.
     * The core never throws, so the ladder now reads `res.ok`. The EDGE ITSELF is
     * unchanged on purpose: every failure falls through to push, 5xx included,
     * exactly as `catch` did (owner's call, 27/08 — "เหมือนเดิม"). See the file's
     * header for why this deliberately differs from the chat console's ladder.
     *
     * revert: delete the ladder file and paste the two try/catch blocks back — the
     *         old block is reproduced verbatim in
     *         todo/task/27082026/todo12_27082026_pushcore-fbga_wt27aug.md §B. */
    const delivery = await deliverPaymentReply(
      {
        token: accessToken,
        replyToken,
        userId,
        flex: flex,
        text: reply.text,
        altText: MINT_FLEX_ALT_TEXT,
      },
      {
        send: (req) => this.paymentSender().dispatch(req),
        warn: (m: string) => this.logger.warn(m),
      },
    );

    // ── 1) reply token ──────────────────────────────────────────────────
    if (delivery.via === 'reply') {
      await log('payment_reply', 'success', {
        http_status: delivery.res.status,
        response_summary: delivery.res.data,
      });
      // [FIX-20260810-SUPPRESSHISTORY] delivered ⇒ the transcript records it.
      logHistory('reply');
      cardTicket(); // [FEAT-20260810-CARDTICKET] delivered ⇒ the card may ticket.
      return;
    }

    // ── 2) push, SAME KIND ──────────────────────────────────────────────
    if (delivery.via === 'push') {
      await log('payment_push', 'success', {
        http_status: delivery.res.status,
        response_summary: delivery.res.data,
      });
      // [FIX-20260810-SUPPRESSHISTORY] push counts as delivered too.
      logHistory('push');
      cardTicket(); // [FEAT-20260810-CARDTICKET] push counts as delivered too.
      return;
    }

    // ── 3) NOTHING REACHED THE CUSTOMER ───────────────────────────────
    // Most likely a push quota / billing limit — the exact case the owner
    // called out. Record it as its own reason so it is not mistaken for a
    // business review, and carry the failure text as the detail.
    if (delivery.pushAttempted) {
      const detail = delivery.detail ?? 'unknown';
      this.logger.error(
        `[PAYREPLY] BOTH reply and push failed (${reply.state}): ${detail}`,
      );
        /* [FIX-20260815-UNDELIVEREDSTATUS] `'error'`, not `'failed'`.
         *
         * THE BUG: this row was written with `status:'failed'`, which is not in
         * `webhook-log.schema.ts:99` (`['success','error','suppressed']`).
         * Mongoose rejected the document, `persistWebhookLog` swallowed the
         * rejection by design (`webhook.service.ts:624` — a log write must never
         * fail a customer reply), and the row vanished with nothing but a console
         * line to show for it. Counted on the live DB 15/08/2026:
         *     payment_reply              20 rows   ('success' — in the enum)
         *     payment_push               25 rows   ('success' — in the enum)
         *     payment_reply_undelivered   0 rows   ('failed'  — NOT in the enum)
         * and `status:'failed'` appears nowhere in the collection at all.
         *
         * ⚠️ WHY THIS ROW MATTERS MORE THAN MOST: it is written only when BOTH
         * legs failed, i.e. the money has already moved and the customer was told
         * nothing. It carries `needs_review` and the real LINE error so an admin
         * can chase them. It is the one audit row nobody could afford to lose,
         * and it was the one that never landed.
         *
         * WHY `'error'` RATHER THAN ADDING `'failed'` TO THE ENUM — checked, not
         * assumed:
         *   · the Webhook Logs filter offers only error/success
         *     (`WebhookLogs.tsx:13-21`), and its own comment records that a
         *     fourth value was REMOVED once because picking it returned an empty
         *     table that reads as "no logs" rather than "impossible filter";
         *   · `webhook-stats.service.ts:112` counts `'error'` as `count_failed`
         *     — a bespoke status would leave a delivery failure invisible on the
         *     dashboard, which is the opposite of the point;
         *   · nothing anywhere reads the string `'failed'` on this collection
         *     (`payment-runner`'s `'failed'` belongs to `handoff_chain_runs`).
         * Undelivered IS an error, so it takes the value that already means that.
         * ⇒ ไม่ต้องแตะ schema · หน้าเว็บกรองเจอ · แดชบอร์ดนับเป็นความล้มเหลวจริง.
         *
         * DB effect: none — no row ever held `'failed'`, so there is nothing to
         * migrate. revert: put `'failed'` back and the row stops being stored. */
      await log('payment_reply_undelivered', 'error', {
        error_message: detail,
        payload_summary: {
          reply_token: replyToken,
          payment_state: reply.state,
          kind: reply.kind,
          needs_review: true,
          review_reason: 'delivery_failed',
          review_detail: `payment reply undelivered (reply+push failed): ${detail}`,
        },
      });
      return;
    }

    // No reply token AND no userId — nothing to send to at all.
    /* [FIX-20260815-UNDELIVEREDSTATUS] same fix, same reason as the branch above
       — this row was silently rejected by the enum too. */
    await log('payment_reply_undelivered', 'error', {
      error_message: 'no reply token and no userId',
      payload_summary: {
        payment_state: reply.state,
        needs_review: true,
        review_reason: 'delivery_failed',
        review_detail:
          'payment reply undelivered: no reply token and no userId',
      },
    });
  }
}

/** legacy config.js:17 — the reply endpoint, recorded on every log row. */
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

/**
 * Thrown when the Telegram webhook secret doesn't match.
 * The controller catches this and returns 403.
 */
export class TelegramSecretMismatchError extends Error {
  constructor() {
    super('invalid telegram secret token');
    this.name = 'TelegramSecretMismatchError';
  }
}
