import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// [FEAT-20260908-CHATTRANS] the one registry of language codes. chat is a
// CALLER of ai-translate, which imports no feature module, so this cannot cycle.
import { TRANSLATE_LANGUAGE_CODES } from '@/modules/ai-translate';

export class ListChatRoomsDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  line_bot_id?: string;

  @IsOptional()
  @IsString()
  hook_id?: string;

  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  group_id?: string;

  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;
}

export class UpdateNicknameDto {
  @IsString()
  nickname!: string;
}

export class UpdateAssistStatusDto {
  @IsBoolean()
  assist_status!: boolean;
}

export class UpdateRoomNoteDto {
  @IsOptional()
  @IsString()
  note?: string | null;
}

export class CreateInlineNoteDto {
  @IsString()
  content!: string;
}

export class SendChatReplyDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  content?: string;

  /** [FEAT-20260821-QUOTEREPLY] chat_messages `_id` the operator pressed Reply on. */
  @IsOptional()
  @IsMongoId()
  quote_of?: string;

  /**
   * [FEAT-20260908-CHATTRANS] The admin's OWN wording, when they drafted in one
   * language and sent another.
   *
   * The invariant this pair serves: `content` is always the text the CUSTOMER
   * saw, and `translations` always holds the same message in the other
   * language. On this route the direction is inverted from the read side — the
   * TRANSLATED text is what reaches the customer and lands in `content`, and
   * the original rides along to be stored beside it.
   *
   * ⚠️ BOTH OPTIONAL, AND BOTH REQUIRED TOGETHER. A send that carries neither
   * takes a byte-identical code path to today — no key is added to the created
   * document, and `chat-service-quote-reply.spec.ts`'s "a plain text send is
   * byte-identical to before" case is what says so. A send carrying only one of
   * them stores nothing rather than half an entry: text with no language is not
   * renderable, and a language with no text is not a translation.
   *
   * They ride the EXISTING send request on purpose. `sendChatReply` performs
   * ONE `create()`, so the original is written in the same insert as the
   * message — an insert cannot half-happen, and there is no second write to
   * fail after the text has already reached the customer.
   *
   * revert: delete these two fields and the block in `sendChatReply`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  original_text?: string;

  /**
   * [FEAT-20260908-CHATTRANS] the language `original_text` is written in.
   *
   * Validated against the same seven-code registry the translate routes use, so
   * a code that could never be rendered cannot be stored. ⚠️ The request does
   * NOT carry the language `content` ended up in, so the stored entry's `to` is
   * `null` — see `outboundTranslationEntry`.
   */
  @IsOptional()
  @IsString()
  @IsIn(TRANSLATE_LANGUAGE_CODES as string[])
  original_lang?: string;

  /**
   * [FEAT-20260910-OUTBOUNDTARGET] the language `content` was translated INTO —
   * i.e. the one the customer is reading.
   *
   * 🔴 IT WAS THE ONE FACT THE DASHBOARD ALREADY KNEW AND NEVER SENT. The admin
   *    picks the target in the composer, so no detection and no guess is
   *    involved; the send simply left it behind, and `outboundTranslationEntry`
   *    had no choice but to store `to: null`. The result was an admin bubble
   *    with no language label at all while the customer's bubble had one.
   *
   * ⚠️ OPTIONAL, like the two above, and for the same reason: a send that omits
   *    it stores exactly what it stored yesterday. Rows written before today
   *    keep `to: null` and are NOT backfilled (owner, 10/09) — the bubble
   *    renders what it has and says nothing about what it does not.
   */
  @IsOptional()
  @IsString()
  @IsIn(TRANSLATE_LANGUAGE_CODES as string[])
  translated_lang?: string;
}

export class SendChatStickerDto {
  /** [FEAT-20260821-QUOTEREPLY] see SendChatReplyDto.quote_of. */
  @IsOptional()
  @IsMongoId()
  quote_of?: string;

  @IsString()
  packageId!: string;

  @IsString()
  stickerId!: string;
}

export class SyncUserProfileDto {
  @IsMongoId()
  hook_id!: string;

  @IsString()
  line_user_id!: string;
}

/**
 * [FEAT-20260918-ROOMTRANS] Update room translation settings.
 */
export class UpdateRoomTranslateSettingsDto {
  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined && val !== '')
  @IsString()
  @IsIn(TRANSLATE_LANGUAGE_CODES as string[])
  translate_lang?: string | null;

  @IsOptional()
  @IsBoolean()
  show_original_text?: boolean;

  /**
   * [FEAT-20260919-SHOWORIGSRC] Which side supplies the answer above — see the
   * column's own block in `chat-room.schema.ts`.
   *
   * ⚠️ THIS PROPERTY MUST EXIST HERE OR THE FEATURE IS SILENTLY DEAD. The global
   * `ValidationPipe` runs with `whitelist`, so a property that is not declared on
   * the DTO is STRIPPED before the handler sees it: the PATCH answers 200, the
   * dashboard shows the value it optimistically set, and the next page load
   * reverts it with no error anywhere to trace. That is the exact failure
   * dev-local §5 documents, and it is why the round-trip test for this field goes
   * through real HTTP rather than calling the service directly — a direct call
   * skips this pipe and would pass while the real path drops the field.
   * ไม่ประกาศตรงนี้ = pipe ตัดทิ้งเงียบ ๆ ตอบ 200 แต่ไม่เซฟ
   *
   * ⚠️ `@ValidateIf(v !== undefined)` RATHER THAN `@IsOptional()`, and the
   * difference is not cosmetic: class-validator's `@IsOptional()` skips every
   * other validator for `null` as well as for `undefined`, so a `null` would
   * have sailed past `@IsIn` and been written to the column. Mongoose's `enum`
   * does not reject `null` either. The result would be a SECOND spelling of "no
   * opinion" sitting beside `'all_rooms'` — which is exactly the ambiguity this
   * column was introduced to remove, and the resolver would have had to paper
   * over it forever. `undefined` (the property absent) still means "this request
   * is not about that field". null ต้องถูกตีกลับ ไม่ใช่เก็บไว้เป็นความหมายที่สอง
   *
   * The sibling `auto_translate` above does the opposite on purpose — there
   * `null` is a meaningful third state, so it is let through.
   */
  @ValidateIf((_, val) => val !== undefined)
  @IsString()
  @IsIn(['all_rooms', 'room'])
  show_original_text_source?: 'all_rooms' | 'room';

  @IsOptional()
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsBoolean()
  auto_translate?: boolean | null;

  @IsOptional()
  @IsBoolean()
  auto_send_translated?: boolean;
}
