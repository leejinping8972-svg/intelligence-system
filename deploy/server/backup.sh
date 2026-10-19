#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/intelligence-system
install -d -m 700 backups
backup_file="backups/intelligence-$(date -u +%Y%m%dT%H%M%SZ).enc.json"
docker compose exec -T api node backup.mjs > "${backup_file}.partial"
mv -- "${backup_file}.partial" "$backup_file"
chmod 600 "$backup_file"
echo "Database backup completed."
