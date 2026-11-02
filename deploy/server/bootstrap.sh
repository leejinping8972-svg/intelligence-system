#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$(id -u)" != "0" ]]; then
  echo "Run as root to configure the server."
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null; then
  dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin git
fi
systemctl enable --now docker

python3 - <<'PY'
import os
from pathlib import Path
import secrets

config = Path('.env')
if not config.exists():
    with config.open('x') as target:
        target.write(f'POSTGRES_PASSWORD={secrets.token_hex(32)}\n')
        target.write(f'REDIS_PASSWORD={secrets.token_hex(32)}\n')
if not any(line.startswith('SERVER_BRIDGE_KEY=') for line in config.read_text().splitlines()):
    with config.open('a') as target:
        target.write(f'SERVER_BRIDGE_KEY={secrets.token_hex(32)}\n')
if not any(line.startswith('PROVIDER_CONFIG_ENCRYPTION_KEY=') for line in config.read_text().splitlines()):
    import base64
    with config.open('a') as target:
        target.write('PROVIDER_CONFIG_ENCRYPTION_KEY='+base64.b64encode(secrets.token_bytes(32)).decode()+'\n')
os.chmod(config, 0o600)
print('Server credentials ready; existing credentials preserved.')
PY

docker compose config --quiet
docker compose up -d --wait --wait-timeout 180
docker compose ps
