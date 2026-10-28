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
  MongooseErrorInterceptor,
  MongooseReadErrorInterceptor,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
import { CreateObjectCategoryDto, UpdateObjectCategoryDto } from './dto';
import { ObjectCategoriesService } from './object-categories.service';

@ApiTags('Content - Object Categories')
@Controller('api/object-categories')
export class ObjectCategoriesController {
  constructor(
    private readonly objectCategoriesService: ObjectCategoriesService,
  ) {}

  @Get()
  @RequirePermissions('object.manage')
  public async listCategories(
    // [FEAT-20260901-OBJSCOPE] The caller decides what this list contains.
    @CurrentUser() user: AuthenticatedUser,
    @Query('name') name?: string,
  ) {
    return this.objectCategoriesService.listCategories(name, user);
  }

  // Legacy's get catch is 500 (objectCategoryController.js:41-43) — the READ
  // interceptor, not the 400 one mounted on PUT below.
  @Get(':id')
  @UseInterceptors(MongooseReadErrorInterceptor)
  @RequirePermissions('object.manage')
  public async getCategoryById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    // [FEAT-20260901-OBJSCOPE] Out of scope answers 404, like a bad id.
    return this.objectCategoriesService.getCategoryById(id, user);
  }

  @Post()
  @RequirePermissions('object.manage')
  public async createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateObjectCategoryDto,
  ) {
    return this.objectCategoriesService.createCategory(user, dto);
  }

  // The one handler here legacy answers 400 from for a cast error — its catch
  // is `res.status(400).json({ error: error.message })`. Get/delete answer 500
  // for the same input on legacy, hence the READ variant on those two.
  @Put(':id')
  @RequirePermissions('object.manage')
  @UseInterceptors(MongooseErrorInterceptor)
  public async updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateObjectCategoryDto,
  ) {
    return this.objectCategoriesService.updateCategory(user, id, dto);
  }

  // Legacy's delete catch is 500 too (objectCategoryController.js:162-164).
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(MongooseReadErrorInterceptor)
  @RequirePermissions('object.manage')
  public async deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    // [FEAT-20260808-AUDITSITE] thread the actor for the delete audit row.
    await this.objectCategoriesService.deleteCategory(id, user);
  }
}
