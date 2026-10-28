import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { ListTranslationRowsDto, UpsertTranslationDto } from './dto';
import { TranslationDictService } from './translation-dict.service';

/**
 * Translation dictionary maintenance.
 *
 * Unlike the other system routes these are under `/api` and do carry explicit
 * permissions in the legacy router — `translation_dict.manage` on every route
 * ported here.
 *
 * ⚠️ `GET /api/translation-dict` is the one route here that does NOT require
 * `translation_dict.manage`. Legacy guards it with `ticket.manage`
 * (apiRoutes.js:362) because the ticket-support panel reads it to render
 * customer data — support staff need the words, not the right to edit them.
 * Copying the sibling routes' permission here would lock that panel out.
 */
@ApiTags('system')
@Controller('api/translation-dict')
export class TranslationDictController {
  constructor(private readonly dictService: TranslationDictService) {}

  /**
   * Served from the in-memory cache, so `meta` reports that cache's state
   * (`size`, `ageMs`, `ns`, `instance`) — per-process values that legitimately
   * differ between two backends.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ticket.manage')
  @ApiOperation({ summary: 'Export the dictionary the render path is using' })
  getTranslationDict(
    @Query('dict') dict?: string,
    @Query('scope') scope?: string,
  ): { data: Record<string, Record<string, unknown>>; meta: unknown } {
    return this.dictService.getTranslationDict(dict, scope);
  }

  @Get('rows')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('translation_dict.manage')
  @ApiOperation({ summary: 'Editable dictionary rows for the admin table' })
  async listTranslationRows(
    @Query() query: ListTranslationRowsDto,
  ): Promise<unknown> {
    return this.dictService.listTranslationRows(query);
  }

  @Get('usage')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('translation_dict.manage')
  @ApiOperation({ summary: 'Which dictionary is applied at which path' })
  getTranslationUsage(): unknown {
    return this.dictService.getTranslationUsage();
  }

  @Get('tools')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('translation_dict.manage')
  @ApiOperation({ summary: 'Custom tool names for the dictionary dropdown' })
  async listDictTools(): Promise<{
    data: Array<{ _id: string; name: string }>;
  }> {
    return this.dictService.listDictTools();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('translation_dict.manage')
  @ApiOperation({ summary: 'Add or edit one translation' })
  async upsertTranslation(
    @Body() dto: UpsertTranslationDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    return {
      data: await this.dictService.upsertTranslation(dto, user?.userId),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('translation_dict.manage')
  @ApiOperation({ summary: 'Delete a translation an admin added' })
  async deleteTranslation(
    @Param('id') id: string,
  ): Promise<{ data: { deleted: boolean; id: string } }> {
    return this.dictService.deleteTranslation(id);
  }
}
