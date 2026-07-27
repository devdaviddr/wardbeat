# Evaluating the AI & models

[← Back to README](../README.md) · [PRD](prd.md) · [Monitoring](monitoring.md) ·
[Roadmap](roadmap.md)

AI quality in WardBeat is **a number, not a feeling**. Every AI capability has a
labelled synthetic dataset, a metric that fits the task, and a **hard gate**; the
harnesses run against the live NVIDIA NIM models and **exit non-zero** when a
gate is missed, so they double as a release gate. This is the concrete form of
the project's thesis — _we don't trust the model, we measure it._

## The three layers of testing

| Layer                        | Tooling                                 | What it proves                                                            |
| ---------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| **Deterministic unit tests** | Vitest (`tests/`), pytest (`ai/tests/`) | The non-AI logic and the AI-plane contract behave and don't leak secrets. |
| **AI eval harnesses**        | `pnpm eval:*` (`src/eval/*.ts`)         | The live models hit their accuracy/grounding/ranking gates.               |
| **Mock ↔ live parity**       | `NIM_MOCK` flag                         | The system runs identically offline (deterministic mock) and on real NIM. |

## The four eval harnesses

Each is a standalone script under `src/eval/` (run with `pnpm eval:<name>`), scores
the **live** AI plane against planted ground truth, prints the numbers, and exits
non-zero if any gate is missed.

| Harness    | Command                | Dataset                                        | Metric(s)                                                                       | Gate                         | Verified live          |
| ---------- | ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ---------------------- |
| Extraction | `pnpm eval:extraction` | Labelled synthetic notes (`notes.eval_labels`) | Barrier-type **precision / recall / F1**, plus MFFD (fit-flag) accuracy         | F1 ≥ 0.85                    | **88%** F1             |
| Copilot    | `pnpm eval:copilot`    | Labelled policy questions + ward questions     | Retrieval **hit-rate**, answer **groundedness**, ward **query-intent** accuracy | all ≥ 0.90                   | **100% / 100% / 100%** |
| Actions    | `pnpm eval:actions`    | Labelled barrier → action cases                | Action **appropriateness**, rationale **policy-grounding**                      | both ≥ 0.90                  | **100% / 100%**        |
| Forecast   | `pnpm eval:forecast`   | Labelled synthetic notes (features + truth)    | Discharge **Spearman rank correlation**; narration **numeric-consistency**      | ρ ≥ 0.70; consistency ≥ 0.90 | **0.92 / 100%**        |

### What each one actually checks

- **Extraction** (`src/eval/extraction-eval.ts`) — for every labelled note it calls
  `/extract`, compares the extracted barrier _types_ against the planted set, and
  computes precision/recall/F1 plus MFFD accuracy. F1 balances the two failure
  modes — missing a real barrier vs. inventing one.
- **Copilot** (`src/eval/copilot-eval.ts`) — the **policy path** embeds each
  question, runs the pgvector cosine top-K (K=8), reranks to top-N (N=4), and checks
  the expected policy document was retrieved (hit-rate) and the answer came back
  `grounded`. The **ward path** sends each question to `/copilot/query-intent` and
  checks the produced structured filter matches the expected keys (query-intent
  accuracy). Retrieval is only useful if the right passage returns, and an answer is
  only safe if it is grounded in what was retrieved — both are scored.
- **Actions** (`src/eval/action-eval.ts`) — for each labelled barrier it retrieves
  policy and calls `/agent/recommend`, then checks the recommended `action_type`
  matches the expected mapping and the rationale is grounded in a cited passage.
- **Forecast & narration** (`src/eval/forecast-eval.ts`) — the deterministic
  discharge model is scored on **getting the order right** (Spearman ρ against a
  truth score), not on hitting an exact probability, because the forecast is used to
  rank patients. Then the narrator is fed a fixed set of numbers and the briefing is
  checked so that **every integer it states came from the input** — proving the LLM
  narrates and never invents figures.

## Running the evals

The harnesses hit the running AI plane and read planted labels from Postgres, so
bring both up and seed first:

```bash
docker compose up -d db ai      # Postgres + the FastAPI AI plane
pnpm db:migrate
pnpm db:seed:ward               # labelled synthetic ward → extraction + forecast labels
pnpm db:seed:policy             # discharge-policy KB (pgvector) → copilot + action evals

pnpm eval:extraction            # F1 gate 0.85
pnpm eval:copilot               # hit-rate / grounded / query-intent, gates 0.90
pnpm eval:actions               # appropriateness / grounding, gates 0.90
pnpm eval:forecast              # Spearman ρ 0.70 / numeric-consistency 0.90
```

Any gate miss exits non-zero (and prints the shortfall), so these can be wired
into CI unchanged when CI is re-introduced (see [Roadmap](roadmap.md)).

### Mock vs live

By default the AI plane runs the **deterministic offline mock** (`NIM_MOCK=true`,
or no `NVIDIA_API_KEY`) — the evals still run and exercise the full pipeline. To
evaluate the real models, set `NIM_MOCK=false` and a `NVIDIA_API_KEY`, recreate
the `ai` container, and re-run. The numbers in the table above are the **live**
NIM figures.

## Unit tests

- **AI plane** (`ai/tests/`, pytest) — includes `test_extract.py`,
  `test_forecast.py`, and `test_config.py`. The config test is a **security
  guardrail**: it asserts `GET /config` never serialises a secret value
  (`NVIDIA_API_KEY` / `AI_SERVICE_TOKEN`), only presence booleans. Run:
  ```bash
  cd ai && uv venv .venv && . .venv/bin/activate && uv pip install -e ".[dev]" && pytest -q
  ```
- **App** (`tests/`, Vitest) — `pnpm test` (unit) and `pnpm test:e2e` (Playwright).

## Why these metrics (and not others)

- **F1 for extraction** surfaces both missed and invented barriers; a single
  accuracy number would hide one of them.
- **Hit-rate + groundedness for RAG** separates "did retrieval work" from "is the
  answer safe" — the RAGAS-style split.
- **Rank correlation for the forecast** matches how the number is used (ordering
  patients by dischargeability), not a false-precision point estimate.
- **Numeric-consistency for narration** targets the one failure that matters for a
  narrator: stating a wrong number.

## Adding a new eval

Follow the existing pattern: (1) plant labelled synthetic ground truth (in the
seed, or a fixture), (2) call the live AI-plane endpoint, (3) compute a metric that
matches how the output is used, (4) print it and `process.exit(1)` below the gate,
(5) add a `eval:<name>` script to `package.json`. Keep gates honest — a gate you
never fail is not a gate.

## Known gaps / future

Tracked in the [Roadmap](roadmap.md): running the eval gates in CI, RAGAS
faithfulness scoring for retrieval, LLM-as-judge rubrics for open-ended answers,
regression tracking of eval scores over time, and larger / real-data-derived eval
sets. See also [Monitoring](monitoring.md) for the runtime signals that complement
these offline gates.
