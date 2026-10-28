import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';
import {
  assertHookInScope,
  getAllowedHookIds,
  type GroupDocument,
  type HookDocument,
} from '@/modules/hooks';

/* [FEAT-20260824-BCASTMULTIOA] pure merge + query shape — no Mongo in there */
import { mergeOaSelection, oaGroupExpansionQuery } from './audience';

/**
 * Re-exported so the seven services in this module keep importing it from here,
 * while there is exactly one definition of the rule (V10).
 */
export { isSuperUser };

/**
 * ==== [FIX-20260818-GROUPFIELD] These two no longer live here.
 *
 * They were a copy of the canonical resolver, and the copy had drifted in the
 * one way that mattered: it filtered hooks by `group_id`. The Hook schema
 * declares `group` (`hook.schema.ts:371`, indexed at `:834`) and never
 * `group_id` — live data agreed, 7 hooks, 7 with `group`, 0 with `group_id`. So
 * the query matched nothing, tier 3 returned `[]`, and `[]` is "no OA at all".
 *
 * The four assist_admin accounts holding `broadcast.manage` / `auto_reply.manage`
 * could open both screens, saw an empty list, and had every save refused. They
 * reached the handler and were turned away inside it, so it read as a
 * permission problem and was not one.
 *
 * Fixed by deleting the copy rather than renaming its field: every other line
 * already matched the canonical, so this is the same behaviour with one fewer
 * place for it to drift. The copy also filtered `deleted_at: { $exists: false }`
 * — dropped deliberately, because the Hook schema declares no such field and
 * `deleteHook` is a hard `findByIdAndDelete` (`hooks.service.ts:2930`), so it
 * filtered on something that cannot exist. Checked before removing, not assumed.
 *
 * The three functions BELOW stay: they answer content-specific questions that
 * have no canonical home.
 *
 * revert: restore the two bodies from git history — and the `group_id` typo
 *         with them, which is what broke the two screens.
 */
export { getAllowedHookIds };

/**
 * Argument-order adapter, not a second rule. `assertHookInScope` takes
 * (user, hookModel, hookId); the six call sites in this module were written
 * against (user, hookId, hookModel). Keeping the adapter leaves all of them
 * untouched, and there is only one place left where the rule itself is written.
 */
export async function ensureHookAccess(
  user: AuthenticatedUser | null | undefined,
  hookId: string,
  hookModel: Model<HookDocument>,
): Promise<void> {
  await assertHookInScope(user, hookModel, hookId);
}

export function ensureAssignGroupAccess(
  user: AuthenticatedUser | null | undefined,
  assignGroupId?: unknown,
): void {
  if (isSuperUser(user)) return;
  const groupIds = Array.isArray(user?.groups)
    ? user.groups.filter((id) => mongoose.isValidObjectId(id))
    : [];
  if (groupIds.length === 0) {
    throw new ForbiddenException('group access is required');
  }

  let assignStr = '';
  if (typeof assignGroupId === 'string') {
    assignStr = assignGroupId;
  } else if (typeof assignGroupId === 'number') {
    assignStr = String(assignGroupId);
  } else if (assignGroupId instanceof mongoose.Types.ObjectId) {
    /* [FIX-2708-ASSIGNGROUPOID] ObjectId ดิบ — รูปที่ระบบส่งมาจริงทุกวัน:
       `resolveAssignGroup` คืน `{id: ObjectId}` (สัญญาของมันเอง :140-143) และ
       `broadcasts.service.ts:738` ส่ง `.id` ต่อเข้ามาที่นี่ ⇒ ไม่ใช่ string
       ไม่ใช่ object-ที่มีคีย์ id ⇒ ของเดิมตกทุก branch แล้วปฏิเสธด้วย
       "assign_group is required" ทั้งที่สิทธิ์ถูก — ทุก job ที่สร้างผ่าน API
       กดส่งไม่ได้เลย (เจอจริงตอนเทสใหญ่ 27/08)
       ⚠️ เช็ค instanceof ก่อน branch object ข้างล่าง: ObjectId ก็มี `.id`
       (Buffer ของไบต์ดิบ) ซึ่งเป็นคนละสิ่งกับ id ที่เราหมายถึง — กับดักเดียวกับ
       ที่ `ensureAssignGroupsAccess` (:215-228) จดเตือนไว้ตั้งแต่ 25/08
       revert: ลบ branch นี้ (แล้ว 403 จะกลับมา) */
    assignStr = assignGroupId.toString();
  } else if (
    typeof assignGroupId === 'object' &&
    assignGroupId !== null &&
    'id' in assignGroupId
  ) {
    const valObj = assignGroupId as { id?: string | number };
    assignStr =
      typeof valObj.id === 'string'
        ? valObj.id
        : valObj.id
          ? String(valObj.id)
          : '';
  }

  if (!assignStr || !mongoose.isValidObjectId(assignStr)) {
    throw new ForbiddenException('assign_group is required');
  }
  if (!groupIds.includes(assignStr)) {
    throw new ForbiddenException('insufficient group access');
  }
}

