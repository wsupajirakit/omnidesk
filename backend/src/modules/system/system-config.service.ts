import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { ConfigCacheInvalidator } from './config-cache-invalidator.service';
import type {
  CreateSystemConfigDto,
  UpdateSystemConfigDto,
} from './dto/system-config.dto';
import { SystemConfig } from './schemas/system-config.schema';

/** Keys the special-cased list query hides from the general listing. */
const SPECIAL_KEYS = [
  'EXTERNAL_API_BASE_URL',
  'EXTERNAL_API_PASSWORD',
  'EXTERNAL_API_USERNAME',
];

/**
 * Settings that change how the backend behaves, not how it is labelled. The
 * dashboard shows them read-only; enforcing it here means the rule cannot be
 * bypassed by calling the API directly.
 */
const PROTECTED_KEYS = new Set(['ai_sum_category']);

/** Paginated envelope shared by the list endpoint. */
export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export type ConfigRecord = Record<string, unknown>;

export interface ListConfigsQuery {
  page?: string;
  limit?: string;
  flag?: string;
  key_prefix?: string;
  type?: string;
}

@Injectable()
export class SystemConfigService {
  constructor(
    @InjectModel(SystemConfig.name)
    private readonly configModel: Model<SystemConfig>,
    // [FEAT-20260808-P3CFGINVAL] legacy funnels every write through
    // refreshConfigCache() → aiCategoryConfig.invalidate(); we fire the same
    // immediate invalidation so a flag toggle beats the 60s TTL.
    private readonly cacheInvalidator: ConfigCacheInvalidator,
  ) {}

  /**
   * Legacy clamps limit to 1..100 and page to >=1, coercing junk to the
   * defaults rather than erroring. Reproduced exactly: a dashboard that sends
   * `limit=0` still gets a page of 20 rather than an empty list.
   */
  private sanitizePagination(
    page?: string,
    limit?: string,
  ): { sanitizedPage: number; sanitizedLimit: number } {
    const parsedLimit = parseInt(String(limit ?? ''), 10);
    const parsedPage = parseInt(String(page ?? ''), 10);
    return {
      sanitizedLimit: Math.min(
        Math.max(Number.isNaN(parsedLimit) ? 20 : parsedLimit || 20, 1),
        100,
      ),
      sanitizedPage: Math.max(
        Number.isNaN(parsedPage) ? 1 : parsedPage || 1,
        1,
      ),
    };
  }

  /**
   * Legacy `ensureObjectId` throws a bare Error, which its controller turns
   * into a 400 with the message verbatim. The two messages differ by case
   * ("Config ID is required" vs "Invalid config ID") and the dashboard shows
   * them, so both are kept as-is.
   */
  private ensureObjectId(id: string): Types.ObjectId {
    if (!id) {
      throw new BadRequestException('Config ID is required');
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid config ID');
    }
    return new Types.ObjectId(id);
  }

  private async assertNotProtected(objectId: Types.ObjectId): Promise<void> {
    const existing = await this.configModel
      .findById(objectId)
      .select('key')
      .lean<{ key?: string } | null>()
      .exec();
    if (existing?.key && PROTECTED_KEYS.has(existing.key)) {
      throw new ForbiddenException(
        `config '${existing.key}' is read-only and cannot be changed through the API`,
      );
    }
  }

  async createConfig(dto: CreateSystemConfigDto): Promise<ConfigRecord> {
    if (!dto.key) {
      throw new BadRequestException('config key is required');
    }
    // `flag` defaults to 0 in legacy at the destructure, not in the schema.
    const created = await this.configModel.create({
      key: dto.key,
      value: dto.value,
      flag: dto.flag ?? 0,
      detail: dto.detail,
      path: dto.path,
      priority: dto.priority,
      require_jwt: dto.require_jwt,
      custom_method: dto.custom_method,
      custom_x_curl: dto.custom_x_curl,
      custom_condition: dto.custom_condition,
    });
    // [FEAT-20260808-P3CFGINVAL] legacy createConfig → refreshConfigCache().
    this.cacheInvalidator.fire();
    return created.toObject() as unknown as ConfigRecord;
  }

