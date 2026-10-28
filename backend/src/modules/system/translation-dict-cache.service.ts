import { createHash, randomBytes } from 'node:crypto';

import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import { Model } from 'mongoose';

import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { RedisService } from '@/infra/redis/redis.service';

import { TRANSLATION_SEED } from './dict-spec/translation-dict-seed';
import { TranslationDict } from './schemas/translation-dict.schema';

/**
 * LIFTED — pending rewrite. Source: legacy-api
 * `src/services/content/translationDictService.js` (346 lines).
 *
 * The in-process (L1) translation cache, ported faithfully because the three
 * read endpoints answer *from* it: `GET /api/translation-dict` returns
 * `exportDict()` plus `stats()`, so the cache's contents and its bookkeeping
 * are the response body, not an optimisation behind it.
 *
 * Safety ladder, unchanged from legacy: L1 Map → Redis → MongoDB → file seed.
 * Every layer may fail; the seed is terminal and cannot be removed. A lookup
 * never throws and never returns an empty string — LINE rejects a card whose
 * text is empty, so "no translation" must mean "keep the original value".
 *
 * Two legacy properties that are load-bearing and easy to lose:
 *
 * 1. `translate()` is SYNC. It sits on the customer-reply path and reads only
 *    the in-process Map; Redis and Mongo refill that Map in the background.
 *    Adding an `await` here would put I/O back on a path whose latency was
 *    deliberately cut.
 * 2. The Redis namespace is scoped by BOTH `WS_ENV` and a hash of the database
 *    name. Env alone is not enough — when WS_ENV is unset both prod and stag
 *    resolve to the same string and prod's words leak into stag. The database
 *    name always differs between them, so it disambiguates.
 *
 * What is NOT lifted: nothing from this module. `describe()` is included even
 * though no ported endpoint calls it yet, because it is three lines and its
 * absence would be a silent behaviour gap once the flex renderer lands.
 *
 * What would unblock splitting: the file is a single cohesive cache (key
 * construction, tier resolution, Redis wiring). Splitting it would separate the
 * key format from the code that reads it, which is the one thing legacy's
 * comments warn against most emphatically. It stays whole; the waiver names it.
 */

/** A resolved dictionary entry. `desc` is the long-form admin explanation. */
export interface DictEntry {
  th: string;
  en: string;
  desc: string;
}

/** An L1 row: an entry plus the identity columns it was stored under. */
interface DictRow extends DictEntry {
  dict: string;
  key: string;
  tool: string;
  scope: string;
  path: string;
  source: string;
}

/** What `exportDict` emits per key — a seed entry or a full DB row. */
export type ExportedEntry = DictEntry | DictRow;

export interface DictStats {
  size: number;
  loadedFromDb: boolean;
  ageMs: number;
  ns: string;
  instance: string;
}

/**
 * A raw value being looked up. Legacy passes whatever the upstream JSON held
 * and lowercases it, so numbers and booleans are legitimate keys ("0", "true");
 * objects are not, and typing them out here is what stops `[object Object]`
 * from silently becoming a cache key.
 */
export type DictKey = string | number | boolean | null | undefined;

/** Options accepted by `translate` — every field narrows the match. */
export interface TranslateOptions {
  tool?: string;
  scope?: string;
  path?: string;
  field?: 'th' | 'en' | 'desc';
}

const REDIS_TTL_SEC = 6 * 60 * 60;
export const L1_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * NUL separator. Legacy used `|` once and it broke: `|` occurs inside real
 * values (deposit_sort is a JSON string), so a key could not be parsed back.
 * ⚠️ Never split an L1 key — every field is duplicated inside the value.
 */
const SEP = '\u0000';

/** Collapse array indexes: `deposit[0].status` → `deposit[].status`. */
export const canonPath = (p: string | null | undefined): string =>
  String(p ?? '').replace(/\[[^\]]*\]/g, '[]');

