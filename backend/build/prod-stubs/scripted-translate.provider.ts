/**
 * [FIX-20260818-STUBATBUILD] DEPLOY STUB — replaces the scripted translate
 * provider in the Docker build. Same reasoning as its two siblings in this
 * folder: the class survives so DI and the switch tests keep working, the
 * scripted BEHAVIOUR does not ship. It rejects rather than returning canned
 * text, so a misconfigured deploy surfaces in the logs instead of quietly
 * feeding fake translations to admins.
 *
 * ⚠️ Never import this file from `src/`. It is build input, not source.
 * revert: drop the Dockerfile COPY line for this file.
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

  /** Present so the shape matches; nothing in a deploy build ever reads it. */
  public readonly received: TranslateRequest[] = [];

  translate(request: TranslateRequest): Promise<TranslateResponse> {
    this.logger.error(
      '[AI] the scripted translate provider was selected in a deploy build — ' +
        'AI_PROVIDER must be `real` here. Refusing to answer from a script.',
    );
    void request;
    return Promise.reject(
      new Error(
        'ScriptedTranslateProvider is stubbed out of deploy builds — set AI_PROVIDER=real',
      ),
    );
  }
}
