---
release: v0.12.0
title: Ward authorization & access audit
status: Shipped # Proposed | Accepted | Shipped | Superseded | Rejected
phase: Phase 3 — fit for real data
created: 2026-08-01
updated: 2026-08-01
supersedes: '—'
---

# v0.12.0 — Ward authorization & access audit

> **spec.md = the contract (what & why).** Freeze this once `Accepted`; the _how_ lives in
> [`spec-imp.md`](spec-imp.md).

## Summary

Today any authenticated WardBeat user can read every patient name, MRN and
clinical note on the ward, approve clinical actions, and — after v0.10.0 —
clear barriers, with no role check anywhere and no record of who looked at what.
This release introduces a **clinical role model**, enforces **authorization on
every ward action and route**, and adds a **queryable access audit** covering
reads as well as writes. It is the gate between "synthetic demo" and "could
hold real data", and it should ship before any real feed is contemplated.

## Problem / motivation

The platform WardBeat inherited has a working RBAC implementation
(`src/lib/auth/rbac.ts`) with a `requireRole` helper. It is called **eight times
in `src/lib/auth/admin-actions.ts` and zero times anywhere in the WardBeat
domain**. `ROLE_REQUIRED` in `src/proxy.ts` is an empty object, so `/ward`,
`/copilot`, `/actions` and `/briefing` require _a_ session and nothing more. The
lowest-privilege invited member has the same clinical authority as the bed
manager.

The role vocabulary is also wrong for the domain: the only roles are `admin` and
`member` (`src/lib/auth/roles.ts`). A ward has bed managers, charge nurses,
junior doctors, allied health professionals and discharge planners, and they do
not need the same access. The PRD names five personas; the system can express
two, neither of them clinical.

Audit is thinner still. `action_audit` records approve/dismiss on
recommendations and nothing else. There is **no record of who viewed a
patient**, who ran extraction, or what anyone asked the copilot — and copilot
questions are themselves patient-adjacent. In a clinical system, read access to
a patient record is the thing most likely to be audited, and WardBeat cannot
answer the question at all.

There is no retention story either: `ai_extractions.rawJson` holds full model
output including quoted note text, forever, and `notes.text` is never purged.

## Goals

- A **clinical role model** that matches how a ward actually divides work.
- **Every** WardBeat route and server action is authorized by role, not merely
  authenticated.
- A **queryable access audit** covering patient reads, extraction runs, copilot
  questions, and every barrier and recommendation mutation.
- Users can be **assigned to wards**, and authorization considers ward
  membership, not just role. (The multi-ward _data_ model lands in v0.13.0; this
  release puts the membership concept in place so authorization is not rewritten
  twice.)
- A stated, implemented **retention policy** for raw model output.
- Least privilege is **demonstrated by tests**, not asserted in docs.

## Non-goals

- Real PHI, encryption at rest, or a formal compliance posture (a real
  deployment needs a DPIA and an information-governance review that no spec
  substitutes for).
- SSO / directory integration for role provisioning.
- The multi-ward read path and site view (v0.13.0).
- Break-glass / emergency-access workflows.
- Consent management.

## Scope / user-visible outcome

An admin can assign a user a **clinical role** and one or more **wards**. What a
user sees and can do follows from that:

- A user with no ward assignment sees no patient data at all.
- Read-only roles can view the board and ask the copilot, but cannot clear
  barriers, approve recommendations, override an EDD, or run extraction.
- Clinical roles can act on barriers within their assigned wards.
- Only a bed-manager-level role can run extraction (it is expensive and
  ward-wide).
- Attempting an unauthorized action returns a clear, non-leaky refusal — never a
  crash, never a partial write.

An admin gets an **access log view**: who accessed which patient, when, and
through which surface. Every copilot question is recorded with its asker.

## Requirements

### Functional

- **FR1 — Clinical roles.** The role vocabulary is extended beyond
  `admin`/`member` to a clinical set (proposed: `bed_manager`, `charge_nurse`,
  `clinician`, `allied_health`, `viewer`, alongside `admin`). Existing users
  migrate to a sensible default without losing access to the admin surfaces.
- **FR2 — Ward membership.** A user can be assigned to one or more wards.
  Authorization for any patient-scoped operation requires membership of that
  patient's ward.
- **FR3 — Action authorization.** Every WardBeat server action — extraction,
  recommendation generation, decide, and every v0.10.0 lifecycle action, EDD
  override and manual barrier creation — checks role and ward membership before
  any write, and returns `{ ok: false, error }` on refusal.
- **FR4 — Route authorization.** `ROLE_REQUIRED` in `src/proxy.ts` gates the
  ward routes at the edge, with the server-side check as the real enforcement
  (the edge check is a redirect convenience, never the security boundary).
- **FR5 — Read audit.** Viewing a patient's detail, running extraction, and
  asking the copilot each write an access-audit record with actor, subject,
  surface and timestamp.
- **FR6 — Write audit continuity.** The v0.10.0 barrier event log and
  `action_audit` remain the record for mutations; the access audit does not
  duplicate them but must be joinable with them.
- **FR7 — Audit is queryable.** An admin-only view lists and filters access
  records by actor, patient and date range. Audit records are append-only and
  cannot be edited or deleted through the application.
- **FR8 — Retention.** A documented retention period for
  `ai_extractions.rawJson` is implemented as a purge routine, with the retained
  structured extraction unaffected.
