/**
 * [FIX-20260824-HOOKCASCADE] Unticking a group must take its OAs with it.
 * ===========================================================================
 * Owner, 24/08: *"ถ้าติ๊ก group แม่ออก hook ลูกต้องออกตาม"*.
 *
 * 🔴 WHY THIS IS A SEND BUG, NOT A TIDINESS BUG. `formData.hook_ids` is the list
 *    of OAs the campaign actually fires from. The OA checklist is rebuilt from
 *    whichever groups are ticked (`BroadcastFormModal`'s `groupPickKey` effect),
 *    so unticking a group makes its OAs VANISH FROM THE SCREEN — but their ids
 *    stayed in `hook_ids` and still went up in the payload. The admin removes a
 *    group, sees the OAs disappear, presses save, and the broadcast still goes
 *    out from them. ลบกลุ่มออกแล้ว OA หายจากจอ แต่ยังยิงอยู่ = ส่งเกินโดยไม่รู้ตัว.
 *
 * 🔴 A HOOK BELONGS TO EXACTLY ONE GROUP. `HookData` (`types/hook.ts:5`) carries
 *    a single `group` — the field the API responds with. `group_id` is only ever
 *    set by request payloads the forms build, never by a response, so it is read
 *    as a fallback and never as the primary. อ่าน `group` ก่อนเสมอ.
 *
 * 🔴 AN UNKNOWN HOOK IS KEPT, DELIBERATELY. Opening an existing campaign fills
 *    `hook_ids` from `initialData` while the OA list is still fetching, so for a
 *    moment nothing in `hook_ids` can be resolved to a group. Dropping what we
 *    cannot classify would silently empty the OA list of every campaign the
 *    moment it is opened, and a save would write that emptiness back.
 *    ⇒ prune only what we can PROVE belongs to a group that is no longer ticked.
 *    พิสูจน์ไม่ได้ว่าอยู่กลุ่มไหน = ห้ามลบ.
 *
 * revert: stop calling this and let `hook_ids` keep whatever it holds — the
 * unticked group's OAs come back as invisible recipients.
 */

/** The slice of `HookData` this cascade needs. Kept structural so a test can
 *  hand in a plain object without building a whole hook. */
export interface HookGroupRef {
  _id: string;
  group?: string | null;
  group_id?: string | null;
}

/** '' means "this hook did not tell us its group" — treated as unknown, never as
 *  "belongs to no group". `?? ` and not `||` on purpose: a real id is never ''. */
export const hookGroupOf = (hook: HookGroupRef): string =>
  String(hook.group ?? hook.group_id ?? '');

/**
 * Keep only the picked OA ids whose group is still ticked.
 *
 * @param hookIds        what the campaign has picked right now
 * @param hooks          every OA currently loaded — the only place a group can be looked up
 * @param allowedGroupIds the groups that remain ticked AFTER the change (assign_group included:
 *                        it feeds the OA list too, so an OA reachable only through it stays legal)
 */
export function pruneHookIds(
  hookIds: readonly string[],
  hooks: readonly HookGroupRef[],
  allowedGroupIds: readonly (string | null | undefined)[],
): string[] {
  const allowed = new Set(allowedGroupIds.filter(Boolean).map(String));
  const groupOf = new Map(hooks.map(h => [String(h._id), hookGroupOf(h)]));

  return hookIds.filter(id => {
    const group = groupOf.get(String(id));
    // Not loaded, or loaded without a group ⇒ unprovable ⇒ keep. See the note above.
    if (group === undefined || group === '') return true;
    return allowed.has(group);
  });
}

export default pruneHookIds;
