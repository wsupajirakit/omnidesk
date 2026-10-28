import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { CustomTool } from '@/modules/hooks';

import type { UpsertTranslationDto } from './dto/translation-dict.dto';
import { TranslationDictCacheService } from './translation-dict-cache.service';
import {
  TranslationDictUsageService,
  type LabelSpot,
  type UsageMap,
  type UsageSpot,
} from './translation-dict-usage.service';
import { TranslationDict } from './schemas/translation-dict.schema';

type DictRecord = Record<string, unknown>;

/**
 * Dictionaries whose keys are FIELD NAMES rather than values.
 *
 * Two kinds of translation share this table and must not be confused:
 *   1. value labels (tx_status, bool, …) — matched by path, the *value* is
 *      translated, so positions belong to the dictionary as a whole;
 *   2. field labels (site_rules_label) — the key IS the field name, the *name*
 *      is translated, so positions belong to each individual key.
 */
const LABEL_DICTS = new Set(['site_rules_label']);

/**
 * The identity columns of a stored row, typed so the enrichment below can build
 * strings from them without falling back to `[object Object]`. Everything else
 * on the document passes through untouched via the index signature.
 */
interface LeanDictRow extends DictRecord {
  dict_name?: string;
  key?: string;
  scope?: string | null;
  path_canon?: string | null;
  custom_tool_id?: Types.ObjectId | string | null;
}

/** A row as the admin table consumes it: the record plus computed columns. */
export interface EnrichedDictRow extends DictRecord {
  translate_mode: 'label' | 'value';
  layer: 'tool' | 'web' | 'path' | 'base';
  custom_tool_name: string | null;
  // Label rows carry LabelSpot (no `kind`), value rows carry UsageSpot.
  used_at: UsageSpot[] | LabelSpot[];
  used_count: number;
}

/**
 * Collapse array indexes out of a path: `deposit[0].status` -> `deposit[].status`.
 *
 * Always applied server-side, never trusted from the client. If an indexed path
 * were stored, per-index editing would silently come back as a feature — the
 * exact behaviour that was deliberately removed.
 */
export const canonPath = (p: string | null | undefined): string =>
  String(p ?? '').replace(/\[[^\]]*\]/g, '[]');

@Injectable()
export class TranslationDictService {
  constructor(
    @InjectModel(TranslationDict.name)
    private readonly dictModel: Model<TranslationDict>,
    @InjectModel(CustomTool.name)
    private readonly customToolModel: Model<CustomTool>,
    private readonly cache: TranslationDictCacheService,
    private readonly usage: TranslationDictUsageService,
  ) {}

  /**
   * GET /api/translation-dict — the FE panel reads this.
   *
   * Served straight from L1, never from Mongo: it is faster, and it guarantees
   * the panel shows exactly the words the webhook path is using right now.
   */
  getTranslationDict(
    dict?: string,
    scope?: string,
  ): { data: Record<string, Record<string, unknown>>; meta: unknown } {
    return {
      data: this.cache.exportDict(dict ?? null, scope ?? null),
      meta: this.cache.stats(),
    };
  }

  /** GET /api/translation-dict/usage — which dictionary covers which paths. */
  getTranslationUsage(): { data: UsageMap } {
    return { data: this.usage.buildUsageMap() };
  }

