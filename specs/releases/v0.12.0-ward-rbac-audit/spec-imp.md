---
release: v0.12.0
title: Ward authorization & access audit — implementation plan
status: Draft # Draft | In Progress | Ready | Shipped
spec: ./spec.md
branch: feature/ward-rbac-audit
created: 2026-08-01
updated: 2026-08-01
---

# v0.12.0 — Ward authorization & access audit · implementation plan

> **spec-imp.md = the plan (how).** This is a **living document** — update it as work
> proceeds. It implements the frozen contract in [`spec.md`](spec.md).

## Approach

Extend the inherited RBAC rather than replace it: `src/lib/auth/rbac.ts` and the
`roles`/`user_roles` tables already work, they are simply unused by the domain.
Add clinical roles to the vocabulary, add a `user_wards` membership table, and
introduce a **single authorization helper** that every ward action calls —
`requireWardAccess(action, { encounterId | wardId })` — so authorization lives
in one place and a missing check is a visible omission rather than an invisible
default.

Audit is written through one `recordAccess()` helper on the same principle.
Reads are audited by instrumenting the query layer (`src/lib/ward/queries.ts`,
`cockpit.ts`, `copilot/*`), not by asking every caller to remember.

The riskiest part is not the code but the **coverage**: the deliverable is that
_no_ domain action is left unchecked. Enumerate every `'use server'` export in
the ward surface first, and treat that list as the checklist.

## Architecture deltas

| Area                   | Change                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js                | `src/lib/auth/ward-access.ts` (the single authorization helper), `src/lib/audit/record.ts` (the single audit writer), every ward action gated, `ROLE_REQUIRED` populated in `proxy.ts`, admin audit view, rate limiting on AI-backed actions. |
| FastAPI (`ai` service) | None. Authorization is a BFF concern; the AI service stays stateless and token-gated. (Note separately: `ai/app/security.py` disables auth when `AI_SERVICE_TOKEN` is empty — fix that here as a one-line hardening.)                         |
| Data / migrations      | New roles seeded; `user_wards` table; `access_audit` table; retention purge for `ai_extractions.raw_json`.                                                                                                                                    |
| Infra (Compose / env)  | New env var for the retention window. No new services.                                                                                                                                                                                        |

## Work breakdown (milestones)

- **M1 — Role model & membership.** Clinical roles seeded; `user_wards` table;
  admin UI to assign role + wards; migration mapping existing users to a
  default. No enforcement yet — this milestone is safe to merge alone.
- **M2 — The authorization helper.** `requireWardAccess` with a capability
  matrix; unit tests for the matrix in isolation.
- **M3 — Enforce everywhere.** Every ward server action gated; `ROLE_REQUIRED`
  populated; copilot ward-scoping and the refuse-on-malformed-intent fix; UI
  affordances hidden by role. Per-role negative tests. **This is the release.**
- **M4 — Access audit.** `access_audit` table; `recordAccess()`; instrumentation
  of patient reads, extraction runs and copilot questions; admin audit view.
- **M5 — Retention & hardening.** `raw_json` purge routine; rate limiting on
  copilot/briefing/generation; `ai/app/security.py` empty-token fix.

## Data model & migrations

**`user_wards`** — membership (FR2):

```
user_id → users.id (cascade), ward_id → wards.id (cascade),
created_at
PRIMARY KEY (user_id, ward_id)
```

**`access_audit`** — append-only read/action log (FR5, FR7):

```
id,
actor_user_id → users.id (set null),
subject_type: 'patient' | 'encounter' | 'ward' | 'copilot_query',
subject_id text,                  -- nullable for ward-wide surfaces
surface: 'board' | 'bed_drawer' | 'copilot' | 'briefing' | 'extraction' | 'actions',
detail jsonb,                     -- e.g. the copilot question text
created_at
```

Indexes on `(actor_user_id, created_at)` and `(subject_id, created_at)` — those
are the two questions an auditor asks. No `UPDATE`/`DELETE` path is exposed in
application code.

**Roles.** Add `bed_manager`, `charge_nurse`, `clinician`, `allied_health`,
`viewer` to the seeded `roles` table. Migration assigns every existing
non-`admin` user `bed_manager` (the current de-facto capability) so nobody
loses access on upgrade, and assigns every existing user membership of the
single existing ward. **Both defaults must be stated in the release notes** —
a silent privilege assignment is exactly the kind of thing this release exists
to prevent.

