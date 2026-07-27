---
id: 0026
title: Barrier intelligence & ward board (Phase 1 MVP)
status: Proposed # Proposed | Accepted | In Progress | Shipped | Superseded | Rejected
release: '—'
created: 2026-07-27
updated: 2026-07-27
---

# 0026 — Barrier intelligence & ward board (Phase 1 MVP)

## Summary

The first product release of WardBeat: **a live ward board that reads the ward's notes for
you.** For every bed it shows the patient, status, estimated discharge date (EDD), and the
**discharge barriers** — each extracted from free-text notes by a generative model and
**traceable back to the source sentence**. It runs on **synthetic data** and the **free
NVIDIA NIM hosted tier**, and it introduces the **polyglot service split** (Next.js BFF +
an internal FastAPI AI service) that every later phase builds on.

This spec operationalises Phase 1 of the [PRD](../docs/prd.md). It deliberately excludes
the copilot (Phase 2), agents/actions (Phase 3), and forecasting (Phase 4).

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

- Natural-language copilot / RAG (Phase 2).
- Agents, action recommendations, human-in-the-loop approvals (Phase 3).
- LOS/demand forecasting and the optimiser (Phase 4).
- Multi-ward / house view. Real patient data. Autonomous actions.

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
- **NFR3 — Eval gate.** Barrier-extraction **F1 ≥ 0.85** against the labelled synthetic set,
  measured in the eval harness.
- **NFR4 — Auth boundary.** FastAPI is internal-only; Next.js enforces Auth.js/RBAC and
  calls it with a service token. No auth logic duplicated in Python.

## Design / approach

**Service topology (see [PRD §7.10](../docs/prd.md)).** Two runtimes, one front door:

- **Next.js 16 (BFF + UI)** — owns auth/RBAC, the ward-board UI, Web Push, and ward-ops
  reads. The browser talks only to Next.js.
- **FastAPI `ai` service (internal)** — owns note ingestion, the extraction call to NIM, and
  the eval harness. Added as one container on the private Compose network; **not** exposed
  on the Cloudflare Tunnel. Called server-side by Next.js with a shared service token;
  contract via OpenAPI.
- **NVIDIA NIM (free hosted tier)** — small model (`Nemotron Nano`-class) for extraction via
  the OpenAI-compatible endpoint (`https://integrate.api.nvidia.com/v1`).

**Data.** Synthetic patients (Synthea) + LLM-augmented notes with **planted, labelled
barriers** for ground truth. **Drizzle owns the schema/migrations** (ward, bed, patient,
note, barrier tables); the FastAPI service reads via SQLAlchemy/asyncpg and only owns the
`ai_*` result tables. Extraction output is validated (Zod on the Next side, Pydantic on the
Python side) before it reaches the board.

**Extraction, not instruction-following.** Notes are untrusted input — the prompt extracts
into a fixed schema; it never executes instructions found in a note (injection defence).

## Acceptance criteria

- [ ] Synthetic dataset (patients, ADT, notes) with a labelled barrier ground-truth set.
- [ ] FastAPI `ai` service runs in Compose, internal-only, reachable from Next.js via
      service token; OpenAPI contract published.
- [ ] Notes are extracted to structured `barriers/edd/mffd/escalations` with source spans.
- [ ] Ward board renders per-bed state; every barrier chip opens its cited source sentence.
- [ ] MFFD-but-delayed filter works; Web Push fires on MFFD/barrier-clear.
- [ ] Extraction F1 ≥ 0.85 in the eval harness; ungrounded extractions are suppressed.
- [ ] Harness respects ~40 RPM (queue/backoff/batch) under a full-ward ingest.

## Security & privacy

Synthetic data only — zero PHI. FastAPI internal-only behind the Next.js auth boundary;
least-privilege DB access. Notes treated as untrusted (schema-constrained extraction, no
free instruction-following). Audit + RBAC inherited from the platform.

## Alternatives considered

- **Do extraction in Next.js/TypeScript** — avoids a second runtime, but forfeits the
  Python GenAI/ML ecosystem that Phases 2–4 need; the split is cheaper to establish now than
  to retrofit.
- **Structured fields instead of extraction** — would require clinicians to change how they
  document; the whole point is to work with existing prose.
- **Ship the copilot first** — more impressive demo, but depends on this structured state
  existing; extraction is the foundation.

## Out of scope / future

- **0027** — RAG copilot over ward state (Phase 2).
- **0028** — LangGraph agents + action recommendations (Phase 3).
- **0029** — Deterministic LOS/demand forecasting + narration (Phase 4).

## References

- [WardBeat PRD](../docs/prd.md) — §5 (tool-fit), §7 (topology), §7.10 (service
  architecture), §8/§8.1 (why NIM + free tier).
- Foundation spec [0025](0025-wardbeat-foundation.md).
- NVIDIA hosted NIM catalogue — <https://build.nvidia.com/models>
