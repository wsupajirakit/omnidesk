/** Public surface of the field-options pipe — import '@/modules/options'. */

export { FieldOptionsModule } from './field-options.module';
/* Exported for its spec: a deep path into a module's internals is an eslint
   error by this repo's layering rule, tests included. */
export { FieldOptionsController } from './field-options.controller';
export {
  FIELD_OPTION_SOURCES,
  fieldOptionsFor,
  realChoiceCount,
  type FieldOption,
  type FieldOptionSource,
} from './field-options.registry';
