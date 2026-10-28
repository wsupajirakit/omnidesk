/**
 * [FEAT-20260908-CHATTRANS] chat is a CALLER of `ai-translate`, not an owner.
 * ===========================================================================
 * Two routes live here: translating a customer's message (stored, cached
 * forever after the first press) and previewing a draft the admin is typing
 * (stateless, rate limited). Everything specific to CHAT — which message, whose
 * OA, whose key, who pressed it, where the answer is stored — is decided in this
 * file. `AiTranslateService` is handed four fields and a text and knows none of
 * it. ประตูต้องไม่รู้จักคนเรียก.
 *
 * ## 🔴 THE ORDER OF THE READ ROUTE IS THE DESIGN, NOT A STYLE
 *
 *   1. load the message                — 404 before anything else is decided
 *   2. refuse a non-text message       — a sticker has no words to translate
 *   3. validate `to` against the registry (again — see below)
 *   4. resolve room → hook, and raise the OA-scope wall
 *   5. 🔴 CACHE HIT ⇒ RETURN, before anything that costs money
 *   6. the key check, so a keyless OA never reaches the cap decorator
 *   7. the vendor call
 *   8. the atomic `$push`
 *   9. the audit row
 *
 * ⚠️ STEP 4 SITS BEFORE STEP 5 AND THE PLAN PUT IT AFTER — a deliberate
 * deviation, recorded rather than smuggled. The plan's rule is "the cache hit
 * returns before anything that COSTS MONEY", and the scope wall costs nothing:
 * it reads ids the request already loaded. Answering a cached translation
 * before the wall would let an operator of OA-A read OA-B's message content by
 * id — the exact hole `[FIX-20260818-CHATOASCOPE]` closed on the send path
 * (C2.1). Moving the wall one step earlier weakens no mutation: a cached press
 * still records zero vendor calls.
 *
 * ## Why the hook comes from the ROW and never from the body
 *
 * A `hook_id` in a request body is a claim by the caller. The message's own
 * room says which OA owns it, and that is what the scope wall is raised
 * against — otherwise an operator could name an OA they may not act on and
 * spend its key. Same rule, same reason, as `resolveRoomHook`.
 *
 * ## Validated twice, on purpose
 *
 * The DTO's `@IsIn` refuses an unlisted code at the HTTP edge. This service
 * checks the registry AGAIN because a future non-interactive caller reaching it
 * directly never meets the `ValidationPipe`, and because `enabled: false`
 * retires a language for NEW requests while rows already stored under that code
 * keep resolving.
 *
 * ## The refusals, and the filter that is never taught about them
 *
 * `ai-translate` throws typed refusals; this file maps each to a status with a
 * readable envelope, so `all-exceptions.filter.ts` passes it through intact
 * (`:87-95`) and the dashboard can branch on `success`. 🔴 The global filter is
 * the `APP_FILTER` for every route in the API — teaching it about a translate
 * error class would change every feature at once. It is never touched.
 *
 * revert: delete `src/modules/chat/translate/`, its three lines in
 * `chat.module.ts`, and the two optional fields on `SendChatReplyDto`.
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import { type AuthenticatedUser } from '@/common';
import { aiTranslateConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import {
  AiTranslateService,
  TranslateCapReachedError,
  TranslateFailedError,
  TranslateKeyMissingError,
  isTranslateLanguage,
  type TranslateReasoning,
} from '@/modules/ai-translate';
import { AuditLogService } from '@/modules/audit';
/* [FEAT-20260909-DSREASONING] `[HOTFIX-20260826-THINK36]` — the ONE function that
   turns an admin's budget number into what a given Gemini family actually
   accepts. Imported rather than reimplemented so the reply lane and this lane
   can never disagree about what `0` means. `chat -> webhook` is an existing
   edge; `ai-translate` may not have it, which is why the resolution happens
   here and the funnel only forwards the result. */
import { resolveThinkingConfig } from '@/modules/webhook/ai-vendors/gemini/thinking-config';
import {
  Hook,
  getAllowedHookIds,
  isHookOutOfScope,
  resolveVendorPair,
  resolveDeepSeekReasoning,
  resolveGeminiReasoning,
  VENDOR_DEEPSEEK,
  type HookDocument,
} from '@/modules/hooks';

