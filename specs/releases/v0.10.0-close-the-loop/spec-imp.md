---
release: v0.10.0
title: Close the loop — barrier lifecycle & human authorship — implementation plan
status: Shipped # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/close-the-loop
created: 2026-08-01
updated: 2026-08-01
---

# v0.10.0 — Close the loop · implementation plan

> **spec-imp.md = the plan (how).** This is a **living document** — update it as work
> proceeds. It implements the frozen contract in [`spec.md`](spec.md).

## Approach

The barrier row becomes the working record: it gains authorship (`origin`,
`createdByUserId`), assignment (`ownerUserId`, `dueAt`), a resolution
(`clearedAt`, `clearedReason`), and a confirmation state that extraction
maintains (`lastConfirmedAt`, `unconfirmedAt`). All history moves into a new
append-only `barrier_events` table, which subsumes what `action_audit` does for
recommendations and gives us both the progress thread and the age/trend data.

The decisive change is in `persistExtraction`: it stops being
_delete-and-reinsert_ and becomes a **three-way reconcile** between the incoming
extraction, the existing AI barriers for that note, and a suppression list of
dismissed fingerprints. Everything else in the release hangs off that being
correct, so it is M1 and it lands with tests before any UI work.

No AI-service changes and no new model calls — this release is entirely in the
Next.js runtime and the database.

## Architecture deltas

| Area                   | Change                                                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js                | New `src/lib/ward/barrier-lifecycle.ts` (assign/comment/clear/dismiss/reopen server actions), `src/lib/ward/reconcile.ts` (pure reconcile function), EDD override action, extraction advisory lock. `decide.ts` brought under a transaction and extended to delegate. |
| FastAPI (`ai` service) | **None.** No new endpoints, no new model calls.                                                                                                                                                                                                                       |
| Data / migrations      | New columns on `barriers`; new tables `barrier_events`, `barrier_suppressions`; new columns on `encounters` for EDD authorship; new indexes.                                                                                                                          |
| Infra (Compose / env)  | No new services. No new required env vars (the overdue sweep is triggered in-request, not by a scheduler — see Rollout).                                                                                                                                              |

## Work breakdown (milestones)

Ordered; M1–M3 are independently mergeable and each carries its own tests.

- **M1 — Reconciling extraction (the core).** Schema migration for the new
  barrier columns + `barrier_suppressions`; extract a pure `reconcileBarriers()`
  and rewrite `persistExtraction` to use it; advisory lock on the extraction
  action; unit tests for every reconcile case. **No UI.** After M1, re-running
  extraction is safe.
- **M2 — Lifecycle model & events.** `barrier_events` table; the
  assign/comment/clear/dismiss/reopen server actions, each transactional;
  `decide.ts` transaction fix + optional delegation on approve. Unit tests.
- **M3 — Board & drawer UI.** Barrier age and owner on the board chip; overdue
  styling; the barrier working-record UI in the bed drawer (status, owner, due,
  event thread); clear/assign/comment/dismiss controls. E2E test for
  assign → comment → clear.
- **M4 — Human authorship.** Manual barrier creation; EDD override with
  authorship shown on the board; extraction respects a human-set EDD.
- **M5 — Notifications.** Wire assignment and overdue to `src/lib/push/`.
- **M6 — Docs & changelog.** `docs/features.md`, `docs/usage.md`, the About
  Roadmap tab, `CHANGELOG.md`.

## Data model & migrations

Drizzle is the single migration authority: edit `src/db/schema.ts` →
`pnpm db:generate` → commit the migration → `pnpm db:migrate`.

**`barriers` — new columns** (all nullable or defaulted, so the migration is
non-breaking on existing rows):

| Column                                         | Purpose                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `origin` text `'ai' \| 'human'` default `'ai'` | Extraction only ever reconciles `origin = 'ai'` rows (FR2).           |
| `created_by_user_id` → `users.id` (set null)   | Author of a manual barrier.                                           |
| `owner_user_id` → `users.id` (set null)        | Assignment (FR5).                                                     |
| `due_at` timestamp                             | Optional due time; drives overdue.                                    |
| `description` text                             | Free text for manual barriers (AI barriers use `source_quote`).       |
| `cleared_at` timestamp                         | Stops the age clock (FR4).                                            |
| `cleared_reason` text                          | Required when clearing.                                               |
| `cleared_by_user_id` → `users.id` (set null)   | Actor.                                                                |
| `first_seen_at` timestamp not null default now | Age anchor — now survives re-extraction, unlike `created_at` did.     |
| `last_confirmed_at` timestamp                  | Last extraction run that still supported this barrier.                |
| `unconfirmed_at` timestamp                     | Set when the notes stop supporting it; cleared if it reappears (FR1). |
| `fingerprint` text not null                    | Stable reconcile key — see below.                                     |

