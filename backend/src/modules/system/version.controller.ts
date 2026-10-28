import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@/common';

import { VersionService, type VersionInfo } from './version.service';

/**
 * Path is `/version`, not `/api/version`.
 *
 * Several legacy routes sit at the root rather than under `/api`, and the
 * dashboard has those paths compiled in. They stay exactly where they are until
 * the frontend moves to a generated client — a tidier URL is not worth a broken
 * screen during migration.
 */
@ApiTags('system')
@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  /** Public in the legacy backend (its skip-auth list names `/version`). */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Deployed commit and its timestamp' })
  getVersion(): VersionInfo {
    return this.versionService.getVersion();
  }
}
