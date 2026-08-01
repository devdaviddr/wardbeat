# Deployment — Cloudflare Tunnel

[← Back to README](../README.md)

Expose the Docker container on a Cloudflare-managed domain over HTTPS via
**Cloudflare Tunnel** — no open ports, no reverse proxy, no certificate
management. The `cloudflared` daemon makes an outbound-only connection to
Cloudflare's edge, which terminates TLS and routes traffic back down the tunnel.

This keeps the existing stack (`docker-compose.prod.yml`: app + db + migrator)
unchanged; the tunnel is an opt-in overlay.

Three on-ramps, all converging on the same runtime:

| Path                      | Command                                     | Cloudflare account? |
| ------------------------- | ------------------------------------------- | ------------------- |
| **Quick tunnel** (demo)   | `make tunnel-quick`                         | ❌ none             |
| **Guided** (dashboard)    | see [Option B](#option-b--guided-dashboard) | ✅                  |
| **Automated** (Terraform) | `make tunnel-provision && make tunnel-up`   | ✅ + API token      |

> In tunnel modes the app has **no published host ports** — it's reachable only
> through the tunnel.

## How it works

`cloudflared` dials **out** to Cloudflare and holds the connection open;
Cloudflare terminates TLS for your domain and pushes matching requests down
that connection to the app container over the internal Docker network — no
inbound ports are opened on your host. Full diagram and deeper walkthrough:
[self-hosting.md → How it works](self-hosting.md#how-it-works-one-diagram)
and [architecture.md](architecture.md).

## Prerequisites

- Docker + Docker Compose (v2.24+ — the deploy compose files use a newer
  Compose merge feature).
- A `.env` with at least `AUTH_SECRET`, `WARDBEAT_AI_SERVICE_TOKEN`, and
  `DATABASE_URL` (see [`.env.example`](../.env.example)); `make setup`
  generates the secrets.
- For named tunnels: a domain on Cloudflare and (for the automated path) a
  scoped API token — **Account → Cloudflare Tunnel: Edit**, **Zone → DNS: Edit**.

## Environment variables

| Variable                                       | Used by                | Notes                                                      |
| ---------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `AUTH_SECRET`                                  | runtime (all modes)    | required                                                   |
| `WARDBEAT_AI_SERVICE_TOKEN`                    | runtime (all modes)    | required — app↔ai shared secret; `make setup` generates it |
| `CLOUDFLARE_TUNNEL_TOKEN`                      | runtime (named tunnel) | from `make tunnel-provision` or the dashboard              |
| `AUTH_URL`                                     | runtime (named tunnel) | your public `https://…` URL                                |
| `CLOUDFLARE_API_TOKEN`                         | provisioning           | scoped: Tunnel:Edit + DNS:Edit                             |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_ID` | provisioning           | from the Cloudflare dashboard                              |
| `TUNNEL_HOSTNAME`                              | provisioning           | e.g. `app.example.com`                                     |

Runtime vars go in `.env`; provisioning vars are best kept in
`infra/cloudflare/terraform.tfvars` (gitignored). See [`.env.example`](../.env.example).

## Quick tunnel (no account)

Instant public preview on a random `*.trycloudflare.com` URL:

```bash
make tunnel-quick
```

The URL is printed in the `cloudflared` logs. `AUTH_TRUST_HOST=true` (set in the
compose app) makes auth work on the random hostname.

## Option A — Automated (Terraform)

Provisions the tunnel, its ingress, and the DNS record, then wires the token in.

```bash
cp infra/cloudflare/terraform.tfvars.example infra/cloudflare/terraform.tfvars
# edit terraform.tfvars: api token, account id, zone id, hostname

make tunnel-provision          # terraform apply + writes CLOUDFLARE_TUNNEL_TOKEN to .env
# set AUTH_URL=https://<hostname> in .env
make tunnel-up                 # start the stack behind the tunnel
URL=https://<hostname> make tunnel-verify
```

Details and the token scopes are in [`infra/cloudflare/`](../infra/cloudflare/README.md).
Tear down with `make tunnel-destroy`.

## Option B — Guided (dashboard)

Produces the same `CLOUDFLARE_TUNNEL_TOKEN` + DNS record by hand:

1. Zero Trust → **Networks → Tunnels → Create a tunnel** (Cloudflared). Copy the
   **token** it shows.
2. Put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`, and set
   `AUTH_URL=https://app.yourdomain.com`.
3. Add a **public hostname**: `app.yourdomain.com` → `http://app:3000`
   (Cloudflare creates the DNS record automatically).
4. Start it and verify:

   ```bash
   make tunnel-up
   URL=https://app.yourdomain.com make tunnel-verify
   ```

## How the app runs behind the tunnel

- **`AUTH_TRUST_HOST=true`** + **`AUTH_URL`** so Auth.js trusts the proxied host
  and issues secure cookies over HTTPS.
- **Client IP** is read from `CF-Connecting-IP` (set by Cloudflare, unspoofable)
  for rate limiting — see `src/lib/request-ip.ts`.
- HSTS / CSP / hardening headers are served from the origin as usual.

## Operating

```bash
make tunnel-up       # start (detached)
make tunnel-down     # stop (keeps data)
# follow the daemon's logs:
docker compose -f docker-compose.prod.yml -f docker-compose.tunnel.yml logs -f cloudflared
```

Update `cloudflared` by re-pulling the image:
`docker compose -f docker-compose.prod.yml -f docker-compose.tunnel.yml pull cloudflared && make tunnel-up`.

## Troubleshooting

Full table (all symptoms, including deploy/timer failures):
[self-hosting.md → Troubleshooting](self-hosting.md#troubleshooting). The one
specific to this doc's Terraform path: if `make tunnel-provision` succeeds but
the tunnel never connects, re-check the API token's two scopes (Prerequisites,
above) — a token missing either **Tunnel: Edit** or **DNS: Edit** fails silently
partway through provisioning.

## Notes

- Cloudflare Tunnel is free (Zero Trust free tier).
- For production, use managed Postgres and a remote Terraform state backend.
- Optional: gate the app (or staging) with **Cloudflare Access** for an
  edge SSO layer in front of the app's own auth.
