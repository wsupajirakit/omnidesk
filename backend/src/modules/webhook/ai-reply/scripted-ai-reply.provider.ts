/**
 * A scripted AI reply provider — the "mock" leg of the AI switch.
 *
 * 🚨 TEST ONLY — must never run in production. The factory in `webhook.module.ts`
 * throws at boot if `NODE_ENV=production` selects it, and `pnpm preflight` blocks
 * a build that contains this file. See PLAN-webhook-0.5-rev2-mock-ai.md.
 *
 * It answers from a script instead of a model, so the entire webhook pipeline —
 * prompt assembly, marker handling, flex/tag routing, assist, send — can be
 * driven end to end over real HTTP, deterministically, at zero cost and with no
 * network. It also RECORDS every `AiReplyRequest` it receives, which turns
 * "what prompt did we assemble / which box was selected / did the tag
 * substitute" into things a test can assert directly, without a model.
 *
 * What it CANNOT prove: whether a real model would answer correctly, emit
 * `[[[assist]]]` at the right moment, or refuse to invent data. A scripted reply
 * replays a decision the test author wrote; it proves the pipeline HANDLES that
 * decision, never that the model MAKES it. That boundary is the whole honesty of
 * the mock and must be stated wherever its results are reported.
 */

import { Injectable, Logger } from '@nestjs/common';

import {
  type AiReplyProvider,
  type AiReplyRequest,
  type AiReplyResponse,
} from './ai-reply.provider';

/** The default when a test enqueues nothing — an empty, grounded reply. */
const DEFAULT_REPLY: AiReplyResponse = {
  text: '',
  noData: false,
  tagStatus: null,
};

@Injectable()
export class ScriptedAiReplyProvider implements AiReplyProvider {
  private readonly logger = new Logger(ScriptedAiReplyProvider.name);

  /** Replies handed out in order, one per `generate` call. */
  private readonly queue: AiReplyResponse[] = [];

  /** Every request the pipeline sent to the seam, in order — read by tests. */
  public readonly received: AiReplyRequest[] = [];

  /**
   * Reply to a request whose `question` contains this exact text. Checked before
   * the queue, so a test can pin "when the customer says X, answer Y" without
   * caring about call order.
   */
  private readonly byQuestion = new Map<string, AiReplyResponse>();

  /** Queue a reply for the next unmatched call. Returns `this` for chaining. */
  enqueue(reply: Partial<AiReplyResponse> & { text: string }): this {
    this.queue.push({ noData: false, tagStatus: null, ...reply });
    return this;
  }

  /** Pin a reply to any question containing `needle`. */
  whenQuestionContains(
    needle: string,
    reply: Partial<AiReplyResponse> & { text: string },
  ): this {
    this.byQuestion.set(needle, { noData: false, tagStatus: null, ...reply });
    return this;
  }

  /** Forget all scripted replies and recorded requests. */
  reset(): void {
    this.queue.length = 0;
    this.received.length = 0;
    this.byQuestion.clear();
  }

  generate(request: AiReplyRequest): Promise<AiReplyResponse> {
    this.received.push(request);

    for (const [needle, reply] of this.byQuestion) {
      if (request.question.includes(needle)) {
        this.logger.debug(`[AI-MOCK] matched question contains "${needle}"`);
        return Promise.resolve(reply);
      }
    }

    const next = this.queue.shift() ?? DEFAULT_REPLY;
    this.logger.debug(
      `[AI-MOCK] scripted reply (queue ${this.queue.length} left)`,
    );
    return Promise.resolve(next);
  }
}
