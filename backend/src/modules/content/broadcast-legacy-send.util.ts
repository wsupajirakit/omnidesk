/**
 * [FEAT-20260823-BCASTSVCSPLIT] The legacy sender, lifted out of the service.
 * ===========================================================================
 * MOVED, NOT CHANGED — every line below is what it was inside
 * `BroadcastsService`, with `deps.hookModel` / `deps.crypto` / `deps.logger`
 * arriving as parameters instead of fields. The behaviour it reproduces is the
 * live sender's, which is exactly why nothing in it may drift.
 *
 * 🔴 WHY IT MOVED AS FUNCTIONS AND NOT AS A SECOND PROVIDER. A new
 *    `@Injectable()` would change how the module is wired and what the
 *    controller receives — behaviour-carrying work that must not ride along
 *    with a feature commit. Parameters carry the same dependencies with no DI
 *    change, no module edit and no controller edit, so the diff is a move and
 *    can be read as one. ย้ายเป็นฟังก์ชัน ⇒ ไม่แตะ DI ไม่แตะ controller.
 *
 * ⚠️ THIS IS STILL THE SENDER THAT RUNS for every job with no `send_kind`. It
 *    substitutes nothing and hard-codes `altText` — see `buildLineMessage`.
 *    ยังเป็นตัวที่วิ่งจริงสำหรับงานที่ไม่ได้ตั้ง send_kind.
 *
 * revert: paste these back into the class as private methods.
 */
import { type Logger } from '@nestjs/common';
import axios from 'axios';
import type { Model } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import type { CryptoService } from '@/infra/crypto';
import type { AuditRequestMetaInput } from '@/modules/audit';
import type { HookDocument } from '@/modules/hooks';
// [FEAT-20260827-WLOGONEDOOR] type-only: this util is passed the door, it does
// not resolve one, so nothing about its DI-free shape changes.
import type { WebhookLogWriter } from '@/modules/system';

import {
  LINE_BROADCAST_TIMEOUT_MS,
  LINE_BROADCAST_URL,
  buildLineMessage,
  buildPayloadSummary,
} from './broadcast-payload.util';
import type { BroadcastMessage } from './schemas/broadcast.schema';

/**
 * What the sender needs from the service. Passed in rather than injected, so
 * this move touched no module and no controller.
 */
export interface LegacySendDeps {
  readonly hookModel: Model<HookDocument>;
  readonly auditLogService: { createAuditLog(row: unknown): Promise<unknown> };
  readonly buildActor: (user: AuthenticatedUser) => unknown;
  /** [FEAT-20260827-WLOGONEDOOR] the single webhook_logs door, replacing the
   *  raw model this file used to receive. */
  readonly wlog: WebhookLogWriter;
  readonly crypto: Pick<CryptoService, 'safeDecrypt'>;
  readonly broadcastModel: Model<Record<string, unknown>>;
  readonly logger: Logger;
}

/**
 * [FIX-20260808-BROADCASTSEND] The real send flow.
 * Ported from legacy `dispatchBroadcast`
 *   (legacy-api dev_sec src/controllers/content/broadcastController.js ~213-326).
 *
 * For EACH hook id on the broadcast (the audience is per-OA — see
 * LINE_BROADCAST_URL):
 *   1. load the Hook; missing → error result, continue (legacy ~216-220).
 *   2. resolve the access token. Legacy did `safeDecrypt(hook.line_key) || env`
 *      (legacy ~221, "Phase 3.1g read-cutover"). OUR schema dual-writes the
 *      token to `access_token` and `line_key`, and every other outbound path in
 *      this repo resolves it as `safeDecrypt(access_token ?? line_key)` with NO
 *      env fallback (webhook.service.ts:768-770, hook-outbound.service.ts:472).
 *      This repo has no process-wide LINE channel, so the env fallback is
 *      unreachable and is deliberately dropped — matching those two call sites.
 *   3. no token → error result, continue (legacy ~223).
 *   4. POST LINE_BROADCAST_URL with `{ messages: [lineMessage] }` and a Bearer
 *      header; on 2xx push a success result + write a success webhook_log row,
 *      on failure write an error webhook_log row + push an error result
 *      (legacy ~227-311). One hook's failure NEVER aborts the others (try/catch
 *      is per-iteration).
 * After the loop: status = allSuccess ? 'sent' : 'failed'; persist status +
 * sent_at via findByIdAndUpdate (legacy ~313-326).
 *
 * NOTE — LINE outbound placement (2026-08-08): the one-place-owns-LINE choice
 * would be `LineApiService.sendLineBroadcast`, but that service lives in
 * WebhookModule and is not exported, and ContentModule does not import it;
 * wiring it would require editing webhook.module.ts, which this workstream must
 * not touch. So this posts via axios directly, following the SAME in-repo
 * precedent that already sends LINE traffic this way
 * (external/hook-outbound.service.ts:472-490) — same Bearer auth + timeout
 * convention. LINE outbound therefore stays consistent with that path.
 */
