import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId } from 'mongoose';

import type { AuthenticatedUser } from '@/common';

import { AuditLogService } from '@/modules/audit';

import { GroupsService } from '../groups.service';
import {
  buildActor,
  type AuditRequestMetaInput,
} from '../hook-audit-log.service';
import { DynamicTag } from '../schemas/dynamic-tag.schema';
import { FlexMessage } from '../schemas/flex-message.schema';

/**
 * [FEAT-20260816-GROUPSCOPECLONE] Copy one group's scope onto other groups.
 *
 * WHAT IT DOES
 * A dynamic tag or a flex card reaches an OA when its `group_ids` holds that
 * OA's group — `dynamic-tags.service.ts:179-195` for tags, `customer-helper-
 * flex.ts:167` for the runtime card pick, `flex-messages.service.ts:326` for the
 * dashboard list. So "give group B everything group A has" needs exactly one
 * write: add B's id to every document that already carries A's id.
 *
 * WHY IT IS ITS OWN SERVICE
 * Nothing here edits a tag or a card as such, so it does not belong in the
 * services that own those documents; it is a group-level operation that happens
 * to touch two collections. Keeping it in its own folder means the whole feature
 * can be deleted by deleting the folder and one line in `hooks.module.ts` — and
 * `dynamic-tags.service.ts` / `flex-messages.service.ts` stay byte-identical.
 *
 * ⚠️ ADD, NEVER REPLACE — the opposite of the sibling `POST
 * /api/dynamic-tags/bulk-scope`, which overwrites the whole scope with whatever
 * was ticked. The two operations look alike on screen, so the difference is
 * enforced here (`$addToSet`, one target at a time) and pinned by
 * `z-test/unit/group-scope-clone.spec.ts` (T1, T2). Changing this to `$set`
 * would silently strip every OTHER group's access from 800+ live documents.
 *
 * REVERT / UNDO
 * `mode: 'remove'` with the SAME body is the exact inverse: it pulls the target
 * ids back out of the documents that the source scope selects. That is the
 * intended undo for an operator who copied onto the wrong group, and it is what
 * makes a several-hundred-row write acceptable at all (T6 proves the round trip
 * restores the documents byte for byte).
 *
 * NOT TOUCHED, ON PURPOSE: `hook_ids` / `hook_id` (per-OA scope stays personal
 * to each document) and the legacy single `group_id` (folding it in would
 * double-count; it is only ever READ here, to find tags that predate
 * `group_ids`). Custom tools are deliberately out of scope: they carry no group
 * field at all (`custom-tool.schema.ts:319-322` — the hook→tool link lives on
 * the hook), so there is nothing to tick for a group.
 */

export type ScopeCloneMode = 'add' | 'remove';

export interface ScopeCloneBody {
  source_group_id?: unknown;
  target_group_ids?: unknown;
  include?: unknown;
  mode?: unknown;
}

export interface ScopeCloneTargetResult {
  group_id: string;
  dynamic_tags: number;
  flex_messages: number;
}

export interface ScopeCloneResult {
  /** false = preview (nothing was written), true = the write happened */
  applied: boolean;
  mode: ScopeCloneMode;
  source_group_id: string;
  /** how much the source has in total — an empty source is a common mistake */
  source_totals: { dynamic_tags: number; flex_messages: number };
  /** per target: rows that WILL change (preview) or DID change (apply) */
  targets: ScopeCloneTargetResult[];
}

interface ParsedRequest {
  sourceId: string;
  targetIds: string[];
  mode: ScopeCloneMode;
  includeTags: boolean;
  includeFlex: boolean;
}

/** `system.manage` / `*` satisfy any requirement — same rule as PermissionsGuard. */
const OVERRIDE_PERMISSIONS = ['system.manage', '*'];

/**
 * The two operations this service performs, and nothing else.
 *
 * The injected values ARE Mongoose models — the token comes from `@InjectModel`,
 * not from this type. Naming only `countDocuments` and `updateMany` keeps the
 * two collections interchangeable in the helpers below (their document types
 * have nothing in common, so `Model<A> | Model<B>` is not callable), and states
 * on the page that this feature can neither read documents out nor `$set` a
 * field.
 */
interface ScopedModel {
  countDocuments(filter: Record<string, unknown>): { exec(): Promise<number> };
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): { exec(): Promise<{ modifiedCount?: number } | null> };
}

@Injectable()
export class GroupScopeCloneService {
  private readonly logger = new Logger(GroupScopeCloneService.name);

