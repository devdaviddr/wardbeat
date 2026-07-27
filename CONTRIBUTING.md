# Contributing

Thanks for your interest in improving this project. For the full path from a
feature branch to a live deploy on your own box (this doc + CI + Cloudflare
Tunnel, tied together), see [Feature → Production](docs/workflow.md).

## Getting set up

See [docs/usage.md](docs/usage.md) for prerequisites and the local setup. In short:

```bash
pnpm install
cp .env.example .env && npx auth secret   # paste into .env
pnpm docker:db && pnpm docker:minio && pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Workflow

1. For a non-trivial feature, write a spec first. **WardBeat releases** use the
   per-release structure in [`specs/releases/`](specs/releases/README.md) — copy
   `specs/releases/_templates/{spec.md,spec-imp.md}` into a `vX.Y.Z-slug/` folder
   (`spec.md` = what/why, `spec-imp.md` = implementation plan). For a one-off change,
   the flat [`specs/TEMPLATE.md`](specs/TEMPLATE.md) as `Proposed` is fine
   (see [`specs/README.md`](specs/README.md)).
2. Branch off `main`: `feature/<slug>`. There is no `develop` branch — `main`
   is the only long-lived branch.
3. Make your change with tests where it makes sense.
4. Run the full gate locally before pushing:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```

5. Open a pull request into `main`. **CI is deferred at this stage** — the
   GitHub Actions pipelines have been removed, so the local gate in step 4
   (lint · typecheck · unit · build; add `pnpm test:e2e` for the full suite) is
   the gate that matters. Run it before every push. To cut a release, bump the
   version, set the spec to `Shipped`, update `CHANGELOG.md`, and push a
   `vX.Y.Z` tag on `main` — the tag defines the release (there's no required
   `Release vX.Y.Z` merge commit; tag a plain commit directly). Automated
   deploy-on-tag returns when CI is re-introduced.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org),
enforced by a `commit-msg` hook (commitlint). Examples:

```
feat: add password reset flow
fix(auth): reject expired reset tokens
docs: document the rate limiter
chore(deps): bump next to 16.3
```

A Husky `pre-commit` hook also runs ESLint + Prettier on staged files.

## Code style

- TypeScript strict mode; no `any` without justification.
- Prettier + ESLint are the source of truth — don't hand-format.
- Keep server-only code out of client components (`server-only` guards this).
