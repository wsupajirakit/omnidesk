import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { escapeRegex } from '@/common/utils';
import { AuditLogService } from '@/modules/audit';
import {
  buildActor,
  getAllowedHookIds,
  Group,
  Hook,
  type GroupDocument,
  type HookDocument,
} from '@/modules/hooks';
import { objectScopeFilter } from './object-scope';
import type { CreateObjectImageDto, UpdateObjectImageDto } from './dto';
import {
  ImageStorage,
  type ImageStorageDocument,
} from './schemas/image-storage.schema';
import {
  ObjectCategory,
  type ObjectCategoryDocument,
} from './schemas/object-category.schema';
import {
  ObjectImage,
  type ObjectImageDocument,
} from './schemas/object-image.schema';

export interface SanitizedObjectImage {
  id: unknown;
  detail: string;
  matching_tag: unknown;
  img_path: string;
  storage: string;
  file_type: string;
  categories: Array<{ id: unknown; name: string }>;
  group_providers: Array<{ id: unknown; group_name: string }>;
  /* [FEAT-20260901-OBJSCOPE] Pick-list — a stored field missing from this shape
     is saved and then lost on the way back. See `SanitizedObjectCategory`. */
  hook_ids: unknown[];
  status: boolean;
  created_by?: string;
  response_type: string;
  created_at?: Date;
  updated_at?: Date;
  first_thumb?: string | null;
}

@Injectable()
export class ObjectImagesService {
  constructor(
    @InjectModel(ObjectImage.name)
    private readonly objectImageModel: Model<ObjectImageDocument>,
    @InjectModel(ObjectCategory.name)
    private readonly objectCategoryModel: Model<ObjectCategoryDocument>,
    @InjectModel(Group.name)
    private readonly groupModel: Model<GroupDocument>,
    @InjectModel(ImageStorage.name)
    private readonly imageStorageModel: Model<ImageStorageDocument>,
    /* [FEAT-20260901-OBJSCOPE] Resolves the caller's groups into their OAs —
       one indexed query per request, never one per row. */
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    // [FEAT-20260808-AUDITSITE] audit_logs writer, matching legacy
    // objectImageController.js:7 (auditLogService). Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
  ) {}

  public sanitizeImage(
    image: ObjectImageDocument | null,
  ): SanitizedObjectImage | null {
    if (!image) return null;
    const raw = (image.toObject
      ? image.toObject()
      : image) as unknown as Record<string, unknown>;

    const rawCats = Array.isArray(raw['categories']) ? raw['categories'] : [];
    const categories = rawCats.map((cat: unknown) => {
      if (typeof cat === 'object' && cat !== null && '_id' in cat) {
        const c = cat as { _id: unknown; name?: string };
        return { id: c._id, name: c.name || '' };
      }
      return { id: cat, name: '' };
    });

    const rawGrps = Array.isArray(raw['group_providers'])
      ? raw['group_providers']
      : [];
    const groupProviders = rawGrps.map((grp: unknown) => {
      if (typeof grp === 'object' && grp !== null && '_id' in grp) {
        const g = grp as { _id: unknown; group_name?: string };
        return { id: g._id, group_name: g.group_name || '' };
      }
      return { id: grp, group_name: '' };
    });

    return {
      id: raw['_id'],
      detail: (raw['detail'] as string) || '',
      matching_tag: raw['matching_tag'],
      img_path: (raw['img_path'] as string) || '',
      storage: (raw['storage'] as string) || 'local',
      file_type: (raw['file_type'] as string) || '',
      categories,
      group_providers: groupProviders,
      /* [FEAT-20260901-OBJSCOPE] Not populated — the form needs ids to tick
         boxes with, and the OA list it renders against is fetched separately.
         `group_providers` above is populated only because it always has been. */
      hook_ids: Array.isArray(raw['hook_ids'])
        ? (raw['hook_ids'] as unknown[])
        : [],
      /* Absent key ⇒ ON, matching the schema default for rows saved since. */
      status: raw['status'] !== false,
      created_by: raw['created_by'] as string | undefined,
      response_type: (raw['response_type'] as string) || 'flex',
      created_at: raw['created_at'] as Date | undefined,
      updated_at: raw['updated_at'] as Date | undefined,
    };
  }

