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

| Release    | Title                                           | `spec.md`                                                         | `spec-imp.md`                                                      |
| ---------- | ----------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **v0.2.0** | Barrier intelligence & ward board (Phase 1 MVP) | [spec](v0.2.0-barrier-intelligence-ward-board/spec.md) — Proposed | [plan](v0.2.0-barrier-intelligence-ward-board/spec-imp.md) — Draft |
