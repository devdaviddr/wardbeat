# Self-hosting

[← Back to README](../README.md)

Take WardBeat from a fresh clone to a live app on **your own domain** —
served over HTTPS through a **Cloudflare Tunnel**, with no open ports, no reverse
proxy, and no certificate management. One command does the whole thing:

```bash
make setup
```

This guide is the **journey** (clone → live). For per-command reference and the
individual `make tunnel-*` targets, see [deployment.md](deployment.md); for the
CI pipeline see [ci-cd.md](ci-cd.md); for day-2 data safety see
[backups.md](backups.md); for the full loop from a feature branch to a deploy
on this box, see [Feature → Production](workflow.md).

---

## What `make setup` does

`make setup` runs [`scripts/setup.sh`](../scripts/setup.sh), a guided wizard that
**orchestrates the existing deployment primitives** — it doesn't replace them.
Each step is announced before it runs:

```text
preflight ─▶ secrets (.env: AUTH_SECRET, AI service token) ─▶ choose mode
   ├─ quick     → trycloudflare.com URL (no account)
   ├─ guided    → your domain, token pasted from the dashboard
   └─ automated → your domain, provisioned by Terraform
                          │
     seed demo admin ─────┴─▶ verify (health + HSTS + CSP) ─▶ summary (URL + login)
```

It is **idempotent** — safe to re-run. It never rotates an existing
`AUTH_SECRET` without asking (rotation logs everyone out and voids outstanding
password-reset/verification tokens), and it writes `.env` and any Terraform vars
`chmod 600`, never printing secrets. It also generates
`WARDBEAT_AI_SERVICE_TOKEN`, the shared secret between the app and the internal
AI plane, which the production stack requires.

The stack it brings up includes the **AI plane** (`ai` service, internal-only —
never exposed through the tunnel). By default it runs in offline mock mode
(`NIM_MOCK=true`): deterministic AI stubs, no NVIDIA key, no external calls. To
go live, set `NIM_MOCK=false` and `NVIDIA_API_KEY` in `.env` and recreate the
`ai` service — see [AI design](ai-design.md) and [`ai/README.md`](../ai/README.md).

---

## Prerequisites

| Requirement         | For                | Notes                                                           |
| ------------------- | ------------------ | --------------------------------------------------------------- |
| Docker + Compose    | all modes          | Compose **≥ v2.24** (the tunnel overlays use a newer merge).    |
| `openssl`           | all modes          | Generates `AUTH_SECRET`. Present on macOS/Linux by default.     |
| A Cloudflare domain | guided / automated | A domain added to your Cloudflare account (free plan is fine).  |
| `terraform`         | automated only     | Provisions the tunnel + DNS.                                    |
| A scoped API token  | automated only     | **Account → Cloudflare Tunnel: Edit** and **Zone → DNS: Edit**. |

Cloudflare Tunnel itself is free (Zero Trust free tier). Windows: run inside WSL.

---

## Choose your mode

### 1. Quick — instant demo, no account

Best for kicking the tyres. You get a random public
`https://<something>.trycloudflare.com` URL that lasts as long as the stack runs.

```bash
make setup            # pick "quick"
# → prints the live URL, seeds demo@example.com / Password123, verifies
```

The URL is **ephemeral** — every quick run gets a new one. Use a named tunnel
(below) for anything stable.

### 2. Guided — your domain, token from the dashboard

You create the tunnel by hand in Cloudflare and paste its token; the wizard wires
the rest.

1. Cloudflare **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared).
2. Copy the **token** it shows.
3. Add a **public hostname**: `app.yourdomain.com` → `http://app:3000`
   (Cloudflare creates the DNS record for you).
4. Run `make setup`, pick **guided**, and paste the token + hostname.

The wizard stores the token in `.env`, sets `AUTH_URL=https://app.yourdomain.com`
(the single most-missed manual step), brings the stack up, seeds, and verifies.

