/**
 * [FEAT-20260818-TRANSLATE] Call cap for the translate seam — same class shape
 * as `assist-summary-cap.decorator.ts`, with ONE deliberate difference:
 *
 * ⚠️ ITS OWN COUNTER FILE. The reply and summary seams share one ledger
 *    (`webhook.module.ts:111` and `:165` both pass `AI_CAP_COUNTER_FILE`), so
 *    either exhausting the budget silences the other. Translation must not be
 *    able to do that to the webhook: when THIS ledger fills, translation alone
 *    refuses (`TranslateCapReachedError`) and the customer-facing bot never
 *    notices. งบแยกถัง — แปลหมดงบก็พังคนเดียว บอทไม่เงียบ.
 *
 * Corrupt-file rule copied as-is: unreadable ledger reads as EXHAUSTED, never
 * as "0 used" — a parse error must not grant a fresh budget.
 *
 * revert: delete with the funnel folder.
 */
import { Logger } from '@nestjs/common';

/* [FEAT-20260908-AICAPLEDGER] ledger mechanics from the door.
   ⚠️ NO `onCorrupt` IS PASSED, and that is not an omission: this decorator has
   never logged on a corrupt ledger. Giving it one here would be a behaviour
   change smuggled inside a move. If it should log, that is its own commit. */
import {
  readCapLedger,
  writeCapLedger,
  type CapLedgerState,
} from '@/modules/ai-vendor';

import type {
  TranslateProvider,
  TranslateRequest,
  TranslateResponse,
} from './translate.provider';

/** This lane records the target language, not a question. */
type CapEntry = { at: string; target: string };
type CapState = CapLedgerState<CapEntry>;

export class TranslateCapReachedError extends Error {
  constructor(count: number, limit: number, file: string) {
    super(
      `translate call cap reached (${count}/${limit}). Raise the limit or ` +
        `reset ${file}. The webhook reply budget is a separate ledger and is ` +
        `not affected.`,
    );
    this.name = 'TranslateCapReachedError';
  }
}

export class TranslateCapDecorator implements TranslateProvider {
  private readonly logger = new Logger(TranslateCapDecorator.name);

  constructor(
    private readonly inner: TranslateProvider,
    private readonly limit: number,
    private readonly counterFile: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  // Corrupt ⇒ exhausted, never "0 used" — the shared rule, silently as before.
  private read(): CapState {
    return readCapLedger<CapEntry>(this.counterFile, this.limit);
  }

  private write(state: CapState): void {
    writeCapLedger<CapEntry>(this.counterFile, state);
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const state = this.read();
    if (state.count >= this.limit) {
      this.logger.error(
        `[AI-TRANSLATE-CAP] REFUSED — ${state.count}/${this.limit} used`,
      );
      throw new TranslateCapReachedError(
        state.count,
        this.limit,
        this.counterFile,
      );
    }
    // Count BEFORE the call, persisted immediately — a crash mid-call consumes
    // the slot rather than granting a free retry. Same rule as the siblings.
    const n = state.count + 1;
    state.count = n;
    state.calls.push({ at: this.now(), target: request.targetLang });
    this.write(state);
    this.logger.warn(`[AI-TRANSLATE-CAP] call ${n}/${this.limit}`);
    return this.inner.translate(request);
  }
}
