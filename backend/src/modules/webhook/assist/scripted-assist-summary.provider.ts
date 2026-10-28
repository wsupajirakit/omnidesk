/**
 * [FIX-20260808-ASSISTSUMMARYFIRE] The SCRIPTED assist-summary provider.
 * ===========================================================================
 * MOVED OUT OF `assist-summary.provider.ts` on 18/08/2026 so it can be replaced
 * wholesale at build time. It used to sit at the end of that file, next to the
 * REAL `RealAssistSummaryProvider` — which made the two inseparable: a deploy
 * build could not drop the scripted one without dropping the provider that
 * actually answers customers. Nothing else changed; the class body below is the
 * same code, moved.
 *
 * 🚨 TEST ONLY. `build/prod-stubs/scripted-assist-summary.provider.ts` takes
 * this file's place in the Docker build, so the scripted BEHAVIOUR never reaches
 * a deploy artifact even though the class name still resolves.
 * ไฟล์นี้ถูกสลับด้วย stub ตอน build ⇒ ของจริงไม่ขึ้น deploy.
 */
import { Injectable, Logger } from '@nestjs/common';

import type {
  AssistSummaryProvider,
  AssistSummaryRequest,
  AssistSummaryResponse,
} from '../ai-vendors/gemini/assist-summary.provider';

@Injectable()
export class ScriptedAssistSummaryProvider implements AssistSummaryProvider {
  private readonly logger = new Logger(ScriptedAssistSummaryProvider.name);

  /** Responses handed out in order, one per `summarise` call. */
  private readonly queue: AssistSummaryResponse[] = [];

  /** Every request the pipeline sent to the seam, in order — read by tests. */
  public readonly received: AssistSummaryRequest[] = [];

  /** Pinned by substring of `currentQuestion`, checked before the queue. */
  private readonly byQuestion = new Map<string, AssistSummaryResponse>();

  /** Queue a response for the next unmatched call. Returns `this` for chaining. */
  enqueue(resp: Partial<AssistSummaryResponse> & { summary: string }): this {
    this.queue.push({ category: 'Other', ...resp });
    return this;
  }

  /** Pin a response to any `currentQuestion` containing `needle`. */
  whenQuestionContains(
    needle: string,
    resp: Partial<AssistSummaryResponse> & { summary: string },
  ): this {
    this.byQuestion.set(needle, { category: 'Other', ...resp });
    return this;
  }

  /** Forget all scripted responses and recorded requests. */
  reset(): void {
    this.queue.length = 0;
    this.received.length = 0;
    this.byQuestion.clear();
  }

  summarise(request: AssistSummaryRequest): Promise<AssistSummaryResponse> {
    this.received.push(request);

    for (const [needle, resp] of this.byQuestion) {
      if (request.currentQuestion.includes(needle)) {
        this.logger.debug(
          `[AI-MOCK] assist-summary matched question contains "${needle}"`,
        );
        return Promise.resolve(resp);
      }
    }

    const next = this.queue.shift() ?? { summary: '', category: 'Other' };
    this.logger.debug(
      `[AI-MOCK] scripted summary (queue ${this.queue.length} left)`,
    );
    return Promise.resolve(next);
  }
}
