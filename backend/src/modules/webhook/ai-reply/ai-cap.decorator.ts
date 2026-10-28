/**
 * A reusable call-cap that wraps ANY `AiReplyProvider`.
 *
 * This is the "counter as its own layer" the owner chose (option A, 2026-08-08).
 * It does one job — enforce a hard ceiling on how many replies get generated —
 * and delegates the actual reply to whatever provider it wraps. So the same
 * counting logic sits in front of the scripted mock (local) and the real Gemini
 * provider (dev) without either of them knowing a cap exists.
 *
 * Why the count lives on disk, not in memory: this service restarts many times
 * an hour during development, and a counter that forgets on restart is not a
 * cap. The file survives restarts and is re-read and re-written on every call,
 * so two processes sharing it cannot both believe they are at call N-1.
 *
 * The increment happens BEFORE the inner call, deliberately. If the process dies
 * mid-flight the call is still counted — the failure mode is spending LESS than
 * the limit, never more.
 *
 * Everything the old `CappedGeminiReplyProvider` did to a hardcoded Gemini call,
 * this now does to an injected inner provider. That provider can be swapped
 * without touching the cap, and the cap can be removed (bind the inner directly)
 * without touching the provider.
 */

import { Logger } from '@nestjs/common';

/* [FEAT-20260908-AICAPLEDGER] read/write moved to the door. This lane keeps its
   own entry shape, its own error class and its own log strings — only the
   ledger mechanics are shared. */
import {
  capUsage,
  readCapLedger,
  writeCapLedger,
  type CapLedgerState,
} from '@/modules/ai-vendor';

import {
  type AiReplyProvider,
  type AiReplyRequest,
  type AiReplyResponse,
} from './ai-reply.provider';

/** Thrown when the ceiling is reached. The webhook treats it as "no answer". */
export class AiCapReachedError extends Error {
  constructor(count: number, limit: number, file: string) {
    super(
      `AI call cap reached: ${count}/${limit} calls already made. Refusing to ` +
        `generate another reply. Reset by deleting ${file}, with approval only.`,
    );
    this.name = 'AiCapReachedError';
  }
}

/** This lane records the hook and the question. */
type CapEntry = { at: string; hookId: string | null; question: string };
type CapState = CapLedgerState<CapEntry>;

/**
 * Wraps an inner provider and enforces a persisted call ceiling in front of it.
 *
 * `limit` and `counterFile` are constructor arguments rather than module
 * constants so a test can point at a throwaway file with a limit of 2 and prove
 * the block fires, without touching the real budget ledger. Production wiring
 * passes the real values.
 */
export class AiCapDecorator implements AiReplyProvider {
  private readonly logger = new Logger(AiCapDecorator.name);

  constructor(
    private readonly inner: AiReplyProvider,
    private readonly limit: number,
    private readonly counterFile: string,
    /** Stamps each recorded call. Injectable so tests are deterministic. */
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** The corrupt-file log is THIS lane's wording and stays here. */
  private readonly onCorrupt = (): void => {
    // A corrupt file must NOT read as "0 used" — that silently grants another
    // full budget. Treat it as exhausted and make a human look.
    this.logger.error(
      `[AI-CAP] counter unreadable — treating as EXHAUSTED: ${this.counterFile}`,
    );
  };

  private read(): CapState {
    return readCapLedger<CapEntry>(
      this.counterFile,
      this.limit,
      this.onCorrupt,
    );
  }

  private write(state: CapState): void {
    writeCapLedger<CapEntry>(this.counterFile, state);
  }

  /** Usage without making a call, for reporting. */
  public usage(): { count: number; limit: number; remaining: number } {
    return capUsage<CapEntry>(this.counterFile, this.limit, this.onCorrupt);
  }

  async generate(request: AiReplyRequest): Promise<AiReplyResponse> {
    const state = this.read();
    if (state.count >= this.limit) {
      this.logger.error(`[AI-CAP] REFUSED — ${state.count}/${this.limit} used`);
      throw new AiCapReachedError(state.count, this.limit, this.counterFile);
    }

    // Count BEFORE the call, and persist immediately, so a crash mid-call still
    // consumes the slot rather than granting a free retry.
    const callNumber = state.count + 1;
    state.count = callNumber;
    state.calls.push({
      at: this.now(),
      hookId: request.hookId ?? null,
      question: request.question.slice(0, 80),
    });
    this.write(state);

    this.logger.warn(
      `[AI-CAP] call ${callNumber}/${this.limit} — hook=${request.hookId ?? '(none)'}`,
    );

    const result = await this.inner.generate(request);

    this.logger.warn(
      `[AI-CAP] call ${callNumber}/${this.limit} complete — ${this.limit - callNumber} left`,
    );
    return result;
  }
}