export async function ensureValidHookIds(
  hookIds: unknown,
  hookModel: Model<HookDocument>,
): Promise<mongoose.Types.ObjectId[]> {
  if (!Array.isArray(hookIds) || hookIds.length === 0) {
    throw new BadRequestException('hook_ids is required');
  }
  const normalized = hookIds
    .map((id) => (typeof id === 'string' ? id.trim() : String(id)))
    .filter(Boolean);
  const invalid = normalized.filter((id) => !mongoose.isValidObjectId(id));
  if (invalid.length > 0) {
    throw new BadRequestException('Invalid hook identifier');
  }
  const hooks = await hookModel
    .find({ _id: { $in: normalized } })
    .select('_id');
  if (hooks.length !== normalized.length) {
    throw new BadRequestException('Hook not found');
  }
  return hooks.map((hook) => hook._id);
}

/**
 * `assign_group` is an id, and only a string is normalised — everything else is
 * handed to `findById` exactly as it arrived, which is what legacy does.
 *
 * Unwrapping an OBJECT (`{ id, name }`) into its `id` would be a quiet contract
 * change, not a convenience: `mongoose.isValidObjectId({ id, name })` answers
 * TRUE, so legacy walks straight into `findById` and answers 400 with
 * `Cast to ObjectId failed for value "{ id: '…', name: '…' }" (type Object) …`.
 * Accepting the object instead means the two backends disagree about what the
 * field IS, and a caller that sends the expanded shape gets a row written on one
 * and rejected on the other. The cast error is raised by Mongoose and surfaced
 * by `MongooseErrorInterceptor` on the write handlers that call this.
 */
export async function resolveAssignGroup(
  value: unknown,
  groupModel: Model<GroupDocument>,
): Promise<{ id: mongoose.Types.ObjectId | undefined; name: string }> {
  if (!value) return { id: undefined, name: '' };
  const groupId = typeof value === 'string' ? value.trim() : value;

  if (!mongoose.isValidObjectId(groupId)) {
    throw new BadRequestException('Invalid assign_group identifier');
  }
  const group = await groupModel
    .findById(groupId as string)
    .select('_id group_name');
  if (!group) {
    throw new BadRequestException('Group not found');
  }
  return { id: group._id, name: group.group_name };
}

/**
 * [FEAT-20260825-MULTIGROUP] หลายกลุ่มเว็บใน job เดียว — ตัวแปลงและตัวกัน
 * ===========================================================================
 * เจ้าของ 25/08: *"กลุ่มเว็บต้อง multi check เลือกได้หลายกลุ่ม fe be รองรับทำงานจริง"* ·
 * *"ตกลงไม่สร้างหนี้และไม่กระทบ seamless"*
 *
 * 🔴 `assign_group` ไม่ใช่ป้ายชื่อ มันคือ **ตัวคุมการมองเห็น**
 *    `broadcasts-read.service.ts` กรองด้วย `assign_group.id ∈ user.groups`
 *    สำหรับทุกคนที่ไม่ใช่ superadmin ⇒ ถ้าย้ายบ้านคีย์นี้แบบมักง่าย แคมเปญเก่า
 *    ทุกใบจะ **หายไปจากหน้าจอ** โดยไม่มี error ⇒ ของใหม่ต้องอยู่ **เพิ่ม** ไม่ใช่ **แทน**
 *
 * 🔴 กันสิทธิ์รั่ว: ต้องเช็ค **ทุก id** ไม่ใช่ตัวแรก ไม่งั้นแอดมินผูกแคมเปญเข้า
 *    กลุ่มที่ตัวเองไม่มีสิทธิ์ได้ โดยแอบไว้ในตัวที่ 2 ของลิสต์
 *    เช็คไม่ครบ = ประตูที่ล็อกไว้ใบเดียวจากสิบใบ.
 */

