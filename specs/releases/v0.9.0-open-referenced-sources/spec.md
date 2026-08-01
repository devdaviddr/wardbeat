---
release: v0.9.0
title: Open the referenced policy source
status: Accepted # Proposed | Accepted | Shipped | Superseded | Rejected
phase: Barrier/action intelligence — traceability slice
created: 2026-07-28
updated: 2026-07-28
supersedes: '—'
---

# v0.9.0 — Open the referenced policy source

## Summary

Every AI output in WardBeat is grounded and cited, but the citation is currently
shown only as a snippet. This lets a user **open the referenced policy document**
from a citation — a dialog that renders the full discharge-policy doc with the
cited passage highlighted — so they can read the recommendation's justification in
context, not just the one quoted line. Applies to action-recommendation citations
and the copilot's policy citations.

## Problem / motivation

A recommendation says "Escalate cardiology review — _Trust Discharge Policy §6_",
and the copilot answers with policy citations, but the reference is a dead end:
you see the quoted passage, not the document it came from. For a
trust-and-verify tool, being able to open the source and read the surrounding
policy is the natural next step of grounding. (Barriers already show their full
source note inline, so notes are out of scope.)

## Goals

- From a policy citation, open the **full referenced policy document** with the
  cited passage highlighted.
- Works for both **action recommendations** and **copilot policy answers**.
- No schema change and no re-seed required — resolve existing citations.

## Non-goals

- Editing policies, or linking to an external/original file (these are synthetic
  seeded docs; a real document-store/FHIR integration is a roadmap item).
- A full-note viewer for barriers (the note text is already shown inline).

## Scope / user-visible outcome

The `— Trust Discharge Policy §6` citation on a recommendation, and the policy
citation badges in the copilot, become clickable. Clicking opens a dialog with
the document's title, its source label, and every passage in order, with the
cited one highlighted. If the document can't be resolved, the dialog gracefully
shows just the cited passage.

## Requirements

### Functional

- **FR1** — A server action resolves a citation to its source document: by chunk
  `id` (copilot), else by exact passage `text` (recommendations), else by the
  document `source`/title label; returns the doc's chunks in order with the cited
  one flagged, or null.
- **FR2** — A `PolicyDialog` renders that document, highlighting the cited
  passage, and degrades to the passage-only view when resolution fails.
- **FR3** — Wired into the recommendation card and the copilot (dock + chat)
  policy citations.

### Non-functional

- **NFR1 — Auth.** The resolver runs server-side and returns nothing to an
  unauthenticated caller (same posture as other ward reads).
- **NFR2 — No migration.** Resolution works against existing data (the citation
  passage text matches the stored chunk text).

## Acceptance criteria

- [x] Clicking a recommendation's policy citation opens the full policy doc with
      the cited passage highlighted.
- [x] Clicking a copilot policy citation does the same.
- [x] An unresolvable citation shows the passage-only fallback, not an error.
- [x] `pnpm lint && typecheck && test && build` pass.

> **Post-release verification (2026-08-01).** All criteria met; merged to `main`
> and awaiting a release tag.

## Security & privacy

Read-only over seeded policy text; no PHI. The resolver is auth-gated and returns
only policy content (never notes or patient data).

## Out of scope / future

- Precise links for recommendation citations by persisting the chunk `id` in the
  citation JSON going forward (still no migration — it is `jsonb`).
- Opening the original source file via a document store / FHIR (roadmap).

## References

- [PRD](../../../docs/prd.md) — grounding & citations.
- `src/lib/copilot/policy.ts`, `src/lib/actions/generate.ts` (citations);
  `src/db/schema.ts` (`policy_docs` / `policy_chunks`).
