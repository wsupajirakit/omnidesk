# ── STAGE 1: Base ───────────────────────────────────────────────────────────
# [SEC-20261022-NODEPIN] Node pinned to the October 2026 security release (22.23.4 fixes
# CVE-2026-111497 Brotli RCE — body-parser inflates `Content-Encoding: br` request bodies
# before any guard — plus the TLS hostname / dns / keep-alive fixes). Pinned, not the floating
# `22-alpine`, because a build host that cached the old tag would silently keep 22.23.x-old.
# Bump BOTH FROM lines together. revert: FROM node:22-alpine (both lines).
FROM node:22.23.4-alpine AS base

# Install pnpm
RUN npm install -g pnpm

# ── STAGE 2: Dependencies ───────────────────────────────────────────────────
FROM base AS dependencies

WORKDIR /app

# Copy lockfile and package config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (including devDependencies) for build
RUN pnpm install --frozen-lockfile

# ── STAGE 3: Build ──────────────────────────────────────────────────────────
FROM base AS build

WORKDIR /app

# Copy dependencies
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy source code and TS configs
COPY src ./src
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

# ── [FIX-20260818-STUBATBUILD] the scripted AI providers do not ship ──────────
# Owner's rule, 18/08/2026: simulation code must not reach staging or production.
# These two classes cannot be deleted from src/ — they are DI tokens wired into
# webhook.module.ts and the classes the switch tests construct to prove that
# AI_PROVIDER=mock is refused, so deleting them would break the guard's own
# tests. Instead the CLASS survives and the BEHAVIOUR does not: these stubs take
# their place here, so the artifact resolves the same tokens and wires the same
# module graph while being unable to answer a customer from a script.
#
# Verify on any built image (dist/modules, NOT dist/modules/webhook — the third
# scripted provider lives under tickets/, so the narrower path misses it):
#   grep -rl 'AI-MOCK' dist/modules                      → nothing
#   grep -rl 'stubbed out of deploy builds' dist/modules → 3 files
# `pnpm preflight` asserts all three COPY lines are present AND that each
# destination is a file that really exists in src — see the merge note below.
# คลาสยังอยู่ให้ DI ผูกได้ · สคริปต์ตอบลูกค้าไม่ขึ้น deploy.
#
# ⚠️ MERGE NOTE 18/08 — the destinations are NOT the paths this arrived with.
# This lane moved both providers into folders (`ai-reply/`, `assist/`) before dev
# added these lines against the flat layout. A COPY whose destination does not
# exist does not fail: Docker CREATES it. The build would have gained two orphan
# files nobody imports while the REAL scripted providers shipped untouched — the
# exact silent failure these lines exist to prevent, passing preflight the whole
# way. ปลายทางต้องตรงกับที่ไฟล์อยู่จริง ไม่งั้น COPY สร้างไฟล์ใหม่แล้วของจริงหลุดขึ้น deploy.
COPY build/prod-stubs/scripted-ai-reply.provider.ts ./src/modules/webhook/ai-reply/scripted-ai-reply.provider.ts
COPY build/prod-stubs/scripted-assist-summary.provider.ts ./src/modules/webhook/assist/scripted-assist-summary.provider.ts
COPY build/prod-stubs/scripted-translate.provider.ts ./src/modules/ai-translate/scripted-translate.provider.ts

# Build NestJS application
RUN pnpm build

# ── STAGE 4: Production Dependencies ────────────────────────────────────────
FROM base AS prod-dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# ── STAGE 5: Runner ─────────────────────────────────────────────────────────
FROM node:22.23.4-alpine AS runner

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Install pnpm for running script commands if needed
RUN npm install -g pnpm

# Copy built app and production dependencies
COPY --from=build /app/dist ./dist
COPY --from=prod-dependencies /app/node_modules ./node_modules
COPY package.json ./

# [FIX-20260808-DOCKERPUBLIC] Bake the repo's static assets into the image.
# `app.useStaticAssets(<cwd>/public)` serves everything under /app/public, but the
# runner never copied `public/` — so /bank-logos/*.png (21 committed files used by
# flex/slip cards, and by the dashboard which prefixes the API base) returned 404
# on every deploy. The customer-media subtree `public/uploads` is a runtime VOLUME
# (declared below) and is intentionally NOT baked; bank-logos live OUTSIDE it at
# /app/public/bank-logos, so the volume mount does not shadow them.
COPY public ./public

# Inbound-media directories, created HERE and owned by `node`.
#
# ⚠️ Without this the container crash-loops at boot, before any request:
#
#     EACCES: permission denied, mkdir '/app/public/uploads/images'
#         at LineContentService.ensureDir (dist/modules/webhook/line-content.service.js)
#         at new LineContentService (...)
#
# `LineContentService` calls `mkdirSync` in its CONSTRUCTOR, which Nest runs
# while building the injector — so the failure happens during module
# initialisation and takes the whole process down, restart after restart.
#
# That is not a porting mistake: legacy does exactly the same thing at require
# time (`lineContentService.js:10-13` for images, `:91-94` for videos), and the
# rule for this migration is to behave identically whether or not the code path
# is reached. What differs is only the packaging — legacy runs as a user that
# can write its own directory, while this image drops to `USER node` below and
# `/app` is owned by root, so the very first mkdir is refused.
#
# Created before the USER switch and chowned, so the constructor finds them
# already present and never needs to create anything.
RUN mkdir -p /app/public/uploads/images /app/public/uploads/videos \
    && chown -R node:node /app/public

# ⚠️ These directories hold customer media written at runtime. A container
# filesystem is ephemeral, so mount a volume at /app/public/uploads in
# production or every inbound image and video is lost on redeploy.
VOLUME ["/app/public/uploads"]

# Use non-root node user for security
USER node

# Expose default NestJS port
EXPOSE 3000

# Start command.
#
# `dist/main.js` is now pinned by `rootDir: "src"` in tsconfig.build.json, so it
# is the entry point in every environment. It used to depend on what
# `.dockerignore` excluded — the image dropped `z-test`, so `src` was the only
# input and tsc flattened the output, while a local build kept the repo root and
# produced `dist/src/main.js`. That made `pnpm start:prod` (`node dist/main`)
# unable to run a local build, and it made this CMD correct only as a side
# effect of a .dockerignore line.
CMD ["node", "dist/main.js"]