- **FR9 — Copilot scoping.** The copilot may only answer over wards the asker is
  a member of. This closes the existing failure where a malformed model intent
  falls back to a filter matching every bed (`src/lib/copilot/ward.ts`) — the
  fallback must now be "refuse", not "list everything".

### Non-functional

- **NFR1 — Fail closed.** Any authorization check that cannot be evaluated
  denies. No code path may treat an unresolvable role or ward as permissive.
- **NFR2 — Enforcement is server-side.** UI affordances may be hidden by role,
  but hiding a button is never the control; every action re-checks.
- **NFR3 — Audit integrity.** Access-audit writes must not be lost on a failed
  request, and must not be able to block a clinical read — logged in a way that
  is durable but does not couple availability to auditability.
- **NFR4 — Tests prove least privilege.** For each role, a test asserts both
  what it can and what it cannot do. Negative tests are the deliverable here.
- **NFR5 — Performance.** Authorization must not add a query per bed; ward
  membership is resolved once per request.

## Acceptance criteria

- [x] A `viewer` cannot clear a barrier, approve a recommendation, override an
      EDD or run extraction — each refused server-side with a clear message.
- [x] A user with no ward assignment sees no patient data on any surface.
- [x] A user assigned to ward A cannot read or act on a patient in ward B,
      including via the copilot.
- [x] A malformed copilot intent results in a refusal, not a ward-wide listing.
- [x] Viewing a patient writes an access-audit record naming the actor and
      subject.
- [x] Every copilot question is recorded with its asker.
- [x] The admin audit view lists and filters access records; no application path
      can edit or delete them.
- [x] `ai_extractions.rawJson` older than the retention period is purged, and
      the structured extraction survives.
- [x] Per-role negative tests exist for every WardBeat server action.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass.

> **Verification status (2026-08-01).** Checked against the real local Postgres
> and the full e2e suite run **twice — once against `next dev`, once against a
> production `next start`** (42/42 both), which is what proves the denial
> messages survive production error redaction. 439 unit tests pass, 95 of them
> per-role negatives asserting refusal AND zero writes. The privilege-granting
> migration was observed live: 282 `bed_manager` grants + 283 ward memberships,
> counts printed at migration time. A real `access_audit` row was written and
> inspected through the production code path. The purge was run against real
> rows (41-day-old `raw_json` nulled, structured columns intact, idempotent).
>
> Two ticks carry qualifications:
>
> - **Ward A vs ward B**: the action path is unit-tested against a genuine
>   second ward. The copilot half is currently structural — the single-ward
>   read model cannot reach a second ward's patients — and the explicit
>   membership intersection lands with v0.13.0's ward scoping.
> - **The admin audit view** is verified at the query level (filter SQL,
>   pagination, admin-only) and by typecheck; it has not been rendered in a
>   browser.
>
> Also honestly noted: the capability matrix is **provisional** and needs
> review by someone who runs a ward; `ROLE_REQUIRED` in `proxy.ts` gates the
> ward routes from the JWT role claim, which can be stale — the server-side
> check is the boundary, as specced. The edge gate deliberately excludes
> `/dashboard` so a role-less user gets the friendly no-ward screen instead of
> a 403 bounce.

## Security & privacy

This release **is** the security work, so the posture statement matters:

- WardBeat remains synthetic-data-only on merge. Shipping this release does not
  by itself authorize real patient data — encryption at rest, a DPIA, an
  information-governance review, and a data-processing position on the
  third-party model endpoint are all still outstanding, and the raw note text
  sent to a hosted API (`src/lib/ai/client.ts`) is unredacted.
- The access audit is itself sensitive: it reveals which clinicians looked at
  which patients. It is admin-only and append-only.
- Rate limiting on the AI-backed actions is folded in here rather than left
  open: `src/lib/rate-limit.ts` currently guards auth only, so an authenticated
  user can drive unbounded model calls through the copilot and briefing.

## Alternatives considered

- **Keep two roles and gate on ward membership alone.** Simpler, but it cannot
  express "an allied health professional should not run ward-wide extraction",
  which is exactly the distinction a ward needs.
- **Attribute-based (ABAC) policy engine.** More expressive and more future-proof,
  but far more machinery than a single-ward product needs, and it would obscure
  the simple thing this release must get provably right.
- **Audit reads via database triggers.** Durable and hard to bypass, but it
  loses the application context (which surface, which query) that makes an
  access log useful, and it splits the logic across two authorities.
- **Defer read auditing to a later release.** Read audit is the part a clinical
  information-governance review asks about first; deferring it would mean
  redoing this release before any real data.

## Out of scope / future

- **v0.13.0** — multi-ward read path and site view, which builds on the ward
  membership introduced here.
- Encryption at rest, field-level protection, PHI redaction before the model
  call, break-glass access, SSO role provisioning, retention for `notes.text`
  and the barrier event log, and a formal IG/DPIA package.

## References

- [WardBeat PRD](../../../docs/prd.md) — security and personas.
- `src/lib/auth/rbac.ts`, `src/lib/auth/roles.ts`, `src/proxy.ts`,
  `src/lib/copilot/ward.ts`, `src/db/schema.ts` (`action_audit`,
  `ai_extractions`), `src/lib/rate-limit.ts`.
- [v0.10.0 — Close the loop](../v0.10.0-close-the-loop/spec.md) — the write
  surface this authorizes.