  constructor(
    @InjectModel(DynamicTag.name)
    private readonly tagModel: ScopedModel,
    @InjectModel(FlexMessage.name)
    private readonly flexModel: ScopedModel,
    private readonly groupsService: GroupsService,
    /**
     * The SAME writer the rest of the group lifecycle uses
     * (`groups.service.ts:250` create / `:361` update), not the tag-side one:
     * a `parent:'group'` row belongs on the group's own audit trail, written by
     * one path, or an operator reading that trail sees create and delete but not
     * the day somebody handed their group 800 tags.
     */
    private readonly audit: AuditLogService,
  ) {}

  async preview(
    body: ScopeCloneBody,
    user: AuthenticatedUser | undefined,
  ): Promise<ScopeCloneResult> {
    return this.run(body, user, undefined, false);
  }

  async apply(
    body: ScopeCloneBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput,
  ): Promise<ScopeCloneResult> {
    return this.run(body, user, meta, true);
  }

  // ───────────────────────────── internals ─────────────────────────────

  private has(
    user: AuthenticatedUser | undefined,
    permission: string,
  ): boolean {
    const granted = user?.permissions ?? [];
    return (
      granted.some((p) => OVERRIDE_PERMISSIONS.includes(p)) ||
      granted.includes(permission)
    );
  }

  private parse(body: ScopeCloneBody): ParsedRequest {
    const sourceId =
      typeof body.source_group_id === 'string'
        ? body.source_group_id.trim()
        : '';
    if (!sourceId) throw new BadRequestException('source_group_id is required');
    if (!isValidObjectId(sourceId)) {
      throw new BadRequestException('Invalid source_group_id');
    }

    const raw = Array.isArray(body.target_group_ids)
      ? body.target_group_ids
      : [];
    const targetIds = [
      ...new Set(
        raw
          .filter((id) => typeof id === 'string')
          .map((id) => String(id).trim()),
      ),
    ].filter(Boolean);
    if (targetIds.length === 0) {
      throw new BadRequestException('target_group_ids is required');
    }
    if (targetIds.some((id) => !isValidObjectId(id))) {
      throw new BadRequestException('Invalid group id in target_group_ids');
    }
    /**
     * The source may not also be a target. Under `add` that would be a no-op,
     * but under `remove` it would pull the SOURCE group out of its own tags —
     * the one way this endpoint could destroy the scope it exists to copy.
     */
    if (targetIds.includes(sourceId)) {
      throw new BadRequestException(
        'source_group_id cannot also appear in target_group_ids',
      );
    }

    const mode = body.mode === undefined ? 'add' : body.mode;
    if (mode !== 'add' && mode !== 'remove') {
      throw new BadRequestException("mode must be 'add' or 'remove'");
    }

    const include =
      body.include && typeof body.include === 'object'
        ? (body.include as Record<string, unknown>)
        : {};
    // Both sides default to ON: the request is "copy the permissions", and a
    // caller who means half of it says so.
    const includeTags = include['dynamic_tags'] !== false;
    const includeFlex = include['flex_messages'] !== false;
    if (!includeTags && !includeFlex) {
      throw new BadRequestException('nothing selected to copy');
    }

    return { sourceId, targetIds, mode, includeTags, includeFlex };
  }

  /**
   * Group access is delegated to `GroupsService.getGroupById`, not re-implemented:
   * that method already applies `ensureGroupMembership` (groups.service.ts:169) and
   * rejects a group the caller does not belong to. A second copy of that rule here
   * would be a second place to get tenant isolation wrong.
   */
  private async assertGroupsVisible(
    ids: string[],
    user: AuthenticatedUser | undefined,
  ): Promise<void> {
    for (const id of ids) {
      await this.groupsService.getGroupById(id, user);
    }
  }

  /** Every document the SOURCE group can reach, per collection convention. */
  private scopeFilter(
    kind: 'tag' | 'flex',
    sourceId: string,
  ): Record<string, unknown> {
    return kind === 'tag'
      ? {
          // tags mark deletion with an explicit null, and predate `group_ids`
          deleted_at: null,
          $or: [{ group_ids: sourceId }, { group_id: sourceId }],
        }
      : {
          // flex marks deletion by ABSENCE — `flex-messages.service.ts:373`
          deleted_at: { $exists: false },
          group_ids: sourceId,
        };
  }

  /**
   * The rows this target still needs. Expressed as a top-level `$and` because
   * the source condition and the target condition are both about `group_ids` —
   * merging them into one object literal would drop the source half.
   */
  private pendingFilter(
    kind: 'tag' | 'flex',
    sourceId: string,
    targetId: string,
    mode: ScopeCloneMode,
  ): Record<string, unknown> {
    return {
      $and: [
        this.scopeFilter(kind, sourceId),
        mode === 'add'
          ? { group_ids: { $ne: targetId } }
          : { group_ids: targetId },
      ],
    };
  }

  private async countIn(
    model: ScopedModel,
    filter: Record<string, unknown>,
  ): Promise<number> {
    return model.countDocuments(filter).exec();
  }

