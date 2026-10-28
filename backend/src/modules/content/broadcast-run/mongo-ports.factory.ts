/**
 * [FEAT-20260822-BCASTPORTS] Mongo behind the seams `runBroadcast` was written against.
 * ===========================================================================
 * `runBroadcast` takes every I/O as a port so its spec can drive a whole
 * campaign with no database. This is the other half: the real queries, in one
 * file, so the orchestrator never learns what a collection is.
 *
 * 🔴 EVERY READ FAILS TO `NaN`, NEVER TO `0`. Zero is a real answer that means
 *    "nobody" and every ceiling waves it through; a count we could not read is
 *    a broken caller and must be refused. That distinction is the whole reason
 *    these wrappers exist instead of calling the models inline.
 *    อ่านไม่ได้ = NaN ไม่ใช่ 0 — ศูนย์คือคำตอบจริงที่ทุกด่านปล่อยผ่าน.
 *
 * ⚠️ NOT WIRED INTO A ROUTE. `BROADCAST_NEW_PATH_ENABLED` is off, so nothing
 *    built here runs until two separate switches say so.
 *
 * revert: delete this file and its line in `index.ts`.
 */
import type { Model } from 'mongoose';

import { buildOaScopeQueries, type OaScopeQuery } from '../audience';
import {
  MongoHookTokenReader,
  MongoRecipientPager,
  type BroadcastChunkSink,
  type Clock,
  type RecipientPager,
} from '../broadcast-send';
import {
  countRunsInFlight,
  countRunsOfJob,
  countRunsOfUser,
  usageWindowQueries,
  type HistoryRow,
} from '../broadcast-history';

import type { BroadcastRunPorts } from './run-ports';

/** Only what these queries actually touch — not the whole document types. */
export interface RunPortModels {
  readonly broadcastModel: Model<Record<string, unknown>>;
  readonly hookModel: Model<Record<string, unknown>>;
  readonly memberModel: Model<Record<string, unknown>>;
  readonly chatRoomModel: Model<Record<string, unknown>>;
  readonly historyModel: Model<Record<string, unknown>>;
  readonly safeDecrypt: (value: string) => string;
  /** Converts a stored cursor string back to whatever `_id` holds. */
  readonly toCursor: (id: string) => unknown;
}

/**
 * A count that cannot be read is `NaN`.
 *
 * ⚠️ The `catch` returning NaN is load-bearing, not defensive noise: a Mongo
 * hiccup that returned 0 would look to `planRun` like an empty audience and to
 * `checkAbuse` like a quiet hour, and the run would sail through both.
 */
