---
release: v0.5.0
title: Forecasting & narration — implementation plan
status: Shipped # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/v0.5.0-forecasting-narration
created: 2026-07-27
updated: 2026-07-27
---

# v0.5.0 — Forecasting & narration · implementation plan

> **spec-imp.md = the plan (how).** Living document. Implements
> [`spec.md`](spec.md).

## Approach

Two **deterministic** forecast functions in the FastAPI service (no NIM) — a
transparent logistic discharge model and a demand baseline — plus one **LLM
narration** call that turns their outputs + board stats into a grounded briefing.
Next.js gathers features from the board, calls the forecasts, then narration, and
renders a Flow briefing page. FastAPI stays stateless; the LLM never sees raw
data, only computed numbers.

## Architecture deltas

| Area               | Change                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FastAPI (`ai`)** | `/forecast/discharge` + `/forecast/demand` — pure deterministic math (logistic + baseline), no NIM. `/forecast/narrate` — LLM briefing from numbers (mock + live) |
| **Next.js**        | Briefing orchestration (board → features → forecasts → narrate); `/briefing` page + nav; `FEATURE_BRIEFING` flag                                                  |
| **Reuse**          | `getWardBoard` for features; token-bucket for the single narration call                                                                                           |

No schema change (forecasts are computed on demand, not stored).

## Work breakdown (milestones)

- **M1 — Deterministic forecast service.** FastAPI `/forecast/discharge`
  (logistic over MFFD, open-barrier count, barrier types, days admitted, EDD set
  → `p_discharge_24h`, `predicted_days`) and `/forecast/demand` (expected
  admissions for the window + net beds). Unit tests + a forecast eval
  (`pnpm eval:forecast`, ranking correlation).
- **M2 — Narration + orchestration.** FastAPI `/forecast/narrate` (LLM: numbers
  → grounded briefing; mock fallback). Next.js briefing lib: board → per-patient
  features → `/forecast/discharge` → aggregate + `/forecast/demand` → `/narrate`.
  Extend the eval with narration numeric-consistency.
- **M3 — Briefing UI + release.** `/briefing` page (net position, predicted-
  discharge list, narrated paragraph) + nav + flag. Docs (DEMO/README/PRD
  roadmap) + CHANGELOG; PR → merge → tag `v0.5.0`.

## Interfaces & contracts

FastAPI (`ai`), `X-Service-Token` gated:

| Method | Path                  | Purpose                                                                                                                                                  |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/forecast/discharge` | `{patients:[{id, mffd, open_barriers, has_transport, has_social_care, has_review, days_admitted, edd_set}]}` → `[{id, p_discharge_24h, predicted_days}]` |
| POST   | `/forecast/demand`    | `{free_beds, predicted_discharges, window_hours}` → `{expected_admissions, net_beds}`                                                                    |
| POST   | `/forecast/narrate`   | `{stats, at_risk:[...], predicted_discharges:[...]}` → `{briefing}` grounded in the inputs                                                               |

## Test & evaluation plan

- **Unit (Python)** — logistic monotonicity (more barriers → lower p; MFFD → higher).
- **AI eval** (`pnpm eval:forecast`) — discharge ranking vs. synthetic labels
  (**rank correlation ≥ 0.7**); narration **numeric-consistency ≥ 0.9** (every
  number in the briefing appears in the inputs).
- **Safety** — narration cannot introduce figures not in its inputs.

## Rollout & deployment

`FEATURE_BRIEFING` flag; no new env, no schema/migration. Forecasts are local
(no NIM); one narration call per briefing.

## Risks / unknowns / spikes

| Risk                                | Plan                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| LLM invents numbers in the briefing | Prompt: narrate only the given figures; numeric-consistency eval gate           |
| Logistic weights look arbitrary     | Document them; keep monotonic + interpretable; note prod would fit from history |
| Demand model has no real signal     | Transparent baseline; clearly labelled synthetic                                |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [ ] Forecast + narration eval gates met.
- [ ] `.env.example` + env schema updated (flag); `docker compose up` clean.
- [ ] `CHANGELOG.md` + docs updated; merged to `main`; `v0.5.0` tagged; specs `Shipped`.

## Task checklist

- [x] M1 — deterministic `/forecast/discharge` + `/forecast/demand` + eval
- [x] M2 — `/forecast/narrate` + Next.js briefing orchestration + narration eval
- [x] M3 — briefing UI + nav/flag + docs + release

## Progress (2026-07-27) — Shipped

Built and verified live: discharge-model ranking **ρ = 0.92** (gate 0.7),
narration **numeric-consistency 1.00** (gate 0.9) — the briefing states only
numbers it was given. Forecasts are deterministic (no NIM); the LLM only
narrates. `/briefing` page renders net position + predicted discharges + the
narrated paragraph. Local gate green.
