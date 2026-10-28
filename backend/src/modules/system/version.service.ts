import { execFileSync } from 'node:child_process';

import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

export interface VersionInfo {
  commit: string;
  datetime: string;
}

/**
 * Reports the deployed commit, so an operator can tell which build is live.
 *
 * Ported from the legacy backend, which shells out to git. Kept as-is rather
 * than switched to a build-time constant: the response is part of the contract,
 * and changing how it is produced is a separate decision from moving it here.
 *
 * `execFileSync` instead of `execSync`: arguments are passed as a list, so there
 * is no shell to inject into even if an argument ever becomes dynamic.
 */
@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);

  getVersion(): VersionInfo {
    try {
      return {
        commit: this.git(['log', '-1', '--format=%H']),
        datetime: this.git(['log', '-1', '--format=%cI']),
      };
    } catch (error) {
      this.logger.error(`git read failed: ${(error as Error).message}`);
      // Same status and message as the legacy endpoint.
      throw new InternalServerErrorException('Failed to read git version');
    }
  }

  private git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
  }
}
