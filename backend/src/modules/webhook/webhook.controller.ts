import {
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '@/common';

import { LineSignatureGuard } from './line-signature.guard';
import { WebhookPlainTextFilter } from './webhook-plain-text.filter';
import {
  TelegramSecretMismatchError,
  type WebhookRequestMeta,
  WebhookService,
} from './webhook.service';

/** The request shape the LINE routes see after the signature guard has run. */
type LineWebhookRequest = Request & {
  hook?: Record<string, unknown>;
  hookSource?: string;
  rawBody?: Buffer;
};

/**
 * LINE and Telegram webhook ingest endpoints.
 *
 * Contract (identical to legacy):
 * - `POST /webhook` and `POST /:alias/webhook` — LINE webhook
 *   Responds 200 "OK" immediately, then processes in background
 * - `POST /api/telegram/webhook` — Telegram callback
 *   Responds 200 "OK" always (even on error, per Telegram best practice)
 *
 * Both LINE routes are public (no Bearer token) and protected by the LINE
 * HMAC signature guard instead. The Telegram route is public and optionally
 * protected by the TELEGRAM_WEBHOOK_SECRET env var.
 *
 * Excluded from Swagger because these are machine-to-machine endpoints that
 * LINE and Telegram call — not dashboard API surfaces.
 */
/**
 * [OBS-20260824-WHINFLIGHT] Below this, concurrency is not worth a log line.
 * Ten is under a quarter of the Mongo pool, so anything quieter is noise.
 */
const PEAK_NOTICE_FLOOR = 10;

@ApiExcludeController()
@UseFilters(WebhookPlainTextFilter)
@Controller()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  /**
   * [OBS-20260824-WHINFLIGHT] How many background webhook tasks are running.
   *
   * COUNTS ONLY. Nothing is refused, delayed or dropped — this exists because
   * the number is currently unknowable, and a ceiling cannot be chosen without
   * it. The handler answers 200 to LINE and fires `processWebhook` with no
   * counter, no queue and no backpressure, while each running task holds the
   * parsed body, the `rawBody` buffer, the hook document, the profile blocks
   * and (on the image path) the downloaded image. Mongo's pool is capped at 40
   * (`infra/mongo/mongo.module.ts`), so past some concurrency every task's
   * queries queue, each task lives longer, and more tasks arrive on top —
   * the shape that degrades the whole process rather than one request.
   *
   * ⚠️ SHEDDING WOULD NOT BE FREE, which is why this stage does none. The 200
   * has already gone out by the time work starts, so LINE will never redeliver:
   * an event dropped here is a customer message lost for good. That trade needs
   * the owner's decision and a real number to decide on. เฟสนี้แค่นับ ไม่ทิ้ง.
   *
   * revert: delete these two fields, `trackBackground`, and inline the original
   *         `.catch(...)` back at the two call sites.
   */
  private inFlight = 0;
  private peakInFlight = 0;

  /** Reading seams for the spec; nothing in the request path consumes these. */
  get backgroundInFlight(): number {
    return this.inFlight;
  }
  get backgroundPeak(): number {
    return this.peakInFlight;
  }

  /**
   * [OBS-20260824-WHINFLIGHT] Wraps the fire-and-forget dispatch both endpoints
   * share, so the counter cannot be right at one of them and wrong at the other.
   *
   * The `.catch` is the original one, string for string — runbooks grep
   * `[WEBHOOK BACKGROUND ERROR]`. `.finally` runs after it, so a task that
   * failed still decrements; without that a burst of errors would strand the
   * counter high and the peak would be a lie.
   *
   * A new peak is announced only from `PEAK_NOTICE_FLOOR` upward, and only when
   * it actually rises — so the line count over a process's life is bounded by
   * the peak itself, not by traffic.
   */
  private trackBackground(work: Promise<unknown>): void {
    this.inFlight += 1;
    if (this.inFlight > this.peakInFlight) {
      this.peakInFlight = this.inFlight;
      if (this.peakInFlight >= PEAK_NOTICE_FLOOR) {
        this.logger.warn(
          `[WHINFLIGHT] background webhook tasks peaked at ${this.peakInFlight} ` +
            `(mongo pool is 40) — nothing dropped, this is a measurement`,
        );
      }
    }
    void work
      .catch((err: Error) =>
        this.logger.error(`[WEBHOOK BACKGROUND ERROR] ${err.message}`),
      )
      .finally(() => {
        this.inFlight -= 1;
      });
  }

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * LINE webhook — default endpoint (no alias).
   *
   * Legacy: `router.post("/webhook", validateSignature, webhookController.handleWebhook)`
   *
   * Responds 200 "OK" immediately and processes the event in the background.
   * This matches the LINE best practice of responding within 1 second to
   * prevent retry storms.
   */
  @Public()
  @Post('webhook')
  @UseGuards(LineSignatureGuard)
  @HttpCode(200)
  handleWebhookDefault(
    @Req() req: LineWebhookRequest,
    @Res() res: Response,
  ): void {
    this.logIncoming(req, undefined);
    res.status(200).send('OK');

    // Background processing — fire and forget, now counted (WHINFLIGHT).
    this.trackBackground(
      this.webhookService.processWebhook(
        req.body as Record<string, unknown>,
        req.hook,
        req.hookSource,
        undefined,
        this.buildMeta(req),
      ),
    );
  }

  /**
   * LINE webhook — aliased endpoint.
   *
   * Legacy: `router.post("/:alias/webhook", validateSignature, webhookController.handleWebhook)`
   */
  @Public()
  @Post(':alias/webhook')
  @UseGuards(LineSignatureGuard)
  @HttpCode(200)
  handleWebhookAliased(
    @Param('alias') alias: string,
    @Req() req: LineWebhookRequest,
    @Res() res: Response,
  ): void {
    this.logIncoming(req, alias);
    res.status(200).send('OK');

    // Background processing — fire and forget, now counted (WHINFLIGHT).
    this.trackBackground(
      this.webhookService.processWebhook(
        req.body as Record<string, unknown>,
        req.hook,
        req.hookSource,
        alias,
        this.buildMeta(req),
      ),
    );
  }

  /**
   * The parts of the request the pipeline reads that are not the body.
   *
   * ⚠️ Read HERE, synchronously, not inside the background task. Express reuses
   *    and recycles the request object once the response is finished, so
   *    anything the pipeline needs must be copied out before this handler
   *    returns — the `res.send('OK')` above has already happened.
   *
   * ⚠️ `rawBody` is the exact bytes LINE signed. The signature re-check inside
   *    the service recomputes the HMAC over it; re-serialising the parsed JSON
   *    changes key order and whitespace and would never match.
   */
  private buildMeta(req: LineWebhookRequest): WebhookRequestMeta {
    // legacy:2807 — `process.env.BASE_URL || `${req.protocol}://${req.get('host')}``
    // with trailing slashes stripped. It is what makes a stored image path an
    // absolute URL the model and the chat UI can both fetch.
    const baseUrl = (
      process.env['BASE_URL'] || `${req.protocol}://${req.get('host') ?? ''}`
    ).replace(/\/+$/, '');

    return {
      method: req.method,
      originalUrl: req.originalUrl,
      rawBody: req.rawBody,
      signature: req.headers['x-line-signature'] as string | undefined,
      baseUrl,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  /**
   * Telegram webhook callback endpoint.
   *
   * Legacy: `router.post("/api/telegram/webhook", telegramWebhookController.handleTelegramWebhook)`
   *
   * Always responds 200 "OK" — even on error — per Telegram best practice.
   * The Telegram secret token check is inside the service; on mismatch it
   * returns 403 to match legacy behaviour.
   */
  @Public()
  @Post('api/telegram/webhook')
  @HttpCode(200)
  async handleTelegramWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.webhookService.processTelegramWebhook(
        req.body as Record<string, unknown>,
        req.headers as Record<string, string | undefined>,
      );
      res.status(200).send('OK');
    } catch (err) {
      if (err instanceof TelegramSecretMismatchError) {
        // Legacy: telegramWebhookController.js:17 — returns 403
        res.status(403).json({ error: 'invalid telegram secret token' });
        return;
      }
      this.logger.error(
        `[Telegram Webhook] Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Always respond 200 OK to Telegram — legacy:167-168
      res.status(200).send('OK');
    }
  }

  private logIncoming(req: Request, alias: string | undefined): void {
    this.logger.log(
      `[LINE WEBHOOK] ${req.method} ${req.path} alias=${alias ?? '(default)'} ` +
        `ip=${req.ip ?? 'unknown'}`,
    );
  }
}
