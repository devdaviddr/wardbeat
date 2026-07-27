# Changelog

All notable changes to WardBeat are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
As this project is pre-1.0, minor versions may introduce breaking changes.

> WardBeat is built on the [nextjs-fullstack-boilerplate](https://github.com/devdaviddr/nextjs-fullstack-boilerplate)
> platform. The changelog for the inherited platform (releases up to v0.19.0)
> lives in that upstream repository; this file starts WardBeat's own history at
> v0.1.0.

## [Unreleased]

_Nothing yet._

## [0.4.0] - 2026-07-27

### Added

- **Action recommendations (Phase 3)** — a retrieve-then-reason **agent** turns
  each barrier into a **recommended next-best action** (chase TTOs, book
  transport, arrange social care, escalate a review) with a **rationale grounded
  in discharge policy** (the agent uses the v0.3.0 policy retrieval as its tool).
- **Action queue** (`/actions`, feature-flagged) — recommendations grouped by
  bed with action-type / priority / policy-grounded badges, a "Why?" dialog
  showing the source policy, and **human-in-the-loop Approve / Dismiss**.
  **Recommend-only**: approving marks the barrier in progress and writes an
  **audit** row; nothing acts externally.
- `recommendations` + `action_audit` tables; a headless generator
  (`pnpm db:recommend`); an action eval (`pnpm eval:actions`). Verified live:
  action-appropriateness 100%, policy-grounded 100% (gate 0.9).

## [0.3.0] - 2026-07-27

### Added

- **Flow copilot (Phase 2)** — a grounded natural-language copilot with two
  routed paths: **ward-state Q&A** ("which patients are fit but waiting on
  transport?") via a validated, allow-listed structured filter over the live
  board (never SQL), and **policy RAG** ("what are the discharge criteria for a
  patient on IV antibiotics?") over a discharge-policy knowledge base. Answers
  cite their sources; out-of-scope questions are refused.
- **Retrieval plane on NVIDIA NIM** — embedding NIM (`nv-embedqa-e5-v5`, 1024-d),
  **pgvector** hnsw cosine ANN, a reranking interface (cosine-order fallback when
  the hosted reranker is unavailable), and grounded LLM answer composition.
  Postgres image is now `pgvector/pgvector:pg17`.
- **Copilot chat page** (`/copilot`, feature-flagged) with path + grounded
  badges and clickable citations (policy → source passage; ward → the board).
- Synthetic discharge-policy KB + ingestion (`pnpm db:seed:policy`), a headless
  extraction CLI (`pnpm db:extract`), and a copilot eval harness
  (`pnpm eval:copilot`). Verified live: policy retrieval hit-rate 100%, grounded
  100%, ward-state query-intent accuracy 100% (gate 0.9).

## [0.2.1] - 2026-07-27

### Changed

- **Live NIM extraction verified and tuned.** Default extraction model is now
  `nvidia/nvidia-nemotron-nano-9b-v2` (the previous default hung on the free
  tier). Improved the extraction prompt (tight barrier-type definitions +
  few-shot), lifting live barrier-extraction F1 from 69% → **88%** (precision
  85%, recall 92%, MFFD accuracy 100%) — above the 0.85 gate — measured by the
  eval harness against real hosted NIM.

## [0.2.0] - 2026-07-27

### Added

- **Barrier intelligence & ward board (Phase 1 MVP)** — a live ward board that
  extracts discharge **barriers / EDD / MFFD** from clinical notes and shows
  them per bed, each traceable to its **source sentence**. Filter to
  fit-but-delayed patients; click a barrier to see the cited note.
- **Polyglot AI plane** — a stateless internal **FastAPI** service does
  extraction over **NVIDIA NIM** (OpenAI-compatible), with a deterministic,
  prompt-injection-safe **offline mock** and mock fallback; grounded barriers
  only (ungrounded model output is dropped); token-bucket rate limiting under
  the free tier's ~40 RPM. Runs as an `ai` container in Compose.
- Ward-flow schema (wards/beds/patients/encounters/notes/barriers/
  ai_extractions), a **synthetic seed** with labelled ground truth, and an
  **extraction eval harness** (`pnpm eval:extraction`, barrier F1 gate 0.85 —
  currently 96%). See [docs/DEMO.md](docs/DEMO.md).

## [0.1.0] - 2026-07-27

### Added

- **Repository scaffold.** WardBeat stood up from the full-stack platform:
  rebranded identity (package, README, app-shell metadata, PWA manifest), a
  production-grade README, and the inaugural spec
  [`0025-wardbeat-foundation.md`](specs/0025-wardbeat-foundation.md).
- Spec-driven, trunk-based development process (inherited and documented).

### Removed

- **GitHub Actions pipelines** (`ci`, `codeql`, `deploy`) — CI/CD is deferred
  for this stage; quality gates run locally. The pipeline docs remain as
  reference for re-introduction.
