/**
 * [FEAT-20260823-BCASTHISTREAD] The way back out of `broadcast_histories`.
 * ===========================================================================
 * Rows have been written on every run since 22/08 and NOTHING has ever read
 * them — there was no endpoint, so a run's own measurements reached no screen.
 * A counter nobody can read is the same as a counter nobody kept.
 *
 * Read-only by construction, exactly like `preview.service.ts`: one model, one
 * `find`. It holds no token and no dispatcher.
 *
 * ⚠️ SAME ACCESS RULE AS ITS SIBLINGS, deliberately. `getBroadcastById` is
 *    guarded by `broadcast.manage` and applies no per-OA narrowing, so history
 *    for a job the caller can already open adds no reach. Narrowing HERE alone
 *    would read as a security boundary that the neighbouring endpoint does not
 *    have — a false sense of one is worse than none. If per-OA scoping is
 *    wanted it belongs on both, as one decision.
 *    ถ้าจะกั้นราย OA ต้องกั้นทั้งคู่พร้อมกัน ไม่ใช่กั้นตรงนี้ที่เดียว.
 *
 * revert: delete this file, its provider line and the `@Get(':id/history')`.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { type Model } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { Hook, type HookDocument } from '@/modules/hooks';
/* [FEAT-20260824-RUNDETAIL] `SystemModule` registers this and `ContentModule`
   already imports it — a plain injection, no cycle. */
import { WebhookLog } from '@/modules/system';

import { ensureCanReadBroadcast } from '../content-oa-access.util';
import {
  HISTORY_READ_COLUMNS,
  historyOfJobQuery,
  toHistoryReadRow,
  type HistoryReadRow,
} from '../broadcast-history';
import { BroadcastHistory } from '../schemas/broadcast-history.schema';
import { Broadcast } from '../schemas/broadcast.schema';

export interface HistoryPage {
  readonly data: readonly HistoryReadRow[];
  readonly meta: { total: number; page: number; limit: number };
}

/** Same bounds as `listBroadcasts` — one page cannot be asked to be huge. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/**
 * [FEAT-20260824-RUNDETAIL] The webhook_log columns a run detail needs.
 *
 * A whitelist, not the whole row: these logs carry a `payload_summary` and a
 * `response_summary` that can be large, and a modal only needs to answer "which
 * endpoint, what did LINE say, when". เลือกคอลัมน์ ไม่ดึงทั้งแถว.
 */
const RUN_LOG_COLUMNS = {
  hook_id: 1,
  hook_alias: 1,
  action_type: 1,
  endpoint: 1,
  method: 1,
  status: 1,
  status_code: 1,
  error_message: 1,
  retries: 1,
  created_at: 1,
} as const;

/**
 * A bound on one modal's read.
 *
 * ⚠️ One run writes one log per OA today, so this is far above any real run —
 * it exists so a corrupted `run_id` shared by thousands of rows cannot pull the
 * whole collection into a modal. เพดานกันแถวเสีย ไม่ใช่กันงานปกติ.
 */
const RUN_LOG_LIMIT = 200;

/** One round: what the campaign decided, and what LINE answered. */
export interface RunDetail {
  readonly run_id: string;
  readonly rows: readonly HistoryReadRow[];
  readonly logs: readonly Record<string, unknown>[];
  /**
   * `true` when no log rows were found.
   *
   * 🔴 It is NOT the same as "nothing was sent". `webhook_logs` has a 45-day
   * TTL and history rows do not, so every round older than that has history and
   * no logs. A caller must say "logs expired", never "no traffic".
   * log หมดอายุ ≠ ไม่มีการส่ง.
   */
  readonly logsExpired: boolean;
  /** Present only when the log read itself failed. absent ≠ no error. */
  readonly logsError?: string;
}

@Injectable()
export class BroadcastHistoryReadService {
  constructor(
    @InjectModel(Broadcast.name)
    private readonly broadcastModel: Model<Record<string, unknown>>,
    @InjectModel(BroadcastHistory.name)
    private readonly historyModel: Model<Record<string, unknown>>,
    /* [FIX-20260823-BCASTOASCOPE] Needed only to resolve which OAs the caller
       may reach — the history rows themselves are read from `historyModel`. */
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    /**
     * [FEAT-20260824-RUNDETAIL] The LINE traffic of a run.
     *
     * `WebhookLog` is registered by `SystemModule` which `ContentModule`
     * already imports, so this is a plain injection — no connection lookup and
     * no cycle to dodge, unlike `Member`/`ChatRoom`.
     */
    @InjectModel(WebhookLog.name)
    private readonly webhookLogModel: Model<Record<string, unknown>>,
  ) {}

