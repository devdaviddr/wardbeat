---
release: v0.13.0
title: Multi-ward — scoped reads and a site view — implementation plan
status: Draft # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/multi-ward
created: 2026-08-01
updated: 2026-08-01
---

# v0.13.0 — Multi-ward · implementation plan

> **spec-imp.md = the plan (how).** This is a **living document** — update it as work
> proceeds. It implements the frozen contract in [`spec.md`](spec.md).

## Approach

Two halves. The first is a **mechanical but wide** change: thread a ward id
through every read, starting at `getWardBoard()` and following the call graph
out to the cockpit, briefing, copilot and action queue. There is no clever way
to do this — the value is in doing it exhaustively, and the compiler will find
most of it if `getWardBoard()` is made to require the parameter first and the
type errors are chased to the leaves.

The second half is **patient movement** — admit, transfer, discharge, bed
turnover — which is what makes multiple wards mean anything and is the first
time WardBeat writes to `encounters.dischargedAt` or `beds.status` at all.

On denormalisation: resist adding `ward_id` to every table. Add it where the
join genuinely breaks — `encounters`, because `bed_id` is nullable and an
unbedded patient must still belong to a ward — and reach everything else
through `encounter`. One denormalised column with a clear invariant beats four
that can drift.

## Architecture deltas

| Area                   | Change                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js                | Ward id threaded through every ward read; ward switcher in the app shell; `/site` overview; admit/transfer/discharge/turnover server actions; extraction scoped + incremental. |
| FastAPI (`ai` service) | None. The service is stateless and already takes ward state as input.                                                                                                          |
| Data / migrations      | `encounters.ward_id`; unique `patients.mrn`; partial unique index for one active encounter per bed; missing indexes; `encounter_movements` history.                            |
| Infra (Compose / env)  | No new services or env vars.                                                                                                                                                   |

## Work breakdown (milestones)

- **M1 — Ward scope through the read path.** Make `getWardBoard(wardId)`
  required, chase the type errors, scope cockpit/briefing/copilot/action reads.
  Ward selection resolved server-side from the route + membership. No UI switcher
  yet; the single seeded ward still works.
- **M2 — Integrity constraints & indexes.** Unique MRN, one-active-encounter-per-bed,
  missing indexes, with a pre-migration violation report.
- **M3 — Ward switcher + routing.** Ward in the URL; switcher in the shell;
  persistence; membership-gated.
- **M4 — Patient movement.** Admit, transfer, discharge, bed turnover;
  `encounter_movements` history; `encounters.ward_id` maintained on transfer.
- **M5 — Site overview.** Single aggregate query; the `/site` screen.
- **M6 — Incremental extraction.** Scope by ward and filter on
  `notes.processedAt`; report "no new notes" honestly.

## Data model & migrations

**`encounters.ward_id`** → `wards.id`, `notNull` after backfill. Backfilled from
`bed → ward`; encounters with no bed and no resolvable ward must be reported by
the migration, not silently defaulted. Maintained on transfer in the same
transaction as the bed change — the invariant is _`ward_id` is the ward the
encounter is currently under, regardless of whether it holds a bed_.

**Integrity constraints** (FR9):

- `UNIQUE (mrn)` on `patients`.
- Partial unique index enforcing one active encounter per bed:
  `CREATE UNIQUE INDEX encounters_active_bed_uniq ON encounters (bed_id) WHERE discharged_at IS NULL AND bed_id IS NOT NULL;`
  This is the correct shape — a plain unique index would forbid a bed ever being
  reused.
