/**
 * [FEAT-20260816-GROUPSCOPECLONE] Group scope copy/clone.
 *
 * revert: delete this folder and the two lines that name it in
 * `hooks.module.ts`. Nothing else in the codebase imports it, and no document
 * shape changed — the feature only writes ids into `group_ids` arrays that both
 * collections already had.
 */
export {
  GroupScopeCloneService,
  type ScopeCloneBody,
  type ScopeCloneMode,
  type ScopeCloneResult,
  type ScopeCloneTargetResult,
} from './group-scope-clone.service';
export { GroupScopeCloneController } from './group-scope-clone.controller';
