#!/bin/sh
set -e
case "$1" in
    remove|purge)
        rm -f /usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
        rm -f /usr/share/polkit-1/rules.d/50-org.tuxfamily.life-parental-control.rules
        if command -v systemctl >/dev/null 2>&1; then
            systemctl stop parental-control.service 2>/dev/null || true
            systemctl disable parental-control.service 2>/dev/null || true
            systemctl try-reload-or-restart polkit.service 2>/dev/null || true
        fi
        rm -f /etc/systemd/system/parental-control.service
        rm -f /usr/bin/life-parental-control
        rm -f /usr/bin/life-parental-lockdown
        rm -rf /usr/lib/life-parental
        rm -f /etc/xdg/autostart/org.tuxfamily.life-parental-control.desktop
        rm -f /usr/share/pixmaps/life-parental-control.png
        rm -f /usr/share/icons/hicolor/1024x1024/apps/life-parental-control.png
        rm -f /usr/share/icons/hicolor/256x256/apps/life-parental-control.png
        if command -v gtk-update-icon-cache >/dev/null 2>&1; then
            gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
        fi
        rm -f /etc/NetworkManager/dispatcher.d/99-life-parental-dns
        rm -f /run/parental-control.sock
        if [ "$1" = "purge" ]; then
            rm -rf /etc/life-parental
        fi
        ;;
esac
exit 0
