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

### Added

- **Barriers now have a life.** A barrier can be **assigned** to someone with a
  due time, carry a **progress thread** ("pharmacy says 4pm"), and — for the
  first time — be **marked cleared** with a reason. Clearing removes it from the
  ward's open count, so the number finally goes down as well as up. Every
  transition is recorded in an append-only `barrier_events` log with its actor,
  shown in the bed drawer. See `specs/releases/v0.10.0-close-the-loop/`.
- **Barrier age and ownership on the board.** Each bed card shows the age of its
  oldest open barrier, how many are owned, and how many are overdue — "waiting
  two days on transport" is the escalation signal, and it was previously
  uncapturable because re-extraction reset every barrier's age.
- **Clinicians can contradict the AI.** Add a barrier the extraction missed
  (stored as clinician-authored, and invisible to re-extraction), dismiss one it
  invented (**durably** — a suppression stops the next run resurrecting it), and
  **override the estimated discharge date**. The board shows whether an EDD came
  from a clinician or from the notes.
- **Approval can delegate.** Approving a recommendation optionally assigns the
  underlying barrier and sets a due time in the same step.
- **Web Push reaches its first real ward events** — being assigned a barrier,
  and a barrier going overdue. The push plumbing has existed since the platform
  baseline and was wired only to user registration.
- **The board says when the notes were last read**, so staff can judge how
  current it is.

### Fixed

- **Policy search now notices when it is comparing nonsense.** Policy chunks are
  embedded at seed time through the same endpoint used at query time, so seeding
  with the offline mock and then switching to a live model left the database
  full of hash-derived vectors while questions were embedded for real. Both are
  1024-dimensional, so the search returned confident, plausible, meaningless
  passages — with a green "grounded" badge on the answer built from them, and no
  error anywhere. Each stored chunk now records the model that embedded it; a
  mismatch makes the copilot **refuse and say why** instead of answering, and
  Settings → System shows the stored model beside the configured one. Remedy is
  a re-seed: `pnpm db:seed:policy`.
- **One reranker failure no longer degrades retrieval until restart.** A single
  404 set a process-lifetime flag that was never reset, silently dropping every
  later copilot answer back to raw cosine ordering. The back-off is now time
  boxed to 15 minutes and both the disable and the recovery are logged. A
  transient 5xx or timeout no longer backs off at all.
- **Re-running extraction no longer destroys the ward's work.** Persistence
  deleted and re-inserted every barrier for a note, so one person clicking "Run
  extraction" silently wiped every triage decision made that morning — approvals
  reverted to `pending`, owners and progress notes vanished. Extraction now
  **reconciles**: AI-derived fields are refreshed in place, human state is
  untouched, and a barrier the notes no longer support is flagged rather than
  deleted. Verified against live extraction runs.
- **Concurrent extraction runs.** A second "Run extraction" is now rejected with
  a clear message instead of racing the first — previously both ran, doubling
  the model spend and interleaving writes to the same barriers.
- **Double-approving a recommendation could write two audit rows.** The status
  check and its three writes were separate statements; they are now one
  transaction with the row locked, so the second approval gets "Already
  approved" instead of corrupting the audit trail.

### Changed

- `BARRIER_STATUSES` gains `dismissed` — "the AI got this wrong", which is
  clinically distinct from `cleared` ("the work is done") and must not be
  collapsed into it.
- Barrier age is anchored to a new `first_seen_at` that survives re-extraction.
- `policy_chunks` gains `embedding_model` and `recommendations` gains
  `provenance`. Both are nullable, and null means **unknown** rather than
  "assume the current setting" — a recommendation card shows what produced it or
  says nothing, never a guess. The `embedding_model` backfill stamps existing
  rows with whatever is configured at migration time and says loudly that this
  is an assumption; re-seeding is the only way to make it a fact.

### Added

- **Open the referenced policy.** A policy citation on an action recommendation
  or a copilot answer is now clickable — it opens the full referenced discharge
  policy document in a dialog, with the cited passage highlighted (resolved
  server-side from the citation; degrades to the passage when the document can't
  be found). No migration or re-seed. See
  `specs/releases/v0.9.0-open-referenced-sources/`.
- **AI configuration in Settings.** Admins get a read-only AI configuration card
  showing whether the AI plane is running live on NVIDIA NIM or the deterministic
  mock, the extraction/embedding/rerank model ids, the model endpoint host, and
  the operational limits (rate-limit budget, timeout, embedding dimensions).
  Values come from a new token-gated `GET /config` on the AI service, so they can
  never drift from what the service actually uses; secret values are never
  exposed, only whether a key or token is configured. Settings is now grouped
  into sections (Account, Files & notifications, System, Administration). See
  `specs/releases/v0.8.0-ai-configuration-settings/`.
- **Product guide as an in-app About section.** A rewritten platform guide
  (problem, product, patient flow, architecture, AI tooling and models, and the
  evaluation harnesses) is served in-app at `/about`, `/about/architecture`, and
  `/about/azure`, with a sidebar entry and a public standalone copy.

### Fixed

- **"Run extraction" no longer hangs.** The ward-board extraction now bounds
  every AI-service call with a 45s timeout (a stalled connection can no longer
  wedge the whole batch), fans notes out across encounters with bounded
  concurrency instead of running strictly sequentially, and isolates per-note
  failures so one bad note is counted (`(N failed)` in the status) rather than
  aborting the run. Each note's clear-and-reinsert now runs in a transaction, so
  a re-run can't strand a note with zero barriers.

### Changed

- Extraction persistence is now shared between the ward-board Server Action and
  the `pnpm db:extract` CLI (`src/db/persist-extraction.ts`) so their write
  paths can't drift.
- The AI extraction call's completion-token budget is configurable via
  `NIM_EXTRACT_MAX_TOKENS` (default `1024`, down from a hard-coded `3072`),
  cutting per-call latency on the reasoning model.

## [0.7.0] - 2026-07-27

### Changed

- **The action queue is now on the ward board** — an "Actions (N)" panel
  (slide-over) with Generate + approve/dismiss, plus the existing per-bed drawer.
  The standalone /actions page is retired (the route redirects to the board) and
  dropped from the nav. Extracted a shared RecommendationCard used by both the
  bed drawer and the actions panel.

## [0.6.4] - 2026-07-27

### Changed

- The flow briefing is now **generated manually** (a Generate/Regenerate
  button) instead of auto-running on every board load — it is the one NIM call
  on the board and takes a few seconds, so the board now loads instantly and the
  briefing is produced on demand.

## [0.6.3] - 2026-07-27

### Changed

- Consistent view width: the copilot, briefing, and action-queue views no longer
  self-constrain to a narrow column (removed `max-w-3xl`) — every view now fills
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
