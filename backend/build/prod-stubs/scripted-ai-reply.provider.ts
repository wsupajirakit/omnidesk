/**
 * [FIX-20260818-STUBATBUILD] DEPLOY STUB — replaces the scripted AI reply
 * provider in the Docker build.
 * ===========================================================================
 * Owner's rule, 18/08/2026: simulation and bypass code must not reach staging or
 * production. The scripted provider cannot simply be deleted from `src/` — it is
 * a DI token wired into `webhook.module.ts` and the class the switch tests
 * construct to prove that `AI_PROVIDER=mock` is refused. Deleting it would break
 * the very tests that guard the seam.
 *
 * So the CLASS survives and the BEHAVIOUR does not: the Dockerfile copies this
 * file over `src/modules/webhook/scripted-ai-reply.provider.ts` before `pnpm
 * build`, so the artifact resolves the same token, wires the same module graph,
 * and can never answer a customer from a script.
 * คลาสยังอยู่ให้ DI ผูกได้ · แต่พฤติกรรมสคริปต์ไม่ขึ้น deploy.
 *
 * FAILS LOUDLY, NOT QUIETLY. `generate` throws rather than returning an empty
 * reply, because the pipeline treats an empty reply as "the model had nothing to
 * say" and goes silent — the exact failure mode `scripts/preflight-deploy.mjs`
 * exists to prevent. A throw surfaces in the logs as an error.
 *
 * ⚠️ Never import this file from `src/`. It is build input, not source.
 * revert: drop the two COPY lines in the Dockerfile.
 */
import { Injectable, Logger } from '@nestjs/common';

import type {
  AiReplyProvider,
  AiReplyRequest,
  AiReplyResponse,
} from './ai-reply.provider';

@Injectable()
export class ScriptedAiReplyProvider implements AiReplyProvider {
  private readonly logger = new Logger(ScriptedAiReplyProvider.name);

  /** Present so the shape matches; nothing in a deploy build ever reads it. */
  public readonly received: AiReplyRequest[] = [];

  generate(request: AiReplyRequest): Promise<AiReplyResponse> {
    this.logger.error(
      '[AI] the scripted reply provider was selected in a deploy build — ' +
        'AI_PROVIDER must be `real` here. Refusing to answer from a script.',
    );
    void request;
    return Promise.reject(
      new Error(
        'ScriptedAiReplyProvider is stubbed out of deploy builds — set AI_PROVIDER=real',
      ),
    );
  }
}
