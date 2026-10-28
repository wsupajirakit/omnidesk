/**
 * =====================================================================
 * [FIX-20260808-CHAINPOSTBACK] handoff-chain postback handler.
 * =====================================================================
 *
 * TRANSCRIBED from the legacy chain postback router. Source of truth:
 *   legacy-api/src/services/handoff/chain/postback.js · `handlePostback`
 *   (call site: webhookController.js:2521-2523, guarded by `handoffChainCfg.chains`).
 *
 * WHAT LEGACY DOES, one for one:
 *   1. `if (!cfg.chains) return false;`                  → chains off, untouched.
 *   2. data must be a string starting with "hoc:"        → else return false (not ours).
 *   3. `parts[1] !== "resume"` → `return true;`          → ours but unknown → swallow, no-op.
 *   4. otherwise parse runId + nextIdx, call `resume.resume(...)`, and on the
 *      non-ok terminal paths send a chain reply. Always `return true;`.
 *
 * ⚠️ BLOCKING DEPENDENCY — THE CHAIN RUNTIME IS NOT PORTED.
 *    Legacy step 4 reaches into `chain/resume.js` (→ slipLock, gate, runner,
 *    statementSelector) and `chain/reply.js` (→ linePush). This repo's handoff
 *    module (`src/modules/handoff/`) is the CRUD/admin half only — chains,
 *    overrides, run listing. There is NO `resume`, `sendChainReply`,
 *    `enqueueStep`, `slipLock`, or `selectStatement` here. So step 4 CANNOT be
 *    reproduced faithfully yet without porting the whole chain execution engine,
 *    which this task explicitly forbids.
 *
 *    ต้นทาง runtime ของ chain ยังไม่ถูก port มา — helper นี้จึงทำเฉพาะส่วนที่
 *    "บริสุทธิ์และปลอดภัย" (guards + parse + swallow) แล้วส่งงาน runtime ผ่าน deps.
 *
 * HOW THIS HELPER STAYS CORRECT DESPITE THAT:
 *    The runtime effects are taken as INJECTED DEPS (`resume`, `sendChainReply`),
 *    same injected-deps style as `assist-notification.ts`. The helper NEVER
 *    imports a service. When those deps are absent (the current, un-ported
 *    state) the helper still matches legacy's OBSERVABLE behaviour for every
 *    branch that does not need the runtime:
 *      · chains off / non-"hoc:" payload → handled=false (falls through, seamless).
 *      · "hoc:" but not "resume"         → handled=true, no-op (legacy swallow).
 *      · "hoc:resume:*" with NO runtime  → handled=true, no-op + a warn log
 *        (legacy would have resumed; without the engine the safe, seamless
 *        choice is to consume the postback so it does not leak into the text
 *        pipeline — the exact reason legacy returns true for its own data).
 *    Once the chain runtime is ported, pass `resume`/`sendChainReply` in `deps`
 *    and step 4 executes byte-for-byte as legacy.
 */

import { Logger } from '@nestjs/common';

const logger = new Logger('HandoffChainPostback');

/** legacy: `event.postback.data` prefix that marks a chain-owned postback. */
const CHAIN_POSTBACK_PREFIX = 'hoc:';

/**
 * The minimal LINE event shape this handler reads. Kept structural (not imported
 * from webhook.service) so the helper has no back-dependency on the caller.
 */
export interface HandoffPostbackEvent {
  type?: string;
  replyToken?: string;
  postback?: { data?: string };
}

/**
 * legacy: the `{ ok, reason, run }` envelope returned by `resume.resume(...)`.
 * `run` stays `unknown` — the helper only forwards it to `sendChainReply`.
 */
export interface ChainResumeResult {
  ok: boolean;
  reason?: string;
  run?: unknown;
}

/** legacy: `reply.sendChainReply(run, opts)` terminal kinds used by postback. */
export type ChainReplyKind = 'success' | 'contact_agent';

/**
 * Injected collaborators — the injected-deps style of `assist-notification.ts`.
 * All optional: with none supplied the helper reproduces legacy's guard/swallow
 * branches and no-ops the runtime branch (see the file header for why that is
 * the correct seamless behaviour while the chain runtime is un-ported).
 */
