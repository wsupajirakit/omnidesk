/**
 * LIFTED — pending rewrite. See slip-verification.service.ts for the source and
 * the reason the split is deferred.
 *
 * Mounted under `/api/slip-verifications`, matching the legacy router.
 * Every route carries `slip.manage`, exactly as `authorize("slip.manage")` did.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Types } from 'mongoose';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
// [FEAT-20260808-AUDITSITE] request_meta builder (legacy buildRequestMeta,
// slipVerificationController.js:20-24).
import { buildRequestMeta } from '@/modules/hooks';

import {
  ListSlipVerificationsQueryDto,
  SlipVerificationPayloadDto,
} from './dto';
import {
  SlipVerificationService,
  type SlipListResult,
} from './slip-verification.service';

@ApiTags('slip')
@Controller('api/slip-verifications')
@RequirePermissions('slip.manage')
export class SlipVerificationController {
  constructor(private readonly slipService: SlipVerificationService) {}

  /**
   * Legacy checks `mongoose.isValidObjectId` first and answers 400 with this
   * exact message. Nest's default would be a 500 from the cast error, which the
   * dashboard renders as an unknown failure.
   */
  private assertObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid ID format');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List slip verifications' })
  async list(
    @Query() query: ListSlipVerificationsQueryDto,
    // [FIX-20260818-SLIPSCOPE · plan §8] finance rows are per-hook data.
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<SlipListResult> {
    return this.slipService.list(query, auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one slip verification' })
  async getById(
    @Param('id') id: string,
  ): Promise<{ data: Record<string, unknown> }> {
    this.assertObjectId(id);
    return this.slipService.getById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a slip verification record' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SlipVerificationPayloadDto,
    @Req() req: Request,
  ): Promise<{ data: Record<string, unknown> }> {
    return this.slipService.create(
      dto,
      user,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a slip verification record' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SlipVerificationPayloadDto,
    @Req() req: Request,
  ): Promise<{ data: Record<string, unknown> }> {
    this.assertObjectId(id);
    return this.slipService.update(
      id,
      dto,
      user,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a slip verification record' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    this.assertObjectId(id);
    await this.slipService.remove(
      id,
      user,
      buildRequestMeta(req.headers, req.ip),
    );
  }
}
