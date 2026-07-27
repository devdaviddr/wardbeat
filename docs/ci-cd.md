# CI/CD

[← Back to README](../README.md)

> **CI/CD is deferred at this stage.** WardBeat removed the GitHub Actions
> pipelines for now, so the workflows and `../.github/workflows/*.yml` links
> below describe the **target design** for when CI is re-introduced — **not the
> current wiring** (there is no `.github/workflows/` directory today). Right now,
> quality gates run **locally** (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`,
> plus the [`eval:*` harnesses](evals.md) and the `ai/` pytest suite), and deploys
> are manual (`make deploy`). See [Feature → Production](workflow.md).

This documentation covers the CI/CD pipeline and testing workflow for the Next.js Fullstack Boilerplate. Deployment is covered separately in [deployment.md](deployment.md). For the full path from a feature branch to a deploy on your box, see [Feature → Production](workflow.md).

### Pipeline Overview

Three workflows cover CI, security scanning, and deployment. `ci.yml` and
`codeql.yml` run on every push and pull request to `main`; `deploy.yml` is
opt-in and only runs on release tags:

```
┌─────────────────────────────────────────────────────────────┐
│ .github/workflows/ci.yml  (push / PR → main · v* tags)      │
├─────────────────────────────────────────────────────────────┤
│ On push to main / PR (NOT tags):                             │
│   quality : format:check · lint · typecheck · test:coverage  │
│             · pnpm audit (non-blocking)                      │
│   e2e     : Postgres service + MinIO + Mailpit → migrate/seed │
│             → build → Playwright (uploads report artifact)   │
│   docker  : needs quality; builds in PARALLEL with e2e;      │
│             per-arch native (amd64 + arm64) → push by digest  │
│   docker-merge : needs docker + e2e; assemble multi-arch     │
│             manifest → publish 2 GHCR images (app + migrate); │
│             PRs build only (no push, no merge)               │
│ On a v* release tag (fast path — no rebuild):                │
│   release : wait for main's already-built image for this     │
│             commit, then re-tag it with the semver + stable  │
│             (~30s). See "Release fast-path" below.           │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ .github/workflows/codeql.yml  (push / PR → main · weekly)   │
├─────────────────────────────────────────────────────────────┤
│ analyze : CodeQL security-and-quality (javascript-typescript)│
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ .github/workflows/deploy.yml  (release tags · opt-in)       │
├─────────────────────────────────────────────────────────────┤
│ deploy  : `make deploy` on a self-hosted runner, gated by    │
│           vars.SELF_HOSTED_DEPLOY (off by default)           │
└─────────────────────────────────────────────────────────────┘
```

`quality` and `e2e` run independently. **`docker` is gated on `quality` only**
(fast lint/type/unit) so the ~2–3 min image build **overlaps** the ~2 min `e2e`
instead of queuing behind it; **`docker-merge` (which assigns the human tags)
needs both `docker` and `e2e`**, so nothing gets a usable tag until the full
suite is green. Publishing and the opt-in `deploy.yml` are the
continuous-deployment story — see [self-hosting.md](self-hosting.md#continuous-deployment).

### Release fast-path — a `v*` tag re-tags, it does not rebuild

A release is a `v*` tag placed on a `main` commit that CI **already built, tested,
and published** (as `sha-<short>` + `latest`) minutes earlier. Rebuilding it on the
tag would recompile a bit-identical image just to add the semver tag — the slowest
thing on the whole tag→live path. Instead, on a tag ref the workflow runs a single
`release` job that **adds the semver tag — and moves the floating `stable` tag — on
the existing multi-arch digest** with `docker buildx imagetools create` (a manifest
op, ~30s); `quality`, `e2e`, `docker`, and `docker-merge` are all skipped.

The `release` job **waits** for `ghcr.io/<owner>/<repo>:sha-<short>` (app + migrate)
to exist before re-tagging, so it **inherits `main`'s full gate** — that image is
only published once `main`'s `quality` + `e2e` + build pass. If it never appears the
release fails loudly rather than shipping something untested.

**`stable` always points at the most recently released image.** It's the tag a
Tier B box sets `APP_TAG` to for automatic _release-only_ deploys: `latest` moves
on every `main` merge, a pinned semver never moves — `stable` moves exactly when a
release is cut. Any `v*` push moves it (including an old tag re-pushed), so roll
back by pinning `APP_TAG` to a semver, not by re-pushing old tags.

The `release` job also **creates the GitHub Release entry** so the Releases page
never drifts from the tags: notes are this version's `CHANGELOG.md` section, and
the title is the annotated tag's subject (`git tag -a vX.Y.Z -m "short title"` →
"vX.Y.Z — short title"; a lightweight tag gets the bare version). Re-runs skip an
existing release.

Because the re-tagged image carries `main`'s baked `APP_VERSION=main`, the deployed
version is applied at **runtime** from the tag the box pulled — `APP_VERSION:
${APP_TAG}` on the `app` service in `docker-compose.deploy.yml` (with `APP_GIT_SHA`
still baked, correct). Settings → Build shows `APP_TAG · <sha7>` — with a floating
`APP_TAG=stable` that reads `stable · <sha7>` (the SHA still pins the exact commit);
pin a semver if you want the version number displayed. See
[spec 0024](../specs/0024-faster-time-to-deploy.md).

> **Realizing the win:** merge to `main`, let `main` CI go green, **then** push the
> `v*` tag — the image is already there and the tag ships in ~30s. Pushing the tag
> at the same time as the merge is still correct: the `release` job just waits for
> `main`'s build (no duplicate compute), then re-tags.

### Time-to-deploy budget

Measured on the `v0.16.x` releases (box pins a semver `APP_TAG`, so the tag pipeline
is on the critical path):

| Phase                                 | Before (0.16.x)       | After (0.17.0)                       |
| ------------------------------------- | --------------------- | ------------------------------------ |
| Tag CI (`git push` tag → image ready) | ~5m27s (full rebuild) | ~30s re-tag¹                         |
| Poll wait (Tier B timer)              | 0–300s (avg ~150s)    | 0–60s (avg ~30s), idle ticks skipped |
| Deploy on box                         | ~1–2 min              | ~1–2 min (unchanged)                 |

¹ Plus a wait for `main`'s build if the tag is pushed before `main` CI is green. The
`main` build itself (~3–4 min after overlapping build with e2e) is the one
unavoidable compile of new source.

### Quality Gates

Before any PR can be merged, all checks must pass:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

#### 1. Linting & Formatting

**ESLint** (flat config, Next.js) + **Prettier** + **Tailwind plugin** + **Husky pre-commit**.

```bash
pnpm lint          # check only
pnpm lint:fix      # auto-fix
pnpm format        # auto-fix (includes lint-staged)
pnpm format:check  # verify
```

**Hook:** `pre-commit` runs `lint-staged` on staged files.

#### 2. Type Safety

**tsc --noEmit** with strict mode flags.

```bash
pnpm typecheck
```

#### 3. Unit Tests (Vitest)

Run once or in watch mode:

```bash
pnpm test                    # run all
pnpm test:watch              # watch mode
pnpm test:coverage           # with coverage report
```

**Scope:** password hashing, validation schemas, upload validation, rate limiting, tokens, RBAC, OAuth, email soft-gate, Web Push.

#### 4. E2E Tests (Playwright)

Full browser stack for end-to-end flows:

```bash
pnpm test:e2e        # headless
pnpm test:e2e:ui     # interactive UI runner
```

**Prerequisites:** migrated + seeded DB, running MinIO, running Mailpit.

**Full local test suite:**

```bash
pnpm docker:db && pnpm docker:minio && pnpm docker:mail && \
  pnpm db:migrate && pnpm db:seed && pnpm build && pnpm test:e2e
```

**E2E test coverage includes:**

- Auth flows (login, register, sign-out)
- Protected route redirects and RBAC
- File upload/download/delete
- Avatar uploads
- PWA manifest/SW/offline
- SEO (robots/sitemap/OG)
- Accessibility (axe)
- Email reset/verification round-trips (against Mailpit)

### GitHub Actions Configuration

The full source of truth is `.github/workflows/ci.yml`
and `.github/workflows/codeql.yml`. The
summary below describes what each job actually does — consult the workflow
files for the authoritative YAML.

Both workflows trigger on `push` and `pull_request` to `main` (CodeQL also runs
on a weekly `schedule`); `ci.yml` additionally runs on `v*` tags, which publish
the semver-tagged image. `ci.yml` sets `concurrency: { group: ci-${{
github.ref }}, cancel-in-progress: true }`, so pushing again to the same
branch or PR cancels whatever CI run was already in flight for it — if a run
disappears from the Actions tab after a follow-up push, that's this behavior,
not a failure. It also disables Next.js telemetry via
`NEXT_TELEMETRY_DISABLED` (reproducible builds, no telemetry calls from CI).
All jobs run on `ubuntu-latest` with
**Node 22** (no version matrix) and pnpm via `pnpm/action-setup` (version taken
from `package.json`'s `packageManager` field — not pinned in the workflow).

#### `quality` job

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm audit --audit-level=high   # continue-on-error: advisory, non-blocking
```

#### `e2e` job

Postgres runs as a GitHub Actions `services:` container (`postgres:17-alpine`,
health-checked). MinIO and Mailpit **cannot** be `services:` containers (that
block supports only `image`/`env`/`ports`, and the `minio/minio` image needs a
`server /data` command to run), so the workflow starts them explicitly with
`docker run` and polls their health endpoints — mirroring `docker-compose.yml`.
The bucket is `app-files`, created with the `minio/mc` client.

The job then runs `pnpm db:migrate` → `pnpm db:seed` → `pnpm build` →
`pnpm exec playwright install --with-deps chromium` → `pnpm test:e2e`, and
uploads the `playwright-report/` as an artifact (`if: ${{ !cancelled() }}`,
7-day retention). Email is enabled against Mailpit (`EMAIL_ENABLED=true`,
`SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`) so the reset/verification round-trips
run in `email-flow.spec.ts`. `AUTH_SECRET` is a throwaway CI value.

#### `docker` job (+ `docker-merge`, `release`)

`docker` is gated `needs: [quality]` and runs in **parallel** with `e2e` (so the
build overlaps the tests); `docker-merge` is gated `needs: [docker, e2e]`, so it
only publishes **tested** images. They're **multi-arch** (`linux/amd64` +
`linux/arm64`) so they run on Apple Silicon Mac minis as well as amd64 servers. To
avoid slow QEMU emulation, `docker` is a matrix that builds each arch on its **own
native runner** (`ubuntu-latest` + `ubuntu-24.04-arm`) and pushes by digest; a
`docker-merge` job then assembles the per-arch digests into one manifest per image
via `docker/metadata-action`:

