#!/bin/bash
# LiFE Parental Control – Lockdown script
# Called via pkexec from the frontend (runs as root).
# Usage: life-parental-lockdown.sh <targetUser> <adminUser> <pwFile|password> <grubHash> <allowInstall> <allowUpdate> <allowFuse>
#   $3 can be a path to a temp file (app usage) or a plain password string (manual/test usage)
#   $5 $6 $7 are optional booleans (true/false), default false
#
# SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel

set -uo pipefail  # no -e: we handle errors explicitly to avoid false failures

TARGET_USER="${1:-}"   # restricted child user
ADMIN_USER="${2:-}"    # new parent admin account
PW_FILE="${3:-}"       # path to temp file containing password (deleted immediately after read)
GRUB_HASH="${4:-}"     # pre-computed pbkdf2 hash
ALLOW_INSTALL="${5:-false}"  # allow target user to install packages via PackageKit
ALLOW_UPDATE="${6:-false}"   # allow target user to run system updates via PackageKit
ALLOW_FUSE="${7:-false}"     # add target user to fuse group (needed for AppImages)

# Example with default values (for manual invocation / testing):
# TARGET_USER="${1:-student}"
# ADMIN_USER="${2:-parentadmin}"
# PW_FILE="${3:-MeinPasswort123}"   # plain string for manual use, or file path for app usage
# GRUB_HASH="${4:-}"                # generate via: grub-mkpasswd-pbkdf2 | grep -o 'grub\.pbkdf2\.sha512\S*'
# ALLOW_INSTALL="${5:-false}"
# ALLOW_UPDATE="${6:-false}"
# ALLOW_FUSE="${7:-false}"
# → sudo ./life-parental-lockdown.sh student parentadmin "MeinPasswort123" "" false false true

if [ -z "$TARGET_USER" ] || [ -z "$ADMIN_USER" ] || [ -z "$PW_FILE" ]; then
    echo "status: error - missing arguments" >&2
    exit 1
fi

# Read password: if $3 is an existing file → read from file and delete it (normal app call)
#                if $3 is a plain string  → use directly (manual/test invocation only)
if [ -f "$PW_FILE" ]; then
    ADMIN_PW=$(cat "$PW_FILE" 2>/dev/null) || { echo "status: error - could not read password file" >&2; exit 1; }
    rm -f "$PW_FILE"
else
    ADMIN_PW="$PW_FILE"
fi
if [ -z "$ADMIN_PW" ]; then
    echo "status: error - empty password" >&2
    exit 1
fi

# --- PHASE 1: FAIL-SAFE (guarantee admin before any demotion) ---

# Set root password immediately as rescue anchor
echo "root:$ADMIN_PW" | chpasswd || { echo "status: error - chpasswd root failed" >&2; exit 1; }

# Create admin user if not present
if ! id "$ADMIN_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$ADMIN_USER" || { echo "status: error - useradd $ADMIN_USER failed" >&2; exit 1; }
    echo "$ADMIN_USER:$ADMIN_PW" | chpasswd || { echo "status: error - chpasswd $ADMIN_USER failed" >&2; exit 1; }
fi

# Ensure both sudo groups exist (distro-independent)
groupadd -f wheel 2>/dev/null || true
groupadd -f sudo  2>/dev/null || true
usermod -aG wheel,sudo "$ADMIN_USER" || { echo "status: error - usermod $ADMIN_USER failed" >&2; exit 1; }

# Drop-in sudoers: unconditional ALL rights for parent admin
echo "$ADMIN_USER ALL=(ALL:ALL) ALL" > /etc/sudoers.d/99-parent-admin
chmod 440 /etc/sudoers.d/99-parent-admin

# Verify the new admin actually has sudo rights before demoting anyone
if ! sudo -l -U "$ADMIN_USER" 2>/dev/null | grep -q "(ALL"; then
    echo "status: error - privilege escalation for $ADMIN_USER failed, aborting" >&2
    exit 1
fi
echo "status: admin-access verified"

# --- PHASE 2: LOCKDOWN (de-privilege target user) ---

# Remove target from privileged groups (ignore errors if not member)
gpasswd -d "$TARGET_USER" sudo  2>/dev/null || true
gpasswd -d "$TARGET_USER" wheel 2>/dev/null || true
gpasswd -d "$TARGET_USER" admin 2>/dev/null || true

# Strip all supplementary groups — keep only the user's primary group
PRIMARY_GROUP=$(id -gn "$TARGET_USER" 2>/dev/null || echo "$TARGET_USER")
usermod -G "$PRIMARY_GROUP" "$TARGET_USER" || true

# Disable any PolKit rules that name the target user (backup first)
for RULES_DIR in /etc/polkit-1/rules.d /usr/share/polkit-1/rules.d; do
    [ -d "$RULES_DIR" ] || continue
    while IFS= read -r rulefile; do
        mkdir -p /etc/polkit-1/rules.backup
        mv "$rulefile" "/etc/polkit-1/rules.backup/$(basename "$rulefile").bak" 2>/dev/null || true
    done < <(grep -rlF "$TARGET_USER" "$RULES_DIR" 2>/dev/null || true)
