import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types, isValidObjectId } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { escapeRegex } from '@/common/utils';
import { AuditLogService } from '@/modules/audit';
import { buildActor, getAllowedHookIds } from '@/modules/hooks';
import { Hook, type HookDocument } from '@/modules/hooks';
import { objectScopeFilter } from './object-scope';
import type { CreateObjectCategoryDto, UpdateObjectCategoryDto } from './dto';
import {
  ObjectCategory,
  type ObjectCategoryDocument,
} from './schemas/object-category.schema';

/**
 * [FIX-20260901-OBJSCOPEWRITE] Ids the schema will accept.
 *
 * Both scope columns are ObjectId ref paths, and handing Mongoose hex strings
 * makes it reject the write. Invalid entries are dropped rather than throwing:
 * the pickers only send ids they were handed, so a malformed one means a
 * corrupt payload, not a user mistake worth a 400.
 */
function toObjectIds(input: readonly string[]): Types.ObjectId[] {
  return input
    .filter((id) => isValidObjectId(id))
    .map((id) => new Types.ObjectId(String(id)));
}

export interface SanitizedObjectCategory {
  id: unknown;
  name: string;
  api_key: string;
  /* [FEAT-20260901-OBJSCOPE] The scope has to travel BOTH ways. This interface
     and the object built in `sanitizeCategory` are a pick-list: a field the
     schema stores and this shape omits is saved correctly and then vanishes on
     the way back, so the form re-opens blank and the next save writes the blank
     over the real value. Add a field to the schema ⇒ add it here too. */
  group_providers: unknown[];
  hook_ids: unknown[];
  status: boolean;
  created_by?: string;
  created_at?: Date;
  updated_at?: Date;
}

@Injectable()
export class ObjectCategoriesService {
  constructor(
    @InjectModel(ObjectCategory.name)
    private readonly categoryModel: Model<ObjectCategoryDocument>,
    /* [FEAT-20260901-OBJSCOPE] Needed to turn "the caller's groups" into "the
       caller's OAs" — one indexed query per request, never one per row. */
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    // [FEAT-20260808-AUDITSITE] audit_logs writer, matching legacy
    // objectCategoryController.js:3 (auditLogService). Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
  ) {}

  public sanitizeCategory(
    category: ObjectCategoryDocument | null,
  ): SanitizedObjectCategory | null {
    if (!category) return null;
    const raw = (category.toObject
      ? category.toObject()
      : category) as unknown as Record<string, unknown>;

    return {
      id: raw['_id'],
      name: (raw['name'] as string) || '',
      api_key: (raw['api_key'] as string) || '',
      /* [FEAT-20260901-OBJSCOPE] `[]` for an absent scope, so the form gets an
         array to render either way. Absent and `[]` mean the same thing here —
         unrestricted — so flattening them on the way OUT loses nothing. The
         distinction only has to survive in the DB, and it does: nothing writes
         `[]` back unless the admin actually clears the picker. */
      group_providers: Array.isArray(raw['group_providers'])
        ? (raw['group_providers'] as unknown[])
        : [],
      hook_ids: Array.isArray(raw['hook_ids'])
        ? (raw['hook_ids'] as unknown[])
        : [],
      /* Pre-scoping rows carry no `status` key. They are ON — the same answer
         the schema default gives a row that has been saved since. */
      status: raw['status'] !== false,
      created_by: raw['created_by'] as string | undefined,
      created_at: raw['created_at'] as Date | undefined,
      updated_at: raw['updated_at'] as Date | undefined,
    };
  }

  /**
   * [FEAT-20260901-OBJSCOPE] Scoped to the caller.
   *
   * `includeDisabled` is TRUE here on purpose: an admin screen must keep showing
   * a switched-off category, or it becomes impossible to switch back on. Only
   * the LINE runtime hides them.
   *
   * `user` is optional so existing callers that pass nothing keep compiling —
   * but an absent user is treated as a non-superuser with no groups, which is
   * the fail-closed direction.
   */
  public async listCategories(
    nameQuery?: string,
    user?: AuthenticatedUser | null,
  ): Promise<Array<SanitizedObjectCategory | null>> {
    const filters: Record<string, unknown> = { deleted_at: { $exists: false } };
    if (nameQuery) {
      filters['name'] = new RegExp(escapeRegex(nameQuery), 'i');
    }
    Object.assign(filters, await this.scopeFilter(user));
    const categories = await this.categoryModel.find(filters).sort({ name: 1 });
    return categories.map((c) => this.sanitizeCategory(c));
  }

