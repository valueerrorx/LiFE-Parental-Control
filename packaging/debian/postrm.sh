#!/bin/sh
set -e
case "$1" in
    remove|purge)
        rm -f /usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
        rm -f /usr/share/polkit-1/rules.d/50-org.tuxfamily.life-kiosk.rules
        if command -v systemctl >/dev/null 2>&1; then
            systemctl stop next-exam.service 2>/dev/null || true
            systemctl disable next-exam.service 2>/dev/null || true
            systemctl try-reload-or-restart polkit.service 2>/dev/null || true
        fi
        rm -f /etc/systemd/system/next-exam.service
        rm -f /usr/bin/next-exam-daemon.js
        rm -f /run/next-exam.sock
        ;;
esac
exit 0
