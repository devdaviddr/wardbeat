# Specs — Spec-Driven Development

[← Back to README](../README.md)

This project uses **spec-driven development (SDD)**: non-trivial changes start
with a short written spec that captures the _what_ and _why_ before the _how_.
Specs make intent reviewable, keep scope honest, and give the codebase a
durable record of the decisions behind each release.

## When to write a spec

Write one for any **feature, cross-cutting change, or notable trade-off**
(new capability, security posture change, infra, breaking change). Skip it for
trivial fixes, dependency bumps, and copy edits — a good commit message is
enough there.

## Lifecycle

```
Proposed ──▶ Accepted ──▶ In Progress ──▶ Shipped
                 │                          │
                 └──▶ Rejected     Superseded ◀── (later spec replaces it)
```

- **Proposed** — drafted, open for discussion.
- **Accepted** — agreed; ready to build.
- **In Progress** — being implemented.
- **Shipped** — released; `release:` records the version.
- **Superseded / Rejected** — kept for history, status explains why.

## How to author one

1. Copy [`TEMPLATE.md`](TEMPLATE.md) to `NNNN-slug.md` (next free 4-digit id).
2. Fill it in; open it for review as `Proposed`.
3. On agreement, set `Accepted` and implement — ideally on a `feature/<slug>`
   branch (see the [contributing guide](../CONTRIBUTING.md) for the trunk-based
   workflow).
4. On release, set `Shipped`, fill `release:`, check the acceptance criteria,
   and add the matching [`CHANGELOG.md`](../CHANGELOG.md) entry.

**Spec vs changelog:** the spec is the intent _before_ (why/what/how); the
changelog is the record _after_ (what shipped, for users). They complement each
other — one isn't a substitute for the other.

## Index

| Spec                                              | Title                                    | Status   | Release         |
| ------------------------------------------------- | ---------------------------------------- | -------- | --------------- |
| [0001](0001-project-foundation.md)                | Project foundation                       | Shipped  | v0.1.0          |
| [0002](0002-pwa-and-app-shell.md)                 | PWA & responsive app shell               | Shipped  | v0.2.0          |
| [0003](0003-security-hardening.md)                | Production security hardening            | Shipped  | v0.3.0          |
| [0004](0004-graphify-claude-integration.md)       | graphify & CLAUDE.md integration         | Shipped  | v0.3.1          |
| [0005](0005-cloudflare-tunnel-deployment.md)      | Cloudflare Tunnel deployment             | Shipped  | v0.4.0          |
| [0006](0006-rbac.md)                              | Role-based access control (RBAC)         | Shipped  | v0.5.0          |
| [0007](0007-file-uploads.md)                      | File uploads & object storage (MinIO)    | Shipped  | v0.6.0          |
| [0009](0009-automated-backups.md)                 | Automated backups (Postgres + MinIO)     | Shipped  | v0.13.0         |
| [0010](0010-oauth-providers.md)                   | OAuth providers (GitHub, Google)         | Shipped  | v0.10.0         |
| [0011](0011-email-verification-password-reset.md) | Email verification & password reset      | Shipped  | v0.11.0         |
| [0013](0013-dark-mode-theming.md)                 | Dark-mode toggle & theming               | Shipped  | v0.8.0          |
| [0015](0015-web-push-notifications.md)            | Web Push notifications                   | Shipped  | v0.12.0         |
| [0017](0017-shared-store-rate-limiting.md)        | Shared-store rate limiting (Upstash)     | Proposed | — (conditional) |
| [0018](0018-profile-photo-upload.md)              | Profile photo upload                     | Shipped  | v0.7.0          |
| [0019](0019-seo-opengraph-metadata.md)            | SEO & OpenGraph metadata                 | Shipped  | v0.9.0          |
| [0020](0020-one-click-self-hosting-setup.md)      | One-click self-hosting setup             | Shipped  | v0.14.0         |
| [0021](0021-continuous-deployment-self-hosted.md) | Continuous deployment (self-hosted)      | Shipped  | v0.14.0         |
| [0022](0022-always-on-hardening-mac-mini.md)      | Always-on hardening (Mac mini)           | Shipped  | v0.15.0         |
| [0023](0023-tier-b-default-and-build-version.md)  | Pull-deploy default + build version      | Shipped  | v0.16.0         |
| [0024](0024-faster-time-to-deploy.md)             | Faster time-to-deploy                    | Shipped  | v0.17.0         |
| [0025](0025-wardbeat-foundation.md)               | WardBeat foundation — scaffold & process | Accepted | v0.1.0          |

> **Platform vs product.** Specs `0001`–`0024` are inherited from the
> `nextjs-fullstack-boilerplate` platform WardBeat is built on, and are kept as
> the historical record of that foundation. **WardBeat's own product specs start
> at [0025](0025-wardbeat-foundation.md)**; from **v0.2.0** onward they move to
> per-release folders (see [Release specs](#release-specs-v020) below).
>
> Specs 0001–0004 were written retroactively to document the decisions behind
> the existing releases; SDD is the going-forward process (0005 onward).
>
> Remaining specs map to the [roadmap](../README.md#roadmap), in priority
> order, each scoped to ship as its own release. Numbering has gaps (0008,
> 0012, 0014, 0016) from descoped drafts — error tracking, Cloudflare
> Analytics, and i18n aren't planned right now; SEO metadata (originally 0008)
> was re-scoped for the portfolio use case as [0019](0019-seo-opengraph-metadata.md).
> The old numbers aren't reused. 0017 is written but intentionally not
> scheduled — see its "Non-goals".

## Release specs (v0.2.0+)

From **v0.2.0**, WardBeat plans each release as a folder under
[`releases/`](releases/README.md), each with a **`spec.md`** (what & why) and a
**`spec-imp.md`** (implementation plan). See the
[release-spec process](releases/README.md). The numbered specs above (`0001`–`0025`) remain
as history; `0026` was migrated here as `v0.2.0`.

| Release    | Title                                           | `spec.md`                                                                 | `spec-imp.md`                                                                 |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **v0.2.0** | Barrier intelligence & ward board (Phase 1 MVP) | [spec](releases/v0.2.0-barrier-intelligence-ward-board/spec.md) — Shipped | [plan](releases/v0.2.0-barrier-intelligence-ward-board/spec-imp.md) — Shipped |
| **v0.3.0** | Flow copilot — ward-state Q&A + policy RAG      | [spec](releases/v0.3.0-flow-copilot/spec.md) — Shipped                    | [plan](releases/v0.3.0-flow-copilot/spec-imp.md) — Shipped                    |
| **v0.4.0** | Action recommendations (agentic, HITL)          | [spec](releases/v0.4.0-action-recommendations/spec.md) — Shipped          | [plan](releases/v0.4.0-action-recommendations/spec-imp.md) — Shipped          |
