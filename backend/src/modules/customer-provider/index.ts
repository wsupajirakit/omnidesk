/**
 * Public surface of the customer-provider module — import
 * '@/modules/customer-provider'.
 *
 * 🔴 THIS IS THE ONLY WAY IN. No file outside this folder may read
 * `CUSTOMER_PROVIDER` from the environment, reach into `providers/`, or keep its
 * own fallback. `z-test/unit/customer-provider-single-source.spec.ts` fails if a
 * second reader appears — because a convention with nothing red behind it is a
 * convention that gets forgotten, which this codebase proved twice on 05/09.
 */
export { CustomerProviderModule } from './customer-provider.module';
export { CustomerProviderService } from './customer-provider.service';
export type {
  CustomerProvider,
  TierPath,
} from './providers/customer-provider.port';
export {
  CUSTOMER_PROVIDER_ENTRIES,
  DEFAULT_CUSTOMER_PROVIDER,
  buildCustomerProviderRegistry,
} from './providers/provider-entries';
/* The path engine's public surface. `composeFields` is exported because it is
   the ONE definition of "paths first, then the provider's algorithms" — a spec
   that assembled the halves itself could prove an order the runtime never
   performs, and a caller that did would freeze that order at its call site. */
export {
  composeFields,
  resolveFields,
  resolveRow,
  resolveRows,
  resolveSections,
} from './providers/engine/resolve-fields';
/* [FEAT-20260905-CUSTPROV] where the fields INSIDE a row live — declared, and
   consumed when `view.sections` ships. See the file header for the count that
   made it necessary. */
export { SHOPAPI_V1_ROW_PATHS } from './providers/shopapi-v1/row-paths';
/* [FEAT-20260905-CUSTPROV] the section vocabulary — a CLOSED set. Adding a type
   is a front-end release; read `view.types.ts` before doing it. */
export type {
  AmountRow,
  Chip,
  CustomerView,
  KvRow,
  ListItem,
  Section,
  SectionType,
} from './providers/engine/view.types';
/* The set as a VALUE, for the envelope validator and the specs. Exported beside
   the type on purpose: a caller that iterates a hand-written copy is the drift
   this array exists to prevent. */
export { CHIP_TONES, SECTION_TYPES } from './providers/engine/view.types';
/* [FEAT-20260905-CUSTPROV] the envelope guard (PART 7 §41 proof 1). Exported so
   a spec can drive the schema directly instead of inferring it from a served
   response — the runtime applies it inside `viewOf`, so no caller needs it. */
export { isLabelled, validateView } from './providers/engine/validate-view';
export type {
  ViewProblem,
  ViewRejection,
  ViewValidation,
} from './providers/engine/validate-view';
/* The chain rule (`??` over N paths) — the module's own, distinct from the
   canonical path READER, which lives at `@/common/utils/read-path`. */
export { readChain } from './providers/engine/read-path';
export type {
  FieldPathMap,
  FieldSpec,
  PathDeclaration,
  Sections,
} from './providers/engine/resolve-fields';
export type { CustomerFields } from './providers/shopapi-v1/derive-fields';
/* [FEAT-20261014-PROVFEATURES] the bot's worlds per provider — read by the choke points. */
export * from './features';
/* [FEAT-20261014-TICKETCATS] the screen-facing read (ticket categories) */
export { CustomerProviderController } from './customer-provider.controller';
