# Architecture

[← Back to README](../README.md)

Two cooperating services. A **Next.js 16 application** (App Router) is the BFF, UI, and auth layer — it is the **sole writer to PostgreSQL** and the **only orchestrator of AI**. Behind it sits a stateless, internal **FastAPI AI plane** (`ai/`) that wraps NVIDIA NIM models; it is server-side only (never browser-facing) and gated by a shared service token. Rendering is server-first (React Server Components + Server Actions); the client bundle is only what interactivity requires.

### Core Stack

| Component | Technology                         | Purpose                                                                   |
| --------- | ---------------------------------- | ------------------------------------------------------------------------- |
| Framework | Next.js 16                         | App Router, RSC, Server Actions; BFF + sole DB writer                     |
| AI plane  | FastAPI (`ai/`) + NVIDIA NIM       | Internal, stateless AI service (extract, embed, copilot, agent, forecast) |
| Auth      | Auth.js v5                         | Credentials + OAuth, JWT, Argon2id, RBAC                                  |
| Database  | PostgreSQL 17 + pgvector + Drizzle | Type-safe schema, migrations, vector search                               |
| Storage   | MinIO (S3-compatible)              | File uploads, object storage                                              |
| PWA       | Custom service worker              | Offline resilience, push notifications                                    |

### AI plane

The AI plane (`ai/`, FastAPI) is an internal, stateless microservice that holds no
database and no user session — Next.js is the only thing that calls it, always
server-side, and passes an `x-service-token` (`WARDBEAT_AI_SERVICE_TOKEN`) on every
request. Next.js reaches it at `WARDBEAT_AI_URL` (`http://ai:8000` inside the compose
network). It wraps three **NVIDIA NIM** models — `nvidia/nvidia-nemotron-nano-9b-v2`
(extraction / chat / narration), `nvidia/nv-embedqa-e5-v5` (1024-dim embeddings), and
`nvidia/llama-3.2-nv-rerankqa-1b-v2` (rerank) — and can run fully offline with
deterministic stubs when `NIM_MOCK=true`.

Endpoints: `GET /healthz`, `GET /config` (token-gated), `POST /extract`, `POST /embed`,
`POST /copilot/route`, `POST /copilot/query-intent`, `POST /copilot/rerank`,
`POST /copilot/answer`, `POST /agent/recommend`, `POST /forecast/discharge`,
`POST /forecast/demand`, `POST /forecast/narrate`.

See [AI plane README](../ai/README.md), the in-app [platform guide](guide.html), the
[eval harnesses](evals.md), and [monitoring](monitoring.md).

### Request Flow

1. **Edge proxy** (`src/proxy.ts`) runs first on protected paths:
   - Uses edge-safe auth config (no DB, no native crypto)
   - Checks session via JWT
   - Redirects unauthenticated users to `/login`
   - Redirects users without required roles to `/403`

2. **App Router** renders pages as Server Components:
   - Protected layouts/pages re-read session server-side (`getCurrentSession`) as defense in depth
   - Server Actions handle mutations (register, login, sign-out, ward actions)
   - No separate API layer for forms

3. **AI calls** are made server-side only:
   - Server Actions / scripts call the FastAPI **AI plane** at `WARDBEAT_AI_URL`
     with an `x-service-token`; the browser never talks to it directly
   - Next.js persists every AI output back to Postgres (extractions, barriers,
     recommendations, audit) — the AI plane itself is stateless

4. **Drizzle ORM** executes type-safe queries:
   - Against Postgres (17 + pgvector) via pooled `postgres-js` client
   - Next.js is the single writer; the AI plane never touches the database

### Container Topology

#### Production Stack (`docker-compose.prod.yml`)

```
Internet (HTTPS)
   │
   ▼ Cloudflare Tunnel (public gateway)
   │
   ▼ app:3000 (Next.js service)
   │
   ├─ SQL   → db:5432   (Postgres 17 + pgvector)
   │
   ├─ HTTP  → ai:8000   (FastAPI AI plane — INTERNAL only, off the tunnel,
   │                     x-service-token, wraps NVIDIA NIM)
   │
   └─ S3    → minio:9000 (objects)
```

