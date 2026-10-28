# omnidesk-ws — Dockerfile build for Coolify (Build Pack = Dockerfile).
#
# Why this exists: the Nixpacks build pulls a Nix store (Node + npm) of several
# GB during `nix-env`, which filled a 33 GB build host twice. omnidesk-ws is one
# file plus four runtime deps, so a plain node:alpine image is enough.
#
# Node 22 matches package.json `engines: >=20` (Nixpacks defaults to 18).
# Coolify: Ports Exposes must equal PORT (8080 below unless overridden by env).
# No HEALTHCHECK on purpose: /health answers 503 while Redis is down, and
# traefik drops unhealthy containers — a Redis blip would remove the route.
# revert: delete this file + .dockerignore, switch Build Pack back to Nixpacks.

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# deps first so a server.js-only change reuses the cached layer
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./

ENV PORT=8080
EXPOSE 8080

# the base image ships a non-root `node` user
USER node

# node as PID 1 receives SIGTERM directly → server.js shutdown() closes
# sockets with 1001 so clients reconnect to the next container at once
CMD ["node", "server.js"]
