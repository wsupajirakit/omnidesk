import {
  Body,
  Controller,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import {
  ChatMediaService,
  isChatMediaError,
  type ChatMediaError,
  type UploadedImageFile,
} from './chat-media.service';
import { imageUploadFilter } from '@/infra/static/image-upload-filter';

/**
 * [FIX-20260808-IMGUPLOAD] Where admin-pushed images are stored and served — the
 * SAME `public/uploads/images` tree that line-content writes inbound images to and
 * `main.ts` serves at `/uploads/images/:file`. Created at module load so multer's
 * diskStorage can never fail on a missing directory.
 */
const CHAT_IMAGE_DIR = resolve(process.cwd(), 'public', 'uploads', 'images');
mkdirSync(CHAT_IMAGE_DIR, { recursive: true });

/**
 * [FIX-20260808-IMGUPLOAD] Multipart parser for the image-push route. Legacy ran
 * `upload.single("image")` (multer, disk storage); this reproduces it so
 * `req.file` — previously always undefined, which made every push answer
 * `400 image file is required` — is populated. Disk storage (not memory) because
 * `sendChatImage` reads `file.path` / `file.filename`; the extension is preserved
 * so the served bubble carries a correct Content-Type.
 * Revert: delete this interceptor + restore the `@Req() req.file` handler.
 */
// [FEAT-20260816-MULTIIMG] One interceptor, two fields: the legacy `image`
// (single — a dashboard deployed before this feature still sends it) and the
// new `images` (up to 5). Same disk storage and per-file 10MB cap as before.
// The old field is kept PERMANENTLY, same contract as the `/send-image` route
// alias below — staggered deploys must never 400.
const chatImageUpload = FileFieldsInterceptor(
  [
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: 5 },
  ],
  {
    storage: diskStorage({
      destination: CHAT_IMAGE_DIR,
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname || '').toLowerCase();
        cb(null, `chat_${Date.now()}_${randomUUID()}${ext}`);
      },
    }),
    // A generous image cap; legacy relied on the global body limit, but multipart
    // bypasses that, so bound it here to avoid an unbounded disk write.
    limits: { fileSize: 10 * 1024 * 1024 },
    /* [FIX-20260818-UPLOADFILTER · plan §2.4 B1 = T1-3, closes C6 leg 2] Accept
       only what this service can serve. The allowlist is IMPORTED from the serve
       middleware, never copied, so the two sides cannot drift apart. */
    fileFilter: imageUploadFilter,
  },
);

/**
 * Write the result, keeping the `{ success, error }` envelope legacy uses.
 *
 * A rejection carries its own status; anything else is a 200. The shared
 * exception filter is bypassed deliberately here — see `ChatMediaError`.
 */
function send(
  res: Response,
  result: Record<string, unknown> | ChatMediaError,
): void {
  if (isChatMediaError(result)) {
    const { status, ...body } = result;
    res.status(status).json(body);
    return;
  }
  res.status(200).json(result);
}

@Controller('api/chat')
export class ChatMediaController {
  constructor(private readonly chatMediaService: ChatMediaService) {}

  /**
   * Both paths hit one handler, as legacy routes them to one controller
   * function. `push-image` is the current name; `send-image` stays because a
   * frontend deployed before the rename still calls it.
   *
   * The multipart field name is `image`, matching legacy's `upload.single("image")`.
   */
  @Post([':id/push-image', ':id/send-image'])
  @RequirePermissions('ticket.manage')
  @UseInterceptors(chatImageUpload)
  public async sendChatImage(
    @Param('id') id: string,
    @Query('hook_id') hookId: string | undefined,
    @Body() body: { text?: string } | undefined,
    @CurrentUser() user: AuthenticatedUser | undefined,
    // [FEAT-20260816-MULTIIMG] both fields, merged in order: legacy `image`
    // first (there is at most one), then `images`. An empty merge keeps the
    // legacy `400 image file is required` (pinned by the golden suite).
    @UploadedFiles()
    uploaded:
      // prettier keeps this union stacked; undefined = no multipart part at all
      { image?: UploadedImageFile[]; images?: UploadedImageFile[] } | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const files = [...(uploaded?.image ?? []), ...(uploaded?.images ?? [])];
    // [FIX-20260808-IMGBASEURL] legacy falls back to the request host when
    // BASE_URL is unset (`${req.protocol}://${req.get("host")}`,
    // chatRoomController.js:1131), which is why legacy pushes images fine on hosts
    // that never set BASE_URL. Pass the same fallback so the absolute https URL
    // LINE fetches is always valid. `trust proxy` (main.ts) makes req.protocol
    // correct behind the TLS proxy.
    const requestBase = `${req.protocol}://${req.get('host') ?? ''}`;
    const result = await this.chatMediaService.sendChatImage(
      id,
      hookId,
      files,
      (body?.text ?? '').trim(),
      user,
      requestBase,
    );
    send(res, result);
  }

  @Post('message/:messageId/retry-video')
  @RequirePermissions('ticket.manage')
  public async retryVideoDownload(
    @Param('messageId') messageId: string,
    @Res() res: Response,
  ): Promise<void> {
    send(res, await this.chatMediaService.retryVideoDownload(messageId));
  }
}