/** ค่าที่ FE ส่งมา (เดี่ยวหรือลิสต์) → ลิสต์กลุ่มที่ตรวจแล้วว่ามีจริง */
export async function resolveAssignGroups(
  value: unknown,
  groupModel: Model<GroupDocument>,
): Promise<Array<{ id: mongoose.Types.ObjectId; name: string }>> {
  /* absent ≠ [] — ไม่ส่งมาเลย แปลว่า "ไม่แตะ" ไม่ใช่ "ล้างทิ้ง" ตัวเรียกเป็นคนแยก */
  if (value === undefined || value === null) return [];

  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: Array<{ id: mongoose.Types.ObjectId; name: string }> = [];

  for (const item of raw) {
    /* รับได้ทั้ง id ดิบ และ `{id,name}` แบบที่แถวเก่าเก็บไว้ — ฟอร์มเก่าที่ยังไม่
       อัปเดตจะส่งแบบหลัง และต้องไม่พัง */
    const idish =
      typeof item === 'object' && item !== null && 'id' in item
        ? (item as { id: unknown }).id
        : item;
    if (idish === undefined || idish === null || idish === '') continue;

    const key = String(idish);
    /* ติ๊กซ้ำจาก UI ไม่ควรกลายเป็นสองแถวใน DB */
    if (seen.has(key)) continue;
    seen.add(key);

    const one = await resolveAssignGroup(idish, groupModel);
    if (one.id) out.push({ id: one.id, name: one.name });
  }
  return out;
}

/**
 * กันสิทธิ์ — **ทุกกลุ่มในลิสต์** ต้องผ่าน ไม่ใช่แค่ตัวแรก
 *
 * ⚠️ ลิสต์ว่างไม่ผ่านฟรี — มันหมายถึง "ไม่ได้เลือกกลุ่ม" ซึ่งตัวเรียกเป็นคนตัดสิน
 *    ว่ายอมได้ไหม ที่นี่แค่ไม่ตัดสินแทน
 */
export function ensureAssignGroupsAccess(
  user: AuthenticatedUser | null | undefined,
  groups: ReadonlyArray<{ id: unknown }>,
): void {
  for (const g of groups) {
    /**
     * 🔴 ส่ง **hex string** ไม่ใช่ `ObjectId` ดิบ
     *
     * `ensureAssignGroupAccess` มี branch `'id' in assignGroupId` ไว้รับรูป
     * `{id,name}` — และ `ObjectId` **ก็มี property ชื่อ `id`** (เป็น Buffer ของ
     * ไบต์ดิบ) ⇒ ส่ง ObjectId ตรง ๆ จะตกเข้า branch นั้น อ่านได้ค่าว่าง แล้ว
     * ปฏิเสธทุกครั้งด้วยข้อความ "assign_group is required" ทั้งที่สิทธิ์ถูกต้อง
     * เจอจริง 25/08 ตอนเขียนเทส — ไม่ใช่ทฤษฎี
     * ObjectId มี .id ที่ไม่ใช่สิ่งที่เราหมายถึง ⇒ แปลงเป็นสตริงก่อนเสมอ.
     */
    ensureAssignGroupAccess(user, String(g.id));
  }
}

/**
 * [FIX-20260823-BCASTOASCOPE] Can this caller touch this broadcast at all?
 * ===========================================================================
 * 🔴 SIX ENDPOINTS READ OR CHANGE ONE JOB BY ID AND NONE OF THEM CHECKED.
 *    `broadcast.manage` says the account may manage broadcasts; it says
 *    nothing about WHICH OAs. `listBroadcasts` has always narrowed by OA, so
 *    an operator scoped to one OA saw only their own jobs — and could then
 *    open, preview, EDIT, DELETE or SEND anybody else's by pasting the id.
 *    The list looked like a boundary and was only a filter.
 *    เห็นเฉพาะของตัวเอง แต่ถ้ารู้ id ก็เปิด/ลบ/ยิงของคนอื่นได้.
 *
 * 🔴 TWO RULES, ON PURPOSE — and they were already both here, unnamed:
 *
 *    READ  → **any** hook allowed. This is exactly what `listBroadcasts`
 *            does (`hook_ids: {$in: allowed}` matches when ONE element does).
 *            Anything stricter would show a job in the list and 403 it on
 *            open, which is a worse bug than the one being fixed.
 *    WRITE → **every** hook allowed (`ensureAllowedHookIds`). Editing or
 *            sending a job that also reaches an OA you cannot see means acting
 *            on that OA's followers.
 *    อ่าน = แตะสักตัวก็พอ · แก้/ส่ง = ต้องได้ทุกตัว.
 *
 * ⚠️ A SUPERUSER SHORT-CIRCUITS via `getAllowedHookIds` returning `null`, the
 *    same way every other call site here treats it. `null` means "no scoping
 *    applies", NOT "nothing is allowed" — reading it as an empty list would
 *    lock superadmins out of everything.
 */