import {
  ChatMessage,
  type ChatMessageDocument,
} from '../schemas/chat-message.schema';
import { ChatRoom, type ChatRoomDocument } from '../schemas/chat-room.schema';

import {
  PREVIEW_RATE_LIMIT_BUCKET,
  PREVIEW_RATE_LIMIT_KEY_SUFFIX,
  buildPreviewRateLimitIdentifier,
  previewRateLimitMessage,
} from './preview-rate-limit';
import {
  auditMessageTranslate,
  auditPreviewTranslate,
} from './translate-audit.helper';
/* [FIX-20260918-LANGSPLIT] the source-language write, lifted out of this file.
   Channel-agnostic on purpose: it takes a room id and a language, so a future
   caller that is not LINE reuses it unchanged. */
import { rememberDetectedSourceLang } from './remember-source-lang';
import { checkVendorKey, vendorKeyProblemMessage } from './translate-key-check';
import { resolveTranslateVendor } from './resolve-translate-vendor';
import { forceTranslateThinking } from './force-translate-thinking';
import { pushMessageTranslation } from './translation-store';

/** What both routes answer with, minus the envelope. */
export interface ChatTranslateResult {
  lang: string;
  text: string;
  from: string | null;
  to: string;
  /** True when no vendor was contacted because the answer was already stored. */
  cached: boolean;
}

@Injectable()
export class ChatTranslateService {
  private readonly logger = new Logger(ChatTranslateService.name);

  constructor(
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    private readonly crypto: CryptoService,
    private readonly aiTranslate: AiTranslateService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditLogService,
    @Inject(aiTranslateConfig.KEY)
    private readonly cfg: ConfigType<typeof aiTranslateConfig>,
  ) {}

