---
release: v0.13.0
title: Multi-ward — scoped reads and a site view
status: Proposed # Proposed | Accepted | Shipped | Superseded | Rejected
phase: Phase 3 — fit for real data
created: 2026-08-01
updated: 2026-08-01
supersedes: '—'
---

# v0.13.0 — Multi-ward — scoped reads and a site view

> **spec.md = the contract (what & why).** Freeze this once `Accepted`; the _how_ lives in
> [`spec-imp.md`](spec-imp.md).

## Summary

WardBeat is hardwired to exactly one ward — the central read
`getWardBoard()` calls `db.query.wards.findFirst()` with no `where` clause and
returns whichever ward the database hands back. Every downstream feature is
built on that call. This release makes ward an explicit, first-class scope
throughout the read path, adds a **ward switcher** and a **site overview** across
the wards a user belongs to, and closes the data-integrity gaps that only went
unnoticed because there was one of everything.

## Problem / motivation

The product's primary persona is the bed manager or flow coordinator — and that
person does not work on one ward. They work across ten to twenty, and their job
is precisely to move patients and pressure between them. A single-ward tool is
a scope mismatch with the person it is built for: it can tell them about one
ward at a time, and cannot answer the question they actually have, which is
"where is the pressure and where is the capacity".

Concretely, on `main`:

- `getWardBoard()` (`src/lib/ward/queries.ts`) selects an arbitrary ward. There
  is no selector, no parameter, and no site view.
- `getProposedCount`-style reads in `src/lib/ward/cockpit.ts` fetch **all**
  proposed recommendations globally, unscoped to the board — correct only while
  exactly one ward exists.
- No table below `beds` carries a ward reference. `encounters`, `notes`,
  `barriers` and `recommendations` reach their ward only via
  `encounter → bed → ward`, and `encounters.bedId` is **nullable** — so an
  unbedded encounter belongs to no ward at all and is invisible to any
  ward-scoped query.
- `patients` has **no indexes and no unique constraint on `mrn`**, so duplicate
  patient records are a matter of time.
- Nothing enforces one active encounter per bed; `queries.ts` takes
  `bed.encounters[0]` from an unordered set, so two undischarged encounters on a
  bed silently render whichever Postgres returns first.

The bed lifecycle is also still open: nothing in the application ever writes
`encounters.dischargedAt` or changes `beds.status`, and `'cleaning'` is a bed
status nothing sets. A bed never turns over. That is tolerable in a single-ward
demo and untenable across a site, so it is closed here.

## Goals

- **Ward is an explicit scope** on every read and write, resolved from the
  request, never inferred.
- A user can **switch between the wards they belong to**, and see a **site
  overview** across all of them.
- The **bed lifecycle closes**: admit, transfer, discharge, and bed turnover are
  representable and driven from the UI.
- **Data integrity constraints** that a single ward hid are added: unique MRN,
  one active encounter per bed, and the missing indexes.
- Ward-scoped reads stay fast as ward count grows.

## Non-goals

- Real ADT/EMR ingestion — this release makes the model capable of representing
  multiple wards and patient movement; populating it from a real feed is
  separate and larger.
- Cross-organisation / multi-tenant isolation (a different problem from
  multi-ward within one site).
- Ward-level configuration (different barrier taxonomies or policies per ward).
- Predicting cross-ward flow or recommending transfers — a site view shows
  state; acting on it is later.

## Scope / user-visible outcome

A ward switcher appears in the app shell for users belonging to more than one
ward. Selecting a ward scopes the board, the copilot, the briefing and the
action queue to it.

A new **site overview** lists the user's wards with, for each: occupancy, count
of medically-fit-but-delayed patients, open barriers, overdue barriers, and
whether extraction has run recently. It is the "where is the pressure" screen,
and it links into each ward's board.

Patient movement becomes real: a patient can be **admitted to a bed**,
**transferred between beds** (including across wards the user belongs to), and
**discharged** — which frees the bed, stops the encounter, and turns the bed
over through a `cleaning` state to `free`. Ward occupancy therefore changes over
time, which also gives the demand projection introduced in v0.11.0 real history
to work from.

## Requirements

### Functional

- **FR1 — Explicit ward scope.** `getWardBoard()` and every ward-scoped read
  take a ward id. No read may select a ward implicitly.
- **FR2 — Ward switcher.** Users belonging to more than one ward can switch; the
  selection persists across navigation and is reflected in the URL so a board is
  linkable.
- **FR3 — Site overview.** A screen summarising every ward the user belongs to,
  with occupancy, fit-but-delayed count, open and overdue barriers, and data
  freshness; each row links to that ward's board.
- **FR4 — Scoped recommendations and copilot.** Recommendation reads and
  generation, the briefing, and the copilot all operate within the selected
  ward, intersected with the user's membership from v0.12.0.
