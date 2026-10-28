import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  buildDateFilter,
  isSuperUser,
  summarize,
  toObjectIds,
  type StatsRow,
} from './webhook-log.query';
import { WebhookLog } from './schemas/webhook-log.schema';

export interface StatsOptions {
  hook_id?: string;
  hook_alias?: string;
  groupIds: string[];
  roleName?: string | null;
  from?: string;
  to?: string;
}

/** Per-day success/failure counts behind `GET /stats`. */
@Injectable()
export class WebhookStatsService {
  constructor(
    @InjectModel(WebhookLog.name)
    private readonly logModel: Model<WebhookLog>,
  ) {}

  async getStatusCountsByType(
    options: StatsOptions,
  ): Promise<{ data: StatsRow[]; summary?: Omit<StatsRow, 'type' | 'date'> }> {
    const query: Record<string, unknown> = {};
    if (options.hook_id) {
      if (!Types.ObjectId.isValid(options.hook_id)) {
        throw new BadRequestException('Invalid hook_id');
      }
      query['hook_id'] = new Types.ObjectId(options.hook_id);
    }

    if (!isSuperUser(options.roleName)) {
      const groupObjectIds = toObjectIds(options.groupIds);
      // Unlike the log list, this early return carries no `summary` key at all
      // and its row has no `date`. Copied deliberately — the dashboard renders
      // whatever comes back.
      if (groupObjectIds.length === 0) {
        return {
          data: [{ type: 'webhooklog', count_success: 0, count_failed: 0 }],
        };
      }
      query['group_id'] = { $in: groupObjectIds };
    }

    if (options.hook_alias) query['hook_alias'] = options.hook_alias;
    const dateFilter = buildDateFilter(options.from, options.to);
    if (dateFilter) query['created_at'] = dateFilter;

    const byDate = await this.aggregateByDate(query);
    const data = Array.from(byDate.values());

    // With both bounds given, every day in the range is emitted — including
    // days that logged nothing — so the dashboard chart has no gaps.
    if (options.from && options.to) {
      const filled = this.fillDateRange(byDate, options.from, options.to);
      if (filled) return { data: filled, summary: summarize(filled) };
    }

    return { data, summary: summarize(data) };
  }

  /** Groups by (day, status) in UTC — the timezone legacy pinned. */
  private async aggregateByDate(
    query: Record<string, unknown>,
  ): Promise<Map<string, StatsRow>> {
    const results = await this.logModel
      .aggregate<{ _id: { date?: string; status?: string }; count: number }>([
        { $match: query },
        {
          $project: {
            status: 1,
            date_key: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$created_at',
                timezone: 'UTC',
              },
            },
          },
        },
        {
          $group: {
            _id: { date: '$date_key', status: '$status' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ])
      .exec();

    const byDate = new Map<string, StatsRow>();
    for (const item of results) {
      const date = item._id?.date;
      if (!date) continue;
      const row = byDate.get(date) ?? {
        type: 'webhooklog' as const,
        date,
        count_success: 0,
        count_failed: 0,
      };
      if (item._id?.status === 'success') row.count_success = item.count;
      else if (item._id?.status === 'error') row.count_failed = item.count;
      byDate.set(date, row);
    }
    return byDate;
  }

  /** `null` when either bound is unparsable, so the caller falls back. */
  private fillDateRange(
    byDate: Map<string, StatsRow>,
    from: string,
    to: string,
  ): StatsRow[] | null {
    const startDate = new Date(from);
    const endDate = new Date(to);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return null;
    }

    const rangeItems: StatsRow[] = [];
    const cursor = new Date(
      Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate(),
      ),
    );
    const end = new Date(
      Date.UTC(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth(),
        endDate.getUTCDate(),
      ),
    );

    while (cursor <= end) {
      const dateKey = cursor.toISOString().slice(0, 10);
      rangeItems.push(
        byDate.get(dateKey) ?? {
          type: 'webhooklog',
          date: dateKey,
          count_success: 0,
          count_failed: 0,
        },
      );
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return rangeItems;
  }
}
