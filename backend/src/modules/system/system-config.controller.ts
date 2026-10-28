import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type AuthenticatedUser } from '@/common';

import {
  CreateSystemConfigDto,
  TestCustomRequestDto,
  UpdateSystemConfigDto,
} from './dto';
import {
  ExternalProbeService,
  type ProbeResult,
} from './external-probe.service';
import {
  SystemConfigService,
  type ConfigRecord,
  type Paginated,
} from './system-config.service';

/**
 * Mounted at the root (`/config`, `/configs`), not under `/api`.
 *
 * The legacy routes sit there and the dashboard has the paths compiled in, so
 * they stay put until the frontend moves to a generated client.
 *
 * None of these routes carried an `authorize(...)` in legacy — the permission
 * check lives inside each handler and keys off `role_name` rather than a
 * permission, so it cannot be expressed with `@RequirePermissions`. The router
 * still required a valid token for all of them (`router.use(requireApiAuth)`),
 * which the global auth guard provides here.
 */
@ApiTags('system')
@Controller()
export class SystemConfigController {
  constructor(
    private readonly configService: SystemConfigService,
    private readonly probeService: ExternalProbeService,
  ) {}

  /**
   * superadmin/superuser, or anyone holding `config.manage` — the same gate as
   * the dashboard's SystemConfig page. Before this existed, any authenticated
   * user could read or edit a config by id, secret values included.
   */
  private ensureConfigAccess(user?: AuthenticatedUser): void {
    const roleName = user?.roleName;
    const perms = user?.permissions ?? [];
    if (
      roleName === 'superadmin' ||
      roleName === 'superuser' ||
      perms.includes('config.manage')
    ) {
      return;
    }
    throw new ForbiddenException('permission denied for system configurations');
  }

  /** The two test endpoints are stricter: role only, no `config.manage`. */
  private ensureSuperRole(user?: AuthenticatedUser): void {
    const roleName = user?.roleName;
    if (roleName !== 'superadmin' && roleName !== 'superuser') {
      throw new ForbiddenException('permission denied');
    }
  }

  @Post('config')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a system config' })
  async createConfig(
    @Body() dto: CreateSystemConfigDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    this.ensureConfigAccess(user);
    return { data: await this.configService.createConfig(dto) };
  }

  /**
   * `type=config` exposes the behavioural settings and is restricted to the
   * super roles; every other listing is readable by any authenticated caller,
   * which is what legacy did.
   */
  @Get('configs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List system configs' })
  async listConfigs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('flag') flag?: string,
    @Query('key_prefix') keyPrefix?: string,
    @Query('type') type?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Paginated<ConfigRecord>> {
    if (type === 'config') {
      this.ensureSuperRoleForList(user);
    }
    return this.configService.listConfigs({
      page,
      limit,
      flag,
      key_prefix: keyPrefix,
      type,
    });
  }

  /** The list endpoint uses the config-specific message, not the bare one. */
  private ensureSuperRoleForList(user?: AuthenticatedUser): void {
    const roleName = user?.roleName;
    if (roleName !== 'superadmin' && roleName !== 'superuser') {
      throw new ForbiddenException(
        'permission denied for system configurations',
      );
    }
  }

  /**
   * Declared before `config/:id` so Express does not match `:id` =
   * "test-external-api" and answer with an invalid-id error instead.
   */
  @Get('config/test-external-api')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probe the configured external API login' })
  async testExternalApi(
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ProbeResult> {
    this.ensureSuperRole(user);
    return this.probeService.testExternalApi();
  }

  @Post('config/test-custom')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send an operator-defined probe request' })
  async testCustomRequest(
    @Body() dto: TestCustomRequestDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ProbeResult> {
    this.ensureSuperRole(user);
    return this.probeService.testCustomRequest(dto);
  }

  @Get('config/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one system config' })
  async getConfig(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    this.ensureConfigAccess(user);
    const config = await this.configService.getConfigById(id);
    return { data: this.configService.assertFound(config) };
  }

  @Put('config/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a system config' })
  async updateConfig(
    @Param('id') id: string,
    @Body() dto: UpdateSystemConfigDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    this.ensureConfigAccess(user);
    return { data: await this.configService.updateConfigById(id, dto) };
  }

  @Delete('config/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a system config' })
  async deleteConfig(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    this.ensureConfigAccess(user);
    const deleted = await this.configService.deleteConfigById(id);
    return { data: this.configService.assertFound(deleted) };
  }
}
