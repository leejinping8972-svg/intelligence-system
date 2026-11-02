#!/usr/bin/env bash
set -euo pipefail
cd /opt/intelligence-system
install -d -m 755 public/data
docker run --rm --name intelligence-public-collector --memory=384m --pids-limit=128 \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  -v /opt/intelligence-system/source/apps/web-antd:/work:ro \
  -v /opt/intelligence-system/public/data:/output \
  -w /work \
  -e HCI_COLLECTOR_OUTPUT=/output/public-site-observations.json \
  -e HCI_COLLECTOR_PREVIOUS_URL=https://43.172.66.45/data/public-site-observations.json \
  -e HCI_FREE_SOURCE_OUTPUT=/output/free-source-observations.json \
  -e HCI_FREE_SOURCES_PREVIOUS_URL=https://43.172.66.45/data/free-source-observations.json \
  node:22-alpine node scripts/collect-public-sites.mjs

# The API container reads the encrypted YouTube key directly from the database.
# Keep credentials out of shell arguments, logs and public files.
result_file=$(mktemp /opt/intelligence-system/public/data/.free-source-XXXXXX)
trap 'rm -f -- "$result_file"' EXIT
docker compose exec -T api node public-collector.mjs > "$result_file"
chmod 644 "$result_file"
mv -f -- "$result_file" /opt/intelligence-system/public/data/free-source-observations.json
