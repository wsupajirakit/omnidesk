/**
 * Public surface of the ai-translate module — import '@/modules/ai-translate',
 * never a deep file.
 *
 * 🔴 `AI_TRANSLATE_PROVIDER` IS NOT EXPORTED HERE, ON PURPOSE. The DI token is
 * private to the module (see `ai-translate.module.ts`); a consumer imports
 * `AiTranslateModule` and injects `AiTranslateService`. Adding the token to this
 * barrel would make it the repo's second exported DI token ever, and its first
 * exported config-swapped one.
 *
 * The typed refusals ARE exported, because a caller has to be able to map them
 * to a status — that mapping belongs to each caller, never to the global
 * exception filter, which serves every route in the API.
 */
export { AiTranslateModule } from './ai-translate.module';
export { AiTranslateService } from './ai-translate.service';
export {
  RealTranslateProvider,
  TranslateKeyMissingError,
  type TranslateProvider,
  type TranslateRequest,
  /* [FEAT-20260909-DSREASONING] the neutral reasoning shape — a CALLER resolves
     it from its own columns and hands it over; this module never learns what a
     hook is. Exported as a type only, so nothing here becomes importable state.
     It comes from `translate-neutral`, the vendor-free contract — see below. */
  type TranslateResponse,
} from './translate.provider';
export { ScriptedTranslateProvider } from './scripted-translate.provider';
export {
  TranslateCapDecorator,
  TranslateCapReachedError,
} from './translate-cap.decorator';
export { selectTranslateProvider } from './translate.factory';
export {
  interpretTranslateResult,
  TranslateFailedError,
} from './translate-interpreter';
export { buildTranslatePrompt } from './translate-prompt';
export {
  DEFAULT_TRANSLATE_PROVIDER,
  resolveTranslateTransport,
  TRANSLATE_TRANSPORTS,
} from './translate-transport.registry';
/* [FEAT-20260908-CHATTRANS] The language registry and its options source. The
   options pipe (`modules/options/field-options.registry.ts`) imports the source
   through THIS barrel — a deep path into a module's internals is an eslint error
   by this repo's layering rule. The arrow is options → ai-translate and there is
   no way back: this module imports no feature module at all. */
export {
  isTranslateLanguage,
  knownTranslateLanguageCodes,
  translateLanguage,
  translatePromptName,
  TRANSLATE_LANGUAGE_CODES,
  TRANSLATE_LANGUAGE_LABEL_NS,
  TRANSLATE_LANGUAGES,
  type TranslateLanguage,
} from './languages';
export { translateLanguageOptions } from './translate-lang.options';
export type { TranslateReasoning } from './translate-neutral';
