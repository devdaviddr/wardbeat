---
release: v0.6.0
title: Flow cockpit — implementation plan
status: Shipped # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/v0.6.0-flow-cockpit
created: 2026-07-27
updated: 2026-07-27
---

# v0.6.0 — Flow cockpit · implementation plan

> **spec-imp.md = the plan (how).** Living document. Implements
> [`spec.md`](spec.md).

## Approach

Front-end consolidation only — no new AI endpoints. A single `getCockpit()`
assembles the board + per-bed recommendations + per-bed discharge forecast in one
cheap pass (one DB query + one local `/forecast/discharge` batch — no NIM). The
narrated briefing (the only NIM call) loads **async** via a server action so the
grid renders instantly. The board client component gains a bed **drawer**, a
briefing **header strip**, and a copilot **dock** that highlights referenced beds.

## Architecture deltas

| Area               | Change                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Next.js (read)** | `getCockpit()` — board + per-bed `recommendations[]` + `{p_discharge, predicted_days}`; async `getBriefingSummary()` for the header                                            |
| **Next.js (UI)**   | Rework `/ward`: briefing strip, bed grid with badges, bed **drawer** (barriers/citations + recommendations approve/dismiss + forecast), copilot **dock** with bed highlighting |
| **Reuse**          | decisions (`approve/dismiss`), `generateRecommendationsAction`, `askCopilotAction`, `getFlowBriefing`, `forecastDischarge`                                                     |
| **Nav**            | Trim to Ward + Actions (+ Settings); copilot/briefing routes stay but leave the primary nav                                                                                    |

No schema change, no new migration, no new eval.

## Work breakdown (milestones)

- **M1 — Cockpit read model.** `getCockpit()` joins the board with proposed
  recommendations per encounter and a batch discharge forecast; expose per-bed
  `actionCount`, `pDischarge`, `predictedDays`. Bed grid shows the ⚡N badge +
  discharge %.
- **M2 — Bed detail drawer.** Clicking a bed opens a slide-over: patient,
  status/EDD/forecast, barriers with cited source, and recommendations with
  inline Approve/Dismiss (server actions + `router.refresh`). Replaces the plain
  citation dialog.
- **M3 — Briefing header + copilot dock.** Async briefing strip (net position +
  narrated one-liner, expandable). Copilot dock (button/⌘K) → answer; ward-state
  answers pass back bed labels that **highlight** on the grid.
- **M4 — Nav trim + docs + release.** Trim primary nav; keep routes alive. Docs
  (DEMO/README/PRD §7.6); CHANGELOG; PR → merge → tag `v0.6.0`.

## Interfaces & contracts

No new service endpoints. New Next.js read helpers:

- `getCockpit(): CockpitBoard` — beds with `barriers`, `recommendations`,
  `pDischarge`, `predictedDays`, `actionCount`; ward `stats`.
- `getBriefingSummary(): { netBeds, netLabel, briefing, stats }` (async header;
  wraps `getFlowBriefing`).

## Test & evaluation plan

- **Unit** — cockpit assembly (action counts, forecast attach) where practical.
- **E2E (Playwright)** — open board → briefing strip loads; open a bed drawer →
  approve a recommendation → board reflects it; ask copilot → beds highlight.
- **Regression** — all v0.2–v0.5 evals still green (unchanged).

## Rollout & deployment

No new env beyond the existing feature flags; `FEATURE_WARD_BOARD` gates the
cockpit. No schema/migration. Briefing async-loads so the board is never blocked
on a NIM call.

## Risks / unknowns / spikes

| Risk                                               | Plan                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Briefing NIM latency on board load                 | Load it async (server action) with a skeleton; grid renders immediately     |
| Drawer as modal vs slide-over (no Sheet component) | Build a lightweight slide-over with a backdrop; keep it keyboard-accessible |
| Per-bed forecast/reco cost                         | One DB query + one local forecast batch (no NIM) — cheap                    |
| Scope creep in the client component                | Split into board / bed-drawer / briefing-strip / copilot-dock components    |

## Definition of Done

- [x] All `spec.md` acceptance criteria met.
- [x] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [x] Existing evals still pass; no schema change.
- [x] `CHANGELOG.md` + docs updated; merged to `main`; `v0.6.0` tagged; specs `Shipped`.

## Task checklist

- [x] M1 — cockpit read model + bed badges/discharge %
- [x] M2 — bed detail drawer (barriers/citations + recommendations + forecast)
- [x] M3 — briefing header strip (async) + copilot dock with bed highlighting
- [x] M4 — nav trim + docs + release
