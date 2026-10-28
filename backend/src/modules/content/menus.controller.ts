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
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { MongooseErrorInterceptor, RequirePermissions } from '@/common';
import { CreateMenuDto, UpdateMenuDto } from './dto';
import { MenusService } from './menus.service';

@ApiTags('Content - Menus')
@Controller('api/menus')
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get()
  @RequirePermissions('menu.manage')
  public async listMenus() {
    return this.menusService.listMenus();
  }

  @Get(':id')
  @RequirePermissions('menu.manage')
  public async getMenuById(@Param('id') id: string) {
    return this.menusService.getMenuById(id);
  }

  // Legacy wraps both write handlers in `catch → 400 { error: error.message }`,
  // so a missing `label`/`path` (schema-required) and a malformed `:id` are
  // reported by Mongoose's own sentence. Read/delete deliberately keep no
  // interceptor: legacy answers 500 there for the same error.
  @Post()
  @RequirePermissions('menu.manage')
  @UseInterceptors(MongooseErrorInterceptor)
  public async createMenu(@Body() dto: CreateMenuDto) {
    return this.menusService.createMenu(dto);
  }

  @Put(':id')
  @RequirePermissions('menu.manage')
  @UseInterceptors(MongooseErrorInterceptor)
  public async updateMenu(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    return this.menusService.updateMenu(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('menu.manage')
  public async deleteMenu(@Param('id') id: string) {
    await this.menusService.deleteMenu(id);
  }
}
