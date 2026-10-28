import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import {
  WEBHOOK_LOG_TTL_DAYS,
  webhookLogTtlDrift,
  type IndexInfo,
} from './webhook-log-ttl';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { resolveLogDateRange } from '@/common/utils/date-range';
import { Hook } from '@/modules/hooks';

import type { WebhookLogPayloadDto } from './dto/webhook-log.dto';
import {
  WebhookLog,
  mirrorWebhookLogFields,
} from './schemas/webhook-log.schema';
import {
  isSuperUser,
  sanitizePagination,
  toObjectIds,
} from './webhook-log.query';
import { WebhookLogWriter } from './webhook-log.writer';

type LogRecord = Record<string, unknown>;

/**
 * [FEAT-20260828-LOGSEARCH] ต้องพิมพ์อย่างน้อยเท่านี้ถึงจะเริ่มค้น
 * ตัวเลขนโยบาย ไม่ใช่ตัวเลขที่วัดมา — สั้นกว่านี้แทบไม่กรองอะไร แต่ยังบังคับสแกนทั้งชุด
 */
export const MIN_SEARCH_CHARS = 4;

export interface ListLogsOptions {
  hook_id?: string;
  hook_alias?: string;
  groupIds: string[];
  roleName?: string | null;
  channel?: string;
  action_type?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
  sort?: string;
  meta_key?: string;
  meta_value?: string;
  /** [FEAT-20260828-LOGSEARCH] free text — ชื่อ OA หรือ id ของ job (ดูที่ตัวสร้าง query) */
  search?: string;
}

/**
 * Three pairs of names for the same field, mid-rename. Whichever side the
 * caller supplies is copied onto the other so readers of either name agree —
 * dropping this would make writes silently diverge from legacy while reads
 * still looked correct.
 */
@Injectable()
export class WebhookLogService implements OnModuleInit {
  private readonly logger = new Logger(WebhookLogService.name);

  constructor(
    @InjectModel(WebhookLog.name)
    private readonly logModel: Model<WebhookLog>,
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    /* [FEAT-20260827-WLOGONEDOOR] writes go through the door; `logModel` above
     * stays for the READ side (listLogs/updateLog/stats) and for the TTL index
     * check in onModuleInit. */
    private readonly writer: WebhookLogWriter,
  ) {}

  /**
   * [FEAT-20260821-WLOGTTLDRIFT] Read-only: compare the live TTL index with the
   * code's retention and WARN on drift. Never creates, drops or alters anything
   * (retention changes are a deliberate CLI step with a count); never throws
   * (a listIndexes hiccup must not stop the app). See webhook-log-ttl.ts.
   */
  async onModuleInit(): Promise<void> {
    try {
      const indexes = (await this.logModel.collection.indexes()) as IndexInfo[];
      const drift = webhookLogTtlDrift(indexes);
      if (drift) this.logger.warn(`[WLOGTTL] ${drift}`);
      else
        this.logger.log(
          `[WLOGTTL] webhook_logs retention = ${WEBHOOK_LOG_TTL_DAYS} days — database and code agree`,
        );
    } catch (e) {
      this.logger.warn(
        `[WLOGTTL] could not read webhook_logs indexes: ${(e as Error).message}`,
      );
    }
  }

  private normalizeObjectId(
    id: string | undefined,
    label = 'id',
  ): Types.ObjectId | undefined {
    if (!id) return undefined;
    if (Types.ObjectId.isValid(id)) {
      return new Types.ObjectId(id);
    }
    throw new BadRequestException(`Invalid ${label}`);
  }

  /**
   * Denormalize the parent hook's channel_type at write time, but only when the
   * caller did not supply one — callers holding the hook already pay no extra
   * query, and Hook.channel_type stays the single source of truth.
   */
  private async resolveChannelType(
    hookId: Types.ObjectId,
  ): Promise<string | undefined> {
    try {
      const hook = await this.hookModel
        .findById(hookId)
        .select('channel_type')
        .lean<{ channel_type?: string } | null>()
        .exec();
      return hook?.channel_type;
    } catch {
      // Legacy swallows this: a lookup failure must not fail the log write.
      return undefined;
    }
  }

