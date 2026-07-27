# WardBeat AI plane (`ai/`)

Internal **FastAPI** service — the Python AI plane from the
[PRD §7.10](../docs/prd.md). It is the whole AI toolbox behind the Next.js app:
**barrier extraction**, **embeddings**, the **flow copilot** (RAG over discharge
policy), the **recommendation agent**, and **forecasting + narration** — all over
**NVIDIA NIM** (OpenAI-compatible), with a deterministic offline mock fallback.

**Stateless and internal-only.** It holds no database (Next.js is the sole DB
writer and the orchestrator) and is called **server-side only** by the Next.js
BFF, never the browser. Every endpoint except `/healthz` requires the shared
`X-Service-Token`. Each capability grounds/validates its output and degrades to a
deterministic mock if a model call fails, so an endpoint always returns a usable
result.

See also: [Evals](../docs/evals.md) (how the models are tested) ·
[Monitoring](../docs/monitoring.md) (runtime signals) · the in-app
[product guide](../docs/guide.html).

## Endpoints

All require `X-Service-Token` except `/healthz`. OpenAPI/Swagger at `/docs` when
running.

| Method | Path                    | Purpose                                                              | Model           |
| ------ | ----------------------- | -------------------------------------------------------------------- | --------------- |
| GET    | `/healthz`              | Liveness + which backend (mock/live) + model id                      | —               |
| GET    | `/config`               | Non-sensitive config for the Settings view (secrets → presence only) | —               |
| POST   | `/extract`              | Note text → grounded barriers, EDD, MFFD flag                        | Nemotron (JSON) |
| POST   | `/embed`                | Texts → vectors (asymmetric query/passage)                           | nv-embedqa      |
| POST   | `/copilot/route`        | Classify a question: ward-state / policy / out-of-scope              | Nemotron        |
| POST   | `/copilot/query-intent` | Ward question → a validated structured filter (never SQL)            | Nemotron        |
| POST   | `/copilot/rerank`       | Reorder retrieved passages by relevance                              | nv-rerankqa     |
| POST   | `/copilot/answer`       | Compose a cited answer from passages, or refuse                      | Nemotron        |
| POST   | `/agent/recommend`      | Barriers + policy → one grounded action per barrier                  | Nemotron        |
| POST   | `/forecast/discharge`   | Features → P(discharge 24h) + predicted days                         | deterministic   |
| POST   | `/forecast/demand`      | Beds + discharges + window → expected admissions + net beds          | deterministic   |
| POST   | `/forecast/narrate`     | Stats + beds → a short shift briefing (uses only the given numbers)  | Nemotron        |

Retrieval (the pgvector nearest-neighbour search) lives in **Next.js**, which owns
the database; this service provides the model primitives (`/embed`,
`/copilot/rerank`, `/copilot/answer`) that Next.js orchestrates.

## Run

Via Compose (recommended — matches deployment):

```bash
docker compose up -d ai      # from the repo root
curl localhost:8000/healthz
```

Standalone (needs Python 3.12):

```bash
cd ai
pip install -e '.[dev]'      # or: uv venv && uv pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
pytest                        # unit tests incl. the /config secret-redaction test
```

> **Rebuild after changes.** The container runs a built image — after editing
> `ai/`, run `docker compose up -d --build ai` (a stale image is a common cause of
> a route 404ing, e.g. a newly added `/config`).

## Config (env)

| Var                      | Default                               | Meaning                                                                |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------- |
| `NIM_MOCK`               | `true`                                | Offline deterministic mode (no key/network needed)                     |
| `NVIDIA_API_KEY`         | —                                     | Free key from build.nvidia.com; enables live NIM when `NIM_MOCK=false` |
| `NIM_BASE_URL`           | `https://integrate.api.nvidia.com/v1` | OpenAI-compatible endpoint                                             |
| `NIM_EXTRACT_MODEL`      | `nvidia/nvidia-nemotron-nano-9b-v2`   | Small reasoning model — extraction, routing, recommendation, narration |
| `NIM_EMBED_MODEL`        | `nvidia/nv-embedqa-e5-v5`             | Embedding model for policy retrieval (asymmetric query/passage)        |
| `NIM_RERANK_MODEL`       | `nvidia/llama-3.2-nv-rerankqa-1b-v2`  | Cross-encoder reranker for retrieved passages                          |
| `EMBED_DIM`              | `1024`                                | Embedding dimensions (must match the `policy_chunks.embedding` column) |
| `NIM_EXTRACT_MAX_TOKENS` | `1024`                                | Completion budget/call (reasoning + JSON); lower = faster              |
| `NIM_TIMEOUT`            | `30.0`                                | Per-call model timeout (seconds)                                       |
| `NIM_RPM`                | `30`                                  | Rate-limit budget (headroom under the free tier's ~40 RPM)             |
| `AI_SERVICE_TOKEN`       | —                                     | Shared secret; must match Next.js `WARDBEAT_AI_SERVICE_TOKEN`          |

**Mock vs live:** with `NIM_MOCK=true` (or no key) the service uses deterministic,
prompt-injection-safe mocks — zero dependencies, and the evals still run. Set
`NIM_MOCK=false` + a real key to hit NIM; the mock remains the fallback if a call
fails, so endpoints always return a usable result.
