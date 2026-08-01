# Release specs — per-release SDD

[← Back to specs index](../README.md) · [WardBeat PRD](../../docs/prd.md)

From **v0.2.0** onward, every WardBeat release is planned as its own folder here, with
**two documents**:

| File              | Answers                                                                                                                      | Owner               | Stability                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------- |
| **`spec.md`**     | **What & why** — problem, goals, scope, requirements, acceptance criteria                                                    | Product intent      | Frozen once `Accepted` (change = new revision)          |
| **`spec-imp.md`** | **How** — architecture deltas, work breakdown, data model, contracts, file plan, test/eval plan, rollout, Definition of Done | Implementation plan | **Living** during the release; updated as work proceeds |

The split is deliberate: the `spec.md` is the **contract** (reviewable intent that shouldn't
churn mid-build); the `spec-imp.md` is the **plan** (a working document that evolves as the
release is implemented). One says _what we agreed to build_, the other says _how we're
building it and how far along we are_.

## Layout

```
specs/
  0001..0025-*.md                     # inherited platform + foundation (history)
  releases/
    README.md                         # this file
    _templates/
      spec.md                         # copy to start a release spec
      spec-imp.md                     # copy to start an implementation plan
    v0.2.0-barrier-intelligence-ward-board/
      spec.md
      spec-imp.md
    v0.3.0-flow-copilot/
      ...
```

- **One folder per release**, named `vX.Y.Z-slug` (the semver tag the release will ship as,
  plus a short slug). This matches the trunk-based flow — a release is a `vX.Y.Z` tag on
  `main`.
- Numbered specs `0001`–`0025` remain as **history** (see the [index](../README.md)); they
  are not migrated. `0026` was the first product spec and now lives here as
  `v0.2.0-barrier-intelligence-ward-board`.

## Lifecycle

```
spec.md: Proposed ─▶ Accepted ─────────────────────────────▶ Shipped
                          │                                     ▲
                          ▼                                     │
spec-imp.md:          Draft ─▶ In Progress ─▶ Ready ────────────┘   (tag vX.Y.Z)
```

1. **Draft `spec.md`** as `Proposed`; review the what/why against the [PRD](../../docs/prd.md).
2. On agreement, set `spec.md` → `Accepted`. It's now the frozen contract for the release.
3. **Draft `spec-imp.md`** — the implementation plan. Work the checklist on a
   `feature/<slug>` branch.
4. On merge + release, tag `vX.Y.Z` on `main`, set both docs to `Shipped`/`Done`, tick the
   acceptance criteria, and add the `CHANGELOG.md` entry.

## Starting a new release

```bash
REL=v0.3.0-flow-copilot
mkdir -p "specs/releases/$REL"
cp specs/releases/_templates/spec.md      "specs/releases/$REL/spec.md"
cp specs/releases/_templates/spec-imp.md  "specs/releases/$REL/spec-imp.md"
```

Fill `spec.md` first, get it to `Accepted`, then plan in `spec-imp.md`.

## How this relates to the PRD and CI

- The [**PRD**](../../docs/prd.md) is the umbrella product doc (vision, topology, roadmap).
  Each release spec implements **one slice** of that roadmap.
- Acceptance criteria in `spec.md` and the eval gates in `spec-imp.md` are what a release is
  checked against before it ships. (CI is deferred at this stage — the gates run locally;
  see [CONTRIBUTING.md](../../CONTRIBUTING.md).)

## Release index

| Release     | Title                                           | `spec.md`                                                        | `spec-imp.md`                                                        |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| **v0.2.0**  | Barrier intelligence & ward board (Phase 1 MVP) | [spec](v0.2.0-barrier-intelligence-ward-board/spec.md) — Shipped | [plan](v0.2.0-barrier-intelligence-ward-board/spec-imp.md) — Shipped |
| **v0.3.0**  | Flow copilot — ward-state Q&A + policy RAG      | [spec](v0.3.0-flow-copilot/spec.md) — Shipped                    | [plan](v0.3.0-flow-copilot/spec-imp.md) — Shipped                    |
| **v0.4.0**  | Action recommendations (agentic, HITL)          | [spec](v0.4.0-action-recommendations/spec.md) — Shipped          | [plan](v0.4.0-action-recommendations/spec-imp.md) — Shipped          |
| **v0.5.0**  | Forecasting & narration                         | [spec](v0.5.0-forecasting-narration/spec.md) — Shipped           | [plan](v0.5.0-forecasting-narration/spec-imp.md) — Shipped           |
| **v0.6.0**  | Flow cockpit — board-centric UX                 | [spec](v0.6.0-flow-cockpit/spec.md) — Shipped                    | [plan](v0.6.0-flow-cockpit/spec-imp.md) — Shipped                    |
| **v0.7.0**  | Action queue onto the board                     | _no spec folder — see `CHANGELOG.md`_                            | —                                                                    |
| **v0.8.0**  | AI configuration in Settings                    | [spec](v0.8.0-ai-configuration-settings/spec.md) — Shipped       | [plan](v0.8.0-ai-configuration-settings/spec-imp.md) — Shipped       |
| **v0.9.0**  | Open the referenced policy source               | [spec](v0.9.0-open-referenced-sources/spec.md) — Shipped         | _none — small change_                                                |
| **v0.10.0** | Close the loop — barrier lifecycle              | [spec](v0.10.0-close-the-loop/spec.md) — Shipped                 | [plan](v0.10.0-close-the-loop/spec-imp.md) — Shipped                 |
| **v0.11.0** | Trustworthy numbers                             | [spec](v0.11.0-trustworthy-numbers/spec.md) — Shipped            | [plan](v0.11.0-trustworthy-numbers/spec-imp.md) — Shipped            |
| **v0.12.0** | Ward authorization & access audit               | [spec](v0.12.0-ward-rbac-audit/spec.md) — Proposed               | [plan](v0.12.0-ward-rbac-audit/spec-imp.md) — Draft                  |
| **v0.13.0** | Multi-ward — scoped reads & site view           | [spec](v0.13.0-multi-ward/spec.md) — Proposed                    | [plan](v0.13.0-multi-ward/spec-imp.md) — Draft                       |

**v0.8.0 through v0.11.0 all ship in the single `v0.11.0` tag.** They were merged to
`main` without being tagged; back-tagging their original commits would have published
releases whose `package.json` still said `0.7.0` and triggered deploys of superseded
code. Each keeps its own spec folder and `CHANGELOG.md` section, because they are
genuinely separable slices — only the tag is shared.

### Planned arc (v0.10.0 → v0.13.0)

These four were planned together on 2026-08-01 after a product review, and they are
**ordered by dependency, not preference**:

- **v0.10.0** turns a read-only viewer into a tool — a barrier gains an owner, a due time,
  a progress log and a way to be cleared, and human work stops being destroyed by
  re-extraction.
- **v0.11.0** makes every number honest or absent, and every AI output's provenance
  visible. It also makes the eval gates capable of failing, which they currently are not.
- **v0.12.0** is the gate before any real data: clinical roles, authorization on every ward
  action, and an access audit covering reads.
- **v0.13.0** makes ward an explicit scope, adds a site view and closes the bed lifecycle.
  It **depends on v0.12.0** — ward membership is what scoping intersects against.

Earlier releases' `Post-release verification` notes record which of their acceptance
criteria were **not** met and which of these releases now owns them.
