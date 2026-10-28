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

import { AssignHistoriesService } from './assign-histories.service';
import { ListAssignHistoriesQueryDto } from './dto';

/**
 * The write body, deliberately open-ended — see the note on the write routes.
 * Mongoose drops anything it does not declare, exactly as it does for legacy.
 */
type AssignHistoryBody = Record<string, unknown>;

@ApiTags('assign-histories')
@Controller('api/assign-histories')
@RequirePermissions('ticket.manage')
export class AssignHistoriesController {
  constructor(
    private readonly assignHistoriesService: AssignHistoriesService,
  ) {}

  @Get()
  public async listAssignHistories(
    @Query() queryDto: ListAssignHistoriesQueryDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.assignHistoriesService.listAssignHistories(queryDto, auth);
  }

  @Get(':id')
  public async getAssignHistoryById(
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.assignHistoriesService.getAssignHistoryById(id);
  }

  /**
   * ⚠️ `@Body()` is typed as a plain interface on both write routes, NOT as a
   * DTO class. That is required, not lazy — same reasoning as
   * hooks.controller.ts:64.
   *
   * The global ValidationPipe runs with `forbidNonWhitelisted: true`
   * (main.ts:66), so a DTO class REJECTS any undeclared property with
   * `400 {"error":"property <x> should not exist"}`. Legacy does
   * `new AssignHistory(req.body)` (assignHistoryController.js:30) and
   * `findByIdAndUpdate(id, {$set: req.body})` (:187) with no request
   * validation at all, and Mongoose silently DROPS keys the schema does not
   * declare — so legacy answers 201/200 for the very same body. A caller that
   * sends one field the schema does not know therefore succeeded on legacy and
   * failed here.
   *
   * Dropping the DTO class does not widen the attack surface: the service
   * hands the body to `assignHistoryModel.create()` / `$set`, and Mongoose
   * strips undeclared paths itself, which is the exact mechanism legacy relies
   * on for the same protection. Field types are still enforced by the schema.
   */
  @Post()
  public async createAssignHistory(
    @Body() body: AssignHistoryBody,
  ): Promise<Record<string, unknown>> {
    return this.assignHistoriesService.createAssignHistory(body);
  }

  @Put(':id')
  public async updateAssignHistory(
    @Param('id') id: string,
    @Body() body: AssignHistoryBody,
  ): Promise<Record<string, unknown>> {
    return this.assignHistoriesService.updateAssignHistory(id, body);
  }

  @Delete(':id')
  public async deleteAssignHistory(
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    return this.assignHistoriesService.deleteAssignHistory(id);
  }
}
