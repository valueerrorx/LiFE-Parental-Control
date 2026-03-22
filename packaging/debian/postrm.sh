#!/bin/sh
set -e
case "$1" in
    remove|purge)
        rm -f /usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
        rm -f /usr/share/polkit-1/rules.d/50-org.tuxfamily.life-kiosk.rules
        if command -v systemctl >/dev/null 2>&1; then
            systemctl stop parental-control.service 2>/dev/null || true
            systemctl disable parental-control.service 2>/dev/null || true
            systemctl try-reload-or-restart polkit.service 2>/dev/null || true
        fi
        rm -f /etc/systemd/system/parental-control.service
        rm -f /usr/bin/parental-control-daemon.js
        rm -f /run/next-exam.sock
        ;;
esac
exit 0