  /**
   * The caller's scope as a filter fragment. ONE `getAllowedHookIds` round trip
   * per request; the rule itself lives in `object-scope/object-scope.filter.ts`
   * and is shared with the album list and the LINE reply path.
   */
  private async scopeFilter(
    user?: AuthenticatedUser | null,
  ): Promise<Record<string, unknown>> {
    const allowedHookIds = await getAllowedHookIds(user, this.hookModel);
    return objectScopeFilter({
      groupIds: user?.groups ?? [],
      allowedHookIds,
      includeDisabled: true,
    });
  }

  /**
   * ⚠️ No `isValidObjectId` guard, on purpose. Legacy `getCategoryById`
   * (legacy-api/src/controllers/content/objectCategoryController.js:31-44)
   * passes the raw param to `findOne`, so a malformed id is a Mongoose
   * `CastError` its catch answers as **500** with the driver's own message.
   * `MongooseReadErrorInterceptor` on the controller keeps that contract.
   */
  public async getCategoryById(
    id: string,
    user?: AuthenticatedUser | null,
  ): Promise<SanitizedObjectCategory> {
    /* [FEAT-20260901-OBJSCOPE] The scope goes INTO the query, not a check after
       loading: a category outside the caller's scope answers 404 exactly like a
       bad id, so the endpoint cannot be used to enumerate what exists. Same
       reasoning as `flex-messages.service.ts:552-561`. */
    const category = await this.categoryModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
      ...(await this.scopeFilter(user)),
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    const sanitized = this.sanitizeCategory(category);
    if (!sanitized) throw new NotFoundException('Category not found');
    return sanitized;
  }

