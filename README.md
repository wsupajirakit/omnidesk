# OmniDesk

OmniDesk is an omni-channel customer support and commerce platform. Support agents, an AI
assistant and the payment flow work from one console: customers write in through a messaging
channel, the AI drafts or sends replies grounded in each account's own documents, payment slips
are verified, cases are opened and handed between agents in real time, and campaigns go out from
the same place.

The repository holds the whole system:

| Folder | What it is |
|---|---|
| `frontend/` | **Console** — the React single-page app agents and admins use. |
| `backend/` | **API** — NestJS service: webhooks, AI replies, tickets, payments, admin. |
| `backend/ws/` | **WebSocket gateway** — a small Node service that pushes live ticket events to the console. |
| `backend/mock-api/` | **Mock upstreams** — fake member and wallet-payment APIs so the platform runs end to end without any third-party account. |
| `backend/demo/` | **Demo database seed** — fictional store, customers, chats and tickets. |
| `deploy/` | **Deployment** — Docker Compose stack, Traefik routing and lockdown, origin-firewall scripts. |

---

## Features

**Conversations and cases**
- Channel-neutral data model: every account, room and ticket carries a channel type; channels
  plug in through one channel registry (LINE today, Facebook integration supported).
- Live ticket queues (waiting, mine, in progress, bot-handled, closed) with counts and new-case
  highlights pushed over WebSocket; claims are guarded so two agents never take the same case.
- Close-case wizard with follow-up decisions, reopen and open-from-room, assignment history,
  customer tags, pinned rooms, strikes and quick replies.

**AI assistant**
- Gemini and DeepSeek behind one interface, chosen per account, with per-vendor reasoning settings.
- Retrieval-augmented answers (RAG): structural chunking, hybrid BM25 + vector search
  (Gemini embeddings, reciprocal-rank fusion). Off unless an account turns it on.
- Automatic inbound / outbound translation with a business glossary.
- Hard usage caps per machine and an audit row for every model call.

**Reply pipeline**
- Every inbound event runs through a declared, ordered ladder of ~40 single-purpose steps
  (signature check, hand-off to a human, out-of-hours, rate limit, QR pre-scan, retrieval, model
  call, cards, case opening). A new rule is one file.
- Dynamic reply cards: the model picks a card and fills its content slots; cards bind live
  customer and store data through a spec-driven variable map, drop empty sections and fall back
  to plain text on any error.

**Payments**
- Pluggable slip-verification providers chosen per account; a slip already credited is reported
  as such instead of being paid twice; a provider's decline is never confused with an outage.

**Integrations**
- Handoff engine: admins define outbound targets and chains (bearer / API-key / HMAC auth);
  callbacks are signature-checked and matched to their job by ordered strategies that never guess.
- Customer-data providers: each upstream site is described by a field-path table and a closed set
  of view sections, so adding a site is a backend-only change.
- Dynamic `[[tags]]`, per-account site rules (cached, single-flight) and broadcast campaigns with
  nested audience rules and per-recipient variables.

**Console**
- React + Vite + Tailwind, TanStack Query for server state (one client, typed per-module query
  hooks, polling that pauses on hidden tabs), fully bilingual (Thai / English).

---

## Tech stack

| Layer | Technologies |
|---|---|
| API | NestJS, TypeScript, Node.js 22, MongoDB / Mongoose, Redis (ioredis), BullMQ, Pino, Zod, class-validator, Swagger |
| Console | React, Vite, Tailwind CSS, TanStack Query, React Router, Recharts, Lucide |
| Realtime | WebSocket (`ws`), Redis pub/sub, single-use connection tickets |
| AI | Gemini, DeepSeek, RAG (BM25 + vector) |
| Testing | Jest, Supertest, Vitest, Testing Library, characterization and mutation testing |
| Delivery | Docker, Docker Compose, Traefik, nginx, GitHub Actions, gitleaks |

---

## Repository layout

```
frontend/              Console (React + Vite)
  pages/               Screens: chat, hook, content, messaging, handoff, insight, admin
  components/          UI building blocks, grouped by feature
  services/            API clients and TanStack Query hooks per module
  i18n/                Translations
  test/                Vitest suites
backend/               API (NestJS)
  src/modules/         Feature modules: webhook, chat, tickets, ai, rag, payment, slip,
                       handoff, customer-provider, content, hooks, admin, auth, ...
  src/infra/           Redis, Mongo, realtime publisher, crypto, rate limit, proxy gate
  z-test/              Jest suites (unit + e2e) and fixtures
  demo/                Demo database seed
  ws/                  WebSocket gateway (Node, no framework)
  mock-api/            Mock member API + mock wallet-payment API (TypeScript workspaces)
deploy/
  docker-compose.yml   Full stack behind Traefik
  traefik/             Static config, routing, edge lockdown switch, SPA nginx config
  cloudflare-firewall/ Scripts that limit the origin firewall to Cloudflare's ranges
```

