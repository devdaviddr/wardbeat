# Monitoring the AI

[← Back to README](../README.md) · [Evals](evals.md) · [Roadmap](roadmap.md) ·
[Architecture](architecture.md)

How to see what the AI plane is doing at runtime — whether it is live or mocked,
whether calls are succeeding, and when the model is degrading. Offline
[evals](evals.md) prove quality _before_ a release; this page is about the signals
_while it runs_.

> **Where it stands today.** Monitoring is **structured logs + health/config
> endpoints + eval scores + graceful, logged degradation**. There are no metrics,
> distributed tracing, or alerting yet — those are on the [Roadmap](roadmap.md).
> The design already emits everything a collector needs.

## What you can observe today

### 1. Structured logs

- **App (Next.js)** — `src/lib/logger.ts` emits **one JSON object per line**
  (`level`, `message`, `time`, + fields), greppable and ingestible by any
  collector. `LOG_LEVEL` (`debug|info|warn|error`) sets the threshold (defaults to
  `info` in production, `debug` in dev). Notable AI events:
  - `ward extraction complete` — `{ processed, failed, barriers, ungrounded }`
  - `ward extraction failed` / `note extraction failed` — per-note isolation, with the error
  - `AI config fetch failed` — the Settings card could not reach the AI plane
- **AI plane (FastAPI)** — Python `logging` (`wardbeat.ai`). Notable events:
  - `AI plane up — mock=<bool> model=<id> rpm=<n>` at startup
  - `NIM extraction failed (<err>); using mock fallback` — a live call fell back
  - `reranker unavailable on this tier; using cosine order`
  - other per-capability `... failed (...); using mock` warnings

Tail the AI plane in dev with `docker compose logs -f ai`.

### 2. Health & configuration endpoints

| Endpoint       | Auth            | Tells you                                                                                                                                                        |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | none (liveness) | `{ status, mock, model }` — is it up, and live or mocked                                                                                                         |
| `GET /config`  | service token   | Full non-sensitive config: mode, model ids, endpoint host, rate limit, timeout, embedding dim, and whether the key / token are configured (values never exposed) |

### 3. The AI configuration Settings card

`Settings → System → AI configuration` (admin-only) renders `/config` as an
operability surface: **Reachable / Unreachable**, **Live / Mock**, the three model
ids, the endpoint host, the operational limits, and credential presence. It is the
fastest way to confirm, from the product, that the AI plane is wired and reachable
(see [`src/components/settings/ai-config-card.tsx`](../src/components/settings/ai-config-card.tsx)).

### 4. Graceful, logged degradation

Every model call is wrapped in a fixed harness (rate-limit → timeout → structured
output → validate → ground → **mock fallback**). Failures never break the app —
they fall back to the deterministic mock **and log a warning**. That makes the logs
the primary signal: a rise in `using mock fallback` warnings while `NIM_MOCK=false`
means NIM is unavailable or over quota.

## Signals worth watching

| Signal                                     | Where it shows                                      | Likely meaning                                                |
| ------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------- |
| `using mock fallback` warnings (live mode) | AI-plane logs                                       | NIM outage, bad key, or quota exhausted                       |
| `timed out` errors                         | App / AI-plane logs                                 | Slow or half-open connection (45s Next→AI, 30s AI→NIM bounds) |
| High `ungrounded` / dropped-barrier count  | `ward extraction complete` log `ungrounded`         | Model drift or a note the grounding gate rejects              |
| Copilot refusals / `grounded=false`        | Copilot responses / logs                            | Retrieval miss or genuinely out-of-scope                      |
| Rate-limit queueing                        | AI-plane behaviour (token bucket, ~40 RPM headroom) | Bursts of extraction; expected, self-throttling               |
| `failed` count in the extraction summary   | `runWardExtractionAction` result + log              | Individual notes erroring (isolated, not fatal)               |

## In production (proposed)

The [Azure deployment](guide.html) design routes both container apps' logs, plus
Postgres / AI Foundry / Front Door diagnostics, into **Azure Monitor + Log
Analytics + Application Insights**, with alerts on latency, error rate, and the AI
eval gates. Because the app already emits structured JSON, shipping to any
collector (App Insights, Loki, etc.) needs no call-site changes — swap the sink in
`src/lib/logger.ts`.

## Known gaps / future

Tracked in the [Roadmap](roadmap.md):

- **No metrics** — per-call latency, token usage, and cost are not yet recorded.
- **No distributed tracing** — a request that crosses Next.js → AI plane → NIM has
  no correlated trace; add OpenTelemetry spans around each hop.
- **No alerting / dashboards** — signals live in logs, not on a board.
- **Eval scores aren't tracked over time** — run the [eval gates](evals.md) in CI
  and record them to catch regressions.
