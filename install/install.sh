#!/usr/bin/env bash
# Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
# Installs OPS Memory with a DEDICATED Unix user that has no special rights.
# Run as root:  sudo bash install/install.sh [service-user]
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this script with sudo."; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || { echo "Node.js and npm are required (system-wide install)."; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' || { echo "Node 22.13 or newer is required (built-in SQLite)."; exit 1; }
node --no-warnings -e 'const {DatabaseSync}=require("node:sqlite"); new DatabaseSync(":memory:").exec("CREATE VIRTUAL TABLE t USING fts5(a)")' || { echo "This Node build has no SQLite FTS5 support."; exit 1; }
USER_NAME="${1:-ops-memory}"
APP_DIR="/opt/ops-memory"
CONF_DIR="/etc/ops-memory"
STATE_DIR="/var/lib/ops-memory"

id "$USER_NAME" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$USER_NAME"
mkdir -p "$APP_DIR" "$CONF_DIR" "$STATE_DIR"
cp -a "$(cd "$(dirname "$0")/.." && pwd)/." "$APP_DIR/"
# Never carry over a local trial (config, keys, database) or a development node_modules.
rm -rf "$APP_DIR/.git" "$APP_DIR/data" "$APP_DIR/node_modules" "$APP_DIR/config.json"

if [ ! -f "$APP_DIR/config.json" ]; then
cat > "$APP_DIR/config.json" <<CFG
{
  "host": "127.0.0.1",
  "port": 3500,
  "dbFile": "$STATE_DIR/memory.db",
  "keysFile": "$CONF_DIR/keys.json",
  "keysGroup": "$USER_NAME",
  "rateLimitPerMinute": 120
}
CFG
fi

# The program, the config and the keys belong to ROOT. The service can read them, not change them:
# a compromised agent cannot grant itself rights or validate its own patterns.
# Only the database lives in a directory the service can write.
(cd "$APP_DIR" && npm install --omit=dev --silent)
chown -R root:root "$APP_DIR" && chmod -R go-w "$APP_DIR"
chown root:root "$CONF_DIR" && chmod 755 "$CONF_DIR"
[ -f "$CONF_DIR/keys.json" ] || printf '{"keys":[]}\n' > "$CONF_DIR/keys.json"
chown root:"$USER_NAME" "$CONF_DIR/keys.json" && chmod 640 "$CONF_DIR/keys.json"
chown -R "$USER_NAME:$USER_NAME" "$STATE_DIR" && chmod 750 "$STATE_DIR"

# Load the 10 starter patterns on first install only (the script refuses a non-empty database).
if [ ! -s "$STATE_DIR/memory.db" ]; then
  MEMORY_CONFIG="$APP_DIR/config.json" setpriv --reuid="$USER_NAME" --regid="$USER_NAME" --clear-groups node --no-warnings "$APP_DIR/bin/import-starter.js"
fi

cat > /etc/systemd/system/ops-memory.service <<UNIT
[Unit]
Description=OPS Memory (pattern store for AI agents)
After=network.target

[Service]
User=$USER_NAME
WorkingDirectory=$APP_DIR
Environment=MEMORY_CONFIG=$APP_DIR/config.json
ExecStart=$(command -v node) --no-warnings $APP_DIR/server.js
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ops-memory

echo
echo "OPS Memory installed. User: $USER_NAME   Database: $STATE_DIR/memory.db"
echo "Check:      curl -s http://127.0.0.1:3500/api/v1/health"
echo "Create keys (as root), one per agent. Back up with:
  sudo MEMORY_CONFIG=$APP_DIR/config.json node --no-warnings $APP_DIR/bin/backup.js /root/ops-memory-\$(date +%F).db
Create key (as root), one per agent:"
echo "  sudo MEMORY_CONFIG=$APP_DIR/config.json node --no-warnings $APP_DIR/bin/newkey.js --name my-agent --scopes read,write"
echo "Your own key (can validate and retire patterns):  --name owner --scopes admin"
echo "Then make it reachable over HTTPS with nginx (nginx/memory.conf.example). NEVER expose port 3500 directly."
