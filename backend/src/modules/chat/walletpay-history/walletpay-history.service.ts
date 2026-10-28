/**
 * ==== [FEAT-20260816-WALLETPAYCARD] "ผลตรวจ WalletPay" — read-only history feed ====
 *
 * WHAT: the rows behind the ticket panel's WalletPay card — every chain STEP 2 leg
 * recorded for ONE member, newest first, paginated.
 *
 * WHY A SEPARATE SERVICE (owner 16/08: "ห้ามแก้ไข handoff log เดิม ทำเส้นใหม่"):
 * `handoff-chain.*` is the operator-facing chain console and every route there
 * requires `handoff.manage`. A support agent working a ticket has
 * `ticket.manage`, not that. Reusing those routes would mean either widening a
 * permission (bad) or handing agents a console they should not have. This file
 * READS the same collection and writes nothing; the chain console is untouched.
 *
 * ⚠️ STAND-ALONE BY CONSTRUCTION (owner: "อย่าให้พังเด็ดขาด stand alone"):
 *   · read-only — no write, no lock, no money decision reads this
 *   · it only ever touches `handoff_results`; a failure here cannot affect the
 *     payment runner, the chain console, or the rest of the panel
 *   · the controller catches everything and answers an EMPTY page, so a broken
 *     feed degrades to "no rows" instead of breaking the ticket screen
 *
 * SCOPE: `chain_step === 2` and `member_user_id === <the member>`. NOT filtered
 * by `target_key` on purpose — today step 2 is always `pay_walletpay`, and if a
 * second step-2 target ever exists the card must show it rather than hide it
 * (the owner asked for EVERY kind of step-2 record for this member).
 *
 * MASKING happens HERE, before the payload leaves the process — see
 * `walletpay-mask.util.ts`, which is the ONLY place the rules live. The client is a
 * pure renderer for this feature and never un-blurs anything.
 *
 * SCALE: `{member_user_id: 1, chain_step: 1, _id: -1}` is the ideal index and
 * does NOT exist yet — the collection is small (hundreds of rows) so the query
 * is a short scan today. Add that index as an owner-approved migration before
 * this grows past ~1e5 rows.
 *
 * revert: delete this folder + its two lines in `chat.module.ts`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

/* Leaf-file import, NOT the handoff barrel — handoff imports chat, so the barrel
   would close a module cycle (see the note in chat.module.ts). */
import { HandoffChainRun } from '@/modules/handoff/schemas/handoff-chain-run.schema';
import { HandoffResult } from '@/modules/handoff/schemas/handoff-result.schema';

import { blurMiddle, maskIdsDeep } from './walletpay-mask.util';

/** One row as the card renders it. Every id-shaped value is already masked. */
export interface WalletpayHistoryRow {
  id: string;
  at: string | null;
  /** 'TRUE' | 'FALSE' | 'TIMEOUT' — the leg's recorded outcome, verbatim. */
  outcome: string;
  /** business answer (`no_match`, `walletpay_invalid_ref`, …) or '' */
  reason: string;
  /** raised only when the leg needed a human */
  review_reason: string;
  http_status: number | null;
  /** refId — NOT masked (see walletpay-mask.util.ts): an admin pastes it into
   *  walletpay's own console. */
  ref: string;
  /**
   * [FEAT-20260816-WALLETPAYSTMT] the deposit row this leg was fired against —
   * `statement_id` (a ULID like `01KY4R7EQ…`) and its amount, resolved from the
   * run's own snapshot. Empty string / null when the run stored no statement.
   */
  statement_id: string;
  statement_amount: number | null;
  /**
   * [FEAT-20260816-WALLETPAYTRACE] where this row came from in the handoff log, so
   * an operator can find the same event in the chain console without guessing:
   *   · `run_id`  — `handoff_chain_runs._id` (one run per slip)
   *   · `job_ref` — the human-readable job reference (`hj_c_…`) shared with
   *                 `handoff_jobs`; this is the value people quote to each other
   * `id` above is the `handoff_results._id` of THIS leg. All three are shown in
   * the ⓘ modal header, blurred ~50% in the MIDDLE so both ends stay comparable
   * by eye while the full value never leaves this process.
   */
  run_id: string;
  job_ref: string;
  target: string;
  /** full request + response, masked — what the ⓘ modal shows */
  raw: unknown;
}

