/**
 * [FEAT-20260818-TRANSLATE] Chooses the translate provider from the SAME two
 * switch axes the other seams use — provider × cap — under the SAME env flags
 * (`AI_PROVIDER`, `AI_CAP`, `AI_CAP_LIMIT`). No new configuration exists to
 * forget on stg: unset everything and this binds real+cap exactly like the
 * reply seam. Mirrors `selectAssistSummaryProvider`.
 *
 * Safe by construction, same as the siblings:
 *  · production + mock THROWS at boot — a script must never translate for admins
 *  · the cap wraps with its OWN counter file (see translate-cap.decorator.ts)
 *
 * revert: delete with the funnel folder.
 */
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import type { aiConfig } from '@/config/app.config';

import { TranslateCapDecorator } from './translate-cap.decorator';
import type { ScriptedTranslateProvider } from './scripted-translate.provider';
import type {
  RealTranslateProvider,
  TranslateProvider,
} from './translate.provider';

/** Its own ledger — deliberately NOT the reply/summary `AI_CAP_COUNTER_FILE`. */
export const TRANSLATE_CAP_COUNTER_FILE = resolve(
  process.cwd(),
  '.ai-translate-call-count.json',
);

export function selectTranslateProvider(
  ai: Pick<
    ConfigType<typeof aiConfig>,
    'providerMode' | 'capMode' | 'capLimit'
  >,
  scripted: ScriptedTranslateProvider,
  real: RealTranslateProvider,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  logger: { log: (m: string, c?: string) => void } = Logger,
): TranslateProvider {
  if (nodeEnv === 'production' && ai.providerMode === 'mock') {
    throw new Error(
      '[AI] AI_PROVIDER=mock is forbidden in production — refusing to bind the ' +
        'scripted translate provider. Set AI_PROVIDER=real.',
    );
  }
  const inner: TranslateProvider = ai.providerMode === 'mock' ? scripted : real;
  const provider: TranslateProvider =
    ai.capMode === 'on'
      ? new TranslateCapDecorator(
          inner,
          ai.capLimit,
          TRANSLATE_CAP_COUNTER_FILE,
        )
      : inner;
  logger.log(
    `[AI] translate = ${ai.providerMode} · cap = ${ai.capMode}` +
      (ai.capMode === 'on' ? ` (limit ${ai.capLimit}, own ledger)` : ''),
    /* [FEAT-20260908-CHATTRANS] was 'TicketsModule'. A verbatim move keeps a log
       CONTEXT that now names the wrong module, and nothing catches it: the
       funnel spec passes a silent logger, so only a live boot shows this string.
       Fixed here rather than left for an operator to be misled by. */
    'AiTranslateModule',
  );
  return provider;
}