### 3. Automated — your domain, provisioned by Terraform

The wizard collects four Cloudflare inputs, writes
`infra/cloudflare/terraform.tfvars` (0600), and runs the Terraform module that
creates the tunnel, its ingress, and the DNS record — then starts everything.

```bash
make setup            # pick "automated"
#   Cloudflare API token …
#   account id … / zone id … / hostname app.yourdomain.com
# → terraform apply → tunnel up → seed → verify → live URL
```

Find your **account ID** and **zone ID** on the domain's overview page in the
Cloudflare dashboard. Create the API token under **My Profile → API Tokens** with
the two scopes listed in Prerequisites.

---

## Non-interactive / scripted

Every prompt can be supplied via the environment, for CI or repeatable installs:

```bash
# Quick, unattended:
SETUP_MODE=quick SETUP_YES=1 make setup

# Automated, unattended:
SETUP_MODE=automated SETUP_YES=1 \
  CF_API_TOKEN=cf_xxx CF_ACCOUNT_ID=… CF_ZONE_ID=… \
  TUNNEL_HOSTNAME=app.yourdomain.com \
  make setup
```

| Variable                  | Mode             | Purpose                            |
| ------------------------- | ---------------- | ---------------------------------- |
| `SETUP_MODE`              | all              | `quick` \| `guided` \| `automated` |
| `SETUP_YES=1`             | all              | Assume "yes" to confirmations      |
| `NO_SEED=1`               | all              | Skip seeding the demo admin        |
| `CLOUDFLARE_TUNNEL_TOKEN` | guided           | Dashboard-issued tunnel token      |
| `TUNNEL_HOSTNAME`         | guided/automated | Public hostname                    |
| `CF_API_TOKEN`            | automated        | Scoped Cloudflare API token        |
| `CF_ACCOUNT_ID`           | automated        | Cloudflare account ID              |
| `CF_ZONE_ID`              | automated        | Zone ID of the domain              |

Run `./scripts/setup.sh --help` for the same summary.

---

## Deploy with an AI agent (Claude Code / opencode)

