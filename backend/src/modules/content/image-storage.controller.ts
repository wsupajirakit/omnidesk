import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { diskStorage } from 'multer';

import {
  CurrentUser,
  MongooseReadErrorInterceptor,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
import {
  CreateImageStorageDashboardDto,
  CreateImageStorageExternalDto,
  UpdateImageStorageDto,
} from './dto';
import {
  ImageStorageService,
  type UploadedImageFile,
} from './image-storage.service';
import { imageUploadFilter } from '@/infra/static/image-upload-filter';
import { videoUploadFilter } from '@/infra/static/video-upload-filter';
import { VIDEO_MAX_BYTES } from '@/infra/static/video-types';
import { VideoStorageService } from './video-storage.service';

/**
 * [FEAT-20260808-GROUPB-IMGUPLOAD] Where dashboard-library images land — the SAME
 * `public/uploads/images` tree line-content writes inbound images to and main.ts
 * serves at `/uploads/images/:file`. Created at module load so multer's
 * diskStorage never fails on a missing directory (mirrors chat-media.controller).
 */
const DASHBOARD_IMAGE_DIR = resolve(
  process.cwd(),
  'public',
  'uploads',
  'images',
);
mkdirSync(DASHBOARD_IMAGE_DIR, { recursive: true });

/**
 * [FEAT-20260808-GROUPB-IMGUPLOAD] Multipart parser for the dashboard upload.
 * Legacy ran `upload.single("image")` (multer, disk storage —
 * apiRoutes.js:314); this reproduces it so `req.file` is populated instead of
 * always undefined (which made every dashboard upload store the stub). The
 * extension is preserved so the served image carries a correct Content-Type.
 */
/**
 * [FEAT-20260904-OBJVIDEO] Where dashboard-library VIDEOS land — the same
 * `public/uploads/videos` tree the LINE inbound path already writes to and
 * `hardened-video-serve.middleware.ts` serves at `/uploads/videos/:file`.
 * Created at module load for the same reason the image dir is.
 *
 * 🔴 A DIFFERENT DIRECTORY FROM IMAGES, which is the owner's rule and not a
 * preference: ห้ามปนกับรูป. Nothing about the image constant above changes.
 */
const DASHBOARD_VIDEO_DIR = resolve(
  process.cwd(),
  'public',
  'uploads',
  'videos',
);
mkdirSync(DASHBOARD_VIDEO_DIR, { recursive: true });

const dashboardImageUpload = FileInterceptor('image', {
  storage: diskStorage({
    destination: DASHBOARD_IMAGE_DIR,
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname || '').toLowerCase();
      cb(null, `dashboard_${Date.now()}_${randomUUID()}${ext}`);
    },
  }),
  // Multipart bypasses the global JSON body limit; bound the write here.
  limits: { fileSize: 10 * 1024 * 1024 },
  /* [FIX-20260818-UPLOADFILTER · plan §2.4 B1 = T1-3, closes C6 leg 2] Same door
     as the chat upload: only the extensions this service can serve, checked
     against the same imported allowlist. */
  fileFilter: imageUploadFilter,
});

/**
 * [FEAT-20260904-OBJVIDEO] Multipart parser for the dashboard VIDEO upload.
 *
 * 🔴 A SECOND INTERCEPTOR, NOT A WIDENED FIRST ONE. Its `destination`, its cap
 * and its filter all differ, and every one of those differences is the point:
 * widening the image interceptor would land an mp4 in `uploads/images` under
 * the 10 MB image cap and the image allow-list.
 *
 * The cap reads `VIDEO_MAX_BYTES` (50 MB) so the number lives in one file. The
 * browser shrinks the video before it gets here — this is the ceiling that
 * holds when it does not.
 */
const dashboardVideoUpload = FileInterceptor('video', {
  storage: diskStorage({
    destination: DASHBOARD_VIDEO_DIR,
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname || '').toLowerCase();
      cb(null, `dashboard_${Date.now()}_${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: VIDEO_MAX_BYTES },
  fileFilter: videoUploadFilter,
});

@ApiTags('Content - Image Storage')
@Controller('api/image-storage')
export class ImageStorageController {
  constructor(
    private readonly imageStorageService: ImageStorageService,
    private readonly videoStorageService: VideoStorageService,
  ) {}

  @Get()
  @RequirePermissions('object.manage')
  public async listImageStorages(
    @Query('object_image_id') objectImageId?: string,
    @Query('matching_tag') matchingTag?: string,
  ) {
    return this.imageStorageService.listImageStorages(
      objectImageId,
      matchingTag,
    );
  }

  // Legacy answers 500 with Mongoose's CastError text for a malformed id
  // (imageStorageController.js:363-365), not 400 — read interceptor, not write.
  @Get(':id')
  @UseInterceptors(MongooseReadErrorInterceptor)
  @RequirePermissions('object.manage')
  public async getImageStorageById(@Param('id') id: string) {
    return this.imageStorageService.getImageStorageById(id);
  }

  // [FEAT-20260808-GROUPB-IMGUPLOAD] Real multipart upload — legacy
  // `POST /api/image-storage/dashboard` with `upload.single("image")`. The stub
  // that stored `https://localhost/dashboard-upload-stub.jpg` via createFromExternal
  // is gone. The absolute image URL is built from the request host
  // (`${protocol}://${host}`), matching legacy `${req.protocol}://${req.get("host")}`
  // — `trust proxy` (main.ts) keeps protocol correct behind the TLS proxy.
  @Post('dashboard')
  @RequirePermissions('object.manage')
  @UseInterceptors(dashboardImageUpload)
  public async createFromDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImageStorageDashboardDto,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Req() req: Request,
  ) {
    const requestBase = `${req.protocol}://${req.get('host') ?? ''}`;
    return this.imageStorageService.createFromDashboard(
      user,
      dto.object_image_id,
      file,
      requestBase,
    );
  }

  /**
   * [FEAT-20260904-OBJVIDEO] The video twin of `POST dashboard`.
   *
   * Same resource on purpose — a video row lives in `image_storages` beside the
   * images of the same album, told apart by `media_kind`. The separate PATH is
   * what carries the separate interceptor (its own directory, cap and filter).
   */
  @Post('dashboard-video')
  @RequirePermissions('object.manage')
  @UseInterceptors(dashboardVideoUpload)
  public async createVideoFromDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImageStorageDashboardDto,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Req() req: Request,
  ) {
    const requestBase = `${req.protocol}://${req.get('host') ?? ''}`;
    return this.videoStorageService.createVideoFromDashboard(
      user,
      dto.object_image_id,
      file,
      requestBase,
    );
  }

  @Post('external')
  @RequirePermissions('object.manage')
  public async createFromExternal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImageStorageExternalDto,
  ) {
    return this.imageStorageService.createFromExternal(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('object.manage')
  public async updateImageStorage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateImageStorageDto,
  ) {
    return this.imageStorageService.updateImageStorage(user, id, dto);
  }

  // Legacy's delete catch is 500 too (imageStorageController.js:394-396).
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(MongooseReadErrorInterceptor)
  @RequirePermissions('object.manage')
  public async deleteImageStorage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    // [FEAT-20260808-AUDITSITE] thread the actor through so the delete audit row
    // records who deleted it (legacy read req.auth here).
    await this.imageStorageService.deleteImageStorage(id, user);
  }
}
