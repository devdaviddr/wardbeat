---
release: v0.11.0
title: Trustworthy numbers — implementation plan
status: Draft # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/trustworthy-numbers
created: 2026-08-01
updated: 2026-08-01
---

# v0.11.0 — Trustworthy numbers · implementation plan

> **spec-imp.md = the plan (how).** This is a **living document** — update it as work
> proceeds. It implements the frozen contract in [`spec.md`](spec.md).

## Approach

Three independent threads that share one theme. **(a)** Fix the inputs: derive
`days_admitted` from `encounters.admittedAt`, and replace the synthetic demand
constant with a query over real admission history that can return "unknown".
**(b)** Add a provenance envelope to every AI-service response and thread it
through the Next.js client into the UI, so a mock or fallback answer can never
render as grounded. **(c)** Make the eval harnesses assert provenance and give
the forecast eval a target it can actually fail against.

The provenance envelope is the load-bearing piece — do it first, because it is
what makes the other two verifiable.

## Architecture deltas

| Area                   | Change                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js                | `src/lib/ai/client.ts` parses and propagates provenance; cockpit/briefing pass real `days_admitted` and handle a null demand; new provenance badge component; board "last read" stamp.                                                                                       |
| FastAPI (`ai` service) | Response envelope gains `provenance` + `model_used` on every route; `forecast.py` demand becomes an input, not a constant; `answer.py`/`recommend.py` stop claiming `grounded` on the mock path; `rerank.py` flag becomes time-boxed; `/config` reports the embedding model. |
| Data / migrations      | `policy_chunks` gains `embedding_model`; backfill from the currently-configured model with a warning. No other schema change.                                                                                                                                                |
| Infra (Compose / env)  | No new services. `--allow-mock` is a CLI flag on the eval scripts, not an env var.                                                                                                                                                                                           |

## Work breakdown (milestones)

- **M1 — Provenance envelope.** Pydantic response models gain
  `provenance` + `model_used`; every route sets it truthfully; `client.ts`
  propagates it; unit tests assert the mock path reports `mock` and a forced
  call failure reports `fallback`.
- **M2 — Grounding honesty + UI.** `grounded` can only be true when
  `provenance === 'live'`; provenance badge in the copilot, recommendation card
  and briefing; non-live answers visually distinct.
- **M3 — Real inputs.** `days_admitted` from `admittedAt` across cockpit,
  briefing and the forecast eval; demand projection from admission history with
  an explicit "insufficient history" result; briefing omits what it cannot
  compute.
- **M4 — Evals that fail.** `--allow-mock` flag + provenance assertion in all
  four harnesses; forecast eval ground-truth rework; `docs/evals.md` honesty
  pass.
- **M5 — Drift & recovery.** `policy_chunks.embedding_model` + mismatch warning
  - Settings card surfacing; time-boxed rerank disable.
- **M6 — Board freshness.** "Last read" stamp on the board.

## Data model & migrations

Minimal. `policy_chunks` gains `embedding_model text` (nullable). Migration
backfills existing rows to the currently-configured embedding model id and logs
loudly that the backfill is an **assumption**, not a fact — existing vectors may
have been produced by the mock. Document that the safe remedy is
`pnpm db:seed:policy` to re-embed.

Optionally add `encounters.admitted_at` index if the demand query proves slow;
measure first, do not add speculatively.

## Interfaces & contracts

**Response envelope** — every FastAPI route's response model gains:

```python
provenance: Literal['live', 'mock', 'fallback']
model_used: str | None    # the model id actually called; None for mock
```

Semantics, which must be exact:

- `live` — a real model call succeeded.
- `mock` — `NIM_MOCK=true`; no live call was attempted.
- `fallback` — live was configured, the call failed, the mock answered.

`fallback` is the important one: today it is indistinguishable from `live` at
every layer. Add a distinct log line at `warn` for it.

**Grounding rule** (`ai/app/answer.py`, `ai/app/recommend.py`): `grounded` is
computed as it is today **and** gated on `provenance == 'live'`. The mock must
not emit `citations: [1]` with `grounded: true` — it emits `grounded: false`.

**Forecast contract** (`ai/app/forecast.py`): `demand_forecast` moves from a
constant to a caller-supplied input.

```python
class DemandInput(BaseModel):
    admissions_last_7d: int | None      # None = insufficient history
    window_hours: int
```

