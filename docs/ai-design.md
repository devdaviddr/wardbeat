[← Back to README](../README.md)

# AI design

How WardBeat uses AI: the two-plane topology, the four AI capabilities, and the
guardrails that make the output trustworthy — grounding, provenance, a strict
deterministic-vs-LLM boundary, and human approval on every action.

**Design principles**

1. **Decision support, not autonomy.** The AI proposes; a human approves,
   dismisses, or overrides. Nothing acts on an external system.
2. **Grounded or refused.** Every claim is traceable to a source (a note
   sentence, a policy passage) or it is dropped/refused — never asserted.
3. **Honest numbers.** All figures come from deterministic code. The LLM
   narrates numbers; it never computes or invents them. A figure that can't be
   computed honestly is omitted with a reason, not defaulted.
4. **Measured, not assumed.** Quality is scored by eval harnesses with hard
   gates ([Evals](evals.md)), and those gates refuse to score mock output.

---

## Topology: two planes, one front door

The browser only ever talks to **Next.js** — UI, auth, sole database writer,
and sole AI orchestrator. The **AI plane** (`ai/`) is a stateless, internal
FastAPI service (Python 3.12) that wraps model calls: it has no database, no
session, and no browser ingress.

```
Browser ──► Next.js 16 (BFF)                    ──► PostgreSQL 17 + pgvector
              │  server-only client (src/lib/ai/client.ts)
              │  x-service-token · 45 s timeout · Zod-parsed responses
              ▼
            FastAPI AI plane (ai/, internal :8000)
              │  token auth (fail-closed) · token-bucket rate limit (~30 RPM)
              ▼
            NVIDIA NIM (OpenAI-compatible API) — or deterministic mocks
```

- **Service auth fails closed** (`ai/app/security.py`): with no
  `AI_SERVICE_TOKEN` configured the plane returns 503 on every request.
  Tokenless local dev requires an explicit `AI_ALLOW_INSECURE_NO_TOKEN=true`,
  which logs a loud startup warning. Tokens are compared with
  `hmac.compare_digest`.
- **Responses are validated, not cast**: `src/lib/ai/client.ts` Zod-parses
  every response, including a mandatory provenance envelope — a service that
  stops sending provenance fails loudly rather than rendering as trustworthy.
- **Retrieval lives in Next.js**: pgvector similarity search runs in the BFF;
  the AI plane provides model primitives only (embed, rerank, generate).

### Models (NVIDIA NIM)

| Role       | Model                                | Used for                                                         |
| ---------- | ------------------------------------ | ---------------------------------------------------------------- |
| Generation | `nvidia/nvidia-nemotron-nano-9b-v2`  | Extraction, routing, copilot answers, recommendations, narration |
| Embedding  | `nvidia/nv-embedqa-e5-v5` (1024-dim) | Policy RAG embeddings (asymmetric query/passage)                 |
| Reranking  | `nvidia/llama-3.2-nv-rerankqa-1b-v2` | Reordering retrieved policy passages                             |

With `NIM_MOCK=true` (the default) — or no `NVIDIA_API_KEY` — every capability
runs on **deterministic offline mocks**: no key, no network, and the mock is
also the automatic fallback when a live call fails. See
[`ai/README.md`](../ai/README.md) for the full endpoint and env reference.

### Endpoints

`GET /healthz` · `GET /config` (token-gated, secrets as presence booleans) ·
`POST /extract` · `POST /embed` · `POST /copilot/route` ·
`POST /copilot/query-intent` · `POST /copilot/rerank` ·
`POST /copilot/answer` · `POST /agent/recommend` ·
`POST /forecast/discharge` · `POST /forecast/demand` · `POST /forecast/narrate`

---

## The four AI capabilities

### 1. Barrier extraction from clinical notes

