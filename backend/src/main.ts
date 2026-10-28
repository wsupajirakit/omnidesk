import { resolve } from 'node:path';

import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { buildProxyGateMiddleware } from './infra/proxy-gate/proxy-gate.middleware';
import { buildGlobalRateLimitMiddleware } from './infra/rate-limit/global-rate-limit.middleware';
import { buildHardenedImageServeMiddleware } from './infra/static/hardened-image-serve.middleware';
import { buildHardenedVideoServeMiddleware } from './infra/static/hardened-video-serve.middleware';
import { RateLimitService } from './infra/rate-limit/rate-limit.service';
import { RedisService } from './infra/redis/redis.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    /**
     * Keeps the unparsed request body available as `req.rawBody`.
     *
     * Non-negotiable: LINE webhook signatures are an HMAC over the exact bytes
     * received. Re-serializing the parsed JSON changes key order and whitespace,
     * so the computed signature would never match — with correct-looking code.
     */
    rawBody: true,
    // Nest's own logs go through pino as well, so there is one log format.
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // ── static assets ─────────────────────────────────────────────────────────
  // [FIX-20260808-STATICSERVE] Serve everything under `<root>/public` at the
  // web root — the NestExpress equivalent of legacy `index.js:67`
  // `app.use(express.static(path.join(__dirname, "public")))`.
  //
  // Without this the backend WRITES inbound LINE media to
  // `public/uploads/images|videos` (line-content.service) and admin uploads to
  // `public/uploads/images` (chat-media.service) but never SERVES them, and the
  // bank logos under `public/bank-logos` 404. The dashboard stores image_url as a
  // RELATIVE path (`/uploads/images/x.png`, `/bank-logos/kbank.png`) and prefixes
  // its own API base — so it only works if this backend exposes those paths, the
  // same contract legacy has. This is the "FE plugs in by changing the API URL"
  // requirement: chat images, slip/flex cards and bank logos all break without it.
  //
  // `<root>/public` matches where files are written: line-content resolves
  // `__dirname/../../../public/...` which from `dist/modules/webhook/` is
  // `<root>/public`, and the Dockerfile mounts the volume at `/app/public/uploads`.
  //
  // [FEAT-20260808-GROUPB-IMGSERVE] Hardened stored-image serving — legacy
  // index.js:84-113. MUST be mounted BEFORE useStaticAssets so it (not
  // express.static) answers `/uploads/images/:filename`: ext-allowlist + explicit
  // Content-Type + a UNIFORM 404 that never reveals file existence. Success
  // responses stay byte-identical to static serving (same res.sendFile + explicit
  // Content-Type); only the 404 shape tightens. Every other path (videos,
  // bank-logos, SPA) falls through to useStaticAssets unchanged. useStaticAssets
  // still blocks `..`, so the traversal CVE is not reintroduced.
  // revert: delete this app.use + the middleware file (same marker).
  // ── security headers ──────────────────────────────────────────────────────
  // [FIX-20260818-HELMETFIRST] ⭐ MUST stay ABOVE the two static mounts below.
  //
  // Express runs middleware in registration order, so while helmet sat after
  // them every response under `/uploads/**` and `/bank-logos/**` — the only
  // attacker-supplied bytes this service serves — went out with NO `nosniff`,
  // no `X-Frame-Options` and no CSP. A stored `.html` (uploads accept any
  // extension today, see the fileFilter work) would then render as a document
  // in the victim's origin instead of downloading as an opaque blob.
  //
  // Why moving it is seamless for the images themselves: helmet 8.x with this
  // config emits document-level headers only — it does NOT emit
  // Cross-Origin-Resource-Policy (turned off just below) nor
  // Cross-Origin-Embedder-Policy, and those two are the only ones that could
  // stop the dashboard or LINE from fetching an image cross-origin. Body bytes
  // are untouched (proved by sha256 before/after in the checklist entry).
  // `public/` holds no index.html, so no HTML page exists here for CSP to break.
  //
  // revert: move this app.use(helmet(...)) block back below useStaticAssets.
  app.use(
    helmet({
      // Images uploaded here are embedded by the dashboard and fetched by LINE
      // from other origins; the default CORP header would block both.
      crossOriginResourcePolicy: false,
    }),
  );

  app.use(buildHardenedImageServeMiddleware());
  /* [FEAT-20260904-OBJVIDEO] `/uploads/videos/:file` had NONE of the three
     protections the line above gives images — no extension allow-list, no
     explicit Content-Type, no uniform 404 — because the comment block above
     says videos "fall through to useStaticAssets unchanged", and they did.
     Inbound LINE videos already live there; the Object album is about to add
     admin-uploaded ones. Same position rule: BEFORE useStaticAssets, or express
     static answers first and this never runs.
     revert: delete this line and the middleware file. */
  app.use(buildHardenedVideoServeMiddleware());
  app.useStaticAssets(resolve(process.cwd(), 'public'));

  // ── cookies ───────────────────────────────────────────────────────────────
  // [FEAT-20260808-HTTPONLY-S1] Parses the Cookie header into `req.cookies` so
  // JwtAuthGuard can read the HttpOnly auth cookie. Mounted before routing; the
  // Bearer-header path in the guard is unaffected when no cookie is present.
  app.use(cookieParser());

  // ── cors ──────────────────────────────────────────────────────────────────
  // [FEAT-20260808-HTTPONLY-S1] Credentialed CORS: the auth cookie is only sent
  // cross-origin when the response echoes the exact caller origin AND sets
  // `Access-Control-Allow-Credentials: true`. A wildcard `*` with credentials is
  // rejected by browsers, so when the allowlist is set we NEVER reflect an
  // arbitrary origin — an allow-listed origin is echoed, anything else gets no
  // Allow-Origin header and the browser blocks it (no 500; a bare denial).
  //
  // Empty list keeps the permissive legacy behaviour so local dev and existing
  // Bearer deployments are untouched. CORS_ALLOWED_ORIGINS becomes REQUIRED in
  // production once the cookie is live: reflect-any + credentials cannot coexist.
  // Set it to the dashboard origin(s), e.g. `https://dash.example.com` (and
  // `http://localhost:5173` for local FE).
  const allowedOrigins = config.get<string[]>('http.corsAllowedOrigins') ?? [];
  app.enableCors({
    origin: allowedOrigins.length
      ? (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void,
        ) =>
          // Same-origin/no-origin requests (curl, server-to-server) carry no
          // Origin header and are allowed. A browser Origin must be on the list
          // to be echoed; anything else is rejected — with credentials on, an
          // unlisted origin must NOT be reflected.
          callback(null, !origin || allowedOrigins.includes(origin))
      : true,
    // Echo credentials so the browser accepts the auth cookie on the response.
    credentials: true,
  });

  // ── request validation ────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      // Strips properties without a DTO decorator: mass-assignment cannot reach
      // a Mongoose model through an unexpected field.
      whitelist: true,
      // Unknown properties are rejected outright rather than silently dropped,
      // which also blocks `$`-prefixed operator injection at the edge.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      /**
       * Collapses validation failures into ONE message, matching the legacy
       * backend's `{ error: "<message>" }` envelope.
       *
       * Nest's default joins every failed constraint, so a DTO whose fields
       * share a message ("username and password are required" on four
       * constraints) renders it four times separated by semicolons. The
       * dashboard prints `error` verbatim, so the operator would read the same
       * sentence repeated. Deduplicating preserves order and keeps genuinely
       * different messages visible.
       */
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((error) =>
          Object.values(error.constraints ?? {}),
        );
        const unique = [...new Set(messages)];
        return new BadRequestException(
          unique.length > 0 ? unique.join('; ') : 'validation failed',
        );
      },
    }),
  );

  // Behind a reverse proxy: without this every client shares the proxy's IP and
  // per-IP rate limiting would throttle everyone at once.
  app.set('trust proxy', true);

  // [FEAT-20260808-P3GLOBALRL] Opt-in global per-IP rate limit, mounted app-wide
  // (legacy index.js:119 `app.use(rateLimitGlobalGuarded)`). DEFAULT OFF: while
  // RATE_LIMIT_GLOBAL_ENABLED is unset/false this is a bare next(), so the app
  // is byte-identical to today. Mounted AFTER `trust proxy` so client-IP
  // resolution sees the real caller. revert: delete this + the middleware file.
  app.use(buildGlobalRateLimitMiddleware(app.get(RateLimitService)));

  // [FEAT-20260813-PROXYGATE] Inner gate of the BE lockdown (docs/
  // migrate-stack.md): requires the front proxy's X-Internal-Secret stamp on
  // everything except the external allowlist (LINE/Telegram/handoff/
  // customer-link/health). DEFAULT OFF: while INTERNAL_PROXY_SECRET is unset
  // this is a bare next(), byte-identical to today. Mounted AFTER the static
  // mounts (uploads/bank-logos stay public by position) and AFTER rate-limit
  // (a stamped flood still counts against the per-IP window).
  // revert: delete this + src/infra/proxy-gate/ + the env key.
  app.use(
    buildProxyGateMiddleware(config.get<string>('http.internalProxySecret')),
  );

  // ── payload limits ────────────────────────────────────────────────────────
  // 2 MB matches the legacy backend. Flex message definitions and base64 image
  // payloads are the largest legitimate bodies; anything beyond that is either a
  // mistake or an attempt to exhaust memory.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

  // ── api docs ──────────────────────────────────────────────────────────────
  // Generated from the same decorators that enforce validation, so the contract
  // cannot drift from the implementation.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('omnidesk-api')
    .setDescription('Omnichannel messaging and operations API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  // ── lifecycle ─────────────────────────────────────────────────────────────
  // Runs onApplicationShutdown hooks on SIGTERM/SIGINT so Mongo and Redis
  // sockets are closed properly. Without it a container kill leaves the server
  // counting dead connections, and the next deploy's first request can stall on
  // one of them for the full socket timeout.
  app.enableShutdownHooks();

  // Warm Redis before opening the port: otherwise the first caller after a
  // deploy pays the connect cost, and that caller is almost always login
  // (rate limiting talks to Redis before the handler runs). Failure is
  // non-fatal — the client reconnects lazily and rate limiting fails open.
  const bootstrapTimeoutMs =
    config.get<number>('core.bootstrapTimeoutMs') ?? 5000;
  await withTimeout(
    app.get(RedisService).warmup(),
    bootstrapTimeoutMs,
    'redis warmup',
  ).catch((error: Error) =>
    logger.warn(`Redis warmup skipped: ${error.message}`),
  );

  const port = config.get<number>('core.port') ?? 3000;
  await app.listen(port);
  logger.log(
    `omnidesk-api listening on http://localhost:${port} (docs: /docs)`,
  );
}

/**
 * Caps a bootstrap step. A hanging dependency (Redis refusing connections
 * rather than rejecting) would otherwise block startup forever — the app must
 * still come up degraded instead of never coming up at all.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${ms}ms`)),
          ms,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

void bootstrap();
