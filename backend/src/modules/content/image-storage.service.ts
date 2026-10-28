import path from 'node:path';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type { AuthenticatedUser } from '@/common';
// [FEAT-20260808-GROUPB-IMGUPLOAD] the shared sharp-based compressor the dashboard
// upload runs before recording file_size — same util line-content.service uses.
import { compressImage } from '@/common/utils/image-processor';
import { AuditLogService } from '@/modules/audit';
import { buildActor } from '@/modules/hooks';
import type {
  CreateImageStorageExternalDto,
  UpdateImageStorageDto,
} from './dto';
import {
  ImageStorage,
  type ImageStorageDocument,
} from './schemas/image-storage.schema';
import {
  ObjectImage,
  type ObjectImageDocument,
} from './schemas/object-image.schema';

/**
 * [FEAT-20260808-GROUPB-IMGUPLOAD] The multer disk-storage file fields the
 * dashboard upload reads — mirrors legacy's `req.file` (multer). Declared
 * locally to avoid coupling this module to the chat module's copy.
 */
export interface UploadedImageFile {
  filename: string;
  originalname: string;
  path: string;
  size: number;
}

export interface SanitizedImageStorage {
  id: unknown;
  image_url: string;
  priority: number;
  detail_link: string | null;
  detail_text: string | null;
  file_size?: number;
  /**
   * [FEAT-20260904-OBJVIDEO] `'image' | 'video'`, absent on legacy rows.
   *
   * 🔴 IT HAD TO BE ADDED HERE OR THE COLUMN WAS INVISIBLE. This interface and
   * `sanitizeStorage` build a NEW object field by field, so anything not listed
   * is dropped on the way out — the column existed on the schema since 25/08
   * and no client could ever see it. That is the failure mode this project has
   * hit before: the value is in Mongo, the screen behaves as if the feature
   * does not exist, and there is nothing to grep for.
   * A field missing from this list is dropped silently on the way out.
   */
  media_kind?: 'image' | 'video';
  /**
   * [FEAT-20260904-UPLOADEDBY] WHO uploaded it, as a NAME — never the id.
   *
   * 🔴 NOTHING NEW IS STORED. `created_by` has held the user's ObjectId since
   * the collection existed and is already `ref: 'User'`; this is that reference
   * resolved at READ time and nothing else. Owner, 04/09: store the id and join
   * for the name, do not store both — a stored copy of the name would be a second
   * source of truth that goes stale the day someone is renamed.
   * ⇒ no schema change, no migration, no backfill.
   *
   * ⚠️ `null` is a normal answer: a row whose `created_by` was never set, or
   * whose user has since been deleted, has no name to show and the dashboard
   * prints a dash. It is NOT an error and must not be reported as one.
   */
  created_by_name?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * [FEAT-20260904-UPLOADEDBY] Turn a populated `created_by` into a display name.
 *
 * Prefers `display_name` and falls back to `username`, because an account can
 * exist without a display name and "—" would then be shown for a row that does
 * have an owner. An unpopulated value (a bare ObjectId) has neither field and
 * gives null, which is the safe answer: no id ever reaches the client.
 */
function uploaderName(createdBy: unknown): string | null {
  if (!createdBy || typeof createdBy !== 'object') return null;
  const user = createdBy as { display_name?: unknown; username?: unknown };
  if (typeof user.display_name === 'string' && user.display_name.trim()) {
    return user.display_name;
  }
  if (typeof user.username === 'string' && user.username.trim()) {
    return user.username;
  }
  return null;
}

@Injectable()
export class ImageStorageService {
  constructor(
    @InjectModel(ImageStorage.name)
    private readonly imageStorageModel: Model<ImageStorageDocument>,
    @InjectModel(ObjectImage.name)
    private readonly objectImageModel: Model<ObjectImageDocument>,
    // [FEAT-20260808-AUDITSITE] audit_logs writer, matching legacy
    // imageStorageController.js:9 (auditLogService). Fire-and-forget below.
    private readonly auditLogService: AuditLogService,
  ) {}

