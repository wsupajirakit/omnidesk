import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InternalCacheService } from '@/modules/system/internal-cache.service';

/**
 * `GET /api/internal/cache` — the shape legacy answers, pinned against a real
 * directory tree.
 *
 * ── why this test exists ───────────────────────────────────────────────────
 * A cross-backend sweep reported this route as new=404 / legacy=200 and it read
 * like a missing handler. It is not. The handler is a faithful port of
 * legacy-api/src/controllers/system/internalCacheController.js; the 404 was
 * `{"error":"Path not found"}` raised by the handler itself, because the
 * service resolves `internal/` relative to its own repo root and that directory
 * exists in the legacy checkout but had never been created in this one.
 *
 * That makes the divergence environmental, not behavioural — so the honest test
 * is one that gives BOTH implementations the same tree and pins the response.
 * Driven against legacy's own `internal/`, this service already produced a
 * byte-identical body to legacy's live 200:
 *
 *   {"path":"","items":[{"name":"auto_reply","path":"auto_reply","type":"directory"},
 *    {"name":"hooks","path":"hooks","type":"directory"},
 *    {"name":"systemConfigCache.json","path":"systemConfigCache.json","type":"file"}]}
 *
 * A fixture tree is used here instead of that real path so the test is
 * hermetic and carries no absolute path from anyone's machine.
 */
describe('InternalCacheService — legacy response shape', () => {
  let root: string;
  let service: InternalCacheService;

  /** Only `INTERNAL_CACHE_DIR` is read, so a one-key stub is the whole config. */
  const configStub = (dir: string): ConfigService =>
    ({ get: () => dir }) as unknown as ConfigService;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'internal-cache-'));
    await fs.mkdir(join(root, 'hooks'), { recursive: true });
    await fs.writeFile(
      join(root, 'hooks', 'demo.json'),
      JSON.stringify({ line_key: 'FAKE' }),
    );
    // Not valid JSON on purpose — legacy falls back to the raw string.
    await fs.writeFile(join(root, 'notes.txt'), 'plain text');
    service = new InternalCacheService(configStub(root));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists a directory as {path, items[{name, path, type}]}', async () => {
    const res = await service.read('');

    expect(res.path).toBe('');
    const items = [...(res.items ?? [])].sort((a, b) =>
      String(a.name).localeCompare(String(b.name)),
    );
    expect(items).toEqual([
      { name: 'hooks', path: 'hooks', type: 'directory' },
      { name: 'notes.txt', path: 'notes.txt', type: 'file' },
    ]);
    // Legacy's listing carries no `content` — that is only the ?all=1 shape.
    expect(items.every((i) => i.content === undefined)).toBe(true);
  });

  it('parses a JSON file, and returns a non-JSON file as a raw string', async () => {
    expect((await service.read('hooks/demo.json')).content).toEqual({
      line_key: 'FAKE',
    });
    expect((await service.read('notes.txt')).content).toBe('plain text');
  });

  it('walks the whole tree with ?all=1, inlining file contents', async () => {
    const res = await service.readAll('');
    const paths = (res.items ?? []).map((i) => i.path).sort();

    expect(paths).toEqual(['hooks', 'hooks/demo.json', 'notes.txt']);
    // Directory rows carry no name/content in the all=1 shape, files carry content.
    const file = res.items?.find((i) => i.path === 'hooks/demo.json');
    expect(file).toEqual({
      path: 'hooks/demo.json',
      type: 'file',
      content: { line_key: 'FAKE' },
    });
  });

  it('404s a path that does not exist, matching legacy', async () => {
    await expect(service.read('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /**
   * The traversal guard is the reason this endpoint can be exposed at all:
   * `internal/` holds hook credential caches, so an escaping path reads
   * arbitrary host files. Legacy rejects with 400 "Invalid path".
   */
  it('rejects a traversal attempt with 400, never reading outside the root', async () => {
    await expect(service.read('../../etc/passwd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.read('hooks/../../..')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400s when ?all=1 targets a file rather than a directory', async () => {
    await expect(service.readAll('notes.txt')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
