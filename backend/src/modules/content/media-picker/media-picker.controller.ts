import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
import {
  ListMediaAlbumsQueryDto,
  ListMediaItemsQueryDto,
} from './dto/media-picker.dto';
import { MediaPickerService } from './media-picker.service';

/**
 * [FEAT-20260905-MEDIAPICKER] Central Media Picker Controller
 *
 * Exposes scoped, paginated album & media asset queries for dashboard pickers
 * (Flex Messages, Broadcast, etc.) accessible to operators holding flex,
 * broadcast or object management permissions.
 */
@ApiTags('Content - Media Picker')
@Controller('api/media-picker')
export class MediaPickerController {
  constructor(private readonly mediaPickerService: MediaPickerService) {}

  @Get('albums')
  @RequirePermissions('flex.manage', 'broadcast.manage', 'object.manage')
  public async listAlbums(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListMediaAlbumsQueryDto,
  ) {
    return this.mediaPickerService.listAlbums(dto, user);
  }

  @Get('items')
  @RequirePermissions('flex.manage', 'broadcast.manage', 'object.manage')
  public async listMediaItems(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListMediaItemsQueryDto,
  ) {
    return this.mediaPickerService.listMediaItems(dto, user);
  }
}
