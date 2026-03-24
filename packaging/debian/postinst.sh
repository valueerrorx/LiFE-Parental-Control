#!/bin/sh
set -e
case "$1" in
    configure|abort-upgrade|abort-deconfigure|abort-remove) ;;
    *) exit 0 ;;
esac

# ── Ensure Node.js >= 22 ─────────────────────────────────────────────────────
# On Ubuntu 24.04+ the apt dependency above provides Node.js 22 automatically.
# On older systems (dpkg -i without a compatible repo) we try NodeSource as a
# fallback. If that also fails we abort so dpkg marks the install as failed.
_node_major() {
    node -e 'process.stdout.write(process.version.split(".")[0].replace("v",""))' 2>/dev/null || echo 0
}
if [ "$(_node_major)" -lt 22 ] 2>/dev/null; then
    echo "[LiFE] Node.js >= 22 not found — attempting NodeSource 22.x .deb install..." >&2
    _ok=false
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sh - && \
            DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && _ok=true
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- https://deb.nodesource.com/setup_22.x | sh - && \
            DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs && _ok=true
    fi
    if [ "$_ok" = "false" ] || [ "$(_node_major)" -lt 22 ] 2>/dev/null; then
        echo "[LiFE] ERROR: Node.js >= 22 could not be installed." >&2
        echo "[LiFE] On Ubuntu 24.04+ it is available via apt. On older systems" >&2
        echo "[LiFE] add the NodeSource repo first: https://github.com/nodesource/distributions" >&2
        exit 1
    fi
fi
# ─────────────────────────────────────────────────────────────────────────────

PKG=life-parental-control
POLICY_DST=/usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
RULES_DST=/usr/share/polkit-1/rules.d/50-org.tuxfamily.life-parental-control.rules
DAEMON_DST=/usr/bin/parental-control-daemon.js
SERVICE_DST=/etc/systemd/system/parental-control.service

# Find package resource directory
pkg_res=""
if command -v dpkg >/dev/null 2>&1; then
    pkg_res=$(dpkg -L "$PKG" 2>/dev/null | grep -E '/resources/polkit/.*\.policy$' | head -n1 | sed 's|/polkit/.*||') || true
fi
if [ -z "$pkg_res" ]; then
    for base in "/opt/LiFE Parental Control" "/opt/life-parental-control"; do
        if [ -d "$base/resources" ]; then
            pkg_res="$base/resources"
            break
        fi
    done
fi

# Install PolicyKit files
policy_src="${pkg_res}/polkit/org.tuxfamily.life-parental-control.policy"
rules_src="${pkg_res}/polkit/50-org.tuxfamily.life-parental-control.rules"
if [ -f "$policy_src" ]; then install -D -m 644 "$policy_src" "$POLICY_DST"; fi
if [ -f "$rules_src" ]; then install -D -m 644 "$rules_src" "$RULES_DST"; fi

# Install parental-control daemon script
daemon_src="${pkg_res}/daemon/parental-control-daemon.js"
if [ -f "$daemon_src" ]; then
    install -D -m 755 "$daemon_src" "$DAEMON_DST"
fi

# Install and enable the systemd service
service_src="${pkg_res}/systemd/parental-control.service"
if [ -f "$service_src" ] && command -v systemctl >/dev/null 2>&1; then
    install -D -m 644 "$service_src" "$SERVICE_DST"
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable parental-control.service 2>/dev/null || true
    systemctl start parental-control.service 2>/dev/null || true
fi

if command -v systemctl >/dev/null 2>&1; then
    systemctl try-reload-or-restart polkit.service 2>/dev/null || true
fi

exit 0
