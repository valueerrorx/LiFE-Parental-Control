#!/bin/sh
set -e
case "$1" in
    configure|abort-upgrade|abort-deconfigure|abort-remove) ;;
    *) exit 0 ;;
esac

PKG=life-parental-control
POLICY_DST=/usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
RULES_DST=/usr/share/polkit-1/rules.d/50-org.tuxfamily.life-kiosk.rules
DAEMON_DST=/usr/bin/next-exam-daemon.js
SERVICE_DST=/etc/systemd/system/next-exam.service

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
rules_src="${pkg_res}/polkit/50-org.tuxfamily.life-kiosk.rules"
if [ -f "$policy_src" ]; then install -D -m 644 "$policy_src" "$POLICY_DST"; fi
if [ -f "$rules_src" ]; then install -D -m 644 "$rules_src" "$RULES_DST"; fi

# Install next-exam daemon script
daemon_src="${pkg_res}/daemon/next-exam-daemon.js"
if [ -f "$daemon_src" ]; then
    install -D -m 755 "$daemon_src" "$DAEMON_DST"
fi

# Install and enable the systemd service
service_src="${pkg_res}/systemd/next-exam.service"
if [ -f "$service_src" ] && command -v systemctl >/dev/null 2>&1; then
    install -D -m 644 "$service_src" "$SERVICE_DST"
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable next-exam.service 2>/dev/null || true
    systemctl start next-exam.service 2>/dev/null || true
fi

if command -v systemctl >/dev/null 2>&1; then
    systemctl try-reload-or-restart polkit.service 2>/dev/null || true
fi

exit 0