`BARRIER_STATUSES` gains `dismissed`: `['pending','in_progress','cleared','dismissed']`.
`dismissed` means "the AI got this wrong"; `cleared` means "the work is done".
They are different clinically and must not be collapsed.

New indexes: `barriers_owner_idx` on `owner_user_id`,
`barriers_status_idx` on `status`, `barriers_fingerprint_idx` on
`(source_note_id, fingerprint)`.

**`barrier_events`** — append-only history (FR6):

```
id, barrier_id → barriers.id (cascade),
kind: 'created' | 'confirmed' | 'unconfirmed' | 'assigned' | 'unassigned'
    | 'due_set' | 'commented' | 'cleared' | 'dismissed' | 'reopened',
actor_user_id → users.id (set null),   -- null = the system/extraction run
body text,                              -- comment text, or the clear reason
meta jsonb,                             -- { from, to } for status transitions
created_at
```

Index on `(barrier_id, created_at)`. Never updated or deleted.

**`barrier_suppressions`** — durable dismissal (FR3):

```
id, encounter_id → encounters.id (cascade), source_note_id → notes.id (cascade),
fingerprint text not null, dismissed_by_user_id → users.id (set null),
reason text, created_at
```

Unique on `(source_note_id, fingerprint)`. Reconcile consults this before
inserting.

**`encounters` — new columns** (FR9): `edd_source` text `'ai' | 'human'` default
`'ai'`, `edd_set_by_user_id` → `users.id` (set null), `edd_set_at` timestamp.

**Fingerprint.** `fingerprint = sha256(type + ':' + normalise(source_quote))`
where `normalise` lowercases, collapses whitespace and strips punctuation. Type
alone is too coarse (two distinct `review` barriers on one note would collide);
the raw quote is too brittle (the model rephrases the span between runs).
Normalised quote is the pragmatic middle. **This is the highest-risk design
decision in the release** — see Risks.

## Interfaces & contracts

No FastAPI changes. New Next.js Server Actions, all in
`src/lib/ward/barrier-lifecycle.ts`, all returning
`ActionResult<T>` = `{ ok: true, data } | { ok: false, error }` per `CLAUDE.md`
(never `throw` for expected failures — validation errors must survive a
production build):

```ts
assignBarrierAction(barrierId, { ownerUserId, dueAt? })
commentOnBarrierAction(barrierId, body)
clearBarrierAction(barrierId, reason)          // reason required, non-empty
dismissBarrierAction(barrierId, reason)        // writes a suppression
reopenBarrierAction(barrierId, reason)
createBarrierAction(encounterId, { type, description, dueAt?, ownerUserId? })
setEncounterEddAction(encounterId, edd | null) // edd_source = 'human'
```

`decideAction` in `src/lib/actions/decide.ts` gains an optional
`{ ownerUserId?, dueAt? }` so approve-and-delegate is one round trip (FR10), and
its three writes move inside a single `db.transaction`.

**Pure reconcile contract** (`src/lib/ward/reconcile.ts`) — no DB access, so it
is exhaustively unit-testable:

```ts
reconcileBarriers(input: {
  incoming: ExtractedBarrier[]      // from the AI plane
  existing: BarrierRow[]            // current rows for this note
  suppressed: Set<string>           // fingerprints from barrier_suppressions
  now: Date
}): {
  insert: NewBarrier[]
  update: Array<{ id: string; patch: Partial<BarrierRow> }>
  unconfirm: string[]               // barrier ids
  events: NewBarrierEvent[]
}
```

Reconcile rules, in order:

1. Incoming whose fingerprint is in `suppressed` → **dropped** (FR3).
2. Incoming matching an existing `origin='ai'` row by fingerprint → **update**
   AI-derived fields only (`source_quote`, `source_start`, `source_end`,
   `confidence`, `extraction_id`), set `last_confirmed_at = now`, clear
   `unconfirmed_at`. **Never touch** `status`, `owner_user_id`, `due_at`,
   `first_seen_at`, `cleared_*`. Emit a `confirmed` event only if it was
   previously unconfirmed (NFR3: no event churn on a no-op run).
