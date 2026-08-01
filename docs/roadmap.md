# Roadmap — how WardBeat could improve

[← Back to README](../README.md) · [PRD](prd.md) · [Evals](evals.md) ·
[Monitoring](monitoring.md)

Where WardBeat goes next. This is the honest gap list — what today's slice
deliberately leaves out and what would make it production-grade in a real trust.
It complements the product roadmap in the [PRD](prd.md) and the "Next" note in the
[platform guide](guide.html).

## Release arc (v0.10.0 → v0.13.0) — status as of 2026-08-01

Four releases were planned together on **2026-08-01** after a product review, specced in
[`specs/releases/`](../specs/releases/README.md) and ordered by dependency. **Three have
shipped** (v0.10.0 in the `v0.11.0` tag; v0.11.0 and v0.12.0 released 2026-08-01) —
**v0.13.0 Multi-ward is the only release still planned**:

| Release                                                                                     | Status                         | What it fixes                                                                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [**v0.10.0** Close the loop](../specs/releases/v0.10.0-close-the-loop/spec.md)              | **Shipped** (in `v0.11.0` tag) | A barrier gains an owner, due time, progress log and a way to be **cleared**; re-extraction stops destroying human work. |
| [**v0.11.0** Trustworthy numbers](../specs/releases/v0.11.0-trustworthy-numbers/spec.md)    | **Shipped**                    | Every figure honest or absent; per-response AI provenance visible; eval gates that can actually fail.                    |
| [**v0.12.0** Ward authorization & audit](../specs/releases/v0.12.0-ward-rbac-audit/spec.md) | **Shipped**                    | Clinical roles, authorization on every ward action, and an access audit covering **reads**.                              |
| [**v0.13.0** Multi-ward](../specs/releases/v0.13.0-multi-ward/spec.md)                      | **Proposed** — planned next    | Ward as an explicit scope, a site view, and the bed lifecycle closed.                                                    |

The review that produced them also surfaced gaps this document previously did not record;
they are folded into the sections below — marked **(closed by vX.Y.Z)** where a now-shipped
release resolved them, and **(owned — v0.13.0)** where the still-pending release covers
them.

## Product & clinical

- **The loop does not close.** _(closed by v0.10.0.)_ A barrier can be created and
  approved but **never cleared** — `cleared` exists in the schema and nothing in
  the application sets it, so the ward's open-barrier count only ever rises. There
  is also no owner, due time or progress note on a barrier, which is the entire
  chase-and-escalate workflow.
- **Re-extraction destroys human work.** _(closed by v0.10.0.)_ Extraction deletes
  and re-inserts a note's barriers, so one person re-running it silently wipes
  every triage decision made on the ward. This is a data-loss bug, not a gap.
- **No human write path.** _(closed by v0.10.0.)_ A clinician cannot add a barrier
  the AI missed, dismiss one it invented, or override an EDD. Clinicians do not
  trust systems they cannot contradict.
- **One persona, partially served.** The PRD names five personas; the role model
  has two, neither clinical. Charge nurses, junior doctors, allied health and
  discharge planners have no surface of their own. _(Roles: shipped in v0.12.0.
  The capabilities themselves remain future work.)_
- **No authorization on ward data.** _(closed by v0.12.0.)_ Any authenticated user
  reads every patient name, MRN and note, and can approve clinical actions.
  `requireRole` is used in the admin surfaces and **nowhere** in the domain.
- **No read audit.** _(closed by v0.12.0.)_ Nothing records who viewed a patient,
  who ran extraction, or what anyone asked the copilot — the first question a
  clinical information-governance review asks.
- **Close the bed-lifecycle loop.** _(owned — v0.13.0.)_ Today WardBeat makes flow
  _visible_ and barriers _actionable_, but nothing in the application ever writes
  `encounters.dischargedAt` or changes `beds.status` — a bed never turns over, and
  the `cleaning` status is set by nothing. Adding **admit / transfer / discharge**
  is what makes occupancy change over time.
- **Write-back to real systems.** The action agent is deliberately
  **recommend-only** — approving writes an audit row, nothing leaves the system.
  A future integration could dispatch to pharmacy (TTOs), transport, and social
  care via their systems of record, each behind a human gate.
- **Real data via FHIR / an EHR.** The whole system runs on **synthetic data**
  today. A production path needs a read integration with the trust's EHR (HL7
  FHIR) and an information-governance review, keeping the private, in-tenant
  posture from the [Azure design](guide.html).
- **House-wide flow.** _(owned — v0.13.0.)_ WardBeat is hardwired to one ward —
  the central read selects an arbitrary ward with no `where` clause — while the
  primary persona, the bed manager, works across ten to twenty. Extending to a
  site view with cross-ward transfers is a scope correction, not an enhancement.

## AI & models