export interface WalletpayHistoryPage {
  rows: WalletpayHistoryRow[];
  page: number;
  limit: number;
  total: number;
  has_next: boolean;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

@Injectable()
export class WalletpayHistoryService {
  // No logger here on purpose: the controller owns the one fail-soft log line,
  // so a read-only query cannot add noise to the money-path log stream.
  constructor(
    @InjectModel(HandoffResult.name)
    private readonly resultModel: Model<HandoffResult>,
    /* [FEAT-20260816-WALLETPAYSTMT] read-only: the run row carries the statement
       SNAPSHOT taken when the leg ran, which is where `statement_id` lives. */
    @InjectModel(HandoffChainRun.name)
    private readonly runModel: Model<HandoffChainRun>,
  ) {}

  /**
   * @param memberUserId the LINE user id stored on the result rows
   * @param page 1-based; anything unusable falls back to 1
   * @param limit clamped to 1..MAX_LIMIT
   */
  async list(
    memberUserId: string,
    page = 1,
    limit = DEFAULT_LIMIT,
  ): Promise<WalletpayHistoryPage> {
    const safeLimit = Math.min(
      Math.max(Math.trunc(Number(limit)) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const safePage = Math.max(Math.trunc(Number(page)) || 1, 1);
    const empty: WalletpayHistoryPage = {
      rows: [],
      page: safePage,
      limit: safeLimit,
      total: 0,
      has_next: false,
    };
    if (!memberUserId) return empty;

    const filter = { chain_step: 2, member_user_id: memberUserId };
    const [total, docs] = await Promise.all([
      this.resultModel.countDocuments(filter).exec(),
      this.resultModel
        .find(filter)
        .sort({ _id: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean()
        .exec(),
    ]);

    /* [FEAT-20260816-WALLETPAYSTMT] ONE extra query for the whole page (never one
       per row): the runs behind these legs, fetched by id, projected down to the
       statement snapshot alone. `refId → statement_id` is resolved from that.
       Read-only and failure-tolerant: if this query throws, the page still
       renders without the statement column (see the catch below). */
    const runIds = [
      ...new Set(
        (docs as unknown as Record<string, unknown>[])
          .map((d) => String(d['chain_run_id'] ?? ''))
          .filter(Boolean),
      ),
    ];
    const stmtByRun = await this.statementsByRun(runIds);

    const rows = (docs as unknown as Record<string, unknown>[]).map((d) =>
      this.toRow(d, stmtByRun),
    );
    return {
      rows,
      page: safePage,
      limit: safeLimit,
      total,
      has_next: safePage * safeLimit < total,
    };
  }

  /**
   * [FEAT-20260816-WALLETPAYSTMT] statement snapshots for a page of runs, keyed by
   * run id. ONE query, projected to the snapshot only.
   *
   * The snapshot is what the run ACTUALLY worked from, so a statement the
   * upstream has since changed or dropped is still reported as it was at the
   * time — which is the point of showing it next to a leg.
   *
   * Never throws: on any failure it returns an empty map and the rows simply
   * carry no statement id (the card degrades, the page still renders).
   */
  private async statementsByRun(
    runIds: string[],
  ): Promise<Map<string, Record<string, unknown>[]>> {
    const out = new Map<string, Record<string, unknown>[]>();
    if (!runIds.length) return out;
    try {
      const runs = (await this.runModel
        .find({ _id: { $in: runIds } }, { raw_transaction: 1 })
        .lean()
        .exec()) as unknown as Record<string, unknown>[];
      for (const r of runs) {
        const raw = (r['raw_transaction'] ?? {}) as Record<string, unknown>;
        const list = Array.isArray(raw['statement'])
          ? (raw['statement'] as Record<string, unknown>[])
          : [];
        out.set(String(r['_id']), list);
      }
    } catch {
      /* degraded on purpose — see the doc above */
    }
    return out;
  }

  /**
   * [FEAT-20260816-WALLETPAYSTMT] Which statement did THIS leg fire against?
   *
   * MATCH ORDER (first hit wins):
   *   1. by refId — the leg's `statement_ref` equals the statement's
   *      `info.trade_no` / `info.response.data.id` / `ref_id`. This is exact:
   *      the refId is literally what was POSTed to walletpay for that row.
   *   2. by `stmt_idx` — the cursor position the walk was on. Used only when the
   *      refId is missing (older rows written before it was captured).
   * No match ⇒ blanks. Never guesses "probably the first one".
   * จับคู่ด้วย refId ก่อนเสมอ ตำแหน่ง cursor เป็นแผนสำรอง.
   */
  private pickStatement(
    stmts: Record<string, unknown>[],
    refId: string,
    stmtIdx: unknown,
  ): Record<string, unknown> | null {
    if (!stmts.length) return null;
    if (refId) {
      const hit = stmts.find((s) => {
        const info = (s['info'] ?? {}) as Record<string, unknown>;
        const resp = ((info['response'] ?? {}) as Record<string, unknown>)[
          'data'
        ] as Record<string, unknown> | undefined;
        return (
          info['trade_no'] === refId ||
          s['ref_id'] === refId ||
          resp?.['id'] === refId
        );
      });
      if (hit) return hit;
    }
    const i = Number(stmtIdx);
    if (Number.isInteger(i) && i >= 0 && i < stmts.length) {
      return stmts[i] ?? null;
    }
    /* [FIX-20260816-STMTSINGLE] real rows carry `stmt_idx: 1` against a snapshot
       holding ONE statement (the cursor had already advanced past it when the
       leg was written). With a single candidate there is nothing to confuse:
       report it. Two or more ⇒ still refuse to guess. */
    return stmts.length === 1 ? (stmts[0] ?? null) : null;
  }

  /**
   * [FIX-20260816-REFIDSOURCE] WHERE THE refId ACTUALLY IS on a stored row.
   *
   * The first version read `context.statement_ref` — which the runner writes as
   * an anchor. Checked against real rows (16/08): on live documents that key is
   * **undefined**; the value that was really POSTed lives in `request.body.refId`
   * and again in the response envelope. Reading only the anchor meant every row
   * fell through to the index fallback, and the statement never resolved.
   *
   * Source order, most authoritative first — the request body IS what went out:
   *   1. `request.body.refId`     — what we sent
   *   2. `final.raw.refId`        — what walletpay echoed back
   *   3. `context.statement_ref`  — the runner's anchor (newer rows / other targets)
   */
  private refIdOf(
    doc: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ): string {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const req = (doc['request'] ?? {}) as Record<string, unknown>;
    const body = (req['body'] ?? {}) as Record<string, unknown>;
    const raw = ((doc['final'] ?? {}) as Record<string, unknown>)['raw'] as
      Record<string, unknown> | undefined;
    return (
      str(body['refId']) || str(raw?.['refId']) || str(ctx['statement_ref'])
    );
  }

  /** [FIX-20260816-BADDATE] ISO string, or null for anything unparseable. */
  private isoOrNull(value: unknown): string | null {
    if (!value) return null;
    const d = new Date(value as string | number | Date);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  /** Shape one stored result into a card row. Defensive: a row with an
   *  unexpected shape yields blanks rather than throwing. */
  private toRow(
    doc: Record<string, unknown>,
    stmtByRun: Map<string, Record<string, unknown>[]>,
  ): WalletpayHistoryRow {
    const ctx = (doc['context'] ?? {}) as Record<string, unknown>;
    const s = (v: unknown): string => (typeof v === 'string' ? v : '');
    const httpRaw = (doc['final'] as Record<string, unknown> | undefined)?.[
      'http_status'
    ];
    const runId = String(doc['chain_run_id'] ?? '');
    const refId = this.refIdOf(doc, ctx);
    const stmt = this.pickStatement(
      stmtByRun.get(runId) ?? [],
      refId,
      ctx['stmt_idx'],
    );
    const stmtAmount = Number(stmt?.['amount']);
    return {
      // [FIX-20260816-TRACEBLUR] the result id is a trace handle too — blurred
      // in the response, never sent whole.
      id: blurMiddle(String(doc['_id'] ?? '')),
      // [FIX-20260816-BADDATE] caught by the shape spec: a row whose `created_at`
      // is not a real date made `toISOString()` throw and took the whole page
      // with it. An unreadable timestamp is now simply `null`.
      at: this.isoOrNull(doc['created_at']),
      outcome: s(ctx['outcome']),
      reason: s(ctx['reason']),
      review_reason: s(ctx['review_reason']),
      http_status: typeof httpRaw === 'number' ? httpRaw : null,
      // [FIX-20260816-REFIDCLEAR] refId stays readable — an admin pastes it into
      // walletpay's own console. maskIdsDeep leaves UUIDs alone by design.
      ref: maskIdsDeep(refId),
      statement_id: s(stmt?.['statement_id']),
      statement_amount: Number.isFinite(stmtAmount) ? stmtAmount : null,
      /* [FIX-20260816-TRACEBLUR] trace handles leave the process ALREADY blurred
         (~50%, middle). Blurring these on the client would still ship the real
         value over the wire and into the browser's network tab. Both ends
         survive so an operator can still match a row against the handoff log
         by eye. */
      run_id: blurMiddle(runId),
      job_ref: blurMiddle(s(doc['job_ref'])),
      target: s(doc['target_key']),
      raw: maskIdsDeep({
        request: doc['request'] ?? null,
        final: doc['final'] ?? null,
        context: ctx,
      }),
    };
  }
}
