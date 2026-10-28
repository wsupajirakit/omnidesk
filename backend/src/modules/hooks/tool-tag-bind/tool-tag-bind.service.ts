/**
 * [FEAT-20261016-TAGBIND] The "ผูก tag" button — binds the provider template's dynamic tags to
 * every OA that uses one custom tool. The decisions are in `tag-bind-plan.ts` (pure); this file
 * only reads, hands the plan the rows, and writes what it returned.
 *
 * Who calls it: `POST /api/custom-tool-tag-bind/:toolId` (the button) and the mint
 * (`../tool-mint/tool-mint.service.ts`), which runs it right after creating a tool so the
 * template's tags exist before any OA is switched over (no OA yet ⇒ inserts only).
 *
 * 🔴 ABSENT = TODAY. A provider without a mint template (shop-api) gets a 404 before anything is
 *    read — no tag is ever written on shop-api by this file.
 * Writes: `dynamic_tags` only — insert missing template tags, `$addToSet` OAs onto template
 * tags. Never `hooks`, never `custom_tools`, never removes an OA. One audit row per tag that
 * actually changed (same parent/shape as `DynamicTagsService`), none for a no-op re-run.
 *
 * revert: delete this folder and its two lines in `hooks.module.ts`.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { providerToolMint } from '@/modules/customer-provider';

import {
  type AuditRequestMetaInput,
  HookAuditLogService,
  actorObjectId,
  buildActor,
} from '../hook-audit-log.service';
import { CustomTool } from '../schemas/custom-tool.schema';
import { DynamicTag } from '../schemas/dynamic-tag.schema';
import { Hook } from '../schemas/hook.schema';
import {
  planTagBind,
  type ExistingTagRow,
  type TagBindAction,
  type TagBindSkipReason,
} from './tag-bind-plan';

/** Same parent string as `DynamicTagsService` — the tag's history stays one list. */
const AUDIT_PARENT = 'dynamic_tag';

export interface TagBindReport {
  tool: { id: string; name: string };
  /** the OAs that use the tool (alias, else id) */
  hooks: string[];
  inserted: string[];
  bound: string[];
  already: string[];
  skipped: { tag: string; reason: TagBindSkipReason }[];
}

@Injectable()
export class ToolTagBindService {
  constructor(
    @InjectModel(DynamicTag.name) private readonly tagModel: Model<DynamicTag>,
    @InjectModel(CustomTool.name) private readonly toolModel: Model<CustomTool>,
    @InjectModel(Hook.name) private readonly hookModel: Model<Hook>,
    private readonly audit: HookAuditLogService,
  ) {}

  async bindToolTags(
    toolId: string,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<TagBindReport> {
    const decl = providerToolMint();
    if (!decl)
      throw new NotFoundException('ไซต์นี้ไม่มีชุด tag ของ tool ให้ผูก');
    if (!isValidObjectId(toolId))
      throw new BadRequestException('Invalid tool id');

    const tool = await this.toolModel
      .findOne({ _id: toolId, deleted_at: null })
      .select('_id name endpoints.key')
      .lean<{
        _id: Types.ObjectId;
        name: string;
        endpoints?: { key?: string }[];
      }>()
      .exec();
    if (!tool) throw new NotFoundException('ไม่พบ custom tool');

    const hooks = await this.hookModel
      .find({ custom_tool_id: tool._id })
      .select('_id alias')
      .lean<{ _id: unknown; alias?: string }[]>()
      .exec();
    /* every row holding one of the names — deleted ones too, or a reserved name is invisible */
    const existing = await this.tagModel
      .find({ tag: { $in: decl.template.tags.map((t) => t.tag) } })
      .select('_id tag detail hook_id hook_ids deleted_at')
      .lean<ExistingTagRow[]>()
      .exec();

    const now = new Date();
    const actions = planTagBind({
      template: decl.template,
      toolEndpointKeys: (tool.endpoints ?? []).map((e) => String(e.key ?? '')),
      existing,
      hookIds: hooks.map((h) => h._id),
      now,
    });
    await this.apply(actions, user, meta);

    const pick = (k: TagBindAction['kind']) =>
      actions.filter((a) => a.kind === k).map((a) => a.tag);
    return {
      tool: { id: String(tool._id), name: tool.name },
      hooks: hooks.map((h) => h.alias || String(h._id)),
      inserted: pick('insert'),
      bound: pick('bind'),
      already: pick('already'),
      skipped: actions.flatMap((a) =>
        a.kind === 'skip' ? [{ tag: a.tag, reason: a.reason }] : [],
      ),
    };
  }

  private async apply(
    actions: TagBindAction[],
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<void> {
    const actorId = actorObjectId(user);
    const actor = buildActor(user);
    for (const a of actions) {
      if (a.kind === 'insert') {
        const created = await this.tagModel.create({
          ...a.doc,
          created_by: actorId,
          updated_by: actorId,
        } as unknown as DynamicTag);
        await this.audit.write({
          ref_id: created._id,
          parent: AUDIT_PARENT,
          action: 'create',
          changed_fields: [
            { field: 'tag', from: null, to: a.tag },
            { field: 'hook_ids', from: null, to: a.doc['hook_ids'] },
          ],
          actor,
          request_meta: meta,
          note: `ผูก tag จาก template: สร้าง ${a.tag} (โดย ${actor.display_name || actor.username})`,
        });
      } else if (a.kind === 'bind') {
        await this.tagModel
          .updateOne(
            { _id: a.id },
            {
              $addToSet: { hook_ids: { $each: a.add } },
              /* updated_at: the schema's own timestamps stamp it */
              $set: { updated_by: actorId },
            },
          )
          .exec();
        await this.audit.write({
          ref_id: a.id,
          parent: AUDIT_PARENT,
          action: 'update',
          changed_fields: [
            { field: 'hook_ids', from: a.before, to: [...a.before, ...a.add] },
          ],
          actor,
          request_meta: meta,
          note: `ผูก tag จาก template: เพิ่ม OA ${a.add.length} ตัวให้ ${a.tag} (โดย ${actor.display_name || actor.username})`,
        });
      }
    }
  }
}
