---
release: v0.8.0
title: AI configuration visibility in Settings — implementation plan
status: Ready # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/ai-config-settings
created: 2026-07-28
updated: 2026-07-28
---

# v0.8.0 — AI configuration visibility in Settings · implementation plan

> **spec-imp.md = the plan (how).** This is a **living document**. It implements the
> frozen contract in [`spec.md`](spec.md).

## Approach

Add a token-gated `GET /config` to the FastAPI AI plane that serialises its own
`Settings` with every secret reduced to a presence boolean. The Next.js Settings
page fetches it server-side through a small typed client, bounded by a timeout,
and renders it in an admin-only card. The Settings surface is grouped into
labelled sections at the same time. The AI plane stays the single source of
truth — the app never copies model ids or flags into its own config.

## Architecture deltas

| Area                   | Change                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js                | New server helper `src/lib/ai/config.ts` (`getAiConfiguration()`); new admin-only `AiConfigCard`; Settings page fetches config when admin; Settings client grouped into sections. |
| FastAPI (`ai` service) | New `GET /config` in `ai/app/routers/health.py`, gated by `require_service_token`, returning non-sensitive settings + secret presence booleans.                                   |
| Data / migrations      | None. No new tables — config is runtime env, not persisted.                                                                                                                       |
| Infra (Compose / env)  | None new. Reuses `WARDBEAT_AI_URL` + `WARDBEAT_AI_SERVICE_TOKEN` (app) and the AI plane's existing `NIM_*` env.                                                                   |

## Work breakdown (milestones)

- **M1 — AI plane `/config`.** Add the endpoint + a unit test asserting the shape
  and that no secret value is present in the response.
- **M2 — App client.** `getAiConfiguration()` — fetch `/config` with the service
  token and a timeout; map to a typed result with a `reachable` flag and the
  app-side endpoint host; server-only.
- **M3 — Settings card + sections.** `AiConfigCard` (read-only, badges for
  mode/status), wire into the Settings page behind `isAdmin`, and group the
  Settings cards under section headings.

## Data model & migrations

None. The feature is read-only over runtime configuration.

## Interfaces & contracts

- **API** (FastAPI): `GET /config` (requires `x-service-token`) →
  ```json
  {
    "service_version": "0.2.0",
    "mode": "mock" | "live",
    "models": { "extract": "...", "embed": "...", "rerank": "..." },
    "endpoint_host": "integrate.api.nvidia.com",
    "rate_limit_rpm": 30,
    "timeout_seconds": 30.0,
    "embed_dim": 1024,
    "api_key_configured": false,
    "service_token_required": false
  }
  ```
  Never includes `nvidia_api_key` or `ai_service_token` values.
- **Types**: a Zod schema in `src/lib/ai/config.ts` validates the response;
  `AiConfiguration` is the inferred type. Pydantic response model on the FastAPI
  side.
- **Service auth**: same shared `x-service-token` used by every other AI-plane
  endpoint; skipped only when no token is configured (dev), matching existing
  behaviour.

## File / module plan

```
ai/app/routers/health.py         # + GET /config (token-gated), + ConfigResponse model
ai/tests/test_config.py          # shape + secret-redaction unit test
src/lib/ai/config.ts             # getAiConfiguration(): server-only fetch + Zod + host derive
src/components/settings/ai-config-card.tsx   # admin-only read-only card
src/app/(dashboard)/settings/page.tsx        # fetch config when isAdmin
src/app/(dashboard)/settings/settings-client.tsx  # section headings + AiConfigCard
```

## Test & evaluation plan

- **Unit** — FastAPI: `/config` returns the documented keys, `mode` flips with
  `use_mock`, and the serialised body contains neither secret value. TS:
  typecheck of the Zod schema / mapping.
- **E2E** (Playwright) — deferred; the card is admin-gated and covered by manual
  verification for this slice.
- **AI eval** — N/A (no model behaviour changes).
- **Safety** — the redaction unit test is the guardrail: assert secrets never
  serialise.

## Rollout & deployment

No new env vars. Works in dev (mock, no token) and live. Update `CHANGELOG.md`.
The AI plane image gains one route; no Compose change.

## Observability

The card itself is the observability win. No new metrics this slice.

## Risks / unknowns / spikes

| Risk / unknown                | Plan                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Accidental secret exposure    | Explicit allow-list serialisation (never `model_dump()` the whole Settings) + a redaction unit test. |
| AI plane down blocks Settings | Bounded fetch timeout; render an unreachable state; page never throws.                               |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (+ FastAPI tests).
- [ ] `CHANGELOG.md` updated.
- [ ] Merged to `main`; `v0.8.0` tagged; both specs set to `Shipped`.

## Task checklist

- [ ] M1 — `GET /config` + redaction test
- [ ] M2 — `getAiConfiguration()` client
- [ ] M3 — `AiConfigCard` + Settings sections
- [ ] CHANGELOG entry
