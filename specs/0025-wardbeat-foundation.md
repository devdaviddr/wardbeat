---
id: 0025
title: WardBeat foundation — repository scaffold & process
status: Accepted # Proposed | Accepted | In Progress | Shipped | Superseded | Rejected
release: 'v0.1.0'
created: 2026-07-27
updated: 2026-07-27
---

# 0025 — WardBeat foundation — repository scaffold & process

## Summary

Stand up **WardBeat** — a full-stack, AI-enabled application that helps keep a
hospital ward flowing and beds utilised — on top of the proven
`nextjs-fullstack-boilerplate` platform. This spec covers the _scaffold and
process_ only: repository provenance, branding, the development workflow, and
the deliberate removal of CI. It does **not** introduce any WardBeat domain
logic; that begins in follow-up specs (0026+).

This is the inaugural WardBeat product spec. Specs `0001`–`0024` are inherited
from the platform and retained as the historical record of the foundation
WardBeat is built on.

## Problem / motivation

Ward flow and bed utilisation are managed today with whiteboards, spreadsheets,
and phone calls. There is no single, live view of a ward's state, and no
assistance identifying what's blocking discharges or where beds are stuck.
Before any of that can be built, WardBeat needs a clean, production-grade base
and an honest, repeatable development process — so feature work starts from a
proven platform rather than a blank page, and every non-trivial change is
captured as intent before code.

## Goals

- A private `devdaviddr/wardbeat` repository, provisioned from the platform with
  history preserved and the boilerplate retained as an `upstream` remote for
  future improvements.
- WardBeat identity applied across package metadata, README, app-shell
  metadata, and PWA manifest — no residual boilerplate branding in user-facing
  surfaces.
- A production-grade README that is honest about current state (scaffolding) and
  documents the inherited platform, quick start, and workflow.
- Spec-driven, trunk-based development documented and demonstrated (this spec).
- CI/CD deferred and clearly signposted as such wherever docs assume a pipeline.

## Non-goals

- Any WardBeat domain model, schema, UI, or AI feature (deferred to 0026+).
- Re-introducing CI/CD pipelines.
- Changing the inherited architecture, auth model, or platform conventions.
- A `develop`/`release`/`hotfix` branching model — WardBeat is trunk-based.

## Requirements

### Functional

- **FR1** — `origin` is `devdaviddr/wardbeat` (private); the boilerplate is
  `upstream`. `main` holds the platform baseline; all scaffold work lands via a
  `scaffold-repo` branch and a PR into `main`.
- **FR2** — Branding is WardBeat in `package.json`, `README.md`, `CLAUDE.md`,
  `src/app/layout.tsx`, `src/app/manifest.ts`, and `src/app/page.tsx`. Version
  reset to `0.1.0`; `CHANGELOG.md` restarted at `0.1.0` with a pointer to
  upstream for prior platform history.
- **FR3** — `.github/workflows/` removed. `CONTRIBUTING.md`, `docs/workflow.md`,
  and `README.md` state that CI is deferred and that the local gate is the gate.
- **FR4** — This spec exists as `Accepted` and is listed in `specs/README.md`.

### Non-functional

- **NFR1 — DX** — `pnpm install` succeeds and `pnpm typecheck` is clean on the
  scaffold (no feature code, no behavioural change to the inherited platform).
- **NFR2 — Honesty** — no doc claims a capability (CI, deploy-on-tag) that is
  not currently wired; deferred pieces are labelled as reference for later.

## Design / approach

- **Provenance.** Cloned the boilerplate, renamed its remote to `upstream`, and
  pushed the baseline to the pre-created private `devdaviddr/wardbeat`. History
  is preserved so `git pull upstream main` can bring in future platform fixes.
- **Branding, not logic.** Only identity/metadata strings changed in `src/`
  (`layout.tsx`, `manifest.ts`, `page.tsx` copy). No Server Actions, schema,
  `proxy.ts`, or auth flow touched — the inherited behaviour is unchanged.
- **CI removal.** Deleted `ci.yml`, `codeql.yml`, `deploy.yml`. Platform docs
  describing the pipeline are kept as the target state and annotated as deferred
  rather than deleted, so the design isn't lost.
- **Process.** Spec-driven + trunk-based, inherited from the platform and
  documented in `CONTRIBUTING.md` / `docs/workflow.md`. WardBeat product specs
  continue the numbering from `0025`.

## Acceptance criteria

- [x] `origin` = private `devdaviddr/wardbeat`; `upstream` = boilerplate.
- [x] No boilerplate branding remains in `package.json`, `README.md`, or `src/`.
- [x] `.github/workflows/` is gone; CI-deferred notes present in README,
      CONTRIBUTING, and `docs/workflow.md`.
- [x] `pnpm install` and `pnpm typecheck` succeed on `scaffold-repo`.
- [x] This spec is `Accepted` and indexed in `specs/README.md`.
- [ ] Scaffold merged into `main` via PR from `scaffold-repo`.

## Security & privacy

No new attack surface: no logic, schema, or dependency changes beyond metadata.
WardBeat will handle clinical/operational data, so future specs must treat
patient-adjacent data as sensitive — the inherited auth, RBAC, CSP, and rate
limiting are the starting controls and must not be weakened.

## Alternatives considered

- **Clean-slate repository (no history)** — simpler lineage, but loses the
  ability to merge upstream platform fixes. Rejected in favour of keeping
  history + an `upstream` remote.
- **Keep CI, just don't deploy** — more moving parts than wanted for a fresh
  scaffold; the ask was explicitly no pipelines for now. Deferred instead.
- **Full GitFlow** (`develop`/`release`/`hotfix`) — more ceremony than a
  single-maintainer early product needs; the platform is built trunk-based.

## Out of scope / future

- **0026+** — WardBeat domain model (ward, bed, patient flow), the live ward
  board, and AI-assisted flow insights.
- Re-introducing CI/CD once the product surface justifies it.

## References

- Upstream platform: `github.com/devdaviddr/nextjs-fullstack-boilerplate`
  (inherited specs `0001`–`0024`).
- Branch: `scaffold-repo`. Release: `v0.1.0`.