**Retention.** `ai_extractions.raw_json` purged beyond
`AI_RAW_RETENTION_DAYS` (propose 30). Implemented as a function invoked from the
extraction action (opportunistic) rather than a scheduler, matching the v0.10.0
precedent — and documented as such a limitation, not dressed up as a cron.

## Interfaces & contracts

**The capability matrix** — one table, in code, in `src/lib/auth/ward-access.ts`:

| Capability               | admin | bed_manager | charge_nurse | clinician | allied_health | viewer |
| ------------------------ | :---: | :---------: | :----------: | :-------: | :-----------: | :----: |
| view board / bed         |   ✓   |      ✓      |      ✓       |     ✓     |       ✓       |   ✓    |
| ask copilot              |   ✓   |      ✓      |      ✓       |     ✓     |       ✓       |   ✓    |
| assign / comment         |   ✓   |      ✓      |      ✓       |     ✓     |       ✓       |   ✗    |
| clear / dismiss barrier  |   ✓   |      ✓      |      ✓       |     ✓     |       ✓       |   ✗    |
| create manual barrier    |   ✓   |      ✓      |      ✓       |     ✓     |       ✓       |   ✗    |
| override EDD             |   ✓   |      ✓      |      ✓       |     ✓     |       ✗       |   ✗    |
| approve recommendation   |   ✓   |      ✓      |      ✓       |     ✓     |       ✗       |   ✗    |
| run extraction           |   ✓   |      ✓      |      ✗       |     ✗     |       ✗       |   ✗    |
| generate recommendations |   ✓   |      ✓      |      ✗       |     ✗     |       ✗       |   ✗    |
| view access audit        |   ✓   |      ✗      |      ✗       |     ✗     |       ✗       |   ✗    |

Treat this table as **provisional** — it is a reasonable first cut, not a
clinical governance decision, and it should be reviewed by someone who runs a
ward before it is called correct.

```ts
// Fails closed. Returns the resolved context or a refusal; never throws for
// an expected denial (CLAUDE.md).
requireWardAccess(
  capability: Capability,
  scope: { encounterId: string } | { wardId: string } | { any: true },
): Promise<{ ok: true; userId: string; wardId: string } | { ok: false; error: string }>
```

```ts
// Never blocks the caller's read; failures are logged, not propagated (NFR3).
recordAccess(input: { subjectType; subjectId?; surface; detail? }): Promise<void>
```

**Copilot scoping (FR9).** `src/lib/copilot/ward.ts` currently falls back to
`{ aggregation: 'list' }` when the model's intent fails Zod validation, which
matches every bed. Change the fallback to a refusal, and constrain the applied
filter to the asker's ward memberships regardless of what the model returned.

## File / module plan

```
src/
  lib/
    auth/
      ward-access.ts        # NEW — capability matrix + requireWardAccess
      roles.ts              # clinical role vocabulary
      admin-actions.ts      # assign role + wards
    audit/
      record.ts             # NEW — recordAccess
      queries.ts            # NEW — admin audit listing/filtering
    ward/                   # every action gated
    actions/                # decide + generate gated
    copilot/ward.ts         # scoping + refuse-on-malformed-intent
    rate-limit.ts           # applied to copilot/briefing/generation
  proxy.ts                  # ROLE_REQUIRED populated
  app/(dashboard)/settings/ # role + ward assignment UI
  app/(dashboard)/settings/audit/  # NEW — admin audit view
ai/app/security.py          # empty-token fix
tests/unit/
  ward-access.test.ts       # NEW — the matrix, exhaustively
  ward-authz.test.ts        # NEW — per-role negative tests per action
  access-audit.test.ts      # NEW
tests/e2e/
  ward-rbac.spec.ts         # NEW — viewer sees no write affordances and is refused
```

## Test & evaluation plan

- **Unit — the matrix.** Table-driven across every (role × capability) pair;
  the test data _is_ the specification, so a capability added later without a
  matrix entry fails the suite.
