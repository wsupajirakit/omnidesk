import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
// [FEAT-20260808-AUDITSITE] request_meta builder shared with the hook audit path
// (legacy buildRequestMeta, autoReplyController.js:39-43).
import { buildRequestMeta } from '@/modules/hooks';
import { AutoRepliesService } from './auto-replies.service';
import {
  CreateAutoReplyDto,
  UpdateAutoReplyActiveDto,
  UpdateAutoReplyDto,
} from './dto';

@ApiTags('Content - Auto Replies')
@Controller('api/auto-replies')
export class AutoRepliesController {
  constructor(private readonly autoRepliesService: AutoRepliesService) {}

  @Get()
  @RequirePermissions('auto_reply.manage')
  public async listAutoReplies(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.autoRepliesService.listAutoReplies(user, query);
  }

  @Get('findbyhook')
  @RequirePermissions('auto_reply.manage')
  public async listAutoRepliesByHookId(@Query('hook_id') hookId?: string) {
    return this.autoRepliesService.listAutoRepliesByHookId(hookId);
  }

  @Get(':id')
  @RequirePermissions('auto_reply.manage')
  public async getAutoReplyById(@Param('id') id: string) {
    return this.autoRepliesService.getAutoReplyById(id);
  }

  @Post()
  @RequirePermissions('auto_reply.manage')
  public async createAutoReply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAutoReplyDto,
    @Req() req: Request,
  ) {
    return this.autoRepliesService.createAutoReply(
      user,
      dto,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Put(':id')
  @RequirePermissions('auto_reply.manage')
  public async updateAutoReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAutoReplyDto,
    @Req() req: Request,
  ) {
    return this.autoRepliesService.updateAutoReply(
      user,
      id,
      dto,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Patch(':id/active')
  @RequirePermissions('auto_reply.manage')
  public async updateAutoReplyActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAutoReplyActiveDto,
    @Req() req: Request,
  ) {
    return this.autoRepliesService.updateAutoReplyActive(
      user,
      id,
      dto,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Delete(':id')
  @RequirePermissions('auto_reply.manage')
  public async deleteAutoReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.autoRepliesService.deleteAutoReply(
      user,
      id,
      buildRequestMeta(req.headers, req.ip),
    );
  }
}
