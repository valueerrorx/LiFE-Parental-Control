#!/bin/sh
set -e
case "$1" in
    remove|purge)
        rm -f /usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
        rm -f /usr/share/polkit-1/rules.d/50-org.tuxfamily.life-kiosk.rules
        if command -v systemctl >/dev/null 2>&1; then
            systemctl try-reload-or-restart polkit.service 2>/dev/null || true
        fi
        ;;
esac
exit 0
