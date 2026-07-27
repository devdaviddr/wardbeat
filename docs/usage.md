# Usage & Development

[← Back to README](../README.md)

## Requirements

- Node.js ≥ 20.9 (22 recommended)
- [pnpm](https://pnpm.io) — `corepack enable`
- Docker (for local Postgres, the internal `ai` service, and MinIO)
- Python 3.11+ only if running the AI plane outside Docker (see [`ai/README.md`](../ai/README.md))

## Environment variables

Copy `.env.example` → `.env`. All variables are validated at boot in `src/lib/env.ts` — a missing or malformed value fails fast with a readable error.

| Variable                     | Required | Notes                                                                                                             |
| ---------------------------- | :------: | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               |    ✅    | Postgres connection string                                                                                        |
| `S3_ENDPOINT`                |    ✅    | S3-compatible endpoint (MinIO by default)                                                                         |
| `S3_ACCESS_KEY_ID`           |    ✅    | Matches `.env.example` / `docker-compose.yml` for local dev                                                       |
| `S3_SECRET_ACCESS_KEY`       |    ✅    | Matches `.env.example` / `docker-compose.yml` for local dev                                                       |
| `S3_BUCKET`                  |    ✅    | Bucket name — auto-created by `minio-init`                                                                        |
| `S3_REGION`                  |    –     | Defaults to `us-east-1` (MinIO ignores region)                                                                    |
| `UPLOAD_MAX_SIZE_MB`         |    –     | Per-file size cap. Default `10`                                                                                   |
| `MAX_STORAGE_PER_USER_MB`    |    –     | Per-user quota. Default `500`                                                                                     |
| `UPLOAD_ALLOWED_MIME_TYPES`  |    –     | Comma-separated allow-list. Default images + PDF                                                                  |
| `AUTH_SECRET`                |    ✅    | `npx auth secret` — unique per environment, never reuse                                                           |
| `AUTH_URL`                   |    –     | Canonical auth URL; set in production                                                                             |
| `AUTH_TRUST_HOST`            |    –     | `true` behind a trusted proxy / in Docker                                                                         |
| `AUTH_GITHUB_ID` / `_SECRET` |    –     | Enables GitHub sign-in when both set — see [OAuth](oauth.md)                                                      |
| `AUTH_GOOGLE_ID` / `_SECRET` |    –     | Enables Google sign-in when both set — see [OAuth](oauth.md)                                                      |
| `APP_URL`                    |    –     | Public origin for OG/`metadataBase`, `robots`/`sitemap`, and OAuth callback URLs. Default `http://localhost:3000` |
| `NODE_ENV`                   |    –     | `development` \| `test` \| `production`                                                                           |
| `LOG_LEVEL`                  |    –     | `debug` \| `info` \| `warn` \| `error`                                                                            |
| `RATE_LIMIT_DISABLED`        |    –     | `true` to disable the in-memory auth rate limiter                                                                 |
| `EMAIL_ENABLED`              |    –     | `true` to turn on email; requires the SMTP vars below                                                             |
| `EMAIL_FROM`                 |    †     | From address (required when `EMAIL_ENABLED=true`)                                                                 |
| `SMTP_HOST`                  |    †     | SMTP host (required when `EMAIL_ENABLED=true`)                                                                    |
| `SMTP_PORT`                  |    †     | SMTP port, e.g. `587` or `465` (required when enabled)                                                            |
| `SMTP_USER`                  |    –     | SMTP username (if the server requires auth)                                                                       |
| `SMTP_PASSWORD`              |    –     | SMTP password (if the server requires auth)                                                                       |
| `SMTP_SECURE`                |    –     | `true` for implicit TLS; auto-true on port `465`                                                                  |
| `REQUIRE_EMAIL_VERIFICATION` |    –     | `true` soft-gates unverified users (only with email on) — see [Email](email.md)                                   |
| `VAPID_PUBLIC_KEY`           |    –     | Web Push — enabled only when all three VAPID vars are set                                                         |
| `VAPID_PRIVATE_KEY`          |    –     | Web Push private key (server-only)                                                                                |
| `VAPID_SUBJECT`              |    –     | Web Push contact URL, e.g. `mailto:you@example.com`                                                               |

### AI plane

Next.js reaches the internal FastAPI AI service with just two vars; the rest configure
the AI plane itself (`ai/`, read by `ai/app/settings.py` / `.env.example`).

**Next.js side** (`src/lib/env.ts`):

| Variable                    | Required | Notes                                                                                          |
| --------------------------- | :------: | ---------------------------------------------------------------------------------------------- |
| `WARDBEAT_AI_URL`           |    –     | Base URL of the AI plane, e.g. `http://ai:8000` (compose) / `http://localhost:8000` (host dev) |
| `WARDBEAT_AI_SERVICE_TOKEN` |    –     | Shared secret sent as `x-service-token` on every AI-plane call                                 |

**AI-plane side** (consumed by `ai/`, not the Next.js app):

| Variable                 | Required | Notes                                                                        |
| ------------------------ | :------: | ---------------------------------------------------------------------------- |
| `NIM_MOCK`               |    –     | `true` runs fully offline with deterministic stubs (no NVIDIA calls)         |
| `NVIDIA_API_KEY`         |    ‡     | Hosted NIM API key — required when `NIM_MOCK=false`                          |
| `NIM_BASE_URL`           |    –     | NIM endpoint base URL                                                        |
| `NIM_EXTRACT_MODEL`      |    –     | Default `nvidia/nvidia-nemotron-nano-9b-v2` (extraction / chat / narration)  |
| `NIM_EMBED_MODEL`        |    –     | Default `nvidia/nv-embedqa-e5-v5` (1024-dim embeddings)                      |
| `NIM_RERANK_MODEL`       |    –     | Default `nvidia/llama-3.2-nv-rerankqa-1b-v2` (rerank)                        |
| `EMBED_DIM`              |    –     | Embedding dimension; `1024` (must match `policy_chunks.embedding`)           |
| `NIM_EXTRACT_MAX_TOKENS` |    –     | Completion token budget for extraction. Default `1024`                       |
| `NIM_TIMEOUT`            |    –     | Per-request timeout in seconds. Default `30`                                 |
| `NIM_RPM`                |    –     | Client-side rate limit (requests/min). Default `30`                          |
| `AI_SERVICE_TOKEN`       |    –     | Expected `x-service-token`; must match Next.js's `WARDBEAT_AI_SERVICE_TOKEN` |

‡ Required only when `NIM_MOCK=false`. See [`ai/README.md`](../ai/README.md).

† Required only when `EMAIL_ENABLED=true`. Setting the toggle without a provider
fails fast at boot. SMTP is provider-agnostic — Resend, SendGrid, Mailgun, SES,
Postmark and Gmail all expose SMTP credentials. See [Email](email.md). S3 vars
are always required — see [Features → File uploads](features.md#file-uploads).

> Production-compose-only backup settings (`BACKUP_RETENTION_DAYS`,
> `BACKUP_INTERVAL_SECONDS`, `OFFSITE_BACKUP_*`) are consumed by the backup
> sidecars, not the app — see [Backups](backups.md).

## Scripts

| Command                                                                    | Description                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                                                                 | Start the dev server (Turbopack)                                                |
| `pnpm build` / `pnpm start`                                                | Production build / serve                                                        |
| `pnpm lint` · `pnpm lint:fix`                                              | ESLint                                                                          |
| `pnpm typecheck`                                                           | `tsc --noEmit`                                                                  |
| `pnpm format` · `pnpm format:check`                                        | Prettier                                                                        |
| `pnpm test` · `pnpm test:watch` · `pnpm test:coverage`                     | Vitest units                                                                    |
| `pnpm test:e2e` · `pnpm test:e2e:ui`                                       | Playwright E2E                                                                  |
| `pnpm db:generate` · `db:migrate` · `db:push` · `db:studio` · `db:seed`    | Database (see [Database](database.md))                                          |
| `pnpm db:seed:ward` · `db:seed:policy`                                     | Seed synthetic ward data · discharge-policy KB (embeds chunks via the AI plane) |
| `pnpm db:extract` · `db:recommend`                                         | Run barrier extraction · the recommendation agent over seeded data              |
| `pnpm eval:extraction` · `eval:copilot` · `eval:actions` · `eval:forecast` | AI eval harnesses (see [Evals](evals.md))                                       |
| `pnpm sync:about`                                                          | Copy `docs/guide.html` → `public/about.html` (in-app guide)                     |
| `pnpm gen:icons` · `pnpm gen:og`                                           | Regenerate PWA icons · OG share image                                           |
| `pnpm docker:db`                                                           | Start the local Postgres container                                              |
| `pnpm docker:minio`                                                        | Start local MinIO + bucket init                                                 |
| `pnpm docker:mail`                                                         | Start local Mailpit (email catcher)                                             |

## Testing

```bash
pnpm test            # unit tests (Vitest)
pnpm test:coverage   # units with coverage
pnpm test:e2e        # E2E (needs a migrated DB + running/built app)
```

- **Unit** tests live in `tests/unit/` — password hashing, validation schemas,
  upload validation, rate limiting, single-use tokens, RBAC, OAuth config, the
  email soft-gate guard, and Web Push send/prune. The `server-only` guard is
  stubbed for the test runner (see `vitest.config.ts`).
- **E2E** tests live in `tests/e2e/` — auth flows, protected-route redirects,
  RBAC, file upload/download/delete, avatars, PWA (manifest/SW/offline), SEO
  (robots/sitemap/OG), a11y (axe), and the full email reset/verification
  round-trips against Mailpit (`email-flow.spec.ts`, self-skips if Mailpit is
  down). Each test uses a unique client IP to isolate rate-limit buckets
  (`tests/e2e/fixtures.ts`), and a `globalSetup` seeds the demo admin. Playwright
  boots `pnpm dev` locally and `pnpm start` in CI.

Full green run against a live database, object store, and mail catcher:

```bash
pnpm docker:db && pnpm docker:minio && pnpm docker:mail && \
  pnpm db:migrate && pnpm build && pnpm test:e2e
```

## Docker

**Local dependencies only:**

```bash
pnpm docker:db          # docker compose up -d db
pnpm docker:minio       # docker compose up -d minio minio-init
docker compose up -d ai # internal FastAPI AI plane on :8000 (or db + ai together)
```

The `ai` service is **internal** — it exposes `:8000` for host-dev convenience but has
no public ingress; keep it off the Cloudflare Tunnel in production. It runs offline with
`NIM_MOCK=true`, or against hosted NVIDIA NIM with a real `NVIDIA_API_KEY`.

**Full production-like stack (app + db + `ai` + MinIO + one-shot migrator/bucket-init + backup sidecars):**

```bash
AUTH_SECRET=$(openssl rand -base64 33) \
  docker compose -f docker-compose.prod.yml up --build
```

The app image is a multi-stage build using Next.js `standalone` output, runs as a non-root user, and exposes `/api/health` as a container healthcheck. The `migrate` and `minio-init` services run once before the app starts. MinIO has no published ports in this stack — the app is the only public gateway to it.

## Git hooks

Husky installs a `pre-commit` hook that runs **lint-staged** (ESLint + Prettier on staged files). It's wired via the `prepare` script on `pnpm install`. To bypass in an emergency: `git commit --no-verify`.

## Quality gates (CI deferred)

There is no `.github/workflows/` at this stage — **CI is deferred**. Gates run
**locally** before pushing:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Plus, for the AI surface: the `eval:*` harnesses (`pnpm eval:extraction` /
`eval:copilot` / `eval:actions` / `eval:forecast`, see [Evals](evals.md)) and the
`ai/` `pytest` suite. See the CI note in the README / workflow docs for the pipeline
that will be reintroduced later.

## Extending

| Task                        | How                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Add a protected route       | Create a page under `src/app/(dashboard)/`, add its prefix to `PROTECTED_PREFIXES` in `src/proxy.ts`                           |
| Add a sidebar link          | Add `{ title, href, icon }` to `src/lib/shell/nav.ts`                                                                          |
| Add a table                 | Edit `src/db/schema.ts`, then `pnpm db:generate && pnpm db:migrate`                                                            |
| Add a shadcn component      | `pnpm dlx shadcn@latest add <name>`                                                                                            |
| Add an OAuth provider       | GitHub + Google ship; add another in `src/lib/auth/index.ts` with its `AUTH_<PROVIDER>_*` env vars — see [OAuth](oauth.md)     |
| Gate a route by role        | Add a prefix → roles entry to `ROLE_REQUIRED` in `src/proxy.ts`; assert `requireRole('admin')` in the action                   |
| Add a role                  | Insert into the `roles` table (see `src/db/seed.ts`); assign via the Settings admin panel or `assignRoles`                     |
| Enable email                | Set `EMAIL_ENABLED=true` + the `SMTP_*` vars in `.env`; templates live in `src/lib/email/templates.ts`                         |
| Change upload limits        | Adjust `UPLOAD_MAX_SIZE_MB` / `MAX_STORAGE_PER_USER_MB` / `UPLOAD_ALLOWED_MIME_TYPES` in `.env`                                |
| Point storage at real S3/R2 | Set `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` — `src/lib/storage/client.ts` is unmodified either way |
| Add an env var              | Add it to the schema in `src/lib/env.ts` and to `.env.example`                                                                 |

## Production checklist

- [ ] Unique, strong `AUTH_SECRET` per environment.
- [ ] `DATABASE_URL` on managed Postgres with TLS (`sslmode=require`).
- [ ] Change the default `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from
      `minioadmin`/`minioadmin` (fine for a MinIO instance with no public
      ingress, but don't leave the default if you ever expose it directly).
- [ ] Run `pnpm db:migrate` as a deploy step.
- [ ] Terminate TLS at a trusted proxy; set `AUTH_TRUST_HOST=true`.
- [ ] Swap the in-memory rate limiter for a shared store (e.g. Upstash) if you
      run more than one instance.
- [ ] Wire error tracking (Sentry) — a structured-logging shim (`src/lib/logger.ts`)
      is already in place.
- [ ] Serve over HTTPS so the service worker registers and the app is installable.
- [ ] Replace placeholder icons (`pnpm gen:icons`) and set the manifest name/colors.
- [ ] If using email, set `EMAIL_ENABLED=true` with valid `SMTP_*` credentials and a
      deliverable `EMAIL_FROM` (SPF/DKIM aligned) — leave it off to keep sends inert.
- [ ] Seed or assign an initial `admin` role so the Settings user-management panel is reachable.
