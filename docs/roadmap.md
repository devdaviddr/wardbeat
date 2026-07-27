# Roadmap — how WardBeat could improve

[← Back to README](../README.md) · [PRD](prd.md) · [Evals](evals.md) ·
[Monitoring](monitoring.md)

Where WardBeat goes next. This is the honest gap list — what today's slice
deliberately leaves out and what would make it production-grade in a real trust.
It complements the product roadmap in the [PRD](prd.md) and the "Next" note in the
[platform guide](guide.html).

## Product & clinical

- **Close the bed-lifecycle loop.** Today WardBeat makes flow _visible_ and
  barriers _actionable_, but a human still admits and discharges. Adding
  **admit / discharge** so beds actually turn over in the system is the next
  product slice.
- **Write-back to real systems.** The action agent is deliberately
  **recommend-only** — approving writes an audit row, nothing leaves the system.
  A future integration could dispatch to pharmacy (TTOs), transport, and social
  care via their systems of record, each behind a human gate.
- **Real data via FHIR / an EHR.** The whole system runs on **synthetic data**
  today. A production path needs a read integration with the trust's EHR (HL7
  FHIR) and an information-governance review, keeping the private, in-tenant
  posture from the [Azure design](guide.html).
- **House-wide flow.** Extend from one ward to a site view, with the site/ops
  persona and cross-ward transfers.

## AI & models

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