async function safeCount(run: () => Promise<number>): Promise<number> {
  try {
    const n = await run();
    return typeof n === 'number' && Number.isFinite(n) ? n : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export interface RunPortsExtras {
  readonly sink: BroadcastChunkSink;
  readonly clock: Clock;
  readonly audienceFilter: Record<string, unknown>;
  readonly jobId: unknown;
  readonly userId: unknown;
  /**
   * [FIX-20260823-BCASTPREFETCH] Load one page of per-recipient values.
   *
   * 🔴 IT HAS TO BE DECLARED HERE OR IT IS SILENTLY DROPPED. This factory
   *    builds the ports object field by field, and TypeScript does not object
   *    to an extra key in an object literal that reaches it through a spread —
   *    so the caller passed a prefetch, the factory ignored it, and every
   *    personalised card rendered with no values and failed to send. The suite
   *    was green throughout: `new-send.service` passed it and `run-broadcast`
   *    read it, and nothing tested the hop between them.
   *    ส่งมาแล้วแต่ไม่ประกาศ = หายกลางทาง โดย tsc ไม่ฟ้อง.
   */
  readonly prefetchRecipients?: (
    hookId: string,
    lineUserIds: readonly string[],
  ) => Promise<void>;
}

/** Usage we could not read. Every window is `NaN` ⇒ the quota guard refuses. */
const UNREADABLE_QUOTA = {
  lastHour: { recipients: Number.NaN, requests: Number.NaN },
  lastDay: { recipients: Number.NaN, requests: Number.NaN },
};

/**
 * When did this job's last run finish?
 *
 * `usage-queries.ts` owns the "runs of this job" filter; the cooldown needs the
 * same rows, newest first, so it reuses that filter rather than writing a
 * second one that could drift from it.
 */
function lastFinishedQuery(
  jobId: unknown,
  now: Date,
): { readonly filter: Record<string, unknown> } | null {
  const q = countRunsOfJob(jobId, now, Number.MAX_SAFE_INTEGER);
  return q ? { filter: { broadcast_id: jobId } } : null;
}

/**
 * Build the ports for ONE run.
 *
 * Per run rather than per application: the pager holds that run's audience
 * filter and the token reader caches per OA for exactly this run's lifetime, so
 * a rotated token is picked up by the next run instead of half of this one.
 */
export function buildRunPorts(
  models: RunPortModels,
  extras: RunPortsExtras,
): BroadcastRunPorts {
  const tokens = new MongoHookTokenReader({
    findHook: async (hookId) =>
      (await models.hookModel
        .findById(hookId)
        .select({ access_token: 1, line_key: 1 })
        .lean()
        .exec()) as { access_token?: unknown; line_key?: unknown } | null,
    safeDecrypt: models.safeDecrypt,
  });

  const pager: RecipientPager = new MongoRecipientPager(
    {
      findMemberPage: async (filter, limit) =>
        await models.memberModel
          .find(filter)
          .select({ _id: 1 })
          .sort({ _id: 1 })
          .limit(limit)
          .lean()
          .exec(),
      findLineIds: async (q: OaScopeQuery) => {
        const rows = (await models.chatRoomModel
          .find(q.filter as Record<string, unknown>)
          .select(q.projection)
          .lean()
          .exec()) as unknown as Array<{ line_user_id?: unknown }>;
        return rows
          .map((r) => r.line_user_id)
          .filter((v): v is string => typeof v === 'string' && v !== '');
      },
      toCursor: models.toCursor,
    },
    extras.audienceFilter,
  );

  const ports: BroadcastRunPorts = {
    claim: (query) =>
      models.broadcastModel
        .findOneAndUpdate(query.filter, query.update, query.options)
        .lean()
        .exec(),

    release: (query) =>
      models.broadcastModel
        .findOneAndUpdate(query.filter, query.update, query.options)
        .lean()
        .exec(),

    renewLease: (query) =>
      models.broadcastModel
        .findOneAndUpdate(query.filter, query.update, query.options)
        .lean()
        .exec(),

    /**
     * How many members this OA would reach.
     *
     * 🔴 TWO STEPS, ALWAYS. `members` has no `hook_id`, so counting it directly
     * counts people from every channel the system talks to. The count has to
     * come from `chat_rooms`, the same route the pager walks — otherwise the
     * plan is costed against one audience and the send walks another.
     * นับกับส่งต้องเดินทางเดียวกัน ไม่งั้นแผนกับของจริงคนละชุด.
     */
    countRecipients: (hookId, filter) =>
      safeCount(async () => {
        const ids = (await models.memberModel
          .find(filter)
          .select({ _id: 1 })
          .lean()
          .exec()) as unknown as Array<{ _id: unknown }>;
        const queries = buildOaScopeQueries(
          ids.map((r) => r._id),
          hookId,
        );
        // `null` means the OA could not be scoped — refuse, do not guess.
        if (queries === null) return Number.NaN;

        let total = 0;
        for (const q of queries) {
          total += await models.chatRoomModel.countDocuments(
            q.filter as Record<string, unknown>,
          );
        }
        return total;
      }),

    /**
     * ⚠️ EVERY FILTER HERE IS BUILT BY `usage-queries.ts`, not written inline.
     *
     * The first draft of this file invented its own `{started_at: {$gte: …}}`
     * and invented field names to go with it; tsc rejected the shape and that
     * was the good outcome, because the silent version would have counted the
     * wrong thing while looking right. The queries have one owner.
     * ตัวนับกับตัวสร้าง query ต้องเป็นเจ้าของเดียวกัน ห้ามเขียน filter เองซ้ำ.
     */
    readAbuseState: async () => {
      const now = new Date(extras.clock.now());
      const ofJob = countRunsOfJob(extras.jobId, now);
      const ofUser = countRunsOfUser(extras.userId, now);
      const inFlight = countRunsInFlight();
      const last = lastFinishedQuery(extras.jobId, now);

      const lastRow = last
        ? ((await models.historyModel
            .findOne(last.filter)
            .sort({ finished_at: -1 })
            .select({ finished_at: 1 })
            .lean()
            .exec()) as { finished_at?: Date } | null)
        : null;

      /* ⚠️ NO `nowMs` HERE. `AbuseState` is `Omit<AbuseCheckInput,'nowMs'>` —
         the clock belongs to whoever CALLS the guard, not to the port that
         reads counters, so that one run cannot be judged against two different
         "nows". I returned it anyway and tsc caught it only when a spec read
         the field back. เวลาเป็นของคนเรียก ไม่ใช่ของคนอ่านตัวนับ. */
      return {
        /* A job of ours already in `sending` is one we must not start again. */
        jobIsRunning:
          (await safeCount(() =>
            models.broadcastModel.countDocuments({
              _id: extras.jobId,
              status: 'sending',
            }),
          )) > 0,
        lastRunFinishedAtMs: lastRow?.finished_at
          ? new Date(lastRow.finished_at).getTime()
          : null,
        runsOfThisJobLastHour: ofJob
          ? await safeCount(() =>
              models.historyModel.countDocuments(ofJob.filter),
            )
          : Number.NaN,
        /**
         * 🔴 [FIX-20260823-BCASTCRONACTOR] NO USER IS ZERO, NOT UNREADABLE.
         *
         * `countRunsOfUser` answers `null` for two very different situations:
         * a clock it could not read, and a run with NO USER AT ALL. The second
         * is the SCHEDULER — a cron run is attributed to `triggered_by:
         * 'scheduler'` and deliberately carries no `triggered_by_user`, so a
         * history row can never claim a person pressed a button they did not.
         *
         * Feeding `NaN` for that case made the abuse guard answer
         * `unreadable-state` and refuse EVERY scheduled run: measured on 23/08
         * against the real scheduler, three jobs refused with "a run counter
         * could not be read" while every counter was perfectly readable.
         *
         * A run with no user has no per-user history to count, and `0` is that
         * answer. The unreadable case stays unreadable: it is only reached when
         * a user IS present and the clock could not be read.
         * ไม่มีผู้ใช้ = นับได้ 0 · อ่านไม่ได้ = คนละเรื่อง ห้ามยุบรวมกัน.
         */
        runsByThisUserLastHour:
          extras.userId === null || extras.userId === undefined
            ? 0
            : ofUser
              ? await safeCount(() =>
                  models.historyModel.countDocuments(ofUser.filter),
                )
              : Number.NaN,
        runsInFlightGlobal: await safeCount(() =>
          models.broadcastModel.countDocuments(inFlight.filter),
        ),
      };
    },

    readQuotaUsage: async () => {
      const windows = usageWindowQueries(new Date(extras.clock.now()));
      if (!windows) return UNREADABLE_QUOTA;

      const sum = async (q: { filter: Record<string, unknown> }) => {
        try {
          const rows = (await models.historyModel
            .find(q.filter)
            .select({ sent: 1, requests_made: 1 })
            .lean()
            .exec()) as unknown as Array<{
            sent?: number;
            requests_made?: number;
          }>;
          return rows.reduce(
            (acc, r) => ({
              recipients: acc.recipients + (Number(r.sent) || 0),
              requests: acc.requests + (Number(r.requests_made) || 0),
            }),
            { recipients: 0, requests: 0 },
          );
        } catch {
          // Unreadable usage must look like "already at the ceiling", never
          // like an empty hour. อ่านไม่ได้ = ถือว่าเต็ม.
          return { recipients: Number.NaN, requests: Number.NaN };
        }
      };

      return {
        lastHour: await sum(windows.hour),
        lastDay: await sum(windows.day),
      };
    },

    saveHistory: async (rows: readonly HistoryRow[]) => {
      if (rows.length === 0) return;
      await models.historyModel.insertMany(rows as unknown[], {
        ordered: false,
      });
    },

    pager,
    sink: extras.sink,
    clock: extras.clock,
    /* Forwarded, not spread: an absent prefetch must stay absent so the
       executor is handed nothing rather than a no-op. */
    ...(extras.prefetchRecipients
      ? { prefetchRecipients: extras.prefetchRecipients }
      : {}),
  };
  /* `tokens` is handed to the SINK, not to the orchestrator — the run never
     touches a credential, which is why `BroadcastRunPorts` has no slot for one.
     Exposed here so the caller can build the sink with it. */
  return Object.assign(ports, { tokens });
}
