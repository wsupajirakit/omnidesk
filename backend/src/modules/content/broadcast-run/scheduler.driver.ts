/**
 * [FEAT-20260823-BCASTCRON] The only timer in the broadcast story.
 * ===========================================================================
 * `broadcast-schedule/` is pure by rule — no Mongo, no clock, no `@Injectable`.
 * This file is the one impure piece: it owns the timer and the models, builds
 * the query shapes that folder produces, and hands the results back to
 * `BroadcastSchedulerWorker`. Everything about WHAT is due stays over there;
 * only WHEN TO ASK lives here. ตัวจับเวลาอยู่ไฟล์เดียว ที่เหลือยัง pure.
 *
 * 🔴 THREE INDEPENDENT REASONS A JOB DOES NOT MOVE, and every campaign that
 *    existed before this feature fails ALL THREE:
 *
 *      1. `BROADCAST_SCHEDULER_ENABLED` — the switch. Off ⇒ `buildDueScanQuery`
 *         returns `null` and the database is never asked.
 *      2. `next_run_at` — the scan matches only jobs that carry it, and no
 *         campaign had that column before 22/08.
 *      3. `send_kind` — see `runJob` below. A job that never opted into the
 *         new pipeline is REFUSED rather than run.
 *
 *    เจ้าของสั่ง 23/08: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด".
 *
 * ⚠️ THE TIMER IS REGISTERED EITHER WAY, and that is deliberate: a `@Cron`
 *    that appears and disappears with a flag makes "is the scheduler even
 *    installed?" unanswerable from the outside. It fires and refuses, and the
 *    refusal is counted. ให้มันเต้นแล้วปฏิเสธ ดีกว่าหายไปเงียบ ๆ.
 *
 * ⚠️ EVERY INSTANCE TICKS. Correctness is not the issue — the claim flips
 *    `scheduled → sending` atomically, so a job runs once however many
 *    processes wake up. The COST is: each instance runs one indexed partial
 *    scan a minute that normally returns nothing.
 *
 *    That is cheap by design (`broadcast_due` is partial on `scheduled`, so it
 *    stays tiny however long the archive grows), but it is not free at ten
 *    instances. `BROADCAST_SCHEDULER_INSTANCE=off` turns the tick into an
 *    immediate return on the instances that should not scan, WITHOUT a code
 *    change and without touching the module-wide switch that would stop
 *    scheduling everywhere. ปิดรายเครื่องได้ โดยไม่ปิดทั้งระบบ.
 *
 * revert: delete this file, its provider line in `content.module.ts`, and
 * `ScheduleModule.forRoot()` in `app.module.ts`. Nothing else refers to it.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';

import {
  BroadcastSchedulerWorker,
  isJobScheduleEnabled,
  type BroadcastSchedule,
  type DueJobRow,
  type SchedulerJobOutcome,
  type SchedulerTickReport,
  type SchedulerWorkerPorts,
} from '../broadcast-schedule';
import { Broadcast } from '../schemas/broadcast.schema';

import { BroadcastNewSendPort } from './new-send.port';
import { usesNewSendPath } from './new-path.switch';

/**
 * Who a scheduled run is attributed to.
 *
 * ⚠️ NOT a real user id. `triggered_by_user` stays absent on these rows, so a
 * history row can never claim a person pressed a button they did not press.
 * `triggered_by: 'scheduler'` is the enum value the schema already carries.
 */
const SCHEDULER_ACTOR = { id: undefined, name: 'scheduler' } as const;

@Injectable()
export class BroadcastSchedulerDriver {
  private readonly logger = new Logger(BroadcastSchedulerDriver.name);
  private readonly worker: BroadcastSchedulerWorker;

  constructor(
    @InjectModel(Broadcast.name)
    private readonly broadcastModel: Model<Record<string, unknown>>,
    /**
     * `@Optional()` for the same reason the service uses it: a caller building
     * this without the module gets `undefined` and a scheduler that refuses
     * every job, rather than a DI error at boot.
     */
    @Optional()
    private readonly newSendPort?: BroadcastNewSendPort,
  ) {
    this.worker = new BroadcastSchedulerWorker(this.ports());
  }

  /** For a health line and for the spec — the worker owns the real counters. */
  get skippedTicks(): number {
    return this.worker.skipped;
  }

