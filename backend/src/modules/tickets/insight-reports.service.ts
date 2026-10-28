import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types, isValidObjectId } from 'mongoose';

import { type AuthenticatedUser } from '@/common';
// [FEAT-20260808-QCACHE]
import { ScopedQueryCacheService } from '@/infra/query-cache';
import { User, type UserDocument } from '@/modules/admin';
import {
  AssignHistory,
  ChatMessage,
  ChatRoom,
  type AssignHistoryDocument,
  type ChatMessageDocument,
  type ChatRoomDocument,
} from '@/modules/chat';
import { Hook, getAllowedHookIds, type HookDocument } from '@/modules/hooks';
import { SystemConfigService } from '@/modules/system';

import type { TicketInsightsQueryDto } from './dto';
import { Ticket, type TicketDocument } from './schemas/ticket.schema';

/** Offset of the reporting timezone, matching legacy's `dayjs.tz("Asia/Bangkok")`. */
const BANGKOK_OFFSET_MS = 7 * 3600000;

/**
 * "Now", expressed as a Date whose UTC fields read as Bangkok wall-clock time.
 *
 * Calendar arithmetic (which day of the week is it, what is the first of the
 * month) must happen on the wall clock, never on the UTC instant. Midnight in
 * Bangkok is 17:00 UTC the *previous* day, so asking a UTC-based instant for its
 * day-of-week answers for yesterday — which shifted every week and month
 * boundary back by one day and made the report count the wrong tickets.
 */
function bangkokWallClock(): Date {
  return new Date(Date.now() + BANGKOK_OFFSET_MS);
}

/** Converts Bangkok wall-clock fields back to the real UTC instant. */
function toUtcInstant(wallClock: Date): Date {
  return new Date(wallClock.getTime() - BANGKOK_OFFSET_MS);
}

function getBangkokStartOfDay(): Date {
  const wall = bangkokWallClock();
  wall.setUTCHours(0, 0, 0, 0);
  return toUtcInstant(wall);
}

/** Monday-based, matching legacy's `startOf('isoWeek')`. */
function getBangkokStartOfWeek(): Date {
  const wall = bangkokWallClock();
  wall.setUTCHours(0, 0, 0, 0);
  const mondayBasedDay = (wall.getUTCDay() + 6) % 7;
  wall.setUTCDate(wall.getUTCDate() - mondayBasedDay);
  return toUtcInstant(wall);
}

function getBangkokStartOfMonth(): Date {
  const wall = bangkokWallClock();
  wall.setUTCHours(0, 0, 0, 0);
  wall.setUTCDate(1);
  return toUtcInstant(wall);
}

// [FEAT-20260820-REGINSIGHT] exported so insight-registrations counts share
// the exact same Bangkok wall-clock semantics — one date rule per page.
export function parseBangkokDate(
  dateStr?: string,
  timeStr?: string,
  isEnd = false,
): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length < 3) return null;
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  if (!year || !month || !day) return null;

  let hour = isEnd ? 23 : 0;
  let min = isEnd ? 59 : 0;
  let sec = isEnd ? 59 : 0;

  if (timeStr) {
    const tParts = timeStr.split(':').map(Number);
    hour = tParts[0] ?? hour;
    min = tParts[1] ?? min;
    sec = isEnd ? 59 : 0;
  }

  return new Date(Date.UTC(year, month - 1, day, hour - 7, min, sec));
}

