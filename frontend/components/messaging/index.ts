/* [FEAT-20260824-BCASTTABS] Barrel for the messaging pages' own pieces.
 * Same convention as components/contact/index.ts: pages import from the folder,
 * never from a deep file path. revert: delete the components/messaging/ folder.
 *
 * [REFACTOR-20260907-MSGROLEFOLDERS] The folder was a flat pile of seven files.
 * They are now grouped BY ROLE, which is the rule for this repo:
 *
 *   cells/    — things drawn inside ONE table cell (job id, tag scope, name)
 *   enabled/  — the "is this campaign armed?" family: the badge, the toggle and
 *               the single `resolveBroadcastEnableState` rule they both ask
 *   (root)    — BroadcastPageTabs, page chrome and the ONLY file of its role.
 *               No folder was created to hold one file, on purpose.
 *
 * 🔴 THIS BARREL IS THE PUBLIC SURFACE AND IT DID NOT CHANGE. Every name below
 *    is exported exactly as before, so no page or test outside this folder had
 *    to be edited for the move — the one exception is
 *    `test/broadcastEnabledStatus.value.test.ts`, which reached past the barrel
 *    into `./broadcastEnableState` directly and now names the new path.
 *    ย้ายไฟล์ได้ แต่ทางเข้าเดิมต้องไม่ขยับ.
 */
export { BroadcastPageTabs, type BroadcastTabKey } from './BroadcastPageTabs';

/* cells — one table cell each */
export { JobIdCell } from './cells/JobIdCell';
export {
  BroadcastNameCell,
  BROADCAST_NAME_MAX_CH,
  isNameTruncated,
} from './cells/BroadcastNameCell';
export { TagScopeCell, TAG_SCOPE_INLINE_LIMIT } from './cells/TagScopeCell';

/* enabled — the on/off state of a campaign, and the one rule that decides it */
export { BroadcastEnabledBadge } from './enabled/BroadcastEnabledBadge';
export { BroadcastEnabledToggle } from './enabled/BroadcastEnabledToggle';
export {
  resolveBroadcastEnableState,
  BROADCAST_ENABLE_LABEL,
  BROADCAST_ENABLE_HINT,
  type BroadcastEnableState,
  type ScheduleEnabledLike,
} from './enabled/broadcastEnableState';
