#!/bin/sh
# Install static maintenance page on the Plesk host (run on the server, not in Docker).
set -e

HTTPDOCS="${HTTPDOCS:-/var/www/vhosts/schedkit.net/httpdocs}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if [ ! -d "$HTTPDOCS" ]; then
  echo "ERROR: $HTTPDOCS not found. Set HTTPDOCS to your vhost docroot." >&2
  exit 1
fi

cp "$SCRIPT_DIR/maintenance.html" "$HTTPDOCS/maintenance.html"
chmod 644 "$HTTPDOCS/maintenance.html"

echo "Installed: $HTTPDOCS/maintenance.html"
echo ""
echo "Next steps (Plesk UI):"
echo "  1. Domains → schedkit.net → Apache & nginx Settings"
echo "  2. Additional nginx directives → paste from nginx-additions.conf"
echo "  3. If you already proxy to :3002, only add error_page + maintenance location"
echo "     + proxy_intercept_errors (do not duplicate location /)."
echo "  4. Apply / OK, then test: stop schedkit-api container and reload https://schedkit.net"
