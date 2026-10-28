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
import { AuditLogService } from '@/modules/audit';
import { buildActor } from '@/modules/hooks';

import type { UploadedImageFile } from './image-storage.service';
import {
  ImageStorage,
  type ImageStorageDocument,
} from './schemas/image-storage.schema';
import {
  ObjectImage,
  type ObjectImageDocument,
} from './schemas/object-image.schema';

/**
 * [FEAT-20260904-OBJVIDEO] Storing a VIDEO uploaded from the Object album.
 * ===========================================================================
 * The album has to hold video as well as images (owner, 04/09). This is the
 * write half.
 *
 * ── WHY A SEPARATE FILE INSTEAD OF A FLAG ON THE IMAGE ONE ─────────────────
 * The design note for this task said "media_kind becomes a parameter" on
 * `createFromDashboard`. Reading that method decided against it: it differs
 * from the video case in THREE places at once — the URL directory, the
 * `media_kind`, and the fact that it runs `compressImage`, an image-only
 * compressor. Threading a flag through would put three `if (kind === 'video')`
 * branches inside a method that is already part of a 535-line file (over the
 * 400 cap with no waiver). The standing rule here is that new work gets its own
 * function in its own file and the old path is not reopened.
 * ⇒ the note was corrected rather than followed. ของใหม่แยกไฟล์ ของเก่าไม่รื้อ
 *
 * 🔴 SAME COLLECTION, DIFFERENT DIRECTORY. The row still lands in
 * `image_storages` hanging off `object_image_id` — that is how one album entry
 * holds several files, and `media_kind` is what tells them apart (declared on
 * the schema since 25/08, already written by the LINE inbound path). The FILE
 * goes to `public/uploads/videos`, never the image tree.
 * แถวอยู่คอลเลกชันเดียวกัน แต่ไฟล์คนละโฟลเดอร์ — ห้ามปนกับรูป
 *
 * 🔴 NO COMPRESSION HAPPENS HERE, AND THAT IS DELIBERATE. There is no `ffmpeg`
 * in this service, in `package.json` or in the Dockerfile, and `sharp` is
 * absent for a recorded reason (`common/utils/image-processor.ts`). The
 * shrinking is done in the browser before upload — the same decision
 * `omnidesk-console/utils/imageDownscale.ts` records for images, so the work
 * touches the upload leg and nothing else. What this side enforces is the
 * CEILING (`VIDEO_MAX_BYTES`, applied by the route's multer limit), because a
 * client can be old, patched, or not this dashboard at all.
 *
 * revert: delete this file, its provider entry in `content.module.ts` and the
 *   route that calls it. Images are untouched by all of it.
 */
@Injectable()
export class VideoStorageService {
  constructor(
    @InjectModel(ImageStorage.name)
    private readonly imageStorageModel: Model<ImageStorageDocument>,
    @InjectModel(ObjectImage.name)
    private readonly objectImageModel: Model<ObjectImageDocument>,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * The next free priority for this album.
   *
   * ⚠️ Deliberately a copy of the image service's private helper rather than an
   * export of it: the two write the same collection, so the ordering must agree,
   * and reaching into the other service's privates to say so would couple the
   * video path to an image method that is free to change. Six lines, one query,
   * and the shared truth is the DATA, not the function.
   */
  private async nextPriority(objectImageId: unknown): Promise<number> {
    const last = await this.imageStorageModel
      .findOne({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        object_image_id: objectImageId as any,
        deleted_at: { $exists: false },
      })
      .sort({ priority: -1 });
    return last && typeof last.priority === 'number' ? last.priority + 1 : 1;
  }

  /**
   * Record a video the dashboard just uploaded.
   *
   * `requestBase` is the `${protocol}://${host}` prefix the controller resolves
   * from the request, exactly as the image path does, so the stored URL is
   * absolute and servable.
   */
  public async createVideoFromDashboard(
    user: AuthenticatedUser,
    objectImageId: string | undefined,
    file: UploadedImageFile | undefined,
    requestBase: string,
  ): Promise<ImageStorageDocument> {
    if (!objectImageId) {
      throw new BadRequestException('object_image_id is required');
    }
    if (!file) {
      throw new BadRequestException('video file is required');
    }

    const objImage = await this.objectImageModel.findById(objectImageId);
    if (!objImage) {
      throw new NotFoundException('ObjectImage not found');
    }

    /* The extension WITHOUT the leading dot, lower-cased — the same shape the
       image path stores, so one column reads the same way for both kinds. */
    const ext = path
      .extname(file.originalname || '')
      .substring(1)
      .toLowerCase();

    /* 🔴 `videos`, not `images`. This single word is what keeps the two trees
       apart on disk, and `hardened-video-serve.middleware.ts` is what serves
       it back with an allow-list and an explicit Content-Type. */
    const videoUrl = `${requestBase}/uploads/videos/${file.filename}`;

    const storage = new this.imageStorageModel({
      object_image_id: objectImageId,
      image_url: videoUrl,
      origin_path: 'dashboard_upload',
      storage_type: 'dashboard',
      image_type: ext,
      file_path: file.path,
      /* The size AS STORED. The image path takes `compressImage`'s result and
         falls back to `file.size`; there is nothing to fall back from here
         because nothing re-encodes on this side. */
      file_size: file.size,
      priority: await this.nextPriority(objectImageId),
      created_by: user.userId ? new mongoose.Types.ObjectId(user.userId) : null,
      source: 'object',
      /* 🔴 The one field that makes this row a video to every reader — the
         admin gallery, the FE tile and any audience query. Guessing from the
         extension is exactly what the schema comment says not to do. */
      media_kind: 'video',
    });

    await storage.save();

    /* Same audit shape as the image upload, fire-and-forget in the same way —
       a failed audit must not fail an upload that already wrote a file. */
    void this.auditLogService
      .createAuditLog({
        ref_id: storage._id,
        action: 'create',
        parent: 'image_storage',
        actor: buildActor(user),
        note: `upload video ${file.filename}`,
      })
      .catch(() => undefined);

    return storage;
  }
}