This repo ships a **`self-host` skill** for both [Claude Code](https://claude.ai/code)
and [opencode](https://opencode.ai), so you can just tell your agent _"self-host
this on my domain"_ and it drives the flow for you — picking the right mode,
collecting your Cloudflare inputs, running the wizard, and verifying.

| Tool        | Skill location (in this repo)         |
| ----------- | ------------------------------------- |
| Claude Code | `.claude/skills/self-host/SKILL.md`   |
| opencode    | `.opencode/skills/self-host/SKILL.md` |

Both are the same [Agent Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
format and are picked up automatically when you open this project in the
respective tool — no install step. The skill is a thin runbook over
`make setup`: it never prints secrets, never rotates an existing `AUTH_SECRET`
without asking, and hands off to this guide for the details. Invoke it explicitly
with `/self-host`, or just describe the goal ("deploy this to `app.mydomain.com`")
and let the agent trigger it.

> The skill **orchestrates**; it doesn't bypass anything here. Everything it runs
> is a command you can run yourself from this page.

---

## Continuous deployment

> **Deferred:** the CI half described here — GitHub Actions publishing images to
> GHCR on every green run — is **not currently wired** (WardBeat removed the
> pipelines; there is no `.github/workflows/`). The local paths (`make setup`,
> `make deploy`) are real and work today; the auto-publish-on-merge is the target
> design for when CI is re-introduced. See [CI/CD](ci-cd.md).

`make setup` gets you live the first time; **continuous deployment** keeps a
running box up to date as you push new code. When CI is re-introduced it will
build a production image on every green run; CD just ships it. Because the box is **outbound-only** (the
tunnel opens no inbound ports), both paths below are **pull-based**: the box
reaches out for the new image; nothing reaches in.

On merge to `main`, `ci.yml` publishes two images to
the GitHub Container Registry, **only after `quality` + `e2e` pass**:

- `ghcr.io/<owner>/<repo>` — the app (production `runner` image).
- `ghcr.io/<owner>/<repo>/migrate` — the migrator (`builder` image; the app image
  can't run migrations itself).

A `v*` **release tag does not rebuild** — it re-tags the image `main` already built
for that commit with the semver **and moves the floating `stable` tag** (~30s),
applying the deployed version at runtime from `APP_TAG`. For the fastest release, push the tag **after** `main`'s CI is green
(see [docs/ci-cd.md → Release fast-path](ci-cd.md#release-fast-path--a-v-tag-re-tags-it-does-not-rebuild)
and [spec 0024](../specs/0024-faster-time-to-deploy.md)).

### Tier B (recommended) — pull with `make deploy`

Point the box at the published image and update with one command. In the box's
`.env`:

```bash
APP_IMAGE="ghcr.io/devdaviddr/wardbeat"
APP_TAG="stable"        # newest RELEASE — moves when a v* tag is pushed (recommended)
# APP_TAG="latest"      # every green main merge (trunk tracking, no release gate)
# APP_TAG="0.7.0"      # pin an exact release — never moves; bump it to update
```

`APP_TAG` is the whole deployment policy: it decides **what** lands on the box and
**when**. With a floating tag (`stable`/`latest`), Settings → Build shows the tag
(`stable · <sha7>`) rather than a version number — the SHA still pins the exact
commit; pin a semver if you want the number displayed.

Then, to update:

```bash
make deploy    # docker compose pull → up -d  (prod + deploy + tunnel overlays)
```

The `deploy` overlay (`docker-compose.deploy.yml`) is what switches the stack
from "build locally" to "pull the published image `APP_IMAGE:APP_TAG` from
GHCR" — it's the piece that makes `make deploy` a pull, not a rebuild.

`make deploy` pulls both images, runs the one-shot **migrate** (it gates the app
via `depends_on`, so schema changes apply **before** the new app starts), then
restarts the app behind the tunnel — **no building on the box**. If the package
is private, `docker login ghcr.io` once on the box with a read-only PAT.

**Automate it (macOS)** — install a launchd timer that runs `make deploy` on an
interval so new releases roll out unattended:

```bash
make deploy-timer                              # every 60s (default; digest-skipped)
./scripts/macos-deploy-timer.sh install 300    # or a custom interval (≥ 60s)
./scripts/macos-deploy-timer.sh status         # is it loaded?
./scripts/macos-deploy-timer.sh uninstall
```

Each tick refreshes the checkout (`git pull --ff-only`, best-effort), copies the
operator's off-checkout `.env` from `~/.config/wardbeat/.env`
(override with `DEPLOY_ENV_FILE`) into the project dir, then **checks whether the
published app image actually changed** — it refreshes only that image's manifest and
compares its digest to the last-deployed one (`~/.config/<repo>/.last-deployed-image`).
An unchanged tick exits immediately; only a new digest triggers the full
`make deploy` (pull + migrate + recreate). That makes the short 60s interval nearly
free, so the box lands a new release within ~a minute; watch which build is live in
the app's **Settings → Build** card.

> Already running an older timer? Re-run `make deploy-timer` to regenerate the
> plist at the new default interval (the old 300s interval is baked into the
> installed plist until you reinstall).

**Rollback** is just re-pinning: set `APP_TAG` to the previous version (or a
commit `sha` tag) and run `make deploy` again.

### Tier C (private repos only) — push-button on tag, via a self-hosted runner

> 🚫 **Do not use Tier C on a public repo.** A self-hosted runner on a public
> repository is the setup GitHub warns against: a fork pull request can add a
> workflow that runs on `[self-hosted]` and, once approved, executes **arbitrary
> code on your box and home network**. The `SELF_HOSTED_DEPLOY` gate does not
> help — a malicious fork brings its own workflow. On a public repo, use **Tier B
> (`make deploy-timer`)** above, which has no runner and no such surface.

For a **private/trusted** repo wanting true "tag a release → it deploys itself",
register your box as a **GitHub self-hosted runner** and enable the shipped
`deploy.yml`:

1. Add a self-hosted runner on the box (GitHub → Settings → Actions → Runners).
   The runner **dials out** to GitHub, so it works behind the tunnel.
2. Put the box's config at
   `~/.config/wardbeat/.env` (chmod 600) — the runner's
   checkout is wiped every run (`git clean`), so `.env` can't live in the work
   tree. It needs at least `AUTH_SECRET`, `WARDBEAT_AI_SERVICE_TOKEN`,
   `AUTH_URL`, `CLOUDFLARE_TUNNEL_TOKEN`, `APP_IMAGE` (and optionally
   `APP_TAG`). Override
   the path with a `DEPLOY_ENV_FILE` env var on the runner if you prefer.
3. Set the repo variable `SELF_HOSTED_DEPLOY = true` (Settings → Secrets and
   variables → Actions → Variables). Until you do, `deploy.yml` is skipped.
4. Push a `v*` tag — the runner copies that env file into the checkout and runs
   `make deploy` on the box.

> ⚠️ Even on a private repo, a self-hosted runner executes workflow code on your
> network — prefer an **ephemeral**, low-privilege runner. Tier B (pull) avoids
> this entirely and is the recommended default.

### Note on Watchtower

[Watchtower](https://containrrr.dev/watchtower/) can auto-pull the updated `app`
container, but it **won't run the one-shot `migrate`** — so it silently skips
schema changes and is only safe for migration-free releases. Prefer `make deploy`,
which always migrates first. If you use Watchtower anyway, run migrations
yourself on any release that changes the schema.

---

## Day-2 operations

```bash
# Follow logs (app + cloudflared):
docker compose -f docker-compose.prod.yml -f docker-compose.tunnel.yml logs -f

make tunnel-down     # stop the tunnel stack (keeps data)
make tunnel-up       # start it again

# Update to a newer cloudflared:
docker compose -f docker-compose.prod.yml -f docker-compose.tunnel.yml pull cloudflared
make tunnel-up
```

- **Backups** — the production stack runs nightly Postgres + MinIO backup
  sidecars; restore runbook in [backups.md](backups.md).
- **Re-verify anytime** — `URL=https://app.yourdomain.com make tunnel-verify`.
- **Teardown** — `docker compose -f docker-compose.prod.yml down -v` removes
  containers and data; in automated mode, `make tunnel-destroy` also removes the
  Cloudflare tunnel + DNS record.

---

## Running on a Mac mini (always-on)

A Mac mini is a great single-box host for this stack, but macOS needs a little
hardening to survive reboots unattended:

**1. Boot persistence — one command:**

```bash
make autostart          # installs a login LaunchAgent (see scripts/macos-autostart.sh)
```

The agent waits for the Docker engine at login, then runs `make tunnel-up`
(pass a target for pull-based updates instead:
`./scripts/macos-autostart.sh install deploy`). Check it with
`./scripts/macos-autostart.sh status`; logs land in `~/Library/Logs/`.
Containers already use `restart: unless-stopped`, so the agent only needs to
cover the reboot case. For it to work unattended you also need:

- **Auto-login** (System Settings → Users & Groups → Automatically log in) —
  LaunchAgents run at login, and Docker Desktop needs a GUI session.
- Your **container runtime set to start at login** (a Docker Desktop /
  OrbStack setting).
- **No sleep:** `sudo pmset -a sleep 0 disablesleep 1 womp 1`

For **unattended updates** on top of boot persistence, add the Tier B pull timer
(`make deploy-timer`, above) — the box then keeps itself current on each release
with no self-hosted runner.

**2. Container runtime.** Docker Desktop works out of the box (Apple Silicon
native). [OrbStack](https://orbstack.dev) or Colima are lighter and friendlier
for a headless server — the wizard and Makefile work identically with any of
them (they all provide `docker` + `compose`).

**3. Sizing.** Give the Docker VM **≥ 4 GB memory** (8 GB comfortable) for
Postgres + MinIO + the app + backup sidecars — Docker Desktop → Settings →
Resources. Watch `docker stats` under load.

**4. Backups & Time Machine.** The nightly dumps land in `./backups` on the
same disk as the data, and the Docker **volumes** (`pgdata`, `miniodata`) live
inside Docker's Linux VM where **Time Machine does not reach them**. The dumps
in `./backups` _are_ Time-Machine-covered, but for real disk-failure resilience
enable the **offsite copy** (Cloudflare R2/S3) or point `./backups` at an
external drive — see [backups.md](backups.md#optional-offsite-copy-disk-failure-resilience).

---

## Troubleshooting

| Symptom                                                       | Fix                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preflight: Compose too old**                                | Upgrade Docker Desktop / the compose plugin to ≥ v2.24.                                                                                                                                                                                                                                                                                                                               |
| **Port 3000 already in use**                                  | Only affects the plain `docker-compose.prod.yml`; tunnel modes publish no host port. Stop the other process (e.g. a stray `pnpm dev`).                                                                                                                                                                                                                                                |
| **502 / Bad gateway**                                         | App not ready yet, or the ingress target is wrong — it must be `http://app:3000` (the Compose service name), never `localhost`.                                                                                                                                                                                                                                                       |
| **Login loop / cookies drop**                                 | `AUTH_URL` must be the exact public `https://…` URL and `AUTH_TRUST_HOST=true` (both set for you by the wizard).                                                                                                                                                                                                                                                                      |
| **Tunnel won't connect**                                      | Check the token (`make tunnel-token`) and `cloudflared` logs; a token is bound to one tunnel.                                                                                                                                                                                                                                                                                         |
| **503 everywhere + "No ingress rules" in `cloudflared` logs** | The tunnel is _locally-managed_ (created with `cloudflared tunnel create`), so a token-run daemon gets no remote config. Create tunnels in the **dashboard** or via **Terraform** (both remotely-managed), or push a remote config: the token embedded in `~/.cloudflared/cert.pem` (`ARGO TUNNEL TOKEN` block → base64 JSON `.apiToken`) can `PUT …/cfd_tunnel/<id>/configurations`. |
| **Quick URL changed**                                         | It's ephemeral by design — use guided/automated for a stable domain.                                                                                                                                                                                                                                                                                                                  |
| **Rate limiting sees wrong IP**                               | Traffic must arrive via Cloudflare so `CF-Connecting-IP` is present; direct origin hits won't have it.                                                                                                                                                                                                                                                                                |
| **`make deploy` / timer tick fails — `.env` not found**       | The box's `.env` needs at least `AUTH_SECRET`, `WARDBEAT_AI_SERVICE_TOKEN`, `AUTH_URL`, `CLOUDFLARE_TUNNEL_TOKEN`, and `APP_IMAGE` (+ optionally `APP_TAG`). `make deploy` reads the project-dir `.env`; `make deploy-timer` copies it in each tick from `~/.config/wardbeat/.env` — override the source path with `DEPLOY_ENV_FILE`.                                                 |

---

## How it works (one diagram)

```text
User ──HTTPS──▶  Cloudflare edge  ◀══ outbound tunnel ══  cloudflared ──▶ app:3000
                 (terminates TLS)                          (in Docker)
```

`cloudflared` dials **out** to Cloudflare and holds the connection open; no
inbound ports are opened on your host. Auth trusts the proxied host
(`AUTH_TRUST_HOST` + `AUTH_URL`) and reads the real client IP from
`CF-Connecting-IP`. Deeper detail: [architecture.md](architecture.md) and
[deployment.md](deployment.md).
