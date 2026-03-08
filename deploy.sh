#!/bin/bash
# SchedKit — Plesk post-deployment script
# Runs automatically after every git push via Plesk Git integration
set -e

APP_DIR="/var/www/vhosts/schedkit.net/httpdocs"
NODE="/opt/plesk/node/22/bin/node"
NPM="/opt/plesk/node/22/bin/npm"
PM2="$APP_DIR/node_modules/.bin/pm2"

cd "$APP_DIR"

echo "[deploy] Installing dependencies..."
"$NPM" ci --omit=dev

echo "[deploy] Reloading app via pm2..."
if "$NODE" "$PM2" list | grep -q schedkit; then
  "$NODE" "$PM2" reload schedkit
else
  "$NODE" "$PM2" start src/index.mjs --name schedkit --interpreter "$NODE"
  "$NODE" "$PM2" save
fi

echo "[deploy] Done. App is live."
