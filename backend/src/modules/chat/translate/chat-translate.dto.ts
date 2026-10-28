/**
 * [FEAT-20260908-CHATTRANS] the HTTP bodies of the two translate routes.
 * ===========================================================================
 * They live beside the controller that reads them rather than in `chat/dto/`,
 * because everything this feature adds to chat — the writer, the key check, the
 * route and its bodies — is one removable slice: deleting
 * `src/modules/chat/translate/` and its three wiring lines removes the feature
 * whole. The two OPTIONAL fields the EXISTING send route gains are a different
 * matter and stay where that route's body already lives (`dto/chat-room.dto.ts`).
 *
 * ## 🔴 THE SOURCE LANGUAGE IS OPTIONAL AND MUST STAY THAT WAY
 *
 * Owner, 09/09: *"เราไม่จำเป็นต้องเลือก src lang เพราะว่าเรารู้อยู่แล้ว และ ai ก็คิดได้อยู่แล้ว"* —
 * the model detects the source, so asking a human to state it is friction for
 * nothing, and the dashboard never sends one. But it is ACCEPTED, because
 * *"ตัว core translate เราจะรับแบบไหนก็ได้ … แต่ยังเป็น optional นะ ส่ง src lang ได้เผื่ออนาคต"*:
 * a future non-interactive caller may genuinely know the source and must be able
 * to say so. So `from` is optional, validated against the registry WHEN PRESENT,
 * and simply absent otherwise — never defaulted, never guessed, and never
 * back-filled from a hook locale or the UI language. When it is absent the
 * prompt omits its `from` clause entirely and the stored `from` is `null`.
 *
 * ## Validated twice, deliberately
 *
 * `@IsIn` here refuses an unlisted code at the HTTP edge with a 400 and a field
 * name, which is what a browser needs. The service checks the same registry
 * again, because a future caller reaching the service directly never meets the
 * `ValidationPipe` — the same two-layer rule `ticket.dto.ts:92` follows.
 *
 * revert: delete this file with the controller.
 */
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { TRANSLATE_LANGUAGE_CODES } from '@/modules/ai-translate';

/** `POST /api/chat/messages/:id/translate` — body `{ to, from? }`. */
export class TranslateChatMessageDto {
  /** The language to translate INTO. One of the seven registry codes. */
  @IsString()
  @IsIn(TRANSLATE_LANGUAGE_CODES as string[])
  to!: string;

  /** Optional source hint. Absent ⇒ the model detects it. See the header. */
  @IsOptional()
  @IsString()
  @IsIn(TRANSLATE_LANGUAGE_CODES as string[])
  from?: string;
}

/** `POST /api/chat/:id/translate-preview` — body `{ text, to, from? }`. */
export class TranslateChatPreviewDto {
  /**
   * The draft the admin typed. Never stored: this route writes no row, no
   * column and no audit entry, because the draft may never become a message.
   *
   * The ceiling mirrors the funnel's own input guard rather than inventing a
   * number — a composer draft that long is a paste, not a message, and every
   * character is billed by the vendor.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsString()
  @IsIn(TRANSLATE_LANGUAGE_CODES as string[])
  to!: string;

  @IsOptional()
  @IsString()
  @IsIn(TRANSLATE_LANGUAGE_CODES as string[])
  from?: string;
}
