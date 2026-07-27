# Platform summary (WardBeat's inherited foundation)

[← Back to README](../README.md)

> This page summarises the **inherited full-stack platform** WardBeat is built on
> (auth, database, PWA, storage, deployment). For the WardBeat product itself —
> the ward board, AI barrier extraction, copilot, recommendations, and
> forecasting — see the [platform guide](guide.html) and [Features](features.md).

## Summary

A production-grade foundation for full-stack web apps — authentication, database, PWA, and Docker deployment, tested and ready to build on. WardBeat adds its clinical AI product on top of this base.

### Quick Stats

- **Version:** WardBeat 0.7.0 (platform baseline v0.19.0)
- **License:** MIT
- **Type:** Full-stack Next.js 16 boilerplate
- **Target:** Single-box production (Docker + Cloudflare Tunnel)

### Core Tech Stack

| Layer            | Technology     | Version               |
| ---------------- | -------------- | --------------------- |
| Framework        | Next.js        | 16.2.10               |
| Runtime          | React          | 19.2.7                |
| Language         | TypeScript     | 5.9.3                 |
| Database         | PostgreSQL     | 17                    |
| Auth             | Auth.js v5     | 5.0.0-beta.31         |
| Password Hashing | Argon2id       | @node-rs/argon2 2.0.2 |
| UI               | Tailwind CSS   | v4 + shadcn/ui        |
| Storage          | S3-compatible  | MinIO (or R2/S3)      |
| PWA              | Service Worker | Hand-rolled           |

### What Ships Out of the Box

#### Authentication

- Email + password auth with Argon2id
- JWT sessions (stateless)
- GitHub & Google OAuth (opt-in)
- RBAC with roles (admin, member, viewer)
- Invite-based account claim (passwordless)
- Password reset & email verification (opt-in)

#### Security

- Rate limiting (auth endpoints; per-account + global per-IP login cap)
- CSP with per-request nonce
- HSTS + security headers
- Edge-protected routes (proxy.ts)
- User enumeration resistance

#### Database

- PostgreSQL 17 with Drizzle ORM
- Type-safe schema with migrations
- Dedicated tables for auth, files, push, roles
- Idempotent seed script

#### File Storage

- MinIO (S3-compatible)
- Per-user quotas
- Ownership-checked downloads
- MIME type & size validation
- Profile photos support

#### Progressive Web App

- Installable PWA with service worker
- Offline fallback page
- Responsive app shell
- Light/dark theme

#### Dev Experience

- Strict TypeScript (strict mode)
- ESLint + Prettier + Husky
- Vitest units + Playwright E2E
- Docker support (local & production)

#### Deployment

- One-click self-hosting wizard (`make setup`)
- Cloudflare Tunnel (no open ports)
- Multi-stage, multi-arch Dockerfile (amd64 + arm64)
- Continuous deployment via GHCR image pull (`make deploy`)
- macOS boot persistence for always-on Mac minis (`make autostart`)
- Automated Postgres + MinIO backups

> **Note:** CI is deferred — quality gates run locally
> (`pnpm lint && typecheck && test && build`, plus the `eval:*` harnesses). See
> [CI/CD](ci-cd.md) for the target pipeline design.
