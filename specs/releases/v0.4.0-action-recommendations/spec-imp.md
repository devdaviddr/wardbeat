---
release: v0.4.0
title: Action recommendations — implementation plan
status: Shipped # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/v0.4.0-action-recommendations
created: 2026-07-27
updated: 2026-07-27
---

# v0.4.0 — Action recommendations · implementation plan

> **spec-imp.md = the plan (how).** Living document. Implements
> [`spec.md`](spec.md).

## Approach

A retrieve-then-reason **agent**: for each MFFD-but-delayed patient, Next.js
retrieves policy for the barrier (reusing v0.3.0's pgvector search), then calls a
stateless FastAPI `/agent/recommend` that reasons about the next-best action per
barrier and cites the policy. Recommendations persist as `proposed`; the **action
queue** UI is the human-in-the-loop gate — Approve/Dismiss writes status + audit.
No external side effects.

## Architecture deltas

| Area               | Change                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres**       | New `recommendations` + `action_audit` tables (Drizzle migration)                                                                                                                                                      |
| **FastAPI (`ai`)** | `/agent/recommend` — barriers + retrieved policy → actions w/ rationale + citation (LLM + mock). Stateless                                                                                                             |
| **Next.js**        | Generate-recommendations action (retrieve policy per barrier → recommend → persist); action-queue read model; approve/dismiss server actions (status + barrier + audit); `/actions` page + nav; `FEATURE_ACTIONS` flag |
| **Reuse**          | v0.3.0 policy retrieval (`lib/copilot/policy` search) as the agent's tool                                                                                                                                              |

## Work breakdown (milestones)

- **M1 — Schema + recommender.** `recommendations` / `action_audit` tables +
  migration. FastAPI `/agent/recommend` (per-barrier action + rationale + policy
  citation; deterministic mock mapping barrier→action).
- **M2 — Generate + persist.** Next.js: for MFFD-delayed beds, retrieve policy per
  barrier, call `/agent/recommend`, persist `proposed` recommendations
  (idempotent: replace only still-`proposed`). Action-queue read model.
- **M3 — Action queue UI + HITL.** `/actions` page grouped by bed; Approve
  (→ barrier `in_progress`, recommendation `approved`, audit) / Dismiss
  (→ `dismissed`, audit). Nav + flag. Board reflects updated barrier status.
- **M4 — Eval + release.** Action-appropriateness + grounded-rate eval
  (`pnpm eval:actions`); docs (DEMO/README/PRD roadmap); CHANGELOG; PR → merge →
  tag `v0.4.0`.

## Data model & migrations

- `recommendations(id, encounter_id, barrier_id, action_type, title, rationale,
priority, policy_citation jsonb, grounded bool, status: proposed|approved|
dismissed, created_at)`
- `action_audit(id, recommendation_id, decision: approved|dismissed,
actor_user_id, note, created_at)`

`action_type` ∈ chase_tto | book_transport | arrange_social_care |
escalate_review | other.

## Interfaces & contracts

FastAPI (`ai`), `X-Service-Token` gated:

| Method | Path               | Purpose                                                                                                                                                                 |
| ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/agent/recommend` | `{patient_label, barriers:[{id,type,quote}], policy:[{text}]}` → `{recommendations:[{barrier_id, action_type, title, rationale, priority, citations:[int], grounded}]}` |

## Test & evaluation plan

- **Unit** — audit/approve state transitions; idempotent regeneration.
- **AI eval** (`pnpm eval:actions`) — for labelled barriers, recommended
  `action_type` matches the expected mapping (**appropriateness ≥ 0.9**) and the
  rationale is **grounded ≥ 0.9**.
- **Safety** — approving performs no external call; injection in a barrier/policy
  passage doesn't change behaviour.

## Rollout & deployment

`FEATURE_ACTIONS` flag; new env none beyond existing NIM. Regenerate via a button
on the action queue (and/or `pnpm db:recommend` headless helper). Rate budget: one
retrieve + one reason per patient; reuse token-bucket + embedding cache.

## Risks / unknowns / spikes

| Risk                                    | Plan                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Recommendation drifts from barrier type | Constrain `action_type` to an allow-list; validate server-side; eval appropriateness |
| Ungrounded rationale                    | Flag (not hide); grounded-rate eval gate                                             |
| Regeneration clobbering decided items   | Only replace `proposed`; preserve approved/dismissed                                 |
| Rate-limit fan-out across the ward      | Sequential; cache query embeddings; small demo ward                                  |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [ ] Action eval gates met (appropriateness, grounded-rate).
- [ ] `docker compose up` clean; `.env.example` + env schema updated.
- [ ] `CHANGELOG.md` + docs updated; merged to `main`; `v0.4.0` tagged; specs `Shipped`.

## Task checklist

- [x] M1 — schema + migration + `/agent/recommend`
- [x] M2 — generate + persist recommendations (agent uses policy retrieval)
- [x] M3 — action queue UI + approve/dismiss + audit + nav/flag
- [x] M4 — eval + docs + release

## Progress (2026-07-27) — Shipped

Built and verified live: **action-appropriateness 100%, policy-grounded 100%**
(`pnpm eval:actions`, gate 0.9); 11 grounded recommendations generated for 7
patients; approve/dismiss write barrier status + audit. Local gate green. The
recommender is a single retrieve-then-reason step (LangGraph deliberately not
adopted for this slice — recorded in `spec.md` alternatives).
