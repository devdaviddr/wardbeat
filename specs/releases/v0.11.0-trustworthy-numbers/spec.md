---
release: v0.11.0
title: Trustworthy numbers — honest inputs, visible provenance
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
phase: Phase 2 — from viewer to tool
created: 2026-08-01
updated: 2026-08-01
supersedes: '—'
---

# v0.11.0 — Trustworthy numbers — honest inputs, visible provenance

> **spec.md = the contract (what & why).** Freeze this once `Accepted`; the _how_ lives in
> [`spec-imp.md`](spec-imp.md).

## Summary

WardBeat currently shows some numbers that are constants dressed as forecasts,
and shows a green "grounded" badge on answers that no model composed. This
release makes every number on the board either **honest or absent**, and makes
the **provenance of every AI output visible** — live model, deterministic mock,
or silent fallback. It also makes the evaluation harnesses capable of failing,
which today they are not: all four pass with the models switched off entirely.

## Problem / motivation

WardBeat's differentiator is that it grounds and cites everything. Three things
undermine that claim, all verifiable on `main`:

1. **Dead model inputs.** `days_admitted: 3` is hardcoded for every patient in
   both `src/lib/ward/cockpit.ts` and `src/lib/briefing/briefing.ts`, despite
   `encounters.admittedAt` existing and being populated. Length of stay is a
   feature of the discharge model, so that term is permanently constant — the
   per-bed discharge probability is computed on a fiction.

2. **A fabricated demand forecast.** `demand_forecast` in `ai/app/forecast.py`
   is `0.5 × window_hours`, so "expected admissions" is always 6 regardless of
   ward, hour, or day. The briefing renders "net 3 beds short" in bold, beside
   real data. On a ward, one wrong bed-position number ends the tool's
   credibility permanently — and this one cannot be right, because it is not
   computed from anything.

3. **Silent degradation reads as success.** When a NIM call fails, the AI
   service falls back to the deterministic mock and returns `grounded: true`
   with citations. The copilot then renders a green "● grounded" badge on an
   answer that was assembled by string manipulation. Nothing in the response,
   the UI, or the logs distinguishes this from a real grounded answer. The same
   fallback affects recommendations.

Compounding all three: **the evals cannot detect any of it.** All four harnesses
pass under `NIM_MOCK=true`, and the forecast eval defines ground truth as
`mffd - 0.1 × open_barriers` — a monotone re-encoding of the same features the
model weights, so a reported ρ of 0.92 measures that two sign-consistent linear
functions agree, not predictive accuracy. If a key expired, every gate would
still go green.

A separate, quieter version of the same problem: policy chunks are embedded at
seed time through the same `/embed` endpoint used at query time. Seed in mock,
switch to live, and the database holds hash-derived vectors while queries use
real ones — both 1024-d, so cosine search returns plausible garbage with no
error and the "grounded" badge stays green.

## Goals

- Every model input the product feeds a forecast is **real or explicitly
  absent** — no constants presented as data.
- A number that cannot be computed honestly is **not shown**; the UI says why.
- Every AI output carries **provenance** (`live` / `mock` / `fallback`), it is
  visible in the UI, and "grounded" means a model actually grounded it.
- The board shows **when its data was last read**.
- **Evals fail when the models are absent**, and the forecast eval measures
  something it can fail.
- Embedding-model drift between seed time and query time is **detected**, not
  silently tolerated.

## Non-goals

- Fitting a real discharge model on real data (no real data exists; this release
  is about honesty, not accuracy).
- Building a metrics/tracing stack (`docs/monitoring.md` is honest that none
  exists; a proper one is later).
- Retry/backoff strategy for NIM (worth doing, but it is a reliability release,
  not this one) — except that a fallback must now be _visible_.
- Any change to the barrier lifecycle (v0.10.0) or authorization (v0.12.0).

## Scope / user-visible outcome

