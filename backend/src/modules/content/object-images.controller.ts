import {
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
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  MongooseReadErrorInterceptor,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
import { CreateObjectImageDto, UpdateObjectImageDto } from './dto';
import { ObjectImagesService } from './object-images.service';

@ApiTags('Content - Object Images')
@Controller('api/object-images')
export class ObjectImagesController {
  constructor(private readonly objectImagesService: ObjectImagesService) {}

  @Get()
  @RequirePermissions('object.manage')
  public async listImages(
    // [FEAT-20260901-OBJSCOPE] The caller decides what this list contains.
    @CurrentUser() user: AuthenticatedUser,
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('image_id') imageId?: string,
  ) {
    return this.objectImagesService.listImages(category, tag, imageId, user);
  }

  // Legacy answers 500 with Mongoose's CastError text for a malformed id
  // (objectImageController.js:137-139) — read interceptor, not the 400 one.
  @Get(':id')
  @UseInterceptors(MongooseReadErrorInterceptor)
  @RequirePermissions('object.manage')
  public async getImageById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    // [FEAT-20260901-OBJSCOPE] Out of scope answers 404, like a bad id.
    return this.objectImagesService.getImageById(id, user);
  }

  @Post()
  @RequirePermissions('object.manage')
  public async createImage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateObjectImageDto,
  ) {
    return this.objectImagesService.createImage(user, dto);
  }

  @Put(':id')
  @RequirePermissions('object.manage')
  public async updateImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateObjectImageDto,
  ) {
    return this.objectImagesService.updateImage(user, id, dto);
  }

  // Legacy's delete catch is 500 too (objectImageController.js:304-306).
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(MongooseReadErrorInterceptor)
  @RequirePermissions('object.manage')
  public async deleteImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    // [FEAT-20260808-AUDITSITE] thread the actor for the delete audit row.
    await this.objectImagesService.deleteImage(id, user);
  }
}
