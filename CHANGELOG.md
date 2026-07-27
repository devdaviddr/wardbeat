# Changelog

All notable changes to WardBeat are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
As this project is pre-1.0, minor versions may introduce breaking changes.

> WardBeat is built on the [nextjs-fullstack-boilerplate](https://github.com/devdaviddr/nextjs-fullstack-boilerplate)
> platform. The changelog for the inherited platform (releases up to v0.19.0)
> lives in that upstream repository; this file starts WardBeat's own history at
> v0.1.0.

## [Unreleased]

_Nothing yet._

## [0.1.0] - 2026-07-27

### Added

- **Repository scaffold.** WardBeat stood up from the full-stack platform:
  rebranded identity (package, README, app-shell metadata, PWA manifest), a
  production-grade README, and the inaugural spec
  [`0025-wardbeat-foundation.md`](specs/0025-wardbeat-foundation.md).
- Spec-driven, trunk-based development process (inherited and documented).

### Removed

- **GitHub Actions pipelines** (`ci`, `codeql`, `deploy`) — CI/CD is deferred
  for this stage; quality gates run locally. The pipeline docs remain as
  reference for re-introduction.