  private async moveOne(
    model: ScopedModel,
    filter: Record<string, unknown>,
    targetId: string,
    mode: ScopeCloneMode,
  ): Promise<number> {
    const update =
      mode === 'add'
        ? { $addToSet: { group_ids: targetId } }
        : { $pull: { group_ids: targetId } };
    const res = await model.updateMany(filter, update).exec();
    return Number(res?.modifiedCount ?? 0);
  }

  private async run(
    body: ScopeCloneBody,
    user: AuthenticatedUser | undefined,
    meta: AuditRequestMetaInput | undefined,
    write: boolean,
  ): Promise<ScopeCloneResult> {
    const { sourceId, targetIds, mode, includeTags, includeFlex } =
      this.parse(body);

    // The endpoint is guarded by `group.manage`, but the documents it writes
    // belong to two other features — so each side is checked against ITS OWN
    // permission. Without this, `group.manage` alone would be a way to hand out
    // tags and cards the caller may not edit anywhere else.
    if (includeTags && !this.has(user, 'dynamic_tags.manage')) {
      throw new ForbiddenException('dynamic_tags.manage is required');
    }
    if (includeFlex && !this.has(user, 'flex.manage')) {
      throw new ForbiddenException('flex.manage is required');
    }

    await this.assertGroupsVisible([sourceId, ...targetIds], user);

    const sourceTotals = {
      dynamic_tags: includeTags
        ? await this.countIn(this.tagModel, this.scopeFilter('tag', sourceId))
        : 0,
      flex_messages: includeFlex
        ? await this.countIn(this.flexModel, this.scopeFilter('flex', sourceId))
        : 0,
    };

    const targets: ScopeCloneTargetResult[] = [];
    for (const targetId of targetIds) {
      const tagFilter = this.pendingFilter('tag', sourceId, targetId, mode);
      const flexFilter = this.pendingFilter('flex', sourceId, targetId, mode);

      let tagCount = 0;
      let flexCount = 0;
      if (write) {
        // The filter already excludes rows that need nothing, so modifiedCount
        // is the honest "how many actually moved" for this target.
        if (includeTags) {
          tagCount = await this.moveOne(
            this.tagModel,
            tagFilter,
            targetId,
            mode,
          );
        }
        if (includeFlex) {
          flexCount = await this.moveOne(
            this.flexModel,
            flexFilter,
            targetId,
            mode,
          );
        }
      } else {
        if (includeTags)
          tagCount = await this.countIn(this.tagModel, tagFilter);
        if (includeFlex)
          flexCount = await this.countIn(this.flexModel, flexFilter);
      }

      targets.push({
        group_id: targetId,
        dynamic_tags: tagCount,
        flex_messages: flexCount,
      });

      if (write) {
        this.logger.log(
          `[SCOPECLONE] ${mode} ${sourceId} -> ${targetId}: tags=${tagCount} flex=${flexCount}`,
        );
        /**
         * One audit row per TARGET group, and ONLY when something actually
         * moved — the same rule bulk-scope states at `dynamic-tags.service.ts:786`
         * ("no real change means no audit entry"), because this operation is
         * idempotent by design and re-running it would otherwise fill the trail
         * with rows recording nothing.
         *
         * The counted fields are named after what they count, not after the
         * `group_ids` array they are stored in: on a GROUP's audit trail
         * "group_ids changed" would read as a field of the group document, which
         * it is not — the ids were written onto tags and cards elsewhere.
         *
         * Fire-and-forget with a swallowed error, exactly like the group
         * create/update rows: an audit failure must not roll back a write that
         * already happened, and it must not fail the operator's request.
         */
        if (tagCount > 0 || flexCount > 0) {
          const actor = buildActor(user);
          const granted = mode === 'add';
          void this.audit
            .createAuditLog({
              ref_id: targetId,
              group_id: targetId,
              parent: 'group',
              action: 'update',
              changed_fields: [
                { field: 'scope_clone_source_group', from: null, to: sourceId },
                { field: 'scope_clone_mode', from: null, to: mode },
                {
                  field: 'dynamic_tags_granted',
                  from: null,
                  to: granted ? tagCount : -tagCount,
                },
                {
                  field: 'flex_messages_granted',
                  from: null,
                  to: granted ? flexCount : -flexCount,
                },
              ],
              actor,
              request_meta: meta,
              note:
                `${granted ? 'Copied' : 'Removed'} group scope ` +
                `${granted ? 'from' : 'of'} group ${sourceId}: ` +
                `${tagCount} dynamic tags, ${flexCount} flex messages ` +
                `(by ${actor.display_name || actor.username})`,
            })
            .catch(() => undefined);
        }
      }
    }

    return {
      applied: write,
      mode,
      source_group_id: sourceId,
      source_totals: sourceTotals,
      targets,
    };
  }
}
