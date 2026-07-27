---
release: v0.3.0
title: Flow copilot — ward-state Q&A + policy RAG
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
release_tag: v0.3.0
phase: Phase 2 — Retrieval
created: 2026-07-27
updated: 2026-07-27
supersedes: '—'
---

# v0.3.0 — Flow copilot (ward-state Q&A + policy RAG)

> **spec.md = the contract (what & why).** The _how_ and the task plan live in
> [`spec-imp.md`](spec-imp.md).

## Summary

A natural-language **copilot** in the app. A lightweight **router** classifies each
question and answers it through one of two **grounded** paths:

1. **Ward-state Q&A** — "which patients are fit but waiting on transport?", "how many
   beds are free?" → the model emits a **validated, read-only query intent** over a fixed
   schema; the app runs it via Drizzle and the model composes an answer that **cites the
   specific beds/patients/barriers**.
2. **Policy RAG** — "what are the discharge criteria for a patient on IV antibiotics?" →
   **document retrieval** over a discharge-policy knowledge base using the NeMo Retriever
   pipeline (**embedding NIM → pgvector ANN → reranking NIM → LLM**), answered with
   **citations to the policy passages**.

This is Phase 2 of the [PRD](../../../docs/prd.md): it adds the retrieval plane
(§7.3) and the query agent (§7.4) on top of the v0.2.0 board, and — critically —
uses the **right retrieval for each data shape**: structured query for the structured
ward data, vector RAG for the unstructured policy text.

## Problem / motivation

The v0.2.0 board makes ward state legible, but answering a question still means scanning
it by eye, and the _rules_ behind a discharge decision (trust policy, criteria) live in
documents nobody has time to search. A grounded copilot turns both into a question you
can just ask — without inventing answers.

## Goals

- A copilot chat surface (own page + entry from the board) with **streaming** answers.
- A **router** that sends each question to ward-state, policy, or a polite refusal.
- **Ward-state answers cite live records** (bed labels, patient, barrier) pulled from a
  read-only structured query — never free-form SQL.
- **Policy answers cite the source passage** retrieved via embedding + reranking NIMs
  over pgvector; answers with insufficient support are refused, not hallucinated.
- **Evaluated**: retrieval hit-rate + answer faithfulness (policy); query-intent accuracy
  (ward-state).

## Non-goals

- Agents / action recommendations / write operations (v0.4.0) — the copilot is read-only.
- Forecasting (v0.5.0).
- Free-form/raw SQL from the model. Multi-session memory. Real patient data.

## Scope / user-visible outcome

A signed-in user opens **Copilot**, types a question, and gets a streamed, grounded
answer. Ward-state answers link to the beds they reference (jump back to the board);
policy answers show the cited policy section. Out-of-scope questions get a clear "I can
only answer about this ward's state and discharge policy."

## Requirements

### Functional

- **FR1** — Router classifies a question as `ward_state | policy | out_of_scope`.
- **FR2 (ward-state)** — The model emits a **constrained query intent** (allow-listed
  fields/filters, not SQL); the app validates and executes it read-only via Drizzle; the
  model composes a grounded answer citing the returned records.
- **FR3 (policy)** — A seeded discharge-policy KB is chunked and embedded (embedding NIM)
  into pgvector; a query is embedded, ANN-retrieved (top-K), **reranked** (rerank NIM) to
  top-N, and answered by the LLM with passage citations.
- **FR4** — Answers stream to the UI; each answer carries its citations.
- **FR5** — Insufficient grounding → an explicit "I don't have enough to answer that",
  never a guess.

### Non-functional

- **NFR1 — Right tool per data shape.** Structured retrieval for ward data; vector RAG
  only for the unstructured policy corpus. (No vector search over structured rows.)
- **NFR2 — Safety.** Read-only; allow-listed query fields; questions and retrieved text
  are untrusted (no instruction-following); RBAC + auth boundary unchanged.
- **NFR3 — Rate limit.** Respect the free tier (~40 RPM) across the embed + rerank + LLM
  fan-out of a single turn: cache embeddings, reuse the token-bucket harness.
- **NFR4 — Eval gates.** Policy retrieval hit-rate ≥ 0.9 on a labelled question set;
  answer faithfulness ≥ 0.9; ward-state query-intent accuracy ≥ 0.9.

## Acceptance criteria

- [ ] pgvector enabled; policy KB seeded, chunked, and embedded via the embedding NIM.
- [ ] `/copilot` routes questions; ward-state path returns grounded answers citing live
      beds/patients/barriers via a validated read-only query.
- [ ] Policy path retrieves → reranks → answers with passage citations; degrades to
      embedding-only if the hosted reranker is unavailable (logged, not silent).
- [ ] Copilot chat UI streams answers and shows citations; out-of-scope is refused.
- [ ] Eval harness: retrieval hit-rate, faithfulness, and query-intent accuracy reported
      with gates.
- [ ] Offline mock path works with zero external calls; live NIM path verified.

## Security & privacy

Synthetic data only. The copilot is **read-only** — the model never receives write access
and never emits SQL; it emits a query _intent_ the app validates against an allow-list.
Questions and retrieved passages are treated as untrusted input (extraction/answering, not
instruction-following). Auth/RBAC and the internal-only AI boundary are unchanged.

## Alternatives considered

- **Vector-RAG over ward state too** — simpler-sounding, but wrong: the ward data is
  structured, so embedding rows loses precision and invites hallucinated aggregates.
  Structured query is both more accurate and auditable.
- **Text-to-raw-SQL** — flexible but unsafe (injection, accidental writes, unbounded
  queries). A constrained query intent is safer and still expressive enough.
- **Skip reranking** — cheaper, but reranking is what separates "related" from "relevant";
  kept, with a logged embedding-only fallback if the free tier lacks it.

## Out of scope / future

- **v0.4.0** — agents that turn a copilot finding into a recommended action (HITL).
- **v0.5.0** — forecasting + narration.

## References

- [WardBeat PRD](../../../docs/prd.md) — §7.3 (retrieval), §7.4 (query agent), §7.9 (model
  tiering).
- Prior release [v0.2.0](../v0.2.0-barrier-intelligence-ward-board/spec.md).
- NVIDIA NIM catalogue — <https://build.nvidia.com/models>
