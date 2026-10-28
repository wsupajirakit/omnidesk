/**
 * [FIX-20260808-ASSISTSUMMARYFIRE] A reusable call-cap for the assist-summary
 * seam — the parallel of `ai-cap.decorator.ts`, wrapping a provider with
 * `summarise` instead of `generate`.
 *
 * Option (a) from the plan: a tiny parallel decorator rather than a generalised
 * one, so the existing reply cap (`AiCapDecorator`) stays untouched. Everything
 * else mirrors it exactly — same persisted-counter-file pattern, same
 * count-BEFORE-the-call ordering (a crash mid-flight spends the slot, so the
 * failure mode is spending LESS than the limit, never more), same
 * corrupt-file-reads-as-exhausted safety.
 *
 * The summary seam fires under the SAME AI_PROVIDER × AI_CAP switch as the reply
 * seam; when AI_CAP=on this layer sits in front of the real
 * `RealAssistSummaryProvider`, exactly as `AiCapDecorator` sits in front of
 * `GeminiReplyProvider`.
 */

import { Logger } from '@nestjs/common';

/* [FEAT-20260908-AICAPLEDGER] ledger mechanics from the door; this lane keeps
   its own entry shape, error class and log wording. */
import {
  capUsage,
  readCapLedger,
  writeCapLedger,
  type CapLedgerState,
} from '@/modules/ai-vendor';

import {
  type AssistSummaryProvider,
  type AssistSummaryRequest,
  type AssistSummaryResponse,
} from '../ai-vendors/gemini/assist-summary.provider';

/** Thrown when the ceiling is reached. The assist flow treats it as "no summary". */
export class AssistSummaryCapReachedError extends Error {
  constructor(count: number, limit: number, file: string) {
    super(
      `Assist-summary call cap reached: ${count}/${limit} calls already made. ` +
        `Refusing to summarise again. Reset by deleting ${file}, with approval only.`,
    );
    this.name = 'AssistSummaryCapReachedError';
  }
}

/** This lane records only the question — no hook id reaches it. */
type CapEntry = { at: string; question: string };
type CapState = CapLedgerState<CapEntry>;

/**
 * Wraps an inner summary provider and enforces a persisted call ceiling. `limit`
 * and `counterFile` are constructor arguments so a test can point at a throwaway
 * file with a small limit and prove the block fires, without touching the real
 * ledger. Production wiring passes the real values.
 */
export class AssistSummaryCapDecorator implements AssistSummaryProvider {
  private readonly logger = new Logger(AssistSummaryCapDecorator.name);

  constructor(
    private readonly inner: AssistSummaryProvider,
    private readonly limit: number,
    private readonly counterFile: string,
    /** Stamps each recorded call. Injectable so tests are deterministic. */
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** This lane's own corrupt-file wording — note the `assist-summary` marker. */
  private readonly onCorrupt = (): void => {
    // A corrupt file must NOT read as "0 used" — that silently grants another
    // full budget. Treat it as exhausted and make a human look.
    this.logger.error(
      `[AI-CAP] assist-summary counter unreadable — treating as EXHAUSTED: ${this.counterFile}`,
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

  async summarise(
    request: AssistSummaryRequest,
  ): Promise<AssistSummaryResponse> {
    const state = this.read();
    if (state.count >= this.limit) {
      this.logger.error(
        `[AI-CAP] assist-summary REFUSED — ${state.count}/${this.limit} used`,
      );
      throw new AssistSummaryCapReachedError(
        state.count,
        this.limit,
        this.counterFile,
      );
    }

    // Count BEFORE the call, and persist immediately, so a crash mid-call still
    // consumes the slot rather than granting a free retry.
    const callNumber = state.count + 1;
    state.count = callNumber;
    state.calls.push({
      at: this.now(),
      question: (request.currentQuestion ?? '').slice(0, 80),
    });
    this.write(state);

    this.logger.warn(
      `[AI-CAP] assist-summary call ${callNumber}/${this.limit}`,
    );

    const result = await this.inner.summarise(request);

    this.logger.warn(
      `[AI-CAP] assist-summary call ${callNumber}/${this.limit} complete — ${this.limit - callNumber} left`,
    );
    return result;
  }
}