done

# Remove SUID/SGID bits from files owned by root in user home / tmp dirs
find "/home/$TARGET_USER" /tmp /var/tmp -xdev -perm /6000 -type f -user root \
    -exec chmod u-s,g-s {} + 2>/dev/null || true

# Remove SSH authorized_keys (prevents remote persistence via key)
rm -f "/home/$TARGET_USER/.ssh/authorized_keys" 2>/dev/null || true

# Set up FUSE group — always done to restrict AppImage usage for the target user.
# The target user is NOT added here; that only happens in Phase 4 if ALLOW_FUSE=true.
groupadd -f fuse 2>/dev/null || true
for BIN in /usr/bin/fusermount /usr/bin/fusermount3 /bin/fusermount /bin/fusermount3; do
    [ -x "$BIN" ] || continue
    chgrp fuse "$BIN" 2>/dev/null || true
    chmod u+s "$BIN"  2>/dev/null || true  # SUID required for unprivileged mounts
done
cat > /etc/udev/rules.d/99-life-parental-fuse.rules << 'EOF'
KERNEL=="fuse", GROUP="fuse", MODE="0660"
EOF
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --name-match=fuse 2>/dev/null || true
usermod -aG fuse root          2>/dev/null || true
usermod -aG fuse "$ADMIN_USER" 2>/dev/null || true
# Explicitly remove target user from fuse group (may have been member before)
gpasswd -d "$TARGET_USER" fuse 2>/dev/null || true
echo "status: fuse-restricted"

# --- PHASE 3: GRUB bootloader password ---
# Hash was pre-computed by the frontend (grub-mkpasswd-pbkdf2 needs a TTY, pkexec blocks stdin)
if [ -d /etc/grub.d ] && [ -n "$GRUB_HASH" ]; then
    cat > /etc/grub.d/40_custom_life_parental << EOF
#!/bin/sh
exec tail -n +3 \$0
# LiFE Parental Control — blocks GRUB edit/shell, booting remains unrestricted
set superusers="$ADMIN_USER"
password_pbkdf2 $ADMIN_USER $GRUB_HASH
EOF
    # Patch 10_linux so all menuentries get --unrestricted (boot without password)
    if [ -f /etc/grub.d/10_linux ]; then
        if ! grep -q '\-\-unrestricted' /etc/grub.d/10_linux; then
            sed -i 's/^CLASS="--class/CLASS="--unrestricted --class/' /etc/grub.d/10_linux
        fi
    fi
    chmod 755 /etc/grub.d/40_custom_life_parental
    if command -v update-grub &>/dev/null; then
        update-grub 2>/dev/null || true
    elif command -v grub-mkconfig &>/dev/null; then
        grub-mkconfig -o /boot/grub/grub.cfg 2>/dev/null || true
    fi
    echo "status: grub-password-set"
else
    echo "status: grub-skip (no grub.d or no hash available)" >&2
fi

# --- PHASE 4: OPTIONAL PERMISSIONS ---

# Always deny package removal for target user, regardless of install permissions.
# Without this, PackageKit frontends (GNOME Software, Discover) fall back to their
# default policy which may allow removal without admin auth.
cat > /etc/polkit-1/rules.d/54-life-parental-deny-remove-"$TARGET_USER".rules << EOF
polkit.addRule(function(action, subject) {
    if (subject.user !== "$TARGET_USER") { return; }
    var denied = [
        "org.freedesktop.packagekit.package-remove",
        "org.freedesktop.packagekit.packages-purge",
        "org.freedesktop.packagekit.system-rollback",
        "org.freedesktop.packagekit.upgrade-system",
        "org.freedesktop.Flatpak.app-uninstall",
        "org.freedesktop.Flatpak.runtime-uninstall",
        "io.snapcraft.snapd.manage",
    ];
    if (denied.indexOf(action.id) !== -1) {
        return polkit.Result.NO;
    }
});
EOF
chmod 644 /etc/polkit-1/rules.d/54-life-parental-deny-remove-"$TARGET_USER".rules

# Allow package installation via PackageKit, Flatpak and pamac (no removal — child must not uninstall apps)
# Rules are written for all known action IDs; polkit silently ignores actions that don't exist on this system.
if [ "$ALLOW_INSTALL" = "true" ]; then
    cat > /etc/polkit-1/rules.d/55-life-parental-install-"$TARGET_USER".rules << EOF
