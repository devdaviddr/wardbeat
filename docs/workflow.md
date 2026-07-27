# Feature → Production

[← Back to README](../README.md)

> **CI/CD is deferred at this stage.** WardBeat removed the GitHub Actions
> pipelines for now, so the "CI green → image published → box pulls" half of
> this playbook is **not currently wired** — it documents the target state for
> when CI is re-introduced. Today: run the local gate
> (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`), merge to `main`,
> and deploy manually (`make deploy`) if/when you self-host.

One connected playbook for taking a change from a feature branch to a live
update on your box — the git workflow ([CONTRIBUTING.md](../CONTRIBUTING.md)),
the CI/CD mechanics ([CI/CD](ci-cd.md)), and the deploy target this repo is
built for, a **Mac mini (or any always-on box) behind a Cloudflare Tunnel**
([Self-hosting](self-hosting.md)) — stitched into one ordered walkthrough. Each
step links back to the doc that owns the detail; this page is the map, not a
third copy.

> **Not GitFlow.** This repo is intentionally **trunk-based**: `main` is the
> only long-lived branch — no `develop`, `release`, or `hotfix` branches.
> Feature branches merge straight into `main`, and a release is just a tag on
> a green `main` commit. If "gitflow" is what you're picturing, this is that
> idea simplified to one branch.

```text
feature/<slug> ──PR──▶ main ──CI green──▶ image published (sha + latest)
                                              │
                                    push a v* tag (after CI is green)
                                              │
                                 release job re-tags: semver + stable (~30s)
                                              │
                         Mac mini (Tier B timer, ≤60s poll) pulls, migrates, restarts
                                              │
                                      live behind the tunnel
```

---

## 1 — Start a feature

```bash
git checkout main && git pull
git checkout -b feature/<slug>
```

- For a non-trivial change, write a spec first — copy
  [`specs/TEMPLATE.md`](../specs/TEMPLATE.md), open it as `Proposed`. See
  [specs/README.md](../specs/README.md).
- Commit with [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:`…) — enforced by a commitlint hook.

Full detail: [CONTRIBUTING.md → Workflow](../CONTRIBUTING.md#workflow).

## 2 — Develop and verify locally

```bash
pnpm dev
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # before pushing
```

Add `pnpm test:e2e` for the full suite (needs `pnpm docker:db`,
`pnpm docker:minio`, and — for the email round-trips — `pnpm docker:mail`).
See [Usage & Development](usage.md).

## 3 — Open a PR into `main`

CI (`ci.yml`) runs `quality` and `e2e` on the
PR, and builds (but never pushes) the Docker image on both architectures.
Merge once it's green. There's no `develop` branch to target — PRs go
straight into `main`.

## 4 — `main` builds and publishes

On merge, `quality` and `e2e` run again; once both are green **and** the
per-arch `docker` builds are done, `docker-merge` publishes two multi-arch
images to GHCR (`ghcr.io/<owner>/<repo>` and `.../migrate`), tagged
`sha-<short>` and `latest`. Nothing is deployed yet — this just makes the
image available. Full mechanics: [CI/CD → How a merge becomes a live
deploy](ci-cd.md#how-a-merge-becomes-a-live-deploy).

## 5 — Cut a release

```bash
# bump "version" in package.json, update CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
git tag -a vX.Y.Z -m "short title"
git push origin main --tags
```

Push the tag **after** `main`'s CI has gone green for that commit — the
`release` job re-tags the already-published image with the semver and moves
the floating `stable` tag in ~30s (no rebuild) and creates the GitHub Release
entry. Push it before, and the same job just waits for `main`'s build first —
still correct, just not the ~30s fast path. Detail: [CI/CD → Release
fast-path](ci-cd.md#release-fast-path--a-v-tag-re-tags-it-does-not-rebuild).

## 6 — The box picks it up

A Mac mini (or any host) running the recommended **Tier B** pull timer
notices the moved `stable` tag on its next poll (≤60s) and runs `make deploy`
itself — pull the new image, run the one-shot migration, restart the app
behind the tunnel. No push from CI reaches the box; it only ever pulls.

```bash
make deploy-timer            # one-time: install the poll timer (default 60s)
```

Confirm the box's `.env` has `APP_TAG="stable"` (the default recommendation —
see [Self-hosting → Tier B](self-hosting.md#tier-b-recommended--pull-with-make-deploy)).
Watch which build actually landed in the running app's **Settings → Build**
card, or re-verify from the CLI:

```bash
URL=https://app.yourdomain.com make tunnel-verify
```

## 7 — First time on a fresh box

If the box has never run this app, `make setup` does steps 6–7 in one guided
pass — secrets, tunnel mode (quick/guided/automated), seed, verify. Full
walkthrough: [Self-hosting](self-hosting.md).

For an **always-on Mac mini** specifically, boot persistence is a separate,
one-time concern from the deploy flow above:

```bash
make autostart                # login LaunchAgent: waits for Docker, then `make tunnel-up`
```

Plus, outside this repo: enable **auto-login**, set the container runtime to
**start at login**, and disable sleep (`sudo pmset -a sleep 0 disablesleep 1
womp 1`). Detail: [Self-hosting → Running on a Mac mini](self-hosting.md#running-on-a-mac-mini-always-on).

## 8 — Rollback

A rollback is just re-pinning the tag, not reverting code on the box:

```bash
# on the box, in .env:
APP_TAG="0.7.0"      # the previous known-good release
make deploy
```

---

## Where things live, at a glance

| Concern                               | Doc                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Branching, commits, PR process        | [CONTRIBUTING.md](../CONTRIBUTING.md)                                      |
| What CI actually runs, job by job     | [CI/CD](ci-cd.md)                                                          |
| Cloudflare Tunnel setup, `make setup` | [Self-hosting](self-hosting.md)                                            |
| Mac mini boot persistence & sizing    | [Self-hosting → Mac mini](self-hosting.md#running-on-a-mac-mini-always-on) |
| Terraform / dashboard tunnel commands | [Deployment](deployment.md)                                                |
| Nightly backups & restore             | [Backups](backups.md)                                                      |
| Troubleshooting a stuck deploy        | [Self-hosting → Troubleshooting](self-hosting.md#troubleshooting)          |