  public sanitizeStorage(
    storage: ImageStorageDocument | null,
  ): SanitizedImageStorage | null {
    if (!storage) return null;
    const raw = (storage.toObject
      ? storage.toObject()
      : storage) as unknown as Record<string, unknown>;

    return {
      id: raw['_id'],
      image_url: (raw['image_url'] as string) || '',
      priority: (raw['priority'] as number) || 1,
      detail_link: (raw['detail_link'] as string) || null,
      detail_text: (raw['detail_text'] as string) || null,
      file_size: raw['file_size'] as number | undefined,
      /* Passed through as stored. Absent stays absent — a legacy row must read
         as "no explicit kind", which every reader treats as an image. */
      media_kind: raw['media_kind'] as 'image' | 'video' | undefined,
      /* [FEAT-20260904-UPLOADEDBY] Only ever a name. `created_by` is populated
         on the list path, so `raw['created_by']` is either a user object or
         still an ObjectId when it was not populated — and an ObjectId has
         neither field, so it yields null rather than leaking an id into the
         response. ห้ามส่ง id ออกไป ส่งแต่ชื่อ */
      created_by_name: uploaderName(raw['created_by']),
      created_at: raw['created_at'] as Date | undefined,
      updated_at: raw['updated_at'] as Date | undefined,
    };
  }

  private async getNextPriority(object_image_id: unknown): Promise<number> {
    const last = await this.imageStorageModel
      .findOne({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        object_image_id: object_image_id as any,
        deleted_at: { $exists: false },
      })
      .sort({ priority: -1 });
    return last && typeof last.priority === 'number' ? last.priority + 1 : 1;
  }

  public async listImageStorages(
    object_image_id?: string,
    matching_tag?: string,
  ): Promise<
    | SanitizedImageStorage[]
    | Array<SanitizedImageStorage | null>
    | {
        id: unknown;
        detail: string;
        matching_tag: unknown;
        response_type: string;
        created_at?: Date;
        updated_at?: Date;
        data: Array<SanitizedImageStorage | null>;
      }
  > {
    const queryFilter: Record<string, unknown> = {
      deleted_at: { $exists: false },
    };
    let parentObj: ObjectImageDocument | null = null;

    if (object_image_id) {
      queryFilter['object_image_id'] = new mongoose.Types.ObjectId(
        object_image_id,
      );
      parentObj = await this.objectImageModel.findOne({
        _id: object_image_id,
        deleted_at: { $exists: false },
      });
    } else if (matching_tag) {
      parentObj = await this.objectImageModel.findOne({
        matching_tag,
        deleted_at: { $exists: false },
      });
      if (!parentObj) {
        return {
          id: null,
          detail: '',
          matching_tag,
          response_type: 'flex',
          data: [],
        };
      }
      queryFilter['object_image_id'] = parentObj._id;
    }

    const storages = await this.imageStorageModel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .find(queryFilter as any)
      .populate('object_image_id')
      /* [FEAT-20260904-UPLOADEDBY] Two fields only. Populating the whole user
         document would put `password_hash`, `permissions` and `token_version`
         one `JSON.stringify` away from the dashboard — `sanitizeStorage` picks
         one field off it today, and the next edit to that function would not
         know what else arrived. เอาเท่าที่ใช้ ไม่ลากทั้งแถวมา */
      .populate('created_by', 'display_name username')
      .sort({ priority: 1 });
    const data = storages.map((s) => this.sanitizeStorage(s));

    if (parentObj) {
      const parentRaw = (parentObj.toObject
        ? parentObj.toObject()
        : parentObj) as unknown as Record<string, unknown>;

      return {
        id: parentRaw['_id'],
        detail: (parentRaw['detail'] as string) || '',
        matching_tag: parentRaw['matching_tag'],
        response_type: (parentRaw['response_type'] as string) || 'flex',
        created_at: parentRaw['created_at'] as Date | undefined,
        updated_at: parentRaw['updated_at'] as Date | undefined,
        data,
      };
    }

    return data;
  }

