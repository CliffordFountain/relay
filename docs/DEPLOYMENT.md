# Deploying and configuring Relay

How to run Relay for real — configuration, backups, and what to lock down before you put it
on the internet. For day-to-day use of the app, see [USER-GUIDE.md](./USER-GUIDE.md).

## Running it

Everything runs in Docker. From the project folder:

```sh
docker compose up -d
```

That brings up the whole stack (client, API, gateway, voice, data layer, Postgres, Redis,
Elasticsearch, MinIO) and, on Windows, `Relay.bat` does the same with a double-click. The
client is at `https://localhost:5173`. The first run builds everything and takes a few
minutes; later runs are quick.

To change anything, copy `.env.example` to `.env` and edit it — Compose reads `.env`
automatically. Every variable in `.env.example` is consumed by `docker-compose.yml`, and an
unedited copy reproduces the local defaults. (Ports and internal service URLs are fixed in
`docker-compose.yml` itself, not in `.env`.)

## Configuration you'll actually touch

| Setting | What it does |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials. Change the password for any real deployment — the API, backup sidecar and data layer all read these same values. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO root credentials (also the API's S3 key). Change both for a real deployment; the shipped `minioadmin`/`minioadmin` is a dev default. |
| `INTERNAL_SERVICE_SECRET` | Shared secret for internal service-to-service calls (the gateway's per-channel voice-join authorization request to the API). The API and gateway must agree on it. Change it from the dev default for any real deployment (`openssl rand -hex 32`). |
| `CORS_ORIGINS` | Comma-separated origins the API accepts. Add your real client origin when serving from a domain other than localhost. |
| `PUBLIC_BASE_URL` | The URL that goes into verification / password-reset emails. Set it to your real address (e.g. `https://relay.example.com`). |
| `RELAY_SEED_DEMO` | Off by default. Seeding demo accounts (owner/player1/player2) also requires `RELAY_DEMO_PASSWORD_HASH` (an argon2id hash you set) — no password ships in the repo. Leave both unset for a real deployment. |
| `ANNOUNCED_IP` | Leave empty for voice on the same machine. Set it to the host's LAN or public IP so voice works from phones / remote users. |
| `VOICE_PUBLIC_ENDPOINT` | The `host:port` of the voice signaling server advertised to clients. Defaults to `127.0.0.1:4001` (same machine); set `<host-ip>:4001` for remote use. |
| `SMTP_*` | Leave `SMTP_HOST` empty and the API just logs verification/reset URLs (fine for a private instance). Fill these in to send real emails. |
| `VITE_GIPHY_API_KEY` | A free key from [developers.giphy.com](https://developers.giphy.com) to enable the GIF picker. |
| `VITE_HTTPS` | **Defaults to `true`** — the client is served over HTTPS with a self-signed cert (needed so mic/camera work from non-`localhost` devices). Set to `false` for plain HTTP (e.g. E2E runs, or when a reverse proxy terminates TLS upstream). |
| `BACKUP_INTERVAL` / `BACKUP_KEEP` | How often the database is backed up (seconds, default hourly) and how many snapshots to keep (default 48). |

## Backups and recovery

Relay backs the database up on its own so you don't lose accounts, servers, or messages when
you rebuild or upgrade.

- A **`backup` sidecar** writes a compressed snapshot of Postgres to **`./backups`** on the
  host every hour (`BACKUP_INTERVAL`), keeping the newest `BACKUP_KEEP`. Because `./backups`
  lives on the host, snapshots survive `docker compose down -v` and image rebuilds.
- **On a fresh start** the database automatically **restores `./backups/latest.dump` if it
  exists**, and otherwise applies the schema + (optionally) the demo seed. So:
  - Rebuilding the stack keeps all your data.
  - A brand-new install with no backups starts clean.
- To force a **manual snapshot**: `docker exec relay-backup sh -c 'pg_dump -Fc --no-owner -f /backups/manual-$(date +%s).dump'`.
- To **restore a specific snapshot**, copy it over `./backups/latest.dump`, then
  `docker compose down -v && docker compose up -d`.

Keep `./backups` on durable storage (or copy it off-box) if the data matters.

## Updating to a new version

```sh
git pull
docker compose up -d --build
```

Your data is safe across upgrades (it lives in the Postgres volume, and the backups protect
it either way). One gotcha: if Compose recreates the backing services, **restart the app tier
so it reconnects** — `docker compose restart api gateway voice-server` — or just cycle the
whole stack.

## Before you expose it to the internet

The defaults are tuned for a quick local run, not a hostile network. Do these first:

1. **Set `ENVIRONMENT=production`.** The dev compose runs in `development`, which accepts the
   dev internal secret and serves the API docs. In production the app hides the docs/OpenAPI
   and **fails closed** on the internal endpoint until you set a strong secret (next line).
2. **Change the default credentials.** In `.env`, set a real `POSTGRES_PASSWORD` and change
   the MinIO `S3_ACCESS_KEY` / `S3_SECRET_KEY`. The shipped `relay`/`relay` and
   `minioadmin`/`minioadmin` are dev defaults; the API, backup sidecar, data layer and MinIO
   all read these same values, so you only set them once. Also set a strong
   `INTERNAL_SERVICE_SECRET` (`openssl rand -hex 32`) — the API and gateway share it to
   authenticate the internal voice-join authorization call. **With `ENVIRONMENT=production`,
   the API refuses every `/internal` call until this is a strong non-default value.**
2. **Leave demo accounts off** — they're off by default now and can't be seeded without an
   explicit `RELAY_DEMO_PASSWORD_HASH`, so there's nothing to disable; just don't set those.
3. **Keep the internal services internal.** Postgres, Redis, Elasticsearch, the data layer,
   MinIO (both the S3 API on 9000 and the console on 9001) are already bound to `127.0.0.1`
   in `docker-compose.yml` — don't republish them on `0.0.0.0`. Only the client, API,
   gateway, and voice server need to be reachable.
4. **Put a TLS reverse proxy in front.** Terminate HTTPS (Caddy, nginx, Traefik) for the
   client, API, and gateway, and point `PUBLIC_BASE_URL` / `CORS_ORIGINS` at your real
   domain.
5. **Uploaded files are public-by-URL.** The attachment/avatar/icon/emoji buckets are served
   as anonymous-download (like most chat CDNs), so anyone with a file's URL can fetch it —
   but the object store itself is not exposed: the browser reaches uploads only through the
   client's same-origin `/cdn` proxy, never MinIO directly. Don't treat uploads as private.
6. **Configure SMTP** so email verification and password resets actually send.
7. **Set `ANNOUNCED_IP`** to your public IP (and open the voice UDP/TCP ports) for voice to
   work across the internet.

## Ports

| Service | Port | Exposure |
|---|---|---|
| Client (web) | 5173 | public |
| API | 8000 | public |
| Gateway (WebSocket) | 4000 | public |
| Voice server | 4001 (+ 40000-40100/udp media) | public |
| Postgres / Redis / Elasticsearch / data-services / MinIO (S3 API + console) | 5432 / 6379 / 9200 / 50051 / 9000 / 9001 | localhost only |

## Firewall — voice & video across machines (Windows)

Voice works out of the box on the machine that runs Relay. To let **other computers on
your network** join calls and see your camera / screen, the host's firewall has to allow
their traffic in. If people can join a voice channel but **no camera, screen share, or
voice ever comes through**, this is almost always the cause — the signaling reaches the
app but the media (WebRTC) is blocked.

You only need to open two things, because the client proxies the API, gateway, voice
signaling and file/CDN traffic through its own origin (port 5173):

| Port(s) | Protocol | Why |
|---|---|---|
| `5173` | TCP | The web app itself (and, proxied through it, the API / gateway / voice signaling / uploads). |
| `40000-40100` | UDP **and** TCP | The actual WebRTC audio/video/screen media. UDP is preferred; TCP is the fallback when UDP is blocked. |

The other service ports (`4001`, `8000`, `4000`, `9000`) do **not** need opening for remote
clients — they are reached through the `5173` proxy — so you can leave them closed.

### Add the rules

Run in an **Administrator** PowerShell **on the machine that hosts Relay** (the one running
Docker). Every rule is named with a `Relay - ` prefix so they're easy to find and remove
later:

```powershell
New-NetFirewallRule -DisplayName "Relay - Web app (TCP 5173)"            -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173          -Profile Private,Domain
New-NetFirewallRule -DisplayName "Relay - Voice media UDP (40000-40100)" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 40000-40100 -Profile Private,Domain
New-NetFirewallRule -DisplayName "Relay - Voice media TCP (40000-40100)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 40000-40100 -Profile Private,Domain
```

`-Profile Private,Domain` opens the ports only on home/work networks, not on networks
Windows has classified **Public**. If a call still won't connect, your active network may
be marked Public — check with `Get-NetConnectionProfile`, and either reclassify it to
`Private` (`Set-NetConnectionProfile -InterfaceAlias "<your adapter>" -NetworkCategory Private`)
or, only if you trust the network, drop `-Profile Private,Domain` from the rules so they
apply everywhere. Re-running a command whose `DisplayName` already exists errors — remove
the rules first (below) and re-add.

Also set **`ANNOUNCED_IP`** in `.env` to the host's LAN IP so the voice server advertises a
reachable address (a stale value here breaks media in exactly the same way as a closed
firewall). On Windows you can detect and write it automatically with
`powershell -File scripts/announce-ip.ps1 -Recreate`.

### Remove the rules (uninstall)

To take the openings back out — e.g. you've stopped self-hosting — remove every `Relay - `
rule in one line (Administrator PowerShell):

```powershell
Get-NetFirewallRule -DisplayName "Relay - *" | Remove-NetFirewallRule
```

If you added earlier rules by hand under different names (for example `Relay 5173`,
`Relay Voice RTC`), this wider match removes those too:

```powershell
Get-NetFirewallRule -DisplayName "Relay*" | Remove-NetFirewallRule
```

Verify nothing Relay-related is left with `Get-NetFirewallRule -DisplayName "Relay*"`
(it should return nothing).

## Status

Relay is pre-1.0 and moves fast. It's solid for self-hosted communities, but if you're running
it somewhere important, take backups off-box and keep an eye on the release notes. Found a
security issue? Please report it privately per [SECURITY.md](../SECURITY.md).
