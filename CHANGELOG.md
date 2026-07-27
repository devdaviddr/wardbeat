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

## [0.7.0] - 2026-07-27

### Changed

- **The action queue is now on the ward board** � an "Actions (N)" panel
  (slide-over) with Generate + approve/dismiss, plus the existing per-bed drawer.
  The standalone /actions page is retired (the route redirects to the board) and
  dropped from the nav. Extracted a shared RecommendationCard used by both the
  bed drawer and the actions panel.

## [0.6.4] - 2026-07-27

### Changed

- The flow briefing is now **generated manually** (a Generate/Regenerate
  button) instead of auto-running on every board load � it is the one NIM call
  on the board and takes a few seconds, so the board now loads instantly and the
  briefing is produced on demand.

## [0.6.3] - 2026-07-27

### Changed

- Consistent view width: the copilot, briefing, and action-queue views no longer
  self-constrain to a narrow column (removed `max-w-3xl`) � every view now fills
  the same wide shell container as the ward board / dashboard.

## [0.6.2] - 2026-07-27

### Fixed

- Render the flow briefing strip inside the cockpit board directly instead of
  threading it through a `header` prop — clearer ownership and removes a React
  key warning surfaced during development.

## [0.6.1] - 2026-07-27

### Changed

- **The ward board is now the dashboard** — the flow cockpit is the app's home
  (`/dashboard`); `/ward` redirects to it. Nav collapses to Ward board · Actions
  · Settings.
- **Wider layout** — the content container went from `max-w-4xl` to 1536px and
  the bed grid gains a 5-column breakpoint, so the board uses the horizontal
  space; the narrower pages still self-constrain.

### Fixed

- Corrected a residual `Boilerplate` brand string in the app shell → `WardBeat`.

## [0.6.0] - 2026-07-27

### Changed

- **Flow cockpit — the ward board is now a single pane of glass.** UX
  consolidation of v0.2–v0.5 (no new AI capability):
  - The **flow briefing** is now a header strip on the board (net position +
    AI-narrated one-liner), loaded async so the grid never blocks on the
    narration call.
  - **Click a bed → a detail drawer** unifying that patient's status/EDD,
    discharge forecast, barriers with cited sources, and recommendations with
    inline **Approve / Dismiss**.
  - Beds carry an **⚡action badge** and their **discharge probability**.
  - **Copilot docks onto the board** and **highlights the beds** a ward-state
    answer references.
  - Primary nav trimmed to **Ward + Actions** (copilot/briefing now live on the
    board; their routes remain reachable).
- Read model: `getCockpit()` assembles the board + per-bed recommendations +
  forecast in one cheap pass (no NIM).

## [0.5.0] - 2026-07-27

### Added

- **Forecasting & narration (Phase 4)** — the clearest statement of the project's
  thesis: **deterministic ML predicts the numbers, the LLM narrates them.**
  - A transparent, monotone **discharge model** (P(discharge in 24h) + predicted
    days) and a **demand baseline** (expected admissions + net bed position) —
    pure deterministic math, **no NIM**.
  - A **flow briefing**: the LLM turns those figures + board state into a short
    grounded paragraph — and is forbidden from inventing numbers.
- **Flow briefing page** (`/briefing`, feature-flagged): net bed position,
  predicted-discharge table, fit-but-gated beds, and the AI-narrated summary.
- Forecast eval (`pnpm eval:forecast`). Verified live: discharge-ranking
  Spearman ρ 0.92 (gate 0.7); narration numeric-consistency 1.00 (gate 0.9).

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
