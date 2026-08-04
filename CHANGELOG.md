# Changelog

All notable changes to WardBeat are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
As this project is pre-1.0, minor versions may introduce breaking changes.

> WardBeat is built on the [nextjs-fullstack-boilerplate](https://github.com/devdaviddr/nextjs-fullstack-boilerplate)
> platform. The changelog for the inherited platform (releases up to v0.19.0)
> lives in that upstream repository; this file starts WardBeat's own history at
> v0.1.0.
>
> **On the tag gap between v0.7.0 and v0.11.0.** 0.8.0, 0.9.0 and 0.10.0 are
> recorded here as separate versions but were never cut as their own releases —
> the version went straight from 0.7.0 to 0.11.0, and all three shipped inside
> the **`v0.11.0`** tag. Their entries are kept separate because they were
> distinct pieces of work; there is no missing tag to look for.

## [Unreleased]

### Fixed

- **The AI plane is now part of the production stack.** `docker-compose.prod.yml`
  gained the internal-only `ai` service (no published ports, reached solely by
  `app` over the compose network) and wires `WARDBEAT_AI_URL` /
  `WARDBEAT_AI_SERVICE_TOKEN` plus the four `FEATURE_*` flags (default on) into
  the app. Previously a production deploy booted with every AI call pointed at
  a nonexistent `localhost:8000`.
- **Fresh production deploys no longer fail migrations.** The prod database
  image is now `pgvector/pgvector:pg17` (was `postgres:17-alpine`), which the
  `CREATE EXTENSION vector` migration for the policy knowledge base requires.
- `make setup` generates a strong `WARDBEAT_AI_SERVICE_TOKEN` (keeping
  `AI_SERVICE_TOKEN` in lockstep) instead of leaving the dev placeholder from
  `.env.example`; the prod compose file now requires the variable, matching the
  AI plane's fail-closed behaviour.
- `.env.example` and `ai/README.md` now state the real `NIM_EXTRACT_MAX_TOKENS`
  default (3072 — what `ai/app/settings.py` and the compose files use), not 1024.

### Changed

- **README rewritten as a product README** — current at v0.12.0 (was framed
  around v0.7.0), with a verified quick start that includes the AI plane and
  ward/policy seeds, and a curated documentation index.
- **New [AI design](docs/ai-design.md) document** consolidating the shipped AI
  architecture: two-plane topology, the four AI capabilities, grounding,
  provenance (`live`/`mock`/`fallback`), the deterministic-vs-LLM boundary,
  human-in-the-loop points, degradation behaviour, and eval gates.
- Docs refreshed to v0.12.0 reality: `features.md`, `database.md` (the four
  ward-membership/audit/lifecycle tables and the seven seeded roles),
  `roadmap.md` and `specs/releases/README.md` (v0.10–v0.12 marked shipped),
  `DEMO.md`, `summary.md`, `explaining-wardbeat.md` (retired eval numbers
  removed), `architecture.md` (current project tree), and
  `deployment.md`/`self-hosting.md` (AI service token requirement).

## [0.12.0] - 2026-08-01

### Added

- **Clinical roles and ward membership.** The role vocabulary grows from
  `admin`/`member`/`viewer` to include `bed_manager`, `charge_nurse`,
  `clinician` and `allied_health`, and users are assigned to wards
  (`user_wards`). A capability matrix (marked **provisional** — it is a first
  cut, not clinical governance) decides who may clear a barrier, approve a
  recommendation, run extraction, and so on. Admins assign roles and ward
  membership from Settings → Administration. See
  `specs/releases/v0.12.0-ward-rbac-audit/`.
- **An access audit that covers reads.** Viewing the board, opening a bed
  drawer (who looked at which patient — the first thing an
  information-governance review asks), asking the copilot (question text
  included) and running extraction each write an append-only `access_audit`
  record. Admins get a filterable view at Settings → Administration → audit.
  No application code path can edit or delete audit rows.
- **Rate limits on the AI-backed actions.** Copilot questions, briefing
  generation and recommendation generation are now per-user rate limited
  against the shared ~30 RPM model budget; previously any authenticated user
  could drive unbounded model calls.
- **Retention for raw model output.** `ai_extractions.raw_json` (which quotes
  note text) is purged beyond `AI_RAW_RETENTION_DAYS` (default 30), invoked
  opportunistically on extraction — there is no job runner, and the docs say
  so rather than pretending to a scheduler.

### Fixed

- **Any authenticated user could read every patient and act on their care.**
  `requireRole` was used eight times in the admin surfaces and zero times in
  the ward domain; the ward routes required a session and nothing more. Every
  ward server action — extraction, generation, approve/dismiss, the entire
  barrier lifecycle, EDD override, copilot, briefing — is now authorized
  through one fail-closed helper (`requireWardAccess`), checked **before**
  any write and before rate-limit budget is consumed. A freshly registered
  user now sees "You have not been assigned to a ward yet", not a ward of
  patients — asserted in the e2e suite.
- **A malformed copilot intent no longer ships the whole ward.** When the
  model's structured filter failed validation, the fallback was "list every
  bed" — sending all patient names, MFFD status and barriers to the AI
  service. The fallback is now a refusal.
- **The AI plane no longer runs open when its token is unset.** An empty
  `AI_SERVICE_TOKEN` used to disable auth entirely; it now refuses requests
  (503 naming the missing config), with an explicit
  `AI_ALLOW_INSECURE_NO_TOKEN=true` opt-out for tokenless local dev that
  warns loudly at startup. This also exposed that the "config never leaks
  secrets" test had been asserting against a 401 body — vacuous; it now
  authenticates and checks the real serialization.

### Changed

- The upgrade migration is **privilege-granting** and says so: existing
  non-admin users receive `bed_manager` (the capability they already had in
  practice) and membership of the existing ward, with counts printed at
  migration time. New users registered after this release start with no
  clinical role and no ward — least privilege by default.
- Ward UI affordances (clear, approve, generate, extraction, EDD, add-barrier)
  are hidden for roles that cannot use them; the server actions remain the
  enforcement, hiding is convenience.

### Added

- **A queryable access audit.** Viewing the board records one ward-level
  audit event per user (repeats within 60 seconds coalesce to one row), and
  opening a bed with a patient records who looked at which patient. Records
  are **append-only** — no application path can edit or delete them — and a
  failed audit write is logged but never blocks or fails a clinical read.
  Admins can browse them at **Settings → Administration → Access audit**
  (`/settings/audit`), filtered by actor, subject id and date range, 50 per
  page.

### Security

- **The AI-backed actions are rate limited per user.** The copilot, the flow
  briefing (action and `/briefing` page) and recommendation generation now
  draw from per-user fixed windows sized against the shared ~30 RPM NIM
  budget (`AI_LIMITS` in `src/lib/rate-limit.ts`); past the limit the action
  returns "Too many requests — try again in a moment" instead of spending
  model calls.
- **The AI service fails closed without its token.** An empty
  `AI_SERVICE_TOKEN` used to disable auth on the whole AI plane; it now
  refuses every request with 503 naming the missing config. Tokenless local
  development must opt in explicitly with `AI_ALLOW_INSECURE_NO_TOKEN=true`,
  which logs a loud startup warning.
- **Raw model output is no longer retained forever.** `ai_extractions.raw_json`
  (which includes quoted note text) older than `AI_RAW_RETENTION_DAYS`
  (default 30) is nulled; the structured extraction columns are kept. The
  purge is **opportunistic** — it piggybacks on extraction runs, throttled to
  once an hour per process; there is no scheduler, so a ward that never runs
  extraction again keeps its last raw payloads until the next run.

## [0.11.0] - 2026-08-01

> **v0.8.0, v0.9.0 and v0.10.0 were merged to `main` without being tagged.**
> They are documented as their own sections below, but all four ship in the
> `v0.11.0` tag — back-tagging their original commits would have published
> releases whose `package.json` still said `0.7.0`, and triggered deploys of
> superseded code.

### Added

- **Every AI answer says what produced it.** Responses from the AI plane now
  carry `provenance` — `live`, `mock`, or `fallback` — plus the model actually
  called, surfaced in the copilot, the recommendation card and the briefing. A
  non-live answer is visually distinct and no longer claims to be grounded. See
  `specs/releases/v0.11.0-trustworthy-numbers/`.
- **Demand is projected from the ward's own admission history**, and the
  briefing states what it was projected from.

### Fixed

- **`fallback` was indistinguishable from success.** When a live model call
  failed, the AI plane answered from the deterministic mock and still returned
  `grounded: true` with citations — so the interface showed a green "grounded"
  badge on prose no model composed, and nothing in the response, the UI or the
  logs said otherwise. `grounded` is now gated on provenance, the mocks stop
  claiming it, and every fallback logs a warning with the exception type.
  (Extraction is a deliberate exception: its `grounded` asserts each quote was
  found verbatim in the note, which stays true when the mock produced it.)
- **The bed position was arithmetic on constants.** `days_admitted` was
  hardcoded to `3` for every patient, so the discharge model's length-of-stay
  term never varied; expected admissions was a fixed `0.5/hr`, so "net 3 beds
  short" was the same number regardless of ward, hour or day. Length of stay now
  comes from `encounters.admittedAt`, demand from real history, and a figure that
  cannot be computed honestly is **omitted with a reason** rather than defaulted.
- **The eval gates could not fail.** All four harnesses passed with
  `NIM_MOCK=true`, so an expired API key would have left every gate green — a
  passing run did not evidence that a model was involved at all. Each harness now
  records the provenance of every response and refuses to print a score unless it
  came from a live model, overridable only with an explicit `--allow-mock` flag
  (a CLI flag, not an env var, so it cannot be set once and silently disabled).
- **The forecast eval's ground truth was circular** — `mffd − 0.1 × open_barriers`
  is a re-encoding of the features the model weights, so its Spearman ρ could not
  fail unless a weight's sign was flipped. Replaced with a hand-assigned target;
  the old gate is retired rather than carried forward, and the harness now prints
  its own `n` so the score is read with appropriate scepticism.
- **`NIM_EXTRACT_MAX_TOKENS` was never passed through Docker Compose**, so the
  documented knob did nothing, and its `1024` default truncated the reasoning
  model mid-JSON — failing between a third and two-thirds of live extractions,
  invisibly, behind the fallback. Restored to `3072` and plumbed through Compose:
  measured 8/12 failures down to 2–3/12. The residual failures are read timeouts
  and are now **visible** rather than fixed.
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

### Changed

- `policy_chunks` gains `embedding_model` and `recommendations` gains
  `provenance`. Both are nullable, and null means **unknown** rather than
  "assume the current setting" — a recommendation card shows what produced it or
  says nothing, never a guess. The `embedding_model` backfill stamps existing
  rows with whatever is configured at migration time and says loudly that this
  is an assumption; re-seeding is the only way to make it a fact.
- `/embed` carries provenance like every other model output, so hash-derived
  vectors can be told from real ones per response.

## [0.10.0] - 2026-08-01

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
  baseline and was wired only to user registration. The overdue sweep runs on
  board read rather than on a schedule: this deployment has no job runner, so an
  overdue barrier is noticed the next time someone opens the board.
- **The board says when the notes were last read**, so staff can judge how
  current it is.

### Fixed

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
- **Impossible discharge dates were accepted.** The EDD guard used
  `Number.isNaN(Date.parse(edd))`, which does not reject `2026-02-30` — V8 rolls
  it over to 2 March. Since `edd` is stored as text and a clinician-set date is
  never corrected by extraction, the board would have shown "30 Feb" permanently
  while every downstream `new Date(edd)` read it as 2 March.
- **Accessibility: three colour-contrast failures.** `amber-600` (3.19:1) and
  `green-600` (3.21:1) on white, and white on the `green-500` success badge
  (2.21:1), all below the WCAG AA 4.5:1 threshold. Moved to `amber-700` /
  `green-700` and added the dark-mode variants several of them lacked.

### Changed

- `BARRIER_STATUSES` gains `dismissed` — "the AI got this wrong", which is
  clinically distinct from `cleared` ("the work is done") and must not be
  collapsed into it.
- Barrier age is anchored to a new `first_seen_at` that survives re-extraction.

## [0.9.0] - 2026-07-28

### Added

- **Open the referenced policy.** A policy citation on an action recommendation
  or a copilot answer is now clickable — it opens the full referenced discharge
  policy document in a dialog, with the cited passage highlighted (resolved
  server-side from the citation; degrades to the passage when the document can't
  be found). No migration or re-seed. See
  `specs/releases/v0.9.0-open-referenced-sources/`.

## [0.8.0] - 2026-07-28

### Added

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
  aborting the run.

### Changed

- Extraction persistence is now shared between the ward-board Server Action and
  the `pnpm db:extract` CLI (`src/db/persist-extraction.ts`) so their write
  paths can't drift.
- The AI extraction call's completion-token budget became configurable via
  `NIM_EXTRACT_MAX_TOKENS`, defaulting to `1024` to cut per-call latency on the
  reasoning model. **This was a mistake and is reverted in 0.11.0** — the lower
  budget truncated the model mid-JSON and failed a large share of extractions
  invisibly.

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
