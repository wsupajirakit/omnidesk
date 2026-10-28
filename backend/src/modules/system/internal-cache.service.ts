import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** One entry of a directory listing, or a file with its parsed contents. */
export interface InternalCacheEntry {
  name?: string;
  path: string;
  type: 'file' | 'directory';
  content?: unknown;
}

export interface InternalCacheResponse {
  path: string;
  items?: InternalCacheEntry[];
  content?: unknown;
}

/**
 * Reads the on-disk `internal/` cache directory.
 *
 * Ported from legacy-api/src/controllers/system/internalCacheController.js.
 *
 * This browses files over HTTP, which is only safe because of two things that
 * must both be preserved:
 *
 *  1. `system.manage` on the route. Legacy served this publicly until
 *     [SEC-C1 2026-08-02] removed it from the skip-auth list — the comment at
 *     apiRoutes.js:102 records that it was returning the contents of
 *     `internal/` to anyone. Do not weaken the guard.
 *  2. The traversal check below. `internal/` holds hook credential caches, so a
 *     path that escapes it reads arbitrary files off the host.
 *
 * Values are returned as stored, not masked: the legacy response is what the
 * operator tooling reads, and masking here would be a silent behaviour change
 * rather than a security fix (R5). Access control is the boundary.
 */
@Injectable()
export class InternalCacheService {
  /**
   * Where the cache directory lives.
   *
   * Defaults to this service's own `internal/`, resolved from the file's
   * location so it holds under `dist/` as well as `src/` and no absolute path
   * can reach a commit (R7).
   *
   * `INTERNAL_CACHE_DIR` overrides it, and that override is what makes parity
   * possible during the cutover: the legacy app writes this directory inside
   * its own checkout, so two services running side by side would otherwise
   * browse two different trees and disagree for a reason that says nothing
   * about the port. Point both at one path to compare them; leave it unset in
   * production, where this service owns its cache.
   */
  private readonly internalDir: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('INTERNAL_CACHE_DIR');
    this.internalDir = configured
      ? resolve(configured)
      : resolve(__dirname, '..', '..', '..', 'internal');
  }

  async read(requestedPath?: string): Promise<InternalCacheResponse> {
    const target = this.resolveInternalPath(requestedPath);
    if (!target) throw new BadRequestException('Invalid path');

    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new NotFoundException('Path not found');

    if (stat.isDirectory()) {
      return {
        path: requestedPath ?? '',
        items: await this.listDirectory(target, target),
      };
    }

    return { path: requestedPath ?? '', content: await this.readFile(target) };
  }

  /** `?all=1` walks the whole tree and inlines every file's content. */
  async readAll(requestedPath?: string): Promise<InternalCacheResponse> {
    const target = this.resolveInternalPath(requestedPath);
    if (!target) throw new BadRequestException('Invalid path');

    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new NotFoundException('Path not found');
    if (!stat.isDirectory()) {
      throw new BadRequestException('all=1 requires a directory path');
    }

    const items: InternalCacheEntry[] = [];
    await this.walkDirectory(target, target, items);
    return { path: requestedPath ?? '', items };
  }

  /**
   * Confines a caller-supplied path to `internal/`.
   *
   * Two checks, both from legacy: reject any `..` segment, then verify the
   * resolved path still starts inside the root. The second catches what the
   * first misses — a symlink, or an encoding that survives the literal check.
   */
  private resolveInternalPath(input?: string): string | null {
    const relativePath = String(input ?? '')
      .replace(/^\/+/, '')
      .replace(/\\/g, '/');
    if (relativePath.includes('..')) return null;

    const full = join(this.internalDir, relativePath);
    if (!full.startsWith(this.internalDir)) return null;
    return full;
  }

  private async listDirectory(
    dirPath: string,
    basePath: string,
  ): Promise<InternalCacheEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: relative(basePath, join(dirPath, entry.name)).replace(/\\/g, '/'),
      type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
    }));
  }

  private async walkDirectory(
    dirPath: string,
    basePath: string,
    results: InternalCacheEntry[],
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name);
      const relativePath = relative(basePath, entryPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        results.push({ path: relativePath, type: 'directory' });
        await this.walkDirectory(entryPath, basePath, results);
      } else {
        results.push({
          path: relativePath,
          type: 'file',
          content: await this.readFile(entryPath),
        });
      }
    }
  }

  /** JSON when it parses, the raw string otherwise — exactly as legacy does. */
  private async readFile(filePath: string): Promise<unknown> {
    const raw = await fs.readFile(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}
