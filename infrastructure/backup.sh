#!/bin/sh
# Periodic Postgres backup. Runs as its own small container (relay-backup).
#
# Every BACKUP_INTERVAL seconds it writes a compressed pg_dump to /backups, which is
# bind-mounted to ./backups on the host so snapshots outlive the database container and
# its volume. It keeps the newest BACKUP_KEEP snapshots and always points latest.dump at
# the most recent one — that is what the database restores from on a fresh start
# (see init-db.sh). Connection details come from the standard PG* environment variables.
set -eu

INTERVAL="${BACKUP_INTERVAL:-3600}"   # default: hourly
KEEP="${BACKUP_KEEP:-48}"             # default: keep ~2 days of hourly snapshots
mkdir -p /backups

echo "[relay-backup] running; dumping every ${INTERVAL}s, keeping ${KEEP} snapshots in /backups"
while true; do
  ts="$(date +%Y%m%d-%H%M%S)"
  tmp="/backups/.relay-${ts}.dump.part"
  out="/backups/relay-${ts}.dump"

  # Write to a .part file first, then atomically move it into place, so a crash mid-dump
  # never leaves a truncated file that looks like a valid backup.
  if pg_dump -Fc --no-owner -f "$tmp"; then
    mv "$tmp" "$out"
    cp "$out" /backups/latest.dump
    # Prune: keep only the newest $KEEP timestamped dumps.
    ls -1t /backups/relay-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
      rm -f "$old"
    done
    echo "[relay-backup] $(date -u +%FT%TZ) wrote ${out}"
  else
    rm -f "$tmp"
    echo "[relay-backup] $(date -u +%FT%TZ) pg_dump FAILED — will retry next interval"
  fi

  sleep "$INTERVAL"
done
