/**
 * [FEAT-20260818-TRANSLATE] The SCRIPTED translate provider — the "mock" leg of
 * the translate switch, mirroring the scripted twins of the other two seams.
 *
 * 🚨 TEST ONLY — must never run in production. [FEAT-20260908-CHATTRANS] the
 * boot-time wall used to be described as "the factory in `tickets.module.ts`";
 * it is `AiTranslateService`'s constructor now, calling `selectTranslateProvider`
 * while Nest builds the graph. Same throw, same moment, different address — and
 * a header naming a file that no longer wires this class would send the next
 * reader to the wrong place. The deploy build replaces this file with
 * `build/prod-stubs/
 * scripted-translate.provider.ts`, exactly as the other two scripted providers
 * are stubbed. It answers `[<targetLang>] <text>` so a test can assert routing
 * without any network, and RECORDS every request in `received`.
 *
 * revert: delete with the funnel folder + the Dockerfile stub COPY line.
 */
import { Injectable, Logger } from '@nestjs/common';

import type {
  TranslateProvider,
  TranslateRequest,
  TranslateResponse,
} from './translate.provider';

@Injectable()
export class ScriptedTranslateProvider implements TranslateProvider {
  private readonly logger = new Logger(ScriptedTranslateProvider.name);

  /** Every request the seam received, in order — read by tests. */
  public readonly received: TranslateRequest[] = [];

  /** Queued responses; empty queue answers the deterministic default below. */
  private readonly queue: TranslateResponse[] = [];

  enqueue(resp: TranslateResponse): this {
    this.queue.push(resp);
    return this;
  }

  reset(): void {
    this.queue.length = 0;
    this.received.length = 0;
  }

  translate(request: TranslateRequest): Promise<TranslateResponse> {
    this.received.push(request);
    const next = this.queue.shift() ?? {
      text: `[${request.targetLang}] ${request.text}`,
    };
    this.logger.debug(
      `[AI-MOCK] scripted translate (queue ${this.queue.length} left)`,
    );
    return Promise.resolve(next);
  }
}