  /**
   * ⚠️ No `isValidObjectId` guard, on purpose. Legacy `getImageStorageById`
   * (legacy-api/src/controllers/content/imageStorageController.js:358-366)
   * hands `req.params.id` straight to `findOne`, so a malformed id becomes a
   * Mongoose `CastError` that its `catch` answers as **500** carrying the
   * driver's own text — the field that failed is named in the message.
   * `MongooseReadErrorInterceptor` on the controller reproduces that.
   * Adding a guard here would answer 400 and lose which field was wrong.
   */
  public async getImageStorageById(id: string): Promise<SanitizedImageStorage> {
    const storage = await this.imageStorageModel
      .findOne({ _id: id, deleted_at: { $exists: false } })
      .populate('object_image_id');
    if (!storage) {
      throw new NotFoundException('Record not found');
    }
    const sanitized = this.sanitizeStorage(storage);
    if (!sanitized) throw new NotFoundException('Record not found');
    return sanitized;
  }

  /**
   * [FEAT-20260808-GROUPB-IMGUPLOAD] Real dashboard multipart upload — legacy
   * imageStorageController.js:116-169 (`createFromDashboard`). Replaces the
   * hardcoded stub that ignored the file and stored a nonexistent
   * `https://localhost/dashboard-upload-stub.jpg`. Multer (disk storage on the
   * controller) has already written the file into public/uploads/images; here we
   * compress it in place, then persist a real ImageStorage row pointing at the
   * absolute, servable URL.
   *
   * FE EFFECT: the dashboard image-library upload now stores AND serves the real
   * image — the returned `image_url` resolves to a real file, previously it was a
   * dead stub URL.
   * DB-EFFECT: inserts ONE real `image_storage` document (collection `image_storage`)
   * with the legacy field set — image_url(absolute)/origin_path:"dashboard_upload"/
   * storage_type:"dashboard"/image_type(ext)/file_path/file_size(compressed)/
   * priority/created_by/source:"object"/media_kind:"image" — instead of the stub's
   * `url:'https://localhost/dashboard-upload-stub.jpg'` external row. Plus the
   * P2-1 4th audit site: one `audit_logs` row {parent:'image_storage',
   * action:'create', ref_id, actor, note}. No schema change.
   */
  public async createFromDashboard(
    user: AuthenticatedUser,
    objectImageId: string | undefined,
    file: UploadedImageFile | undefined,
    requestBase: string,
  ): Promise<SanitizedImageStorage> {
    // Legacy hand-checks these in order and answers these exact strings
    // (imageStorageController.js:121-122).
    if (!objectImageId) {
      throw new BadRequestException('object_image_id is required');
    }
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const objImage = await this.objectImageModel.findById(objectImageId);
    if (!objImage) {
      throw new NotFoundException('ObjectImage not found');
    }

    // legacy:126 — the extension WITHOUT the leading dot, lower-cased.
    const ext = path
      .extname(file.originalname || '')
      .substring(1)
      .toLowerCase();

    // legacy:132-133 — compress in place before recording the size; on any
    // processor error legacy falls back to the raw upload size (`processed.size
    // || file.size`). compressImage returns `{ size }` on success/no-op and
    // `{ error }` on failure — mirror the fallback.
    const processed = await compressImage(file.path);
    const finalSize =
      typeof processed.size === 'number' ? processed.size : file.size;

    // legacy:137 — `${req.protocol}://${req.get("host")}/uploads/images/<file>`.
    // requestBase is that `${protocol}://${host}` prefix, resolved on the
    // controller from the request (with `trust proxy` making protocol correct
    // behind the TLS proxy), so the stored URL is absolute and servable.
    const imageUrl = `${requestBase}/uploads/images/${file.filename}`;

    const storage = new this.imageStorageModel({
      object_image_id: objectImageId,
      image_url: imageUrl,
      origin_path: 'dashboard_upload',
      storage_type: 'dashboard',
      image_type: ext,
      file_path: file.path,
      file_size: finalSize,
      priority: await this.getNextPriority(objectImageId),
      created_by: user.userId ? new mongoose.Types.ObjectId(user.userId) : null,
      source: 'object', // FE library upload — belongs to the Object menu
      media_kind: 'image',
    });

    await storage.save();

    // [FEAT-20260808-AUDITSITE] the P2-1 4th image-storage audit site (the one
    // the earlier audit pass skipped because this multipart path did not exist
    // yet). Legacy imageStorageController.js:152-160 — audit_logs row
    // {parent:'image_storage', action:'create', ref_id, actor, note}. Additive
    // only, no schema change; fire-and-forget, exactly as legacy `.catch`.
    void this.auditLogService
      .createAuditLog({
        ref_id: storage._id,
        action: 'create',
        parent: 'image_storage',
        actor: buildActor(user),
        note: `Uploaded image to dashboard: ${storage.image_url}`,
      })
      .catch(() => undefined);

    const populated = await this.imageStorageModel
      .findById(storage._id)
      .populate('object_image_id');
    const sanitized = this.sanitizeStorage(populated);
    if (!sanitized) {
      throw new BadRequestException('Failed to create storage record');
    }
    return sanitized;
  }

