import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type QueryFilter } from 'mongoose';

import { resolveLogDateRange } from '@/common/utils/date-range';
import { escapeRegex } from '@/common/utils/escape-regex';
import { maskCredsDeep } from '@/common/utils/mask-creds';
import { CryptoService } from '@/infra/crypto';
import type { AuthenticatedUser } from '@/common';
import { Member } from '@/modules/chat';
import { SlipVerification } from '@/modules/slip';

import { coerceString } from './coerce-string';
import type { ListOverridesQueryDto, ListRunsQueryDto } from './dto';
import { HandoffChain } from './schemas/handoff-chain.schema';
import { HandoffChainRun } from './schemas/handoff-chain-run.schema';
import { HandoffOaAccessService } from './handoff-oa-access.service';
import { HandoffHookOverride } from './schemas/handoff-hook-override.schema';
import { HandoffJob } from './schemas/handoff-job.schema';
import { HandoffResult } from './schemas/handoff-result.schema';

/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/handoff/handoffChainController.js
 *
 * Chains, per-hook overrides and run history.
 *
 * IMPORTANT — this feature answers a `{ message }` error envelope, while the
 * target, job and callback controllers answer `{ error }`. Both families exist
 * in the legacy backend and the dashboard reads both. They are preserved per
 * controller and must NOT be unified.
 */

/** Raised where legacy answers a `{ message }` body. */
export class ChainError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const KEY_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** Override secrets: encrypted at rest, never returned. */
const OVERRIDE_SECRETS = ['auth_secret', 'auth_password'] as const;

/** The member profile fields the history card renders. */
interface MemberSnapshot {
  record_id: string;
  line_user_id: string;
  display_name?: string;
  full_name?: string;
  phone_number?: string;
}

type LeanRun = Record<string, unknown> & {
  _id: Types.ObjectId;
  member_user_id?: string;
};

@Injectable()
export class HandoffChainService {
  constructor(
    @InjectModel(HandoffChain.name)
    private readonly chainModel: Model<HandoffChain>,
    @InjectModel(HandoffChainRun.name)
    private readonly chainRunModel: Model<HandoffChainRun>,
    @InjectModel(HandoffHookOverride.name)
    private readonly overrideModel: Model<HandoffHookOverride>,
    @InjectModel(HandoffJob.name)
    private readonly jobModel: Model<HandoffJob>,
    @InjectModel(HandoffResult.name)
    private readonly resultModel: Model<HandoffResult>,
    @InjectModel(Member.name)
    private readonly memberModel: Model<Member>,
    @InjectModel(SlipVerification.name)
    private readonly slipModel: Model<SlipVerification>,
    private readonly crypto: CryptoService,
    /* [FIX-20260818-HANDOFFSCOPE · plan §8 = T3-3] Appended LAST so every existing
       positional construction in the specs keeps compiling. */
    private readonly oaAccess: HandoffOaAccessService,
  ) {}

  /** Same leaf-wise patching as the target service — see its `flatten`. */
  private flatten(
    input: unknown,
    prefix = '',
    out: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const source =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};

