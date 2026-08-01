---
release: v0.4.0
title: Action recommendations (agentic, human-in-the-loop)
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
release_tag: v0.4.0
phase: Phase 3 — Agents
created: 2026-07-27
updated: 2026-07-27
supersedes: '—'
---

# v0.4.0 — Action recommendations (agentic, human-in-the-loop)

> **spec.md = the contract (what & why).** The _how_ and the task plan live in
> [`spec-imp.md`](spec-imp.md).

## Summary

Turn the board's **barriers** into **recommended next-best actions** — "chase TTOs
with pharmacy", "book patient transport", "escalate the cardiology review" — each
with a **rationale grounded in the discharge policy**, surfaced in an **action
queue** where a human **approves or dismisses** every one. Nothing acts
automatically: approving records the decision, marks the barrier in progress, and
writes an **audit** entry. This is Phase 3 of the [PRD](../../../docs/prd.md)
(§7.4 agents, E5 action recommendations).

The recommender is a small **agent**: for a patient's barriers it **retrieves the
relevant policy** (the v0.3.0 RAG path, used as a tool) and then reasons about the
best action — so recommendations are justified by policy, not invented.

## Problem / motivation

The board shows _what's_ blocking discharge; a bed manager still has to decide
_what to do_ about each barrier and chase it. Recommending the next action —
grounded in policy and queued for a human — compresses that decision and makes it
auditable, without ever letting the model act on its own.

## Goals

- For each MFFD-but-delayed patient, recommend a next-best action **per barrier**,
  with a plain-language rationale and a **policy citation**.
- An **action queue** grouped by bed; each recommendation has **Approve** /
  **Dismiss**.
- **Human-in-the-loop, recommend-only**: approving marks the barrier
  `in_progress` and writes an audit record; dismissing records the decision.
  No external side effects.
- **Evaluated**: recommendations map to the right action for the barrier type and
  are policy-grounded; audit records are correct.

## Non-goals

- Executing real actions (calling pharmacy/transport systems). Recommend-only.
- Autonomous decisions. Forecasting (v0.5.0). Multi-step tool chains beyond the
  single policy-retrieval tool.

## Scope / user-visible outcome

A user opens **Actions**, sees recommendations grouped by bed ("Bed A1 — chase
TTOs with pharmacy · because TTOs must be dispensed before discharge [policy]"),
and clicks **Approve** (barrier → in progress, logged) or **Dismiss** (logged).
The board reflects the updated barrier status.

## Requirements

### Functional

- **FR1** — Generate recommendations for occupied, MFFD beds with open barriers;
  one recommendation per open barrier, with `action`, `rationale`, `priority`,
  and a policy citation.
- **FR2** — The recommender retrieves policy (RAG) for the barrier before
  reasoning, and cites it. Ungrounded rationale → the recommendation still shows
  but is flagged "no policy support".
- **FR3** — Action queue UI grouped by bed; **Approve** and **Dismiss** per item.
- **FR4** — Approve: recommendation `approved`, its barrier `in_progress`, an
  `action_audit` row (actor, decision, timestamp). Dismiss: `dismissed` + audit.
- **FR5** — Idempotent regeneration: re-running replaces only still-`proposed`
  recommendations; approved/dismissed history is preserved.

### Non-functional

- **NFR1 — Recommend-only / safety.** No external side effects; approving only
  updates internal barrier status + audit. RBAC + auth boundary unchanged.
- **NFR2 — Grounded.** Rationales cite policy; ungrounded ones are flagged.
- **NFR3 — Rate limit.** One retrieve + one reason call per patient; reuse the
  token-bucket + embedding cache. Sequential over the ward.
- **NFR4 — Eval gate.** Action-appropriateness ≥ 0.9 and grounded-rate ≥ 0.9 on a
  labelled set.

## Acceptance criteria

- [x] Recommendations generated per open barrier with action + rationale + policy
      citation; ungrounded flagged.
- [x] Action queue lists them by bed with Approve / Dismiss.
- [x] Approve/Dismiss update status + barrier + write audit; board reflects it.
- [x] Regeneration preserves decided history.
- [x] Eval: action-appropriateness + grounded-rate gates met; offline mock works.

> **Post-release verification (2026-08-01).** All criteria met as written. Three
> issues found later that these criteria did not cover: the approve path's three
> writes are **not transactional** and its status check is a TOCTOU, so concurrent
> approvals can write two audit rows (fixed in
> [v0.10.0 NFR1](../v0.10.0-close-the-loop/spec.md)); approving a barrier sets it
> `in_progress` but a **re-extraction wipes that state** (v0.10.0 FR1); and the
> grounded-rate gate is unfalsifiable — `grounded` is set from citation count
> alone, never checked against the rationale, and the mock always emits a citation
> (owned by [v0.11.0](../v0.11.0-trustworthy-numbers/spec.md)). The standalone
> action queue was later folded into the board in v0.7.0.

## Security & privacy

Synthetic data only. The agent is **recommend-only** — it cannot call anything
external; the only writes are internal barrier-status changes and audit rows made
**by an authenticated human's approval**. Retrieved policy + barrier text are
untrusted input (no instruction-following). Every decision is attributable via the
audit table.

## Alternatives considered

- **Auto-action (no human)** — rejected: unsafe and out of scope; clinical actions
  must have a human decision.
- **Full LangGraph multi-agent** — heavier dependency than this slice needs; a
  single retrieve-then-reason step delivers the value. Revisit if multi-step
  planning is required.
- **Rule-based mapping (no LLM)** — simple but can't justify with policy or handle
  nuance; the agent grounds each recommendation.

## Out of scope / future

- **v0.5.0** — forecasting (LOS/demand) + narration.
- Real integrations (pharmacy/transport), multi-step planning, SLA timers.

## References

- [WardBeat PRD](../../../docs/prd.md) — §7.4 (agents), E5 (action recommendations).
- Prior releases [v0.2.0](../v0.2.0-barrier-intelligence-ward-board/spec.md),
  [v0.3.0](../v0.3.0-flow-copilot/spec.md) (reuses the policy-RAG retrieval).
