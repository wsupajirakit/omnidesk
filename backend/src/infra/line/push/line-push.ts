import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';

import {
  LINE_BROADCAST_URL,
  LINE_DEFAULT_TIMEOUT_MS,
  LINE_LOADING_URL,
  LINE_MULTICAST_URL,
  LINE_NARROWCAST_URL,
  LINE_PUSH_URL,
  LINE_REPLY_URL,
} from '../line-endpoints';
import { describeLineFailure, lineRequestIdOf } from './line-push-error';
import type {
  LineSendKind,
  LineSendRequest,
  LineSendResult,
} from './line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHCORE] the ONE sender — Phase 1, standalone ====
 *
 * The central, channel-neutral LINE delivery core. NOT WIRED to any caller in
 * this phase: `LineModule` is not imported by `app.module.ts`, so the running
 * system never loads this file until a Phase-3 migration deliberately plugs a
 * candidate in. ตัวนี้ยังไม่มีใครเรียก — สร้างรอไว้ตาม design ที่อนุมัติ 2026-08-20.
 *
 * DESIGN RULES (pinned one-for-one by z-test/unit/line-push-core.spec.ts):
 *  · knows nobody — token arrives as a string; no hook/Mongo/crypto imports
 *    (also lint-enforced: infra must not import modules)
 *  · one wire style: JSON + Bearer + one default timeout
 *  · X-Line-Retry-Key (idempotency, LINE docs "Retry failed API requests"):
 *    auto-UUID on push/multicast/broadcast, NEVER on reply/loading
 *  · NO retry by default — parity with every existing call site. Retry is
 *    opt-in, push-family only, fires on 5xx/transport only, keeps the SAME
 *    key each attempt; 409 = an earlier attempt won = success; 4xx/429 stop.
 *  · misuse throws BEFORE the network; runtime failure NEVER throws from
 *    send() — it returns {ok:false} with the raw axios error untouched.
 *  · exactly one onAudit event per call (request id, endpoint, status,
 *    duration — the fields LINE's dev guidelines require to be logged).
 *
 * ── HOW TO ADD A NEW PIPE (read this BEFORE wiring anything new) ──────────
 * Owner-mandated guide (2026-08-20). Three distinct cases — pick the right one:
 *
 * 1) NEW CALLER / CANDIDATE (most common — "my feature wants to send LINE"):
 *    · add ONE pure builder `push/adapters/build-payload.<candidate>.ts`
 *      (domain input → LineMessage[]; declare its input type LOCALLY — this
 *      folder must never import from src/modules, lint enforces it)
 *    · export it from `../index.ts` (the barrel is the only door)
 *    · pin it in `z-test/unit/line-push-adapters.spec.ts` with the source
 *      file:line named per expectation, red-first + one mutation
 *    · in YOUR feature module: import `LineModule` and inject
 *      `LinePushDispatcher` — the wrapper. It lets a real queue slot in later
 *      without touching you (see push/queue/line-push-dispatcher.ts).
 *    · resolve the hook token yourself (safeDecrypt stays on YOUR side) and
 *      map the onAudit event onto webhook_logs yourself. The core stays blind.
 *
 * 2) NEW SEND KIND (a new LINE endpoint, e.g. narrowcast):
 *    · URL → `../line-endpoints.ts` · extend `LineSendKind` union
 *    · add its entry in KIND_URL + a case in buildBody() (target validation)
 *    · decide idempotency: add to RETRY_KEY_KINDS ONLY if LINE's retry-key
 *      doc lists the endpoint · pin the wire shape in line-push-core.spec.ts
 *
 * 3) NEW CHANNEL (not LINE at all — telegram/facebook/...):
 *    · sibling folder `src/infra/<channel>/` with its own module. Do NOT
 *      widen this one; "line" in the path is a promise about what it speaks.
 *
 * Never: import this from src/modules DIRECTLY per-file (go through the
 * barrel), resolve tokens inside the core, or add a business branch here —
 * dedupe/suppress/ladders belong to callers. ตัวกลางต้องโง่เรื่อง business เสมอ.
 *
 * revert: delete `src/infra/line/` entirely — until Phase 3 lands, nothing
 *         outside this folder imports it and dist merely carries dead code.
 */