  /** The caller's scope, shared with the category list and the reply path. */
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

  private async resolveCategories(
    categoryIds: unknown,
  ): Promise<ObjectCategoryDocument[]> {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) return [];
    const validIds = categoryIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    if (validIds.length === 0) return [];
    return this.objectCategoryModel.find({
      _id: { $in: validIds },
      deleted_at: { $exists: false },
    });
  }

  private async resolveGroups(groupIds: unknown): Promise<GroupDocument[]> {
    if (!Array.isArray(groupIds) || groupIds.length === 0) return [];
    const validIds = groupIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    if (validIds.length === 0) return [];
    return this.groupModel.find({ _id: { $in: validIds } });
  }

  private async getNextMatchingTag(): Promise<string> {
    const lastImage = await this.objectImageModel
      .findOne({ matching_tag: { $regex: /^img_[a-z]_1[0-9]{6}$/ } })
      .sort({ matching_tag: -1 });

    if (!lastImage || !lastImage.matching_tag) {
      return 'img_a_1000000';
    }

    const tagVal = Array.isArray(lastImage.matching_tag)
      ? lastImage.matching_tag[0]
      : lastImage.matching_tag;
    const tag =
      typeof tagVal === 'string' ? tagVal : tagVal ? String(tagVal) : '';

    const parts = tag.split('_');
    if (parts.length < 3) return 'img_a_1000000';

    let letter = parts[1] || 'a';
    let number = parseInt(parts[2] || '1000000', 10);

    number++;
    if (number > 1999999) {
      number = 1000000;
      letter = String.fromCharCode((letter.charCodeAt(0) || 97) + 1);
      if (letter > 'z') letter = 'a';
    }

    return `img_${letter}_${number}`;
  }

  /**
   * [FEAT-20260901-OBJSCOPE] Scoped to the caller.
   *
   * `includeDisabled` is TRUE: an admin list must keep showing a switched-off
   * album, or it can never be switched back on. Only the reply path hides them.
   *
   * Scoping strictly REDUCES the row count, so the per-row thumbnail lookup
   * below gets cheaper, never more expensive.
   */
  public async listImages(
    category?: string,
    tag?: string,
    imageId?: string,
    user?: AuthenticatedUser | null,
  ): Promise<SanitizedObjectImage[]> {
    const filters: Record<string, unknown> = { deleted_at: { $exists: false } };
    Object.assign(filters, await this.scopeFilter(user));

    if (category) {
      filters['categories'] = category;
    }
    if (tag) {
      filters['matching_tag'] = new RegExp(escapeRegex(tag), 'i');
    }
    if (imageId) {
      filters['image_id'] = new RegExp(escapeRegex(imageId), 'i');
    }

    const images = await this.objectImageModel
      .find(filters)
      .populate('categories')
      .populate('group_providers')
      .sort({ created_at: -1 });

    return Promise.all(
      images.map(async (image) => {
        const firstStorage = await this.imageStorageModel
          .findOne({
            object_image_id: image._id,
            deleted_at: { $exists: false },
          })
          .sort({ created_at: 1 });

        const sanitized = this.sanitizeImage(image);
        return {
          ...sanitized!,
          first_thumb: firstStorage ? firstStorage.image_url : null,
        };
      }),
    );
  }

  /**
   * ⚠️ No `isValidObjectId` guard, on purpose. Legacy `getImageById`
   * (legacy-api/src/controllers/content/objectImageController.js:125-140)
   * feeds the raw param to `findOne`, so a malformed id is a Mongoose
   * `CastError` its catch answers as **500** with the driver's own message.
   * `MongooseReadErrorInterceptor` on the controller preserves that.
   */
  public async getImageById(
    id: string,
    user?: AuthenticatedUser | null,
  ): Promise<SanitizedObjectImage> {
    /* Scope goes INTO the query: out of scope answers 404 like a bad id, so the
       endpoint is not an enumeration oracle. */
    const image = await this.objectImageModel
      .findOne({
        _id: id,
        deleted_at: { $exists: false },
        ...(await this.scopeFilter(user)),
      })
      .populate('categories')
      .populate('group_providers');
    if (!image) {
      throw new NotFoundException('Image not found');
    }
    const sanitized = this.sanitizeImage(image);
    if (!sanitized) throw new NotFoundException('Image not found');
    return sanitized;
  }

  public async createImage(
    user: AuthenticatedUser,
    dto: CreateObjectImageDto,
  ): Promise<SanitizedObjectImage> {
    const {
      detail,
      img_path,
      storage,
      file_type,
      categories,
      group_providers,
      response_type,
    } = dto;

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      throw new BadRequestException('At least one category is required');
    }

    const resolvedCategories = await this.resolveCategories(categories);
    if (resolvedCategories.length === 0) {
      throw new BadRequestException('Invalid category IDs');
    }

    const resolvedGroups = await this.resolveGroups(group_providers);
    const finalTags = [await this.getNextMatchingTag()];

    /* [FIX-20260901-CREATESCOPE] `hook_ids` and `status` are set HERE too.
       They were added to the update branch and missed here, so ticking OA
       boxes on the CREATE form stored `group_providers` and silently dropped
       `hook_ids`: reopening the album showed nothing ticked, which looks like a
       read bug and is a write bug. Measured before fixing — albums created
       today carry groups=22 and hooks=0.

       No Hook lookup mirroring `resolveGroups`: that would be a second query on
       every save to validate ids the picker took from the server a moment ago.
       The ObjectId cast drops anything malformed instead. */
    const image = new this.objectImageModel({
      detail: detail || '',
      matching_tag: finalTags,
      img_path: img_path || '',
      storage: storage || 'local',
      file_type: file_type || '',
      categories: resolvedCategories.map((c) => c._id),
      group_providers: resolvedGroups.map((g) => g._id),
      hook_ids: (dto.hook_ids ?? [])
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(String(id))),
      status: dto.status ?? true,
      response_type: response_type || 'flex',
      created_by: user.userId || null,
    });

    await image.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'object_image', action:'create', ref_id, actor, note} — additive
    // only, no schema change. Mirrors objectImageController.js:182-193. No
    // request_meta on this site. Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: image._id,
        action: 'create',
        parent: 'object_image',
        actor: buildActor(user),
        note: `Created image object: ${String(image.detail || image.matching_tag)}`,
      })
      .catch(() => undefined);

    const populated = await this.objectImageModel
      .findById(image._id)
      .populate('categories')
      .populate('group_providers');
    const sanitized = this.sanitizeImage(populated);
    if (!sanitized)
      throw new BadRequestException('Failed to create image object');
    return sanitized;
  }

  public async updateImage(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateObjectImageDto,
  ): Promise<SanitizedObjectImage> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid image identifier');
    }
    const image = await this.objectImageModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!image) {
      throw new NotFoundException('Image not found');
    }

    /* [FEAT-20260808-AUDITSITE] changed_fields built with legacy's exact
       comparisons (objectImageController.js:211-256): scalar fields compared via
       String(...) coercion, category/group id sets compared as sorted string
       arrays.

       [FIX-20260901-AUDITFROMTO] `from`/`to`, not `old_value`/`new_value` —
       Mongoose drops the undeclared keys, so those rows stored the field name
       and nothing else. See `object-categories.service.ts` for the measurement. */
    const changedFields: Array<{
      field: string;
      from: unknown;
      to: unknown;
    }> = [];
    const scalarFields: Array<
      'detail' | 'img_path' | 'storage' | 'file_type' | 'response_type'
    > = ['detail', 'img_path', 'storage', 'file_type', 'response_type'];
    for (const field of scalarFields) {
      const next = dto[field];
      if (next !== undefined) {
        const current = image[field];
        if (String(current) !== String(next)) {
          changedFields.push({ field, from: current, to: next });
          image[field] = next;
        }
      }
    }

    if (dto.categories) {
      const resolved = await this.resolveCategories(dto.categories);
      if (resolved.length === 0) {
        throw new BadRequestException('Invalid category IDs');
      }
      const newIds = resolved.map((c) => String(c._id));
      const oldIds = (image.categories || []).map((catId) => String(catId));
      if (
        JSON.stringify([...oldIds].sort()) !==
        JSON.stringify([...newIds].sort())
      ) {
        changedFields.push({
          field: 'categories',
          from: oldIds,
          to: newIds,
        });
        image.categories = resolved.map((c) => c._id);
      }
    }

    if (dto.group_providers) {
      const resolved = await this.resolveGroups(dto.group_providers);
      const newIds = resolved.map((g) => String(g._id));
      const oldIds = (image.group_providers || []).map((gId) => String(gId));
      if (
        JSON.stringify([...oldIds].sort()) !==
        JSON.stringify([...newIds].sort())
      ) {
        changedFields.push({
          field: 'group_providers',
          from: oldIds,
          to: newIds,
        });
        image.group_providers = resolved.map((g) => g._id);
      }
    }

    /* [FIX-20260901-OBJSCOPEWRITE] `hook_ids` and `status` are written HERE.
       This branch copies dto onto the document field by field, so a field
       missing from the list is accepted, answered 200, and never saved — which
       is exactly what the list screen's switch did: it flipped, the request
       succeeded, the refetch brought back the old value.

       `!== undefined` rather than truthiness: `status: false` and an empty
       scope are both meaningful. `[]` means "unrestricted", so reading it as
       "absent, leave alone" would make clearing a scope impossible.

       ⚠️ `group_providers` above resolves through the Group model, which drops
       ids that do not exist. `hook_ids` has no such lookup on purpose — adding
       one would be a second query per save to validate ids the picker already
       took from the server. Invalid entries are dropped by the cast instead. */
    if (dto.status !== undefined && dto.status !== image.status) {
      changedFields.push({
        field: 'status',
        from: image.status,
        to: dto.status,
      });
      image.status = dto.status;
    }

    if (dto.hook_ids !== undefined) {
      const nextIds = dto.hook_ids
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(String(id)));
      const oldIds = (image.hook_ids || []).map((id) => String(id));
      const newIds = nextIds.map(String);
      if (
        JSON.stringify([...oldIds].sort()) !==
        JSON.stringify([...newIds].sort())
      ) {
        changedFields.push({ field: 'hook_ids', from: oldIds, to: newIds });
        image.hook_ids = nextIds;
      }
    }

    await image.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'object_image', action:'update', changed_fields, actor, note} —
    // additive only, no schema change. Only when something changed
    // (objectImageController.js:256-269). Fire-and-forget.
    if (changedFields.length > 0) {
      void this.auditLogService
        .createAuditLog({
          ref_id: image._id,
          action: 'update',
          parent: 'object_image',
          changed_fields: changedFields,
          actor: buildActor(user),
          note: `Updated image object: ${String(image.detail || image.matching_tag)}`,
        })
        .catch(() => undefined);
    }

    const populated = await this.objectImageModel
      .findById(image._id)
      .populate('categories')
      .populate('group_providers');
    const sanitized = this.sanitizeImage(populated);
    if (!sanitized)
      throw new BadRequestException('Failed to update image object');
    return sanitized;
  }

  /**
   * ⚠️ Unguarded id, same as the getter — legacy `deleteImage`
   * (objectImageController.js:279-307) answers **500** with Mongoose's
   * CastError message. See `getImageById`.
   */
  public async deleteImage(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<void> {
    const image = await this.objectImageModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!image) {
      throw new NotFoundException('Image not found');
    }
    image.deleted_at = new Date();
    await image.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'object_image', action:'delete', ref_id, actor, note} — additive
    // only, no schema change. Mirrors objectImageController.js:291-301. No
    // request_meta on this site. Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: image._id,
        action: 'delete',
        parent: 'object_image',
        actor: buildActor(user),
        note: `Deleted image object: ${String(image.detail || image.matching_tag)}`,
      })
      .catch(() => undefined);
  }
}
