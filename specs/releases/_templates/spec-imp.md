---
release: vX.Y.Z
title: <Title> — implementation plan
status: Draft # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/<slug>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# vX.Y.Z — <Title> · implementation plan

> **spec-imp.md = the plan (how).** This is a **living document** — update it as work
> proceeds. It implements the frozen contract in [`spec.md`](spec.md).

## Approach

2–4 sentences: the shape of the implementation and any decisive technical choices.

## Architecture deltas

What changes in the system for this release (new services, planes, dependencies). Reference
[PRD §7](../../../docs/prd.md). Call out anything that touches the runtime boundary
(Next.js BFF ↔ FastAPI AI service ↔ NIM).

| Area                   | Change |
| ---------------------- | ------ |
| Next.js                | …      |
| FastAPI (`ai` service) | …      |
| Data / migrations      | …      |
| Infra (Compose / env)  | …      |

## Work breakdown (milestones)

Ordered, each independently mergeable where possible.

- **M1 — …**
- **M2 — …**
- **M3 — …**

## Data model & migrations

Drizzle is the single migration authority. New/changed tables, columns, indexes; any `ai_*`
tables the FastAPI service owns; vector columns (pgvector).

## Interfaces & contracts

- **API endpoints** (FastAPI): method, path, request/response schema.
- **Types**: OpenAPI → TS client / Zod schemas; Pydantic models.
- **Streaming**: SSE contract if applicable.
- **Service auth**: token/mTLS between Next.js and FastAPI.

## File / module plan

Where code lands. Group by runtime.

```
src/…            # Next.js
ai/…             # FastAPI service
drizzle/…        # migrations
tests/…          # unit / e2e / eval
```

## Test & evaluation plan

- **Unit** — …
- **E2E** (Playwright) — …
- **AI eval** — dataset, metric, and **gate** (e.g. extraction F1 ≥ …, RAGAS faithfulness ≥ …).
- **Safety** — red-team / guardrail checks.

## Rollout & deployment

Compose service additions, new env vars (add to `.env.example` + `src/lib/env.ts` Zod
schema), feature flags, migration/runbook steps, rate-limit budget (free tier ~40 RPM).

## Observability

Tracing/metrics/logging added for this release (latency, tokens, cost, eval scores).

## Risks / unknowns / spikes

| Risk / unknown | Plan |
| -------------- | ---- |
| …              | …    |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (+ FastAPI tests).
- [ ] AI eval gate met.
- [ ] `.env.example` + env schema updated; Compose runs clean from scratch.
- [ ] `CHANGELOG.md` updated; docs touched where needed.
- [ ] Merged to `main`; `vX.Y.Z` tagged; both specs set to `Shipped`.

## Task checklist

- [ ] …
- [ ] …
