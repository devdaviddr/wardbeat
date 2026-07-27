# Features

[← Back to README](../README.md)

A complete inventory of what ships in WardBeat — the ward-flow product features
first, then the inherited platform (auth, RBAC, uploads, PWA, email) they're built on.

## WardBeat product features

- **Ward cockpit board** — the live ward view: beds, encounters, EDD / MFFD, and
  each patient's open discharge barriers at a glance (`src/components/ward/`).
- **AI barrier extraction** — the AI plane reads each clinical note and extracts
  discharge blockers typed as **`tto`** (to-take-out meds), **`transport`**,
  **`social_care`**, or **`review`** (plus `other`), along with the **expected
  discharge date (EDD)** and a **medically-fit-for-discharge (MFFD)** flag. Every
  barrier carries a **grounded source citation** — the source note plus the exact
  quote/span it came from — so nothing is asserted without provenance.
- **Flow copilot** — a ward-flow assistant that first **validates the query
  against live ward state** (a filter, not a hallucination) and then answers over
  discharge policy with **RAG** — retrieve `policy_chunks` by pgvector similarity,
  rerank, and answer with citations (AI-plane `copilot/*` endpoints).
- **Recommendation agent** — turns barriers into next-best actions. It is
  **recommend-only**: every action is a proposal a human **approves or dismisses**,
  and each decision is **audited** (`recommendations` + `action_audit`). No external
  side effects.
- **Forecasting** — **deterministic** discharge- and demand-forecasts with an
  **LLM narration** layer for the human-readable summary
  (AI-plane `forecast/discharge`, `forecast/demand`, `forecast/narrate`).
- **AI configuration in Settings** — an admin view surfaces the AI plane's
  non-sensitive `/config` (models, mock mode, whether an API key is set); secrets
  never leave the server.
- **In-app About guide** — the platform guide ships in-app (`sync:about` copies
  [`guide.html`](guide.html) to `public/about.html`).

