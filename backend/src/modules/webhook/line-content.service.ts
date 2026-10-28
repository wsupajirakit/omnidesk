import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types } from 'mongoose';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { compressImage } from '@/common/utils/image-processor';
import { ImageStorage, type ImageStorageDocument } from '@/modules/content';

/**
 * Inbound LINE media: fetch the binary from the Messaging API content endpoint
 * and store it as an `image_storages` row.
 *
 * PORTED — line for line, including the parts that look wrong.
 * Source: legacy-api/src/services/core-bot/lineContentService.js
 *   · downloadAndSaveImage (23)  → GET /v2/bot/message/{id}/content
 *   · downloadAndSaveVideo (112) → GET /v2/bot/message/{id}/content
 *
 * The two are near-duplicates in legacy — same endpoint, different directory,
 * different limits, different extension handling, different logging. They are
 * kept as two methods here rather than folded into one parameterised helper,
 * because every one of those differences is real behaviour a caller can see and
 * a shared implementation would quietly average them out. See the per-method
 * notes for the list.
 *
 * ── WIRED ────────────────────────────────────────────────────────────────────
 * Registered in the module (webhook.module.ts:239) and injected into
 * `WebhookService` (:312), which calls `downloadAndSaveImage` / `downloadAndSaveVideo`
 * on the inbound-media path (:1310 / :1385).
 *
 * ── WHAT THE CALLER DOES WITH THE RETURN (legacy:2800-2830, 2967-2977) ──────
 * Both methods answer `ObjectId | null` and the caller branches on truthiness
 * ONLY — it never inspects the error, because there is none to inspect:
 *
 *   image  `if (storageId)` → `internalContentId = storageId`, then re-reads
 *          the row by id to build `mediaUrl`. On `null` the message is still
 *          logged as `image` with no `internal_content_id` — no placeholder,
 *          no retry.
 *   video  `if (storageId)` → `internalContentId = storageId`; on `null` the
 *          message type is rewritten to `video_pending`, which is what puts the
 *          "โหลดวิดีโอ" button in front of an admin
 *          ([FIX-20260728-VIDEO-PENDING], legacy:2952-2977).
 *
 * So `null` is not merely "failed" — for video it is the signal that drives a
 * whole user-visible branch, and the four ways to reach it (missing argument,
 * HTTP failure, oversized body, empty body) are deliberately indistinguishable
 * to the caller. Do not widen the return type to carry a reason without
 * changing that caller in the same diff.
 *
 * ── WHY AXIOS ───────────────────────────────────────────────────────────────
 * Same reason as `line-api.service.ts`: legacy reads `err.response.status` and
 * `err.response.data?.toString()` off the rejection, and relies on axios'
 * `maxContentLength` to abort an oversized body mid-stream. `fetch` resolves on
 * a 4xx and has neither, so porting to it would mean rebuilding both by hand.
 *
 * Legacy spells the call `axios({ url, method: "GET", ... })`; this uses
 * `axios.get(url, { ... })`, which axios merges into the identical request. The
 * change is so the HTTP client is stubbable per-verb in tests, matching how
 * `line-api.service.ts` is already pinned.
 *
 * ── NO `BASE_URL` HERE, ON PURPOSE ──────────────────────────────────────────
 * `image_url` is stored RELATIVE (`/uploads/images/<file>`), exactly as legacy
 * stores it. The absolute url is assembled by the CALLER, which computes
 * `process.env.BASE_URL || \`${req.protocol}://${req.get('host')}\``
 * (legacy:2806-2807) — the same expression `getBankLogoUrl` uses
 * (legacy:163-175). That expression is a known difference between the two
 * backends whenever `BASE_URL` is unset, since it then reflects whichever host
 * and port the request arrived on. Neither method in this file is affected:
 * neither reads `BASE_URL`, and neither returns a url. Adding a base here would
 * both double-prefix the caller's string and move that environment difference
 * into stored data, where it would persist after the request is over.
 */

/**
 * Where the binaries land.
 *
 * Legacy: `path.join(__dirname, "../../public/uploads/images")` from
 * `src/services/core-bot/`, i.e. `<checkout>/src/public/uploads/images`, which
 * `src/index.js:83` then serves at `/uploads/images/:filename`.
 *
 * Resolved from `__dirname` here for the same reason `InternalCacheService`
 * does it: this file lives at `src/modules/webhook/`, so three levels up is the
 * checkout root under `src/` and under `dist/` alike, and no absolute path — no
 * home directory, no username — can reach a committed file (R7).
 *
 * ⚠️ The absolute `file_path` written to the row therefore differs between the
 * two backends by checkout location. It is unavoidable: legacy stores its own
 * absolute path too, so the column can never match across two installs. The
 * value parity compares is `image_url`, which is relative and identical.
 */