- Indexes: `patients_mrn_idx`, `encounters_patient_idx`,
  `encounters_ward_idx`, `encounters_discharged_idx`,
  `encounters_admitted_idx` (the last also serves v0.11.0's demand query).

**`encounter_movements`** — movement history (FR7):

```
id, encounter_id → encounters.id (cascade),
from_bed_id → beds.id (set null), to_bed_id → beds.id (set null),
from_ward_id → wards.id (set null), to_ward_id → wards.id (set null),
kind: 'admit' | 'transfer' | 'discharge',
actor_user_id → users.id (set null), reason text, created_at
```

Index on `(encounter_id, created_at)`. Append-only, same discipline as
`barrier_events`.

**Pre-migration violation report** (NFR3). Before the constraints are applied,
run a report: duplicate MRNs, beds with more than one undischarged encounter,
encounters with no resolvable ward. Fix or reconcile the data first — do not let
the migration fail opaquely on a seeded database and do not paper over it by
weakening the constraint.

## Interfaces & contracts

**Read scoping.** Change the signature first and let TypeScript drive:

```ts
getWardBoard(wardId: string): Promise<WardBoard>        // was: no argument
getCockpit(wardId: string): Promise<CockpitModel>
getBriefingInputs(wardId: string): Promise<BriefingInputs>
```

Ward resolution happens once per request in a server helper that intersects the
requested ward with the caller's membership (v0.12.0) and returns a refusal if
it does not hold — a client-supplied ward id is **never** trusted directly. This
is the main security risk of the release; see spec.md §Security.

**Movement actions** — `src/lib/ward/movement.ts`, all transactional, all
`ActionResult<T>` per `CLAUDE.md`:

```ts
admitPatientAction({ patientId, bedId })
transferEncounterAction({ encounterId, toBedId, reason? })
dischargeEncounterAction({ encounterId, reason? })
markBedFreeAction({ bedId })      // cleaning → free
```

Each writes an `encounter_movements` row, updates `beds.status`, and maintains
`encounters.ward_id`. Discharge sets `dischargedAt`, releases the bed to
`cleaning`, and must decide what happens to that encounter's open barriers —
**propose auto-clearing them with reason `patient discharged`**, recorded in the
v0.10.0 barrier event log so the history is explicit rather than the barriers
just vanishing.

**Site overview** (FR3, NFR1) — one aggregate query grouped by ward, not N board
reads:

```ts
getSiteOverview(userId: string): Promise<Array<{
  wardId; wardName; beds; occupied; fitButDelayed;
  openBarriers; overdueBarriers; lastExtractedAt;
}>>
```

**Incremental extraction** (FR10) — scope to the ward and add
`isNull(notes.processedAt)` (or a since-timestamp) to the note selection. Today
the action does `db.select().from(notes)` with no filter at all, so every run
re-extracts every note in the database; at 200 patients × 20 notes that is 4,000
model calls per button press. Report `{ processed, skipped }` in the run status.

## File / module plan

```
src/
  lib/
    ward/
      queries.ts        # wardId required; scoped reads
      cockpit.ts        # scoped; recommendation reads no longer global
      actions.ts        # ward-scoped + incremental extraction
      movement.ts       # NEW — admit/transfer/discharge/turnover
      site.ts           # NEW — the aggregate overview query
      resolve-ward.ts   # NEW — request ward ∩ membership, fails closed
    briefing/           # scoped
    copilot/            # scoped
    actions/            # scoped generation + reads
  components/
    shell/ward-switcher.tsx   # NEW
    ward/
      admit-dialog.tsx        # NEW
      transfer-dialog.tsx     # NEW
      discharge-dialog.tsx    # NEW
      bed-turnover.tsx        # NEW
    site/site-overview.tsx    # NEW
  app/(dashboard)/
    site/page.tsx             # NEW
    dashboard/[wardId]/       # ward in the URL
drizzle/                      # migration + violation report
tests/unit/
  ward-scope.test.ts          # NEW — cross-ward isolation
  movement.test.ts            # NEW — admit/transfer/discharge/turnover
  site-overview.test.ts       # NEW
  incremental-extraction.test.ts  # NEW
tests/e2e/
  multi-ward.spec.ts          # NEW
```

## Test & evaluation plan

- **Unit — cross-ward isolation (the priority).** A user on ward A gets nothing
  from ward B via board, cockpit, briefing, copilot, action queue or site
  overview. Include the adversarial case: a client-supplied ward id the user is
  not a member of must be refused, not honoured.
- **Unit — movement.** Admit occupies a free bed; admitting to an occupied bed
  is rejected; transfer moves bed and ward together; discharge sets
  `dischargedAt`, moves the bed to `cleaning`, and clears open barriers with a
  recorded reason; turnover returns the bed to `free`.
- **Unit — constraints.** Duplicate MRN rejected; second active encounter on a
  bed rejected; a discharged encounter's bed can be reused (proving the partial
  index is partial).
- **Unit — incremental extraction.** Second run processes zero notes and says so.
- **Unit — unbedded encounter** still resolves to its ward.
- **E2E** — switch wards, admit a patient, transfer them to the second ward,
  discharge, and turn the bed over.