- `ghcr.io/<owner>/<repo>` — the production `runner` target (the app).
- `ghcr.io/<owner>/<repo>/migrate` — the `builder` target, the only one that can
  run `pnpm db:migrate` (the runner standalone image has no tsx/source).

Tags: commit `sha`, the branch, semver on `v*` tags, and `latest` on the default
branch. **Pull requests build both arches cache-only and never push** (login is
skipped; `docker-merge` is gated to non-PR) so forks stay safe. Uses the workflow
`GITHUB_TOKEN` with `packages: write`.

The `main`/PR app build bakes a **build identity** via build-args —
`APP_VERSION=${{ github.ref_name }}` (`main` on a branch build) and
`APP_GIT_SHA=${{ github.sha }}`. The Dockerfile persists them as `ENV` and
`src/lib/env.ts` reads them. Because a **release tag re-tags this image rather than
rebuilding** (see "Release fast-path"), the baked `APP_VERSION` stays `main`; the
deployed version is instead applied at **runtime** from the pinned `APP_TAG`
(`docker-compose.deploy.yml`), while `APP_GIT_SHA` stays baked (correct). Either
way the app surfaces the pair in **Settings → Build** so an operator can confirm
which version a self-hosted box is running.

On a tag ref, `docker`/`docker-merge` are skipped and the **`release`** job re-tags
instead — see "Release fast-path" above.