The core loop. A ward-wide Server Action
(`src/lib/ward/actions.ts`) fans each patient note out to `POST /extract`
(bounded concurrency, per-note failure isolation, 45 s per call, single-flight
lock so concurrent runs are refused). The model is prompted with a strict JSON
schema — `{ mffd, edd, barriers[], escalations[] }`, barrier types limited to
`tto / transport / social_care / review / other` — and the note is framed as
**data to read, never instructions to follow** (prompt-injection defence).

A **grounding gate** (`ai/app/extract/grounding.py`) then re-locates every
barrier's quoted evidence in the note (exact match, then fuzzy at ≥ 0.75
similarity) and **drops anything it cannot locate**. The board only ever shows
cited findings; clicking a barrier chip reveals the highlighted source
sentence.

Persistence is a **reconcile, not a replace**
(`src/lib/ward/reconcile.ts`): re-extraction refreshes AI-derived fields in
place and never touches human state — owners, due times, progress threads, and
approvals survive; barriers no longer supported by the notes are marked
unconfirmed rather than deleted; dismissed barriers are suppressed by
fingerprint so a re-run cannot resurrect them; clinician-authored barriers
(`origin='human'`) are invisible to reconciliation entirely.

### 2. Flow copilot (grounded Q&A)

`src/lib/copilot/actions.ts` authorizes, rate-limits, and audits the question,
then routes it (`POST /copilot/route`):

- **Ward-state questions** → `POST /copilot/query-intent` returns a validated,
  allow-listed **structured filter** that Next.js applies to the live board in
  memory. The model never authors a query — there is no NL-to-SQL anywhere.
  A malformed intent produces a refusal, not "list every bed".
- **Policy questions** → RAG over the discharge-policy knowledge base: embed
  the query → pgvector HNSW cosine search (top 8) → rerank (top 4) → a cited
  answer or an explicit refusal.

Citations link back to real passages; **Open source** shows the full policy
document with the cited passage highlighted (`src/lib/ward/policy-source.ts`).
Each stored chunk records the model that embedded it — if the configured
embedding model has drifted from the stored one, the copilot **refuses and
says why** rather than searching a skewed vector space.

### 3. Action recommendations (agentic, human-in-the-loop)

A retrieve-then-reason agent (`src/lib/actions/generate.ts` →
`POST /agent/recommend`) turns each open barrier into a next-best action —
chase the TTO, book transport, arrange social care, escalate a review — with a
rationale grounded in retrieved policy. Its system prompt states the contract:
_"You recommend only — a human approves every action."_

Recommendations persist as `proposed` with per-row provenance and policy
citations. Approving one (`src/lib/actions/decide.ts`) marks the barrier in
progress, optionally delegates it (owner + due time) in the same step, and
writes an `action_audit` row — all inside a row-locked transaction, so a
double-approve returns "Already approved" instead of corrupting the audit
trail. **Nothing acts externally, ever.**

### 4. Forecasting and narration ("ML predicts, LLM narrates")

Discharge probability, predicted days-to-discharge, demand projection, and net
bed position are computed by **deterministic, interpretable code**
(`ai/app/forecast.py`, `src/lib/briefing/`) — a monotone logistic model with
readable weights and a trailing-7-day admission rate. No LLM touches a number.

The LLM's only job is `POST /forecast/narrate`: turning those figures into a
one-paragraph flow briefing. Its prompt forbids inventing values, and figures
that can't be computed honestly (e.g. fewer than 7 admissions in the window)
are **omitted from the payload entirely** with a stated reason — the UI shows
"Unavailable", never a fabricated number.

---

## Provenance: live, mock, fallback

Every AI response carries a provenance envelope stamped at the source
(`ai/app/provenance.py`) and enforced at the boundary
(`src/lib/ai/provenance.ts`):

- **`live`** — a real model produced this. Only `live` output may show the
  green "grounded" badge.
- **`mock`** — the deterministic offline stub produced this.
- **`fallback`** — a live call failed and the mock stood in; rendered as a
  visually distinct warning badge, and the failure is logged with its
  exception type.