- **AI eval** — unchanged gates; the seed must still satisfy them after the seed
  is extended to multiple wards.

## Rollout & deployment

- **Hard prerequisite: v0.12.0 must be merged.** Ward membership is what scoping
  intersects against; shipping scoping without it would mean a ward id from the
  client with nothing to check it against.
- The migration adds constraints that can reject existing data — run the
  violation report first, on a copy, and record the outcome here.
- `pnpm db:seed:ward` extended to seed **at least two wards** with overlapping
  and non-overlapping user membership; otherwise none of the isolation tests
  mean anything and the switcher cannot be exercised.
- No new env vars, no new services, no feature flag — ward scope is not
  optional.
- The `/dashboard` route gains a ward segment; keep a redirect from the bare
  path to the user's default ward so existing links do not break.

## Observability

- Log ward resolution refusals at `warn` — a client asking for a ward it does
  not belong to is worth seeing.
- Log every movement (admit/transfer/discharge/turnover) with actor, encounter,
  from/to.
- Extraction run logs `{ ward, processed, skipped }` — the fastest way to
  confirm the incremental filter is working.

## Risks / unknowns / spikes

| Risk / unknown                                                                                        | Plan                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wide blast radius** — ward scoping touches nearly every read in the product.                        | Change `getWardBoard`'s signature first and let the compiler enumerate the work. Land M1 alone, with the single seeded ward still passing every existing test. |
| **Client-supplied ward id trusted** — the classic multi-tenancy bug, and the main security risk here. | One `resolveWard()` helper, fails closed, used everywhere; adversarial tests are an acceptance criterion, not an afterthought.                                 |
| `encounters.ward_id` drifts from `bed → ward` after a transfer.                                       | Maintain both in one transaction; add a test asserting they agree after every movement. Consider a periodic consistency check if drift ever appears.           |
| Constraints reject seeded or demo data on migration.                                                  | Pre-migration violation report; fix the seed, not the constraint.                                                                                              |
| Auto-clearing barriers on discharge silently loses information.                                       | It is recorded in the barrier event log with an explicit reason, so it is visible rather than silent. Revisit if it proves wrong in use.                       |
| Site overview aggregate is slow at real ward counts.                                                  | Single grouped query by construction (NFR1); measure at ~30 seeded wards before calling it done.                                                               |
| Release is large — scoping _and_ movement _and_ site view.                                            | M1+M2 are a coherent, mergeable release on their own. If it overruns, ship those as v0.13.0 and move movement + site view to v0.14.0 rather than rushing both. |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] v0.12.0 merged first; every new surface gated by the capability matrix.
- [ ] Cross-ward isolation tests pass, including the adversarial ward-id case.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
      (+ `ai/` pytest).
- [ ] Existing AI eval gates pass against the multi-ward seed.
- [ ] Pre-migration violation report run and its outcome recorded here.
- [ ] `db:seed:ward` seeds ≥2 wards with mixed membership.
- [ ] `CHANGELOG.md` + `docs/features.md` + `docs/database.md` updated.
- [ ] Merged to `main`; `v0.13.0` tagged; both specs `Shipped` with criteria
      ticked.

## Task checklist

- [ ] Make `getWardBoard(wardId)` required; chase type errors to the leaves.
- [ ] `resolveWard()` helper — request ward ∩ membership, fails closed.
- [ ] Scope cockpit, briefing, copilot, action reads and generation.
- [ ] `encounters.ward_id` + backfill + maintained-on-transfer invariant.
- [ ] Pre-migration violation report.
- [ ] Unique MRN; partial unique active-encounter-per-bed index; missing indexes.
- [ ] Ward in the URL; ward switcher in the shell; default-ward redirect.
- [ ] `encounter_movements` + admit/transfer/discharge/turnover actions.
- [ ] Auto-clear open barriers on discharge, recorded in the event log.
- [ ] `getSiteOverview()` single aggregate query + `/site` screen.
- [ ] Incremental extraction on `notes.processedAt`; report processed/skipped.
- [ ] Seed ≥2 wards with mixed membership.
- [ ] Cross-ward isolation + movement + constraint tests; E2E multi-ward journey.
- [ ] Docs + changelog.