const DOWNLOAD_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'public',
  'uploads',
  'images',
);

/**
 * legacy:91 — videos live in a sibling directory but reuse the SAME collection.
 *
 * `image_storages` is a generic media record; the `image_*` field names are
 * historical and nothing validates that the bytes are an image. `media_kind`
 * is what actually distinguishes them.
 */
const VIDEO_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'public',
  'uploads',
  'videos',
);

/**
 * legacy:98 — 60 MB, video only.
 *
 * A guardrail against an abnormal payload exhausting disk or memory, kept
 * generous because LINE's own inbound video cap is well under it, so a normal
 * clip is never truncated.
 *
 * ⚠️ THE IMAGE PATH HAS NO SIZE EQUIVALENT, AND THAT IS STILL DELIBERATE.
 * legacy:33-40 passes no `maxContentLength`, no `maxBodyLength` and no
 * `timeout`. The SIZE half of that asymmetry is reproduced, not repaired — a cap
 * on the image path would turn a request legacy completes into one that returns
 * `null`, and `null` on the image path silently drops the customer's picture
 * from the chat stream. Owner decision 2026-08-24: keep it uncapped.
 *
 * The TIME half was repaired on the same day — see [FIX-20260824-IMGTIMEOUT]
 * below. A deadline cannot lose a picture that would otherwise have arrived,
 * because a socket that never delivers bytes delivers none either way; it only
 * stops the worker from being held for minutes while producing nothing.
 */
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60 MB

/** legacy:127 — video only; the image call passed none until IMGTIMEOUT below. */
const VIDEO_TIMEOUT_MS = 30_000;

/**
 * [FIX-20260824-IMGTIMEOUT] The image GET now has a deadline. The SIZE CAP is
 * still deliberately absent — the MAX_VIDEO_BYTES note above stands unchanged.
 *
 * Why a deadline does not carry the harm a cap does: that note refuses a cap
 * because it would turn a download legacy COMPLETES into a `null`, losing a
 * picture the customer really sent. A deadline cannot do that. Legacy passes no
 * timeout on this GET, so axios waits on `0` — forever — and a socket that never
 * delivers bytes yields no picture under either version. What the deadline
 * changes is only how long the worker is held while producing nothing: without
 * it a half-open connection to api-data.line.me occupies the request until the
 * OS abandons the TCP connection, which is minutes. The reply token (60s) is
 * long dead by then either way, and that worker is also still holding the
 * per-user lock.
 *
 * 30s matches the video path rather than being tuned: an inbound LINE image is
 * far smaller than the clips that path already completes inside the same budget,
 * so this is a ceiling on hangs, not a limit on real downloads.
 *
 * revert: delete `timeout: IMAGE_TIMEOUT_MS` from the image `axios.get` below
 *         and this constant. Behaviour returns to waiting indefinitely.
 */
const IMAGE_TIMEOUT_MS = 30_000;

/** legacy:32 / 119 — the content endpoint, on the data host, not the API host. */
const LINE_CONTENT_URL_PREFIX = 'https://api-data.line.me/v2/bot/message/';
const LINE_CONTENT_URL_SUFFIX = '/content';

/** legacy:32 — the message id is interpolated raw, unencoded. */
const contentUrl = (messageId: string): string =>
  `${LINE_CONTENT_URL_PREFIX}${messageId}${LINE_CONTENT_URL_SUFFIX}`;

@Injectable()
export class LineContentService {
  private readonly logger = new Logger(LineContentService.name);

  constructor(
    @InjectModel(ImageStorage.name)
    private readonly imageStorageModel: Model<ImageStorageDocument>,
  ) {
    // legacy:11-13 and :92-94 run these at require time, i.e. once per process
    // at boot. A Nest provider is constructed once at boot too, so this is the
    // same moment. Deliberately NOT done per-write: legacy fails and returns
    // `null` if the directory is removed while the process is running, and a
    // lazy mkdir would succeed there instead.
    LineContentService.ensureDir(DOWNLOAD_DIR);
    LineContentService.ensureDir(VIDEO_DIR);
  }

