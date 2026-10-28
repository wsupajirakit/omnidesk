import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
import {
  CreateQuickReplyCategoryDto,
  CreateQuickReplyDto,
  UpdateQuickReplyCategoryDto,
  UpdateQuickReplyDto,
} from './dto';
import { QuickRepliesService } from './quick-replies.service';

@ApiTags('Content - Quick Replies')
@Controller('api')
export class QuickRepliesController {
  constructor(private readonly quickRepliesService: QuickRepliesService) {}

  @Get('quick-replies')
  @RequirePermissions('ticket.manage')
  public async listQuickReplies() {
    return this.quickRepliesService.listQuickReplies();
  }

  @Post('quick-reply-categories')
  @RequirePermissions('ticket.manage')
  public async createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuickReplyCategoryDto,
  ) {
    return this.quickRepliesService.createCategory(user, dto);
  }

  @Patch('quick-reply-categories/:id')
  @RequirePermissions('ticket.manage')
  public async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuickReplyCategoryDto,
  ) {
    return this.quickRepliesService.updateCategory(user, id, dto);
  }

  @Delete('quick-reply-categories/:id')
  @RequirePermissions('ticket.manage')
  public async deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quickRepliesService.deleteCategory(user, id);
  }

  @Post('quick-replies')
  @RequirePermissions('ticket.manage')
  public async createReply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuickReplyDto,
  ) {
    return this.quickRepliesService.createReply(user, dto);
  }

  @Patch('quick-replies/:id')
  @RequirePermissions('ticket.manage')
  public async updateReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuickReplyDto,
  ) {
    return this.quickRepliesService.updateReply(user, id, dto);
  }

  @Delete('quick-replies/:id')
  @RequirePermissions('ticket.manage')
  public async deleteReply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quickRepliesService.deleteReply(user, id);
  }
}