#### CodeQL

`codeql.yml` runs GitHub's CodeQL `security-and-quality` query suite over the
`javascript-typescript` sources on every push/PR and weekly (Monday 06:00 UTC),
publishing results to the repository's Security tab.

#### `deploy.yml` (opt-in continuous deployment)

Skipped unless the repo variable `SELF_HOSTED_DEPLOY == 'true'`. When enabled, it
runs `make deploy` on a **self-hosted runner** on your box (which dials out to
GitHub — tunnel-friendly) on release tags, pulling the freshly published images,
migrating, and restarting.

> **Do not enable this on a public repo.** A self-hosted runner on a public
> repository is the configuration GitHub explicitly warns against: a fork pull
> request can add a workflow that targets `runs-on: [self-hosted]` and, once
> approved, executes arbitrary code on your box and home network. The
> `SELF_HOSTED_DEPLOY` gate doesn't help — a malicious fork brings its own
> workflow. Use the pull-based **Tier B** deploy (`make deploy-timer`) instead,
> which needs no runner and has no such surface.

Full design and the recommended pull-based alternative:
[self-hosting.md → Continuous deployment](self-hosting.md#continuous-deployment).

### Local Development Testing

#### Quick Start

```bash
# Start local dependencies
pnpm docker:db
pnpm docker:minio
pnpm docker:mail

# Apply schema
pnpm db:migrate
pnpm db:seed

# Run full test suite
pnpm test:e2e
```

#### Running Tests Interactively

```bash
# Watch mode for units
pnpm test:watch

# Playwright UI runner
pnpm test:e2e:ui
```

#### Test Isolation

Each E2E test uses a unique client IP (from `CF-Connecting-IP`) to isolate rate-limit buckets:

- Prevents test interference
- Ensures accurate rate-limit testing

**Implementation:** `tests/e2e/fixtures.ts`

### Docker Testing

#### Multi-Stage Production Image

Dockerfile builds:

1. **Build stage** - dependencies + Next.js build
2. **Runtime stage** - non-root user, healthcheck

**Healthcheck endpoint:** `/api/health`

#### Docker Compose

- [`docker-compose.yml`](../docker-compose.yml) — local dev dependencies:
  `db`, `minio`, `minio-init` (creates the bucket), and `mailpit`.
- [`docker-compose.prod.yml`](../docker-compose.prod.yml) — the full
  production-like stack, with these services:

  | Service        | Role                                                    |
  | -------------- | ------------------------------------------------------- |
  | `db`           | Postgres 17 (named volume `pgdata`)                     |
  | `migrate`      | Runs `db:migrate` once, then exits                      |
  | `minio`        | S3-compatible object storage (named volume `miniodata`) |
  | `minio-init`   | Creates the bucket on first boot                        |
  | `db-backup`    | Nightly `pg_dump` sidecar                               |
  | `minio-backup` | Nightly object-store backup sidecar                     |
  | `app`          | The Next.js app, health-checked at `/api/health`        |

The two `*-backup` sidecars are covered in [backups.md](backups.md). Cloudflare
Tunnel variants live in `docker-compose.tunnel.yml` and
`docker-compose.quick-tunnel.yml` (see [deployment.md](deployment.md)).

### Deployment Pipeline

#### Pre-deployment Checklist

- [ ] Unique, strong `AUTH_SECRET`
- [ ] `DATABASE_URL` on managed Postgres with TLS (`sslmode=require`)
- [ ] Migrate schema (`pnpm db:migrate`)
- [ ] Seed initial `admin` user
- [ ] Check environment variables

#### Cloudflare Tunnel Deployment

See [deployment.md](deployment.md) for complete Cloudflare Tunnel setup:

- **Quick tunnel:** `make tunnel-quick` (no account)
- **Guided:** Cloudflare dashboard (requires account)
- **Automated:** Terraform (`make tunnel-provision`, set `AUTH_URL`, then `make tunnel-up`)

### Test Scripts

#### Manual Testing

- **Auth flow:** `/login`, `/register`, `/settings`
- **File operations:** Upload → list → download → delete
- **PWA features:** offline page, install prompt
- **RBAC:** admin panel, role-based access

#### Performance Testing

- **Unit tests:** coverage on validation, hashing, rate limiting
- **E2E tests:** full user journey times

### How a merge becomes a live deploy

Putting the pieces above into one ordered walkthrough, from `git push` to a
box running the new code:

1. A PR merges to `main`.
2. `ci.yml` runs `quality` and `e2e` in parallel; `docker` starts as soon as
   `quality` is green (it doesn't wait on `e2e`) and builds both architectures.
3. Once **both** `docker` and `e2e` are green, `docker-merge` assembles the
   multi-arch manifests and publishes `ghcr.io/<owner>/<repo>` (app) and
   `ghcr.io/<owner>/<repo>/migrate` tagged `sha-<short>` and `latest`.
4. When you're ready to cut a release: bump the version, update
   `CHANGELOG.md`, and push a `vX.Y.Z` tag on that same commit (see
   [Contributing](../CONTRIBUTING.md)).
5. The tag triggers `ci.yml`'s `release` job, which **waits** for step 3's
   `sha-<short>` image to exist, then re-tags it with the semver and moves the
   floating `stable` tag (~30s, no rebuild) and creates the GitHub Release.
6. A box tracking `APP_TAG=stable` (the recommended default — see
   [self-hosting.md → Tier B](self-hosting.md#tier-b-recommended--pull-with-make-deploy))
   picks up the new digest on its next `make deploy-timer` tick (≤60s) and
   runs `make deploy`: pull → migrate → restart. Nothing is pushed to the
   box — it's outbound-only the whole way.

### How to add a new CI check

1. Add the command to the relevant job in `ci.yml`
   — most checks belong in `quality` (fast, blocking) alongside
   `format:check`/`lint`/`typecheck`/`test:coverage`.
2. If it's exploratory or has a high false-positive rate (like `pnpm audit`
   today), mark the step `continue-on-error: true` so it reports but doesn't
   block merges, rather than skipping it entirely.
3. Expose it as a `pnpm` script in `package.json` if it's something a
   contributor should also be able to run locally before pushing — CI should
   never be the only place a check can run.
4. Update the **Quality Gates** list above and the pre-push command
   (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`) in this doc,
   `README.md`, and `CONTRIBUTING.md` if the new check should be part of that
   gate.

### Troubleshooting

#### Common Issues

1. **502 Bad Gateway**
   - App not ready yet or wrong ingress service
   - Fix: Ensure `http://app:3000` in Ingress

2. **Login loop**
   - Wrong `AUTH_URL` or `AUTH_TRUST_HOST=false`
   - Fix: Set correct public URL in `.env`

3. **Test isolation issues**
   - Rate limiting leaks between tests
   - Fix: Check unique client IP generation

4. **Docker compose health checks**
   - Services not ready
   - Fix: Increase wait time or check logs

#### Debugging Commands

```bash
# Container logs
docker compose logs

# Follow logs
docker compose logs -f

# Apply pending database migrations
pnpm db:migrate

# MinIO status (uses the minio/mc Docker image, not an npm package)
docker run --rm --network host --entrypoint /bin/sh minio/mc \
  -c "mc alias set local http://localhost:9000 minioadmin minioadmin && mc admin info local"
```

### Best Practices

1. **Test coverage:** Keep unit test coverage >80%
2. **Isolation:** Each test should be self-contained
3. **Environment:** Use `.env.example` as reference
4. **Versioning:** CI runs on a single pinned Node version (22); bump it in the workflow when upgrading
5. **Backups:** Always verify restore procedures before production deployment

### Maintenance

#### Database Migration

Always follow the workflow:

```bash
1. Edit src/db/schema.ts
2. pnpm db:generate
3. Review SQL migration
4. Commit migration file
5. pnpm db:migrate
```

#### Script Updates

Build scripts (`gen:icons`, `gen:og`) need regeneration:

```bash
pnpm gen:icons
pnpm gen:og
```

#### Environment Changes

Update `.env.example` whenever adding new environment variables.