polkit.addRule(function(action, subject) {
    if (subject.user !== "$TARGET_USER") { return; }
    var allowed = [
        // PackageKit (Debian/Ubuntu/Fedora/openSUSE/Arch with PK backend)
        "org.freedesktop.packagekit.package-install",
        "org.freedesktop.packagekit.package-install-untrusted",
        "org.freedesktop.packagekit.package-reinstall",
        // Flatpak system-wide install
        "org.freedesktop.Flatpak.app-install",
        "org.freedesktop.Flatpak.runtime-install",
        "org.freedesktop.Flatpak.install-bundle",
        "org.freedesktop.Flatpak.configure-remote",
        // Pamac (Manjaro/Garuda) — single action covers all package ops
        "org.manjaro.pamac.commit",
    ];
    var denied = [
        // PackageKit remove/uninstall — must never be allowed for child user
        "org.freedesktop.packagekit.package-remove",
        "org.freedesktop.packagekit.packages-purge",
        // Flatpak remove
        "org.freedesktop.Flatpak.app-uninstall",
        "org.freedesktop.Flatpak.runtime-uninstall",
        // Snap remove
        "io.snapcraft.snapd.manage",
        // System-level ops the child must not do
        "org.freedesktop.packagekit.system-rollback",
        "org.freedesktop.packagekit.upgrade-system",
    ];
    if (denied.indexOf(action.id) !== -1) {
        return polkit.Result.NO;
    }
    if (allowed.indexOf(action.id) !== -1) {
        return polkit.Result.AUTH_SELF_KEEP;
    }
});
EOF
    # Sudoers fallback — works on all distros including those without PackageKit (e.g. Arch)
    # Only install subcommands — remove/uninstall deliberately omitted
    {
        [ -x /usr/bin/apt ]     && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/apt install *,/usr/bin/apt reinstall *"
        [ -x /usr/bin/apt-get ] && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/apt-get install *,/usr/bin/apt-get reinstall *"
        [ -x /usr/bin/dnf ]     && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/dnf install *,/usr/bin/dnf5 install *"
        [ -x /usr/bin/dnf5 ]    && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/dnf5 install *"
        [ -x /usr/bin/zypper ]  && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/zypper install *,/usr/bin/zypper in *"
        [ -x /usr/bin/pacman ]  && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/pacman -S *,/usr/bin/pacman --sync *"
        [ -x /usr/bin/yay ]     && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/yay -S *,/usr/bin/yay --sync *"
        [ -x /usr/bin/paru ]    && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/paru -S *,/usr/bin/paru --sync *"
    } > /etc/sudoers.d/55-life-parental-install-"$TARGET_USER"
    chmod 440 /etc/sudoers.d/55-life-parental-install-"$TARGET_USER"
    echo "status: allow-install-set"
fi

# Allow system updates (PackageKit + Flatpak) — no removal
if [ "$ALLOW_UPDATE" = "true" ]; then
    cat > /etc/polkit-1/rules.d/55-life-parental-update-"$TARGET_USER".rules << EOF
polkit.addRule(function(action, subject) {
    if (subject.user !== "$TARGET_USER") { return; }
    var allowed = [
        // PackageKit updates
        "org.freedesktop.packagekit.system-update",
        "org.freedesktop.packagekit.trigger-offline-update",
        "org.freedesktop.packagekit.trigger-offline-upgrade",
        "org.freedesktop.packagekit.system-sources-refresh",
        // Flatpak updates
        "org.freedesktop.Flatpak.app-update",
        "org.freedesktop.Flatpak.runtime-update",
        "org.freedesktop.Flatpak.appstream-update",
        "org.freedesktop.Flatpak.update-remote",
    ];
    if (allowed.indexOf(action.id) !== -1) {
        return polkit.Result.AUTH_SELF_KEEP;
    }
});
EOF
    # Sudoers fallback for update — distro-aware, only update/upgrade subcommands
    {
        [ -x /usr/bin/apt ]     && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/apt update,/usr/bin/apt upgrade,/usr/bin/apt full-upgrade"
        [ -x /usr/bin/apt-get ] && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/apt-get update,/usr/bin/apt-get upgrade,/usr/bin/apt-get dist-upgrade"
        [ -x /usr/bin/dnf ]     && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/dnf update,/usr/bin/dnf upgrade"
        [ -x /usr/bin/zypper ]  && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/zypper update,/usr/bin/zypper up,/usr/bin/zypper patch"
        [ -x /usr/bin/pacman ]  && echo "$TARGET_USER ALL=(ALL) NOPASSWD: /usr/bin/pacman -Syu,/usr/bin/pacman -Sy"
    } > /etc/sudoers.d/55-life-parental-update-"$TARGET_USER"
    chmod 440 /etc/sudoers.d/55-life-parental-update-"$TARGET_USER"
    echo "status: allow-update-set"
fi

# Add target user to fuse group — only if parent explicitly allows it (checkbox)
if [ "$ALLOW_FUSE" = "true" ]; then
    usermod -aG fuse "$TARGET_USER" && echo "status: allow-fuse-set" || true
fi

echo "status: success"
exit 0
