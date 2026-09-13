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
| `RELAY_SEED_DEMO` | `true` seeds the demo accounts (owner/player1/player2) on a fresh database. **Set to `false` for a real deployment** so no shared-password accounts exist. |
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

1. **Change the default credentials.** In `.env`, set a real `POSTGRES_PASSWORD` and change
   the MinIO `S3_ACCESS_KEY` / `S3_SECRET_KEY`. The shipped `relay`/`relay` and
   `minioadmin`/`minioadmin` are dev defaults; the API, backup sidecar, data layer and MinIO
   all read these same values, so you only set them once. Also set a strong
   `INTERNAL_SERVICE_SECRET` (`openssl rand -hex 32`) — the API and gateway share it to
   authenticate the internal voice-join authorization call.
2. **Turn off the demo accounts** — `RELAY_SEED_DEMO=false`.
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

## Status

Relay is pre-1.0 and moves fast. It's solid for self-hosted communities, but if you're running
it somewhere important, take backups off-box and keep an eye on the release notes. Found a
security issue? Please report it privately per [SECURITY.md](../SECURITY.md).