  async historyOf(
    id: string,
    query: { page?: string; limit?: string } = {},
    user?: AuthenticatedUser,
  ): Promise<HistoryPage> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid broadcast identifier');
    }

    /* 🔴 THE JOB IS CHECKED FIRST, and a missing one is a 404 rather than an
       empty page. "This job has never run" and "there is no such job" are
       different answers, and an empty list cannot tell them apart — the admin
       would wait for a run that can never happen.
       ไม่มีงาน กับ งานยังไม่เคยรัน คนละเรื่อง ต้องตอบต่างกัน. */
    const job = await this.broadcastModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .select({ _id: 1, hook_ids: 1 })
      .lean()
      .exec();
    if (!job) throw new NotFoundException('Broadcast not found');

    /* 🔴 SAME GATE AS THE JOB ITSELF. A run record says who a campaign
       reached and how it went — reading it about an OA the caller cannot see
       is the same disclosure as reading the campaign.
       ประวัติการส่ง = ข้อมูลของ OA นั้น ต้องกั้นเท่ากัน. */
    if (user) {
      await ensureCanReadBroadcast(user, job['hook_ids'], this.hookModel);
    }

    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(query.limit) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const { filter, sort } = historyOfJobQuery(new mongoose.Types.ObjectId(id));

    const [rows, total] = await Promise.all([
      this.historyModel
        .find(filter)
        .select(HISTORY_READ_COLUMNS)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.historyModel.countDocuments(filter).exec(),
    ]);

    return {
      data: (rows as unknown as Record<string, unknown>[]).map(
        toHistoryReadRow,
      ),
      meta: { total, page, limit },
    };
  }

  /**
   * [FEAT-20260824-RUNDETAIL] One round, with the LINE traffic beside it.
   *
   * Owner, 24/08: *"history ต้องจอย webhook log มาใช้ไหม ต้องแสดงทั้ง history +
   * webhook log จะได้ครบ แต่ว่าทำเป็น modal กดดู"*.
   *
   * 🔴 TWO READS, NOT A `$lookup`. The rows count different things: a history
   *    row is one (run × OA) and says what the CAMPAIGN decided; a webhook_log
   *    row is one HTTP request and says what LINE ANSWERED. Joining them in the
   *    database would invent a cardinality neither has, and would make "the run
   *    succeeded but two requests were retried" impossible to show.
   *    คนละหน่วยนับ ⇒ อ่านแยกแล้ววางคู่กัน ไม่ใช่ยุบรวม.
   *
   * 🔴 THE LINK IS `run_id`, VERIFIED on a real row — it lives at
   *    `webhook_logs.response_summary.run_id`, not at the top level.
   *
   * ⚠️ AN UNKNOWN RUN IS A 404, never an empty detail. An empty modal reads as
   *    "this round did nothing", which is a different and far worse claim than
   *    "no such round". รอบที่ไม่มีอยู่ ≠ รอบที่ไม่ได้ทำอะไร.
   */
  async runDetail(
    id: string,
    runId: string,
    user?: AuthenticatedUser,
  ): Promise<RunDetail> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid broadcast identifier');
    }
    const run = typeof runId === 'string' ? runId.trim() : '';
    if (run === '') throw new BadRequestException('Invalid run identifier');

    const job = await this.broadcastModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .select({ _id: 1, hook_ids: 1 })
      .lean()
      .exec();
    if (!job) throw new NotFoundException('Broadcast not found');
    /* Same gate as the job itself — a run record is that OA's data. */
    if (user) {
      await ensureCanReadBroadcast(user, job['hook_ids'], this.hookModel);
    }

    const rows = (await this.historyModel
      .find({ broadcast_id: new mongoose.Types.ObjectId(id), run_id: run })
      .select(HISTORY_READ_COLUMNS)
      .sort({ started_at: 1 })
      .lean()
      .exec()) as unknown as Record<string, unknown>[];
    if (rows.length === 0) throw new NotFoundException('Run not found');

    return {
      run_id: run,
      rows: rows.map(toHistoryReadRow),
      ...(await this.readRunLogs(run)),
    };
  }

  /**
   * The LINE traffic of one run.
   *
   * ⚠️ NEVER THROWS. A modal that cannot read the logs must still show the run —
   *    the history rows are the part an admin came for.
   *    ดึง log ไม่ได้ ต้องยังเห็นข้อมูลรอบนั้น.
   *
   * ⚠️ THIS IS A COLLECTION SCAN TODAY and the caller is told so. Measured on
   *    this database: 8,369 documents examined to return 1 (29ms), because
   *    `response_summary` is a `Mixed` field with no index. The fix, when it is
   *    worth paying for, is a PARTIAL index on `response_summary.run_id` —
   *    partial so ordinary webhook traffic never enters it and it stays
   *    proportional to broadcast sends. It is deliberately NOT created yet: an
   *    index nothing queries costs every insert and buys nothing.
   *    ยัง COLLSCAN — ใส่ index ตอนมีคนใช้จริง ไม่ใช่ใส่เผื่อ.
   *
   * ⚠️ `webhook_logs` EXPIRES AFTER 45 DAYS (`created_at_ttl45`); history rows do
   *    not. An older round has history and NO logs, so `logsExpired` exists to
   *    stop a caller rendering that as "nothing was sent".
   *    log หมดอายุ ≠ ไม่มีการส่ง.
   */
  private async readRunLogs(run: string): Promise<{
    logs: Record<string, unknown>[];
    logsExpired: boolean;
    logsError?: string;
  }> {
    try {
      const logs = (await this.webhookLogModel
        .find({ 'response_summary.run_id': run })
        .select(RUN_LOG_COLUMNS)
        .sort({ created_at: 1 })
        .limit(RUN_LOG_LIMIT)
        .lean()
        .exec()) as unknown as Record<string, unknown>[];
      return { logs, logsExpired: logs.length === 0 };
    } catch (e) {
      return {
        logs: [],
        logsExpired: false,
        logsError: e instanceof Error ? e.message : 'could not read the logs',
      };
    }
  }
}
