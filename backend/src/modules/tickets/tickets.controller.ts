/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/routes/apiRoutes.js (ticket endpoints)
 *
 * WHY IT IS NOT SPLIT YET
 * Per the accepted-debt policy in check-list.md, legacy routes move in two
 * steps. Step one ports the handlers to NestJS controllers so they run; step
 * two splits them once golden tests are in place.
 *
 * WHAT UNBLOCKS SPLITTING
 * Every /api/tickets endpoint golden-green against the running legacy backend.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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

import {
  ClearTicketsDto,
  CreateTicketDto,
  ReopenTicketByAdminDto,
  OpenTicketFromRoomDto,
  UpdateTicketDto,
} from './dto';
import { TicketsService } from './tickets.service';

@ApiTags('tickets')
@Controller('api/tickets')
@RequirePermissions('ticket.manage')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('meta/batch')
  public async getTicketMetaBatch(
    @Query('groups') groups?: string,
    // [FEAT-20260808-TKTSCOPE] optional FE date-scope; omitted = unbounded (today).
    @Query('within_days') withinDays?: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.getTicketMetaBatch(groups, auth, withinDays);
  }

  /**
   * [FIX-20260819-EVERTICKETED] Which customers of this OA have EVER had a case.
   *
   * The ticket lists the dashboard loads are date-scoped (`within_days`), so they
   * can answer "any case recently" but never "any case ever" — and the bot-care
   * tab's new rows need exactly that: a conversation is only "never escalated" if
   * NO ticket exists for it at any time. Deriving it from a windowed list marked
   * long-quiet customers as brand new, which is the bug this route fixes.
   *
   * A `distinct` on an indexed field returning ids only: no documents, no dates,
   * no pagination — the lightest question that can be asked here.
   * ลิสต์ที่ครอบด้วยกรอบเวลา ตอบ "เคยมีเคสไหม" ไม่ได้ ต้องถามฐานข้อมูลตรง ๆ.
   */
  @Get('hook/:hook_id/ticketed-members')
  public async getTicketedMembers(
    @Param('hook_id') hookId: string,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.getTicketedMembers(hookId);
  }

  /**
   * [FEAT-20260820-BOTCOUNTBE] The half of the บอทดูแล badge the dashboard cannot
   * see from another tab — customers with a room and no case at all.
   *
   * The closed-case half stays where it was, computed in the browser, so this
   * route existing changes no other tab's number. See the service method for why
   * the dashboard cannot answer it alone. อ่านอย่างเดียว · ให้เฉพาะครึ่งที่ขาด.
   */
  @Get('hook/:hook_id/no-case-room-count')
  public async getNoCaseRoomCount(
    @Param('hook_id') hookId: string,
    /* [FIX-20260829-BOTBADGEWINDOW] optional, same name and shape as the sibling
       meta route above; omitted = unbounded = the original behaviour. */
    @Query('within_days') withinDays?: string,
  ): Promise<Record<string, unknown>> {
    const n = Number(withinDays);
    return this.ticketsService.getNoCaseRoomCount(
      hookId,
      Number.isFinite(n) && n > 0 ? n : undefined,
    );
  }

  /**
   * [FIX-20260902-BOTONESOURCE] The rooms behind the บอทดูแล tab.
   *
   * The sibling route above answers HOW MANY; this answers WHICH. They share one
   * rule inside the service, so the dashboard can stop counting for itself — the
   * reason it has to is that a browser can only count what it managed to load,
   * which made the same badge read 29 from one tab and 28 from another, and made
   * two operators see different numbers for the same OA at the same moment.
   *
   * Same parameter, same name, same shape as the count route on purpose: the two
   * are read together and a difference between them would be a bug source.
   *
   * revert: delete this route and the service method it calls.
   */
  @Get('hook/:hook_id/no-case-rooms')
  public async getNoCaseRooms(
    @Param('hook_id') hookId: string,
    @Query('within_days') withinDays?: string,
  ): Promise<Record<string, unknown>> {
    const n = Number(withinDays);
    return this.ticketsService.getNoCaseRooms(
      hookId,
      Number.isFinite(n) && n > 0 ? n : undefined,
    );
  }

  @Get('hook/:hook_id/meta')
  public async getTicketMetaByHook(
    @Param('hook_id') hookId: string,
    // [FEAT-20260808-TKTSCOPE] optional FE date-scope; omitted = unbounded (today).
    @Query('within_days') withinDays?: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.getTicketMeta(
      hookId,
      undefined,
      auth,
      withinDays,
    );
  }

  @Post('hook/:hook_id/clear')
  public async clearTickets(
    @Param('hook_id') hookId: string,
    @Body() dto: ClearTicketsDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.clearTickets(hookId, dto, auth);
  }

  @Get('hook/:hook_id/tier-options')
  public async listTierOptionsByHook(
    @Param('hook_id') hookId: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.listTierOptions(hookId, undefined, auth);
  }

  @Get('group/:group_id/tier-options')
  public async listTierOptionsByGroup(
    @Param('group_id') groupId: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.listTierOptions(undefined, groupId, auth);
  }

  @Get('hook/:hook_id')
  public async listTicketsByHook(
    @Param('hook_id') hookId: string,
    @Query() queryDto: Record<string, unknown>,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.listTickets(queryDto, hookId, undefined, auth);
  }

  @Get('group/:group_id/meta')
  public async getTicketMetaByGroup(
    @Param('group_id') groupId: string,
    // [FEAT-20260808-TKTSCOPE] optional FE date-scope; omitted = unbounded (today).
    @Query('within_days') withinDays?: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.getTicketMeta(
      undefined,
      groupId,
      auth,
      withinDays,
    );
  }

  @Get('group/:group_id')
  public async listTicketsByGroup(
    @Param('group_id') groupId: string,
    @Query() queryDto: Record<string, unknown>,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.listTickets(queryDto, undefined, groupId, auth);
  }

  // [FEAT-20260817-REOPENBYADMIN] "เปิดเคสอีกครั้ง" — reopen a closed case as a
  // NEW ticket owned by the presser. Placed above the `:id` routes by house
  // rule (no @Post(':id') exists, so this is readability, not a collision fix).
  // Permissions come from the class-level @RequirePermissions('ticket.manage').
  @Post('reopen-by-admin')
  public async reopenTicketByAdmin(
    @Body() dto: ReopenTicketByAdminDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.reopenTicketByAdmin(dto.ticket_id, auth);
  }

  /**
   * [FEAT-20260819-OPENFROMROOM] Open the FIRST case for a conversation that has
   * none. Sits beside reopen-by-admin and is deliberately a separate route with a
   * separate name: the two share every step after the customer is identified, but
   * "reopen" would be a lie here — there is no earlier ticket.
   * Above @Get(':id') for the same readability reason stated there.
   */
  @Post('open-from-room')
  public async openTicketFromRoom(
    @Body() dto: OpenTicketFromRoomDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.openTicketFromRoom(
      dto.room_id,
      { category: dto.category, needDetail: dto.need_detail },
      auth,
    );
  }

  @Get(':id')
  public async getTicketById(
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.getTicketById(id);
  }

  @Post()
  public async createTicket(
    @Body() dto: CreateTicketDto,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.createTicket(dto as Record<string, unknown>);
  }

  @Put(':id')
  public async updateTicket(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() auth?: AuthenticatedUser,
    // [FEAT-20260808-P3MINIMAL] opt-in fast-path, restoring the dropped legacy
    // `?minimal=true` (ticketController.js:606). ABSENT/anything-but-'true' ⇒
    // today's fully-populated response, byte-identical. Only `'true'` skips the
    // populates + populateAttachedFiles for a lighter payload.
    @Query('minimal') minimal?: string,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.updateTicket(
      id,
      dto as Record<string, unknown>,
      auth,
      minimal === 'true',
    );
  }

  @Delete(':id')
  public async deleteTicket(
    @Param('id') id: string,
    // [FIX-20260818-TICKETSCOPE · plan §8] a permanent delete must know who asked.
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.ticketsService.deleteTicket(id, auth);
  }
}
