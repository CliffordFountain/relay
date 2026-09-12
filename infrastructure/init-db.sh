#!/bin/sh
# Database bootstrap — runs ONCE, only when the Postgres data volume is first created
# (i.e. the volume is empty). Recovery policy:
#
#   * If a backup exists (./backups/latest.dump on the host) -> restore the latest one.
#     This is how user data and created accounts survive a container or image rebuild:
#     `docker compose down -v` wipes the database VOLUME but NOT the host ./backups
#     directory, so the next start restores everything from the newest snapshot.
#
#   * Otherwise (a fresh install with no backup yet) -> apply the schema and the dev seed.
#
# The backup sidecar (relay-backup, see backup.sh) keeps latest.dump up to date.
set -eu

DUMP=/backups/latest.dump

if [ -s "$DUMP" ]; then
  echo "[relay-init] Backup found at ${DUMP} — restoring the latest snapshot."
  # Restore into the freshly-created (empty) database. --no-owner so it works regardless
  # of the role names the dump was taken under.
  pg_restore --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$DUMP"
  echo "[relay-init] Restore complete — schema + seed skipped (data came from the backup)."
else
  echo "[relay-init] No backup found — applying fresh schema."
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /relay-init/schema.sql
  # Demo accounts (owner/player1/player2, shared password) are convenient for a first run
  # but must NOT exist on a real deployment. They seed by default; set RELAY_SEED_DEMO=false
  # (see .env.example) to bring up an empty, production-ready database instead.
  if [ "${RELAY_SEED_DEMO:-true}" = "true" ]; then
    echo "[relay-init] Seeding demo accounts + server (set RELAY_SEED_DEMO=false to skip)."
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /relay-init/seed.sql
  else
    echo "[relay-init] RELAY_SEED_DEMO=false — schema only, no demo accounts."
  fi
fi