Response returns `expected_admissions: float | None` and
`insufficient_history: bool`. Next.js computes `admissions_last_7d` from
`encounters.admittedAt` and passes it; if the ward has fewer than a threshold
number of admissions on record (propose 7, i.e. a day's worth), it passes
`None`.

**Eval CLI**: each `src/eval/*.ts` accepts `--allow-mock`. Without it, any
response whose provenance is not `live` fails the run with a clear message
("ran against the mock — the gate proves nothing"). This is the single most
valuable line of code in the release.

**Forecast eval ground truth**: replace
`truth = mffd - 0.1 * open_barriers` with a held-out target that is not a linear
function of the model's own features. Options, in preference order:
(a) label the 12 seeded encounters by hand with an expected-discharge-window
judgement and score against that; (b) derive truth from note text the model does
not see. (a) is small but honest and is the recommendation — and the eval should
state its own n in its output so the number is read with appropriate scepticism.

## File / module plan

```
ai/app/
  schemas.py            # provenance + model_used on every response model
  answer.py             # grounded gated on provenance
  recommend.py          # same; mock no longer emits citations as grounded
  forecast.py           # demand as input; insufficient_history
  rerank.py             # time-boxed disable instead of a latching global
  routers/health.py     # /config reports embedding model id
  settings.py           # (unchanged) — mock flag already here
src/
  lib/ai/client.ts      # parse + propagate provenance
  lib/ward/cockpit.ts   # real days_admitted
  lib/briefing/briefing.ts  # real days_admitted; admission history; omit-not-invent
  lib/copilot/policy.ts # embedding-model mismatch check
  components/ward/
    provenance-badge.tsx    # NEW
    briefing-strip.tsx      # omit-not-invent + provenance
    copilot-chat.tsx        # badge reflects provenance
    cockpit-board.tsx       # last-read stamp
  eval/*.ts             # --allow-mock + provenance assertion; forecast truth rework
tests/unit/
  provenance.test.ts    # NEW
  demand-history.test.ts# NEW
docs/evals.md           # honesty pass: dataset sizes, what each gate detects
```

## Test & evaluation plan

- **Unit** — provenance propagates service → client → component; `grounded` is
  false whenever provenance is not `live`; demand returns
  `insufficient_history` below the threshold; `days_admitted` derives correctly
  including same-day admission (0, not 1) and a null `admittedAt`.
- **E2E** — with `NIM_MOCK=true`, the copilot answer shows the not-live marker
  and no grounded badge.
- **Eval gates** — unchanged thresholds for extraction/copilot/action; the
  forecast gate is **restated** against the new ground truth and its previous
  ρ ≥ 0.9 is retired (it was measuring the wrong thing, so carrying the number
  forward would be misleading). State the new gate and its n in `docs/evals.md`.
- **Negative test** — the point of the release: a run with the models
  unreachable must produce a **failing** eval, and this is asserted in CI-less
  local gate terms (a documented manual check plus a unit test on the flag
  logic).
- **Safety** — confirm no provenance field is ever interpolated into a prompt.

## Rollout & deployment

- Additive migration; no re-seed strictly required, but **re-seeding policy
  chunks is strongly recommended** after switching between mock and live, and
  the release notes must say so plainly.
- No new env vars. `--allow-mock` is a CLI flag so it cannot be accidentally set
  globally in an environment file and silently disable the whole guard.
- Rate limit: unchanged — no new model calls.

## Observability

- `warn`-level log on every `fallback` response, with the underlying error. This
  alone would have made the silent-degradation problem visible months ago.
- Log the embedding-model mismatch at `error`.
- Reranker disable/re-enable transitions logged.
- Still no metrics stack; `docs/monitoring.md` stays honest about that.

## Risks / unknowns / spikes

| Risk / unknown                                                                                                 | Plan                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Removing the demand constant leaves the briefing visibly emptier and looks like a regression to a demo viewer. | It is a regression in confidence, not capability, and that is the point. Update `docs/DEMO.md` so the demo narrates it as a strength.   |
| Hand-labelling the forecast eval (n=12) is a tiny dataset and will look weak.                                  | It is weak — and honest. Print n alongside the score so nobody over-reads it. Growing the dataset is named as out-of-scope future work. |
| Backfilling `embedding_model` asserts something we cannot verify for existing rows.                            | Log it as an assumption, document re-seed as the remedy, and surface the uncertainty in the Settings card rather than hiding it.        |
| Provenance touches every AI route — broad blast radius.                                                        | M1 lands alone with tests before any UI or eval work depends on it.                                                                     |
| A `fallback` badge on the demo path makes the product look broken during a presentation.                       | Correct behaviour. If the demo needs live models, run live models.                                                                      |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
      (+ `ai/` pytest).
- [ ] All four eval harnesses **fail** when pointed at mocks without
      `--allow-mock` (verified by hand and recorded here).
- [ ] Forecast eval gate restated against non-circular ground truth.
- [ ] `docs/evals.md` states dataset sizes and gate limitations honestly;
      `docs/DEMO.md` updated.
- [ ] `CHANGELOG.md` updated.
- [ ] Merged to `main`; `v0.11.0` tagged; both specs `Shipped` with criteria
      ticked.

## Task checklist

- [ ] Provenance fields on every FastAPI response model.
- [ ] Truthful provenance at each call site (live / mock / fallback).
- [ ] `warn` log on fallback with the underlying error.
- [ ] `client.ts` propagation + unit tests.
- [ ] `grounded` gated on provenance; mock stops emitting citations as grounded.
- [ ] Provenance badge component; wire into copilot, recommendation card, briefing.
- [ ] `days_admitted` from `admittedAt` — cockpit, briefing, forecast eval.
- [ ] Admission-history demand query + `insufficient_history` path.
- [ ] Briefing omits uncomputable figures with an explanation.
- [ ] `--allow-mock` + provenance assertion across all four evals.
- [ ] Forecast eval ground-truth rework; restate the gate.
- [x] `policy_chunks.embedding_model` + migration + mismatch warning + Settings card.
      Migration `0014_organic_xavin.sql` adds the column; the backfill lives in
      `src/db/migrate.ts` (plain SQL cannot read the AI plane's configuration)
      and logs that it is an assumption. On drift the copilot **refuses** rather
      than answering — every passage was matched across two unrelated vector
      spaces, so an answer built on them would be a fabrication wearing
      citations.
- [x] Time-box the rerank disable. 15-minute cooldown
      (`RERANK_COOLDOWN_SECONDS`); only a 404 backs off, a 5xx/timeout stays
      per-call, and both transitions are logged.
- [x] `recommendations.provenance` (same migration) — persisted by
      `generateRecommendationsAction` and `pnpm db:recommend`, surfaced through
      `getCockpit()` so the recommendation card's provenance indicator has real
      data instead of degrading. Not backfilled: rows written before the column
      existed genuinely do not know.
- [ ] Board "last read" stamp.
- [ ] `docs/evals.md` + `docs/DEMO.md` + changelog.