// Keyed by the FULL kind union — under noUncheckedIndexedAccess this is what
// keeps `KIND_URL[req.kind]` a plain `string`, not `string | undefined`.
const KIND_URL: Record<LineSendKind, string> = {
  reply: LINE_REPLY_URL,
  push: LINE_PUSH_URL,
  multicast: LINE_MULTICAST_URL,
  broadcast: LINE_BROADCAST_URL,
  narrowcast: LINE_NARROWCAST_URL,
  loading: LINE_LOADING_URL,
};

/** Kinds that support the idempotency header (and therefore retry). */
const RETRY_KEY_KINDS = new Set([
  'push',
  'multicast',
  'broadcast',
  'narrowcast',
]);

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

@Injectable()
export class LinePushService {
  private readonly logger = new Logger(LinePushService.name);

  /**
   * Send one request to LINE. Never rejects for runtime failures — inspect
   * `result.ok`. Throws ONLY on programmer misuse (see buildBody's guards).
   */
  async send(req: LineSendRequest): Promise<LineSendResult> {
    const startedAt = Date.now();
    const body = this.buildBody(req); // throws on misuse, before any I/O
    const url = KIND_URL[req.kind];
    const retryKeyed = RETRY_KEY_KINDS.has(req.kind);
    const retryKey = retryKeyed ? (req.retryKey ?? randomUUID()) : undefined;
    // Default: ONE attempt. Clamped to [1, 5] — 0/NaN would skip the loop and
    // leak `undefined` out of send(); Infinity/huge values would hot-loop a
    // synchronous send against a dead endpoint (and 5 doubled backoffs is
    // already base×16 — anything longer belongs in a queue, not this call).
    // Both bounds found by review 2026-08-20, red-first.
    const maxAttempts = Math.min(
      5,
      Math.max(1, Math.floor(req.retry?.maxAttempts ?? 1) || 1),
    );
    const baseDelayMs = req.retry?.baseDelayMs ?? 500;

    // A hook with no token is normal data here (line-api.service.ts:31-37
    // documents the `Bearer undefined` legacy) — report, don't throw, and
    // spend no network call on a request that can only 401.
    if (!req.token) {
      // No retryKey in this result: no call was made, so reporting a key as
      // "sent" would put a phantom idempotency key into the caller's audit row.
      return this.finish(req, {
        ok: false,
        status: 0,
        attempts: 0,
        durationMs: Date.now() - startedAt,
        reason: 'missing channel access token — no call made',
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.token}`,
    };
    if (retryKey) headers['X-Line-Retry-Key'] = retryKey;
    const timeout = req.timeoutMs ?? LINE_DEFAULT_TIMEOUT_MS;

    let attempts = 0;
    let result: LineSendResult | undefined;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const res: AxiosResponse<unknown> = await axios.post(url, body, {
          headers,
          timeout,
        });
        result = {
          ok: true,
          status: res.status,
          lineRequestId: lineRequestIdOf(
            res.headers as Record<string, string | undefined>,
          ),
          retryKey,
          attempts,
          durationMs: Date.now() - startedAt,
          data: res.data,
        };
        break;
      } catch (err) {
        const failure = describeLineFailure(err);
        // 409 = an earlier request with this retry key was ALREADY accepted
        // (LINE retry docs) — the message is delivered; success, stop here.
        // Gated on retryKeyed: a reply/loading call sent NO key, so its 409
        // cannot mean "delivered" and must fall through as a plain failure.
        if (retryKeyed && failure.status === 409) {
          result = {
            ok: true,
            status: 409,
            lineRequestId: failure.lineRequestId,
            retryKey,
            attempts,
            durationMs: Date.now() - startedAt,
            data: failure.data,
            raw: err,
          };
          break;
        }
        result = {
          ok: false,
          status: failure.status,
          lineRequestId: failure.lineRequestId,
          retryKey,
          attempts,
          durationMs: Date.now() - startedAt,
          reason: failure.reason,
          data: failure.data,
          raw: err,
        };
        // Retry ONLY on 5xx/transport (LINE docs: 4xx will not resolve; 429
        // means throttled — retrying immediately makes the throttle worse).
        const retryable = failure.status === 0 || failure.status >= 500;
        if (!retryable || attempts >= maxAttempts) break;
        await sleep(baseDelayMs * 2 ** (attempts - 1));
      }
    }

    // `result` is always set: the loop runs at least once (maxAttempts >= 1).
    return this.finish(req, result as LineSendResult);
  }

  /** send(), but a not-ok result rethrows the RAW error (shape preserved). */
  async sendOrThrow(req: LineSendRequest): Promise<LineSendResult> {
    const result = await this.send(req);
    if (!result.ok) {
      if (result.raw instanceof Error) throw result.raw;
      throw new Error(result.reason ?? `LINE ${req.kind} failed`);
    }
    return result;
  }

  /** Emit the single audit event; a broken sink must never break delivery. */
  private finish(req: LineSendRequest, result: LineSendResult): LineSendResult {
    if (req.onAudit) {
      try {
        req.onAudit({
          kind: req.kind,
          endpoint: KIND_URL[req.kind],
          method: 'POST',
          ok: result.ok,
          status: result.status,
          lineRequestId: result.lineRequestId,
          retryKey: result.retryKey,
          attempts: result.attempts,
          durationMs: result.durationMs,
          reason: result.reason,
        });
      } catch (err) {
        this.logger.warn(
          `onAudit sink threw — ignored: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return result;
  }

  /**
   * Validate the kind/target/messages combination and build the wire body.
   * Every rejection here is PROGRAMMER error — loud, before any network call
   * (same stance as line-send-adapter.ts:119-134's batch guard).
   */
  private buildBody(req: LineSendRequest): Record<string, unknown> {
    if (req.retry && !RETRY_KEY_KINDS.has(req.kind)) {
      throw new Error(
        `LinePushService: retry is not allowed on kind "${req.kind}" — a ${req.kind === 'reply' ? 'reply token is single-use' : 'loading call is cosmetic'}`,
      );
    }
    if (req.kind === 'loading') {
      if (typeof req.to !== 'string' || !req.to) {
        throw new Error('LinePushService: loading needs `to` (the chatId)');
      }
      return { chatId: req.to, loadingSeconds: req.loadingSeconds ?? 20 };
    }

    // LINE hard limit: 1-5 message objects per request, on every message kind.
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new Error('LinePushService: messages must carry 1-5 objects');
    }
    if (req.messages.length > 5) {
      throw new Error(
        `LinePushService: ${req.messages.length} messages exceed LINE's 5-per-request limit`,
      );
    }

    switch (req.kind) {
      case 'reply':
        if (typeof req.replyToken !== 'string' || !req.replyToken) {
          throw new Error('LinePushService: reply needs `replyToken`');
        }
        return { replyToken: req.replyToken, messages: req.messages };
      case 'push':
        if (typeof req.to !== 'string' || !req.to) {
          throw new Error(
            'LinePushService: push needs `to` (one recipient id)',
          );
        }
        return { to: req.to, messages: req.messages };
      case 'multicast':
        if (!Array.isArray(req.to) || req.to.length === 0) {
          throw new Error(
            'LinePushService: multicast needs `to` (a non-empty id array)',
          );
        }
        return { to: req.to, messages: req.messages };
      case 'broadcast':
        return { messages: req.messages };
      case 'narrowcast':
        // recipient/filter/limit ride through untouched (see the types note).
        return { messages: req.messages, ...(req.narrowcast ?? {}) };
      default:
        throw new Error(
          `LinePushService: unsupported kind "${String(req.kind)}"`,
        );
    }
  }
}
