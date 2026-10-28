/**
 * [FEAT-20260905-CUSTPROV PART 5] Barrel for the chat-room header module.
 * ============================================================================
 * WHAT: the one door into `components/chat/room-header/`.
 *
 * WHY:  `ChatRoomView.tsx` imports THIS and nothing else from the folder (plan
 *       §25). One import line means the module can be re-cut — parts renamed,
 *       split further, merged — without a single edit outside the folder.
 *
 * 🔴 Do not add a deep import elsewhere in the app. The moment a second file
 *    reaches past this barrel into `parts/`, the folder stops being a module
 *    and becomes a pile with a folder name. ประตูเดียว เข้าออกทางนี้เท่านั้น
 *
 * The `parts/*` components are deliberately NOT re-exported: they are internals
 * of the bar, not a component library. `RoomHeaderProps` is exported because a
 * caller has to type the props it passes.
 *
 * revert: delete this file with the rest of the folder; `ChatRoomView.tsx`
 *         goes back to rendering the bar inline.
 */
export { RoomHeader } from './RoomHeader';
export type { RoomHeaderProps } from './RoomHeader';