@Injectable()
export class TranslationDictCacheService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TranslationDictCacheService.name);

  /** Distinguishes this process's own invalidate broadcasts from its peers'. */
  private readonly instanceId = randomBytes(6).toString('hex');

  /** L1 — DB rows only. The file seed is a separate terminal tier. */
  private l1 = new Map<string, DictRow>();
  private l1At = 0;
  private loadedFromDb = false;
  private loading: Promise<void> | null = null;

  /**
   * Short-circuits: if nothing overrides a dimension there is no point probing
   * it. With no overrides at all — today's state — `translate` is one Map.get.
   */
  private toolsWithOverride = new Set<string>();
  private hasScopeOverride = false;
  private hasPathOverride = false;

  /** Tier 9: the seed compiled from the file, keyed `dict \0 key`. */
  private readonly seed: ReadonlyMap<string, DictEntry>;

  private subscriber: Redis | null = null;

  constructor(
    @InjectModel(TranslationDict.name)
    private readonly dictModel: Model<TranslationDict>,
    private readonly redis: RedisService,
    @Inject(mongoConfig.KEY)
    private readonly mongo: ConfigType<typeof mongoConfig>,
    @Inject(realtimeConfig.KEY)
    private readonly realtime: ConfigType<typeof realtimeConfig>,
  ) {
    this.seed = this.buildSeedMap();
  }

  /** Compile the file seed once at construction — it never changes at runtime. */
  private buildSeedMap(): ReadonlyMap<string, DictEntry> {
    const m = new Map<string, DictEntry>();
    for (const [dict, entries] of Object.entries(TRANSLATION_SEED)) {
      for (const [key, v] of Object.entries(entries)) {
        m.set(`${dict}${SEP}${key.toLowerCase()}`, {
          th: v.th ?? '',
          en: v.en ?? '',
          desc: v.desc ?? '',
        });
      }
    }
    return m;
  }

  /**
   * Redis namespace: `transdict.<env>.<hash of db name>`.
   *
   * ⚠️ Both halves are required — see the class comment. Reproduced from legacy
   * translationDictService.js:56-65 including the 8-char sha256 prefix, because
   * a different namespace means a cold cache on deploy, not a wrong answer, but
   * a *colliding* one means cross-environment leakage.
   */
  private ns(): string {
    const env = String(this.realtime.wsEnv || 'na').replace(/[^\w-]/g, '');
    let db = 'nodb';
    try {
      const uri = String(this.mongo.uri || '');
      const name = (uri.split('/').pop() ?? '').split('?')[0];
      if (name) {
        db = createHash('sha256').update(name).digest('hex').slice(0, 8);
      }
    } catch {
      /* keep "nodb" */
    }
    return `transdict.${env}.${db}`;
  }

  private redisKey(): string {
    return `${this.ns()}:all`;
  }

  /** The pub/sub channel every instance listens on for invalidations. */
  invalidateChannel(): string {
    return `${this.ns()}:invalidate`;
  }

  private makeKey(
    tool: string,
    dict: string,
    scope: string,
    key: string,
    path: string,
  ): string {
    return `${tool || ''}${SEP}${dict}${SEP}${scope || ''}${SEP}${String(
      key,
    ).toLowerCase()}${SEP}${path || ''}`;
  }

  async onModuleInit(): Promise<void> {
    await this.reload();
    await this.ensureSubscriber();
  }

  /**
   * Read every row into an L1 map.
   *
   * ⚠️ DB rows ONLY — the seed is not merged in. Legacy did merge it once, and
   * the guard `if (!m.has(key))` was then always false for seeded pairs, so a
   * DB row could never claim the base layer: an admin's edit had no effect.
   */
  private async loadFromMongo(): Promise<Map<string, DictRow>> {
    const rows = await this.dictModel.find({}).lean().exec();
    const m = new Map<string, DictRow>();
    for (const r of rows) {
      const tool = r.custom_tool_id ? String(r.custom_tool_id) : '';
      const scope = r.scope ?? '';
      const path = r.path_canon ? canonPath(r.path_canon) : '';
      m.set(this.makeKey(tool, r.dict_name, scope, r.key, path), {
        th: r.value_th || '',
        en: r.value_en || '',
        desc: r.desc_th || '',
        dict: r.dict_name,
        key: String(r.key).toLowerCase(),
        tool,
        scope,
        path,
        source: r.source || 'seed',
      });
    }
    return m;
  }

  /** Install a new map and recompute the short-circuit flags together. */
  private applyMap(map: Map<string, DictRow>): void {
    this.l1 = map;
    this.l1At = Date.now();
    this.toolsWithOverride = new Set();
    this.hasScopeOverride = false;
    this.hasPathOverride = false;
    for (const v of map.values()) {
      if (v.tool) this.toolsWithOverride.add(v.tool);
      if (v.scope) this.hasScopeOverride = true;
      if (v.path) this.hasPathOverride = true;
    }
  }

  private serialize(map: Map<string, DictRow>): string {
    return JSON.stringify([...map.entries()]);
  }

  private deserialize(s: string): Map<string, DictRow> {
    return new Map(JSON.parse(s) as Array<[string, DictRow]>);
  }

  /**
   * Refill L1 from Redis, else Mongo. Never throws: on failure the previous L1
   * is kept, because serving slightly stale words beats serving none.
   */
  async reload({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        let map: Map<string, DictRow> | null = null;
        if (!force) {
          try {
            const cached = await this.redis.getClient().get(this.redisKey());
            if (cached) map = this.deserialize(cached);
          } catch {
            /* Redis down — fall through to Mongo */
          }
        }
        if (!map) {
          map = await this.loadFromMongo();
          try {
            await this.redis
              .getClient()
              .set(this.redisKey(), this.serialize(map), 'EX', REDIS_TTL_SEC);
          } catch {
            /* cache write failed — not fatal */
          }
        }
        this.applyMap(map);
        this.loadedFromDb = true;
        this.logger.log(
          `loaded ${this.l1.size} translations (ns=${this.ns()})`,
        );
      } catch (error) {
        this.logger.error(
          `load failed, keeping previous cache: ${(error as Error).message}`,
        );
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /**
   * Called after any write. Drops the shared copy, refills locally, then tells
   * every peer to do the same — TTL is only a safety net for a dropped message.
   */
  async invalidate(): Promise<void> {
    try {
      await this.redis.getClient().del(this.redisKey());
    } catch {
      /* ignore */
    }
    await this.reload({ force: true });
    await this.redis.publish(
      this.invalidateChannel(),
      JSON.stringify({ sender: this.instanceId }),
    );
  }

  /**
   * Subscribe to peer invalidations on a DEDICATED connection.
   *
   * ⚠️ ioredis puts a subscribed client into subscriber mode, where ordinary
   * commands are refused — sharing the main client would break every other
   * Redis user in the process. `duplicate()` is what legacy does too.
   */
  private async ensureSubscriber(): Promise<void> {
    if (this.subscriber) return;
    try {
      const sub = this.redis.getClient().duplicate();
      sub.on('error', (e: Error) =>
        this.logger.error(`subscriber error: ${e.message}`),
      );
      await sub.subscribe(this.invalidateChannel());
      sub.on('message', (_channel: string, message: string) => {
        try {
          const { sender } = JSON.parse(message) as { sender?: string };
          // Skip our own broadcast: we already reloaded before publishing.
          if (sender === this.instanceId) return;
          void this.reload({ force: true });
        } catch {
          /* a malformed message must not kill the subscriber */
        }
      });
      this.subscriber = sub;
      this.logger.log('subscriber ready (cross-instance invalidate)');
    } catch (error) {
      this.logger.error(
        `subscriber unavailable (TTL still covers us): ${(error as Error).message}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.subscriber) return;
    try {
      await this.subscriber.quit();
    } catch {
      this.subscriber.disconnect();
    }
    this.subscriber = null;
  }

  /**
   * SYNC lookup — no I/O, reads the Map only.
   *
   * Nine tiers, most specific first, weighted tool(4) > scope(2) > path(1).
   * ⚠️ tool outranks scope even though specificity argues the reverse. Chosen by
   * failure mode: if scope won, a site moved to another vendor would silently
   * get words written for the old one. With tool winning, a site-specific word
   * fails to apply on a forked tool — visible, complainable, fixable.
   *
   * @returns the translation, or null when unknown (caller keeps the raw value)
   */
  translate(
    dict: string,
    key: DictKey,
    opt: TranslateOptions = {},
  ): string | null {
    if (!dict || key === null || key === undefined) return null;
    const k = String(key).toLowerCase();
    const field = opt.field ?? 'th';
    const tool = opt.tool ? String(opt.tool) : '';
    const scope = opt.scope ? String(opt.scope) : '';
    const path = opt.path ? canonPath(opt.path) : '';

    let hit: DictEntry | undefined;
    if (tool && this.toolsWithOverride.has(tool)) {
      hit =
        (scope && path
          ? this.l1.get(this.makeKey(tool, dict, scope, k, path))
          : undefined) ??
        (scope
          ? this.l1.get(this.makeKey(tool, dict, scope, k, ''))
          : undefined) ??
        (path
          ? this.l1.get(this.makeKey(tool, dict, '', k, path))
          : undefined) ??
        this.l1.get(this.makeKey(tool, dict, '', k, ''));
    }
    if (!hit) {
      hit =
        (scope && this.hasScopeOverride && path && this.hasPathOverride
          ? this.l1.get(this.makeKey('', dict, scope, k, path))
          : undefined) ??
        (scope && this.hasScopeOverride
          ? this.l1.get(this.makeKey('', dict, scope, k, ''))
          : undefined) ??
        (path && this.hasPathOverride
          ? this.l1.get(this.makeKey('', dict, '', k, path))
          : undefined) ??
        this.l1.get(this.makeKey('', dict, '', k, ''));
    }
    // Tier 9 — file seed. Reached only when the DB genuinely lacks the key.
    if (!hit) hit = this.seed.get(`${dict}${SEP}${k}`);

    if (!hit) return null;
    const v = hit[field] || hit.th || '';
    // An empty translation counts as absent — an empty text bounces the card.
    return v === '' ? null : v;
  }

  /** Long description if there is one, else the short label. */
  describe(
    dict: string,
    key: DictKey,
    opt: TranslateOptions = {},
  ): string | null {
    return (
      this.translate(dict, key, { ...opt, field: 'desc' }) ??
      this.translate(dict, key, opt)
    );
  }

  /**
   * Whole-dictionary export for the FE panel.
   *
   * ⚠️ Here the seed is the BASE and DB rows overwrite it — the opposite of
   * `translate`'s ordering, and deliberately so: this ships a whole block rather
   * than resolving one word, so the broadest layer must be laid down first and
   * the narrowest applied last. Rows are sorted by specificity weight for
   * exactly that reason.
   *
   * ⚠️ Identity fields are read off the VALUE, never by splitting the key.
   * Legacy once did `k.split("|")` and unpacked 3 of 4 fields, losing `path`
   * silently.
   */
  exportDict(
    dictName: string | null = null,
    scope: string | null = null,
    tool: string | null = null,
  ): Record<string, Record<string, ExportedEntry>> {
    const out: Record<string, Record<string, ExportedEntry>> = {};
    const want = String(scope ?? '');
    const wantTool = String(tool ?? '');

    for (const [k, v] of this.seed.entries()) {
      const i = k.indexOf(SEP);
      const dict = k.slice(0, i);
      if (dictName && dict !== dictName) continue;
      (out[dict] ??= {})[k.slice(i + 1)] = v;
    }

    const rows = [...this.l1.values()]
      .filter((v) => !dictName || v.dict === dictName)
      .filter((v) => !v.scope || v.scope === want)
      .filter((v) => !v.tool || v.tool === wantTool)
      .sort(
        (a, b) =>
          (a.tool ? 4 : 0) +
          (a.scope ? 2 : 0) +
          (a.path ? 1 : 0) -
          ((b.tool ? 4 : 0) + (b.scope ? 2 : 0) + (b.path ? 1 : 0)),
      );
    for (const v of rows) (out[v.dict] ??= {})[v.key] = v;
    return out;
  }

  /** Cache bookkeeping — returned verbatim as the `meta` of the dict endpoint. */
  stats(): DictStats {
    return {
      size: this.l1.size,
      loadedFromDb: this.loadedFromDb,
      ageMs: Date.now() - this.l1At,
      ns: this.ns(),
      instance: this.instanceId,
    };
  }
}
