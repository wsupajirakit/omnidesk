# omnidesk-mock-api — one image holds BOTH services; pick one at RUNTIME with the APP env var:
#   docker build -t zcrm-mock .
#   docker run -e APP=member-api    … zcrm-mock     (default · port 3301)
#   docker run -e APP=walletpay-api … zcrm-mock     (port 3302)
# `--build-arg APP=…` still works and only sets the default; a runtime APP always wins.
# Runs NODE_ENV=production, so the secrets must be real (>= 32 chars, not the placeholder):
# member-api needs MEMBER_HMAC_SECRET + MEMBER_JWT_SECRET (+ MEMBER_LOGIN_PASSWORD for /auth/login).
# HOST=0.0.0.0 because a container is reached through its published port — restrict who can
# call it with MEMBER_ALLOW_IPS / WALLETPAY_ALLOW_IPS or by publishing on 127.0.0.1 only.
# Seed data (apps/<app>/data) is baked in; writes stay in memory and reset on restart.
#
# [FIX-20261026-BUILDENV] Hosts such as Coolify pass every env var into the build by default
# ("Available at Buildtime"). With NODE_ENV=production there, `npm ci` skipped devDependencies and
# the build died with `tsc: not found`. `--include=dev` makes the build independent of that, and
# selecting the app at runtime means no variable ever has to be a build-time one. Secrets belong to
# runtime only — none of them is read during the build.
# revert: tag ckpt-before-mock-dockerfix-26102026

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY apps/member-api/package.json apps/member-api/
COPY apps/walletpay-api/package.json apps/walletpay-api/
RUN npm ci --include=dev
COPY packages packages
COPY apps apps
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ARG APP=member-api
ENV NODE_ENV=production HOST=0.0.0.0 APP=${APP}
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/core/package.json packages/core/
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/apps/member-api/package.json apps/member-api/
COPY --from=build /repo/apps/member-api/dist apps/member-api/dist
COPY --from=build /repo/apps/member-api/data apps/member-api/data
COPY --from=build /repo/apps/walletpay-api/package.json apps/walletpay-api/
COPY --from=build /repo/apps/walletpay-api/dist apps/walletpay-api/dist
COPY --from=build /repo/apps/walletpay-api/data apps/walletpay-api/data
USER node
EXPOSE 3301 3302
# exec: node is PID 1 and receives SIGTERM directly · an unknown APP fails loudly instead of idling
CMD ["sh", "-c", "case \"$APP\" in member-api|walletpay-api) exec node apps/$APP/dist/main.js ;; *) echo \"APP must be member-api or walletpay-api (got: $APP)\" >&2; exit 1 ;; esac"]
