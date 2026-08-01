#!/usr/bin/env bash
# One-click self-hosting setup — see docs/self-hosting.md and specs/0020.
#
# Takes a fresh clone to a running instance behind Cloudflare Tunnel. This is a
# thin ORCHESTRATOR over primitives that already exist (spec 0005): the
# docker-compose.*tunnel.yml overlays, infra/cloudflare Terraform, and the
# `make tunnel-*` targets. It generates secrets, wires .env, runs the chosen
# on-ramp, seeds an admin, and verifies — nothing here re-implements deployment.
#
# Interactive:      make setup   (or ./scripts/setup.sh)
# Non-interactive:  SETUP_MODE=automated CF_API_TOKEN=… CF_ACCOUNT_ID=… \
#                     CF_ZONE_ID=… TUNNEL_HOSTNAME=app.example.com \
#                     SETUP_YES=1 ./scripts/setup.sh
set -euo pipefail

# --- locate repo root (works from anywhere) --------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env"
TFVARS="infra/cloudflare/terraform.tfvars"
MIN_COMPOSE="2.24"
DEMO_EMAIL="demo@example.com"
DEMO_PASSWORD="Password123"

# --- pretty output ----------------------------------------------------------
if [ -t 1 ]; then B=$'\033[1m'; C=$'\033[36m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; X=$'\033[0m'
else B=''; C=''; G=''; Y=''; R=''; X=''; fi
step() { printf '\n%s▸ %s%s\n' "$B" "$1" "$X"; }
info() { printf '  %s\n' "$1"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$X" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$1"; }
die()  { printf '\n%s✗ %s%s\n' "$R" "$1" "$X" >&2; exit 1; }

usage() {
  cat <<EOF
${B}make setup${X} — guided self-hosting for this boilerplate.

Modes (SETUP_MODE, or chosen interactively):
  quick       Ephemeral *.trycloudflare.com URL. No Cloudflare account.
  guided      Named tunnel from a dashboard-issued token you paste in.
  automated   Named tunnel provisioned end-to-end via Terraform.

Non-interactive env vars:
  SETUP_MODE=quick|guided|automated   SETUP_YES=1   NO_SEED=1
  guided:     CLOUDFLARE_TUNNEL_TOKEN   TUNNEL_HOSTNAME
  automated:  CF_API_TOKEN  CF_ACCOUNT_ID  CF_ZONE_ID  TUNNEL_HOSTNAME

Flags: -h|--help
EOF
}

# --- .env helpers: update-in-place or append, never touching other keys -----
env_active() { # is KEY set (uncommented, non-empty) in .env?
  grep -qE "^$1=.+" "$ENV_FILE" 2>/dev/null
}
set_env() { # set_env KEY VALUE — awk rewrite (no sed delimiter/escaping traps)
  local key="$1" val="$2" tmp
  if grep -qE "^$key=" "$ENV_FILE" 2>/dev/null; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$val" '
      BEGIN{FS="="}
      $1==k {print k "=\"" v "\""; done=1; next}
      {print}
    ' "$ENV_FILE" >"$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '%s="%s"\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

confirm() { # confirm "question" — respects SETUP_YES / non-TTY
  [ "${SETUP_YES:-0}" = "1" ] && return 0
  [ -t 0 ] || return 1
  local reply
  printf '  %s [y/N] ' "$1"; read -r reply
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}
ask() { # ask VAR "prompt" [existing] — read into VAR, keep existing if given
  local __var="$1" __prompt="$2" __existing="${3:-}" __in
  if [ -n "$__existing" ]; then printf -v "$__var" '%s' "$__existing"; return; fi
  [ -t 0 ] || die "Missing required value for '$__prompt' in non-interactive mode."
  printf '  %s: ' "$__prompt"; read -r __in
  [ -n "$__in" ] || die "'$__prompt' cannot be empty."
  printf -v "$__var" '%s' "$__in"
}

version_ge() { # 0 if $1 >= $2 (dotted numeric)
  awk -v a="$1" -v b="$2" 'BEGIN{
    na=split(a,x,"."); nb=split(b,y,".");
    n=(na>nb)?na:nb;
    for(i=1;i<=n;i++){xi=(i<=na)?x[i]+0:0; yi=(i<=nb)?y[i]+0:0;
      if(xi>yi){exit 0} if(xi<yi){exit 1}} exit 0}'
}

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
preflight() {
  step "Preflight checks"
  command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/get-docker/"
  # `docker version` (not `docker info`, which can hang on some Podman machines)
  # to confirm the engine is reachable.
  docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || die "Docker daemon isn't running. Start Docker and re-run."
  ok "Docker is running"

  local have
  have="$(docker compose version --short 2>/dev/null | sed 's/^v//')" \
    || die "Docker Compose v2 not found (need the 'docker compose' plugin)."
  if version_ge "$have" "$MIN_COMPOSE"; then ok "Docker Compose $have (≥ $MIN_COMPOSE)"
  else die "Docker Compose $have is too old; need ≥ $MIN_COMPOSE (the tunnel overlays use a newer merge feature)."; fi

  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate AUTH_SECRET."
  ok "openssl present"

  [ -f .env.example ] || die ".env.example not found — clone the full repository (no sparse checkout)."
  ok ".env.example present"

  if [ "$MODE" = "automated" ]; then
    command -v terraform >/dev/null 2>&1 \
      || die "Automated mode needs Terraform on PATH. Install it, or pick 'guided' mode."
    ok "terraform present"
  fi
}

# ---------------------------------------------------------------------------
# 2. Secrets / .env
# ---------------------------------------------------------------------------
ensure_env() {
  step "Environment (.env)"
  if [ ! -f "$ENV_FILE" ]; then
    cp .env.example "$ENV_FILE"; chmod 600 "$ENV_FILE"
    ok "Created .env from .env.example"
  else
    ok ".env already present"
  fi
  chmod 600 "$ENV_FILE" 2>/dev/null || true

  # AUTH_SECRET — never silently rotate an existing one (invalidates sessions
  # and any outstanding password-reset / verification tokens).
  if env_active AUTH_SECRET && ! grep -qE '^AUTH_SECRET="?replace-me' "$ENV_FILE"; then
    if confirm "AUTH_SECRET is already set. Rotate it? (invalidates all sessions)"; then
      set_env AUTH_SECRET "$(openssl rand -base64 33)"; ok "Rotated AUTH_SECRET"
    else
      ok "Kept existing AUTH_SECRET"
    fi
  else
    set_env AUTH_SECRET "$(openssl rand -base64 33)"; ok "Generated a strong AUTH_SECRET"
  fi

  # WARDBEAT_AI_SERVICE_TOKEN — the app↔ai shared secret. The AI plane fails
  # closed without it, and docker-compose.prod.yml requires it. Both sides read
  # it from the same key set: keep WARDBEAT_AI_SERVICE_TOKEN (Next.js) and
  # AI_SERVICE_TOKEN (FastAPI, host-run dev) in lockstep. Replace the
  # .env.example dev placeholder with a real secret; keep an existing one.
  if env_active WARDBEAT_AI_SERVICE_TOKEN \
    && ! grep -qE '^WARDBEAT_AI_SERVICE_TOKEN="?dev-service-token' "$ENV_FILE"; then
    ok "Kept existing WARDBEAT_AI_SERVICE_TOKEN"
  else
    local ai_token
    ai_token="$(openssl rand -hex 32)"
    set_env WARDBEAT_AI_SERVICE_TOKEN "$ai_token"
    set_env AI_SERVICE_TOKEN "$ai_token"
    ok "Generated a strong WARDBEAT_AI_SERVICE_TOKEN (app<->ai shared secret)"
  fi
}

# ---------------------------------------------------------------------------
# 3. Mode selection
# ---------------------------------------------------------------------------
choose_mode() {
  if [ -n "${SETUP_MODE:-}" ]; then MODE="$SETUP_MODE"; return; fi
  [ -t 0 ] || die "SETUP_MODE must be set in non-interactive mode (quick|guided|automated)."
  step "Choose a deployment mode"
  cat <<EOF
  ${C}1)${X} quick      — instant public *.trycloudflare.com URL, no account (great for a demo)
  ${C}2)${X} guided     — your domain via a tunnel token you paste from the Cloudflare dashboard
  ${C}3)${X} automated  — your domain, provisioned end-to-end by Terraform (needs an API token)