### `backend/ws` — the WebSocket gateway
A single `server.js`. The API publishes ticket events to Redis; the gateway subscribes and fans
each event out to the connected consoles, filtered to the accounts each agent may see. Consoles
authenticate with a single-use ticket the API mints in Redis (`GETDEL` on connect), so no token
travels in the URL.

### `backend/mock-api` — mock upstreams
Two small HTTP services with JSON data and no database:
- `member-api` — member profiles, store rules and top-ups, HMAC-signed like a real partner API.
- `walletpay-api` — a wallet pay-in endpoint that accepts slip uploads.

They let the customer-data provider, the custom tools and the payment flow run locally.

---

## Getting started

### Prerequisites
- Node.js 22, pnpm 10 (API), npm (console, mock APIs)
- MongoDB 7 and Redis 7 (local install or `docker compose up mongo redis`)

### 1. Configure
```bash
cp backend/.env.example backend/.env.local            # API
cp backend/ws/.env.example backend/ws/.env            # WebSocket gateway
cp backend/mock-api/.env.example backend/mock-api/.env
```
Fill at least `MONGODB_URI`, `JWT_SECRET`, `ENCRYPTION_KEY` and the `INIT_*` passwords.
Leave `GEMINI_API_KEY` empty and keep `AI_PROVIDER=mock` while developing — the scripted provider
answers without calling any AI vendor.

### 2. Run
```bash
# API — http://localhost:3000 (Swagger at /docs)
cd backend && pnpm install && AI_PROVIDER=mock pnpm start:dev

# WebSocket gateway — ws://localhost:8080
cd backend/ws && npm install && npm start

# Mock upstreams — :3301 (members) and :3302 (wallet pay)
cd backend/mock-api && npm install && npm run start:member & npm run start:walletpay

# Console — http://localhost:5173
cd frontend && npm install && npm run dev
```
On first boot the API creates the roles, menus and the `INIT_*` users.

### 3. Demo data
```bash
cd backend && MONGODB_URI=mongodb://127.0.0.1:27017/omnidesk pnpm seed:demo          # insert
cd backend && MONGODB_URI=mongodb://127.0.0.1:27017/omnidesk pnpm seed:demo --reset  # recreate
```
Creates a fictional store (two accounts, six customers with chat rooms, tickets in every state,
tags, dynamic tags and quick replies). Add your own channel secret and access token in the console
to receive real messages.

---

## Testing

```bash
cd backend && pnpm typecheck && pnpm lint && pnpm test:unit     # API (AI_PROVIDER=mock)
cd frontend && npx tsc --noEmit && npm run lint && npm test     # console
cd backend/mock-api && npm run typecheck && npm test            # mock upstreams
cd backend/ws && npm test                                       # WebSocket gateway
```
The test suites never reach a real AI vendor: a guard in the API test setup blocks outbound AI
hosts. Refactors are covered by characterization tests (full-screen DOM snapshots, request-count
tests) and checked with mutation testing.

---

## Deployment

### Docker Compose + Traefik
```bash
cd deploy
cp .env.example .env            # INTERNAL_PROXY_SECRET
docker compose up -d --build
docker compose exec api node demo/seed-demo.mjs   # optional
```
- Console: `http://console.localhost` · public API host: `http://api.localhost`
- Only Traefik publishes a port. MongoDB, Redis, the API, the gateway, the mock APIs and the
  console are reachable on the internal Docker network only.

### Traefik routing (`deploy/traefik`)
- The console calls the API on its **own origin**. `routing.yaml` sends the API prefixes
  (`/api`, `/hook`, `/webhook`, `/payment`, …) to the API, `/ws` to the gateway and everything
  else to the SPA. Cookies stay same-site and no CORS exception is needed.
- On that route Traefik injects `X-Internal-Secret`; with `INTERNAL_PROXY_SECRET` set, the API's
  proxy gate refuses any request that did not come through it.
- Routers live in watched files: adding, editing or renaming a file applies in about a second,
  with no restart.

### Security layers
Three independent layers, each with its own switch and revert:
1. **Network** — the cloud firewall admits ports 80/443 from Cloudflare's published ranges only.
   `deploy/cloudflare-firewall/cf-firewall-sync.sh` adds the ranges (dry-run by default, before /
   after snapshots); `cf-firewall-restore.sh` rolls back. The API key is read from the environment
   only. A cloud firewall is used instead of `ufw` because Docker bypasses host iptables rules.
2. **Edge** — rename `deploy/traefik/dynamic/lockdown.yaml.off` to `lockdown.yaml` and the public
   API host answers 403 for everything except webhooks, payment callbacks, uploads and health.
3. **App** — the proxy gate described above.

Also in place: JWT in HttpOnly same-site cookies with a CORS allowlist; messaging-platform
webhooks verified by HMAC signature (never IP-filtered); per-IP and per-account login rate limits;
stored credentials encrypted with AES-256-GCM and checked at boot; SSH key-only access on the
host; gitleaks in CI.

### Reference production setup
A single VM running Docker under a self-hosted PaaS, Traefik as the edge proxy, Cloudflare in
front for DNS, TLS and the origin allowlist. Any Docker host works the same way with the Compose
file above.
