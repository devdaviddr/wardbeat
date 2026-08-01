---
release: v0.10.0
title: Close the loop — barrier lifecycle & human authorship
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
phase: Phase 2 — from viewer to tool
created: 2026-08-01
updated: 2026-08-01
supersedes: '—'
---

# v0.10.0 — Close the loop — barrier lifecycle & human authorship

> **spec.md = the contract (what & why).** Freeze this once `Accepted`; the _how_ lives in
> [`spec-imp.md`](spec-imp.md).

## Summary

WardBeat can today identify why a medically-fit patient is still in a bed. It
cannot help anyone do something about it. This release gives a barrier a
**life**: an owner, a due time, a running progress log, and — for the first time
— a way to **mark it cleared**. It also makes the ward's human work **survive
re-extraction**, which it currently does not, and gives clinicians a write path
so they can add a barrier the AI missed and dismiss one it invented. This is the
release that turns a read-only viewer into a tool a ward could actually use on a
board round.

## Problem / motivation

Three concrete failures, all reproducible on `main` today:

1. **Re-running extraction destroys human work.** `persistExtraction`
   (`src/db/persist-extraction.ts:54`) deletes every barrier for a note and
   re-inserts them at `status: 'pending'`. Approving a recommendation sets a
   barrier to `in_progress` (`src/lib/actions/decide.ts:44`). So one user
   clicking "Run extraction" silently wipes every triage decision made on the
   ward that morning. There is no warning and no recovery.

2. **There is no path to `cleared`.** The status exists in the schema
   (`src/db/schema.ts`, `BARRIER_STATUSES`) and nothing in the application ever
   sets it. The board counts any barrier that is not `cleared`
   (`src/lib/ward/queries.ts`), so a bed card still reads "1 barrier" after the
   TTOs have been collected. The number only ever goes up.

3. **Approval is not delegation.** Approving a recommendation flips two rows and
   writes an audit record. Nobody is told. Nobody owns it. There is no due time,
   no way to record what the pharmacist actually said, and no way to see that a
   transport request has been sitting unanswered for two days — which is the
   entire escalation signal on a real ward.

The result is a product that can show a bed manager a blocked discharge and then
offers nothing. Meanwhile every clinical persona beyond the bed manager has no
write surface at all, so nobody can contradict the AI — and clinicians do not
trust systems they cannot contradict.

## Goals

- A barrier can be **assigned, chased, commented on, and cleared**, with the
  full history retained.
- **Re-extraction is non-destructive**: human state (status, owner, due time,
  comments, dismissals) survives, and re-running is safe at any time.
- **Barrier age is visible** on the board — the primary escalation cue.
- Clinicians can **add a barrier the AI missed** and **dismiss one it got
  wrong**, and can **override the EDD**, with authorship recorded.
- The first **domain test suite** exists; every new path in this release ships
  with tests.
- One real ward event drives a **Web Push notification**.

## Non-goals

- Real ADT/EMR ingestion, or any non-synthetic data (roadmap).
- Multi-ward or a site view (v0.13.0).
- Clinical role model and ward-level authorization (v0.12.0) — this release adds
  the write paths; gating them by clinical role is the next release.
- Fixing the hardcoded forecast inputs (v0.11.0).
- Realtime/push-based board updates between concurrent users (deferred).
- SBAR / handover artefact generation (later phase).

## Scope / user-visible outcome

On the ward board, a barrier chip shows **how long it has been open** and, if
assigned, **who owns it**. Opening a bed shows each barrier as a small working
record: status, owner, due time, a progress thread, and the source quote it was
extracted from.

A user can:

- **Assign** a barrier to a user, with an optional due time.
- **Add a progress note** to a barrier ("pharmacy says 4pm").
- **Mark it cleared**, choosing a reason — which removes it from the ward's open
  count and stops the age clock.
- **Add a barrier manually** that the AI did not find.
- **Dismiss a barrier** as wrong, which suppresses it so re-extraction will not
  resurrect it.
- **Override the EDD** on an encounter; the board shows that the date is
  clinician-set rather than AI-extracted.

Re-running extraction updates confidence and quotes on barriers that are still
supported by the notes, leaves human state untouched, marks barriers the notes
no longer support as **unconfirmed** rather than deleting them, and never
re-creates a dismissed one. A barrier assigned to you, and a barrier that goes
overdue, raise a Web Push notification.

## Requirements

### Functional