EOF
  local choice; printf '  Selection [1-3]: '; read -r choice
  case "$choice" in
    1) MODE=quick ;; 2) MODE=guided ;; 3) MODE=automated ;;
    *) die "Invalid selection." ;;
  esac
}

# ---------------------------------------------------------------------------
# 4. Deploy (per mode) — all converge on the compose runtime
# ---------------------------------------------------------------------------
QUICK_COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.quick-tunnel.yml)
PUBLIC_URL=""

deploy_quick() {
  step "Starting the quick-tunnel stack"
  info "AUTH_SECRET + AUTH_TRUST_HOST are enough here; no domain needed."
  "${QUICK_COMPOSE[@]}" up -d --build
  step "Waiting for the trycloudflare.com URL"
  local url=""
  for _ in $(seq 1 60); do
    url="$("${QUICK_COMPOSE[@]}" logs cloudflared 2>/dev/null \
      | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
    [ -n "$url" ] && break
    sleep 2
  done
  [ -n "$url" ] || die "Timed out waiting for the tunnel URL. Check: ${QUICK_COMPOSE[*]} logs cloudflared"
  PUBLIC_URL="$url"; ok "Public URL: $PUBLIC_URL"
}

deploy_named() { # shared by guided + automated after the token exists
  local host="$1"
  set_env AUTH_URL "https://$host"
  ok "Set AUTH_URL=https://$host"
  step "Starting the named-tunnel stack"
  make tunnel-up
  PUBLIC_URL="https://$host"
}

