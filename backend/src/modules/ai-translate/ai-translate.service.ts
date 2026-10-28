/**
 * [FEAT-20260908-CHATTRANS] The module's public seam — an ordinary exported
 * service, which is the shape ~16 other modules in this repo already use.
 *
 * WHY A SERVICE AND NOT AN EXPORTED TOKEN. The funnel used to be reached through
 * `TICKET_TRANSLATE_PROVIDER`, injected by a controller that no longer exists.
 * Exporting that token would have made it the repo's SECOND exported DI token
 * ever (`strike.module.ts:87` is the only one) and its FIRST exported
 * config-swapped token. A consumer wires this instead with one
 * `imports: [AiTranslateModule]` line and a bare constructor parameter — no
 * `@Inject`, no symbol import, nothing to get wrong at a call site.
 *
 * WHAT IT DOES NOT DO, and this is the contract, not an omission: it takes no
 * `ticketId`/`roomId`/`messageId`, no actor, no Hook document, no Mongoose
 * `Model`, no `CryptoService`, no encrypted key and no audit writer. Every one
 * of those would turn a capability back into a feature. The CALLER resolves the
 * vendor, the model and the decrypted key and hands over the three fields below.
 * ประตูต้องไม่รู้จักคนเรียก.
 *
 * The production wall is unchanged: `selectTranslateProvider` throws at BOOT
 * when `NODE_ENV=production` meets `AI_PROVIDER=mock`, and it is called from
 * this constructor, so that throw still happens while Nest is building the
 * graph — exactly as it did from `tickets.module.ts`'s `useFactory`.
 *
 * revert: delete `src/modules/ai-translate/` whole.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { aiConfig, aiTranslateConfig } from '@/config/app.config';

import { ScriptedTranslateProvider } from './scripted-translate.provider';
import { selectTranslateProvider } from './translate.factory';
import {
  RealTranslateProvider,
  type TranslateProvider,
  type TranslateRequest,
  type TranslateResponse,
} from './translate.provider';

@Injectable()
export class AiTranslateService implements TranslateProvider {
  /** Chosen ONCE, at construction — the same "once, at boot" the factory had. */
  private readonly provider: TranslateProvider;

  /**
   * [FIX-20260909-TRANSLATECAPWIRE] TWO namespaces, and the split is the fix.
   *
   * This used to take `aiConfig` alone and hand it straight to the factory, so
   * the cap decorator was built with `AI_CAP_LIMIT` — the reply/summary ceiling
   * — and `AI_TRANSLATE_CAP_LIMIT` did nothing whatsoever. The namespace existed
   * and was simply never read. Both values are numbers, so nothing failed: the
   * lane went on working against the wrong ceiling, and the only symptom would
   * have been a budget that did not stop where the operator set it.
   *
   * What comes from where, deliberately:
   *   `aiConfig`          providerMode + capMode — WHOLE-PROCESS switches.
   *                       mock-vs-real and cap-on-vs-off are not per-lane
   *                       opinions, and two switches that can disagree are
   *                       worse than one.
   *   `aiTranslateConfig` capLimit — the only genuinely per-lane number.
   *
   * ⚠️ An installation that never sets `AI_TRANSLATE_CAP_LIMIT` is unaffected:
   *    the namespace resolves it to `AI_CAP_LIMIT`, so the value handed over is
   *    the same one this constructor passed before.
   */
  constructor(
    @Inject(aiConfig.KEY) ai: ConfigType<typeof aiConfig>,
    @Inject(aiTranslateConfig.KEY)
    translate: ConfigType<typeof aiTranslateConfig>,
    scripted: ScriptedTranslateProvider,
    real: RealTranslateProvider,
  ) {
    this.provider = selectTranslateProvider(
      { ...ai, capLimit: translate.capLimit },
      scripted,
      real,
    );
  }

  /**
   * Translate one piece of text. Throws `TranslateKeyMissingError` when the
   * caller passed no usable key, `TranslateCapReachedError` when this lane's own
   * budget is spent, and `TranslateFailedError` when the vendor errored or
   * answered with nothing. Each is a TYPED refusal a caller maps to a status —
   * none of them is taught to the global exception filter, which serves every
   * route in the API.
   */
  translate(request: TranslateRequest): Promise<TranslateResponse> {
    return this.provider.translate(request);
  }
}
