import * as crypto from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type QueryFilter } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { CryptoService } from '@/infra/crypto';
// [FIX-20260905-REDISNS] the one copy of the environment-segment rule
import { redisEnvNamespace } from '@/infra/redis/redis-namespace';
import { RedisService } from '@/infra/redis/redis.service';

import { matchCallback, type MatchResult } from './callback-matcher';
import { coerceString } from './coerce-string';
import type { ListCallbacksQueryDto } from './dto';
import { HandoffOaAccessService } from './handoff-oa-access.service';
import { TargetError } from './handoff-target.service';
import { verifyInbound } from './inbound-auth';
import { HandoffCallback } from './schemas/handoff-callback.schema';
import { HandoffJob } from './schemas/handoff-job.schema';
import { HandoffResult } from './schemas/handoff-result.schema';
import { HandoffTarget } from './schemas/handoff-target.schema';

/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/handoff/handoffCallbackController.js
 *
 * Two surfaces in one place, as in legacy:
 *   1. `receive` — the PUBLIC endpoint a target calls back on. Its own HMAC is
 *      the only gate; the rate limit in front of it is fail-open by design.
 *   2. inbox management (list / attach / dismiss) — `handoff.manage`, OA-scoped,
 *      so a human can resolve rows that could not be matched automatically.
 *
 * The ordering that must not be swapped: on a successful match the raw payload
 * is copied into `handoff_results.history` BEFORE the inbox row is allowed to
 * expire under its partial TTL. Reversing that loses the only copy.
 */

/** 8 KB debug snippet of the body; the full bytes are hashed, not stored. */
const BODY_SNIPPET_CAP = 8 * 1024;

/**
 * A high outer ceiling per target and IP, so a legitimate gateway bursting
 * retries never sees a 429. This is not the security control — the HMAC is.
 */
const CALLBACK_WINDOW_SEC = 60;
const CALLBACK_MAX = 600;

const TARGET_KEY_PATTERN = /^[a-z0-9_-]{1,64}$/;

const sha256Hex = (buffer: Buffer): string =>
  crypto.createHash('sha256').update(buffer).digest('hex');
const sha1Hex = (buffer: Buffer): string =>
  crypto.createHash('sha1').update(buffer).digest('hex');

export interface ReceiveCallbackInput {
  targetKey: string;
  jobRefFromPath: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  /** Socket address — NOT the spoofable forwarded header. */
  remoteIp: string;
}

/** What the public endpoint answers, with the status legacy pairs with it. */
export interface ReceiveCallbackOutcome {
  status: number;
  body: Record<string, unknown>;
}

export interface ListCallbacksResult {
  data: Array<Record<string, unknown>>;
  pagination: { page: number; limit: number; total: number; pages: number };
}

type LeanJob = Record<string, unknown> & {
  _id: Types.ObjectId;
  hook_id?: Types.ObjectId | null;
};

@Injectable()
export class HandoffCallbackService {
  private readonly logger = new Logger(HandoffCallbackService.name);

  /**
   * [FIX-20260905-REDISNS] `<env>.<db8>` — see `infra/redis/redis-namespace.ts`.
   * Resolved once at construction; both inputs are env-fixed for the process.
   */
  private readonly envNamespace: string;

  constructor(
    @InjectModel(HandoffCallback.name)
    private readonly callbackModel: Model<HandoffCallback>,
    @InjectModel(HandoffTarget.name)
    private readonly targetModel: Model<HandoffTarget>,
    @InjectModel(HandoffJob.name)
    private readonly jobModel: Model<HandoffJob>,
    @InjectModel(HandoffResult.name)
    private readonly resultModel: Model<HandoffResult>,
    private readonly oaAccess: HandoffOaAccessService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    // [FIX-20260905-REDISNS] the two halves of the environment segment
    @Inject(realtimeConfig.KEY)
    realtime: ConfigType<typeof realtimeConfig>,
    @Inject(mongoConfig.KEY)
    mongo: ConfigType<typeof mongoConfig>,
  ) {
    this.envNamespace = redisEnvNamespace(realtime.wsEnv, mongo.uri);
  }