3. Incoming with no match → **insert** with `origin='ai'`, `status='pending'`,
   `first_seen_at = now`; emit `created`.
4. Existing `origin='ai'`, not `cleared`/`dismissed`, with no incoming match →
   **unconfirm** (`unconfirmed_at = now`); emit `unconfirmed`. Never delete.
5. Existing `origin='human'` → untouched entirely (FR2).

## File / module plan

```
src/
  db/
    schema.ts                        # new columns, barrier_events, barrier_suppressions
    persist-extraction.ts            # rewritten: reconcile, not delete-and-reinsert
  lib/
    ward/
      reconcile.ts                   # NEW — pure reconcile function
      barrier-lifecycle.ts           # NEW — assign/comment/clear/dismiss/reopen/create
      edd.ts                         # NEW — EDD override + authorship
      actions.ts                     # advisory lock around the extraction run
      queries.ts                     # select owner, age, due, unconfirmed for the board
      cockpit.ts                     # surface age/overdue/owner in the read model
    actions/
      decide.ts                      # transaction fix + optional delegation
    push/                            # (existing) new senders for assigned/overdue
  components/
    ward/
      barrier-record.tsx             # NEW — the working record in the bed drawer
      barrier-events.tsx             # NEW — the progress thread
      barrier-create-dialog.tsx      # NEW — manual barrier
      edd-editor.tsx                 # NEW — EDD override
      bed-drawer.tsx                 # host the above
      cockpit-board.tsx              # age + owner + overdue on the chip
drizzle/                             # generated migration (committed)
tests/
  unit/
    reconcile.test.ts                # NEW — every reconcile rule + idempotence
    barrier-lifecycle.test.ts        # NEW — clear/assign/dismiss/reopen
    edd-override.test.ts             # NEW
    decide.test.ts                   # NEW — transaction + delegation + double-approve
  e2e/
    barrier-lifecycle.spec.ts        # NEW — assign → comment → clear
```

## Test & evaluation plan

This release establishes the **first WardBeat domain test suite** — today
`tests/` is 158 cases of inherited platform scaffolding and **zero** domain
coverage. Treat that as the baseline to move.

- **Unit (`reconcile.test.ts`)** — the priority. Table-driven over: no-op
  re-run (asserts zero writes and zero events, NFR3); approved barrier survives;
  human barrier survives; dismissed barrier not resurrected; note text removed →
  unconfirmed not deleted; unconfirmed barrier reappearing → re-confirmed;
  quote rephrased slightly → still matches; two same-type barriers on one note →
  do not collide.
- **Unit (lifecycle)** — clear requires a non-empty reason; clearing sets
  `cleared_at` and drops the open count; dismiss writes a suppression;
  double-approve returns `{ ok: false }` and writes exactly **one** audit row
  (the current TOCTOU); every action emits exactly one event.
- **E2E (Playwright)** — sign in, open a bed, assign a barrier, add a comment,
  clear it with a reason, assert the board's barrier count decreased and the
  event thread shows all three actions.
- **Concurrency** — a test that fires two extraction runs concurrently and
  asserts one is rejected by the advisory lock (NFR2).
- **AI eval** — **no gate change.** This release adds no model calls; the
  existing extraction/copilot/action/forecast harnesses must still pass at their
  current thresholds, unchanged, as a regression check that reconcile did not
  alter extraction output.
- **Production-build check** — run the new actions against `next start` (not
  `next dev`) and confirm validation errors reach the user, per `CLAUDE.md`.
- **Safety** — manual barrier `description` and comment `body` are untrusted
  user text: assert they are rendered as text, never HTML, and that they are
  never concatenated into an AI prompt in this release.

## Rollout & deployment

- **Migration.** Additive only — new nullable/defaulted columns and two new
  tables. Existing barriers backfill to `origin='ai'`,
  `first_seen_at = created_at`, and a computed `fingerprint`. The backfill is
  part of the generated migration; verify it on a seeded database before merge.
- **Re-seed not required**, but `pnpm db:seed:ward` should be updated so demo
  data includes a couple of assigned and cleared barriers — otherwise the new UI
  looks empty on a fresh install.
- **Feature flag.** Reuse the existing `FEATURE_WARD_BOARD` flag; the lifecycle
  is part of the board, not a separate surface. Note that `FEATURE_ACTIONS` is
  declared in `src/lib/env.ts` and never read — either wire it here or delete
  it, but do not leave it dangling.
