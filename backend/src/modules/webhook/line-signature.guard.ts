import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { CryptoService } from '@/infra/crypto';
import { HookCacheService } from '@/modules/hooks';

/**
 * LINE webhook signature validation guard.
 *
 * Implements the same HMAC-SHA256 check as legacy
 * `legacy-api/src/middleware/lineSignature.js`.
 *
 * ⚠️ Uses `req.rawBody` — the unparsed request bytes. Re-serialising the
 * parsed JSON changes key order and whitespace, so the computed signature would
 * never match. `main.ts` enables `rawBody: true` for exactly this reason.
 *
 * Ported from: legacy-api/src/middleware/lineSignature.js (74 lines)
 *
 * Why a guard instead of middleware:
 * - Nest guards can be applied per-route with `@UseGuards`, keeping the
 *   webhook routes explicit about their auth mechanism
 * - The guard can inject services (CryptoService, Hook model) through DI
 * - The controller already responds 200 OK — the guard never needs to send
 *   its own response body, it just decides pass/reject
 */
@Injectable()
export class LineSignatureGuard implements CanActivate {
  private readonly logger = new Logger(LineSignatureGuard.name);

  constructor(
    private readonly hookCache: HookCacheService,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      params: { alias?: string };
      headers: Record<string, string | undefined>;
      rawBody?: Buffer;
      body?: unknown;
      hook?: Record<string, unknown>;
      hookSource?: string;
    }>();

    const alias = request.params.alias;

    // Resolve hook by alias — same logic as legacy lineSignature.js:21-28
    let hook: Record<string, unknown> | null = null;
    let source: string | null = null;

    if (alias) {
      /**
       * Through the cache, never a direct findOne.
       *
       * LINE calls this webhook on every inbound message, so a query here is a
       * database round-trip per message on the hottest path in the system.
       * Legacy resolves the same way (`webhookController.js:2340`) and serves
       * almost everything from a 15-second in-process map.
       */
      const resolved = await this.hookCache.getHookByAliasWithSource(alias);
      const doc = resolved.hook;
      source = resolved.source;
      if (!doc) {
        // Alias provided but not found — legacy returns 404 "Unknown alias" as
        // PLAIN TEXT (webhookController.js:2358, `res.status(404).send(...)`).
        // Returning false here would give Nest's 403 {"error":"Forbidden
        // resource"}: wrong status AND wrong envelope. Throwing a string-payload
        // HttpException is what reproduces legacy byte-for-byte — see
        // rejectPlainText() for why the payload must be a bare string.
        this.logger.warn(`Unknown alias: ${alias}`);
        throw rejectPlainText(HttpStatus.NOT_FOUND, 'Unknown alias');
      }
      hook = doc;
    }

    // Resolve the channel secret. tryDecryptSecret tells us WHY it failed
    // (undecryptable ciphertext vs simply empty) so a 401 is never a mystery.
    // Legacy: lineSignature.js:32-34
    const rawSecret =
      (hook?.channel_secret as string | undefined) ??
      (hook?.line_secret as string | undefined) ??
      '';
    const dec = this.crypto.tryDecryptSecret(rawSecret || undefined);
    const secret = dec.value || undefined;

    const signature = request.headers['x-line-signature'];

    // Use rawBody (Buffer) — the exact bytes LINE signed.
    // Fallback to JSON.stringify matches legacy lineSignature.js:36, but should
    // never be needed since main.ts sets rawBody: true.
    const body = request.rawBody ?? JSON.stringify(request.body ?? {});

    if (!signature || !secret || !body) {
      const reason = !signature
        ? 'missing x-line-signature header'
        : !secret
          ? dec.ok
            ? 'channel secret not configured (empty)'
            : 'channel secret UNDECRYPTABLE (wrong/old ENCRYPTION_KEY)'
          : 'empty request body';
      this.logger.warn(
        `401 alias=${alias ?? '(none)'} source=${source ?? 'n/a'} reason=${reason}`,
      );
      // legacy lineSignature.js:45 — 401 plain text, not 403 JSON
      throw rejectPlainText(HttpStatus.UNAUTHORIZED, 'Invalid signature');
    }

    const hash = createHmac('SHA256', secret).update(body).digest('base64');

    // Constant-time comparison — legacy lineSignature.js:12-16 (safeStrEqual)
    if (!safeStrEqual(hash, signature)) {
      this.logger.warn(
        `401 alias=${alias ?? '(none)'} source=${source ?? 'n/a'} reason=hash-mismatch ` +
          `(secret present but does not match LINE — verify the channel secret value vs LINE console; ` +
          `bodyLen=${body.length} usingRawBody=${!!request.rawBody})`,
      );
      // legacy lineSignature.js:59 — 401 plain text
      throw rejectPlainText(HttpStatus.UNAUTHORIZED, 'Invalid signature');
    }

    // Attach hook data for downstream usage — same as legacy lineSignature.js:63-64
    request.hook = hook ?? undefined;
    request.hookSource = source ?? undefined;

    return true;
  }
}

/**
 * Builds the rejection legacy actually sends: a status plus a **plain-text**
 * body, never the `{ error }` JSON envelope the rest of this API uses.
 *
 * Why this exists at all. `lineSignature.js` and `webhookController.js` reject
 * with `res.status(n).send("...")` — Express `res.send` on a string writes the
 * bare string with `text/html`. LINE is the only caller of these routes and is
 * not a JSON client, so the legacy contract here is text. Answering
 * `{"error":"Invalid signature"}` would be the right status with the wrong body
 * and still fails the parity diff.
 *
 * `PlainTextHttpException` is a marker: `WebhookPlainTextFilter` catches it and
 * writes the body verbatim. It is scoped to the webhook controller so the global
 * `{ error }` envelope every other endpoint depends on is untouched.
 */
export class PlainTextHttpException extends HttpException {
  constructor(
    status: number,
    readonly text: string,
  ) {
    super(text, status);
  }
}

function rejectPlainText(status: number, text: string): PlainTextHttpException {
  return new PlainTextHttpException(status, text);
}

/**
 * Constant-time string comparison for the HMAC check.
 *
 * `crypto.timingSafeEqual` throws on unequal-length buffers, so we
 * length-guard first. A length mismatch is a mismatch anyway → false.
 *
 * Ported from: legacy-api/src/middleware/lineSignature.js:12-16
 */
function safeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