  public async createFromExternal(
    user: AuthenticatedUser,
    dto: CreateImageStorageExternalDto,
  ): Promise<SanitizedImageStorage> {
    const { object_image_id, url, drive_id } = dto;
    if (!object_image_id) {
      throw new BadRequestException('object_image_id is required');
    }

    const objImage = await this.objectImageModel.findById(object_image_id);
    if (!objImage) {
      throw new NotFoundException('ObjectImage not found');
    }

    let downloadUrl = url || '';
    let storageType = 'external_url';
    let srcId: string | null = null;
    let originPath = url || '';

    if (
      url &&
      (url.includes('drive.google.com') || url.includes('docs.google.com'))
    ) {
      const driveIdMatch = url.match(/(?:\/file\/d\/|id=)([a-zA-Z0-9_-]{25,})/);
      if (driveIdMatch && driveIdMatch[1]) {
        downloadUrl = `https://drive.google.com/uc?export=download&id=${driveIdMatch[1]}`;
        srcId = driveIdMatch[1];
      }
    }

    if (drive_id) {
      downloadUrl = `https://drive.google.com/uc?export=download&id=${drive_id}`;
      storageType = 'google_drive';
      srcId = drive_id;
      originPath = `google_drive://${drive_id}`;
    }

    if (!downloadUrl) {
      throw new BadRequestException('url or drive_id is required');
    }

    if (srcId) {
      const existing = await this.imageStorageModel.findOne({
        object_image_id,
        src_id: srcId,
        deleted_at: { $exists: false },
      });
      if (existing) {
        const s = this.sanitizeStorage(existing);
        if (s) return s;
      }
    }

    const nextPriority = await this.getNextPriority(object_image_id);

    const storage = new this.imageStorageModel({
      object_image_id,
      image_url: downloadUrl,
      origin_path: originPath,
      src_id: srcId,
      storage_type: storageType,
      image_type: 'jpg',
      file_path: downloadUrl,
      file_size: 1024,
      priority: nextPriority,
      created_by: user.userId ? new mongoose.Types.ObjectId(user.userId) : null,
      source: 'object',
      media_kind: 'image',
    });

    await storage.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'image_storage', action:'create', ref_id, actor, note} — additive
    // only, no schema change. Mirrors imageStorageController.js:270-282 (external
    // upload); legacy has NO request_meta on this site. Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: storage._id,
        action: 'create',
        parent: 'image_storage',
        actor: buildActor(user),
        note: `Created image storage from external source (${storage.storage_type}): ${storage.image_url}`,
      })
      .catch(() => undefined);

    const populated = await this.imageStorageModel
      .findById(storage._id)
      .populate('object_image_id');
    const sanitized = this.sanitizeStorage(populated);
    if (!sanitized)
      throw new BadRequestException('Failed to create storage record');
    return sanitized;
  }

  public async updateImageStorage(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateImageStorageDto,
  ): Promise<SanitizedImageStorage> {
    if (!mongoose.isValidObjectId(id)) {
      throw new BadRequestException('Invalid storage identifier');
    }
    const storage = await this.imageStorageModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!storage) {
      throw new NotFoundException('Record not found');
    }

    /* [FEAT-20260808-AUDITSITE] Capture the changed_fields BEFORE mutating,
       using legacy's exact comparisons (imageStorageController.js:334-345).
       `to` carries the RAW dto value, not the parsed priority — that part is
       legacy's behaviour and is deliberately kept.

       [FIX-20260901-AUDITFROMTO] The keys are `from`/`to`. They used to be
       legacy's `old_value`/`new_value`, but the sub-schema declares only
       `field`/`from`/`to` (`hook-audit-log.schema.ts:8-17`) and Mongoose drops
       undeclared paths on write. Measured against the real database: a row
       written the old way stores as `[{field: 'priority'}]` — which field moved,
       never from what to what. Parity on a key nobody stores is parity with a
       bug. */
    const changedFields: Array<{
      field: string;
      from: unknown;
      to: unknown;
    }> = [];
    if (
      dto.priority !== undefined &&
      String(storage.priority) !== String(dto.priority)
    ) {
      changedFields.push({
        field: 'priority',
        from: storage.priority,
        to: dto.priority,
      });
    }
    if (
      dto.detail_link !== undefined &&
      storage.detail_link !== dto.detail_link
    ) {
      changedFields.push({
        field: 'detail_link',
        from: storage.detail_link,
        to: dto.detail_link,
      });
    }
    if (
      dto.detail_text !== undefined &&
      storage.detail_text !== dto.detail_text
    ) {
      changedFields.push({
        field: 'detail_text',
        from: storage.detail_text,
        to: dto.detail_text,
      });
    }

    if (dto.detail_link !== undefined) storage.detail_link = dto.detail_link;
    if (dto.detail_text !== undefined) storage.detail_text = dto.detail_text;

    if (dto.priority !== undefined) {
      const priorityVal: unknown = dto.priority;
      const targetPriority =
        typeof priorityVal === 'number'
          ? priorityVal
          : parseInt(typeof priorityVal === 'string' ? priorityVal : '0', 10);
      const collision = await this.imageStorageModel.findOne({
        _id: { $ne: storage._id },
        object_image_id: storage.object_image_id,
        priority: targetPriority,
        deleted_at: { $exists: false },
      });

      if (collision) {
        const nextRunning = await this.getNextPriority(storage.object_image_id);
        collision.priority = nextRunning;
        await collision.save();
      }

      storage.priority = targetPriority;
    }

    await storage.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'image_storage', action:'update', changed_fields, actor, note} —
    // additive only, no schema change. Only written when something changed, as
    // legacy imageStorageController.js:335-349. No request_meta on this site.
    if (changedFields.length > 0) {
      void this.auditLogService
        .createAuditLog({
          ref_id: storage._id,
          action: 'update',
          parent: 'image_storage',
          changed_fields: changedFields,
          actor: buildActor(user),
          note: `Updated image storage record: ${String(storage._id)}`,
        })
        .catch(() => undefined);
    }

    const populated = await this.imageStorageModel
      .findById(storage._id)
      .populate('object_image_id');
    const sanitized = this.sanitizeStorage(populated);
    if (!sanitized)
      throw new BadRequestException('Failed to update storage record');
    return sanitized;
  }

  /**
   * ⚠️ Unguarded id, same as the getter above — legacy `deleteImageStorage`
   * (imageStorageController.js:368-397) also answers **500** with Mongoose's
   * CastError message. See `getImageStorageById` for the full reasoning.
   */
  public async deleteImageStorage(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<void> {
    const storage = await this.imageStorageModel.findOne({
      _id: id,
      deleted_at: { $exists: false },
    });
    if (!storage) {
      throw new NotFoundException('Record not found');
    }
    storage.deleted_at = new Date();
    await storage.save();

    // [FEAT-20260808-AUDITSITE] writes audit_logs row
    // {parent:'image_storage', action:'delete', ref_id, actor, note} — additive
    // only, no schema change. Mirrors imageStorageController.js:381-391. No
    // request_meta on this site. Fire-and-forget.
    void this.auditLogService
      .createAuditLog({
        ref_id: storage._id,
        action: 'delete',
        parent: 'image_storage',
        actor: buildActor(user),
        note: `Deleted image storage record: ${storage.image_url}`,
      })
      .catch(() => undefined);
  }
}