  /**
   * `POST /api/chat/messages/:id/translate` — translate ONE message, once per
   * language, and remember it.
   */
  public async translateMessage(
    messageId: string,
    body: { to: string; from?: string },
    auth?: AuthenticatedUser,
    /* [FEAT-20260918-AUTOTRANS] who is asking. `'user'` — every HTTP route —
       is unchanged and still walks into the OA scope wall below. `'system'` is
       the automatic inbound translation, which has no logged-in user at all.

       🔴 THIS IS NOT "SKIP THE CHECK". The wall exists to stop an OPERATOR
       reaching a message belonging to an OA they are not scoped to, and it does
       that by comparing the caller's scope against the hook. A system call has
       no caller and no id to escalate with: `messageId` is one this process just
       wrote itself, and the hook is read off that row rather than supplied. With
       no user, `getAllowedHookIds` correctly answers `[]` — fail closed — which
       would refuse every automatic translation, so the question has to be asked
       differently rather than answered wrongly.
       ⚠️ Only the storage-path plug may pass `'system'`; the controller passes
       three arguments and can never reach this. */
    actor: 'user' | 'system' = 'user',
  ): Promise<{ success: true; data: ChatTranslateResult }> {
    if (!isValidObjectId(messageId)) {
      throw new BadRequestException('Invalid message id');
    }

    // 1 ─ the message
    const message = await this.chatMessageModel.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    // 2 ─ text only. `content` is Mixed; richer types store an object there.
    if (message.message_type !== 'text') {
      throw new BadRequestException('Only text messages can be translated');
    }
    const text =
      typeof message.content === 'string' ? message.content.trim() : '';
    if (!text) {
      throw new BadRequestException('This message has no text to translate');
    }

    // 3 ─ the registry, a second time. See the header.
    const { to, from } = this.readLanguages(body);

    // 4 ─ the OA that owns the message, from the ROW, then the scope wall.
    const hookId = await this.resolveMessageHookId(message);
    if (actor === 'user') await this.assertHookInScope(hookId, auth);

    // 5 ─ 🔴 the cache. No vendor call, no cap spend, no audit row.
    const stored = (message.translations ?? []).find((t) => t?.lang === to);
    if (stored) {
      /* [FIX-20260918-LANGSPLIT] remember what it was written IN — not what it is
         read AS. The helper writes only on a real change, so a cache hit stays
         free exactly as the comment above promises. */
      await this.rememberSourceLangFor(message, stored.from ?? null);
      return {
        success: true,
        data: {
          /* a stored entry on the READ path always carries its language —
             it is the key this lookup just matched on. `?? to` is the type's
             null branch, not a fallback anyone can reach. */
          lang: stored.lang ?? to,
          text: stored.text,
          from: stored.from ?? null,
          to: stored.to ?? to,
          cached: true,
        },
      };
    }

    // 6 ─ the hook's own key, or refuse — BEFORE the cap decorator is reached.
    const { hook, vendor, credential } =
      await this.loadVendorCredential(hookId);

    // 7 ─ the vendor call.
    const { text: translated, from: detectedFrom } = await this.callVendor({
      text,
      to,
      from,
      vendor,
      modelId: resolveVendorPair(hook, vendor).model,
      /* [FEAT-20260909-DSREASONING] the TRANSLATE lane's own knobs. `null` for
         an OA that set none, which is every row that predates the columns —
         and the funnel attaches nothing at all for a null. */
      reasoning: this.reasoningForLane(
        hook,
        vendor,
        resolveVendorPair(hook, vendor).model,
      ),
      apiKey: credential,
      hookId,
    });

    // 8 ─ one entry per language, atomically.
    /* [FEAT-20260910-DETECTSOURCE] 🔴 THE CALLER'S ANSWER WINS. `from` is what a
       caller STATED; `detectedFrom` is what the model GUESSED. A dashboard that
       one day lets the admin pick a source must not be overruled by a model
       reading one word — so the stated value is used whenever it exists, and the
       detection only fills a gap that would otherwise be null.
       ⚠️ Still null when neither knows, and null is renderable: the bubble drops
          the left-hand side and prints the target alone, exactly as it does for
          every row stored before today. */
    const entry = {
      lang: to,
      text: translated,
      from: from ?? detectedFrom,
      to,
    };
    const wrote = await pushMessageTranslation(
      this.chatMessageModel,
      message._id,
      entry,
    );
    if (!wrote) {
      /* Another press won the race and stored the same language first. The
         admin still gets an answer — theirs, which says the same thing. */
      this.logger.warn(
        `[CHATTRANS] ${to} was already stored on ${String(message._id)} — not re-added`,
      );
    }

    /* [FEAT-20260918-ROOMTRANS] the room remembers what language its customer
       writes in, so the next screen can say so without asking the model again.
       [FIX-20260918-LANGSPLIT] it lands in `detected_source_lang`. It used to be
       written into `translate_lang`, which is the operator's chosen TARGET — so
       translating an incoming Burmese line quietly reset a room set to English.
       ต้นทางกับปลายทางคนละช่อง ห้ามปนกันอีก */
    await this.rememberSourceLangFor(message, entry.from ?? null);

    // 9 ─ who pressed it. Fire-and-forget; see the helper's header.
    void auditMessageTranslate(
      {
        messageId: String(message._id),
        hookId: hookId ? String(hookId) : null,
        to,
        from,
        vendor,
        actor: auth
          ? {
              userId: auth.userId,
              username: auth.username,
              displayName: auth.displayName,
            }
          : undefined,
      },
      { audit: this.audit, warn: (m) => this.logger.warn(m) },
    );

    return { success: true, data: { ...entry, cached: false } };
  }

  /**
   * `POST /api/chat/:id/translate-preview` — translate a draft.
   *
   * 🔴 STATELESS. It writes no message row, no `translations` entry and no audit
   * row, because the draft may never become a message: the admin can preview
   * five times and send nothing. Translating is not sending — the existing send
   * button, on the existing route, is what reaches a customer.
   */
  public async previewTranslation(
    roomId: string,
    hookIdQuery: string | undefined,
    body: { text: string; to: string; from?: string },
    auth?: AuthenticatedUser,
    /* [FEAT-20260910-DETECTSOURCE] `from` rides the same envelope the message
       route stores — see the return statement. */
  ): Promise<{ success: true; data: { text: string; from: string | null } }> {
    const draft = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!draft) throw new BadRequestException('text is required');

    const { to, from } = this.readLanguages(body);

    const room = await this.resolveRoom(roomId, hookIdQuery);
    await this.assertHookInScope(room.hook_id, auth);

    await this.chargePreview(auth?.userId, String(room._id));

    const { hook, vendor, credential } = await this.loadVendorCredential(
      room.hook_id,
    );

