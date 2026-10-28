/**
 * [FIX-20260818-STUBATBUILD] DEPLOY STUB — replaces the scripted assist-summary
 * provider in the Docker build. Same reasoning as its reply-seam twin, see
 * `scripted-ai-reply.provider.ts` in this folder.
 *
 * What the real class does that must not reach production: it answers from a
 * hardcoded script and that value is written into `ticket.need_detail`, so a
 * deploy carrying it would file fabricated case summaries against real
 * customers. สรุปเคสปลอมลง ticket จริง — ห้ามขึ้น deploy เด็ดขาด.
 *
 * ⚠️ Never import this file from `src/`. It is build input, not source.
 * revert: drop the two COPY lines in the Dockerfile.
 */
import { Injectable, Logger } from '@nestjs/common';

import type {
  AssistSummaryProvider,
  AssistSummaryRequest,
  AssistSummaryResponse,
} from '../ai-vendors/gemini/assist-summary.provider';
// MERGE NOTE 18/08: this path is relative to where the stub LANDS
// (`src/modules/webhook/assist/`), not to `build/prod-stubs/`. This lane moved
// the provider into `ai-vendors/gemini/` and the scripted leg into `assist/`
// after the stub was written against the flat layout, so the import had to climb
// with it — otherwise the deploy build fails to compile the file it just swapped
// in. เส้นทางอ้างจากที่ไฟล์ไปวาง ไม่ใช่ที่ไฟล์ต้นทางอยู่.

@Injectable()
export class ScriptedAssistSummaryProvider implements AssistSummaryProvider {
  private readonly logger = new Logger(ScriptedAssistSummaryProvider.name);

  /** Present so the shape matches; nothing in a deploy build ever reads it. */
  public readonly received: AssistSummaryRequest[] = [];

  summarise(request: AssistSummaryRequest): Promise<AssistSummaryResponse> {
    this.logger.error(
      '[AI] the scripted assist-summary provider was selected in a deploy ' +
        'build — AI_PROVIDER must be `real` here. Refusing to summarise from a script.',
    );
    void request;
    return Promise.reject(
      new Error(
        'ScriptedAssistSummaryProvider is stubbed out of deploy builds — set AI_PROVIDER=real',
      ),
    );
  }
}