    for (const [key, value] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        this.flatten(value, path, out);
      } else {
        out[path] = value;
      }
    }
    return out;
  }

  private assertObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) throw new ChainError(400, 'bad id');
  }

  /* ── chains ─────────────────────────────────────────────────────────── */

  async listChains(): Promise<{ data: Array<Record<string, unknown>> }> {
    const rows = await this.chainModel
      .find({ deleted_at: null })
      .sort({ created_at: -1 })
      .lean<Array<Record<string, unknown>>>()
      .exec();
    return { data: rows };
  }

  async getChain(id: string): Promise<{ data: Record<string, unknown> }> {
    this.assertObjectId(id);
    const row = await this.chainModel
      .findOne({ _id: id, deleted_at: null })
      .lean<Record<string, unknown> | null>()
      .exec();
    if (!row) throw new ChainError(404, 'not found');
    return { data: row };
  }

  async createChain(
    body: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    if (!KEY_PATTERN.test(coerceString(body['key']))) {
      throw new ChainError(400, 'key charset /^[a-z0-9_-]{1,64}$/');
    }
    if (!['dev', 'prod'].includes(coerceString(body['env_tag']))) {
      throw new ChainError(400, 'env_tag dev|prod required');
    }
    const duplicate = await this.chainModel
      .findOne({
        key: body['key'],
        deleted_at: null,
      } as QueryFilter<HandoffChain>)
      .lean()
      .exec();
    if (duplicate) throw new ChainError(409, 'key already exists');

    try {
      // `strict: true` drops unknown keys for us.
      const doc = await this.chainModel.create(body);
      return { data: doc.toObject() as unknown as Record<string, unknown> };
    } catch (error) {
      throw new ChainError(400, (error as Error).message);
    }
  }

  async updateChain(
    id: string,
    body: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    this.assertObjectId(id);
    const doc = await this.chainModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!doc) throw new ChainError(404, 'not found');

    const patch = { ...body };
    // `key` is immutable after create — run history refers to a chain by key.
    delete patch['key'];
    doc.set(this.flatten(patch));

    try {
      await doc.save();
      return { data: doc.toObject() as unknown as Record<string, unknown> };
    } catch (error) {
      throw new ChainError(400, (error as Error).message);
    }
  }

  async deleteChain(
    id: string,
  ): Promise<{ data: { _id: Types.ObjectId; deleted: boolean } }> {
    this.assertObjectId(id);
    const doc = await this.chainModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null },
        { $set: { deleted_at: new Date(), enabled: false } },
        { new: true },
      )
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    if (!doc) throw new ChainError(404, 'not found');
    return { data: { _id: doc._id, deleted: true } };
  }

  /* ── per-hook overrides ─────────────────────────────────────────────── */

  /** Replaces stored secrets with `has_<field>` booleans. */
  private overridePublic(
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    for (const field of OVERRIDE_SECRETS) {
      row[`has_${field}`] = Boolean(row[field]);
      delete row[field];
    }
    return row;
  }

  async listOverrides(
    query: ListOverridesQueryDto,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    const filters: Record<string, unknown> = { deleted_at: null };
    if (query.hook_id && Types.ObjectId.isValid(query.hook_id)) {
      filters['hook_id'] = query.hook_id;
    }
    if (query.target_key) filters['target_key'] = String(query.target_key);

    const rows = await this.overrideModel
      .find(filters as QueryFilter<HandoffHookOverride>)
      .sort({ created_at: -1 })
      .lean<Array<Record<string, unknown>>>()
      .exec();
    return { data: rows.map((row) => this.overridePublic(row)) };
  }

  /**
   * Upserts the override for one `(hook_id, target_key)` pair.
   *
   * A blank secret is omitted from the `$set` rather than written as `""`, so
   * saving the form without retyping a secret keeps the stored one.
   */
  async upsertOverride(
    body: Record<string, unknown>,
    auth?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    const hookId = body['hook_id'];
    if (!Types.ObjectId.isValid(coerceString(hookId))) {
      throw new ChainError(400, 'hook_id required');
    }
    if (!body['target_key']) throw new ChainError(400, 'target_key required');

    /**
     * [FIX-20260818-HANDOFFSCOPE · plan §8 = T3-3, closes audit C2.4] `hook_id`
     * comes from the request body and this row decides where that OA's handoff
     * traffic is SENT, with which credential. Writing one for another OA
     * redirects its outbound calls to an endpoint the caller chooses — the
     * highest-value write in this module.
     *
     * The module already owns a correct three-tier check; using it keeps one
     * answer per module instead of adding a fourth spelling of the same rule.
     */
    await this.oaAccess.ensureHookAccess(auth, coerceString(hookId));

    const update: Record<string, unknown> = {
      endpoint_url: body['endpoint_url'] || '',
      auth_mode: body['auth_mode'] || '',
      secret_source:
        body['secret_source'] === 'custom_tool' ? 'custom_tool' : 'own',
      enabled: body['enabled'] !== false,
    };
    for (const field of OVERRIDE_SECRETS) {
      const value = body[field];
      if (typeof value === 'string' && value !== '') {
        update[field] = this.crypto.encrypt(value);
      }
    }

    const doc = await this.overrideModel
      .findOneAndUpdate(
        {
          hook_id: hookId,
          // [FIX-20260818-BODYOPERATOR] audit_18_aug M20 — raw here, inside an
          // `upsert: true`, an operator selected a DIFFERENT row and the `$set`
          // overwrote the override it was holding. `coerceString` is already
          // imported and already guards `hook_id` two lines above.
          target_key: coerceString(body['target_key']),
          deleted_at: null,
        } as QueryFilter<HandoffHookOverride>,
        {
          $set: update,
          $setOnInsert: {
            hook_id: hookId,
            target_key: coerceString(body['target_key']),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean<Record<string, unknown>>()
      .exec();

    return { data: this.overridePublic(doc) };
  }

  async deleteOverride(
    id: string,
  ): Promise<{ data: { _id: Types.ObjectId; deleted: boolean } }> {
    this.assertObjectId(id);
    const doc = await this.overrideModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null },
        { $set: { deleted_at: new Date(), enabled: false } },
        { new: true },
      )
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    if (!doc) throw new ChainError(404, 'not found');
    return { data: { _id: doc._id, deleted: true } };
  }

  /* ── run history ────────────────────────────────────────────────────── */

  /**
   * Attaches member display fields to run rows, keyed by `member_user_id`.
   *
   * One batched query against the unique-indexed `line_user_id` (of which
   * `member_user_id` is the mirror), so this is an indexed `$in` rather than a
   * scan of the member collection per row.
   */
  private async attachMembers(rows: LeanRun[]): Promise<LeanRun[]> {
    const ids = [
      ...new Set(rows.map((row) => row.member_user_id).filter(Boolean)),
    ];
    if (!ids.length) return rows;

    const members = await this.memberModel
      .find(
        { line_user_id: { $in: ids as string[] } } as QueryFilter<Member>,
        'member_user_id line_user_id display_name full_name phone_number',
      )
      .lean<
        Array<{
          _id: Types.ObjectId;
          line_user_id?: string;
          display_name?: string;
          full_name?: string;
          phone_number?: string;
        }>
      >()
      .exec();

    const byId = new Map(
      members.map((member) => [String(member.line_user_id), member]),
    );

    return rows.map((row) => {
      const member = byId.get(String(row.member_user_id));
      const snapshot: MemberSnapshot | null = member
        ? {
            // `record_id` is the Member._id — a different value from
            // `line_user_id`, which is the channel-side identifier.
            record_id: String(member._id),
            line_user_id: member.line_user_id || '',
            display_name: member.display_name,
            full_name: member.full_name,
            phone_number: member.phone_number,
          }
        : null;
      return { ...row, member: snapshot };
    });
  }

  async listRuns(query: ListRunsQueryDto): Promise<{
    data: LeanRun[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filters: Record<string, unknown> = {};
    if (String(query.needs_review) === 'true') filters['needs_review'] = true;
    if (query.status) filters['status'] = String(query.status);
    if (query.chain_key) filters['chain_key'] = String(query.chain_key);
    if (query.slip_id && Types.ObjectId.isValid(query.slip_id)) {
      filters['slip_record_id'] = query.slip_id;
    }

    /*
     * [FEAT-20260809-DATERANGE] Optional `created_at` window, backed by the existing
     * `{ created_at: -1 }` index on handoff_chain_runs.
     *
     * WHAT: `from`/`to` are resolved by the shared policy — bare `YYYY-MM-DD` means a
     *       BANGKOK day (admins type local time), and a window wider than MAX_RANGE_DAYS is
     *       clamped to the most recent slice.
     * WHY:  the dashboard defaults this page to today so it stays cheap as the collection
     *       grows. Bangkok parsing is what keeps 00:00–06:59 rows inside "today".
     * SEAMLESS: purely additive — omitting both params yields no filter and the exact
     *       previous result set, so existing callers are unaffected.
     * revert: delete this block; `from`/`to` then become inert query params again.
     */
    const dateRange = resolveLogDateRange(query.from, query.to);
    if (dateRange.filter) filters['created_at'] = dateRange.filter;

    /*
     * Member search matches a name or phone in the member collection, and also
     * treats the raw term as a `member_user_id` — which covers ids that have no
     * member row at all.
     */
    if (query.search) {
      const raw = String(query.search).trim();
      const pattern = new RegExp(escapeRegex(raw), 'i');
      const hits = await this.memberModel
        .find(
          {
            $or: [
              { display_name: pattern },
              { full_name: pattern },
              { phone_number: pattern },
              { member_user_id: pattern },
            ],
          } as QueryFilter<Member>,
          'member_user_id',
        )
        .limit(500)
        .lean<Array<{ member_user_id?: string }>>()
        .exec();
      const ids = hits.map((hit) => hit.member_user_id).filter(Boolean);
      filters['member_user_id'] = { $in: [...new Set([...ids, raw])] };
    }

    // Note the caps here differ from the rest of the module: 100/20, not
    // 200/25. That is legacy's value and the dashboard pages against it.
    const page = Math.max(1, parseInt(String(query.page ?? ''), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(query.limit ?? ''), 10) || 20),
    );

    const [rows, total] = await Promise.all([
      this.chainRunModel
        .find(filters as QueryFilter<HandoffChainRun>)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanRun[]>()
        .exec(),
      this.chainRunModel
        .countDocuments(filters as QueryFilter<HandoffChainRun>)
        .exec(),
    ]);

    // This envelope is flat (`total`/`page`/`limit`), NOT the `pagination`
    // object the target and job lists return. Legacy shape; the dashboard
    // reads it as-is.
    return { data: await this.attachMembers(rows), total, page, limit };
  }

  /**
   * One run with every step's job and result.
   *
   * Steps are assembled from the jobs carrying this `chain_run_id`, joined to
   * their results by `_id` (a result shares its job's id).
   */
  async getRun(id: string): Promise<{ data: Record<string, unknown> }> {
    this.assertObjectId(id);
    let run = await this.chainRunModel
      .findById(id)
      .lean<LeanRun | null>()
      .exec();
    if (!run) throw new ChainError(404, 'not found');

    const attached = await this.attachMembers([run]);
    run = attached[0] as LeanRun;

    const jobs = await this.jobModel
      .find({ chain_run_id: run._id })
      .sort({ created_at: 1 })
      .lean<Array<Record<string, unknown>>>()
      .exec();
    /* [FIX-20260815-STEPNOJOBVISIBLE] read the run's results BY RUN, not by job id.
     *
     * THE BUG: this used to fetch `{_id: {$in: jobIds}}` and then build `steps`
     * from `jobs.map(...)`. Both halves assume every step has a job — but a leg
     * that aborts BEFORE its job is created (`no_matching_statement`,
     * `no_walletpay_endpoint`, `walletpay_tool_invalid`) never gets one. Its result row
     * DOES exist — `[FEAT-20260810-CTXNOJOB]` writes it keyed on
     * (chain_run_id, chain_step, target_key) — but it was filtered out here and
     * the step vanished from the audit page.
     *
     * Owner-reported 15/08/2026 ("log step สองก็ไม่โผล่"), and confirmed against
     * run 6a802de9…3c05: Mongo held step 2 with
     * `reason:'no_matching_statement'` and a populated `final.parsed`, while the
     * page showed step 1 alone. So the data was never missing — this query and
     * the `jobs.map` below were dropping it. เก็บครบแล้ว แต่หน้าอ่านไม่ครบ.
     *
     * Widening the filter to the run also covers the job rows (their `_id` IS
     * the result `_id` and they carry the same `chain_run_id`), so nothing that
     * used to appear can disappear. */
    const results = await this.resultModel
      .find({ chain_run_id: run._id })
      .lean<Array<Record<string, unknown>>>()
      .exec();
    const byId = new Map(
      results.map((result) => [String(result['_id']), result]),
    );

    /* [FIX-20260818-CTXATTEMPT] the key includes the PASS.
     *
     * Without `attempt` this said "step 2 already has a job, so any step-2
     * result row belongs to it" — true only while a run walked each leg once.
     * A resume that stops before its own POST writes a real `not_sent` row for
     * the SAME (step, target) as the first pass's job, and that row was then
     * filtered out here and never reached the page. Caught live on run
     * 6a82e187…a955: Mongo held four rows, the endpoint returned three, and the
     * missing one was exactly the evidence the resume never called walletpay.
     * รอบที่สองมีแถวของตัวเองแล้ว คีย์ต้องรู้จักรอบด้วย ไม่งั้นกรองทิ้ง.
     *
     * Rows written before `attempt` existed read as `0`, the same value a
     * first-pass job maps to, so nothing that used to appear can disappear. */
    const passKey = (row: Record<string, unknown>): string =>
      `${String(row['chain_step'])}:${String(row['target_key'])}:${Number(
        row['attempt'] ?? 0,
      )}`;
    const jobStepKeys = new Set(jobs.map(passKey));
    /* Result rows with no job of their own — the legs that never ran. Ordered
       after the job-backed steps and re-sorted below, so they land in time
       order rather than at the end. */
    const orphanResults = results.filter(
      (result) => !jobStepKeys.has(passKey(result)),
    );

    const jobSteps = jobs.map((job) => {
      const result = byId.get(String(job['_id'])) ?? {};
      const snapshot = job['snapshot'] as Record<string, unknown> | undefined;
      return {
        job_ref: job['job_ref'],
        chain_step: job['chain_step'],
        target_key: job['target_key'],
        triggered_by: job['triggered_by'],
        status: job['status'],
        outcome_code: job['outcome_code'],
        stmt_idx: snapshot?.['stmt_idx'],
        // Which statement fired this step.
        statement_ref:
          (snapshot &&
            (snapshot['statement_ref'] || snapshot['walletpay_ref_id'])) ||
          '',
        context: result['context'] ?? null,
        // Endpoint and body; headers were redacted when the result was stored.
        request: result['request'] ?? null,
        final: result['final'] ?? null,
        /* [FIX-20260818-STEPTIMEORDER] when this leg actually fired. The job row
           is the truth here: it is created at the moment the leg runs, while the
           result row can be upserted again later by `_context`. เวลาจริงอยู่ที่ job. */
        occurred_at: job['created_at'] ?? null,
        /* [FIX-20260818-CTXATTEMPT] which pass of the chain this row belongs to:
           0 = the pass the slip started, >0 = a [ลองใหม่] tap. Absent on rows
           written before the field existed, which reads as the first pass. */
        attempt: Number(job['attempt'] ?? 0),
      };
    });

    /* [FIX-20260815-STEPNOJOBVISIBLE] the legs that never ran, in the same shape.
     * The job-only fields are null BECAUSE there was no job — that absence is
     * the information (`request: null` + `final.received_via: 'not_sent'` means
     * "nothing was ever sent"), so they are not faked. `status` says `skipped`
     * so the page has something to label the row with. */
    const skippedSteps = orphanResults.map((result) => ({
      job_ref: null,
      chain_step: result['chain_step'],
      target_key: result['target_key'],
      triggered_by: null,
      status: 'skipped',
      outcome_code:
        (result['context'] as { reason?: unknown } | null)?.reason ?? null,
      stmt_idx: (result['context'] as { stmt_idx?: unknown } | null)?.stmt_idx,
      statement_ref: '',
      context: result['context'] ?? null,
      request: null,
      final: result['final'] ?? null,
      /* [FIX-20260818-STEPTIMEORDER] a skipped leg has no job, so its own row is
         the only record of when the decision was taken. */
      occurred_at: result['created_at'] ?? null,
      /* [FIX-20260818-CTXATTEMPT] see the job-backed mapper above. */
      attempt: Number(result['attempt'] ?? 0),
    }));

    /* ══════════════════════════════════════════════════════════════════════
     * [FIX-20260818-STEPTIMEORDER] order the steps the way they HAPPENED.
     * ══════════════════════════════════════════════════════════════════════
     * WHAT WAS WRONG: this sorted on `chain_step` alone. That read correctly
     * while a run walked its legs exactly once (1 then 2), but the [ลองใหม่]
     * button makes a run re-enter LEG 1 — so a real run reads
     * step1(auto) → step2(auto) → step1(manual) and the old sort rendered it as
     * step1(auto) → step1(manual) → step2(auto), splicing the second attempt
     * into the first and hiding which pass a row belonged to.
     * Owner-reported 18/08/2026 on run 6a83e019…1131.
     *
     * THE RULE: real time decides; `chain_step` is the FALLBACK, so a row with
     * no usable timestamp (a pre-existing row, a clock that returned rubbish)
     * lands exactly where it used to instead of jumping to the front. Ties fall
     * through to `chain_step` too, and `Array.sort` is stable, so same-step rows
     * keep the `created_at: 1` order they were fetched in.
     * เวลาเป็นตัวตัดสิน · ไม่มีเวลาค่อยกลับไปใช้ step เหมือนเดิม.
     *
     * ⚠️ DISPLAY ONLY. Nothing here reads or writes the money path — it reorders
     * an array that is about to be serialised to the audit page.
     * revert: drop `occurred_at` from both mappers and restore the one-line
     * `chain_step` comparator. */
    const atMs = (v: unknown): number => {
      if (v === null || v === undefined) return NaN;
      const t = new Date(v as string | number | Date).getTime();
      return Number.isFinite(t) ? t : NaN;
    };
    const steps = [...jobSteps, ...skippedSteps].sort((a, b) => {
      const ta = atMs(a.occurred_at);
      const tb = atMs(b.occurred_at);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
        return ta - tb;
      }
      return Number(a.chain_step ?? 0) - Number(b.chain_step ?? 0);
    });

    /*
     * The slip that STARTED this run. A run cannot exist without one, but the
     * slip may have been removed since, so a miss yields null and the page
     * still renders. Read-only `findById` on the `_id` index; masked
     * defensively because a slip carries business data.
     */
    let slip: Record<string, unknown> | null = null;
    if (run['slip_record_id']) {
      const doc = await this.slipModel
        .findById(run['slip_record_id'] as Types.ObjectId)
        .lean<Record<string, unknown> | null>()
        .exec()
        .catch(() => null);
      slip = doc ? maskCredsDeep(doc) : null;
    }

    return { data: { run, steps, slip } };
  }
}