  /**
   * The callback limiter, keyed per target and IP.
   *
   * Implemented here on `incrementWithTtl` rather than through
   * `RateLimitService`, because that service exposes only four fixed buckets
   * configured from env, and this limit is an arbitrary window (60s / 600) that
   * legacy passes inline to `isRateLimitedByKey`. The counting is identical —
   * INCR, EXPIRE on the first hit only, `count > max` — and a Redis failure
   * returns null, which reads as not limited. Fail-open is deliberate: the HMAC
   * is the security control, so a cache outage must not drop real callbacks.
   */
  private async isRateLimitedByKey(
    key: string,
    windowSeconds: number,
    max: number,
  ): Promise<boolean> {
    if (!key) return false;
    const count = await this.redis.incrementWithTtl(key, windowSeconds);
    if (count === null) return false;
    return count > max;
  }

  /** Redacts obviously secret headers before they are persisted. */
  private redactHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key] = /authorization|token|signature|secret|cookie/.test(
        key.toLowerCase(),
      )
        ? '[redacted]'
        : value;
    }
    return out;
  }

  /** Parses a JSON body; anything else yields `{}` but is still snippeted. */
  private parseBody(
    buffer: Buffer,
    contentType: string,
  ): Record<string, unknown> {
    if (/application\/json/i.test(contentType || '')) {
      try {
        const parsed: unknown = JSON.parse(buffer.toString('utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        return {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private headerValue(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string {
    const value = headers[name];
    if (Array.isArray(value)) return String(value[0] ?? '');
    return String(value ?? '');
  }

  /**
   * Upsert keyed on `event_id`, so a redelivered callback updates the same row
   * rather than creating a duplicate. `$setOnInsert` keeps the first-seen raw
   * evidence immutable while `$set` carries the current match state.
   */
  private upsertInbox(
    baseRow: Record<string, unknown>,
    extra: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.callbackModel
      .findOneAndUpdate(
        { event_id: baseRow['event_id'] } as QueryFilter<HandoffCallback>,
        { $setOnInsert: baseRow, $set: extra },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<Record<string, unknown>>()
      .exec();
  }

  /**
   * The public callback endpoint.
   *
   * SECURITY: these two routes are on the legacy skip-auth list
   * (apiRoutes.js:127-128), so no bearer token is ever checked. The signature
   * check below is the ENTIRE boundary. Once it passes the handler always
   * answers 200, even when the job cannot be matched — the row parks in the
   * inbox instead, because telling a caller "unmatched" would let it probe
   * which references exist.
   */
  async receive(input: ReceiveCallbackInput): Promise<ReceiveCallbackOutcome> {
    const rawBody = Buffer.isBuffer(input.rawBody)
      ? input.rawBody
      : Buffer.from(String(input.rawBody ?? ''), 'utf8');

    const targetKey = String(input.targetKey ?? '');

    // 1. Charset first, before Redis or the database is touched.
    if (!TARGET_KEY_PATTERN.test(targetKey)) {
      return { status: 400, body: { error: 'bad target_key' } };
    }

    // 2. Rate limit. Fail-open on a limiter error — the HMAC is the real gate,
    //    and a Redis outage must not stop legitimate callbacks.
    try {
      /* [FIX-20260905-REDISNS] The counter is namespaced per ENVIRONMENT.
         Both halves of the old key match across deployments: `target_key` is an
         operator-chosen slug (`/^[a-z0-9_-]{1,64}$/`, unique only within one
         database — `handoff-target.schema.ts:184-191`) and staging is meant to
         mirror production's configuration, so the same slug in both is the
         NORMAL case, not an accident; `remoteIp` is the partner's socket
         address, identical when one partner calls both. With staging and
         production sharing a Redis database, one window of 600 was shared — a
         load test on staging could 429 a real partner callback on production,
         and that path is NOT fail-open: fail-open covers a Redis error, never a
         genuine limit. เทสฝั่ง stg ห้ามกินโควต้าของ prod
         revert: drop `${this.envNamespace}:` and the two constructor configs. */
      const limited = await this.isRateLimitedByKey(
        `handoff:${this.envNamespace}:cb:${targetKey}:${input.remoteIp}`,
        CALLBACK_WINDOW_SEC,
        CALLBACK_MAX,
      );
      if (limited) return { status: 429, body: { error: 'rate limited' } };
    } catch {
      /* fail-open */
    }

    // 3. The target must exist and not be soft-deleted.
    const target = await this.targetModel
      .findOne({ key: targetKey, deleted_at: null })
      .lean<Record<string, unknown> | null>()
      .exec();
    if (!target) return { status: 404, body: { error: 'unknown target' } };

    // 4. Verify the signature — THE gate.
    const secretRaw =
      coerceString(target['inbound_secret']) ||
      coerceString(target['inbound_password']);
    const decrypted = secretRaw
      ? this.crypto.tryDecryptSecret(secretRaw)
      : { ok: true, value: '' };
    const secret = decrypted.ok ? (decrypted.value ?? '') : '';

    const headers = input.headers ?? {};
    const verdict = verifyInbound({
      inboundAuth: target['inbound_auth'] ?? {},
      secret,
      rawBody,
      headers,
      query: input.query ?? {},
    });

    // The dedupe axis: the sender's own event id, else a hash of the body.
    const eventId =
      String(
        this.headerValue(headers, 'x-event-id') ||
          this.headerValue(headers, 'x-idempotency-key') ||
          '',
      ) || `sha1_${sha1Hex(rawBody)}`;

    const bodyString = rawBody.toString('utf8');
    const snippet =
      bodyString.length > BODY_SNIPPET_CAP
        ? bodyString.slice(0, BODY_SNIPPET_CAP)
        : bodyString;

    // Stored regardless of the auth result: a rejected callback is exactly the
    // thing an operator needs to see, and the raw hash is always recorded.
    const baseRow: Record<string, unknown> = {
      target_key: targetKey,
      remote_ip: input.remoteIp,
      event_id: eventId,
      headers_redacted: this.redactHeaders(headers),
      body_snippet: snippet,
      truncated: bodyString.length > BODY_SNIPPET_CAP,
      raw_bytes: rawBody.length,
      raw_sha256: sha256Hex(rawBody),
      auth_result: verdict.reason,
    };

    /**
     * ==== [FIX-20260818-REJECTROW] audit_18_aug H8 — a refusal does not choose
     * its own row.
     *
     * Recording a refused callback stays: the comment above is right that it is
     * exactly what an operator needs to see. Two things about the ROW were
     * wrong, and both were reachable without authenticating.
     *
     * THE KEY. `upsertInbox` keys on `event_id`, taken from the caller's own
     * `x-event-id` header, and that column carries a UNIQUE index. Since the
     * write is `$setOnInsert`, the first writer owns the row's raw evidence — so
     * posting a predicted event id ahead of the genuine callback locks in the
     * attacker's `raw_sha256`, which `applyMatchedCallback` then copies into the
     * permanent result history. Replaying a live event id with a bad signature
     * is the same defect reversed: the `$set` moves a real row's status.
     *
     * THE LIFETIME. This wrote `unmatched`, and the deployed TTL is PARTIAL —
     * read off the live index, not the comment:
     *   created_at_1 · expireAfterSeconds 2592000
     *   partial: { match_status: { $in: ['matched','pending','dismissed'] } }
     * `unmatched` sits outside it deliberately, so undecided evidence cannot
     * vanish on a timer. The schema promises a sweeper that ages stale unmatched
     * rows into `dismissed`; that sweeper does not exist — only the field it
     * would set. So this path let an unauthenticated caller write PERMANENT rows
     * without limit.
     *
     * Both are closed by deriving the key from what the SERVER knows — target, a
     * hash of the remote address, and the hour — under a prefix that can never
     * collide with a real event id, and by landing on `dismissed`, which is
     * already in the schema enum and already inside the deployed partial TTL.
     * No collMod, no dropIndex, no backfill. หนึ่งแถวต่อ (target, ip, ชั่วโมง) และมันหมดอายุเองได้
     *
     * The authenticated path below is untouched: it still keys on the sender's
     * event id and still records its own evidence.
     *
     * revert: pass `baseRow` again with `{ match_status: 'unmatched' }`.
     */
    if (!verdict.ok) {
      const hourBucket = Math.floor(Date.now() / 3_600_000);
      const rejectionKey = `rej_${sha1Hex(
        Buffer.from(`${targetKey}|${input.remoteIp ?? ''}|${hourBucket}`),
      )}`;
      await this.upsertInbox(
        { ...baseRow, event_id: rejectionKey },
        { match_status: 'dismissed' },
      );
      const status = verdict.reason === 'malformed' ? 400 : 401;
      return { status, body: { error: verdict.reason } };
    }

    // 5. Authenticated. From here the answer is always 200.
    const parsed = this.parseBody(
      rawBody,
      this.headerValue(headers, 'content-type'),
    );
    let matchResult: MatchResult<LeanJob> = {
      status: 'unmatched',
      job: null,
      matched_by: '',
    };
    try {
      matchResult = await matchCallback<LeanJob>({
        target: target,
        parsed,
        jobRefFromPath: input.jobRefFromPath,
        findJobs: (query) =>
          this.jobModel.find(query).limit(2).lean<LeanJob[]>().exec(),
      });
    } catch (error) {
      this.logger.error(
        `callback match error (parked as pending): ${(error as Error).message}`,
      );
      matchResult = { status: 'pending', job: null, matched_by: '' };
    }

    const row = await this.upsertInbox(baseRow, {
      match_status: matchResult.status,
      matched_job_id: matchResult.job?._id ?? null,
      matched_by: matchResult.matched_by || '',
      hook_id: matchResult.job?.hook_id ?? null,
    });

    // 6. On a match, copy the raw payload into the result history BEFORE the
    //    inbox row can expire.
    if (matchResult.status === 'matched' && matchResult.job) {
      try {
        await this.applyMatchedCallback(matchResult.job, rawBody, parsed, row);
      } catch (error) {
        this.logger.error(
          `applyMatchedCallback failed (row kept for re-match): ${(error as Error).message}`,
        );
      }
    }

    return { status: 200, body: { ok: true } };
  }

  /**
   * Copies the raw payload into `handoff_results.history` and stamps the job.
   *
   * Append-only: `$push` with `$slice` bounds the history without a
   * read-modify-write, so two callbacks landing at once cannot lose one.
   */
  private async applyMatchedCallback(
    job: LeanJob,
    rawBody: Buffer,
    parsed: Record<string, unknown>,
    row: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const historyEntry = {
      seq: (Number(job['callback_count']) || 0) + 1,
      received_via: 'callback',
      received_at: now,
      http_status: 200,
      raw: parsed,
      raw_bytes: rawBody.length,
      raw_sha256: row['raw_sha256'],
      truncated: row['truncated'],
    };

    await this.resultModel
      .updateOne(
        { _id: job._id },
        {
          $setOnInsert: {
            _id: job._id,
            job_ref: job['job_ref'],
            target_key: job['target_key'],
            subject_type: job['subject_type'],
            subject_id: job['subject_id'],
          },
          $push: { history: { $each: [historyEntry], $slice: -20 } },
        },
        { upsert: true },
      )
      .exec();

    await this.jobModel
      .updateOne(
        { _id: job._id },
        {
          $set: {
            callback_received_at: now,
            'result_meta.received_via': 'callback',
            'result_meta.has_raw': true,
          },
          $inc: { callback_count: 1 },
        },
      )
      .exec();
  }

  /* ── inbox management (handoff.manage) ──────────────────────────────── */

  async list(
    query: ListCallbacksQueryDto,
    user?: AuthenticatedUser,
  ): Promise<ListCallbacksResult> {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 200);
    const filters: Record<string, unknown> = {};

    if (query.match_status) {
      filters['match_status'] = String(query.match_status);
    }
    if (query.target_key) filters['target_key'] = String(query.target_key);

    /*
     * A callback only carries a hook_id once it has been matched, so unmatched
     * rows have no OA yet and are visible to super callers only — the `$in`
     * cannot match null. Matched rows scope normally.
     */
    const allowed = await this.oaAccess.getAllowedHookIds(user);
    if (allowed !== null) {
      filters['hook_id'] = {
        $in: allowed.map((id) => new Types.ObjectId(id)),
      };
    }

    const [items, total] = await Promise.all([
      this.callbackModel
        .find(filters as QueryFilter<HandoffCallback>)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<Array<Record<string, unknown>>>()
        .exec(),
      this.callbackModel
        .countDocuments(filters as QueryFilter<HandoffCallback>)
        .exec(),
    ]);

    return {
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Manually attaches an unmatched or ambiguous callback to a job.
   *
   * The whole body runs inside `wrapHandlerCatch` because legacy wraps the
   * whole handler and answers `error.statusCode || 400`
   * (handoffCallbackController.js:236-254). Without it a malformed `:id` throws
   * a Mongoose CastError straight past this service to the global filter, which
   * answers 500 — where legacy answers 400. Note the fallback is `|| 400`, so an
   * error that CARRIES a status (the 403 from `ensureHookAccess`, the 404s
   * below) keeps it; only a bare error is flattened to 400.
   */
  async attach(
    id: string,
    jobIdInput: string,
    user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.wrapHandlerCatch(async () =>
      this.attachInner(id, jobIdInput, user),
    );
  }

  private async attachInner(
    id: string,
    jobIdInput: string,
    user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    const row = await this.callbackModel.findById(id).exec();
    if (!row) throw new TargetError(404, 'callback not found');

    const jobId = String(jobIdInput ?? '');
    if (!Types.ObjectId.isValid(jobId)) {
      throw new TargetError(400, 'job_id required');
    }

    const job = await this.jobModel
      .findById(jobId)
      .lean<LeanJob | null>()
      .exec();
    if (!job) throw new TargetError(404, 'job not found');

    await this.oaAccess.ensureHookAccess(user, job.hook_id);

    row.set('match_status', 'matched');
    row.set('matched_job_id', job._id);
    row.set('matched_by', 'manual');
    row.set('hook_id', job.hook_id ?? null);
    row.set('rematch_count', (Number(row.get('rematch_count')) || 0) + 1);
    await row.save();

    return { data: row.toObject() as unknown as Record<string, unknown> };
  }

  /**
   * Dismisses a junk or unresolvable callback.
   *
   * Same wrapper, same reason as `attach`. Legacy's dismiss catch is
   * `res.status(400)` flat (handoffCallbackController.js:266-268) rather than
   * `error.statusCode || 400`, but the only statuses this handler can raise are
   * its own 404 and a cast failure, so routing both through the shared helper
   * produces byte-identical answers. Kept shared on purpose: two near-copies of
   * an error mapping is how they drift apart.
   */
  async dismiss(
    id: string,
    reason: string,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.wrapHandlerCatch(async () =>
      this.dismissInner(id, reason),
    );
  }

  private async dismissInner(
    id: string,
    reason: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const row = await this.callbackModel.findById(id).exec();
    if (!row) throw new TargetError(404, 'callback not found');

    row.set('match_status', 'dismissed');
    row.set('dismiss_reason', String(reason || 'manual'));
    await row.save();

    return { data: row.toObject() as unknown as Record<string, unknown> };
  }

  /**
   * Reproduces the legacy inbox handlers' outer `catch`:
   * `res.status(error.statusCode || 400).json({ error: error.message })`.
   *
   * An error that already carries a status is re-thrown untouched, so the
   * deliberate 404s and the 403 from `ensureHookAccess` survive. Everything
   * else — in practice a Mongoose CastError from a malformed `:id` — becomes a
   * 400 carrying the driver's own message, which is exactly what legacy emits.
   */
  private async wrapHandlerCatch<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const status = error as { status?: number; statusCode?: number };
      if (status.status ?? status.statusCode) throw error;
      throw new TargetError(400, (error as Error).message);
    }
  }
}