- **FR1 — Reconciling extraction.** `persistExtraction` reconciles rather than
  deletes. An incoming extracted barrier is matched to an existing one by a
  stable fingerprint (encounter + type + source note). On match, the existing
  row is **preserved** — its `id`, status, owner, due time and history survive —
  and only AI-derived fields (quote, spans, confidence, extraction id) are
  refreshed. Unmatched incoming barriers are inserted. Existing AI barriers no
  longer supported by the note are marked **unconfirmed**, not deleted.
- **FR2 — Human-authored barriers are never deleted by extraction.** A barrier
  carries an `origin` of `ai` or `human`; extraction only ever reconciles `ai`
  barriers.
- **FR3 — Dismissal is durable.** Dismissing a barrier records a suppression so
  a subsequent extraction of the same note does not re-create it.
- **FR4 — Clearing.** A barrier can be set to `cleared` with a required reason
  and an actor; the ward board's open-barrier counts and the "fit but delayed"
  filter exclude cleared barriers (already true) and now actually change.
- **FR5 — Ownership & due time.** A barrier can be assigned to a user with an
  optional due time; an assigned barrier past its due time is **overdue** and is
  visually distinct on the board and in the drawer.
- **FR6 — Progress log.** Every lifecycle transition (created, confirmed,
  unconfirmed, assigned, commented, cleared, dismissed, reopened) is appended to
  an append-only event log with actor and timestamp, and rendered as a thread in
  the bed drawer.
- **FR7 — Age.** Every open barrier displays its age, anchored to when it was
  first seen (which now survives re-extraction). Age is shown on the board chip
  and in the drawer.
- **FR8 — Manual barrier creation.** A user can add a barrier to an encounter,
  choosing type and writing a free-text description; it is stored with
  `origin: 'human'` and the authoring user, and requires no source quote.
- **FR9 — EDD override.** A user can set or clear an encounter's EDD; the
  encounter records whether the current EDD came from AI extraction or a named
  clinician, and extraction must not silently overwrite a human-set EDD.
- **FR10 — Approval delegates.** Approving a recommendation optionally assigns
  the underlying barrier and sets a due time in the same step, and writes to the
  barrier event log as well as `action_audit`.
- **FR11 — Notification.** Assigning a barrier to a user, and a barrier becoming
  overdue, each raise a Web Push notification to that user via the existing
  `src/lib/push/` plumbing.

### Non-functional

- **NFR1 — Atomicity.** Every multi-row mutation in this release (clear, assign,
  dismiss, approve-and-delegate, reconcile) runs in a single `db.transaction`.
  The existing non-transactional decision path (`src/lib/actions/decide.ts`) is
  brought under a transaction as part of this work.
- **NFR2 — Concurrency.** A second concurrent "Run extraction" on the same ward
  must not double-run: the action takes an advisory lock and returns a friendly
  `{ ok: false }` rather than racing.
- **NFR3 — Idempotence.** Running extraction twice with no note changes produces
  no user-visible change and writes no new lifecycle events.
- **NFR4 — Tests.** Every server action introduced or modified here has unit
  coverage, and the assign → comment → clear journey has an E2E test. This is
  the first WardBeat domain suite; it is a gate, not a nice-to-have.
- **NFR5 — Errors.** All new server actions follow the `{ ok: false, error }`
  convention (never `throw` for expected failures) per `CLAUDE.md`, and are
  verified against a production build, not just `next dev`.
- **NFR6 — No AI cost.** Nothing in this release adds a model call. The lifecycle
  is entirely deterministic.

## Acceptance criteria

- [x] Approving a recommendation, then running extraction again, leaves the
      barrier `in_progress` with its owner, due time and comments intact.
- [x] A barrier can be cleared with a reason; the bed card's barrier count and
      the ward's "fit but delayed" list both decrease immediately.
- [x] A manually-added barrier survives an extraction run.
- [x] A dismissed barrier is not re-created by a subsequent extraction of the
      same note.
- [x] A barrier whose supporting text is removed from the note is shown as
      unconfirmed, not deleted, and retains its history.
- [x] Every open barrier shows its age; an assigned barrier past its due time is
      shown as overdue.
- [x] The bed drawer shows a barrier's full event history with actors and times.
- [x] A user can set an EDD by hand; the board shows it as clinician-set and a
      later extraction does not silently overwrite it.
- [x] Assigning a barrier to a user delivers a Web Push notification to them.
- [x] Two concurrent extraction runs do not both execute.
- [x] Domain unit tests cover reconcile, clear, assign, dismiss and EDD
      override; an E2E test covers assign → comment → clear.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass, and the new
      server actions surface their error messages correctly in a production
      build.

