#!/bin/bash
# SchedKit — Plesk post-deployment script
set -e

APP_DIR="/var/www/vhosts/schedkit.net/httpdocs"
NODE="/opt/plesk/node/22/bin/node"
NPM="/opt/plesk/node/22/bin/npm"
PM2_HOME="/var/www/vhosts/schedkit.net/.pm2"
PM2_BIN=$(find /var/www/vhosts/schedkit.net -name "pm2" -path "*/bin/pm2" -not -path "*/logrotate*" 2>/dev/null | head -1)

export HOME="/var/www/vhosts/schedkit.net"
export PM2_HOME

cd "$APP_DIR"

echo "[deploy] Installing dependencies..."
"$NPM" install --prefer-offline

echo "[deploy] Reloading app via pm2..."
if "$NODE" "$PM2_BIN" list 2>/dev/null | grep -q schedkit; then
  "$NODE" "$PM2_BIN" reload schedkit --update-env
else
  "$NODE" "$PM2_BIN" start src/index.mjs --name schedkit --interpreter "$NODE"
  "$NODE" "$PM2_BIN" save
fi

echo "[deploy] Done. App is live."
