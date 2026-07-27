# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

**WardBeat** — a full-stack, AI-enabled application that helps keep a hospital
ward flowing and beds utilised. It is built on a production-grade **Next.js 16**
platform: App Router + RSC + Server Actions, Auth.js v5 credentials auth,
Drizzle ORM on PostgreSQL, and a PWA with a responsive app shell (Docker for
delivery). Product scope and the first feature slice live in
[`specs/`](specs/) — start with `specs/0025-wardbeat-foundation.md`. Platform
docs live in [`docs/`](docs/) (architecture, features, database, pwa, usage) —
read those before large changes.

> **CI is deferred at this stage.** The GitHub Actions pipelines were removed;
> quality gates run locally (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`).
> Docs under `docs/` that describe CI/deploy pipelines are reference for when
> they're re-introduced, not the current wiring.

## Stack

Next.js 16 · React 19 · TypeScript 5.9 (strict) · Auth.js v5 (Credentials, JWT,
Argon2id) · Drizzle + Postgres 17 · Tailwind v4 + shadcn/ui · Zod · Vitest +
Playwright · pnpm. **Turbopack is used for both `dev` and `build`** — do not add
webpack-only tooling (this is why the service worker is hand-rolled, not Serwist).

## Commands

```bash
pnpm dev | build | start
pnpm lint | typecheck | format          # eslint · tsc --noEmit · prettier
pnpm test | test:e2e                     # Vitest (tests/unit) · Playwright (tests/e2e)
pnpm docker:db                           # local Postgres
pnpm db:generate | db:migrate | db:seed | db:studio
pnpm gen:icons                           # regenerate PWA icons
```

Before pushing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Architecture & conventions

- **Auth edge/node split.** `src/lib/auth/config.ts` is edge-safe (no DB, no
  argon2) and is consumed by `src/proxy.ts`. The Credentials provider + argon2 +
  DB live in `src/lib/auth/index.ts` (Node). Never import the DB or argon2 into
  `config.ts` or `proxy.ts`.
- **Route protection + CSP** live in `src/proxy.ts` (Next 16 renamed
  `middleware` → `proxy`). Add protected path prefixes there. CSP uses a
  per-request nonce — don't introduce inline scripts without it.
- **Session reads** go through `getCurrentSession()` (`src/lib/auth/session.ts`),
  which treats undecryptable cookies as signed-out but rethrows real errors.
- **Client-side session refresh**: `useSession().update()` called with **no
  argument** is just a GET re-fetch — it does **not** re-run the `jwt`
  callback's `trigger === 'update'` branch. Call `update({})` (any defined
  argument) to actually POST and trigger a server-side refresh (e.g. after a
  profile-photo change, `src/components/auth/avatar-upload.tsx`). Confirmed
  against the installed `next-auth` package source, not assumed.
- **Mutations** are Server Actions (`src/lib/auth/actions.ts`), not API routes.
- **Server Action errors a user must see**: return `{ ok: false, error }`
  (see `src/lib/auth/actions.ts`'s `AuthFormState`, `src/lib/storage/actions.ts`'s
  `ActionResult<T>`) — never `throw` for expected/validation failures. Next.js
  redacts a thrown Error's `message` in production builds, so a thrown
  validation error silently becomes "an error occurred" for the user. This
  only surfaces by testing the actual production build (`next start` /
  Docker), not `next dev` — do that before shipping any new Server Action
  with user-facing error messages. Reserve `throw` for genuinely unexpected
  failures (DB/S3 down), where redaction in production is correct.
- **Rate limiting** (`src/lib/rate-limit.ts`) is enforced in the server actions
  and in the credentials `authorize` callback (non-bypassable). It's in-memory
  (single-instance) — swap for a shared store if scaling out.
- **Env** is Zod-validated in `src/lib/env.ts` (fails fast). Add new vars to the
  schema _and_ `.env.example`.
- **DB changes:** edit `src/db/schema.ts` → `pnpm db:generate` → commit the
  migration → `pnpm db:migrate`. Emails are stored lower-cased.
- **`server-only`** guards `src/db` and `src/lib/auth/password.ts` — never import
  them into client components.
- **PWA:** `public/sw.js` is hand-rolled and registers in **production only**;
  it never caches authenticated/API responses. The app shell is in
  `src/components/shell/`; nav is data-driven from `src/lib/shell/nav.ts`.
- **Structured logging** via `src/lib/logger.ts` — prefer it over `console.*`.

## Git & workflow

- **Spec-driven.** Non-trivial features start with a spec in [`specs/`](specs/)
  (copy `specs/TEMPLATE.md`, status `Proposed` → `Accepted` → `Shipped`). See
  [`specs/README.md`](specs/README.md).
- **Trunk-based.** `main` is the only long-lived branch (no `develop`).
  Feature work branches off `main` as `feature/<slug>` and PRs back into
  `main`. A **release is a `vX.Y.Z` tag on a `main` commit** — bump the version,
  update `CHANGELOG.md`, then tag. The tagged commit can be a `Release vX.Y.Z`
  merge commit (the style through v0.13.6) or a plain commit on `main` (v0.14.0+
  tag directly, no release-merge commit); both are fine — the tag is what
  defines the release, and pushing a `v*` tag is what triggers deploy. Pre-1.0.
- **Conventional Commits**, enforced by a commitlint `commit-msg` hook. Keep
  commit **body lines ≤ 100 characters**. A `pre-commit` hook runs lint-staged.
- Update `CHANGELOG.md` (Keep a Changelog) for user-facing changes.
- **Do NOT credit AI in git.** Never add `Co-Authored-By: Claude`,
  "Generated with…", or any AI/assistant trailer to commits or PR descriptions.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