    const { text, from: detectedFrom } = await this.callVendor({
      text: draft,
      to,
      from,
      vendor,
      modelId: resolveVendorPair(hook, vendor).model,
      /* [FEAT-20260909-DSREASONING] the TRANSLATE lane's own knobs. `null` for
         an OA that set none, which is every row that predates the columns —
         and the funnel attaches nothing at all for a null. */
      reasoning: this.reasoningForLane(
        hook,
        vendor,
        resolveVendorPair(hook, vendor).model,
      ),
      apiKey: credential,
      hookId: room.hook_id,
    });

    /* [FIX-20260909-AUDITPREVIEW] who pressed it, on THIS side too. A composer
       press spends the same money as a bubble press and used to leave no trace
       at all — see the helper's header. Fire-and-forget, like its sibling: an
       audit failure must not cost the admin their preview. */
    void auditPreviewTranslate(
      {
        roomId: String(room._id ?? roomId),
        hookId: room.hook_id ? String(room.hook_id) : null,
        to,
        from,
        vendor,
        actor: auth
          ? {
              userId: auth.userId,
              username: auth.username,
              displayName: auth.displayName,
            }
          : undefined,
      },
      { audit: this.audit, warn: (m) => this.logger.warn(m) },
    );

    /* [FEAT-20260910-DETECTSOURCE] the composer stores this on the staged
       preview and sends it back as `original_lang` when the admin presses ➤, so
       the outbound bubble can name both ends. The FE already reads `data.from`
       and has since the feature shipped — it was simply always absent. */
    return { success: true, data: { text, from: from ?? detectedFrom } };
  }

  /* ── the pieces both routes share ──────────────────────────────────────── */

  /**
   * [FIX-20260918-LANGSPLIT] Both translate branches — the cache hit and the
   * fresh vendor call — end the same way: the room remembers what its customer
   * writes in. The rule itself lives in `remember-source-lang.ts`; this wrapper
   * only hands it the two values and keeps the `void` at the branch readable.
   *
   * Not awaited for its RESULT anywhere: a room that fails to record its source
   * language still returned a correct translation, and the admin is waiting on
   * that, not on this. แปลเสร็จแล้วสำคัญกว่า บันทึกพลาดไม่ทำให้ผลแปลพัง
   */
  private async rememberSourceLangFor(
    message: { room_id?: unknown },
    from: string | null,
  ): Promise<void> {
    await rememberDetectedSourceLang(this.chatRoomModel, {
      roomId: message.room_id,
      from,
    });
  }

  /**
   * The registry check the `ValidationPipe` cannot stand in for.
   *
   * `from` stays optional forever (owner, 09/09): the dashboard never sends one
   * because the model detects the source, but a future caller that genuinely
   * knows it must be able to say so. Absent ⇒ `null`, never a guess.
   */
  private readLanguages(body: { to: string; from?: string }): {
    to: string;
    from: string | null;
  } {
    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    if (!isTranslateLanguage(to)) {
      throw new BadRequestException(`Unsupported target language '${to}'`);
    }
    const raw = typeof body?.from === 'string' ? body.from.trim() : '';
    if (raw && !isTranslateLanguage(raw)) {
      throw new BadRequestException(`Unsupported source language '${raw}'`);
    }
    return { to, from: raw || null };
  }

  /** The OA that owns this message — from the row, never from the body. */
  private async resolveMessageHookId(
    message: ChatMessageDocument,
  ): Promise<Types.ObjectId | null> {
    if (message.hook_id) return message.hook_id;
    /* Denormalised onto the message by every writer since, but legacy rows
       predate that, so the room is the fallback rather than the first stop. */
    const room = await this.chatRoomModel
      .findById(message.room_id)
      .select({ hook_id: 1 })
      .lean();
    if (!room) throw new NotFoundException('Chat room not found');
    return room.hook_id ?? null;
  }

  /**
   * The room a preview belongs to.
   *
   * Mirrors `chat.service.ts::resolveRoomHook` (`:706-742`) in accepting either
   * a room `_id` or a customer id plus `?hook_id=`, because the composer sits on
   * the same screens the send route serves and must not need a different id.
   * It is NOT shared with that method: it is `private` there, and reaching into
   * `ChatService` to borrow it would tie this removable slice to a 2,280-line
   * file it otherwise never touches.
   */
  private async resolveRoom(
    id: string,
    hookIdQuery: string | undefined,
  ): Promise<ChatRoomDocument> {
    let room: ChatRoomDocument | null;
    if (isValidObjectId(id)) {
      room = await this.chatRoomModel.findById(id);
    } else {
      if (!hookIdQuery) {
        throw new BadRequestException(
          'hook_id is required when using line_user_id',
        );
      }
      room = await this.chatRoomModel.findOne({
        $or: [{ line_user_id: id }, { channel_user_id: id }],
        hook_id: isValidObjectId(hookIdQuery)
          ? new Types.ObjectId(hookIdQuery)
          : hookIdQuery,
      });
    }
    if (!room) throw new NotFoundException('Chat room not found');
    return room;
  }

  /** The same two lines every read and write in this module raises. */
  private async assertHookInScope(
    hookId: Types.ObjectId | null | undefined,
    auth?: AuthenticatedUser,
  ): Promise<void> {
    const allowed = await getAllowedHookIds(auth, this.hookModel);
    if (isHookOutOfScope(allowed, hookId ?? undefined)) {
      throw new ForbiddenException('insufficient OA access');
    }
  }

  /**
   * The hook, its vendor, and a key that has been PROVED readable.
   *
   * 🔴 This runs before `AiTranslateService`, which is the whole point: the cap
   * decorator counts a slot BEFORE the inner provider runs
   * (`translate-cap.decorator.ts`, `[NOTE-20260909-CAPBEFOREKEY]`), so a keyless
   * OA reaching it spends budget for a vendor that was never contacted. Checking
   * here means that ordering is never reached on this path.
   *
   * `.lean()` on purpose: the checker reads the RAW column, and a hydrated
   * document is the shape a masking transform would arrive on.
   */
  private async loadVendorCredential(
    hookId: Types.ObjectId | null | undefined,
  ): Promise<{
    hook: Record<string, unknown>;
    vendor: string | null;
    credential: string;
  }> {
    if (!hookId) throw new NotFoundException('Hook not found');
    const hook = await this.hookModel.findById(hookId).lean();
    if (!hook) throw new NotFoundException('Hook not found');

    const row = hook as unknown as Record<string, unknown>;
    /* [FEAT-20260909-VENDORTRANSLATE] This lane asks for the TRANSLATE vendor,
       which is `ai_vendor` for every hook that has not chosen otherwise. The
       webhook and summary lanes are not routed through here and go on reading
       `ai_vendor` directly — that separation is the feature. */
    const vendor = resolveTranslateVendor(row);

    const credential = checkVendorKey(row, vendor, this.crypto);
    if (!credential.ok) {
      throw new HttpException(
        { success: false, error: vendorKeyProblemMessage(credential.problem) },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { hook: row, vendor, credential: credential.apiKey };
  }

  /**
   * [FEAT-20260909-DSREASONING] The OA's reasoning choice for THIS lane.
   *
   * 🔴 `'translate'` IS HARD-CODED HERE ON PURPOSE. This service is the
   *    translate lane; passing the lane in from outside would let a caller ask
   *    it to read the MAIN bot's columns, which is the one mistake the split
   *    exists to prevent and which nothing downstream could detect — both
   *    values are the same type and both are usually null.
   *
   * ⚠️ Returns `null`, never `{}`, when nothing is set. The transports branch
   *    on truthiness and an empty object is truthy.
   */
  private reasoningForLane(
    hook: Record<string, unknown>,
    vendor: string | null,
    modelId: string | null,
  ): TranslateReasoning | null {
    if (vendor === VENDOR_DEEPSEEK) {
      const thinking = resolveDeepSeekReasoning(hook, 'translate');
      return thinking === null ? null : { thinking };
    }
    const gemini = resolveGeminiReasoning(hook, 'translate');
    if (gemini === null) return null;
    /* 🔴 THE HOTFIX DECIDES, NOT THIS FILE. `resolveThinkingConfig` is
       `[HOTFIX-20260826-THINK36]`: it answers `0` with `thinkingBudget: 0` for
       the 2.5 family and with a `thinkingLevel` for Gemini 3, where
       `thinkingBudget: 0` is a 400 — and it guarantees ONE key, because sending
       both is also a 400. Owner, 09/09: do it the same way as the hotfix, or the
       same number means two different things in two boxes on one screen.
       ⚠️ Reached only when the operator SET a budget. An unset column returns
       null above and this lane sends no thinking config at all, which is what it
       has always sent — that is the whole no-backfill guarantee. */
    return {
      generationExtra: resolveThinkingConfig(modelId, gemini.budget),
    };
  }

  /** One vendor call, with every typed refusal turned into a readable status. */
  private async callVendor(req: {
    /* [FEAT-20260909-DSREASONING] carried through unchanged; `null` means the
       funnel attaches nothing, which is what an unconfigured OA must produce. */
    reasoning?: TranslateReasoning | null;
    text: string;
    to: string;
    from: string | null;
    vendor: string | null;
    modelId: string | null;
    apiKey: string;
    hookId: Types.ObjectId | null | undefined;
    /* [FEAT-20260910-DETECTSOURCE] both halves now — the translation, and the
       source language the model reported (null when it did not, or said one
       this registry does not know). */
  }): Promise<{ text: string; from: string | null }> {
    /* [FIX-20260910-ZHHANTFORCE] the ONE place the translate lane assembles a
       vendor call, so the override is applied once and cannot be forgotten by a
       second route. See the helper for the run that made it necessary: DeepSeek
       with thinking off answered th→zh-Hant with the THAI, HTTP 200, no error —
       a wrong translation nobody could see. Every other combination is returned
       untouched, and the constant in that file turns the whole thing off. */
    const forced = forceTranslateThinking(
      req.reasoning ?? null,
      req.vendor,
      req.to,
    );
    if (forced.forced) {
      /* said out loud: an override the operator did not set must never be
         invisible when someone asks why this OA's setting "did not apply". */
      this.logger.warn(
        `[ZHHANTFORCE] thinking forced ON for deepseek → ${req.to} ` +
          `(hook=${req.hookId ? String(req.hookId) : '(none)'})`,
      );
    }
    try {
      const { text, from } = await this.aiTranslate.translate({
        text: req.text,
        targetLang: req.to,
        sourceLang: req.from,
        vendor: req.vendor,
        reasoning: forced.reasoning,
        modelId: req.modelId,
        apiKey: req.apiKey,
        hookId: req.hookId ? String(req.hookId) : null,
      });
      return { text, from: from ?? null };
    } catch (err) {
      if (err instanceof TranslateCapReachedError) {
        /* 429 with an envelope, thrown by the CALLER. Without this the global
           filter flattens it to 500 {"error":"internal error"} and the
           actionable sentence never leaves the server. No file path, no
           counter and no env var — it reaches a browser. */
        throw new HttpException(
          {
            success: false,
            error:
              'The AI translation budget for this server is used up. Ask an admin to raise it.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (err instanceof TranslateKeyMissingError) {
        throw new HttpException(
          { success: false, error: vendorKeyProblemMessage('missing') },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (err instanceof TranslateFailedError) {
        throw new HttpException(
          { success: false, error: `Translation failed (${err.reason})` },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw err;
    }
  }

  /**
   * The preview's own throttle — 6 a minute per admin per room, by default.
   *
   * 🔴 Both ids are verified BEFORE the key is built. `consume()` treats an
   * EMPTY identifier as "no limiting at all" (`rate-limit.service.ts:100-102`),
   * and a half-built `"undefined:room"` is not empty — it sails past that guard
   * and puts every admin whose id went missing on ONE counter. So a missing id
   * refuses the request instead of silently skipping the limit.
   *
   * The numbers come from the `aiTranslate` config namespace, never a literal,
   * so one env line changes them without shipping code.
   */
  private async chargePreview(
    adminId: string | undefined,
    roomId: string,
  ): Promise<void> {
    const identifier = buildPreviewRateLimitIdentifier(adminId, roomId);
    if (!identifier) {
      throw new BadRequestException(
        'Cannot rate-limit this request — the admin or the room could not be identified',
      );
    }

    const verdict = await this.rateLimit.consume(
      PREVIEW_RATE_LIMIT_BUCKET,
      identifier,
      {
        limit: this.cfg.previewMax,
        windowSeconds: this.cfg.previewWindowSeconds,
        keySuffix: PREVIEW_RATE_LIMIT_KEY_SUFFIX,
      },
    );

    if (verdict.limited) {
      throw new HttpException(
        {
          success: false,
          error: previewRateLimitMessage(verdict.windowSeconds),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