deploy_guided() {
  step "Guided named tunnel"
  info "In the Cloudflare dashboard: Zero Trust → Networks → Tunnels → Create a tunnel"
  info "(Cloudflared). Copy the token it shows, and add a public hostname routed"
  info "to ${C}http://app:3000${X}."
  local token host
  ask token "Paste the tunnel token" "${CLOUDFLARE_TUNNEL_TOKEN:-}"
  ask host  "Public hostname (e.g. app.example.com)" "${TUNNEL_HOSTNAME:-}"
  set_env CLOUDFLARE_TUNNEL_TOKEN "$token"
  ok "Stored tunnel token in .env"
  deploy_named "$host"
}

deploy_automated() {
  step "Automated named tunnel (Terraform)"
  local api acct zone host
  ask api  "Cloudflare API token (Account>Tunnel:Edit, Zone>DNS:Edit)" "${CF_API_TOKEN:-}"
  ask acct "Cloudflare account ID" "${CF_ACCOUNT_ID:-}"
  ask zone "Cloudflare zone ID"    "${CF_ZONE_ID:-}"
  ask host "Public hostname (e.g. app.example.com)" "${TUNNEL_HOSTNAME:-}"

  umask 177  # tfvars holds an API token → 0600
  cat >"$TFVARS" <<EOF
cloudflare_api_token  = "$api"
cloudflare_account_id = "$acct"
cloudflare_zone_id    = "$zone"
hostname              = "$host"
EOF
  umask 022
  ok "Wrote $TFVARS (0600)"

  info "Provisioning the tunnel + DNS (terraform apply)…"
  make tunnel-provision   # applies TF and writes CLOUDFLARE_TUNNEL_TOKEN into .env
  deploy_named "$host"
}

# ---------------------------------------------------------------------------
# 5. Seed + verify + summary
# ---------------------------------------------------------------------------
seed_admin() {
  [ "${NO_SEED:-0}" = "1" ] && { warn "Skipping seed (NO_SEED=1)"; return; }
  step "Seeding the demo admin"
  # `compose run` resolves the migrate service's depends_on (db healthy), so
  # this blocks until Postgres is ready — no explicit wait needed.
  docker compose -f docker-compose.prod.yml run --rm migrate pnpm db:seed
  ok "Admin ready: $DEMO_EMAIL / $DEMO_PASSWORD"
}

verify() {
  step "Verifying the deployment"
  # Give a freshly-connected tunnel a moment before probing over HTTPS.
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$PUBLIC_URL/api/health" 2>/dev/null; then break; fi
    sleep 2
  done
  URL="$PUBLIC_URL" ./scripts/tunnel-verify.sh || warn "Verify reported issues — see output above."
}

summary() {
  step "Done"
  printf '  %sYour app is live:%s %s%s%s\n' "$B" "$X" "$C" "$PUBLIC_URL" "$X"
  [ "${NO_SEED:-0}" = "1" ] || printf '  %sLogin:%s %s / %s\n' "$B" "$X" "$DEMO_EMAIL" "$DEMO_PASSWORD"
  cat <<EOF

  Next steps:
    Logs:      docker compose -f docker-compose.prod.yml -f docker-compose.tunnel.yml logs -f
    Stop:      make tunnel-down                 (keeps data)
    Teardown:  docker compose -f docker-compose.prod.yml down -v   (wipes data)$([ "$MODE" = automated ] && printf '\n    Destroy tunnel/DNS:  make tunnel-destroy')

  Full guide: docs/self-hosting.md
EOF
}

# ---------------------------------------------------------------------------
main() {
  case "${1:-}" in -h|--help) usage; exit 0 ;; esac
  printf '%s┌─ Self-hosting setup ──────────────────────────────┐%s\n' "$B" "$X"
  MODE="${SETUP_MODE:-}"
  [ -z "$MODE" ] && choose_mode
  case "$MODE" in quick|guided|automated) ;; *) die "Unknown mode '$MODE' (quick|guided|automated)." ;; esac
  preflight
  ensure_env
  case "$MODE" in
    quick)     deploy_quick ;;
    guided)    deploy_guided ;;
    automated) deploy_automated ;;
  esac
  seed_admin
  verify
  summary
}

main "$@"
