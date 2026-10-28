import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { isSuperUser, type AuthenticatedUser } from '@/common';

import { Hook, type HookDocument } from '../schemas/hook.schema';

/**
 * ==== [FEAT-20260817-HOOKLABELS] the OA labels, and nothing else ==============
 *
 * WHY THIS EXISTS — measured, not guessed:
 *   one hook document is **105.7 KB** on the dev database, and 89 KB of that is AI
 *   prompt text (`suggestion_company_text` 46 KB, `suggestion_text` 34 KB,
 *   `ai_raw_json_rules` 9 KB). `GET /hook` returns them whole: **376.8 KB for six
 *   OAs**, and `getAllHooks()` is called by 11 dashboard pages — most of them only
 *   to write an OA name into a dropdown or a hover card. The audit page needs
 *   exactly three fields, which weigh **81 bytes** per hook.
 *
 * So this returns the labels only. Same rows, same scoping, ~1 KB instead of 377.
 *
 * WHY A NEW ENDPOINT rather than a `fields=` parameter on the main list: that list
 * is compared value-for-value against the legacy backend by the golden suite, and
 * a projection there would change the shape every existing caller receives. A
 * separate slim route changes nothing for anyone who does not call it — the same
 * shape `/hook/tags` and `/hook/field-tabs` already use.
 *
 * SCOPING IS COPIED, NOT REINVENTED: superuser sees everything; anyone else is
 * limited to their own groups, and an account with no group is refused — the exact
 * rule `hooks.service.ts:383-392` applies to the full list. Both `group` shapes
 * are matched because the column holds ObjectIds on app-written rows and strings on
 * rows written by migration scripts (same comment lives there).
 *
 * ⚠️ NEVER add a field to the projection without checking the size first. The
 * point of this file is that it cannot grow into a second full list.
 * ห้ามเพิ่ม field ลง projection โดยไม่วัดขนาดก่อน — ไฟล์นี้มีไว้เพื่อผอมโดยเฉพาะ.
 *
 * revert: delete this folder, its provider entry in hooks.module.ts, the
 * `@Get('labels')` route, and point the FE back at `getAllHooks()`.
 */

/** The only fields this endpoint is allowed to return. */
const LABEL_FIELDS = [
  'alias',
  'display_name',
  'line_oa_name',
  'company_name',
  'status',
] as const;

export interface HookLabel {
  _id: string;
  alias: string | null;
  display_name: string | null;
  line_oa_name: string | null;
  company_name: string | null;
  status: number | null;
}

@Injectable()
export class HookLabelsService {
  constructor(
    @InjectModel(Hook.name) private readonly hookModel: Model<HookDocument>,
  ) {}

  /**
   * Group ids the caller may see — byte-for-byte the rule `HooksService`'s
   * `getAllowedGroupIds` applies (`hooks.service.ts:267-270`): keep only VALID
   * ObjectIds, as strings.
   *
   * ⚠️ Filtering here rather than later is the load-bearing part, caught in review:
   * an earlier version filtered only the ObjectId branch, so an account whose JWT
   * carried nothing but a malformed group id got an empty list instead of the 403
   * the full list answers — a slim endpoint quietly disagreeing with the fat one
   * about who has access. กรองก่อนเช็คว่าง ไม่งั้นสิทธิ์ไม่ตรงกับ list เดิม.
   */
  private allowedGroupIds(user?: AuthenticatedUser): string[] {
    const groups = Array.isArray(user?.groups) ? user.groups : [];
    return groups
      .filter((id) => Types.ObjectId.isValid(String(id)))
      .map((id) => String(id));
  }

  async listLabels(user?: AuthenticatedUser): Promise<HookLabel[]> {
    const filter: Record<string, unknown> = {};

    if (!isSuperUser(user)) {
      const allowed = this.allowedGroupIds(user);
      if (allowed.length === 0) {
        throw new ForbiddenException('group access is required');
      }
      // Both shapes, both from the SAME filtered list — the column holds
      // ObjectIds on app-written rows and strings on migrated ones.
      const objectIds = allowed.map((id) => new Types.ObjectId(id));
      filter['$or'] = [
        { group: { $in: objectIds } },
        { group: { $in: allowed } },
      ];
    }

    const rows = await this.hookModel
      .find(filter)
      .select(LABEL_FIELDS.join(' '))
      .sort({ display_name: 1 })
      .lean<Array<Record<string, unknown>>>()
      .exec();

    return rows.map((row) => ({
      _id: String(row['_id']),
      alias: (row['alias'] as string) ?? null,
      display_name: (row['display_name'] as string) ?? null,
      line_oa_name: (row['line_oa_name'] as string) ?? null,
      company_name: (row['company_name'] as string) ?? null,
      status: (row['status'] as number) ?? null,
    }));
  }
}