- **Silent degradation reads as success.** _(closed by v0.11.0.)_ When a live model
  call fails, the AI plane falls back to the deterministic mock and still returns
  `grounded: true` with citations — so the UI shows a green "grounded" badge on an
  answer no model composed. Nothing in the response, the UI or the logs
  distinguishes it from a real answer.
- **Dead forecast inputs.** _(closed by v0.11.0.)_ `days_admitted` is hardcoded to
  `3` for every patient despite `encounters.admittedAt` existing, and the demand
  forecast is a `0.5/hr` constant — so "expected admissions" is always the same
  number and the bold net-beds figure is arithmetic on a constant.
- **Embedding drift is undetectable.** _(closed by v0.11.0.)_ Policy chunks are
  embedded at seed time through the same endpoint used at query time. Seed in mock,
  switch to live, and the database holds hash-derived vectors while queries use
  real ones — both 1024-d, so retrieval returns plausible garbage with no error.
- **NeMo Guardrails as an explicit safety rail.** Grounding + allow-lists are the
  current defences; a dedicated guardrails layer would formalise input/output
  policy (named in the guide's "Next").
- **Editable AI configuration.** `GET /config` is read-only today. Editing model
  ids / limits from the UI would need a config store and a security review — the
  Settings card is the read-only first step.
- **Surface the extraction token budget.** `NIM_EXTRACT_MAX_TOKENS` exists in the
  AI-plane settings but is not yet in `GET /config`; add it once the field is
  wired end-to-end so the Settings card can show it.
- **Streaming answers.** The copilot answers in one shot; SSE streaming would
  improve perceived latency for longer policy answers.
- **Per-capability model choice & fine-tuning.** Allow different models per task,
  and fine-tune extraction/recommendation on real labelled data once available.
- **Active-learning loop.** The `action_audit` trail (what humans approve /
  dismiss) is a labelled signal — feed it back to improve extraction and
  recommendation quality over time. Add confidence calibration alongside.

## Evaluation & quality

- **The gates could not fail on an absent model.** _(closed by v0.11.0.)_ All
  four harnesses passed with `NIM_MOCK=true`, so an expired API key would leave every
  gate green — a passing eval run did not prove the models were involved.
- **The forecast gate is circular.** _(closed by v0.11.0.)_ Its ground truth is
  `mffd − 0.1 × open_barriers`, a monotone re-encoding of the model's own features,
  so the reported ρ measures that two sign-consistent linear functions agree — not
  predictive accuracy. The gate is retired rather than carried forward.
- **The datasets are very small.** 12 labelled notes, 6 policy questions, 6 ward
  questions, 6 action cases, 5 policy docs. At n=6 a 0.90 gate has no resolution
  between 0.83 and 1.0, and a reported "100%" is noise-dominated. Harness output
  should print its own `n` so the numbers are read with appropriate scepticism.
- **Zero domain test coverage.** The 158 TypeScript test cases in `tests/` are all
  inherited platform scaffolding — auth, RBAC, storage, push, email. **None** touch
  the ward board, extraction orchestration, persistence, recommendations, the
  copilot or the briefing. v0.10.0 started the domain suite; every release after it
  should extend rather than defer it.
- **Run the eval gates in CI.** The four [eval harnesses](evals.md) already exit
  non-zero below gate; wire them into CI (once CI is re-introduced) so a
  regression fails the build, not a demo.
- **Richer metrics.** RAGAS faithfulness for retrieval, LLM-as-judge rubrics for
  open-ended answers, and **regression tracking** of eval scores over time.
- **Bigger, real-derived eval sets.** Today's labels are synthetic; grow them
  (de-identified real notes) to harden the numbers.

## Operability & platform

- **Metrics, tracing, alerting.** [Monitoring](monitoring.md) is logs +
  health/config + evals today. Add OpenTelemetry spans across Next.js → AI plane →
  NIM, per-call token/cost/latency metrics, dashboards, and alerts.
- **Shared rate-limit store.** The token-bucket limiter is in-memory
  (single-instance). A shared store (Redis) is needed to scale the app or AI plane
  horizontally.
- **Ship the Azure deployment.** The [Azure reference architecture](guide.html) is
  a design; implement it as Bicep IaC + GitHub Actions (OIDC) with the private,
  managed-identity posture described.
- **Re-introduce CI.** CI is currently deferred (gates run locally). Bringing back
  GitHub Actions — lint · typecheck · test · build · **eval gates** — is a
  prerequisite for several items above.
- **About-guide source of truth.** `public/about-architecture.html` and
  `public/about-azure.html` are hand-maintained (only `about.html` mirrors
  `docs/guide.html` via `pnpm sync:about`); consolidate their source to avoid
  drift.

## References

- [PRD](prd.md) — product vision and phased roadmap.
- [Evals](evals.md) · [Monitoring](monitoring.md) — the quality and runtime
  foundations these build on.