export async function dispatchBroadcast(
  deps: LegacySendDeps,
  broadcast: {
    _id: unknown;
    message?: BroadcastMessage;
    hook_ids?: unknown[];
    sent_at?: Date | null;
  },
  user: AuthenticatedUser,
  requestMeta?: AuditRequestMetaInput,
): Promise<{
  updated: Record<string, unknown> | null;
  results: Array<Record<string, unknown>>;
}> {
  const lineMessage = buildLineMessage(broadcast.message);
  const payloadSummary = buildPayloadSummary(broadcast._id, broadcast.message);
  const results: Array<Record<string, unknown>> = [];

  for (const hookId of broadcast.hook_ids || []) {
    const hook = await deps.hookModel.findById(hookId as string).lean();
    if (!hook) {
      // legacy ~217: keep the ORIGINAL id (not a hook _id) on this branch.
      results.push({
        hook_id: hookId,
        status: 'error',
        error: 'Hook not found',
      });
      continue;
    }

    const hookRecord = hook as unknown as Record<string, unknown>;
    // See the token-precedence note above — access_token ?? line_key, no env.
    const accessToken =
      deps.crypto.safeDecrypt(
        (hookRecord['access_token'] as string) ??
          (hookRecord['line_key'] as string),
      ) || '';
    if (!accessToken) {
      results.push({
        hook_id: hookRecord['_id'],
        status: 'error',
        error: 'Line access token is required',
      });
      continue;
    }

    try {
      const response = await axios.post(
        LINE_BROADCAST_URL,
        { messages: [lineMessage] },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: LINE_BROADCAST_TIMEOUT_MS,
        },
      );
      logBroadcast(deps, {
        hook_id: hookRecord['_id'],
        hook_alias: hookRecord['alias'],
        group_id: hookRecord['group'] || null,
        status: 'success',
        http_status: response.status,
        payload_summary: payloadSummary,
        response_summary: response.data,
      });
      results.push({
        hook_id: hookRecord['_id'],
        status: 'success',
        http_status: response.status,
      });
    } catch (err) {
      // legacy ~264-296: an error row, then an error result — never a throw,
      // so the loop continues to the next hook. `err.response?.data?.message`
      // is LINE's body; on a transport failure it falls back to `err.message`.
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string } };
        message?: string;
      };
      const errorMessage = axiosErr.response?.data?.message || axiosErr.message;
      logBroadcast(deps, {
        hook_id: hookRecord['_id'],
        hook_alias: hookRecord['alias'],
        group_id: hookRecord['group'] || null,
        status: 'error',
        http_status: axiosErr.response?.status,
        error_message: errorMessage,
        payload_summary: payloadSummary,
        response_summary: axiosErr.response?.data,
      });
      results.push({
        hook_id: hookRecord['_id'],
        status: 'error',
        error: errorMessage,
      });
    }
  }

  // legacy ~313: an empty hook list is NOT all-success — it is 'failed'.
  const allSuccess =
    results.length > 0 && results.every((item) => item.status === 'success');
  const status = allSuccess ? 'sent' : 'failed';
  const updates: Record<string, unknown> = {
    status,
    sent_at: allSuccess ? new Date() : broadcast.sent_at || null,
    updated_by: user.userId,
  };

  const updated = await deps.broadcastModel
    .findByIdAndUpdate(broadcast._id, updates, {
      new: true,
      runValidators: true,
    })
    .lean();

  // [FEAT-20260808-AUDITSITE] writes audit_logs row
  // {parent:'broadcast', action:'send', ref_id, actor, request_meta} —
  // additive only, no schema change. Mirrors the audit legacy writes at the end
  // of dispatchBroadcast (broadcastController.js:311-322). Fire-and-forget.
  void deps.auditLogService
    .createAuditLog({
      ref_id: updated?._id ?? broadcast._id,
      parent: 'broadcast',
      action: 'send',
      actor: deps.buildActor(user),
      request_meta: requestMeta,
    })
    .catch(() => undefined);

  return { updated, results };
}

/**
 * [FIX-20260808-BROADCASTSEND] Fire-and-forget webhook_log row, one per hook.
 * legacy wrote these through `webhookLogService.createLog` with a dangling
 * `.catch` (broadcastController.js ~244-262 / ~270-289), filling the same fixed
 * fields (`channel: 'line_api'`, `action_type: 'send_broadcast'`, method/endpoint).
 * Awaiting is deliberately avoided: a log failure must not fail the send.
 *
 * [FEAT-20260827-WLOGONEDOOR] It used to write the Mongoose model directly, and
 * the reason recorded here was "this repo has no WebhookLogService in
 * ContentModule". That stopped being true: `content.module.ts:112` imports
 * SystemModule, which exports the door this now writes through. The ROW is
 * unchanged — the door forwards verbatim — only the path to Mongo is shared.
 * เหตุผลที่เคยต้องเขียนตรงหมดอายุแล้ว
 */
function logBroadcast(
  deps: LegacySendDeps,
  doc: Record<string, unknown>,
): void {
  void deps.wlog
    .persist({
      channel: 'line_api',
      action_type: 'send_broadcast',
      method: 'POST',
      endpoint: LINE_BROADCAST_URL,
      ...doc,
    })
    .catch((err: Error) =>
      deps.logger.error(`broadcast webhook log create failed: ${err.message}`),
    );
}
