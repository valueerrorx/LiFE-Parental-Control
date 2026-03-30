#!/bin/sh
set -e
case "$1" in
    configure|abort-upgrade|abort-deconfigure|abort-remove) ;;
    *) exit 0 ;;
esac

PKG=life-parental-control
POLICY_DST=/usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
RULES_DST=/usr/share/polkit-1/rules.d/50-org.tuxfamily.life-parental-control.rules
DAEMON_LIB=/usr/lib/life-parental
SERVICE_DST=/etc/systemd/system/parental-control.service

# Find package resource directory
pkg_res=""
if command -v dpkg >/dev/null 2>&1; then
    pkg_res=$(dpkg -L "$PKG" 2>/dev/null | grep -E '/resources/polkit/' | head -n1 | sed 's|/polkit/.*||') || true
fi
if [ -z "$pkg_res" ]; then
    for base in "/opt/LiFE_Parental_Control" "/opt/life-parental-control" "/opt/LiFE Parental Control"; do
        if [ -d "$base/resources" ]; then
            pkg_res="$base/resources"
            break
        fi
    done
fi
if [ -z "$pkg_res" ]; then
    echo "$PKG postinst: could not find resource directory" >&2
    exit 1
fi

# Install PolicyKit files
policy_src="${pkg_res}/polkit/org.tuxfamily.life-parental-control.policy"
rules_src="${pkg_res}/polkit/50-org.tuxfamily.life-parental-control.rules"
if [ -f "$policy_src" ]; then install -D -m 644 "$policy_src" "$POLICY_DST"; fi
if [ -f "$rules_src" ]; then install -D -m 644 "$rules_src" "$RULES_DST"; fi

# Install daemon modules (parental-control-daemon.js requires ./defaultSync.js in the same dir)
rm -f /usr/bin/parental-control-daemon.js /usr/bin/defaultSync.js 2>/dev/null || true
daemon_dir="${pkg_res}/daemon"
if [ -d "$daemon_dir" ]; then
    mkdir -p "$DAEMON_LIB"
    for f in "$daemon_dir"/*.js; do
        [ -f "$f" ] || continue
        install -D -m 755 "$f" "$DAEMON_LIB/$(basename "$f")"
    done
fi

# Write installed-version marker (used by the UI to detect if daemon is up-to-date)
APP_VERSION=$(dpkg-query -s life-parental-control 2>/dev/null | awk '/^Version:/{print $2}' || true)
if [ -n "$APP_VERSION" ] && [ -d "$DAEMON_LIB" ]; then
    echo "$APP_VERSION" > "$DAEMON_LIB/.installed-version"
    chmod 0644 "$DAEMON_LIB/.installed-version"
fi

# Install lockdown script
lockdown_src="${pkg_res}/packaging/life-parental-lockdown.sh"
[ -f "$lockdown_src" ] || lockdown_src="${pkg_res}/life-parental-lockdown.sh"
if [ -f "$lockdown_src" ]; then
    install -D -m 755 "$lockdown_src" /usr/bin/life-parental-lockdown
fi

# Wrapper script in /usr/bin — passes --no-sandbox (required when Electron runs as root)
cat > /usr/bin/life-parental-control << 'WRAPPER'
#!/bin/sh
exec "/opt/LiFE_Parental_Control/life-parental-control" --no-sandbox "$@"
WRAPPER
chmod 755 /usr/bin/life-parental-control

# Install and enable the systemd service
service_src="${pkg_res}/systemd/parental-control.service"
if [ -f "$service_src" ] && command -v systemctl >/dev/null 2>&1; then
    install -D -m 644 "$service_src" "$SERVICE_DST"
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable parental-control.service 2>/dev/null || true
    if systemctl is-active --quiet parental-control.service 2>/dev/null; then
        systemctl restart parental-control.service 2>/dev/null || true
    else
        systemctl start parental-control.service 2>/dev/null || true
    fi
fi

if command -v systemctl >/dev/null 2>&1; then
    systemctl try-reload-or-restart polkit.service 2>/dev/null || true
fi

# Ensure dnsmasq is enabled and running
if command -v systemctl >/dev/null 2>&1 && command -v dnsmasq >/dev/null 2>&1; then
    systemctl enable dnsmasq.service 2>/dev/null || true
    if systemctl is-active --quiet dnsmasq.service 2>/dev/null; then
        systemctl restart dnsmasq.service 2>/dev/null || true
    else
        systemctl start dnsmasq.service 2>/dev/null || true
    fi
fi

exit 0