  async createLog(payload: WebhookLogPayloadDto): Promise<LogRecord> {
    const normalized: Record<string, unknown> = { ...payload };
    const hookId = this.normalizeObjectId(payload.hook_id, 'hook_id');
    const groupId = this.normalizeObjectId(payload.group_id, 'group_id');
    normalized['hook_id'] = hookId;
    normalized['group_id'] = groupId;

    if (normalized['channel_type'] === undefined && hookId) {
      const channelType = await this.resolveChannelType(hookId);
      if (channelType) normalized['channel_type'] = channelType;
    }
    mirrorWebhookLogFields(normalized);

    // [FEAT-20260827-WLOGONEDOOR] was `this.logModel.create(normalized)`. The
    // row is unchanged — the door adds nothing — but it now passes the one
    // place a webhook_logs write can be observed from.
    const created = await this.writer.persist(normalized);
    return created.toObject() as unknown as LogRecord;
  }

  async listLogs(options: ListLogsOptions): Promise<{
    data: LogRecord[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      total_pages: number;
    };
  }> {
    const query: Record<string, unknown> = {};
    if (options.hook_id) {
      query['hook_id'] = this.normalizeObjectId(options.hook_id, 'hook_id');
    }

    if (!isSuperUser(options.roleName)) {
      const groupObjectIds = toObjectIds(options.groupIds);
      // No group means no visibility at all. Legacy returns an empty page with
      // `limit: 0` here — not the requested limit — and the dashboard renders
      // that verbatim, so the odd shape is preserved.
      if (groupObjectIds.length === 0) {
        return {
          data: [],
          pagination: { page: 1, limit: 0, total: 0, total_pages: 1 },
        };
      }
      // `null` is included so ungrouped logs stay visible, as in legacy.
      query['group_id'] = { $in: [...groupObjectIds, null] };
    }

    if (options.hook_alias) query['hook_alias'] = options.hook_alias;
    // Incoming param stays `channel` (FE contract); the read moved to log_source.
    if (options.channel) query['log_source'] = options.channel;
    if (options.action_type) query['action_type'] = options.action_type;
    if (options.status) query['status'] = options.status;

    // Search any field inside request_meta. The key is restricted to
    // [a-z0-9_] so Mongo operators (`$ne`) and dotted path traversal cannot
    // reach the query, and the value is compared as a plain string — no regex,
    // so no ReDoS and the index still applies.
    if (
      options.meta_key &&
      options.meta_value !== undefined &&
      options.meta_value !== ''
    ) {
      if (/^[a-z0-9_]{1,40}$/i.test(options.meta_key)) {
        query[`request_meta.${options.meta_key}`] = String(options.meta_value);
      }
    }

    /**
     * [FEAT-20260828-LOGSEARCH] ค้นด้วยชื่อ OA หรือ id ของ job
     *
     * เจ้าของ 28/08: *"ค้นหาด้วย hook name + job id ได้ (ต้องพิมพ์ 4 ตัวอักษรขึ้นไป)"*
     *
     * 🔴 ทำที่นี่ ไม่ใช่ที่หน้าจอ. รายการนี้แบ่งหน้าที่เซิร์ฟเวอร์ (`page`/`limit`)
     *    ⇒ การกรองฝั่ง FE จะค้นเจอแค่แถวของ "หน้าที่เปิดอยู่" · ผู้ใช้พิมพ์ชื่อที่มีจริง
     *    แล้วได้ผลว่าง ทั้งที่แถวนั้นอยู่หน้า 3 — ผิดแบบเงียบ ไม่มี error ให้เห็น
     *
     * 🔴 ขั้นต่ำ 4 ตัวอักษร และบังคับ **ทั้งสองฝั่ง**. สั้นกว่านั้นแทบไม่กรองอะไรเลย
     *    แต่ยังบังคับให้สแกนทั้ง collection · FE กันไว้ชั้นแรกเพื่อไม่ให้ยิงถี่ ๆ
     *    ส่วนชั้นนี้คือชั้นที่เชื่อถือได้จริง — ใครยิง API ตรงก็ยังโดนกฎเดียวกัน
     *
     * 🔴 หนีอักขระพิเศษก่อนสร้าง regex เสมอ. คำค้นมาจากผู้ใช้ — ปล่อยดิบ ๆ แล้ว
     *    `a(b` จะทำให้ Mongo โยน error ทั้งคำขอ ส่วน `(a+)+$` เปิดทาง ReDoS
     *    ⇒ escape ทุกตัวที่มีความหมายใน regex แล้วค้นแบบ "มีคำนี้อยู่ข้างใน" อย่างเดียว
     *
     * ⚠️ `$or` วางเป็น key ปกติได้เพราะไม่มีที่อื่นในเมธอดนี้ใช้ `$or` — ถ้าวันหน้ามีคน
     *    เพิ่มอีกที่ ต้องเปลี่ยนไปใช้ `$and` ห่อทั้งสองก้อน ไม่งั้นก้อนหลังจะทับก้อนแรก
     *    แล้วตัวกรองหนึ่งจะหายไปเงียบ ๆ
     * ⚠️ ค้นที่ `payload_summary.broadcast_id` เพราะนั่นคือที่ที่ id ของ job ถูกบันทึกจริง
     *    (ตัวเขียนคือ `payloadSummaryOf` ใน `new-send.helpers.ts`) — ไม่ใช่ `request_meta`
     */
    const needle = (options.search ?? '').trim();
    if (needle.length >= MIN_SEARCH_CHARS) {
      const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const like = { $regex: safe, $options: 'i' };
      /**
       * [FIX-20260828-LOGSEARCHID] ค้นด้วย id ของงานไม่เคยเจอเลย — และเงียบสนิท
       *
       * 🔴 `payload_summary.broadcast_id` เก็บเป็น **ObjectId ไม่ใช่สตริง**
       *    (วัดจริง 28/08: ทุกแถวของ `action_type: send_broadcast` เป็น objectId
       *    ทั้ง 61 แถว) · `$regex` ทำงานได้เฉพาะกับสตริง ⇒ เงื่อนไขนั้น **แมตช์
       *    ศูนย์แถวเสมอ** ไม่ว่าจะพิมพ์ id ถูกแค่ไหน และไม่มี error ให้เห็น
       *    ⚠️ ที่พลาดตอนเขียนครั้งแรก: เห็น log ที่ถูก serialize เป็น JSON แสดงค่าเป็น
       *       `"6a90..."` แล้วสรุปว่าเป็นสตริง — นั่นคือวิธีที่ JSON เรนเดอร์ ObjectId
       *       ออกมา ไม่ใช่ชนิดที่เก็บจริง · **ต้องเปิดแถวจริงดูชนิดเสมอ**
       *
       * 🔴 เทียบ ObjectId ตรงตัว ไม่ใช่แปลงทั้ง collection เป็นสตริง
       *    ทางเลือกที่ค้น id บางส่วนได้คือ `$expr` + `$toString` ซึ่ง **ใช้ index
       *    ไม่ได้เลย** ⇒ ทุกคำค้นจะกวาดทั้ง collection · หน้านี้แบ่งหน้าที่เซิร์ฟเวอร์
       *    และคนก๊อป id มาทั้งก้อนอยู่แล้ว ⇒ จ่ายราคานั้นไม่คุ้ม
       *
       * ⚠️ `new Types.ObjectId()` โยนเมื่อค่าไม่ใช่ hex24 ⇒ ต้องเช็ครูปก่อนเสมอ
       *    ไม่งั้นการพิมพ์ค้นตามปกติจะทำให้ทั้งคำขอ 500
       */
      const isHex24 = /^[0-9a-fA-F]{24}$/.test(needle);
      query['$or'] = [
        { hook_alias: like },
        ...(isHex24
          ? [{ 'payload_summary.broadcast_id': new Types.ObjectId(needle) }]
          : []),
      ];
    }

    /*
     * [FEAT-20260809-DATERANGE] Was `buildDateFilter(...)`, which parsed a bare date as UTC
     * and applied no ceiling. Switched to the shared policy so this page, the audit page and
     * the handoff-run page all mean the same thing by "a day" and by "too wide".
     *
     * WHAT CHANGED: `YYYY-MM-DD` is now a BANGKOK day (was UTC — "today" used to start at
     *   07:00 local and hide the early-morning rows), and a span over MAX_RANGE_DAYS is
     *   clamped to the most recent slice. ISO instants and unparsable values behave exactly
     *   as before, so callers sending full timestamps see no change at all.
     * NOTE: `buildDateFilter` is deliberately left in place — webhook-stats.service.ts:56
     *   still uses it. Stats aggregate over a chosen period and are not one of the three log
     *   listings this change covers, so capping them was out of scope. If stats should share
     *   the cap later, swap that call too and delete the helper.
     * revert: restore `buildDateFilter(options.from, options.to)` here — it is still
     *   imported and exported, so the rollback is this one line.
     */
    const dateRange = resolveLogDateRange(options.from, options.to);
    if (dateRange.filter) query['created_at'] = dateRange.filter;

    const { sanitizedLimit, sanitizedPage } = sanitizePagination(
      options.page,
      options.limit,
    );

    /**
     * [FIX-20260824-LOGSORTWL] The sort FIELD is whitelisted. It arrives raw from
     * the query string (`@Query('sort')`) and `sort` is not declared in the DTO,
     * so before this it reached `.sort()` unchecked — any field name at all.
     *
     * That is not a slowdown, it is an outage class. Sorting `webhook_logs` by a
     * field with no index makes Mongo materialise the whole filtered set for a
     * blocking SORT, and that stage ABORTS at 32MB rather than degrading. The
     * highest-write collection in the system is exactly the one where that set
     * is largest. Today only the 3-day date cap below keeps it from happening.
     *
     * The four allowed names are the ones an index can actually serve:
     *   created_at   — the TTL index, and the trailing key of the compounds
     *   status | log_source | action_type — each LEADS one of the compound
     *                  indexes declared on the schema, so it is a usable prefix
     * Anything else falls back to `created_at: -1`, which is also the default,
     * so an unrecognised value degrades to today's behaviour instead of failing.
     *
     * Nothing real changes: the dashboard sends `created_at:desc` and nothing
     * else — both call sites in `services/hook/webhookLogService.ts` hard-code
     * it. This only closes the hand-crafted-URL path.
     *
     * revert: delete SORTABLE_FIELDS and the `.includes` guard; the raw field
     *         goes straight through again.
     */
    const SORTABLE_FIELDS = [
      'created_at',
      'status',
      'log_source',
      'action_type',
    ] as const;

    const sortOrder: Record<string, 1 | -1> = (() => {
      if (!options.sort) return { created_at: -1 };
      const [field, direction] = options.sort.split(':');
      if (!field) return { created_at: -1 };
      if (!(SORTABLE_FIELDS as readonly string[]).includes(field)) {
        return { created_at: -1 };
      }
      return { [field]: direction === 'asc' ? 1 : -1 };
    })();

    const [data, total] = await Promise.all([
      this.logModel
        .find(query)
        /**
         * [PERF-20260816-LOGTICKETSLIM] The LIST leaves the four heavy fields
         * behind. Measured on the dev database before this change: 20 rows =
         * 65.7KB, of which these four are 83% — and neither list consumer
         * (`WebhookLogs.tsx`, `Broadcasts.tsx`) reads any of them. The detail
         * modal is unaffected: it fetches by id via `getLogById` below, which
         * stays a full read on purpose.
         *
         * EXCLUSION, not a whitelist. One included field would flip Mongo into
         * whitelist mode and every scalar not on the list — including any
         * added later — would silently vanish from the page. Excluding the
         * known heavies keeps every present and future scalar flowing.
         *
         * revert: delete this .select() line.
         */
        .select('-raw_request -raw_response -payload_summary -response_summary')
        .sort(sortOrder)
        .skip((sanitizedPage - 1) * sanitizedLimit)
        .limit(sanitizedLimit)
        .lean<LogRecord[]>()
        .exec(),
      this.logModel.countDocuments(query).exec(),
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

  private assertValidLogId(id: string): void {
    if (!id) {
      throw new BadRequestException('log ID is required');
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid log ID');
    }
  }

  async getLogById(id: string): Promise<LogRecord> {
    this.assertValidLogId(id);
    const log = await this.logModel
      .findById(id)
      .lean<LogRecord | null>()
      .exec();
    if (!log) {
      throw new NotFoundException('Webhook log not found');
    }
    return log;
  }

  async updateLog(
    id: string,
    updates: WebhookLogPayloadDto,
  ): Promise<LogRecord> {
    this.assertValidLogId(id);
    const normalized: Record<string, unknown> = { ...updates };
    if (updates.hook_id) {
      normalized['hook_id'] = this.normalizeObjectId(
        updates.hook_id,
        'hook_id',
      );
    }
    mirrorWebhookLogFields(normalized);

    const log = await this.logModel
      .findByIdAndUpdate(id, normalized, { new: true, runValidators: true })
      .lean<LogRecord | null>()
      .exec();
    if (!log) {
      throw new NotFoundException('Webhook log not found');
    }
    return log;
  }

  async deleteLog(id: string): Promise<LogRecord> {
    this.assertValidLogId(id);
    const deleted = await this.logModel
      .findByIdAndDelete(id)
      .lean<LogRecord | null>()
      .exec();
    if (!deleted) {
      throw new NotFoundException('Webhook log not found');
    }
    return deleted;
  }
}
