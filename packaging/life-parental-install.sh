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
HAGEZI_DST="/etc/life-parental/blocklists"

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

# --- NetworkManager dispatcher script ---
NM_DISPATCHER_DST="/etc/NetworkManager/dispatcher.d/99-life-parental-dns"
NM_DISPATCHER_SRC=""
if [ -f "$RES_BASE/packaging/99-life-parental-dns" ]; then
    NM_DISPATCHER_SRC="$RES_BASE/packaging/99-life-parental-dns"
elif [ -f "$RES_BASE/99-life-parental-dns" ]; then
    NM_DISPATCHER_SRC="$RES_BASE/99-life-parental-dns"
fi
if [ -n "$NM_DISPATCHER_SRC" ]; then
    mkdir -p /etc/NetworkManager/dispatcher.d
    cp "$NM_DISPATCHER_SRC" "$NM_DISPATCHER_DST"
    chmod 755 "$NM_DISPATCHER_DST"
    echo "life-parental-install: NM dispatcher script installed"
fi

# --- Lockdown script ---
LOCKDOWN_SRC=""
if [ -f "$RES_BASE/packaging/life-parental-lockdown.sh" ]; then
    LOCKDOWN_SRC="$RES_BASE/packaging/life-parental-lockdown.sh"
elif [ -f "$RES_BASE/life-parental-lockdown.sh" ]; then
    LOCKDOWN_SRC="$RES_BASE/life-parental-lockdown.sh"
fi
if [ -n "$LOCKDOWN_SRC" ]; then
    cp "$LOCKDOWN_SRC" /usr/bin/life-parental-lockdown
    chmod 755 /usr/bin/life-parental-lockdown
    echo "life-parental-install: lockdown script installed"
fi

# --- Polkit rules (distro-independent: try both locations) ---
POLKIT_RULES_SRC="$RES_BASE/polkit/50-org.tuxfamily.life-parental-control.rules"
POLKIT_RULE_NAME="50-org.tuxfamily.life-parental-control.rules"
if [ -f "$POLKIT_RULES_SRC" ]; then
    # /etc/polkit-1/rules.d/ — Debian/Ubuntu/Fedora
    mkdir -p /etc/polkit-1/rules.d
    cp "$POLKIT_RULES_SRC" /etc/polkit-1/rules.d/"$POLKIT_RULE_NAME"
    chmod 0644 /etc/polkit-1/rules.d/"$POLKIT_RULE_NAME"
    # /usr/share/polkit-1/rules.d/ — Arch/Garuda/Manjaro
    if [ -d /usr/share/polkit-1/rules.d ]; then
        cp "$POLKIT_RULES_SRC" /usr/share/polkit-1/rules.d/"$POLKIT_RULE_NAME"
        chmod 0644 /usr/share/polkit-1/rules.d/"$POLKIT_RULE_NAME"
    fi
    echo "life-parental-install: polkit rules installed"
fi

# --- Config directory (world-readable so non-root frontend can read files) ---
mkdir -p "$CONFIG_DIR"
chmod 0755 "$CONFIG_DIR"

# Fix permissions: config files world-readable except auth.json (password hash, root only)
find "$CONFIG_DIR" -maxdepth 1 -type f -exec chmod 0644 {} \; 2>/dev/null || true
[ -f "$CONFIG_DIR/auth.json" ] && chmod 0600 "$CONFIG_DIR/auth.json" || true

# --- App logs (written by daemon; readable by non-root) ---
mkdir -p /var/log/life-parental
touch /var/log/life-parental/daemon.log
touch /var/log/life-parental/activity.json
chmod 0644 /var/log/life-parental/daemon.log /var/log/life-parental/activity.json

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
