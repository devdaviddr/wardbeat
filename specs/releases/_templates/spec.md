---
release: vX.Y.Z # semver tag this release will ship as
title: <Short, imperative release title>
status: Proposed # Proposed | Accepted | Shipped | Superseded | Rejected
phase: <e.g. Phase N — roadmap slice>
created: YYYY-MM-DD
updated: YYYY-MM-DD
supersedes: '—' # earlier spec/release this replaces, if any
---

# vX.Y.Z — <Title>

> **spec.md = the contract (what & why).** Freeze this once `Accepted`; the _how_ lives in
> [`spec-imp.md`](spec-imp.md).

## Summary

One paragraph: what this release delivers and why, in plain language.

## Problem / motivation

What's wrong or missing today, and who feels it. Evidence over opinion.

## Goals

- What success looks like (bullet, testable where possible).

## Non-goals

- Explicitly out of scope for this release (deferred to a later one).

## Scope / user-visible outcome

What a user can actually do when this ships. Screens, surfaces, flows.

## Requirements

### Functional

- **FR1** — …
- **FR2** — …

### Non-functional

- **NFR1** — (performance, security, a11y, cost, rate-limit budget, DX …)

## Acceptance criteria

- [ ] Observable, testable condition …
- [ ] …

## Security & privacy

Threats considered and how they're handled (or why N/A). Data handled; PHI/PII posture.

## Alternatives considered

- **Option X** — why not.

## Out of scope / future

- Follow-ups intentionally deferred (name the likely next release).

## References

- [WardBeat PRD](../../../docs/prd.md) — relevant sections.
- Related release specs; external sources.