  /**
   * legacy:23 — download an inbound image and store it.
   *
   * ══════════════════════════════════════════════════════════════════════════
   * [NOTE-20260810-IMAGEPIPELINE] WHAT THIS IS, FOR WHOEVER READS IT NEXT
   * ══════════════════════════════════════════════════════════════════════════
   * This is the SINGLE ENTRY POINT for every inbound image on the platform.
   * The caller gates on message type ALONE (`webhook.service.ts:1445`:
   * `if (event.message?.type === 'image' && event.message.id)`) — there is no
   * branch for slips, no branch for anything else. A photo of a cat and a bank
   * transfer slip travel this exact path; whether an image IS a slip is decided
   * LATER, by `slip-flow.service.ts` and the QR check.
   *
   * WHY LINE FORCES THIS SHAPE: a LINE webhook carries only a message id, never
   * the bytes. The image lives on LINE's servers and must be fetched with the
   * channel token — which is why this method exists at all, and why an image
   * cannot be replayed from a webhook payload alone.
   *
   * ── WHERE THE BYTES GO, AND WHO READS THEM BACK ──────────────────────────
   * The file is written to `public/uploads/images/<uuid>.<ext>` and a row is
   * inserted in `image_storages` holding BOTH `file_path` (absolute, for server
   * reads) and `image_url` (relative, for the dashboard). The row `_id` is what
   * every caller keeps, as `internal_content_id`:
   *
   *   · chat UI          `chat.service.ts:471,480`     .populate() → renders it
   *   · ticket UI        `tickets.service.ts:210,351`  .populate() → renders it
   *   · slip verify      `slip-flow.service.ts:278`    readFileSync → base64 → Swiftcheck
   *   · payment topup    payment runner                re-attaches the FILE to Shop-API
   *
   * ⚠️ THE IMAGE IS STORED ONCE AND POINTED AT FOUR TIMES. `slip_verifications`
   *    does NOT hold a copy — it holds `internal_content_id`, the same pointer
   *    the chat message holds. They are the same image, not two.
   *
   * ⚠️ WHY IT IS NOT STORED UNDER THE SLIP INSTEAD: the image arrives BEFORE
   *    anyone knows it is a slip. An image that turns out not to be one still
   *    has to render in chat, and would have nowhere to live.
   *
   * ⚠️ CHANGING THIS BREAKS FOUR THINGS AT ONCE — and the worst one is silent.
   *    If `file_path` stops resolving, Swiftcheck may still pass (it already read
   *    the bytes) while TOPUP fails with `reason:'no_slip_image'`: the customer
   *    sent a valid slip, the slip verified, and the money never arrives, with
   *    no error on the customer's screen. Touch this only with a full-flow test
   *    covering slip → topup → walletpay in front of you.
   *    รูปเดียว ใช้ 4 ที่ · แก้พลาด = เงินไม่เข้าแบบเงียบ ๆ.
   *
   * @param messageId   LINE message id
   * @param accessToken decrypted channel access token
   * @returns the new `image_storages` `_id`, or `null` on any failure
   */
  async downloadAndSaveImage(
    messageId: string | undefined | null,
    accessToken: string | undefined | null,
  ): Promise<Types.ObjectId | null> {
    try {
      if (!messageId || !accessToken) {
        this.logger.warn(
          '[LineContentService] Missing messageId or accessToken',
        );
        return null;
      }

      this.logger.log(
        `[LineContentService] Downloading image content for messageId: ${messageId}`,
      );

      // No timeout and no size cap — see MAX_VIDEO_BYTES. Authorization is the
      // only header; legacy sends no Accept and no Content-Type on this GET.
      const response = await axios.get<Buffer>(contentUrl(messageId), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        responseType: 'arraybuffer',
        // [FIX-20260824-IMGTIMEOUT] A ceiling on hangs, not on size. No
        // maxContentLength/maxBodyLength here on purpose — see the constant.
        timeout: IMAGE_TIMEOUT_MS,
      });

      /**
       * legacy:42-48 — extension from the content-type, and it is NOT sanitised.
       *
       * ⚠️ Three reproduced quirks, all reachable:
       *   · no `;` strip. `image/jpeg; charset=utf-8` yields the extension
       *     `jpeg; charset=utf-8`, so the file is named `<uuid>.jpeg;
       *     charset=utf-8` and `image_type` is stored as that whole string. The
       *     `jpeg`→`jpg` rewrite below misses it, because it compares the whole
       *     value. LINE does not currently send a parameter on this response,
       *     which is the only reason this is not visible in production.
       *   · no lowercasing. `Image/PNG` yields `PNG`.
       *   · no emptiness check. `image/` yields `""`, producing a file named
       *     `<uuid>.` and `image_type: ""`.
       * The VIDEO path below fixes all three. The image path does not, and the
       * fix is not backported here: `image_type` is read by the chat UI, and
       * changing what it holds for an existing content-type is a data change,
       * not a cleanup.
       */
      const contentType = response.headers['content-type'] as
        string | undefined;
      let ext = 'jpg'; // Default
      if (contentType) {
        const typeParts = contentType.split('/');
        // `length > 1` is legacy's own guard, so index 1 exists whenever this
        // runs. The assertion states that; it does not add a check legacy
        // lacks. Note it can still be the EMPTY string ("image/").
        if (typeParts.length > 1) ext = typeParts[1] as string;
      }
      if (ext === 'jpeg') ext = 'jpg';

      /**
       * legacy:50 — a fresh v4 UUID, unrelated to the LINE message id.
       *
       * Nothing derives this name from anything: not the message id, not the
       * bytes, not the user. Two calls for the same `messageId` therefore
       * produce two files and two rows rather than colliding or deduplicating —
       * which is exactly what the video retry button relies on. The name has no
       * meaning to preserve; the row `_id` is the stable handle, and the caller
       * stores THAT as `internal_content_id`.
       */
      const filename = `${randomUuid()}.${ext}`;
      const absolutePath = join(DOWNLOAD_DIR, filename);

      // Save binary data to file
      writeFileSync(absolutePath, response.data);

      /**
       * legacy:57-58 — shrink to under 0.9 MB, overwriting in place.
       *
       * `compressImage` never throws: it answers `{ error }` on any failure,
       * including a missing `sharp`. The `||` fallback below is what absorbs
       * that — `processed.size` is then `undefined` and the ORIGINAL byte
       * length is recorded. So a failed compression stores a row whose
       * `file_size` matches the file on disk (uncompressed), and a succeeded
       * one stores the compressed size. Both are correct; neither is an error
       * the caller sees.
       *
       * ⚠️ An empty body is NOT checked here, unlike the video path. A 200 with
       * zero bytes writes a 0-byte file and stores a row with `file_size: 0`,
       * and the caller treats that row as a real image.
       */
      const processed = await compressImage(absolutePath);
      const finalSize = processed.size || response.data.length;

      const storage = new this.imageStorageModel({
        // legacy:62 — explicitly null, not omitted. Chat media belongs to no
        // Object entry, and the key is written so the stored document matches
        // legacy's field-for-field. The schema types the path as an optional
        // ObjectId, which is why the payload is cast below rather than typed:
        // an explicit null is exactly what is wanted, not a missing key.
        object_image_id: null,
        image_url: `/uploads/images/${filename}`, // Relative URL — see the class note on BASE_URL
        origin_path: 'internal',
        storage_type: 'internal',
        image_type: ext,
        file_path: absolutePath,
        file_size: finalSize,
        priority: 1,
        source: 'chat', // inbound customer media — chat stream only
        media_kind: 'image',
      } as unknown as ImageStorage);

      await storage.save();
      this.logger.log(
        `[LineContentService] Image saved and record created: ${String(storage._id)}`,
      );

      return storage._id;
    } catch (err) {
      // Never throws into the webhook — every failure degrades to `null`.
      this.logger.error(
        `[LineContentService] Error downloading/saving image: ${errorMessage(err)}`,
      );
      const response = axiosErrorResponse(err);
      if (response) {
        // ⚠️ `responseType: "arraybuffer"` means an error body is a Buffer, so
        // legacy's `err.response.data?.toString()` is what turns LINE's JSON
        // error into readable text. Kept: without it this logs
        // "[object Object]" or a byte dump.
        this.logger.error(`- LINE API Status: ${String(response.status)}`);
        this.logger.error(
          `- LINE API Data: ${String(response.data?.toString())}`,
        );
      }
      return null;
    }
  }

  /**
   * legacy:112 — download an inbound video and store it VERBATIM.
   *
   * No transcode: the server has no ffmpeg, and shrinking is a deliberate
   * future task (legacy references real_push.md). The row is an ordinary
   * `image_storages` document with `image_type` set to the real extension, so
   * the chat UI renders a `<video>` from `internal_content_id` exactly the way
   * it renders an image bubble.
   *
   * Differences from the image path, all intentional in legacy and all
   * preserved: a 60 MB cap, a 30 s timeout, a sanitised extension, an
   * empty-body guard, no "Downloading…" log line, no compression, and an error
   * log that omits the response body.
   *
   * @param messageId   LINE message id
   * @param accessToken decrypted channel access token
   * @returns the new `image_storages` `_id`, or `null` on any failure — which
   *          the caller turns into `video_pending`
   */
  async downloadAndSaveVideo(
    messageId: string | undefined | null,
    accessToken: string | undefined | null,
  ): Promise<Types.ObjectId | null> {
    try {
      if (!messageId || !accessToken) {
        // Note the "(video)" suffix — the only thing that tells the two guards
        // apart in a log.
        this.logger.warn(
          '[LineContentService] Missing messageId or accessToken (video)',
        );
        return null;
      }

      const response = await axios.get<Buffer>(contentUrl(messageId), {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'arraybuffer',
        maxContentLength: MAX_VIDEO_BYTES, // axios aborts if the body exceeds this
        maxBodyLength: MAX_VIDEO_BYTES,
        timeout: VIDEO_TIMEOUT_MS, // videos are bigger than images
      });

      // legacy:131-135 — derive the extension from the content-type (LINE sends
      // video/mp4 normally). Unlike the image path this DOES strip parameters,
      // trim and lowercase.
      const contentType =
        (response.headers['content-type'] as string | undefined) || '';
      let ext = 'mp4';
      const parts = contentType.split('/');
      const subtype = parts.length > 1 ? parts[1] : undefined;
      if (subtype) ext = (subtype.split(';')[0] as string).trim().toLowerCase();
      // Apple sends `video/quicktime`; `.mov` is what a browser will play.
      if (ext === 'quicktime') ext = 'mov';

      /**
       * legacy:138-142 — skip an obviously-empty body rather than store a
       * 0-byte file.
       *
       * This is the ordinary case, not an edge case: LINE answers the content
       * endpoint before transcoding finishes, so a video that arrives promptly
       * lands here and the caller marks the message `video_pending`. Returning
       * `null` BEFORE writing is what keeps a stray 0-byte file off disk.
       */
      const size = response.data?.length || 0;
      if (!size) {
        this.logger.warn(
          `[LineContentService] Empty video body, skipping: ${messageId}`,
        );
        return null;
      }

      const filename = `${randomUuid()}.${ext}`;
      const absolutePath = join(VIDEO_DIR, filename);
      writeFileSync(absolutePath, response.data);

      const storage = new this.imageStorageModel({
        object_image_id: null, // see the image path — explicitly null, not omitted
        image_url: `/uploads/videos/${filename}`, // relative; FE prefixes BASE_URL
        origin_path: 'internal',
        storage_type: 'internal',
        image_type: ext, // "mp4" / "mov" — FE uses this + message_type
        file_path: absolutePath,
        // The raw byte count. No compression step exists on this path, so
        // unlike the image path there is no `processed.size` to prefer.
        file_size: size,
        priority: 1,
        source: 'chat', // inbound customer media — chat stream only
        media_kind: 'video',
      } as unknown as ImageStorage);

      await storage.save();
      this.logger.log(
        `[LineContentService] Video saved and record created: ${String(storage._id)} (${size} bytes)`,
      );
      return storage._id;
    } catch (err) {
      // Never throw into the webhook — degrade to video_pending instead.
      this.logger.error(
        `[LineContentService] Error downloading/saving video: ${errorMessage(err)}`,
      );
      const response = axiosErrorResponse(err);
      if (response) {
        // ⚠️ Status only. The image path also logs the body; this one does not,
        // so an oversized-body abort logs nothing but the axios message.
        this.logger.error(`- LINE API Status: ${String(response.status)}`);
      }
      return null;
    }
  }

  /** legacy:11-13 / :92-94 — `mkdirSync(dir, { recursive: true })` if absent. */
  private static ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * `crypto.randomUUID()`.
 *
 * Read off `globalThis.crypto` rather than imported from `node:crypto` so a
 * test can replace it and pin the generated filename. Both are the same
 * function; Node exposes the Web Crypto one globally from 19 onward.
 */
const randomUuid = (): string => globalThis.crypto.randomUUID();

// ── error shape helpers ──────────────────────────────────────────────────────
// JS reads `.message` and `.response` off a caught value without checking what
// it is; TypeScript types a catch binding as `unknown`, so the same reads are
// spelled out here. Same approach as `line-api.service.ts`.

/** `err.message` as JS would read it, including on a non-Error throw. */
const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(message);
};

/** `err.response`, present only on an HTTP failure — absent on a timeout. */
const axiosErrorResponse = (
  err: unknown,
): { status: unknown; data?: { toString(): string } } | undefined =>
  (
    err as {
      response?: { status: unknown; data?: { toString(): string } };
    } | null
  )?.response;
