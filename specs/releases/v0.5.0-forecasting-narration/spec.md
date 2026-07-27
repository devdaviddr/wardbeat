---
release: v0.5.0
title: Forecasting & narration
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
release_tag: v0.5.0
phase: Phase 4 — Forecast & narrate
created: 2026-07-27
updated: 2026-07-27
supersedes: '—'
---

# v0.5.0 — Forecasting & narration

> **spec.md = the contract (what & why).** The _how_ and the task plan live in
> [`spec-imp.md`](spec-imp.md).

## Summary

Add **forecasting** — per-patient discharge likelihood/EDD and ward-level demand
vs. capacity — and a **flow briefing** that turns those numbers into a plain-
language brief a charge nurse can act on in seconds. This is the project's
clearest statement of the GenAI thesis: **deterministic ML predicts the numbers;
the LLM narrates them.** Phase 4 of the [PRD](../../../docs/prd.md) (§5, §7.5).

## Problem / motivation

The board and copilot make _current_ state legible, but flow is about the next
few hours: how many beds will free, how many admissions are coming, and whether
the ward is heading into a shortfall. A calibrated forecast answers that; a
narrated briefing makes it usable without reading a dashboard of numbers.

## Goals

- A **deterministic discharge model** — per occupied patient, P(discharge in 24h)
  and predicted days-to-discharge, from features (MFFD, open barriers, barrier
  types, days admitted, EDD set). **Not an LLM.**
- A **deterministic demand model** — expected admissions over the next window and
  **net bed position** vs. capacity.
- A **flow briefing** — the LLM turns the forecast outputs + board summary into a
  short, grounded paragraph that names the at-risk beds and the actions to chase.
  The LLM **does not compute** any figure; it narrates the model's outputs.
- **Evaluated**: the discharge model ranks sensibly against the synthetic ground
  truth; the briefing is grounded in (and consistent with) the numbers.

## Non-goals

- LLM-produced forecasts/numbers (explicit anti-pattern — the model narrates,
  never predicts). Training pipelines / real historical data. Bed-allocation
  optimisation.

## Scope / user-visible outcome

A **Flow briefing** surface: the net bed position for the next window, predicted
discharges, and a generated paragraph — "Heading 3 beds short tonight; 6 of 12
likely dischargeable tomorrow but 3 gated on transport — chase this afternoon."
Each claim ties back to specific beds/forecasts.

## Requirements

### Functional

- **FR1** — Discharge model returns, per patient, `p_discharge_24h` (0–1) and
  `predicted_days` from allow-listed features. Deterministic and testable.
- **FR2** — Demand model returns expected admissions for the window and net beds
  (predicted discharges − expected admissions, vs. free beds).
- **FR3** — Narration: given the forecast outputs + board stats, the LLM produces
  a grounded briefing that references specific beds/figures and does not invent
  numbers.
- **FR4** — A **Flow briefing** page shows the net position, the predicted-
  discharge list, and the narrated paragraph.

### Non-functional

- **NFR1 — Right tool per job.** Forecasting is deterministic code; the LLM only
  narrates. No model-invented numbers.
- **NFR2 — Grounded narration.** The briefing must be consistent with the figures
  it's given; contradictions are a bug (checked in eval).
- **NFR3 — Rate limit.** One narration call per briefing; forecasts are local
  (no NIM). Reuse the token-bucket.
- **NFR4 — Eval gates.** Discharge-model ranking (fit patients with fewer
  barriers rank higher) — rank correlation ≥ 0.7; narration numeric-consistency
  ≥ 0.9 (no figure stated that isn't in the inputs).

## Acceptance criteria

- [ ] `/forecast/discharge` + `/forecast/demand` return deterministic outputs
      from features (no NIM).
- [ ] Briefing page shows net bed position + predicted discharges + narrated
      paragraph grounded in those numbers.
- [ ] Eval: discharge-model ranking + narration numeric-consistency gates met.
- [ ] Offline mock narration works; live NIM verified.

## Security & privacy

Synthetic data only. Forecasts run locally (no external calls); narration is the
only NIM call and receives already-computed numbers (it can't fetch or change
data). Read-only. Auth/RBAC boundary unchanged.

## Alternatives considered

- **LLM forecasts the numbers** — rejected: unaccountable, uncalibrated,
  hallucination-prone. Deterministic model + LLM narrator is the correct split.
- **Gradient-boosted / trained model now** — production would fit from historical
  data; here a transparent logistic model with documented weights keeps the slice
  dependency-light while making the architecture point.

## Out of scope / future

- Trained models on real history; demand seasonality from real feeds;
  bed-allocation optimisation (OR).

## References

- [WardBeat PRD](../../../docs/prd.md) — §5 (tool-fit), §7.5 (deterministic
  services). Prior releases v0.2.0–v0.4.0.
