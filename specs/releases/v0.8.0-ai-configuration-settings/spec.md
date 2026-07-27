---
release: v0.8.0 # semver tag this release will ship as
title: AI configuration visibility in Settings
status: Proposed # Proposed | Accepted | Shipped | Superseded | Rejected
phase: Platform — operability slice
created: 2026-07-28
updated: 2026-07-28
supersedes: '—'
---

# v0.8.0 — AI configuration visibility in Settings

> **spec.md = the contract (what & why).** Freeze this once `Accepted`; the _how_ lives in
> [`spec-imp.md`](spec-imp.md).

## Summary

Add a read-only **AI configuration** view to the Settings area so an operator can
see, at a glance, how the system's AI plane is wired: whether it is running live
on NVIDIA NIM or on the deterministic mock, which models are in use, the endpoint
it calls, and the operational limits (rate limit, timeout, token budget). The
Settings area is also reorganised into labelled **sections** so this and the
existing cards read as a structured page rather than a flat stack. No secret
value is ever shown — only whether a credential is configured.

## Problem / motivation

Today the AI plane's configuration is invisible from the running app. To answer
"is extraction live or mocked right now?", "which model is it calling?", or "did
the NVIDIA key get picked up?" an operator has to read container env or service
logs. That is friction for demos, support, and trust: WardBeat's whole story is
that the AI is inspectable and swappable, yet the running configuration cannot be
inspected from the product. The Settings area is also an unstructured list of
cards, which will not scale as more system panels are added.

## Goals

- An operator (admin) can open Settings and see the **live AI configuration** of
  the system without reading logs or env.
- The view makes the **mock ↔ live** state obvious, and names the three models,
  the endpoint host, and the operational limits.
- The Settings area is grouped into clear sections (Account, Storage &
  notifications, System, Administration).
- Zero secret leakage: keys and tokens are shown only as "configured" / "not
  configured".

## Non-goals

- **Editing** configuration from the UI. This release is read-only; the AI plane
  stays configured by environment (Compose / Container Apps), not the database.
- Per-user or non-admin visibility. The AI config panel is admin-only.
- Live metrics, latency charts, or eval results (a later operability slice).
- Surfacing the app's full env or any non-AI configuration.

## Scope / user-visible outcome

In **Settings**, an admin sees a new **AI configuration** card under a **System**
section showing:

- **Status** — reachable / unreachable (did the AI plane answer).
- **Mode** — Live (NVIDIA NIM) or Mock (deterministic offline).
- **Models** — extraction, embedding, and rerank model ids.
- **Endpoint** — the model API host (no path, no credentials).
- **Limits** — rate-limit budget (RPM), request timeout, embedding dimensions.
  (Extraction token budget is added here once the extraction-hardening change
  that introduces it lands.)
- **Credentials** — API key configured (yes/no), service token required (yes/no).

The rest of Settings is unchanged in content but grouped under section headings.
Non-admins see the reorganised sections but not the AI configuration card.

## Requirements

### Functional

- **FR1** — The AI plane exposes a read-only `GET /config` endpoint returning its
  non-sensitive configuration (mode, model ids, endpoint host, rpm, timeout,
  extract-token budget, embedding dim, and booleans for whether the API key and
  service token are set). It returns **no secret values**.
- **FR2** — The app fetches this config server-side (with the service token) and
  renders it in an admin-only Settings card, degrading gracefully to an
  "unreachable" state if the AI plane does not answer within a short timeout.
- **FR3** — The card clearly distinguishes **Mock** from **Live** mode.
- **FR4** — The Settings area is grouped into labelled sections.

### Non-functional

- **NFR1 — Security.** `GET /config` is gated by the same shared service token as
  the other AI-plane endpoints; it is never reachable from the browser. Secret
  values (`NVIDIA_API_KEY`, `AI_SERVICE_TOKEN`) are never serialised — only
  presence booleans. The panel is admin-gated server-side.
- **NFR2 — Resilience.** A slow or down AI plane must not break the Settings page;
  the fetch is bounded by a timeout and failures render as an unreachable state.
- **NFR3 — Consistency.** Values shown match what the AI plane actually uses
  (single source of truth: the service's own settings), not a copy in the app.

## Acceptance criteria

- [ ] `GET /config` on the AI plane returns mode, models, endpoint host, rpm,
      timeout, extract-max-tokens, embed dim, and `api_key_configured` /
      `service_token_required` booleans — and never a secret value.
- [ ] With `NIM_MOCK=true` (or no key) the card shows **Mock**; with a real key
      and `NIM_MOCK=false` it shows **Live** and the configured model ids.
- [ ] Stopping the AI plane leaves Settings rendering, with the card showing
      **Unreachable**.
- [ ] The AI configuration card is visible to admins only.
- [ ] Settings renders under section headings; existing cards keep working.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass; AI-plane
      unit tests cover the `/config` shape and secret redaction.

## Security & privacy

The single real threat is credential or internal-config leakage. Mitigated by:
returning only presence booleans for secrets; gating `/config` behind the
service token (internal-only, never browser-exposed); admin-only rendering; and
showing the endpoint **host only** (no path/query). No PHI is involved — the
config is operational metadata about the system, not patient data.

## Alternatives considered

- **Read the app's own env and display it.** Rejected — the app does not hold the
  model ids, mock flag, rpm, or key state; those live in the AI plane. Copying
  them into the app risks drift (violates NFR3).
- **Extend `/healthz` instead of adding `/config`.** Rejected — `/healthz` is an
  unauthenticated liveness probe and must stay minimal; configuration is a
  distinct, token-gated concern.
- **A standalone `/admin/system` page.** Deferred — Settings is where operators
  already look, and grouping into sections gives room to grow without a new route.

## Out of scope / future

- Editing AI config from the UI (would require a config store and careful
  security review).
- Live eval-gate results and latency/throughput metrics in the same System
  section (likely the next operability slice).
- A non-AI "System" panel (queue depth, DB, storage) alongside the AI card.

## References

- [WardBeat PRD](../../../docs/prd.md) — AI plane, mock ↔ live posture.
- AI plane settings: `ai/app/settings.py`; health: `ai/app/routers/health.py`.
- Settings surface: `src/app/(dashboard)/settings/`.