export interface HandoffPostbackDeps {
  /**
   * legacy `handoffChainCfg.chains`. Gate the whole feature. Defaults to false
   * — matching a repo where `HANDOFF_CHAINS` config is not yet resolved, so the
   * postback branch stays inert exactly as legacy is with chains off.
   */
  chainsEnabled?: boolean;
  /** legacy `resume.resume(runId, nextIdx, replyToken)`. Absent = runtime un-ported. */
  resume?: (
    runId: string,
    nextIdx: number,
    replyToken: string,
  ) => Promise<ChainResumeResult>;
  /** legacy `reply.sendChainReply(run, { kind, replyToken })`. */
  sendChainReply?: (
    run: unknown,
    opts: { kind: ChainReplyKind; replyToken: string },
  ) => Promise<unknown>;
}

/**
 * legacy `handoffChainPostback.handlePostback(event)` → boolean.
 *
 * @returns `{ handled: true }` when this WAS a chain postback and was consumed
 *   (caller must stop the normal flow — legacy `return res.send("OK")`).
 *   `{ handled: false }` when it is not ours and must fall through untouched.
 */
export async function handleHandoffChainPostback(
  event: HandoffPostbackEvent | null | undefined,
  deps: HandoffPostbackDeps = {},
): Promise<{ handled: boolean }> {
  // legacy:21 — `if (!cfg.chains) return false;`. Chains off → nothing is ours.
  if (!deps.chainsEnabled) return { handled: false };

  // The one-liner wire also guards `event.type === 'postback'`, but guard here
  // too so the helper is correct when called directly (tests, future callers).
  if (!event || event.type !== 'postback') return { handled: false };

  // legacy:22-23 — data must be a string starting with "hoc:", else untouched.
  const data = event.postback?.data;
  if (typeof data !== 'string' || !data.startsWith(CHAIN_POSTBACK_PREFIX)) {
    return { handled: false }; // not ours → seamless fall-through.
  }

  const parts = data.split(':');

  // legacy:26 — ours but an unknown sub-action → swallow, do nothing, return true.
  if (parts[1] !== 'resume') return { handled: true };

  // legacy:28-30 — parse the resume target off the postback data.
  const runId = parts[2] ?? '';
  const nextIdx = parseInt(parts[3] ?? '', 10) || 0;
  const replyToken = event.replyToken ?? '';

  // BLOCKING DEP: legacy step 4 (resume + terminal reply) needs the chain runtime.
  // Without `resume` injected, consume the postback (it is ours) but no-op the
  // runtime. Returning handled=true here mirrors legacy — it always returns true
  // for its own "hoc:resume" data — and keeps the payload out of the text
  // pipeline. เมื่อ port runtime แล้วให้ส่ง deps.resume เข้ามา แล้ว branch นี้จะทำงานเต็ม.
  if (!deps.resume) {
    logger.warn(
      `[CHAINPOSTBACK] Consumed chain resume postback (runId=${runId}, nextIdx=${nextIdx}) ` +
        'but the chain runtime is not ported — no resume performed. ' +
        '(runtime chain/resume.js ยังไม่ถูก port มา งานนี้จึงถูกกลืนไว้เฉย ๆ)',
    );
    return { handled: true };
  }

  // legacy:32-42 — resume the run, and on the non-ok terminal paths reply now
  // (we own the fresh reply token here). On ok the runner replies on its own.
  const r = await deps.resume(runId, nextIdx, replyToken);
  if (!r.ok && r.run && deps.sendChainReply) {
    if (r.reason === 'slip_locked') {
      // legacy:37 — already completed earlier; show the success terminal.
      await deps.sendChainReply(r.run, { kind: 'success', replyToken });
    } else if (r.reason === 'exhausted') {
      // legacy:39 — statements exhausted; route to the contact-agent terminal.
      await deps.sendChainReply(r.run, { kind: 'contact_agent', replyToken });
    }
  }
  return { handled: true };
}
// ==== [FIX-20260808-CHAINPOSTBACK] END
