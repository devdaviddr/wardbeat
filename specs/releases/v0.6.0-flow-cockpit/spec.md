---
release: v0.6.0
title: Flow cockpit — board-centric UX
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
release_tag: v0.6.0
phase: Phase 5 — Experience
created: 2026-07-27
updated: 2026-07-27
supersedes: '—'
---

# v0.6.0 — Flow cockpit (board-centric UX)

> **spec.md = the contract (what & why).** The _how_ and the task plan live in
> [`spec-imp.md`](spec-imp.md).

## Summary

Re-centre the whole product on the **ward board** as a single pane of glass. Today
the board, copilot, action queue, and briefing are four separate destinations for
one job ("run the ward"). This release makes everything **orbit the board**: the
flow **briefing** becomes a header strip, a **bed detail drawer** unifies a
patient's barriers/citations + recommendations + discharge forecast in one place,
beds carry **action badges**, and the **copilot docks** onto the board and
**highlights the beds it references**. No new AI capability — this is UX
consolidation of v0.2–v0.5 into a cockpit.

## Problem / motivation

The bed is the atomic unit of the product, yet a single bed's information is
scattered across three pages, and ward-level context (the briefing) sits on a
fourth. A charge nurse holds "the ward" in their head and shouldn't tab-hop to
act on it. Consolidating around the board reduces clicks, removes context-
switching, and tells a stronger product story (a flow cockpit, not four tools).

## Goals

- The board is **home** and shows ward context (briefing) + per-bed signal
  (barriers, pending-action count) at a glance.
- Clicking a bed opens a **detail drawer** with everything for that patient:
  status/EDD/forecast, barriers (with source citations), and its recommended
  actions with **inline Approve/Dismiss**.
- A **docked copilot** on the board answers questions and **highlights the beds**
  its answer references (ward-state) — augmenting the board, not replacing it.
- Navigation collapses from four feature tabs toward **Ward (cockpit) + Actions
  (triage)**; copilot and briefing become board-integrated.

## Non-goals

- Any new model/endpoint or AI capability (reuses v0.2–v0.5).
- Streaming copilot (still non-streaming). Changing the extraction/RAG/agent/
  forecast logic. Real-time push updates.

## Scope / user-visible outcome

Opening **Ward** shows: a **briefing strip** (net bed position + one-line narrated
summary, expandable) atop the **bed grid** (MFFD/barrier chips + an "⚡N" badge
when a bed has pending recommendations). Clicking a bed slides in a **detail
drawer**. A **copilot dock** (button / ⌘K) answers and highlights beds.

## Requirements

### Functional

- **FR1** — Board header shows net bed position + narrated briefing (loaded
  without blocking the grid); expandable to the full brief.
- **FR2** — Each occupied bed shows barrier chips, its discharge probability, and
  a pending-recommendation count badge.
- **FR3** — Bed drawer: patient, status/EDD, forecast (P + predicted days),
  barriers with citation view, and recommendations with inline Approve/Dismiss
  (reusing the v0.4.0 decisions + audit).
- **FR4** — Copilot dock: ask → grounded answer; for ward-state answers, the
  referenced beds are **highlighted** on the grid.
- **FR5** — Nav trimmed: Ward + Actions (+ Settings); copilot/briefing reachable
  from the board (standalone routes may remain but are secondary).

### Non-functional

- **NFR1 — Board stays fast.** Per-bed recommendations + forecasts load with the
  board in **one cheap pass** (one DB query + one local forecast call, no NIM).
  The narrated briefing (the only NIM call) loads **async** and never blocks the
  grid.
- **NFR2 — No regressions.** All v0.2–v0.5 behaviour and eval gates unchanged.
- **NFR3 — Accessible.** Drawer/dock are keyboard-navigable with visible focus.

## Acceptance criteria

- [x] Board shows the briefing strip (async) + per-bed action badges + discharge %.
- [x] Bed drawer unifies barriers/citations + recommendations (approve/dismiss) +
      forecast; approving updates the barrier and the board.
- [x] Copilot dock answers and highlights referenced beds on the grid.
- [x] Nav trimmed; no dead ends; local gate green; existing evals still pass.

## Security & privacy

No new data or endpoints. Same auth/RBAC boundary; approvals still write an audit
row attributed to the user. Copilot/actions remain read-only except the existing
approve path.

## Alternatives considered

- **Leave four tabs** — simplest, but the fragmentation is the problem.
- **Merge everything onto one page incl. streaming copilot** — more than needed;
  keep the async briefing + docked copilot pragmatic.

## Out of scope / future

- Real-time updates (websockets/push), drag-to-reassign beds, multi-ward house
  view, streaming copilot.

## References

- [WardBeat PRD](../../../docs/prd.md) — §6 (capabilities E1–E7), §7.6 (experience
  plane). Consolidates releases v0.2.0–v0.5.0.
