---
release: v0.2.0
title: Barrier intelligence & ward board (Phase 1 MVP)
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
release: v0.2.0
phase: Phase 1 — Structuring
created: 2026-07-27
updated: 2026-07-27
supersedes: specs/0026-barrier-intelligence-ward-board.md
---

# v0.2.0 — Barrier intelligence & ward board (Phase 1 MVP)

> **spec.md = the contract (what & why).** The _how_ and the task plan live in
> [`spec-imp.md`](spec-imp.md). (Migrated from the flat spec `0026`.)

## Summary

The first product release of WardBeat: **a live ward board that reads the ward's notes for
you.** For every bed it shows the patient, status, estimated discharge date (EDD), and the
**discharge barriers** — each extracted from free-text notes by a generative model and
**traceable back to the source sentence**. It runs on **synthetic data** and the **free
NVIDIA NIM hosted tier**, and it stands up the **polyglot service split** (Next.js BFF + an
internal FastAPI AI service) that every later release builds on.

Implements Phase 1 of the [PRD](../../../docs/prd.md). Excludes the copilot (v0.3.0),
agents/actions (v0.4.0), and forecasting (v0.5.0).

## Problem / motivation

The status that decides whether a bed frees today — _why_ a medically-fit patient is still
here (waiting on TTOs, transport, social care, a review) — lives in **prose**, not
structured fields. Nobody has one current, glanceable view of it. Making that legible, with
provenance, is the smallest slice that delivers real value and proves the core GenAI
competency: **unstructured text → structured, grounded, actionable data.**

## Goals

- A single-ward board rendering every bed with patient, status, EDD, MFFD flag, and barrier
  chips.
- **GenAI extraction** of `barriers[]`, `edd`, `mffd_flag`, `escalations[]` from notes, as
  **schema-constrained JSON with span citations**.
- Every barrier chip links to the **exact source sentence**.
- A **synthetic dataset** with ground-truth labels, and an **extraction-accuracy (F1) eval**
  run against it.
- Establish the **Next.js BFF + FastAPI AI service** topology on the existing Docker Compose
  stack.

## Non-goals

- Natural-language copilot / RAG (v0.3.0).
- Agents, action recommendations, human-in-the-loop approvals (v0.4.0).
- LOS/demand forecasting and the optimiser (v0.5.0).
- Multi-ward / house view. Real patient data. Autonomous actions.

## Scope / user-visible outcome

A signed-in bed manager opens **one ward board**: a bed grid where each occupied bed shows
the patient, current status, EDD, an **MFFD flag**, and **barrier chips**. They can filter
to **MFFD-but-delayed** patients, and clicking any barrier chip reveals the **source
sentence** it was extracted from. A **Web Push** alert fires when a patient becomes MFFD or a
barrier clears.

## Requirements

### Functional

- **FR1** — Ingest synthetic ADT events + clinical notes into the ward-ops store.
- **FR2** — For each incoming note, the FastAPI service calls a **small NIM model** with a
  schema-constrained (JSON / function-calling) prompt to extract barriers, EDD, MFFD flag,
  and escalations, **each with a character span into the source note**.
- **FR3** — Persist structured results to Postgres; the board reads current per-bed state.
- **FR4** — Ward board UI (Next.js): bed grid, per-patient barrier chips, MFFD-but-delayed
  filter; clicking a chip reveals the cited source text.
- **FR5** — Web Push alert when a patient flips to MFFD or a barrier clears.

### Non-functional

- **NFR1 — Harness over rate limit.** Respect the free tier's **~40 RPM**: request queue +
  backoff, batched extraction, caching. No unbounded fan-out.
- **NFR2 — Grounding.** No barrier is shown without a valid source span; ungrounded
  extractions are dropped, not surfaced.
- **NFR3 — Eval gate.** Barrier-extraction **F1 ≥ 0.85** against the labelled synthetic set.
- **NFR4 — Auth boundary.** FastAPI is internal-only; Next.js enforces Auth.js/RBAC and
  calls it with a service token. No auth logic duplicated in Python.

## Acceptance criteria

- [x] Synthetic dataset (patients, ADT, notes) with a labelled barrier ground-truth set.
- [x] FastAPI `ai` service runs in Compose, internal-only, reachable from Next.js via
      service token; OpenAPI contract published.
- [x] Notes are extracted to structured `barriers/edd/mffd/escalations` with source spans.
- [x] Ward board renders per-bed state; every barrier chip opens its cited source sentence.
- [ ] MFFD-but-delayed filter works; Web Push fires on MFFD/barrier-clear.
- [x] Extraction F1 ≥ 0.85 in the eval harness; ungrounded extractions are suppressed.
- [x] Harness respects ~40 RPM (queue/backoff/batch) under a full-ward ingest.

> **Post-release verification (2026-08-01).** The MFFD-but-delayed filter shipped;
> **Web Push on MFFD/barrier-clear did not** — `notifyRole`/`sendPushNotification`
> are called only from user registration, so the push plumbing exists but is wired
> to no ward event. Now owned by
> [v0.10.0 FR11](../v0.10.0-close-the-loop/spec.md). The rate-limit criterion holds
> for extraction specifically; the limiter is not applied to the copilot, briefing
> or recommendation paths added in later releases (owned by
> [v0.12.0](../v0.12.0-ward-rbac-audit/spec.md)).

## Security & privacy

Synthetic data only — zero PHI. FastAPI internal-only behind the Next.js auth boundary;
least-privilege DB access. Notes treated as untrusted input (schema-constrained extraction,
no free instruction-following → injection defence). Audit + RBAC inherited from the platform.

## Alternatives considered

- **Do extraction in Next.js/TypeScript** — avoids a second runtime, but forfeits the Python
  GenAI/ML ecosystem that later releases need; cheaper to establish the split now than to
  retrofit.
- **Structured fields instead of extraction** — would require clinicians to change how they
  document; the point is to work with existing prose.
- **Ship the copilot first** — more impressive demo, but depends on this structured state
  existing; extraction is the foundation.

## Out of scope / future

- **v0.3.0** — RAG copilot over ward state.
- **v0.4.0** — LangGraph agents + action recommendations.
- **v0.5.0** — deterministic LOS/demand forecasting + narration.

## References

- [WardBeat PRD](../../../docs/prd.md) — §5 (tool-fit), §7 (topology), §7.10 (service
  architecture), §8/§8.1 (why NIM + free tier).
- Foundation spec [0025](../../0025-wardbeat-foundation.md).
- NVIDIA hosted NIM catalogue — <https://build.nvidia.com/models>