  public async createCategory(
    user: AuthenticatedUser,
    dto: CreateObjectCategoryDto,
  ): Promise<SanitizedObjectCategory> {
    const { name, api_key } = dto;
    if (!name) throw new BadRequestException('name is required');

    const existing = await this.categoryModel.findOne({
      name,
      deleted_at: { $exists: false },
    });
    if (existing) {
      throw new ConflictException('Category already exists');
    }

    /* [FIX-20260901-CREATESCOPE] The scope and the switch are set HERE too.
       The update branch was fixed first and this one was missed, so ticking the
       boxes on the CREATE form stored nothing and reopening the record showed
       them empty — which reads as a display bug and is a write bug.

       `?? true` on status because a create with no answer means "on". The
       schema default says the same, and stating it here keeps the created
       document identical to what a later read produces rather than differing
       by an absent key. */
    const category = new this.categoryModel({
      name,
      api_key: api_key || '',
      group_providers: toObjectIds(dto.group_providers ?? []),
      hook_ids: toObjectIds(dto.hook_ids ?? []),
      status: dto.status ?? true,
      created_by: user.userId || null,
    });

    await category.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'object_category', action:'create', ref_id, actor, note} —
    // additive only, no schema change. Mirrors objectCategoryController.js:68-77.
    // No request_meta on this site. Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: category._id,
        action: 'create',
        parent: 'object_category',
        actor: buildActor(user),
        note: `Created category: ${category.name}`,
      })
      .catch(() => undefined);

    const sanitized = this.sanitizeCategory(category);
    if (!sanitized) throw new BadRequestException('Failed to create category');
    return sanitized;
  }

  public async updateCategory(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateObjectCategoryDto,
  ): Promise<SanitizedObjectCategory> {
    // No id pre-check: legacy has none here, so a malformed id is reported by
    // Mongoose's own cast error rather than a hand-written
    // `Invalid category identifier` that says less. This route is the odd one
    // out only in STATUS — legacy's update catch is 400 (objectCategory
    // Controller.js:132-134) where its get/delete catches are 500 — hence
    // `MongooseErrorInterceptor` here and the read variant on the other two.
    const category = await this.categoryModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    /* [FEAT-20260808-AUDITSITE] changed_fields with legacy's exact conditions
       (objectCategoryController.js:114-131): name recorded only after the
       uniqueness check passes; api_key recorded only when it actually differs.

       [FIX-20260901-AUDITFROMTO] The keys are `from`/`to`, not legacy's
       `old_value`/`new_value`. The sub-schema declares only `field`/`from`/`to`
       (`hook-audit-log.schema.ts:8-17`), and Mongoose drops undeclared paths on
       write — measured against the real database: a row written with
       `old_value`/`new_value` stores as `[{field: 'api_key'}]` and nothing else.
       So the audit recorded WHICH field changed and never what it changed from
       or to. Legacy parity on a key nobody stores is parity with a bug. */
    const changedFields: Array<{
      field: string;
      from: unknown;
      to: unknown;
    }> = [];

    if (dto.name && dto.name !== category.name) {
      const existing = await this.categoryModel.findOne({
        name: dto.name,
        _id: { $ne: category._id },
        deleted_at: { $exists: false },
      });
      if (existing) {
        throw new ConflictException('Category name already exists');
      }
      changedFields.push({ field: 'name', from: category.name, to: dto.name });
      category.name = dto.name;
    }

    if (dto.api_key !== undefined && dto.api_key !== category.api_key) {
      changedFields.push({
        field: 'api_key',
        from: category.api_key,
        to: dto.api_key,
      });
      category.api_key = dto.api_key;
    }

    /* [FIX-20260901-OBJSCOPEWRITE] The scope and the switch are written HERE.
       Without these two blocks the API accepted them, answered 200, and never
       saved anything — this branch copies dto onto the document field by field,
       so anything missing from the list is silently dropped. Found by pressing
       the switch on the list screen: it flipped, the request succeeded, and the
       refetch brought back the old value.

       `!== undefined`, never truthiness: `status: false` and an empty scope are
       both meaningful edits. `[]` means "unrestricted", so treating it as
       "absent, leave alone" would make clearing a scope impossible. */
    if (dto.status !== undefined && dto.status !== category.status) {
      changedFields.push({
        field: 'status',
        from: category.status,
        to: dto.status,
      });
      category.status = dto.status;
    }

    for (const field of ['group_providers', 'hook_ids'] as const) {
      const next = dto[field];
      if (next === undefined) continue;
      const nextIds = toObjectIds(next);
      const currentIds = (category[field] ?? []).map((id) => String(id));
      const nextStrings = nextIds.map(String);
      /* Sorted comparison: re-ticking the same groups in a different order is
         not a change and must not write an audit row claiming it was. */
      if (
        JSON.stringify([...currentIds].sort()) !==
        JSON.stringify([...nextStrings].sort())
      ) {
        changedFields.push({ field, from: currentIds, to: nextStrings });
        category[field] = nextIds;
      }
    }

    await category.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'object_category', action:'update', changed_fields, actor, note} —
    // additive only, no schema change. Only when something changed
    // (objectCategoryController.js:116-131). Fire-and-forget.
    if (changedFields.length > 0) {
      void this.auditLogService
        .createAuditLog({
          ref_id: category._id,
          action: 'update',
          parent: 'object_category',
          changed_fields: changedFields,
          actor: buildActor(user),
          note: `Updated category: ${category.name}`,
        })
        .catch(() => undefined);
    }

    const sanitized = this.sanitizeCategory(category);
    if (!sanitized) throw new BadRequestException('Failed to update category');
    return sanitized;
  }

  /**
   * ⚠️ Unguarded id, same as the getter — legacy `deleteCategory`
   * (objectCategoryController.js:137-165) answers **500** with Mongoose's
   * CastError message. See `getCategoryById`.
   */
  public async deleteCategory(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<void> {
    const category = await this.categoryModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    category.deleted_at = new Date();
    await category.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'object_category', action:'delete', ref_id, actor, note} —
    // additive only, no schema change. Mirrors objectCategoryController.js:149-159.
    // No request_meta on this site. Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: category._id,
        action: 'delete',
        parent: 'object_category',
        actor: buildActor(user),
        note: `Deleted category: ${category.name}`,
      })
      .catch(() => undefined);
  }
}
