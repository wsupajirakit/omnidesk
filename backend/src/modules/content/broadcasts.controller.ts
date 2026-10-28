import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  MongooseErrorInterceptor,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
// [FEAT-20260808-AUDITSITE] request_meta builder (legacy buildRequestMeta,
// broadcastController.js:27-31).
import { buildRequestMeta } from '@/modules/hooks';
import {
  BroadcastHistoryReadService,
  BroadcastPreviewService,
} from './broadcast-run';
/* [FEAT-20260823-BCASTSVCSPLIT] Reads and writes are two providers now — the
   class was over the line ratchet and the natural cut is what a call TOUCHES:
   listing answers a question, the rest changes data or sends to customers. */
import { BroadcastsReadService } from './broadcasts-read.service';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto, UpdateBroadcastDto } from './dto';

@ApiTags('Content - Broadcasts')
@Controller('api/broadcasts')
export class BroadcastsController {
  constructor(
    private readonly broadcastsService: BroadcastsService,
    private readonly readService: BroadcastsReadService,
    private readonly previewService: BroadcastPreviewService,
    private readonly historyService: BroadcastHistoryReadService,
  ) {}

  @Get()
  @RequirePermissions('broadcast.manage')
  public async listBroadcasts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.readService.listBroadcasts(user, query);
  }

  /**
   * [FEAT-20260823-BCASTSOURCES] The recipient-condition registry, for the form.
   *
   * 🔴 DECLARED BEFORE `:id`, and that is not cosmetic. Nest matches routes in
   * declaration order, so `@Get(':id')` above would swallow
   * `/api/broadcasts/audience-sources` and answer "Invalid broadcast
   * identifier" — a 400 that blames the caller for the router's mistake.
   * เส้นทางที่เป็นคำเฉพาะ ต้องมาก่อนเส้นทางที่รับพารามิเตอร์เสมอ.
   *
   * ⚠️ READ-ONLY, and it touches nothing that sends. It exists so the form
   *    builds its dropdown from the SAME table the filter builder reads —
   *    a second hardcoded list on the screen is a list that drifts.
   *    หน้าจอกับตัวคัดต้องอ่านทะเบียนเดียวกัน ไม่งั้นเพี้ยนกันแน่นอน.
   *
   * revert: delete this method; nothing else depends on it.
   */
  @Get('audience-sources')
  @RequirePermissions('broadcast.manage')
  public listAudienceSources() {
    return this.readService.listAudienceSources();
  }

  @Get(':id')
  @RequirePermissions('broadcast.manage')
  public async getBroadcastById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.readService.getBroadcastById(id, user);
  }

  // `assign_group` is looked up by id, so a caller sending the whole group
  // OBJECT produces a cast error against model "Group". Legacy's catch turns
  // that into `error.statusCode || 400` with the raw message.
  @Post()
  @RequirePermissions('broadcast.manage')
  @UseInterceptors(MongooseErrorInterceptor)
  public async createBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBroadcastDto,
    @Req() req: Request,
  ) {
    return this.broadcastsService.createBroadcast(
      user,
      dto,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Put(':id')
  @RequirePermissions('broadcast.manage')
  public async updateBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBroadcastDto,
    @Req() req: Request,
  ) {
    return this.broadcastsService.updateBroadcast(
      user,
      id,
      dto,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Delete(':id')
  @RequirePermissions('broadcast.manage')
  public async deleteBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.broadcastsService.deleteBroadcast(
      user,
      id,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  /**
   * [FEAT-20260823-BCASTPREVIEW] What this campaign would send, without sending.
   *
   * 🔴 `@Post` because it is an ACTION, matching `:id/send` beside it — but it
   *    reaches no dispatcher and holds no token. It cannot send; see
   *    `preview.service.ts`'s header for why that is structural rather than a
   *    promise.
   *
   * ⚠️ Same permission as sending. The preview renders REAL customer-facing
   *    content for a specific OA, so anyone who can see it could equally read
   *    that OA's card by other means — but nobody with less access should.
   *    สิทธิ์เท่ากับตอนส่ง เพราะเห็นเนื้อหาจริงของ OA นั้น.
   */
  /**
   * [FEAT-20260823-BCASTHISTREAD] What every run of this job actually did.
   *
   * ⚠️ MUST be declared BEFORE `@Get(':id')` would match — Nest resolves in
   *    declaration order, and this file's own comment above records that trap
   *    for `audience-sources`. Here the extra segment makes it unambiguous,
   *    but the ordering habit is kept. ลำดับประกาศสำคัญใน Nest.
   */
  @Get(':id/history')
  @RequirePermissions('broadcast.manage')
  public async broadcastHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.historyService.historyOf(id, query, user);
  }

  /**
   * [FEAT-20260824-RUNDETAIL] One round of one campaign, in full.
   *
   * Owner, 24/08: *"ต้องแสดงทั้ง history + webhook log จะได้ครบ แต่ว่าทำเป็น modal
   * กดดู"* — so this is a per-run read, opened on demand, never part of the list.
   *
   * ⚠️ DECLARED BEFORE `@Get(':id')`, like its sibling above: Nest resolves
   *    routes in declaration order. The extra segments make it unambiguous here,
   *    but the habit is what stops the next addition breaking.
   *
   * ⚠️ It is a GET and it READS ONLY — the round already happened. Nothing here
   *    can send, claim or release anything.
   */
  @Get(':id/history/:runId')
  @RequirePermissions('broadcast.manage')
  public async broadcastRunDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('runId') runId: string,
  ) {
    return this.historyService.runDetail(id, runId, user);
  }

  @Post(':id/preview')
  @RequirePermissions('broadcast.manage')
  public async previewBroadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return { data: await this.previewService.previewBroadcast(id, user) };
  }

  @Post(':id/send')
  @RequirePermissions('broadcast.manage')
  public async sendBroadcastNow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.broadcastsService.sendBroadcastNow(
      user,
      id,
      buildRequestMeta(req.headers, req.ip),
    );
  }
}