Provenance is combined pessimistically (weakest link wins), persisted per
recommendation row so it outlives the batch, and surfaced in the copilot,
recommendation cards, and the briefing (`provenance-badge.tsx`). The same
mechanism gates the eval harnesses: `src/eval/provenance-guard.ts` refuses to
print a score unless every response in the run was `live` (overridable only by
an explicit `--allow-mock` CLI flag that prints a disclaimer).

## The model-call harness

Every model call passes through the same defensive layers:

| Layer                | Mechanism                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Authorization        | `requireWardAccess()` before any AI budget is spent                                                                   |
| Per-user rate limits | copilot 6/min · briefing 6/5 min · generation 2/10 min (`src/lib/rate-limit.ts`), sized against the shared NIM budget |
| Service rate limit   | async token bucket in the AI plane (`NIM_RPM`, default 30) — non-bypassable                                           |
| Timeouts             | 45 s Next.js → AI plane · 30 s AI plane → NIM                                                                         |
| Structured output    | `temperature=0`, JSON response format, schema-constrained prompts                                                     |
| Validation           | Pydantic in the AI plane, Zod in Next.js — both sides, never cast                                                     |
| Allow-lists          | Barrier types, action types, and filter keys coerced to fixed vocabularies; model-authored field names never trusted  |
| Grounding            | Quotes re-located in source text; unlocatable claims dropped                                                          |
| Fallback             | Deterministic mock on any live failure, labelled `fallback`                                                           |

Degradation is per-call, never fatal: the app boots and serves the board from
Postgres with the AI plane down; extraction isolates per-note failures and
reports `(N failed)`; the reranker backs off for 15 minutes on a 404 (with
cosine-order fallback) instead of degrading for the process lifetime; the
Settings card shows "Unreachable" rather than failing the page.

## Access, audit, and retention

- AI-backed actions sit behind ward-membership authorization
  (`requireWardAccess`, fail-closed) and per-user rate limits — checked before
  any write and before rate budget is consumed.
- Copilot questions, extraction runs, and board/patient views are recorded in
  an **append-only access audit** (`access_audit`), browsable by admins at
  `/settings/audit`.
- Raw model output (`ai_extractions.raw_json`) is retained for audit and
  purged beyond `AI_RAW_RETENTION_DAYS` (default 30; opportunistic — there is
  no scheduler in this deployment).
- Admins see the effective AI configuration at **Settings → AI configuration**
  — live vs mock, the three model IDs, endpoint host, operational limits, and
  credential _presence_ (never values) — read from the token-gated
  `GET /config` so the UI cannot drift from reality.

## Evaluation

Four harnesses with hard gates, run against live NIM (see [Evals](evals.md)
for datasets, metrics, and honest caveats about the small n):

| Harness                                                                 | Gate             | Last live score |
| ----------------------------------------------------------------------- | ---------------- | --------------- |
| `pnpm eval:extraction` — barrier F1, MFFD accuracy                      | F1 ≥ 0.85        | 88% F1          |
| `pnpm eval:copilot` — retrieval hit-rate, groundedness, intent accuracy | ≥ 0.90           | 100/100/100     |
| `pnpm eval:actions` — appropriateness, policy-grounding                 | ≥ 0.90           | 100/100         |
| `pnpm eval:forecast` — discharge Spearman ρ, narration consistency      | ρ ≥ 0.70, ≥ 0.90 | passes          |

## Known gaps

Tracked in the [roadmap](roadmap.md): no NeMo Guardrails layer yet, no
streaming (copilot answers in one shot), no metrics/tracing (structured logs
only — see [Monitoring](monitoring.md)), read-only AI configuration, tiny eval
datasets, and eval gates not yet wired into CI. The
[PRD](prd.md) §7 describes the _target_ reference architecture (LangGraph,
Guardrails, model tiering); this document describes what is **shipped**.

---

**See also:** [`ai/README.md`](../ai/README.md) (service reference) ·
[Evals](evals.md) · [Monitoring](monitoring.md) ·
[Architecture](architecture.md) · in-app AI guide at `/about/ai`