> **Verification status (2026-08-01).** The ticked criteria were checked against
> a real Postgres and a **live** NVIDIA NIM extraction run, not the mock: a
> re-extraction over seeded ward data preserved an approved barrier's owner and
> due time, a cleared barrier's reason, a dismissed barrier's suppression, and a
> clinician-authored barrier, with zero spurious unconfirms under genuine model
> variance between runs. Migration `0012`'s SQL fingerprint backfill was checked
> against `barrierFingerprint()` for parity (9/9, including unicode). 42 domain
> unit tests (`reconcile`, `barrier-lifecycle`) and 4 Playwright specs pass.
>
> **Update (2026-08-01, later).** The three criteria that were outstanding are
> now closed:
>
> - **Web Push on assignment** is genuinely verified, not merely implemented. A
>   real VAPID keypair was generated and the send path exercised end-to-end
>   through `web-push` to a local HTTPS capture server: the payload arrived
>   `aes128gcm`-encrypted with the plaintext absent from the wire, and the VAPID
>   JWT verified cryptographically against the public key. Delivery to a real
>   push service (FCM/APNs) is still untested.
> - **The advisory lock has an integration test** against a real Postgres,
>   holding the lock from a genuinely separate connection. It was
>   mutation-tested — disabling the rejection branch makes exactly the two
>   concurrency assertions fail.
> - **EDD override has unit coverage**, which found a real bug on the way:
>   `Number.isNaN(Date.parse(edd))` accepts `2026-02-30` because V8 rolls it
>   over to 2 March. As `edd` is a text column and a human-set date is never
>   corrected by extraction, the board would have shown "30 Feb" permanently
>   while downstream code read 2 March. Fixed with a calendar round-trip.
>
> Also note: the overdue **sweep** runs on board read rather than on a
> schedule, because this deployment has no job runner. An overdue barrier is
> therefore noticed the next time someone opens the board, not the moment it
> lapses. This is a stated limitation, not an oversight.

## Security & privacy

Still synthetic data only; no PHI posture change. Two notes:

- The event log stores free-text comments authored by users. It is
  patient-adjacent by construction and must be treated as clinical data — it is
  covered by the retention and access-audit work in v0.12.0, and this spec
  deliberately does not expose it outside the authenticated ward surfaces.
- Every new mutation is authenticated via `getCurrentSession()`, matching the
  existing ward actions. **Role-based authorization is explicitly out of scope
  here and lands in v0.12.0** — this release widens the write surface for
  authenticated users, which is acceptable only while the data is synthetic and
  is the reason v0.12.0 follows immediately.

## Alternatives considered

- **Keep delete-and-reinsert, and re-apply human state afterwards.** Simpler
  diff, but it makes the AI output authoritative and the human state derived,
  which is backwards — and it cannot represent "the AI no longer sees this but a
  nurse is still chasing it".
- **A separate `tasks` table alongside barriers.** Cleaner separation, but it
  splits the ward's working set across two concepts a user experiences as one,
  and forces every board query into a join for what is really barrier state.
  Rejected in favour of giving the barrier itself a lifecycle.
- **Soft-delete barriers instead of unconfirming them.** Loses the distinction
  between "the note no longer supports this" and "a human said it was wrong",
  which is exactly the distinction a clinician needs.
- **Defer notifications to a later release.** The push plumbing is already built
  and wired to nothing; assignment is its natural first real event, and it is
  cheap here.

## Out of scope / future

- **v0.11.0** — honest forecast inputs, mock/live provenance surfaced in the UI,
  a "last read at" stamp, and evals that fail when the models are absent.
- **v0.12.0** — clinical roles, ward-level authorization on every domain action,
  and a queryable access audit.
- **v0.13.0** — multi-ward scoping and a site view.
- Realtime board sync between concurrent users; escalation ladders and SLA
  policies; SBAR/handover generation.

## References

- [WardBeat PRD](../../../docs/prd.md) — E2 (barrier intelligence), E4 (HITL
  actions).
- `src/db/persist-extraction.ts`, `src/lib/actions/decide.ts`,
  `src/lib/ward/queries.ts`, `src/db/schema.ts` (`barriers`, `action_audit`).
- [v0.4.0 — Action recommendations](../v0.4.0-action-recommendations/spec.md) —
  the HITL approve/dismiss flow this extends.
