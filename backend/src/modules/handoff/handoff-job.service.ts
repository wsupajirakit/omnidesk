import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { escapeRegex } from '@/common/utils/escape-regex';

import type { ListJobsQueryDto } from './dto';
import { HandoffOaAccessService } from './handoff-oa-access.service';
import { TargetError } from './handoff-target.service';
import { HandoffJob } from './schemas/handoff-job.schema';
import { HandoffResult } from './schemas/handoff-result.schema';

/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/handoff/handoffJobController.js
 *
 * Read-only views over dispatched jobs. Dispatch, resend and cancel land with
 * the worker phase and are deliberately absent here, as in legacy.
 */

export interface ListJobsResult {
  data: Array<Record<string, unknown>>;
  pagination: { page: number; limit: number; total: number; pages: number };
}

@Injectable()
export class HandoffJobService {
  constructor(
    @InjectModel(HandoffJob.name)
    private readonly jobModel: Model<HandoffJob>,
    @InjectModel(HandoffResult.name)
    private readonly resultModel: Model<HandoffResult>,
    private readonly oaAccess: HandoffOaAccessService,
  ) {}

  /**
   * OA-scope clause for a list query, or `null` for super.
   *
   * A non-super caller never sees `hook_id: null` jobs: the `$in` cannot match
   * null, so unassigned jobs are superadmin-only. That is intentional in the
   * legacy design, not an accident of the query.
   */
  private async scopeClause(
    user?: AuthenticatedUser,
  ): Promise<Record<string, unknown> | null> {
    const allowed = await this.oaAccess.getAllowedHookIds(user);
    if (allowed === null) return null;
    return {
      hook_id: { $in: allowed.map((id) => new Types.ObjectId(id)) },
    };
  }

  /** Mirrors the legacy handler's outer catch — see the target service. */
  private async runOrWrapCastError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new TargetError(500, (error as Error).message);
    }
  }

  async list(
    query: ListJobsQueryDto,
    user?: AuthenticatedUser,
  ): Promise<ListJobsResult> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 200);
    const filters: Record<string, unknown> = {};

    if (query.status) filters['status'] = String(query.status);
    // Exact match, for programmatic callers.
    if (query.target_key) filters['target_key'] = String(query.target_key);
    /*
     * The free-text box searches the same field partially. Declared after the
     * exact filter so `search` wins when both are sent — matching legacy, where
     * the second assignment overwrites the first. Input is regex-escaped so a
     * user cannot inject operators.
     */
    if (query.search) {
      filters['target_key'] = {
        $regex: escapeRegex(String(query.search)),
        $options: 'i',
      };
    }
    if (query.subject_type) {
      filters['subject_type'] = String(query.subject_type);
    }
    if (query.subject_id && Types.ObjectId.isValid(query.subject_id)) {
      filters['subject_id'] = new Types.ObjectId(query.subject_id);
    }

    const scope = await this.scopeClause(user);
    if (scope) Object.assign(filters, scope);

    const [items, total] = await Promise.all([
      // The full result blob is never listed — jobs carry only `result_meta`.
      this.jobModel
        .find(filters)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<Array<Record<string, unknown>>>()
        .exec(),
      this.jobModel.countDocuments(filters).exec(),
    ]);

    return {
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getById(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    const job = await this.runOrWrapCastError(() =>
      this.jobModel.findById(id).lean<Record<string, unknown> | null>().exec(),
    );
    if (!job) throw new TargetError(404, 'job not found');

    // 403 when the job's OA is outside the caller's scope.
    await this.oaAccess.ensureHookAccess(
      user,
      job['hook_id'] as Types.ObjectId | null,
    );
    return { data: job };
  }

  /**
   * The full raw exchange for one job: what we sent and what came back.
   *
   * Gated by `handoff.view_raw` at the route — a stricter permission than the
   * rest of the module, because this is the only endpoint that returns the
   * unredacted request and response bodies.
   *
   * Opening it appends an audit row to `raw_views`, capped at 50 by `$slice`.
   * That write is best-effort and deliberately not awaited: an audit failure
   * must never turn a successful read into an error, and the read itself is
   * what the caller is waiting on.
   */
  async getResult(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    const job = await this.runOrWrapCastError(() =>
      this.jobModel
        .findById(id)
        .select('hook_id')
        .lean<{ hook_id?: Types.ObjectId | null } | null>()
        .exec(),
    );
    if (!job) throw new TargetError(404, 'job not found');
    await this.oaAccess.ensureHookAccess(user, job.hook_id);

    const result = await this.runOrWrapCastError(() =>
      this.resultModel
        .findById(id)
        .lean<Record<string, unknown> | null>()
        .exec(),
    );
    if (!result) throw new TargetError(404, 'no result recorded yet');

    void this.resultModel
      .updateOne(
        { _id: id },
        {
          $push: {
            raw_views: {
              $each: [
                {
                  user_id: String(user?.userId ?? ''),
                  username: String(user?.username ?? ''),
                  at: new Date(),
                },
              ],
              $slice: -50,
            },
          },
        },
      )
      .exec()
      .catch(() => undefined);

    return { data: result };
  }
}