  async getConfigById(id: string): Promise<ConfigRecord | null> {
    const objectId = this.ensureObjectId(id);
    return this.configModel
      .findById(objectId)
      .lean<ConfigRecord | null>()
      .exec();
  }

  async getConfigByKey(key: string): Promise<ConfigRecord | null> {
    if (!key) {
      throw new BadRequestException('config key is required');
    }
    return this.configModel.findOne({ key }).lean<ConfigRecord | null>().exec();
  }

  /**
   * `type=config` narrows to flags 2 and 3 (the settings screen); anything else
   * lists everything except the three EXTERNAL_API_* keys, whose values are
   * credentials and are only ever read through the test endpoint.
   */
  async listConfigs(query: ListConfigsQuery): Promise<Paginated<ConfigRecord>> {
    const { sanitizedLimit, sanitizedPage } = this.sanitizePagination(
      query.page,
      query.limit,
    );
    const filter: Record<string, unknown> = {};

    if (query.flag !== undefined) {
      filter['flag'] = query.flag.includes(',')
        ? { $in: query.flag.split(',').map(Number) }
        : Number(query.flag);
    }

    if (query.type === 'config') {
      filter['flag'] = { $in: [2, 3] };
    } else if (query.key_prefix) {
      filter['key'] = {
        $regex: `^${query.key_prefix}`,
        $options: 'i',
        $nin: SPECIAL_KEYS,
      };
    } else {
      filter['key'] = { $nin: SPECIAL_KEYS };
    }

    const [data, total] = await Promise.all([
      this.configModel
        .find(filter)
        .sort({ key: 1 })
        .skip((sanitizedPage - 1) * sanitizedLimit)
        .limit(sanitizedLimit)
        .lean<ConfigRecord[]>()
        .exec(),
      this.configModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      pagination: {
        page: sanitizedPage,
        limit: sanitizedLimit,
        total,
        total_pages: Math.ceil(total / sanitizedLimit) || 1,
      },
    };
  }

  async updateConfigById(
    id: string,
    updates: UpdateSystemConfigDto,
  ): Promise<ConfigRecord> {
    const objectId = this.ensureObjectId(id);
    await this.assertNotProtected(objectId);

    // Explicit allowlist, mirroring legacy: only these paths are writable, and
    // an update naming none of them is an error rather than a silent no-op.
    const sanitized: Record<string, unknown> = {};
    const assign = (field: keyof UpdateSystemConfigDto): void => {
      if (updates[field] !== undefined) {
        sanitized[field] = updates[field];
      }
    };
    assign('value');
    assign('flag');
    assign('detail');
    assign('key');
    assign('path');
    assign('priority');
    assign('require_jwt');
    assign('custom_method');
    assign('custom_x_curl');
    assign('custom_condition');

    if (Object.keys(sanitized).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const config = await this.configModel
      .findByIdAndUpdate(
        objectId,
        { $set: sanitized },
        { new: true, runValidators: true },
      )
      .lean<ConfigRecord | null>()
      .exec();

    // Legacy throws a bare Error here, so this surfaces as 400 — not 404 —
    // even though the cause is a missing document.
    if (!config) {
      throw new BadRequestException('Config not found');
    }
    // [FEAT-20260808-P3CFGINVAL] legacy updateConfigById → refreshConfigCache().
    // Fired only after a successful write (matching legacy, which refreshes
    // after the save, not on the not-found throw).
    this.cacheInvalidator.fire();
    return config;
  }

  async deleteConfigById(id: string): Promise<ConfigRecord | null> {
    const objectId = this.ensureObjectId(id);
    await this.assertNotProtected(objectId);
    const deleted = await this.configModel
      .findByIdAndDelete(objectId)
      .lean<ConfigRecord | null>()
      .exec();
    // [FEAT-20260808-P3CFGINVAL] legacy deleteConfigById → refreshConfigCache()
    // (only when a doc was actually deleted, matching legacy's guard).
    if (deleted) this.cacheInvalidator.fire();
    return deleted;
  }

  /** Shared by the delete/get handlers, which 404 on a missing document. */
  assertFound<T>(value: T | null): T {
    if (!value) {
      throw new NotFoundException('Config not found');
    }
    return value;
  }
}