See [Architecture → AI plane](architecture.md#ai-plane), the [eval harnesses](evals.md),
[monitoring](monitoring.md), and the [roadmap](roadmap.md).

## Authentication

- **Email + password** via Auth.js (NextAuth) v5.
- **Argon2id** password hashing (`@node-rs/argon2`) with OWASP-recommended parameters.
- **JWT session strategy** with the user id carried on the token and session.
- **Edge-protected routes** — a lightweight `proxy.ts` guards protected paths on the edge runtime; pages re-check server-side (defense in depth).
- **User-enumeration resistance** — failed logins run a dummy hash verify so response timing doesn't reveal whether an account exists.
- **Resilient sessions** — an undecryptable cookie (e.g. after an `AUTH_SECRET` rotation) is treated as "signed out" instead of crashing the request.
- **OAuth — GitHub & Google** (opt-in) via the Auth.js Drizzle adapter, on the same `users` table and JWT sessions as Credentials. No dangerous email auto-linking; a "Connected accounts" panel links/unlinks providers with a self-lockout guard. See [OAuth](oauth.md).
- **Password reset & email verification** (opt-in with email) — single-use, purpose-scoped, hashed tokens; anti-enumeration; an optional verify soft gate. See [Email](email.md).

See [Architecture → Authentication](architecture.md#authentication-design) for the design.

## Access control (RBAC)

- **Roles model** — `roles` + `user_roles` (many-to-many); roles are carried as a `roles: string[]` claim on the JWT and session (no extra DB round-trip to read them).
- **Server guards** — `requireRole()` / `requireAnyRole()` / `hasRole()` (`src/lib/auth/rbac.ts`) assert roles inside Server Actions and RSCs; failures throw `ForbiddenError`.
- **Edge gating** — an optional `ROLE_REQUIRED` prefix map in `proxy.ts` redirects unauthorised users to **`/403`**, JWT-only (no Node deps at the edge).
- **Client helpers** — `useRole()` and `<RequireRole>` (`src/lib/auth/client-rbac.tsx`) for conditional UI (cosmetic — server checks remain authoritative).
- **Admin user management** — a Settings panel (admin-gated server-side) to list users and create / edit / delete them and assign roles.
- **Self-healing sessions** — old JWTs missing the `roles` claim re-fetch roles once and back-fill the token.

## Invite-based account claim

- **Passwordless provisioning** — admins create users with no password; the account is claimed later via a one-time link.
- **Single-use invite tokens** (`src/lib/auth/invite.ts`) — a 32-byte token is shown to the admin once; only its **SHA-256 hash** is stored (`users.invite_token_hash`), time-safe compared, and expires in 7 days.
- **Claim flow** — `/register?invite=…&email=…` sets the password and consumes the invite; knowing the email alone is not enough (no account-enumeration signal).

## Email (optional)

- **Off by default** — everything email-related is inert unless `EMAIL_ENABLED=true` **and** an SMTP provider is configured; enabling it without a provider **fails fast at boot**.
- **Provider-agnostic SMTP** (`src/lib/email/`) — works with Resend, SendGrid, Mailgun, SES, Postmark, or Gmail via their SMTP credentials; `nodemailer` is loaded lazily (never bundled when off, never at the edge).
- **Safe no-op** — `sendEmail()` returns `{ skipped }` when disabled and never throws on send failure, so a flaky mail server can't break the surrounding action.
- **Wired to invites, password reset, and email verification** — invite links are emailed when enabled (and shown in the admin UI as a fallback); reset and verification links go out the same path.

See [Email](email.md) to configure it and for the reset/verification flows.

## Web Push notifications (optional)

- **Opt-in** — inert (including the Settings toggle) unless `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` are set. Generate keys with `npx web-push generate-vapid-keys`.
- **Per-device subscriptions** (`push_subscriptions`) — enable/disable from Settings; the private key never reaches the client.
- **Server send helpers** (`src/lib/push/`) — `sendPushNotification(userId, …)` / `notifyRole('admin', …)`, best-effort (a send failure never blocks the triggering action) and auto-pruning subscriptions the push service reports as Gone (404/410).
- **Worked example** — admins are notified when a new user self-registers.
- **Service worker** shows the notification on `push` and focuses/opens the right tab on `notificationclick`. Active in production builds. See [Web Push](push.md).

## Database

- **PostgreSQL 17** with **Drizzle ORM** (type-safe, SQL-first).
- **drizzle-kit** migrations, committed under `drizzle/`.
- Pooled, hot-reload-safe client; idempotent seed script.

See [Database](database.md).

## File uploads

- **Self-hosted, S3-compatible object storage** via **MinIO** — no cloud
  account required; works unmodified against R2/S3 if you ever want to swap.
- **Server-proxied, not presigned-direct** — uploads/downloads flow through
  the app (`src/lib/storage/`), so MinIO itself is never publicly exposed and
  needs no second Cloudflare Tunnel hostname.
- **Validated before anything is stored** — size (`UPLOAD_MAX_SIZE_MB`), MIME
  type (`UPLOAD_ALLOWED_MIME_TYPES` allow-list), and a per-user storage quota
  (`MAX_STORAGE_PER_USER_MB`) are all enforced server-side.
- **Ownership-checked downloads** — `GET /api/files/[id]` streams an object
  back only to its owner; a non-owner gets the same 404 whether the file
  exists or not (no existence signal).
- **Rate-limited uploads** and a **"My Files" panel** in Settings (list,
  download, delete) — available to every signed-in user, not admin-gated.
- Deleting a user removes their files' objects and rows too — no orphaned
  storage.
- **Profile photos** — every signed-in user can upload/replace/remove their
  own avatar from Settings, built entirely on the storage above. Narrower
  size/type limits than general uploads; still counts against the same
  per-user quota. Surfaced through Auth.js's standard `session.user.image` —
  shows in the app shell topbar and Settings without a page reload (see
  [spec 0018](../specs/0018-profile-photo-upload.md)).

See [spec 0007](../specs/0007-file-uploads.md).

## Progressive Web App

- Installable web app manifest, generated icon set (incl. maskable), theme color, iOS home-screen metadata.
- Hand-rolled service worker with **auth-safe caching** — static assets cached, API/auth never cached.
- Offline fallback page and an install prompt.
- No extra runtime dependencies and no bundler change (stays on Turbopack).

See [PWA & App Shell](pwa.md).

## UI & responsive shell

- **Tailwind CSS v4** + **shadcn/ui** components.
- **Light / dark / system theming** (`next-themes`) — a toggle in the app shell and on auth pages; no flash of wrong theme (the anti-flash script runs under the strict CSP via the per-request nonce, no `script-src` loosening). See [spec 0013](../specs/0013-dark-mode-theming.md).
- Minimal, borderless **app shell**: brand lockup (app icon + wordmark), fixed sidebar on desktop, off-canvas drawer on mobile, sticky topbar.
- Safe-area insets for installed PWA (notch-aware).
- Data-driven navigation with active-state highlighting.
- Auth pages (login/register) with accessible forms and inline validation.

## SEO & social sharing

- **OpenGraph + Twitter card metadata** and a default share image (`public/og.png`, regenerate with `pnpm gen:og`) so shared links unfurl with a preview card.
- **`metadataBase`** (from `APP_URL`) resolves relative image URLs absolutely; **`robots.txt`** and **`sitemap.xml`** via Next's file conventions. See [spec 0019](../specs/0019-seo-opengraph-metadata.md).

## Developer experience

- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`).
- **ESLint** (flat config, `eslint-config-next`) + **Prettier** (+ Tailwind plugin).
- **Husky** `pre-commit` running **lint-staged**.
- Path alias `@/*`, editor recommendations (`.vscode/`).
- Zod-validated environment that **fails fast** at boot.

## Testing

- **Vitest** + Testing Library for units (password hashing, validation schemas).
- **Playwright** for E2E (full auth flow, protected-route redirects, PWA manifest/SW/offline).
- **AI eval harnesses** — `eval:extraction` (barrier F1), `eval:copilot`,
  `eval:actions`, and `eval:forecast` score the AI plane against synthetic
  ground-truth (see [Evals](evals.md)); the `ai/` service has its own `pytest` suite.
- Quality gates run **locally** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  against a real Postgres. **CI is deferred** at this stage (no `.github/workflows/`).

## Delivery

- **Multi-stage Dockerfile** — Next.js `standalone` output, non-root user, healthcheck.
- **docker-compose** for local dependencies (Postgres + the internal `ai` service +
  MinIO) and a full production-like stack (app + db + one-shot migrator + `ai` + MinIO
  - backup sidecars).
- **Automated backups** — nightly Postgres dumps + MinIO mirror with retention, a `backup-verify.sh` doctor, and a tested restore runbook. See [Backups](backups.md).
- **CI is deferred** — quality gates run locally (lint · typecheck · unit · build,
  plus the `eval:*` harnesses and `ai/` pytest). See the CI note in the README /
  workflow docs.

See [Usage & Development](usage.md) and [Deployment](deployment.md).
