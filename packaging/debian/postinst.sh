#!/bin/sh
set -e
case "$1" in
    configure|abort-upgrade|abort-deconfigure|abort-remove) ;;
    *) exit 0 ;;
esac

PKG=life-parental-control
POLICY_DST=/usr/share/polkit-1/actions/org.tuxfamily.life-parental-control.policy
RULES_DST=/usr/share/polkit-1/rules.d/50-org.tuxfamily.life-kiosk.rules

policy_src=""
rules_src=""
if command -v dpkg >/dev/null 2>&1; then
    policy_src=$(dpkg -L "$PKG" 2>/dev/null | grep -E '/resources/polkit/.*\.policy$' | head -n1) || true
    rules_src=$(dpkg -L "$PKG" 2>/dev/null | grep -E '/resources/polkit/.*\.rules$' | head -n1) || true
fi
if [ -z "$policy_src" ] || [ ! -f "$policy_src" ]; then
    for base in "/opt/LiFE Parental Control" "/opt/life-parental-control"; do
        if [ -f "$base/resources/polkit/org.tuxfamily.life-parental-control.policy" ]; then
            policy_src="$base/resources/polkit/org.tuxfamily.life-parental-control.policy"
            rules_src="$base/resources/polkit/50-org.tuxfamily.life-kiosk.rules"
            break
        fi
    done
fi

if [ -n "$policy_src" ] && [ -f "$policy_src" ]; then
    install -D -m 644 "$policy_src" "$POLICY_DST"
fi
if [ -n "$rules_src" ] && [ -f "$rules_src" ]; then
    install -D -m 644 "$rules_src" "$RULES_DST"
fi

if command -v systemctl >/dev/null 2>&1; then
    systemctl try-reload-or-restart polkit.service 2>/dev/null || true
fi

exit 0