The briefing no longer claims a bed position it cannot compute. Where WardBeat
has enough history to project demand it says so and shows the basis; where it
does not, it shows "not enough admission history" instead of a number. Per-bed
discharge probability is computed from the patient's actual length of stay.

Every AI-produced surface — copilot answer, recommendation, briefing — shows
what produced it. A live model answer looks as it does today. A mock or
fallback answer is clearly marked as **not model-generated**, and does not claim
to be grounded. The board carries a "last read" timestamp so staff can calibrate
how much to trust what they are looking at.

For the maintainer: `pnpm eval:*` fails loudly when it is running against mocks
unless explicitly told not to, and the AI configuration card in Settings shows
the embedding model that the stored policy vectors were built with alongside the
one currently configured.

## Requirements

### Functional

- **FR1 — Real length of stay.** `days_admitted` is derived from
  `encounters.admittedAt` everywhere it is passed to the forecast (board,
  cockpit, briefing, eval). No hardcoded value remains in application code.
- **FR2 — Honest demand.** The synthetic `0.5/hr` admission constant is removed.
  Demand is projected from actual admission history in the database over a
  trailing window. When there is insufficient history to project, the service
  returns **no demand figure** and the reason.
- **FR3 — Absent, not invented.** Any derived figure the briefing cannot compute
  (net beds, expected admissions) is omitted with an explanation, never
  defaulted to a number.
- **FR4 — Provenance envelope.** Every AI-service response carries
  `provenance: 'live' | 'mock' | 'fallback'` plus the model id actually used.
  `fallback` specifically means "live was configured but the call failed".
- **FR5 — Grounding means grounded.** A response produced by the mock or a
  fallback must not report `grounded: true`. The UI badge reflects provenance,
  and a non-live answer is visually distinct.
- **FR6 — Last read.** The ward board displays when extraction last ran and when
  the board data was read.
- **FR7 — Evals can fail.** Every harness asserts `provenance === 'live'` and
  exits non-zero otherwise, unless run with an explicit `--allow-mock` flag. The
  forecast eval's ground truth is replaced with a target that is not a
  re-encoding of the model's own features, and its gate is restated accordingly.
- **FR8 — Embedding drift detection.** The embedding model id is recorded
  against stored policy chunks. A query embedded with a different model
  surfaces a loud warning rather than returning results silently, and the
  condition is visible in the Settings AI configuration card.
- **FR9 — Reranker recovery.** The process-lifetime `_rerank_disabled` flag in
  `ai/app/rerank.py` no longer latches permanently on a single failure.

### Non-functional

- **NFR1 — No false confidence.** No surface may present a value with more
  precision or certainty than its input supports; this is the release's whole
  point and applies to copy as well as code.
- **NFR2 — Tests.** Provenance propagation (service → Next.js → UI) has unit
  coverage; the "insufficient history" path has coverage; the eval mock-detection
  has coverage.
- **NFR3 — No new AI cost.** Provenance is metadata on existing calls. Demand
  projection is a database query, not a model call.
- **NFR4 — Honesty in docs.** `docs/evals.md` is updated to state dataset sizes
  and what each gate can and cannot detect. It currently overstates.

## Acceptance criteria

- [x] No occurrence of a hardcoded `days_admitted` remains in `src/`; discharge
      probability changes when an encounter's `admittedAt` changes.
- [x] With no admission history seeded, the briefing shows an explanation
      instead of an expected-admissions number.
- [ ] With `NIM_MOCK=true`, a copilot answer is visibly marked as not
      model-generated and shows no green grounded badge.
- [ ] Killing the NIM endpoint mid-session produces answers marked `fallback`,
      not answers marked grounded.
- [x] The board shows a "last read" timestamp that updates after an extraction
      run.
- [x] `pnpm eval:copilot` (and the other three) exit **non-zero** when run
      against mocks without `--allow-mock`.
- [ ] The forecast eval fails if a model weight's sign is flipped **and** its
      ground truth is not a linear re-encoding of the model's own inputs.
