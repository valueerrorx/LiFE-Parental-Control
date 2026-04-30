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

# Seed bundled HaGeZi blocklists into /etc/life-parental/blocklists/ (only if not already present)
hagezi_src="${pkg_res}/hagezi"
if [ -d "$hagezi_src" ]; then
    mkdir -p /etc/life-parental/blocklists
    for f in "$hagezi_src"/*.txt; do
        [ -f "$f" ] || continue
        dest="/etc/life-parental/blocklists/$(basename "$f")"
        [ -f "$dest" ] || install -m 644 "$f" "$dest"
    done
fi

# App monitor background excludes (always refresh on install/upgrade)
excl_src=""
[ -f "${pkg_res}/app-monitor-background-excludes.json" ] && excl_src="${pkg_res}/app-monitor-background-excludes.json"
[ -z "$excl_src" ] && [ -f "${pkg_res}/packaging/app-monitor-background-excludes.json" ] && excl_src="${pkg_res}/packaging/app-monitor-background-excludes.json"
if [ -n "$excl_src" ]; then
    mkdir -p /etc/life-parental
    install -D -m 644 "$excl_src" /etc/life-parental/app-monitor-background-excludes.json
else
    echo "$PKG postinst: WARNING missing app-monitor-background-excludes.json under ${pkg_res}" >&2
fi

# Install NetworkManager dispatcher script
nm_dispatcher_src="${pkg_res}/packaging/99-life-parental-dns"
[ -f "$nm_dispatcher_src" ] || nm_dispatcher_src="${pkg_res}/99-life-parental-dns"
if [ -f "$nm_dispatcher_src" ]; then
    mkdir -p /etc/NetworkManager/dispatcher.d
    install -D -m 755 "$nm_dispatcher_src" /etc/NetworkManager/dispatcher.d/99-life-parental-dns
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

# Icon: absolute path in .desktop (Freedesktop: theme-independent, works on any DE)
ICON_DST=/usr/share/pixmaps/life-parental-control.png
icon_src="${pkg_res}/images/pc.png"
[ -f "$icon_src" ] || icon_src="/opt/LiFE_Parental_Control/resources/images/pc.png"
if [ -f "$icon_src" ]; then
    install -D -m 644 "$icon_src" "$ICON_DST"
fi

# Patch .desktop file to use the /usr/bin wrapper instead of the /opt path
DESKTOP_FILE="/usr/share/applications/life-parental-control.desktop"
if [ -f "$DESKTOP_FILE" ]; then
    sed -i 's|^Exec=.*|Exec=/usr/bin/life-parental-control %U|' "$DESKTOP_FILE"
    sed -i "s|^Icon=.*|Icon=$ICON_DST|" "$DESKTOP_FILE"
fi

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
    # Best-effort: enable dnsmasq as neutral local resolver (no filtering) on install.
    # Upstream follows NetworkManager's current DNS automatically.
    mkdir -p /etc/dnsmasq.d || true
    # Avoid dnsmasq injecting a second upstream resolv file via resolvconf integration.
    if [ -f /etc/default/dnsmasq ] && ! grep -qE '^[[:space:]]*IGNORE_RESOLVCONF[[:space:]]*=' /etc/default/dnsmasq 2>/dev/null; then
        printf '%s\n' 'IGNORE_RESOLVCONF=yes' >> /etc/default/dnsmasq 2>/dev/null || true
    elif [ -f /etc/default/dnsmasq ]; then
        sed -i 's/^[[:space:]]*#\?[[:space:]]*IGNORE_RESOLVCONF[[:space:]]*=.*/IGNORE_RESOLVCONF=yes/' /etc/default/dnsmasq 2>/dev/null || true
    fi
    if [ -f /run/NetworkManager/resolv.conf ] && ! awk '/^nameserver[[:space:]]+/{print $2; exit}' /run/NetworkManager/resolv.conf 2>/dev/null | grep -qE '^(127\.0\.0\.53|127\.0\.0\.1)$'; then
        cat > /etc/dnsmasq.conf <<'EOF'
# Generated by LiFE Parental Control — neutral install setup
listen-address=127.0.0.1
bind-interfaces
resolv-file=/run/NetworkManager/resolv.conf
no-poll
cache-size=1000
domain-needed
bogus-priv
conf-dir=/etc/dnsmasq.d/,*.conf
EOF
    else
        upstream=$(awk '/^nameserver[[:space:]]+/{print $2; exit}' /run/NetworkManager/resolv.conf 2>/dev/null || true)
        [ "$upstream" = "127.0.0.1" ] && upstream=""
        [ "$upstream" = "127.0.0.53" ] && upstream=""
        [ -z "$upstream" ] && upstream="1.1.1.1"
        cat > /etc/dnsmasq.conf <<EOF
# Generated by LiFE Parental Control — neutral install setup
listen-address=127.0.0.1
bind-interfaces
server=$upstream
no-resolv
no-poll
cache-size=1000
domain-needed
bogus-priv
conf-dir=/etc/dnsmasq.d/,*.conf
EOF
    fi
    chmod 0644 /etc/dnsmasq.conf 2>/dev/null || true
    chattr -i /etc/resolv.conf 2>/dev/null || true
    printf '%s\n' 'nameserver 127.0.0.1' > /etc/resolv.conf 2>/dev/null || true
    chmod 0644 /etc/resolv.conf 2>/dev/null || true
    chattr +i /etc/resolv.conf 2>/dev/null || true
    systemctl disable --now systemd-resolved 2>/dev/null || true
    command -v setcap >/dev/null 2>&1 && setcap cap_net_bind_service=+ep "$(command -v dnsmasq)" 2>/dev/null || true
    systemctl enable dnsmasq.service 2>/dev/null || true
    if systemctl is-active --quiet dnsmasq.service 2>/dev/null; then
        systemctl restart dnsmasq.service 2>/dev/null || true
    else
        systemctl start dnsmasq.service 2>/dev/null || true
    fi
fi

exit 0
