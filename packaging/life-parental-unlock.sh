#!/bin/bash
# LiFE Parental Control – Undo child-account lockdown
# Called via pkexec from Settings → Danger zone (runs as root).
# Usage: life-parental-unlock.sh <targetUser>
#
# SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel

set -uo pipefail

TARGET_USER="${1:-}"

if [ -z "$TARGET_USER" ]; then
    echo "status: error - missing target user" >&2
    exit 1
fi

if ! id "$TARGET_USER" &>/dev/null; then
    echo "status: error - user $TARGET_USER does not exist" >&2
    exit 1
fi

# Ensure privilege groups exist (distro-independent)
groupadd -f wheel 2>/dev/null || true
groupadd -f sudo  2>/dev/null || true
groupadd -f fuse  2>/dev/null || true

# Restore admin privileges for the child account
usermod -aG wheel,sudo "$TARGET_USER" || { echo "status: error - usermod wheel/sudo failed" >&2; exit 1; }
if getent group admin &>/dev/null; then
    usermod -aG admin "$TARGET_USER" 2>/dev/null || true
fi

# Restore FUSE access so AppImages work again
usermod -aG fuse "$TARGET_USER" 2>/dev/null || true

# Remove LiFE lockdown polkit rules (install/update deny + optional allow rules)
for rules_dir in /etc/polkit-1/rules.d /usr/share/polkit-1/rules.d; do
    [ -d "$rules_dir" ] || continue
    rm -f \
        "$rules_dir/54-life-parental-deny-remove-${TARGET_USER}.rules" \
        "$rules_dir/55-life-parental-install-${TARGET_USER}.rules" \
        "$rules_dir/55-life-parental-update-${TARGET_USER}.rules" \
        2>/dev/null || true
done

# Remove lockdown sudoers drop-ins (install/update only — keeps parent admin sudoers intact)
rm -f \
    "/etc/sudoers.d/55-life-parental-install-${TARGET_USER}" \
    "/etc/sudoers.d/55-life-parental-update-${TARGET_USER}" \
    2>/dev/null || true

# Restore polkit rules that were backed up during lockdown when they mention this user
BACKUP_DIR=/etc/polkit-1/rules.backup
if [ -d "$BACKUP_DIR" ]; then
    for bak in "$BACKUP_DIR"/*.bak; do
        [ -f "$bak" ] || continue
        if grep -qF "$TARGET_USER" "$bak" 2>/dev/null; then
            base=$(basename "$bak" .bak)
            install -D -m 644 "$bak" "/etc/polkit-1/rules.d/$base"
            rm -f "$bak" 2>/dev/null || true
        fi
    done
fi

# Remove global FUSE restriction installed by lockdown
if [ -f /etc/udev/rules.d/99-life-parental-fuse.rules ]; then
    rm -f /etc/udev/rules.d/99-life-parental-fuse.rules
    udevadm control --reload-rules 2>/dev/null || true
    udevadm trigger --name-match=fuse 2>/dev/null || true
    echo "status: fuse-restriction-removed"
fi

# Verify sudo/wheel membership was restored
if ! id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qxE 'sudo|wheel'; then
    echo "status: error - sudo/wheel not restored for $TARGET_USER" >&2
    exit 1
fi
echo "status: sudo-restored"

echo "status: success"
exit 0
