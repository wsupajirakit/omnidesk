/**
 * [FEAT-20260824-BCASTMINT] The mint module's only front door.
 *
 * The form imports `MintButton` and nothing else — see `MintButton.tsx` for why
 * that boundary is what makes a new mint a one-entry change.
 */
export { MintButton } from './MintButton';
export { MintChoiceModal } from './MintChoiceModal';
export { applyMint, rulesForChoices, type MintedRule } from './mintRules';
export {
  MINTS,
  mintById,
  type MintChoice,
  type MintDefinition,
  type MintOp,
} from './mint.registry';