- **No new env vars.** The overdue check is computed at read time
  (`due_at < now`) rather than by a background job, so there is no scheduler to
  deploy. The overdue **notification** is fired opportunistically on board read,
  deduplicated by a `notified_at` marker — a proper scheduler is a later
  release, and this limitation should be stated in the docs rather than hidden.
- **Rate limit.** No AI calls added, so no change to the ~40 RPM NIM budget.

## Observability

- Structured log (`src/lib/logger.ts`) on every lifecycle transition: barrier
  id, kind, actor, from/to status.
- Extraction run logs a reconcile summary — `{ inserted, updated, unconfirmed,
suppressed }` — which is the fastest way to spot a fingerprint regression in
  the wild.
- Log advisory-lock rejections so a wedged lock is visible.
- No metrics/tracing stack exists yet (`docs/monitoring.md`); do not pretend
  otherwise in the docs.

## Risks / unknowns / spikes

| Risk / unknown                                                                                                                                                                                        | Plan                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fingerprint instability** — the model rephrases a quote between runs, the fingerprint changes, and a barrier is unconfirmed while a duplicate is inserted. This is the release's main failure mode. | Spike first: run extraction 5× over the seeded notes and measure fingerprint churn. If churn is non-trivial, fall back to matching on span overlap (`source_start`/`source_end`) with type equality, and keep the normalised quote only as a tiebreak. Decide before M1 merges. |
| Backfilled fingerprints on existing rows differ from what the next extraction produces, causing one-off duplicates.                                                                                   | Accept for existing synthetic data; the demo DB is re-seedable. Verify on a copy and note it in the changelog.                                                                                                                                                                  |
| Advisory lock leaks on a crashed run and blocks extraction permanently.                                                                                                                               | Use a Postgres **session-scoped** advisory lock (released on disconnect), not an application flag. Add a lock-status line to the logs.                                                                                                                                          |
| `barrier_events` grows unboundedly with comments.                                                                                                                                                     | Fine at ward scale; retention is a v0.12.0 concern and is named there rather than solved here.                                                                                                                                                                                  |
| Widening the write surface before roles exist (v0.12.0) means any member can clear a clinical barrier.                                                                                                | Accepted only because data is synthetic; it is stated in spec.md §Security and is the reason v0.12.0 follows immediately. Do not ship real data on v0.10.0.                                                                                                                     |
| Scope creep — this release is already large.                                                                                                                                                          | M1–M3 are the release. M4/M5 can slip to v0.10.1 without making M1–M3 incoherent.                                                                                                                                                                                               |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
      (+ `ai/` pytest unchanged and passing).
- [ ] Existing AI eval gates still pass at unchanged thresholds.
- [ ] New server actions verified against a production build for error surfacing.
- [ ] Migration applies cleanly to a seeded database, backfill verified.
- [ ] `.env.example` + `src/lib/env.ts` unchanged or updated together;
      `FEATURE_ACTIONS` either wired or removed.
- [ ] `CHANGELOG.md` updated; `docs/features.md`, `docs/usage.md` and the About
      Roadmap tab reflect the lifecycle.
- [ ] Merged to `main`; `v0.10.0` tagged; both specs set to `Shipped` and the
      acceptance criteria **actually ticked**.

## Task checklist

- [ ] Spike: fingerprint stability over 5 extraction runs; decide match strategy.
- [ ] Schema: barrier columns, `barrier_events`, `barrier_suppressions`, encounter EDD authorship, indexes.
- [ ] `pnpm db:generate`; review + commit migration incl. backfill.
- [ ] `src/lib/ward/reconcile.ts` + exhaustive unit tests.
- [ ] Rewrite `persist-extraction.ts` onto reconcile.
- [ ] Advisory lock in `src/lib/ward/actions.ts` + concurrency test.
- [ ] `barrier-lifecycle.ts` actions, each transactional, each emitting one event.
- [ ] `decide.ts`: wrap in a transaction, add optional delegation, close the TOCTOU.
- [ ] Board chip: age, owner, overdue.
- [ ] Bed drawer: barrier working record + event thread.
- [ ] Manual barrier creation dialog.
- [ ] EDD override + authorship display; extraction respects human EDD.
- [ ] Push senders for assigned + overdue, with dedup marker.
- [ ] E2E: assign → comment → clear.
- [ ] Update `db:seed:ward` with assigned/cleared demo barriers.
- [ ] Docs + changelog.
