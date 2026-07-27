---
release: v0.3.0
title: Flow copilot — implementation plan
status: Shipped # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/v0.3.0-flow-copilot
created: 2026-07-27
updated: 2026-07-27
---

# v0.3.0 — Flow copilot · implementation plan

> **spec-imp.md = the plan (how).** Living document — update as work proceeds. Implements
> the contract in [`spec.md`](spec.md).

## Progress (2026-07-27) — Shipped

**Built and verified live** (NIM): policy RAG **retrieval hit-rate 100%**,
**grounded 100%**; ward-state **query-intent accuracy 100%** (`pnpm eval:copilot`,
gate 0.9). Router classifies ward/policy/out-of-scope correctly. `pnpm build`
green.

Conscious deviations (recorded — the plan is the living doc):

- **Retrieval orchestrated in Next.js, FastAPI stays stateless.** The pgvector
  cosine search runs in Next.js (Drizzle); FastAPI provides pure `/embed`,
  `/copilot/{rerank,answer,query-intent,route}` functions. Preserves the
  single-DB-writer invariant from v0.2.0.
- **Reranker falls back to cosine order.** The hosted reranking NIM 404s on the
  free tier; the `/copilot/rerank` interface + logged fallback are in place and
  flip on with an on-prem/available reranker.
- **Answers are non-streaming (SSE deferred).** Answers are short (1–3
  sentences); streaming is a polish item, not core to the slice.

## Approach

Add a retrieval plane and a copilot on top of the v0.2.0 board. Reuse the stateless
FastAPI `ai` service and the mock↔live pattern. A single `/copilot` call **routes** the
question, then either (a) returns a **validated query intent** the Next.js BFF executes
read-only via Drizzle, or (b) runs **policy RAG** (embed → pgvector ANN → rerank → answer).
Structured retrieval for structured data; vector RAG only for the policy corpus.

## Architecture deltas

Refs [PRD §7.3–§7.4](../../../docs/prd.md).

| Area               | Change                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres**       | Switch dev image to `pgvector/pgvector:pg17`; migration enables the `vector` extension; new `policy_docs` + `policy_chunks` (with a `vector` column) tables      |
| **FastAPI (`ai`)** | Embedding + reranking NIM clients; policy retrieval; router; query-intent generation; `/copilot` endpoint (streaming). Extends the existing token-bucket harness |
| **Next.js**        | `/copilot` chat UI (streaming), a validated query-intent executor over the ops DB (allow-listed filters), citation rendering, nav entry                          |
| **Data / seed**    | Synthetic discharge-policy docs; an embedding/ingestion script; a labelled copilot eval set                                                                      |
| **Infra**          | No new container — retrieval lives in the existing `ai` service; new NIM_* model envs (embed + rerank)                                                           |

## Work breakdown (milestones)

- **M1 — pgvector + policy KB.** Swap the db image, `vector` extension migration,
  `policy_docs`/`policy_chunks` schema; synthetic policy docs; an ingestion script that
  chunks + embeds via the **embedding NIM** (`nvidia/llama-nemotron-embed-1b-v2`, 2048-d)
  and writes vectors. Mock embeddings (hash-based) when `NIM_MOCK`.
- **M2 — Policy RAG path.** FastAPI: embed query → pgvector cosine ANN (top-K) → **rerank
  NIM** (verify hosted endpoint; else embedding-only, logged) → LLM grounded answer with
  passage citations. Refuse on weak retrieval.
- **M3 — Ward-state Q&A path.** LLM emits a constrained query intent (allow-listed
  fields/filters); Next.js validates + executes read-only via Drizzle; LLM composes a
  grounded answer citing bed/patient/barrier records.
- **M4 — Router + copilot UI.** Question classifier (`ward_state|policy|out_of_scope`);
  `/copilot` streaming (SSE) endpoint; Next.js chat page + nav; citation chips that link
  back to the board.
- **M5 — Eval + release.** Retrieval hit-rate, answer faithfulness, query-intent accuracy
  (gates); docs (DEMO + README); CHANGELOG; PR → merge → tag `v0.3.0`.

## Data model & migrations

Drizzle owns migrations. New tables:

- `policy_docs(id, title, source, created_at)`
- `policy_chunks(id, doc_id, ordinal, text, embedding vector(2048), created_at)` — cosine
  index (ivfflat/hnsw) on `embedding`.

The `vector` column uses a Drizzle custom type mapping to pgvector; the extension is
enabled in the first migration of this release.

## Interfaces & contracts

FastAPI (`ai`), `X-Service-Token` gated:

| Method | Path       | Purpose                                                                         |
| ------ | ---------- | ------------------------------------------------------------------------------- |
| POST   | `/embed`   | batch embed chunks (used by the ingestion script)                               |
| POST   | `/copilot` | `{question, ward_snapshot?}` → routed, grounded answer + citations (SSE stream) |

`CopilotAnswer`: `{ path: "ward_state|policy|out_of_scope", answer, citations: [...], grounded }`.
For ward-state, FastAPI returns a `query_intent` for Next.js to execute, then a follow-up
composes the answer from the rows (two-hop), OR Next.js passes the executed rows back in
`ward_snapshot`. (Decide in M3; favour the app executing the query — single DB writer.)

## Test & evaluation plan

- **Unit** — query-intent validation (rejects non-allow-listed fields); chunker; router.
- **AI eval** — labelled question set: policy **retrieval hit-rate ≥ 0.9**, **faithfulness
  ≥ 0.9**; ward-state **query-intent accuracy ≥ 0.9**. `pnpm eval:copilot`.
- **Safety** — injection in a question or a retrieved passage must not change behaviour;
  out-of-scope refused.

## Rollout & deployment

New env (`.env.example` + `src/lib/env.ts` where the app needs them; ai service envs in
compose): `NIM_EMBED_MODEL`, `NIM_RERANK_MODEL`. pgvector image swap documented in
DEMO.md. Feature flag `FEATURE_COPILOT`. Rate-limit budget: one turn = 1 embed + 1 rerank

- 1–2 LLM calls; cache query embeddings.

## Risks / unknowns / spikes

| Risk / unknown                        | Plan                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hosted reranker not on free tier      | Verify in M2; fall back to embedding-only top-N (logged), keep the rerank interface           |
| pgvector image / extension setup      | Pin `pgvector/pgvector:pg17`; enable extension in migration; verify `docker compose up` clean |
| Query-intent expressiveness vs safety | Start with a small allow-listed filter grammar covering the demo questions; widen as needed   |
| Embedding dim / index tuning          | 2048-d, cosine; start with a flat/ivfflat index on the small KB                               |
| Rate-limit fan-out per turn           | Cache embeddings; sequential calls; reuse token-bucket                                        |

## Definition of Done

- [x] All `spec.md` acceptance criteria met (SSE streaming deferred by design).
- [x] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [x] Copilot eval gates met — hit-rate 100%, grounded 100%, query-intent acc 100% (gate 0.9).
- [x] `docker compose up` clean from scratch (pgvector); `.env.example` + env schema updated.
- [x] `CHANGELOG.md` + docs updated; merged to `main`; `v0.3.0` tagged; specs `Shipped`.

## Task checklist

- [x] M1 — pgvector infra + schema + policy KB + embedding ingestion
- [x] M2 — policy RAG path (embed → ANN → rerank → grounded answer)
- [x] M3 — ward-state Q&A path (query intent → validated filter → grounded answer)
- [x] M4 — router + copilot UI + nav (SSE streaming deferred)
- [x] M5 — eval harness + docs + release