function formatBangkokDateStr(): string {
  const d = new Date();
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const bkkMs = utcMs + 7 * 3600000;
  const bkkDate = new Date(bkkMs);
  const year = bkkDate.getUTCFullYear();
  const month = String(bkkDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bkkDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Injectable()
export class InsightReportsService {
  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(AssignHistory.name)
    private readonly assignHistoryModel: Model<AssignHistoryDocument>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    @InjectModel(ChatRoom.name)
    private readonly chatRoomModel: Model<ChatRoomDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    // [FEAT-20260808-QCACHE] shared scope-keyed read cache for the heavy insight
    // aggregation (P3 "insight Redis cache"). Opt-in: TTL=0 ⇒ live query, today's
    // behaviour. DB-EFFECT: no Mongo write/schema change; Redis read cache only.
    private readonly queryCache: ScopedQueryCacheService,
    // [FEAT-20260808-GROUPB-INSIGHTCAT] reads the acme_category flag that
    // gates the ai_handled by-category aggregation, same source legacy uses.
    private readonly systemConfig: SystemConfigService,
  ) {}

  /**
   * [FEAT-20260808-GROUPB-INSIGHTCAT] Mirror of legacy
   * `aiCategoryConfigService.isAiSumCategoryEnabled` (legacy-api
   * services/core-bot/aiCategoryConfigService.js:41): reads the single
   * `acme_category` system config and treats ONLY an explicit truthy flag
   * (`true` / `1` / the string "true") as enabled — absent, false, 0, "" and any
   * malformed value all mean OFF, so the safe default is not to run the scan.
   * A DB read error falls back to OFF, same as legacy. No TTL cache here: the
   * insight report is a low-frequency operator screen, and `getConfigByKey` is a
   * single indexed lookup — a per-request read is not the webhook hot path.
   */
  private async isAiSumCategoryEnabled(): Promise<boolean> {
    try {
      const doc = await this.systemConfig.getConfigByKey('acme_category');
      const v = doc?.['value'];
      return (
        v === true ||
        v === 1 ||
        (typeof v === 'string' && v.trim().toLowerCase() === 'true')
      );
    } catch {
      return false;
    }
  }

  private buildMatchFilters(
    reqQuery: TicketInsightsQueryDto,
    allowedHookIds: Types.ObjectId[] | null = null,
  ): Record<string, unknown> {
    const {
      from,
      to,
      start_time,
      end_time,
      category,
      line_oa_hook_id,
      admin_user_id,
    } = reqQuery;

    const match: Record<string, unknown> = {};

    if (from || to || start_time || end_time) {
      const dateMatch: Record<string, Date> = {};
      const gte = parseBangkokDate(from, start_time, false);
      if (gte) dateMatch['$gte'] = gte;

      const lte = parseBangkokDate(to, end_time, true);
      if (lte) dateMatch['$lte'] = lte;

      if (Object.keys(dateMatch).length > 0) {
        match['created_at'] = dateMatch;
      }
    }

    if (category) match['category'] = category;

    if (line_oa_hook_id && isValidObjectId(line_oa_hook_id)) {
      match['hook_id'] = new Types.ObjectId(line_oa_hook_id);
    } else if (Array.isArray(allowedHookIds)) {
      match['hook_id'] = { $in: allowedHookIds };
    }

    if (admin_user_id && isValidObjectId(admin_user_id)) {
      match['admin_user_id'] = new Types.ObjectId(admin_user_id);
    }

    return match;
  }

  private getMetricsStage(): mongoose.PipelineStage[] {
    return [
      {
        $lookup: {
          from: this.assignHistoryModel.collection.name,
          localField: '_id',
          foreignField: 'ticket_id',
          as: 'histories',
        },
      },
      {
        $addFields: {
          first_accept: {
            $min: {
              $map: {
                input: {
                  $filter: {
                    input: '$histories',
                    as: 'h',
                    cond: { $eq: ['$$h.action', 'accept'] },
                  },
                },
                as: 'h',
                in: '$$h.created_at',
              },
            },
          },
          close_time: {
            $max: {
              $map: {
                input: {
                  $filter: {
                    input: '$histories',
                    as: 'h',
                    cond: { $eq: ['$$h.action', 'close'] },
                  },
                },
                as: 'h',
                in: '$$h.created_at',
              },
            },
          },
          first_action: { $min: '$histories.created_at' },
          last_action: { $max: '$histories.created_at' },
        },
      },
      {
        $addFields: {
          first_response_time: {
            $cond: [
              { $ne: ['$first_accept', null] },
              {
                $divide: [
                  { $subtract: ['$first_accept', '$created_at'] },
                  1000,
                ],
              },
              null,
            ],
          },
          handling_time: {
            $cond: [
              { $ne: ['$close_time', null] },
              {
                $divide: [
                  {
                    $subtract: [
                      '$close_time',
                      { $ifNull: ['$first_accept', '$created_at'] },
                    ],
                  },
                  1000,
                ],
              },
              null,
            ],
          },
          total_resolution_time: {
            $cond: [
              { $ne: ['$last_action', null] },
              {
                $divide: [
                  {
                    $subtract: [
                      '$last_action',
                      { $ifNull: ['$first_action', '$created_at'] },
                    ],
                  },
                  1000,
                ],
              },
              null,
            ],
          },
        },
      },
    ];
  }

  private getSummaryGroup(): mongoose.PipelineStage[] {
    return [
      {
        $group: {
          _id: null,
          total_tickets: { $sum: 1 },
          avg_first_response_seconds: { $avg: '$first_response_time' },
          avg_handling_seconds: { $avg: '$handling_time' },
          avg_total_resolution_seconds: { $avg: '$total_resolution_time' },
        },
      },
      {
        $project: {
          _id: 0,
          total_tickets: 1,
          avg_first_response_seconds: {
            $ifNull: [{ $round: ['$avg_first_response_seconds', 0] }, 0],
          },
          avg_handling_seconds: {
            $ifNull: [{ $round: ['$avg_handling_seconds', 0] }, 0],
          },
          avg_total_resolution_seconds: {
            $ifNull: [{ $round: ['$avg_total_resolution_seconds', 0] }, 0],
          },
        },
      },
    ];
  }

  public async getTicketInsights(
    queryDto: TicketInsightsQueryDto,
    auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const allowedHookIds = await getAllowedHookIds(auth, this.hookModel);
    const { line_oa_hook_id } = queryDto;

    if (
      line_oa_hook_id &&
      isValidObjectId(line_oa_hook_id) &&
      allowedHookIds !== null &&
      !allowedHookIds.includes(String(line_oa_hook_id))
    ) {
      throw new ForbiddenException('insufficient OA access');
    }

    const scopeHookIds =
      allowedHookIds === null
        ? null
        : allowedHookIds.map((id) => new Types.ObjectId(id));

    if (scopeHookIds && scopeHookIds.length === 0) {
      return { success: true, data: null, scope: 'no_oa_access' };
    }

    // [FEAT-20260808-QCACHE] The ACL work above (cross-OA Forbidden, no-access
    // short-circuit) runs LIVE every request and is NEVER cached. Only the heavy
    // aggregation below is cached, keyed by (query params + this caller's
    // allowed-hook scope). Same filters + same scope → one aggregation shared
    // across admins, refreshed per TTL. A cache HIT is byte-identical to the live
    // result for that scope+params; the sole deviation is staleness ≤ TTL.
    // TTL=0 ⇒ the producer runs live, nothing cached (identical to today).
    return this.queryCache.wrap(
      {
        endpoint: 'insight',
        scope: allowedHookIds,
        params: { ...queryDto },
      },
      () => this.computeTicketInsights(queryDto, scopeHookIds),
    );
  }

  /**
   * [FEAT-20260808-QCACHE] The heavy aggregation half of getTicketInsights,
   * extracted verbatim so ScopedQueryCacheService can wrap it. Pure read: it
   * only READs Mongo and returns plain JSON — no writes, no schema change.
   * `scopeHookIds` is the already-resolved, already-authorised OA scope.
   */
  private async computeTicketInsights(
    queryDto: TicketInsightsQueryDto,
    scopeHookIds: Types.ObjectId[] | null,
  ): Promise<Record<string, unknown>> {
    const { line_oa_hook_id } = queryDto;
    const customMatch = this.buildMatchFilters(queryDto, scopeHookIds);

    const todayStart = getBangkokStartOfDay();
    const weekStart = getBangkokStartOfWeek();
    const monthStart = getBangkokStartOfMonth();

    const baseMetrics = this.getMetricsStage();

    const facetPipeline: mongoose.PipelineStage[] = [
      { $match: customMatch },
      ...baseMetrics,
      {
        $facet: {
          summary: this.getSummaryGroup(),
          category_distribution: [
            {
              $group: {
                _id: { $ifNull: ['$category', 'Other'] },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                category: '$_id',
                count: 1,
              },
            },
            { $sort: { count: -1 } },
          ],
          oa_distribution: [
            {
              $lookup: {
                from: this.hookModel.collection.name,
                localField: 'hook_id',
                foreignField: '_id',
                as: 'line_oa',
              },
            },
            { $unwind: { path: '$line_oa', preserveNullAndEmptyArrays: true } },
            {
              $group: {
                _id: {
                  $ifNull: [
                    '$line_oa.display_name',
                    { $ifNull: ['$line_oa.line_oa_name', 'Unknown'] },
                  ],
                },
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                line_oa_name: '$_id',
                count: 1,
              },
            },
            { $sort: { count: -1 } },
          ],
        },
      } as mongoose.PipelineStage,
    ];

    const [customResults] = (await this.ticketModel.aggregate(
      facetPipeline,
    )) as unknown as {
      summary: Record<string, unknown>[];
      category_distribution: Record<string, unknown>[];
      oa_distribution: Record<string, unknown>[];
    }[];

    const presetsBaseMatch: Record<string, unknown> = {
      created_at: { $gte: monthStart },
    };
    if (line_oa_hook_id && isValidObjectId(line_oa_hook_id)) {
      presetsBaseMatch['hook_id'] = new Types.ObjectId(line_oa_hook_id);
    } else if (scopeHookIds) {
      presetsBaseMatch['hook_id'] = { $in: scopeHookIds };
    }

    const presetsPipeline: mongoose.PipelineStage[] = [
      { $match: presetsBaseMatch },
      ...baseMetrics,
      {
        $facet: {
          today: [
            { $match: { created_at: { $gte: todayStart } } },
            ...this.getSummaryGroup(),
          ],
          this_week: [
            { $match: { created_at: { $gte: weekStart } } },
            ...this.getSummaryGroup(),
          ],
          this_month: [...this.getSummaryGroup()],
        },
      } as mongoose.PipelineStage,
    ];

    const [presetsResults] = (await this.ticketModel.aggregate(
      presetsPipeline,
    )) as unknown as {
      today: Record<string, unknown>[];
      this_week: Record<string, unknown>[];
      this_month: Record<string, unknown>[];
    }[];

    const matchingTickets = await this.ticketModel
      .find(customMatch)
      .select('_id created_at')
      .lean();
    const matchingTicketIds = matchingTickets.map((t) => t._id);

    let agentLeaderboard: unknown[] = [];
    if (matchingTicketIds.length > 0) {
      agentLeaderboard = await this.assignHistoryModel.aggregate([
        { $match: { ticket_id: { $in: matchingTicketIds } } },
        {
          $lookup: {
            from: this.ticketModel.collection.name,
            localField: 'ticket_id',
            foreignField: '_id',
            as: 'ticket',
          },
        },
        { $unwind: '$ticket' },
        {
          $group: {
            _id: {
              admin_id: '$assign_to',
              ticket_id: '$ticket_id',
            },
            ticket_created_at: { $first: '$ticket.created_at' },
            actions: { $push: '$action' },
            first_accept: {
              $min: {
                $cond: [{ $eq: ['$action', 'accept'] }, '$created_at', null],
              },
            },
            last_close: {
              $max: {
                $cond: [{ $eq: ['$action', 'close'] }, '$created_at', null],
              },
            },
          },
        },
        {
          $group: {
            _id: '$_id.admin_id',
            assigned_count: {
              $sum: { $cond: [{ $in: ['assign', '$actions'] }, 1, 0] },
            },
            accepted_count: {
              $sum: { $cond: [{ $in: ['accept', '$actions'] }, 1, 0] },
            },
            closed_count: {
              $sum: { $cond: [{ $in: ['close', '$actions'] }, 1, 0] },
            },
            transfer_count: {
              $sum: { $cond: [{ $in: ['edit', '$actions'] }, 1, 0] },
            },
            auto_unassist_count: {
              $sum: { $cond: [{ $in: ['auto_unassist', '$actions'] }, 1, 0] },
            },
            // [FEAT-20260817-REOPENBYADMIN] reopens counted apart from accepts
            // — without this branch the new action would score ZERO silently.
            reopen_by_admin_count: {
              $sum: {
                $cond: [{ $in: ['reopen_by_admin', '$actions'] }, 1, 0],
              },
            },
            total_handling_seconds: {
              $sum: {
                $cond: [
                  { $ne: ['$last_close', null] },
                  {
                    $divide: [
                      {
                        $subtract: [
                          '$last_close',
                          { $ifNull: ['$first_accept', '$ticket_created_at'] },
                        ],
                      },
                      1000,
                    ],
                  },
                  0,
                ],
              },
            },
            handled_tickets_count: {
              $sum: { $cond: [{ $ne: ['$last_close', null] }, 1, 0] },
            },
          },
        },
        {
          $lookup: {
            from: this.userModel.collection.name,
            localField: '_id',
            foreignField: '_id',
            as: 'admin',
          },
        },
        { $unwind: { path: '$admin', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            display_name: {
              $ifNull: ['$admin.display_name', '$admin.username', 'Unknown'],
            },
            assigned_count: 1,
            accepted_count: 1,
            closed_count: 1,
            transfer_count: 1,
            auto_unassist_count: 1,
            reopen_by_admin_count: 1,
            avg_handling_seconds: {
              $cond: [
                { $gt: ['$handled_tickets_count', 0] },
                {
                  $round: [
                    {
                      $divide: [
                        '$total_handling_seconds',
                        '$handled_tickets_count',
                      ],
                    },
                    0,
                  ],
                },
                0,
              ],
            },
          },
        },
        {
          $match: {
            $or: [
              { assigned_count: { $gt: 0 } },
              { accepted_count: { $gt: 0 } },
              { closed_count: { $gt: 0 } },
              { transfer_count: { $gt: 0 } },
              { auto_unassist_count: { $gt: 0 } },
              { reopen_by_admin_count: { $gt: 0 } },
            ],
          },
        },
        { $sort: { accepted_count: -1, closed_count: -1 } },
      ]);
    }

    const hookObjId =
      line_oa_hook_id && isValidObjectId(line_oa_hook_id)
        ? new Types.ObjectId(line_oa_hook_id)
        : null;

    const todayEnd = new Date(todayStart.getTime() + 24 * 3600000 - 1);

    const roomMatch: Record<string, unknown> = {
      sender_type: 'customer',
      created_at: { $gte: todayStart, $lte: todayEnd },
    };
    if (hookObjId) {
      roomMatch['hook_id'] = hookObjId;
    } else if (scopeHookIds) {
      roomMatch['hook_id'] = { $in: scopeHookIds };
    }

    const roomPipeline: mongoose.PipelineStage[] = [
      { $match: roomMatch },
      { $group: { _id: '$room_id' } },
      {
        $lookup: {
          from: this.chatRoomModel.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'room',
        },
      },
      { $unwind: '$room' },
      { $project: { _id: 0, room_id: '$_id', user_id: '$room.user_id' } },
    ];
    const roomDocs = await this.chatMessageModel.aggregate(roomPipeline);
    const total_messaged = roomDocs.length;

    const userIds = roomDocs.map((r) => r.user_id).filter(Boolean);

    const todayTickets =
      userIds.length === 0
        ? []
        : await this.ticketModel
            .find(
              {
                created_at: { $gte: todayStart, $lte: todayEnd },
                chat_user_id: { $in: userIds },
                ...(hookObjId
                  ? { hook_id: hookObjId }
                  : scopeHookIds
                    ? { hook_id: { $in: scopeHookIds } }
                    : {}),
              },
              { chat_user_id: 1, category: 1 },
            )
            .lean();

    const ticketUserMap: Record<string, Record<string, unknown>> = {};
    todayTickets.forEach((t) => {
      const uid = (t.chat_user_id as Types.ObjectId | undefined)?.toString();
      if (uid && !ticketUserMap[uid]) {
        ticketUserMap[uid] = t as unknown as Record<string, unknown>;
      }
    });

    const roomsWithAssist = new Set<string>();
    const roomsWithoutAssist: Types.ObjectId[] = [];
    roomDocs.forEach((r) => {
      const uid = r.user_id?.toString();
      if (uid && ticketUserMap[uid]) roomsWithAssist.add(r.room_id.toString());
      else roomsWithoutAssist.push(r.room_id);
    });

    // [FEAT-20260808-GROUPB-INSIGHTCAT] Restore the ai_handled by-category
    // breakdown (legacy insightReportController.js:459-479). Two-stage group —
    // first distinct (room_id, category) so a room with many bot messages of the
    // same category counts once, then count categories — matching legacy exactly.
    // Gated by the SAME acme_category flag legacy reads
    // (aiCategoryConfig.isAiSumCategoryEnabled): with categorisation OFF nothing
    // writes ChatMessage.category, so the pipeline can only return an empty set —
    // skip the scan rather than pay for it on every report (legacy comment 472-474).
    // FE EFFECT: the insight report's ai_handled block now shows a real
    // per-category breakdown instead of an empty array. DB-EFFECT: read-only
    // aggregation — no write, no schema change.
    const aiCategoryEnabled = await this.isAiSumCategoryEnabled();
    const aiHandledByCategory = aiCategoryEnabled
      ? await this.chatMessageModel.aggregate([
          {
            $match: {
              room_id: { $in: roomsWithoutAssist },
              sender_type: 'bot',
              created_at: { $gte: todayStart, $lte: todayEnd },
              category: { $ne: null },
            },
          },
          { $group: { _id: { room_id: '$room_id', category: '$category' } } },
          { $group: { _id: '$_id.category', count: { $sum: 1 } } },
          { $project: { _id: 0, category: '$_id', count: 1 } },
          { $sort: { count: -1 } },
        ])
      : [];

    const botRepliedRooms = await this.chatMessageModel.distinct('room_id', {
      room_id: { $in: roomsWithoutAssist },
      sender_type: 'bot',
      created_at: { $gte: todayStart, $lte: todayEnd },
    });

    const adminByCategory: Record<string, number> = {};
    Object.values(ticketUserMap).forEach((t) => {
      const cat = (t['category'] as string) || 'Other';
      adminByCategory[cat] = (adminByCategory[cat] || 0) + 1;
    });
    const adminByCategoryArr = Object.entries(adminByCategory)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const defaultSummary = {
      total_tickets: 0,
      avg_first_response_seconds: 0,
      avg_handling_seconds: 0,
      avg_total_resolution_seconds: 0,
    };

    const hasCustomFilters = Object.keys(customMatch).length > 0;

    return {
      success: true,
      data: {
        presets: {
          custom_filter: hasCustomFilters
            ? customResults?.summary?.[0] || defaultSummary
            : defaultSummary,
          today: presetsResults?.today?.[0] || defaultSummary,
          this_week: presetsResults?.this_week?.[0] || defaultSummary,
          this_month: presetsResults?.this_month?.[0] || defaultSummary,
        },
        category_distribution: customResults?.category_distribution || [],
        oa_distribution: customResults?.oa_distribution || [],
        agent_leaderboard: agentLeaderboard || [],
        daily_summary: {
          date: formatBangkokDateStr(),
          total_messaged,
          ai_handled: {
            count: botRepliedRooms.length,
            by_category: aiHandledByCategory,
          },
          ai_with_assist: {
            count: roomsWithAssist.size,
          },
          admin_handled: {
            count: Object.keys(ticketUserMap).length,
            by_category: adminByCategoryArr,
          },
        },
      },
    };
  }
}