Only `app:3000` is reachable from the public gateway. `ai:8000` has no ingress of its
own — it is called exclusively from the Next.js server over the internal network.

### Authentication Design

The authentication layer covers:

- JWT session strategy (`src/lib/auth/config.ts`, `src/lib/auth/index.ts`)
- Edge protection with `proxy.ts`
- Role-based access control (`src/lib/auth/rbac.ts`)
- Rate limiting and security (`src/lib/rate-limit.ts`)

See [Features](features.md) for the user-facing capabilities and
[OAuth](oauth.md) / [Email](email.md) for provider-specific setup.

## Security model

- **Password storage** — Argon2id (`@node-rs/argon2`, OWASP-recommended
  parameters); passwords are never stored or logged in plaintext.
- **Sessions** — HTTP-only, encrypted JWT cookies (Auth.js); an undecryptable
  cookie (e.g. after an `AUTH_SECRET` rotation) is treated as "signed out"
  rather than crashing the request.
- **Rate limiting** (`src/lib/rate-limit.ts`) — per-account (IP + email) and a
  global per-IP cap on login/registration, enforced non-bypassably inside the
  credentials `authorize` callback, not just at the route layer.
- **Enumeration resistance** — failed logins run a dummy Argon2id verify so
  response timing doesn't reveal whether an account exists; invite/reset/verify
  flows are similarly silent on non-existent accounts.
- **Headers** — a nonce-based Content-Security-Policy (per request, via
  `src/proxy.ts`), HSTS, and `X-Frame-Options: DENY`.
- **Access control** — roles carried as a claim on the JWT/session; edge
  gating in `src/proxy.ts` (`ROLE_REQUIRED`) plus server-side re-checks
  (`requireRole()` / `requireAnyRole()`, `src/lib/auth/rbac.ts`) as defense in
  depth. See [Features → Access control](features.md#access-control-rbac).
- **Environment validation at boot** (`src/lib/env.ts`) — the app refuses to
  start if required variables are missing or malformed, rather than failing
  unpredictably at request time.
- **Docker image** — non-root user, multi-stage build, no build tooling in the
  runtime image.

See [SECURITY.md](../SECURITY.md) for the vulnerability-reporting process and
[Usage → Production checklist](usage.md#production-checklist) before deploying.

## Project Structure

```
src/
├── app/
│   ├── (auth)/                  # login · register · forgot/reset-password · verify-email
│   ├── (dashboard)/             # board (dashboard) · ward · copilot · briefing · settings (+audit) · about
│   ├── api/                     # auth · files · health endpoints
│   └── manifest.ts, offline/    # PWA support
├── components/                  # ward · copilot · briefing · about · auth · files · push · pwa · settings · shell · theme · ui
├── db/                          # Drizzle schema, migrate/seed scripts (base, ward, policy), extraction/recommend runners
├── eval/                        # AI eval harnesses (extraction · copilot · actions · forecast) + provenance/narration guards
├── lib/
│   ├── ai/                      # server-only AI-plane client, provenance, AI config, embedding-model drift
│   ├── auth/                    # config (edge) · index (node) · rbac · ward-access · roles · tokens · session
│   ├── ward/ copilot/ briefing/ actions/ audit/   # domain logic (barriers, RAG, forecasts, audit)
│   └── email/ push/ storage/ shell/ validations/ env.ts · logger.ts · rate-limit.ts
├── types/                       # shared TypeScript types
└── proxy.ts                     # edge protection + role gating
ai/                              # FastAPI AI plane — routers (extract · embed · copilot · agent · forecast), NIM client, mocks
```

### Key Files for Reference

- `src/proxy.ts:52` - Edge route protection
- `src/lib/auth/index.ts:70` - Credentials provider
- `src/lib/auth/rbac.ts` - Role guards
- `src/db/schema.ts` - Database schema
- `src/db/migrate.ts:23` - Migration runner
- `src/db/seed.ts` - Seed script (roles + demo admin user)
