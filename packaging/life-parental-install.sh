#!/bin/bash
# LiFE Parental Control – privileged install/update script
# Called via pkexec from the frontend (runs as root).
# Usage: life-parental-install.sh <resBase> <appVersion>
#
# SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel

set -euo pipefail

RES_BASE="${1:-}"
APP_VERSION="${2:-}"
DAEMON_LIB="/usr/lib/life-parental"
CONFIG_DIR="/etc/life-parental"
SYSTEMD_UNIT="/etc/systemd/system/parental-control.service"
HAGEZI_DST="/usr/share/life-parental/hagezi"

if [ -z "$RES_BASE" ]; then
    echo "life-parental-install: missing resBase argument" >&2
    exit 1
fi

# --- Daemon JS files ---
DAEMON_SRC="$RES_BASE/daemon"
if [ ! -d "$DAEMON_SRC" ]; then
    echo "life-parental-install: daemon directory not found: $DAEMON_SRC" >&2
    exit 1
fi
mkdir -p "$DAEMON_LIB"

# Remove legacy locations
for LEGACY in /usr/bin/parental-control-daemon.js /usr/bin/defaultSync.js; do
    [ -f "$LEGACY" ] && rm -f "$LEGACY" || true
done

# Copy all .js files from daemon directory
for F in "$DAEMON_SRC"/*.js; do
    [ -f "$F" ] || continue
    cp "$F" "$DAEMON_LIB/"
    chmod 755 "$DAEMON_LIB/$(basename "$F")"
done

# --- Systemd service file ---
if [ -f "$RES_BASE/systemd/parental-control.service" ]; then
    SERVICE_SRC="$RES_BASE/systemd/parental-control.service"
elif [ -f "$RES_BASE/packaging/systemd/parental-control.service" ]; then
    SERVICE_SRC="$RES_BASE/packaging/systemd/parental-control.service"
else
    echo "life-parental-install: service file not found under $RES_BASE" >&2
    exit 1
fi
mkdir -p /etc/systemd/system
cp "$SERVICE_SRC" "$SYSTEMD_UNIT"

# --- HaGeZi bundled feeds (best-effort) ---
HAGEZI_SRC="$RES_BASE/hagezi"
if [ -d "$HAGEZI_SRC" ]; then
    mkdir -p "$HAGEZI_DST"
    cp -r "$HAGEZI_SRC/." "$HAGEZI_DST/"
fi

# --- Polkit rules + policy (allow pkexec without password prompt on next run) ---
POLKIT_RULES_SRC="$RES_BASE/polkit/50-org.tuxfamily.life-parental-control.rules"
if [ -f "$POLKIT_RULES_SRC" ]; then
    mkdir -p /etc/polkit-1/rules.d
    cp "$POLKIT_RULES_SRC" /etc/polkit-1/rules.d/
    chmod 0644 /etc/polkit-1/rules.d/50-org.tuxfamily.life-parental-control.rules
    echo "life-parental-install: polkit rules installed"
fi

# --- Config directory (world-readable so non-root frontend can read files) ---
mkdir -p "$CONFIG_DIR"
chmod 0755 "$CONFIG_DIR"

# Fix permissions: config files world-readable except auth.json (password hash, root only)
find "$CONFIG_DIR" -maxdepth 1 -type f -exec chmod 0644 {} \; 2>/dev/null || true
[ -f "$CONFIG_DIR/auth.json" ] && chmod 0600 "$CONFIG_DIR/auth.json" || true

# --- App log (written by daemon; readable by non-root) ---
mkdir -p /var/log/life-parental
touch /var/log/life-parental.json
chmod 0644 /var/log/life-parental.json

# --- Enable and start the daemon ---
systemctl daemon-reload
systemctl enable parental-control.service
if systemctl is-active --quiet parental-control.service 2>/dev/null; then
    systemctl restart parental-control.service
else
    systemctl start parental-control.service
fi

# --- Write installed version marker ---
if [ -n "$APP_VERSION" ]; then
    echo "$APP_VERSION" > "$DAEMON_LIB/.installed-version"
    chmod 0644 "$DAEMON_LIB/.installed-version"
fi
