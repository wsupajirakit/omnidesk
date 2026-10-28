/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/routes/apiRoutes.js (chat endpoints)
 *
 * WHY IT IS NOT SPLIT YET
 * Per the accepted-debt policy in check-list.md, legacy routes move in two
 * steps. Step one ports the handlers to NestJS controllers so they run; step
 * two splits them once golden tests are in place.
 *
 * WHAT UNBLOCKS SPLITTING
 * Every /api/chat endpoint golden-green against the running legacy backend.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { ChatService } from './chat.service';
import {
  CreateCustomerTagDto,
  CreateInlineNoteDto,
  CreateRoomNoteDto,
  ListChatRoomsDto,
  ListContactsDto,
  ListPopularTagsDto,
  ListRoomNotesQueryDto,
  SendChatReplyDto,
  SendChatStickerDto,
  SuggestTagsDto,
  SyncUserProfileDto,
  UpdateAssistStatusDto,
  UpdateNicknameDto,
  UpdateNoteContentDto,
  UpdateRoomNoteDto,
  UpdateRoomTranslateSettingsDto,
} from './dto';

@ApiTags('chat')
@Controller('api/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  public async listRooms(
    @Query() dto: ListChatRoomsDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.listRooms(dto, auth);
  }

  @Get('contacts')
  @RequirePermissions('contact.manage')
  public async listContacts(
    @Query() dto: ListContactsDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.listContacts(dto, auth);
  }

  /**
   * [FIX-20260817-CHATWRITEGUARD] TWO permissions, either one grants — this
   * route has two real callers on two differently-gated screens, traced in the
   * FE before choosing:
   *   · ticket side — `ChatRoomView.tsx:1427`, inside the detail box, reached
   *     from `/ticket-support` (App.tsx:1194 requires `ticket.manage`)
   *   · contact side — `RefreshProfileButton.tsx:40` via
   *     `ContactHeaderInfo.tsx:99`, on `/contacts`
   *     (App.tsx:1212 requires `contact.manage`)
   * Guarding with `ticket.manage` alone would have broken the Contact header's
   * refresh button for a contact-only operator — the reason this was not
   * bundled with the assist fix. `@RequirePermissions` is ANY-of
   * (`permissions.guard.ts:46`), so the narrower screens keep working.
   * ⚠️ this handler calls the LINE profile API and upserts a member row, so it
   * is a write in every sense. สองสิทธิ์ ถืออันใดอันหนึ่งก็ผ่าน.
   * revert: delete the decorator (back to "any logged-in account").
   */
  @Post('user/sync-profile')
  @RequirePermissions('ticket.manage', 'contact.manage')
  // Legacy answers `res.status(200)`, not Nest's POST default of 201.
  @HttpCode(HttpStatus.OK)
  public async syncUserProfile(
    @Body() dto: SyncUserProfileDto,
    // [FIX-20260818-CHATOASCOPE · plan §8] the body names the hook whose LINE
    // token gets spent, so the caller must be scoped to it.
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.syncUserProfile(dto, auth);
  }

  /* ══ [FIX-20260817-ASSISTGUARD] the assist trio needs a permission ═════════
   * WHAT  all six assist routes below now require `ticket.manage`, the same
   *       permission `POST /api/tickets/reopen-by-admin` already demands for
   *       the identical outcome (`chat_rooms.assist_status`).
   *
   * WHY   `PermissionsGuard` passes any route that declares nothing
   *       (`permissions.guard.ts:36`, deliberate). These six declared nothing,
   *       so every authenticated account could flip the switch that five
   *       systems read — bot silence (`webhook.service.ts:1196`), hand-off
   *       cards (`assist-notification.ts:379`), the payment ticket claim
   *       (`payment-ticket.helper.ts:166`), the reopen claim
   *       (`create-ticket-by-admin.helper.ts:97`) and the Other→Payment
   *       upgrade (`ticket-category-upgrade.helper.ts:181`). Until now the only
   *       gate was the dashboard's own `canToggleAssist` (FE
   *       `ChatRoomView.tsx:495`), which any HTTP client simply skips.
   *
   * PARITY  this DIVERGES from legacy on purpose: `legacy-api` mounts the same
   *       six routes with no `authorize()` (`src/routes/apiRoutes.js:328-334`),
   *       so the gap was inherited by a faithful port, not introduced by it.
   *       `members.golden-spec.ts` compares these routes with GOLDEN_USERNAME
   *       (`dev`, role `superadmin` ⇒ role permissions incl. `system.manage`
   *       ⇒ guard override, `auth.service.ts:145-155`), so parity holds for
   *       that account and would 403 only for an account that never had the
   *       right to be here.
   *
   * ห้ามถอด decorator ทั้งหกออกโดยไม่มีเหตุผล — เส้นพวกนี้เขียน DB และปิดปากบอทได้.
   * revert: delete the six decorators (behaviour returns to "any logged-in
   *       account"); the spec `z-test/unit/chat-assist-guard.spec.ts` fails.
   * ═════════════════════════════════════════════════════════════════════════ */
  @Get('user/:id/assist/status')
  @RequirePermissions('ticket.manage')
  public async getAssistStatus(
    @Param('id') id: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getAssistStatus(id, auth);
  }

  @Put('user/:id/assist/status')
  @RequirePermissions('ticket.manage')
  public async updateAssistStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAssistStatusDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.updateAssistStatus(id, dto, auth);
  }

  @Get('line/:line_user_id/assist/status')
  @RequirePermissions('ticket.manage')
  public async getAssistStatusByLineUserId(
    @Param('line_user_id') lineUserId: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getAssistStatusByMemberId(lineUserId, auth);
  }

  @Put('line/:line_user_id/assist/status')
  @RequirePermissions('ticket.manage')
  public async updateAssistStatusByLineUserId(
    @Param('line_user_id') lineUserId: string,
    @Body() dto: UpdateAssistStatusDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.updateAssistStatusByMemberId(lineUserId, dto, auth);
  }

  @Get('channel-user/:channel_user_id/assist/status')
  @RequirePermissions('ticket.manage')
  public async getAssistStatusByChannelUserId(
    @Param('channel_user_id') channelUserId: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getAssistStatusByMemberId(channelUserId, auth);
  }

  @Put('channel-user/:channel_user_id/assist/status')
  @RequirePermissions('ticket.manage')
  public async updateAssistStatusByChannelUserId(
    @Param('channel_user_id') channelUserId: string,
    @Body() dto: UpdateAssistStatusDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.updateAssistStatusByMemberId(
      channelUserId,
      dto,
      auth,
    );
  }

  @Get('tags/popular')
  @RequirePermissions('ticket.manage')
  public async listPopularTags(
    @Query() dto: ListPopularTagsDto,
    // [FEAT-20260816-TAGSCOPE] options follow the caller's OA permission —
    // superadmin sees all, others only tags in use on their own OAs.
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.listPopularTags(dto, auth);
  }

  @Get('tags/suggest')
  @RequirePermissions('ticket.manage')
  public async suggestTags(
    @Query() dto: SuggestTagsDto,
  ): Promise<Record<string, unknown>> {
    return this.chatService.suggestTags(dto);
  }

  /**
   * ⚠️ There is deliberately NO `@Get('notes/:noteId')`. Legacy mounts only PUT
   * and DELETE on this path (apiRoutes.js:439-440), so a GET falls through to
   * its catch-all and is not an API route at all. A placeholder that rejected
   * with `new Error('Not implemented')` used to sit here and answered **500**,
   * where every other unmatched path answers 404. Removing it lets the router
   * produce the 404 on its own.
   *
   * Ordering still holds: this path cannot be captured by `@Get(':roomId/notes')`
   * below, whose shape is `<room>/notes`, not `notes/<id>`.
   */
  @Put('notes/:noteId')
  @RequirePermissions('ticket.manage')
  public async updateNoteContent(
    @Param('noteId') noteId: string,
    @Body() dto: UpdateNoteContentDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.updateNoteContent(noteId, dto, auth);
  }

  @Delete('notes/:noteId')
  @RequirePermissions('ticket.manage')
  public async deleteRoomNote(
    @Param('noteId') noteId: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.deleteRoomNote(noteId, auth);
  }

  @Delete('tags/:tagId')
  @RequirePermissions('ticket.manage')
  public async deleteCustomerTag(
    @Param('tagId') tagId: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.deleteCustomerTag(tagId, auth);
  }

  @Get(':id/messages/search')
  public async searchRoomMessages(
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('hook_id') hookId?: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.searchRoomMessages(id, q, hookId, auth);
  }

  @Get(':id/messages/around/:messageId')
  public async getMessagesAround(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Query('hook_id') hookId?: string,
    // [FEAT-20260821-QUOTEJUMP] 'provider' = anchor on LINE's message id.
    @Query('by') by?: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getMessagesAround(
      id,
      messageId,
      hookId,
      auth,
      by === 'provider' ? 'provider' : 'id',
    );
  }

  @Get(':id/messages')
  public async getRoomMessages(
    @Param('id') id: string,
    @Query()
    queryDto: {
      page?: number;
      limit?: number;
      sort?: string;
      hook_id?: string;
    },
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getRoomMessages(id, queryDto, auth);
  }

  /**
   * [FIX-20260817-CHATWRITEGUARD] `ticket.manage` only — traced, not assumed.
   *
   * This route has NO caller anywhere: the dashboard edits a nickname through
   * `/api/line-users/:id/nickname` instead (`ticketService.ts:522`), and the
   * golden suite only ever drives that alias, never this one. Kept rather than
   * deleted because legacy mounts it (`apiRoutes.js:386`) and removing a route
   * is a parity break; guarded because it writes a member row.
   * ไม่มีใครเรียก แต่ไม่ลบ (parity) — ปิดประตูไว้ก่อน.
   */
  @Patch(':id/nickname')
  @RequirePermissions('ticket.manage')
  public async updateNickname(
    @Param('id') id: string,
    @Body() dto: UpdateNicknameDto,
  ): Promise<Record<string, unknown>> {
    return this.chatService.updateNickname(id, dto);
  }

  /**
   * [FIX-20260817-CHATWRITEGUARD] `ticket.manage` only — and `contact.manage`
   * is deliberately NOT added here, unlike `sync-profile` above.
   *
   * The single UI write path is the note editor inside `ChatRoomView`'s detail
   * box (`ChatRoomView.tsx:1470-1497`, rendered only under `showDetailBox`
   * `:1417`). Every screen that passes it: `TicketSupport.tsx:4176`
   * (`showDetailBox={true}`, route needs `ticket.manage`) — while
   * `Contact.tsx:569` and `TicketChat.tsx:2714` pass `false` precisely to close
   * this write path, and `/chat` is now a redirect (App.tsx:1075). So no
   * contact-only operator can reach it, and the four sibling note routes in
   * this controller already require `ticket.manage`.
   * revert: delete the decorator.
   */
  @Patch(':id/note')
  @RequirePermissions('ticket.manage')
  public async updateRoomNote(
    @Param('id') id: string,
    @Body() dto: UpdateRoomNoteDto,
  ): Promise<Record<string, unknown>> {
    return this.chatService.updateRoomNote(id, dto);
  }

  @Post(':id/inline-note')
  @RequirePermissions('ticket.manage')
  public async createInlineNote(
    @Param('id') id: string,
    @Query('hook_id') hookId: string | undefined,
    @Body() dto: CreateInlineNoteDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.createInlineNote(id, hookId, dto, auth);
  }

  @Post([':id/push', ':id/reply'])
  @RequirePermissions('ticket.manage')
  public async sendChatReply(
    @Param('id') id: string,
    @Query('hook_id') hookId: string | undefined,
    @Body() dto: SendChatReplyDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.sendChatReply(id, hookId, dto, auth);
  }

  @Post([':id/push-sticker', ':id/send-sticker'])
  @RequirePermissions('ticket.manage')
  public async sendChatSticker(
    @Param('id') id: string,
    @Query('hook_id') hookId: string | undefined,
    @Body() dto: SendChatStickerDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.sendChatSticker(id, hookId, dto, auth);
  }

  @Get(':roomId/notes')
  @RequirePermissions('ticket.manage')
  public async listRoomNotes(
    @Param('roomId') roomId: string,
    @Query() queryDto: ListRoomNotesQueryDto,
    // [FIX-20260818-ROOMSCOPE · plan §8] notes belong to a room, and a room
    // belongs to an OA — the caller must be inside it.
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.listRoomNotes(roomId, queryDto, auth);
  }

  @Post(':roomId/notes')
  @RequirePermissions('ticket.manage')
  public async createRoomNote(
    @Param('roomId') roomId: string,
    @Body() dto: CreateRoomNoteDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.createRoomNote(roomId, dto, auth);
  }

  @Get(':roomId/tags')
  @RequirePermissions('ticket.manage')
  public async listCustomerTags(
    @Param('roomId') roomId: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.listCustomerTags(roomId, auth);
  }

  @Post(':roomId/tags')
  @RequirePermissions('ticket.manage')
  public async createCustomerTag(
    @Param('roomId') roomId: string,
    @Body() dto: CreateCustomerTagDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.createCustomerTag(roomId, dto, auth);
  }

  /**
   * [FEAT-20260918-ROOMTRANS] Get room translation settings and effective hook defaults.
   */
  @Get(':id/translate-settings')
  @RequirePermissions('ticket.manage')
  public async getRoomTranslateSettings(
    @Param('id') id: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.getRoomTranslateSettings(id, auth);
  }

  /**
   * [FEAT-20260918-ROOMTRANS] Update room translation settings (translate_lang, show_original_text, auto_translate).
   */
  @Patch(':id/translate-settings')
  @RequirePermissions('ticket.manage')
  public async updateRoomTranslateSettings(
    @Param('id') id: string,
    @Body() dto: UpdateRoomTranslateSettingsDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.chatService.updateRoomTranslateSettings(id, dto, auth);
  }
}
