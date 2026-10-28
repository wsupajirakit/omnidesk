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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common';

import {
  RefreshRawProfileDto,
  UpdateMemberDetailDto,
  UpdateMemberNicknameDto,
} from './dto';
import { CurrentUser, type AuthenticatedUser } from '@/common';
import { MembersService } from './members.service';

@ApiTags('members')
@Controller()
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Patch(['api/line-users/:id/nickname', 'api/channel-users/:id/nickname'])
  @RequirePermissions('ticket.manage')
  public async updateNickname(
    @Param('id') id: string,
    @Body() dto: UpdateMemberNicknameDto,
    // [FIX-20260818-MEMBERSCOPE · plan §8] a member is reachable only through a
    // room the caller shares with them.
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.updateNickname(id, dto, auth);
  }

  @Patch(['api/line-users/:id/detail', 'api/channel-users/:id/detail'])
  @RequirePermissions('ticket.manage')
  public async updateDetail(
    @Param('id') id: string,
    @Body() dto: UpdateMemberDetailDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.updateDetail(id, dto, auth);
  }

  /**
   * [FEAT-20260821-IGNOREABANDON] the per-customer "leave me alone" switch.
   *
   * Two paths like its siblings so `channel-users` callers keep working; same
   * permission, same scope guard. The OA-wide switch of the same name lives on
   * the hook and is set through `PATCH /hook/abandon/bulk` — either side being
   * on means the chase is off, and neither can turn the other back on.
   * revert: delete this route, the service method and the DTO.
   */
  @Patch([
    'api/line-users/:id/ignore-abandon',
    'api/channel-users/:id/ignore-abandon',
  ])
  @RequirePermissions('ticket.manage')
  public async updateIgnoreAbandon(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.updateIgnoreAbandon(id, body, auth);
  }

  /**
   * [FEAT-20260829-MANUALFOLLOWSTAMP] record a follow-up time by hand.
   *
   * Owner 29/08: on the customer panel, "ติดตามฝาก" / "ติดตามถอน" are pressable
   * while they read `n/a`, each behind its own confirm, and each press is
   * audited. Body: `{ "kind": "deposit" | "withdraw" }` — an allow-list, never a
   * config key, and never both in one call (they are pressed separately).
   *
   * Same permission and the same route pair as its neighbours: a member is
   * addressed through either alias and reachable only inside the caller's scope.
   *
   * revert: delete this route, `setFollowUpStamp` in the service and
   *         `member-follow-stamp.helper.ts`.
   */
  @Patch([
    'api/line-users/:id/follow-up-stamp',
    'api/channel-users/:id/follow-up-stamp',
  ])
  @RequirePermissions('ticket.manage')
  public async setFollowUpStamp(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.setFollowUpStamp(id, body, auth);
  }

  /**
   * [FEAT-20260830-FOLLOWUPFRESH] read this member's follow-up stamps NOW.
   *
   * The close-case dialog calls this as it opens, so the sections it shows
   * describe the member as they are at that moment rather than as they were
   * when the room was loaded. See the service method for why that matters.
   *
   * revert: delete this route and `getFollowUpStamps` in the service.
   */
  @Get([
    'api/line-users/:id/follow-up-stamp',
    'api/channel-users/:id/follow-up-stamp',
  ])
  @RequirePermissions('ticket.manage')
  public async getFollowUpStamps(
    @Param('id') id: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.getFollowUpStamps(id, auth);
  }

  @Get('api/line-users/:id/raw-profile')
  @RequirePermissions('ticket.manage')
  public async getRawProfile(
    @Param('id') id: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.getRawProfile(id, auth);
  }

  @Post('api/line-users/:id/raw-profile/refresh')
  // Legacy answers `res.json(...)` — 200, not Nest's POST default of 201. The
  // rejection paths hid this (they carry their own status); the success and
  // cooldown paths did not exist here until now.
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ticket.manage')
  public async refreshRawProfile(
    @Param('id') id: string,
    @Body() dto: RefreshRawProfileDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.refreshRawProfile(id, dto, auth);
  }

  @Delete('api/line-users/:id/raw-profile')
  @RequirePermissions('ticket.manage')
  public async clearRawProfile(
    @Param('id') id: string,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.membersService.clearRawProfile(id, auth);
  }

  @Get('api/hooks/:hookId/site-rules')
  @RequirePermissions('ticket.manage')
  public async getHookSiteRules(
    @Param('hookId') hookId: string,
  ): Promise<Record<string, unknown>> {
    return this.membersService.getHookSiteRules(hookId);
  }

  @Post('api/hooks/:hookId/site-rules/refresh')
  @RequirePermissions('ticket.manage')
  public async refreshHookSiteRules(
    @Param('hookId') hookId: string,
  ): Promise<Record<string, unknown>> {
    return this.membersService.refreshHookSiteRules(hookId);
  }
}
