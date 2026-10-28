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
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common';
import {
  MongooseErrorInterceptor,
  MongooseReadErrorInterceptor,
} from '@/common/interceptors/mongoose-error.interceptor';

import { CreateRoleDto, UpdateRoleDto } from './dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller('api/roles')
@RequirePermissions('role.manage')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List roles' })
  async listRoles(
    @Query('active') active?: string,
    @Query('name') name?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const isActive =
      active !== undefined ? active === 'true' || active === '1' : undefined;
    return this.rolesService.listRoles(isActive, name);
  }

  // Legacy answers 500 + Mongoose's own text for a malformed id
  // (roleController.js:65) — the read interceptor preserves that status.
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(MongooseReadErrorInterceptor)
  @ApiOperation({ summary: 'Get role by ObjectId' })
  async getRoleById(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.rolesService.getRoleById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new role' })
  async createRole(
    @Body() dto: CreateRoleDto,
  ): Promise<Record<string, unknown>> {
    return this.rolesService.createRole(dto);
  }

  // Legacy's catch here is 400, not 500 (roleController.js:132).
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(MongooseErrorInterceptor)
  @ApiOperation({ summary: 'Update existing role' })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<Record<string, unknown>> {
    return this.rolesService.updateRole(id, dto);
  }

  // Legacy's catch here is 500 (roleController.js:150).
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(MongooseReadErrorInterceptor)
  @ApiOperation({ summary: 'Soft delete role' })
  async deleteRole(@Param('id') id: string): Promise<void> {
    await this.rolesService.deleteRole(id);
  }
}