export async function ensureCanReadBroadcast(
  user: AuthenticatedUser | null | undefined,
  hookIds: unknown,
  hookModel: Model<HookDocument>,
): Promise<void> {
  const allowed = await getAllowedHookIds(user, hookModel);
  if (allowed === null) return;

  const ids = Array.isArray(hookIds) ? hookIds.map((id) => String(id)) : [];
  /* A job with no OA at all is nobody's: refusing is the narrower answer, and
     no working job is in that state. งานที่ไม่มี OA = ไม่ใช่ของใคร ปฏิเสธไว้ก่อน. */
  if (ids.length === 0 || !ids.some((id) => allowed.includes(id))) {
    throw new ForbiddenException('insufficient OA access');
  }
}

/**
 * The stricter gate, for anything that CHANGES a job or sends it.
 *
 * Every hook must be reachable — a job spanning an OA you cannot see is a job
 * whose edit reaches followers you were never granted.
 */
export async function ensureCanWriteBroadcast(
  user: AuthenticatedUser | null | undefined,
  hookIds: unknown,
  hookModel: Model<HookDocument>,
): Promise<void> {
  const allowed = await getAllowedHookIds(user, hookModel);
  if (allowed === null) return;

  const ids = Array.isArray(hookIds) ? hookIds.map((id) => String(id)) : [];
  if (ids.length === 0 || ids.some((id) => !allowed.includes(id))) {
    throw new ForbiddenException('insufficient OA access');
  }
}

/**
 * [FEAT-20260824-BCASTMULTIOA] Resolve "these groups" into "these OAs", at SAVE.
 *
 * Owner, 24/08: *"เป้าหมมาย job เลือกได้หลาย group หลาย hook oa ใน job เดียว"*.
 *
 * 🔴 SAVE TIME, NOT SEND TIME, AND THE REASON IS AUTHORISATION. Every OA a job
 *    will ever touch has to be inside the scope of the admin who set it up —
 *    the owner's standing rule ("group/hook oa ที่เลือกได้ใน job ต้องมีในสิทธิ์ของ
 *    admin ที่ login เท่านั้น"). A cron tick has no admin in the room, so a group
 *    expanded at send time could reach an OA that joined the group AFTER the job
 *    was authorised — a silent widening nobody approved. Expanding here and
 *    storing the union means what runs is exactly what was checked.
 *    ขยายตอนเซฟ = ตรวจสิทธิ์ได้จริง · ขยายตอน cron = ไม่มีใครให้ตรวจ.
 *
 * 🔴 IT ALSO KEEPS THE SEND LOOP FREE OF ONE MORE QUERY. The run path already
 *    pages members and reads tokens per OA; adding a group lookup there would
 *    put a query on the hot path for a value that cannot change during a run.
 *    ไม่เพิ่ม query ในลูปส่ง.
 *
 * ⚠️ THE GROUPS THEMSELVES ARE KEPT ON THE JOB. `target.group_ids` stays stored
 *    so the form can show what was chosen and an audit can say "a group was
 *    picked", while `hook_ids` carries the resolved answer. Two questions, two
 *    columns — do not collapse them.
 *
 * ⚠️ Returns the SAME array instance semantics as the input when there is
 *    nothing to expand, so a job with no groups is byte-identical to today.
 *
 * revert: stop calling this; jobs then address exactly their `hook_ids`.
 */
export async function expandGroupsIntoHookIds(
  explicitHookIds: readonly unknown[],
  target: { mode?: string; group_ids?: unknown[] } | undefined,
  hookModel: Model<HookDocument>,
  cap?: number,
): Promise<{
  hookIds: mongoose.Types.ObjectId[];
  addedFromGroups: number;
  truncated?: number;
}> {
  const query = oaGroupExpansionQuery(target?.group_ids);
  if (query === null || target?.mode !== 'group') {
    /* Nothing to expand. Handing back the input unchanged rather than a merged
       copy keeps a job with no groups exactly as it is today. */
    return {
      hookIds: explicitHookIds as mongoose.Types.ObjectId[],
      addedFromGroups: 0,
    };
  }

  const rows = (await hookModel
    .find(query.filter)
    .select(query.projection)
    .lean()
    .exec()) as unknown as Array<{ _id: unknown }>;

  const merged = mergeOaSelection(explicitHookIds, rows, cap);
  /* Back to ObjectIds: `hook_ids` is an ObjectId ref path, and handing Mongoose
     hex strings makes it reject the write. The merge works in hex because that
     is the only form both inputs share. รวมด้วย hex แล้วแปลงกลับเป็น ObjectId ก่อนเขียน. */
  return {
    hookIds: merged.hookIds.map((id) => new mongoose.Types.ObjectId(id)),
    addedFromGroups: merged.addedFromGroups,
    ...(merged.truncatedToHooks === undefined
      ? {}
      : { truncated: merged.truncatedToHooks }),
  };
}