  /**
   * GET /api/translation-dict/rows — the editable admin table (raw DB rows).
   *
   * `used_at` is computed per request from the format rules rather than stored,
   * so a rule change is reflected immediately with nothing to keep in sync.
   */
  async listTranslationRows(query: {
    page?: string;
    limit?: string;
    dict?: string;
    q?: string;
  }): Promise<{
    data: EnrichedDictRow[];
    meta: { total: number; page: number; limit: number };
    usage: UsageMap;
  }> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);

    const filters: Record<string, unknown> = {};
    if (query.dict) filters['dict_name'] = String(query.dict);
    if (query.q) {
      // Escape regex metacharacters — a search box must not be a regex console.
      const term = String(query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(term, 'i');
      filters['$or'] = [{ key: rx }, { value_th: rx }, { value_en: rx }];
    }

    const [rows, total] = await Promise.all([
      this.dictModel
        .find(filters)
        .sort({ dict_name: 1, key: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanDictRow[]>()
        .exec(),
      this.dictModel.countDocuments(filters).exec(),
    ]);

    const usageMap = this.usage.buildUsageMap();

    /* Attach the custom tool NAME, not just its id — an admin cannot read an
     * ObjectId. One query per request, then a map: never per row (N+1). */
    const toolIds = [
      ...new Set(
        rows
          .map((r) => r.custom_tool_id)
          .filter((v): v is Types.ObjectId | string => Boolean(v))
          .map((v) => String(v)),
      ),
    ];
    const toolName = new Map<string, string>();
    if (toolIds.length) {
      const tls = await this.customToolModel
        .find({ _id: { $in: toolIds } }, { name: 1 })
        .lean<Array<{ _id: Types.ObjectId; name: string }>>()
        .exec();
      tls.forEach((t) => toolName.set(String(t._id), t.name));
    }

    const enriched: EnrichedDictRow[] = rows.map((r) => {
      const dictName = r.dict_name ?? '';
      const mode = LABEL_DICTS.has(dictName) ? 'label' : 'value';
      const spots =
        mode === 'label'
          ? this.usage.labelSpots(r.key ?? '')
          : (usageMap[dictName] ?? []);
      const toolId = r.custom_tool_id;
      return {
        ...r,
        translate_mode: mode,
        layer: toolId
          ? 'tool'
          : r.scope
            ? 'web'
            : r.path_canon
              ? 'path'
              : 'base',
        // ⚠️ A deleted tool is named as orphaned rather than left blank, so the
        // admin is told why the row has no owner instead of guessing.
        custom_tool_name: toolId
          ? (toolName.get(String(toolId)) ?? '(tool ถูกลบแล้ว)')
          : null,
        used_at: spots,
        used_count: spots.length,
      };
    });

    // usage ships with the rows so the FE needs only one request.
    return { data: enriched, meta: { total, page, limit }, usage: usageMap };
  }

  /**
   * Names for the dropdown on the translation screen.
   *
   * Deliberately not served from `/api/custom-tools`: that route demands
   * `custom_tools.manage`, which whoever maintains translations has no reason
   * to hold. Only `_id` and `name` leave here — no endpoint, no credential.
   */
  async listDictTools(): Promise<{
    data: Array<{ _id: string; name: string }>;
  }> {
    const rows = await this.customToolModel
      .find({ deleted_at: null }, { name: 1 })
      .sort({ name: 1 })
      .lean<Array<{ _id: Types.ObjectId; name: string }>>()
      .exec();
    return {
      data: rows.map((r) => ({ _id: String(r._id), name: r.name })),
    };
  }

  /**
   * Add or edit one word.
   *
   * The filter must carry all five identity columns. Matching on only
   * `dict_name`/`key`/`scope` — as an earlier version did — matches several
   * rows at once where a dict has both a profile and per-shop entries, and
   * `findOneAndUpdate` then silently rewrites whichever row it happened to
   * find first.
   */
  async upsertTranslation(
    dto: UpsertTranslationDto,
    userId?: string,
  ): Promise<DictRecord> {
    if (!dto.dict_name || !dto.key) {
      throw new BadRequestException('ต้องมี dict_name และ key');
    }

    const identity = {
      dict_name: String(dto.dict_name).trim(),
      key: String(dto.key).trim(),
      custom_tool_id: dto.custom_tool_id ?? null,
      path_canon: dto.path_canon ? canonPath(dto.path_canon) : null,
      scope: dto.scope ?? null,
    };

    const row = await this.dictModel
      .findOneAndUpdate(
        identity,
        {
          $set: {
            value_th: dto.value_th ?? '',
            value_en: dto.value_en ?? '',
            desc_th: dto.desc_th ?? '',
            // Marks the row as human-edited so the next seed run leaves it be.
            source: 'admin',
            updated_by: userId ?? null,
          },
        },
        { upsert: true, new: true, runValidators: true },
      )
      .lean<DictRecord>()
      .exec();

    // ⚠️ Every write must invalidate, or other instances keep serving the old
    // word until the 6h TTL expires (legacy translationDictController.js:247).
    await this.cache.invalidate();
    return row;
  }

  /**
   * Remove a word an admin added.
   *
   * A row that also exists in the file seed reverts to its seeded value rather
   * than disappearing, which is why this is a hard delete and not a soft one.
   */
  async deleteTranslation(
    id: string,
  ): Promise<{ data: { deleted: boolean; id: string } }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid identifier');
    }
    const gone = await this.dictModel.findByIdAndDelete(id).lean().exec();
    if (!gone) {
      throw new NotFoundException('ไม่พบคำแปลนี้');
    }
    await this.cache.invalidate();
    return { data: { deleted: true, id } };
  }
}