- [x] Seeding policy chunks in mock mode and then querying in live mode raises a
      visible embedding-mismatch warning.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.

> **Verification status (2026-08-01).** Ticked criteria were checked against a
> real Postgres and a **live** NVIDIA NIM deployment, not the mock.
>
> The provenance guard was the release's own first test, and it worked: run
> against mocks all four harnesses fail (`12/12`, `24/24`, `12/12`, `2/2`
> non-live responses); run live they pass. Pointed at the live plane it then
> found two defects nothing else could see — `NIM_EXTRACT_MAX_TOKENS` was never
> passed through Docker Compose, and its `1024` default truncated the reasoning
> model mid-JSON, failing 4–8 of every 12 live extractions **invisibly behind
> the fallback**. Restoring `3072` measured 8/12 failures down to 2–3/12.
>
> Three criteria are **not ticked** and are honestly outstanding:
>
> - **Killing NIM mid-session** to observe `fallback` was never staged
>   deliberately. It was however observed _in the wild_ — the extraction
>   timeouts above surface as `fallback`, with a `warn` log naming the
>   exception type — so the path is exercised, just not by a designed test.
> - **The `NIM_MOCK=true` copilot badge** is covered by unit tests and by
>   reading, not by looking at a rendered page. No UI in this release has been
>   visually reviewed.
> - **The forecast-eval sign-flip test** was not performed. The circular ground
>   truth is replaced and the old ρ retired, but "fails when a weight flips" is
>   asserted by construction rather than demonstrated.
>
> Residual known issue: roughly 2–3 of 12 live extractions still fall back, now
> as read timeouts rather than truncation. Raising the NIM timeout to 60s was
> tried and made it worse (5/12) and much slower, so it was reverted. This is a
> model-reliability problem that v0.11.0 makes **visible** rather than fixes.

## Security & privacy

No new data flows and no new external calls. One improvement: recording the
model id actually used per response makes it possible to tell, after the fact,
whether patient-adjacent note text reached a third-party endpoint or was handled
by the local mock — which is a genuine privacy-audit capability the system does
not have today. Note that raw note text still reaches a hosted API with no
redaction; that remains a known gap owned by the roadmap, not this release.

## Alternatives considered

- **Fit a real discharge model.** No real data exists, and a model fitted on
  synthetic seed data would be exactly the circularity this release exists to
  remove. Deferred until there is a real feed.
- **Keep the demand constant but label it "illustrative".** A label does not
  stop a bed manager acting on a bold number. Removing it is the honest move.
- **Fail closed when the model is unavailable** (error instead of mock
  fallback). Tempting, and arguably right for production — but it would break
  the demo path and the offline development story. Marking the fallback clearly
  achieves the trust goal without that cost; failing closed can be an
  environment-gated policy later.
- **Ship provenance only in logs.** Cheaper, but the person who needs to know an
  answer was fabricated is the clinician reading it, not the maintainer reading
  logs.

## Out of scope / future

- **v0.12.0** — clinical roles, ward-level authorization, access audit.
- **v0.13.0** — multi-ward scoping.
- Retry/backoff on NIM calls; a real metrics and tracing stack; per-response
  latency/token/cost accounting; LLM-judge and faithfulness scoring on the eval
  harnesses; growing the eval datasets beyond their current 5–12 items.

## References

- [WardBeat PRD](../../../docs/prd.md) — E5 (forecasting), E7 (evaluation).
- `ai/app/forecast.py`, `ai/app/answer.py`, `ai/app/rerank.py`,
  `src/lib/ward/cockpit.ts`, `src/lib/briefing/briefing.ts`, `src/eval/*.ts`.
- [v0.5.0 — Forecasting & narration](../v0.5.0-forecasting-narration/spec.md) —
  the release whose inputs this corrects.
- [v0.8.0 — AI configuration in Settings](../v0.8.0-ai-configuration-settings/spec.md) —
  the card this extends with embedding provenance.