  /**
   * 🔴 EVERY MINUTE, AND NEVER AWAITED BY ANYONE. `tick` promises never to
   * reject, which is what makes that safe: a rejected timer callback is an
   * unhandled rejection with no round number and no job id attached.
   */
  /**
   * `off` on this instance ⇒ never scan. Any other value (including unset)
   * scans, so a deployment that knows nothing about this variable keeps the
   * behaviour it had. ไม่ตั้ง = ทำงานเหมือนเดิม.
   */
  private get instanceOff(): boolean {
    return process.env.BROADCAST_SCHEDULER_INSTANCE === 'off';
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<SchedulerTickReport> {
    if (this.instanceOff) {
      /* Shaped like the worker's own refusal so a caller cannot tell the two
         apart and does not need to. `disabled` is the quiet answer. */
      return {
        ran: false,
        refused: 'disabled',
        scanned: 0,
        handed: 0,
        rejected: 0,
        failed: 0,
        swept: 0,
        nextRuns: [],
        skippedTicks: this.worker.skipped,
      };
    }
    /* ⚠️ RETURNS THE REPORT even though `@Cron` discards it. Two reasons, and
       the second is why it changed: a health endpoint can read it, and a spec
       can tell "the scan came back empty" from "the scan could not be read" —
       a distinction the worker's own contract draws and that a `void` return
       made untestable. Two mutations survived on exactly that blind spot.
       คืนรายงานเพื่อให้แยกออกว่า 'ไม่มีงาน' กับ 'อ่านไม่ได้' ต่างกัน. */
    const report = await this.worker.tick(new Date());
    if (report.refused === 'disabled') return report; // the normal quiet answer
    if (report.refused) {
      this.logger.warn(`broadcast scheduler tick refused: ${report.refused}`);
      return report;
    }
    if (report.handed > 0 || report.failed > 0 || report.swept > 0) {
      this.logger.log(
        `broadcast scheduler: scanned=${report.scanned} handed=${report.handed} ` +
          `rejected=${report.rejected} failed=${report.failed} swept=${report.swept} ` +
          /* [FEAT-20260824-BCASTREPEAT] `armed` is in the line because it is the
             only way to see, from a log, that a repeat will actually come back.
             `armed=null` = nothing was written — a cadence that looks set and
             is not. armed ต่างจาก handed: handed=ยิงแล้ว · armed=รอบหน้าถูกเขียนแล้ว. */
          `skippedTicks=${report.skippedTicks} armed=${String(report.armed)}`,
      );
    }
    return report;
  }

  private ports(): SchedulerWorkerPorts {
    return {
      scanDue: async (query) => {
        try {
          return await this.broadcastModel
            .find(query.filter)
            .select(query.projection)
            .sort(query.sort)
            .limit(query.limit)
            .lean()
            .exec();
        } catch (e) {
          /* `null` = "could not read" — the worker turns that into a refusal
             rather than into an empty scan, so a database blip never reads as
             "nothing was due". อ่านไม่ได้ ≠ ไม่มีงาน. */
          this.logger.error(`due scan failed: ${msg(e)}`);
          return null;
        }
      },

      sweepStale: async (query) => {
        try {
          /* 🔴 IDS FIRST, THEN UPDATE. `updateMany` cannot honour `sort` or
             `limit`, so passing the shape straight to it would silently ignore
             the bound the query carries and rewrite every stale row in one go.
             updateMany ไม่รับ limit ⇒ ต้องหา id ก่อน ไม่งั้นเพดานหายไปเฉย ๆ. */
          const stale = (await this.broadcastModel
            .find(query.filter)
            .select({ _id: 1 })
            .sort(query.sort)
            .limit(query.limit)
            .lean()
            .exec()) as unknown as Array<{ _id: unknown }>;
          if (stale.length === 0) return 0;

          const res = await this.broadcastModel
            .updateMany(
              { _id: { $in: stale.map((r) => r._id) }, ...query.filter },
              query.update,
            )
            .exec();
          return typeof res.modifiedCount === 'number' ? res.modifiedCount : 0;
        } catch (e) {
          this.logger.error(`stale sweep failed: ${msg(e)}`);
          return null;
        }
      },

      /* `now` is the tick's start; this runner does not need it. `finishedAt`
         below is when the ROUND ended, which is a different instant and is
         read at return time. รับพารามิเตอร์ที่ไม่ได้ใช้ ก็แค่หนี้เล็ก ๆ อีกก้อน. */
      runJob: (job) => this.runJob(job),

      /**
       * [FEAT-20260824-BCASTREPEAT] Store the round the worker computed.
       *
       * 🔴 ONE WRITE PER JOB, NOT ONE `updateMany`. Each job's next instant is
       *    its own — computed from ITS rule — so there is no single `$set` that
       *    serves two of them. `updateMany` here would have to pick one value
       *    and stamp it onto every job in the round.
       *    รอบถัดไปของแต่ละงานไม่เท่ากัน ⇒ updateMany ใช้ไม่ได้.
       *
       * 🔴 `null` MEANS "DO NOT COME BACK", and the cursor is CLEARED for it.
       *    Leaving a past `next_run_at` in place is the runaway: the scan
       *    matches `$lte: now`, so a stale cursor is due every single tick,
       *    forever. A one-off campaign and a round that threw both land here.
       *    ไม่มีรอบถัดไป = ต้องล้าง cursor ไม่ใช่ปล่อยค่าเก่าไว้ ไม่งั้นยิงซ้ำทุกนาที.
       *
       * ⚠️ `run_count` is `$inc`, never a read-then-write: two instances can
       *    finish the same job's neighbours in the same second, and a computed
       *    count would lose one. `last_run_at` records that it DID run, which is
       *    true in both branches.
       */
      armNextRun: async (rows) => {
        let written = 0;
        for (const row of rows) {
          try {
            const finishedAt = new Date();
            const res = await this.broadcastModel
              .updateOne(
                { _id: row.id },
                row.nextRunAt === null
                  ? {
                      $set: { last_run_at: finishedAt },
                      $unset: { next_run_at: '' },
                      $inc: { run_count: 1 },
                    }
                  : {
                      $set: {
                        next_run_at: row.nextRunAt,
                        last_run_at: finishedAt,
                      },
                      $inc: { run_count: 1 },
                    },
              )
              .exec();
            if (typeof res.modifiedCount === 'number') {
              written += res.modifiedCount;
            }
          } catch (e) {
            /* One job that cannot be armed must not cost the others theirs —
               the same rule the run loop follows. อันเดียวพัง ห้ามล้มทั้งรอบ. */
            this.logger.error(
              `arming next run failed for ${String(row.id)}: ${msg(e)}`,
            );
          }
        }
        return written;
      },
    };
  }

  /**
   * 🔴 A SCHEDULED RUN GOES THROUGH THE CLAIMED PIPELINE OR NOT AT ALL.
   *
   * The old sender has no claim and no lease — `sendBroadcastNow` is safe only
   * because a person presses it once. Two app instances running the same cron
   * minute would both dispatch the same campaign, and every follower would get
   * the message twice. The new pipeline flips `scheduled → sending` atomically
   * (`claim.ts`), so the loser of that race simply finds nothing to do.
   *
   * ⇒ a job that never set `send_kind` is REFUSED here, loudly, rather than
   *   run down a path that cannot protect it. That refusal is also the third
   *   reason turning the scheduler on moves no existing campaign.
   *   ท่อเก่าไม่มีการจอง ⇒ cron หลายตัวจะยิงซ้ำ ⇒ ต้องปฏิเสธ ไม่ใช่เสี่ยง.
   */
  private async runJob(job: DueJobRow): Promise<SchedulerJobOutcome | null> {
    const id = job._id;
    if (!usesNewSendPath((job as Record<string, unknown>)['send_kind'])) {
      /* The name is not on the scanned row — the projection is deliberately
         three columns plus `send_kind` — so this line carries the id and the
         reason, and the full document is never loaded for a job being refused.
         ชื่อไม่ได้ติดมากับ scan และไม่คุ้มจะโหลดเอกสารเต็มเพื่อมาปฏิเสธ. */
      this.logger.warn(
        `broadcast ${String(id)} is scheduled but has no send_kind — refusing: ` +
          'the legacy sender has no claim, so a second instance would send it twice',
      );
      return null;
    }
    if (!this.newSendPort) {
      this.logger.error(
        `broadcast ${String(id)} is due but no send port is bound — refusing`,
      );
      return null;
    }

    const full = await this.broadcastModel.findById(id).lean().exec();
    if (!full) return null;

    /**
     * [FIX-20260824-BCASTJOBSWITCH] The PER-JOB kill switch, level 2 of the
     * three `schedule-limits.ts:20-26` describes.
     *
     * Owner, 24/08: *"ต้องมีนะทำสิ เพราะ job มันแยกกันไม่เกี่ยวกันแต่ละงาน"*.
     *
     * 🔴 IT ONLY HALF EXISTED. `computeNextRun` has held a `Gate 2` on
     *    `isJobScheduleEnabled` since it was written, so switching a job off
     *    stops it being RE-ARMED — but the round already armed still fired,
     *    because nothing between the scan and the send asked the job's own
     *    switch. An admin who turned a campaign off still got one more send,
     *    which is not what an off switch means.
     *    ปิดแล้วยังได้อีกหนึ่งนัด = ปุ่มปิดที่ไม่ได้ปิด.
     *
     * 🔴 CHECKED HERE, NOT IN THE SCAN. The due-scan projection is four columns
     *    on purpose (`due-query.ts:157-162`) and `schedule` is not one of them —
     *    pulling a whole rule object into every scanned row would put the thing
     *    that projection exists to keep out back on the hot path. This method
     *    already has the FULL document in hand, one read per job that is
     *    actually due, so the check is free here and costs a scan nothing.
     *    เช็คตรงที่มีเอกสารเต็มอยู่แล้ว ไม่ยัดเข้า projection ที่ตั้งใจให้ผอม.
     *
     * ⚠️ ABSENT MEANS ON. `isJobScheduleEnabled` answers `true` for `undefined`,
     *    so every campaign that predates the column keeps running exactly as it
     *    does today. Only an explicit `false` stops anything.
     *    ไม่ตั้ง = เปิด · เฉพาะ false เท่านั้นที่ปิด.
     *
     * ⚠️ THE CURSOR IS LEFT WHERE IT IS, and that is measured, not assumed.
     *    Returning `null` here means this job was never RUN, so the tick never
     *    computes a next round for it and `armNextRun` never touches it — the
     *    stale `next_run_at` simply stays. Verified 24/08: a job switched off at
     *    round 5 sat at `next_run_at` four minutes past due and `run_count`
     *    never moved.
     *
     *    ⇒ the scan keeps FINDING it every minute and this method keeps
     *      skipping it, one log line per tick. That is a cost, not a bug: the
     *      scan is an indexed partial lookup, and clearing the cursor would
     *      throw away the exact instant the campaign should resume from — an
     *      admin switching it back on would have to re-pick the time.
     *      ปิดแล้ว cursor ค้างไว้ตั้งใจ ⇒ เปิดกลับแล้วไปต่อจากจุดเดิม ไม่ต้องตั้งเวลาใหม่.
     *
     *    ⚠️ IF THE LOG NOISE EVER MATTERS, the fix is a `schedule.enabled` term
     *      in the scan filter, NOT clearing the cursor here.
     *
     * revert: delete this block. A job's `enabled:false` then still stops the
     * NEXT round (Gate 2) but lets the armed one through, which is today's
     * behaviour.
     */
    const rule = (full as Record<string, unknown>)['schedule'] as
      BroadcastSchedule | null | undefined;
    if (!isJobScheduleEnabled(rule)) {
      this.logger.log(
        `broadcast ${String(id)} is due but its schedule is switched off — skipping`,
      );
      return null;
    }

    await this.newSendPort.send(full, SCHEDULER_ACTOR);

    /* The repeat rule comes back from HERE because the scan projects three
       columns and does not carry it — the worker's own docblock says so. */
    return {
      schedule: (full as Record<string, unknown>)['schedule'] as never,
      finishedAt: new Date(),
      /**
       * [FIX-20260825-MAXRUNSOFFBY1] +1 เพราะรอบที่เพิ่งยิงยังไม่ถูกนับ
       *
       * 🔴 `full` ถูกโหลดมา **ก่อน** `$inc: { run_count: 1 }` ที่เกิดทีหลัง
       *    (ดูบล็อก arm ด้านบน) ⇒ ส่ง `run_count` ดิบไปให้ `computeNextRun`
       *    เท่ากับบอกว่า "ยังยิงไปน้อยกว่าความจริง 1 รอบ" ⇒ `max_runs: 1`
       *    จะติดอาวุธรอบที่ 2 แล้ว **ยิงจริง** เพราะไม่มี gate กัน max_runs
       *    ก่อนส่ง (มีแต่ Gate 2 ของสวิตช์เปิด/ปิด)
       *    เจอจริง 25/08 ตอนยิงเทส: ตั้ง max_runs=1 ยิงเสร็จแล้วยังมี next_run_at
       *    ของพรุ่งนี้ค้างอยู่ · ยิงเกินคือความผิดพลาดที่ถอนคืนไม่ได้
       *
       * ⚠️ ห้าม "แก้" ด้วยการย้าย `$inc` มาก่อน — การนับต้องเกิดพร้อมการเขียน
       *    cursor ในคำสั่งเดียว ไม่งั้นสองอินสแตนซ์นับซ้อนกันได้
       */
      runsSoFar: numberOr0((full as Record<string, unknown>)['run_count']) + 1,
    };
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : '?');
const numberOr0 = (v: unknown): number => (typeof v === 'number' ? v : 0);