- **Unit — negative per action.** For each ward server action, assert that an
  under-privileged role and a non-member of the ward are both refused **and that
  no write occurred**. Asserting the refusal without asserting the absence of
  the write is the classic gap; assert both.
- **Unit — fail closed.** Unresolvable role, missing ward membership, and a user
  with no roles all deny.
- **Unit — copilot scoping.** A malformed intent refuses; a valid intent is
  intersected with the asker's memberships.
- **E2E** — sign in as a viewer: no clear/approve affordances rendered, and a
  directly-invoked action is refused.
- **AI eval** — unchanged gates; assert they still pass (this release does not
  touch model behaviour).
- **Audit** — asserts a read writes exactly one record, and that a failed audit
  write does not fail the read (NFR3).

## Rollout & deployment

- **Migration is privilege-granting** — it assigns roles and ward membership to
  existing users. Call this out prominently in `CHANGELOG.md` and verify the
  mapping on a copy of the database before merge.
- New env var `AI_RAW_RETENTION_DAYS` → add to **both** `.env.example` and the
  Zod schema in `src/lib/env.ts` (it fails fast, so forgetting one breaks boot).
- No feature flag: authorization cannot be optional. Merging this release means
  the ward surface is gated.
- The purge is opportunistic, not scheduled — document the limitation.

## Observability

- Every denial logged at `warn` with capability, actor and scope. A spike in
  denials after release means the matrix is wrong, and this is how it is seen.
- Audit-write failures logged at `error` (they must never be silent, even though
  they must never block).
- Rate-limit rejections on AI-backed actions logged.

## Risks / unknowns / spikes

| Risk / unknown                                                                | Plan                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A missed action** — one ungated `'use server'` export defeats the release.  | Enumerate every ward-surface server export as the M3 checklist; add a test that fails if a ward action module exports a function with no access call. |
| The capability matrix is a guess about clinical practice.                     | Ship it as provisional and stated as such; get it reviewed by someone who runs a ward. It is data in one file, cheap to change.                       |
| Read auditing on every board render is write-heavy.                           | Audit at bed/patient granularity, not per row; measure before optimising; consider coalescing repeated board reads in a short window.                 |
| Auditing copilot question text stores free text that may be patient-adjacent. | Intended — it is the point of the audit. It is admin-only, and it inherits the retention conversation that this release starts but does not finish.   |
| Privilege-granting migration surprises an operator.                           | Release notes + a printed summary of what was granted when the migration runs.                                                                        |
| Scope creep into encryption / PHI redaction.                                  | Explicitly out of scope in spec.md. This release makes real data _possible_ to consider, not _safe_ to add.                                           |

## Definition of Done

- [ ] All `spec.md` acceptance criteria met.
- [ ] Every ward-surface server action appears in the M3 checklist and is gated.
- [ ] Local gate green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
      (+ `ai/` pytest).
- [ ] Existing AI eval gates still pass.
- [ ] `.env.example` + `src/lib/env.ts` both updated for the retention window.
- [ ] Migration's privilege grants verified on a database copy and documented.
- [ ] `CHANGELOG.md` + `SECURITY.md` updated; the synthetic-data-only posture
      restated honestly.
- [ ] Merged to `main`; `v0.12.0` tagged; both specs `Shipped` with criteria
      ticked.

## Task checklist

- [ ] Enumerate every ward-surface `'use server'` export → the enforcement checklist.
- [ ] Seed clinical roles; migration mapping for existing users.
- [ ] `user_wards` table + admin assignment UI.
- [ ] `ward-access.ts` capability matrix + `requireWardAccess`.
- [ ] Gate every action on the checklist; assert no-write on denial.
- [ ] Populate `ROLE_REQUIRED` in `proxy.ts`.
- [ ] Copilot ward-scoping + refuse-on-malformed-intent.
- [ ] Hide write affordances by role in the UI (convenience, not control).
- [ ] `access_audit` table + `recordAccess()` + read instrumentation.
- [ ] Admin audit view with actor/patient/date filters.
- [ ] `raw_json` retention purge + env var.
- [ ] Rate limit copilot / briefing / recommendation generation.
- [ ] `ai/app/security.py` empty-token fix.
- [ ] Per-role negative tests; E2E viewer test.
- [ ] Docs, `SECURITY.md`, changelog.
