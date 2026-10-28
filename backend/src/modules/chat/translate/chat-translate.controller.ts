/**
 * [FEAT-20260908-CHATTRANS] the two translate routes on the chat surface.
 * ===========================================================================
 * A controller of its own rather than eleven more lines in `chat.controller.ts`
 * (413 lines, and explicitly awaiting a split): everything this feature adds to
 * chat lives under `chat/translate/`, so removing it is deleting one folder and
 * three wiring lines. The whole slice is on one screen.
 *
 * ## Route shapes, and why neither can shadow an existing one
 *
 *   POST /api/chat/messages/:id/translate     — 3 segments, MESSAGE id
 *   POST /api/chat/:id/translate-preview      — 2 segments, ROOM id
 *
 * `ChatController`'s POST routes are all two-segment (`:id/reply`,
 * `:id/inline-note`, `:roomId/notes`, `:roomId/tags`), so a three-segment path
 * cannot be captured by any of them, and `translate-preview` is a literal
 * second segment that collides with no other literal. The first route puts the
 * noun BEFORE the id for exactly this reason: `:id/messages/...` would have sat
 * in the same shape as the room routes and would have been read as a room id by
 * anyone skimming.
 *
 * ⚠️ Two controllers may share `@Controller('api/chat')` — Nest registers both
 * and matches by path, and `route-coverage.mjs` walks the decorators, so both
 * routes are visible to it. No existing route's handler, guard, DTO or response
 * changes.
 *
 * `@RequirePermissions('ticket.manage')` — the same permission the send route
 * and every other write on this surface carries. It is ANY-of, and the OA-scope
 * wall inside the service is the second half: permission says "may use chat",
 * scope says "may act on THIS OA".
 *
 * revert: delete this file and its line in `chat.module.ts`'s `controllers`.
 */
import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import {
  TranslateChatMessageDto,
  TranslateChatPreviewDto,
} from './chat-translate.dto';
import { ChatTranslateService } from './chat-translate.service';

@ApiTags('chat')
@Controller('api/chat')
export class ChatTranslateController {
  constructor(private readonly translate: ChatTranslateService) {}

  /**
   * Translate ONE stored message into ONE language.
   *
   * Answers `{ success, data: { lang, text, from, to, cached } }`. A second
   * press on the same message and language is `cached: true` and costs nothing:
   * the answer is stored on the message, once, forever.
   */
  @Post('messages/:id/translate')
  @RequirePermissions('ticket.manage')
  public async translateMessage(
    @Param('id') id: string,
    @Body() dto: TranslateChatMessageDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.translate.translateMessage(id, dto, auth);
  }

  /**
   * Translate a draft the admin is still typing. Writes NOTHING.
   *
   * 🔴 Translating is not sending. This route never reaches a customer, never
   * creates a message row and never records an audit entry — the admin presses
   * the EXISTING send button afterwards, or does not.
   *
   * `?hook_id=` is accepted for the same reason the send route accepts it: `:id`
   * may be a customer id instead of a room `_id` on some screens.
   */
  @Post(':id/translate-preview')
  @RequirePermissions('ticket.manage')
  public async translatePreview(
    @Param('id') id: string,
    @Query('hook_id') hookId: string | undefined,
    @Body() dto: TranslateChatPreviewDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.translate.previewTranslation(id, hookId, dto, auth);
  }
}
