# WardBeat AI plane (`ai/`)

Internal **FastAPI** service — the Python AI plane from the
[PRD §7.10](../docs/prd.md). It extracts discharge **barriers / EDD / MFFD** from
clinical notes over **NVIDIA NIM**, grounds every barrier back to the source
text, and is called **server-side only** by the Next.js BFF (never the browser).

Stateless: it reads a note and returns structured JSON. Next.js owns the
database.

## Endpoints

| Method | Path       | Notes                                                                             |
| ------ | ---------- | --------------------------------------------------------------------------------- |
| GET    | `/healthz` | liveness + which backend (mock/live)                                              |
| POST   | `/extract` | `{note_id, encounter_id?, text}` → `ExtractionResult`; requires `X-Service-Token` |

OpenAPI/Swagger at `/docs` when running.

## Run

Via Compose (recommended — matches deployment):

```bash
docker compose up -d ai      # from the repo root
curl localhost:8000/healthz
```

Standalone (needs Python 3.12):

```bash
cd ai
pip install -e '.[dev]'
uvicorn app.main:app --reload --port 8000
pytest
```

## Config (env)

| Var                      | Default                               | Meaning                                                                |
| ------------------------ | ------------------------------------- | ---------------------------------------------------------------------- |
| `NIM_MOCK`               | `true`                                | Offline deterministic extraction (no key/network needed)               |
| `NVIDIA_API_KEY`         | —                                     | Free key from build.nvidia.com; enables live NIM when `NIM_MOCK=false` |
| `NIM_BASE_URL`           | `https://integrate.api.nvidia.com/v1` | OpenAI-compatible endpoint                                             |
| `NIM_EXTRACT_MODEL`      | `nvidia/nvidia-nemotron-nano-9b-v2`   | small model for high-volume extraction                                 |
| `NIM_EXTRACT_MAX_TOKENS` | `1024`                                | completion budget/call (reasoning + JSON); lower = faster              |
| `AI_SERVICE_TOKEN`       | —                                     | shared secret; must match Next.js `WARDBEAT_AI_SERVICE_TOKEN`          |
| `NIM_RPM`                | `30`                                  | rate-limit budget (headroom under the free tier's ~40 RPM)             |

**Mock vs live:** with `NIM_MOCK=true` (or no key) the service uses a
keyword/sentence extractor — deterministic, prompt-injection-safe, zero
dependencies. Set `NIM_MOCK=false` + a real key to hit NIM; the mock remains the
fallback if a call fails, so `/extract` always returns a usable result.