- **FR5 — Ward denormalisation.** Ward-scoped tables carry a resolvable ward
  reference so scoped queries do not depend on a nullable `bedId` join, and an
  unbedded encounter still belongs to a ward.
- **FR6 — Admission and discharge.** A patient can be admitted to a free bed and
  an encounter can be discharged, setting `dischargedAt` and releasing the bed.
- **FR7 — Transfer.** An encounter can move between beds, including across wards
  the user belongs to, with the move recorded in the encounter's history.
- **FR8 — Bed turnover.** Discharging a bed moves it to `cleaning`; a user can
  mark it `free`. The existing `cleaning` status is finally used.
- **FR9 — Integrity constraints.** `patients.mrn` is unique; at most one
  undischarged encounter per bed is enforced at the database level, not by
  convention; the missing indexes on `patients` and `encounters`
  (`patient_id`, `discharged_at`, `admitted_at`) are added.
- **FR10 — Extraction is ward-scoped and incremental.** Extraction runs for a
  named ward and processes only notes not yet processed (the `notes.processedAt`
  column exists and is written but never read back, so today every run
  re-extracts every note in the database).

### Non-functional

- **NFR1 — Query cost.** Board and site-overview reads must not scale with total
  wards; the site overview is a single aggregate query, not N board reads.
- **NFR2 — Authorization holds.** Every new surface is gated by the v0.12.0
  capability matrix and ward membership; the ward switcher offers only wards the
  user belongs to, and switching is not a privilege escalation path.
- **NFR3 — Migration safety.** The integrity constraints will reject existing
  data if it violates them; the migration must detect and report violations
  rather than failing opaquely.
- **NFR4 — Tests.** Cross-ward isolation is tested explicitly: a user on ward A
  must not see ward B data through any surface, including the copilot and the
  site overview.

## Acceptance criteria

- [ ] No read path selects a ward implicitly; `getWardBoard()` requires a ward
      id.
- [ ] A user belonging to two wards can switch between them, and the board URL
      identifies the ward.
- [ ] The site overview shows all the user's wards with occupancy,
      fit-but-delayed, open and overdue barriers, and freshness — in one query.
- [ ] A user belonging only to ward A sees no ward B data anywhere, including
      via the copilot and the site overview.
- [ ] A patient can be admitted, transferred between wards, and discharged; the
      bed goes `occupied` → `cleaning` → `free`.
- [ ] An encounter with no bed still appears under its ward.
- [ ] Inserting a duplicate MRN is rejected by the database.
- [ ] A second undischarged encounter on an occupied bed is rejected by the
      database.
- [ ] Running extraction twice processes each note once; the second run reports
      no new work.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.

## Security & privacy

Multi-ward makes ward membership a genuine data boundary rather than a
formality, so the v0.12.0 authorization work is a hard prerequisite — this
release must not merge before it. The specific risk to test for is **scope
confusion**: a ward id supplied by the client being trusted without
intersecting it against the user's membership. Every ward-scoped read must
resolve membership server-side, and the tests in NFR4 exist to prove it.

Data posture is otherwise unchanged: synthetic only, and the outstanding items
named in v0.12.0 (encryption at rest, PHI redaction before the model call, a
DPIA) remain outstanding.

## Alternatives considered

- **A ward id on every table (full denormalisation).** Fastest reads and the
  simplest queries, at the cost of a value that can drift from the
  `bed → ward` truth on transfer. Consider a narrower version — see the
  implementation plan — rather than blanket denormalisation.
- **Keep resolving ward through the bed join.** No new columns, but it breaks
  for unbedded encounters, which is precisely the case a real ward has (a
  patient waiting for a bed is the flow problem).
- **Ship the site view without patient movement.** Smaller, but a site view over
  wards whose occupancy never changes is a screen of constants — the same
  category of dishonesty v0.11.0 exists to remove.
- **Full multi-tenancy now.** Different problem, much larger, and not what a
  single-site product needs.

## Out of scope / future

- Real ADT/HL7/FHIR ingestion to populate movement automatically.
- Cross-ward transfer _recommendations_ and site-level flow prediction.
- Per-ward configuration; ward hierarchies (specialty groupings, divisions).
- Realtime board sync between concurrent users, which becomes more valuable once
  multiple wards and movement exist.

## References

- [WardBeat PRD](../../../docs/prd.md) — topology and personas.
- `src/lib/ward/queries.ts`, `src/lib/ward/cockpit.ts`, `src/db/schema.ts`
  (`wards`, `beds`, `encounters`, `patients`).
- [v0.12.0 — Ward authorization & access audit](../v0.12.0-ward-rbac-audit/spec.md)
  — the ward membership this builds on. **Hard prerequisite.**
