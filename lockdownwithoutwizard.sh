#!/bin/bash

# vars (uebernahme via $1, $2, $3 von node.js)
TARGET_USER="${1:-schueler}" // der eingeschraenkte user
ADMIN_USER="${2:-parentadmin}" // der neue master-admin
ADMIN_PW="${3:-SicheresPasswort123}" // das neue admin/root passwort

# --- PHASE 1: FAIL-SAFE (ADMIN GARANTIEREN) ---

# 1. root-account synchronisieren (erste prioritaet)
echo "root:$ADMIN_PW" | chpasswd // root bekommt sofort das neue pw als rettungsanker

# 2. master-admin anlegen falls nicht existent
if ! id "$ADMIN_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$ADMIN_USER" // neuen admin-user erstellen
    echo "$ADMIN_USER:$ADMIN_PW" | chpasswd // passwort setzen
fi

# 3. admin-gruppen & sudoers-drop-in sicherstellen
groupadd -f wheel // fuer arch/redhat
groupadd -f sudo // fuer debian/ubuntu
usermod -aG wheel,sudo "$ADMIN_USER"
echo "$ADMIN_USER ALL=(ALL:ALL) ALL" > /etc/sudoers.d/99-parent-admin // brute force sudo recht

# 4. VERIFIKATION: hat der neue admin wirklich rechte?
if ! sudo -l -u "$ADMIN_USER" | grep -q "(ALL : ALL) ALL"; then
    echo "status: error - privilege escalation for $ADMIN_USER failed! aborting before demoting target."
    exit 1
fi
echo "status: admin-access verified. proceeding with lockdown."

# --- PHASE 2: LOCKDOWN (TARGET DEMOTEN & SÄUBERN) ---

# 5. ziel-user radikal de-privilegieren (sudo/groups)
gpasswd -d "$TARGET_USER" sudo 2>/dev/null // entfernen aus sudo
gpasswd -d "$TARGET_USER" wheel 2>/dev/null // entfernen aus wheel
gpasswd -d "$TARGET_USER" admin 2>/dev/null // entfernen aus legacy admin
usermod -G "$TARGET_USER" "$TARGET_USER" // alle zusatzgruppen entfernen

# 6. polkit-berechtigungen eliminieren (backup & remove)
if [ -d /etc/polkit-1/rules.d ]; then
    mkdir -p /etc/polkit-1/rules.backup
    grep -lR "$TARGET_USER" /etc/polkit-1/rules.d/ | while read -r rulefile; do
        mv "$rulefile" "/etc/polkit-1/rules.backup/$(basename "$rulefile").bak" // regeln fuer target deaktivieren
    done
fi

# 7. backdoor-cleaner: suid bits entfernen
find "/home/$TARGET_USER" /tmp /var/tmp -xdev -perm /6000 -type f -user root -exec chmod u-s,g-s {} + 2>/dev/null

# 8. ssh-persistence stoppen
rm -rf "/home/$TARGET_USER/.ssh/authorized_keys" // verhindert remote-root-login via user-key

# 9. login-sperre fuer alle fremden user (uid >= 1000)
OTHER_USERS=$(awk -F':' '$3 >= 1000 && $1 != "nobody" && $1 != "'$TARGET_USER'" && $1 != "'$ADMIN_USER'" {print $1}' /etc/passwd)
for U in $OTHER_USERS; do
    usermod -L -s /usr/sbin/nologin "$U" // fremde accounts sperren
done

# 10. grub-bootloader absichern
if [ -d /etc/grub.d ]; then
    GRUB_HASH=$(echo -e "$ADMIN_PW\n$ADMIN_PW" | grub-mkpasswd-pbkdf2 | awk '/grub.pbkdf2.sha512/ {print $NF}')
    if [ -n "$GRUB_HASH" ]; then
        cat <<EOF > /etc/grub.d/40_custom
#!/bin/sh
exec tail -n +3 \$0
set superusers="$ADMIN_USER"
password_pbkdf2 $ADMIN_USER $GRUB_HASH
EOF
        if command -v update-grub &>/dev/null; then
            update-grub // ubuntu/debian
        elif command -v grub-mkconfig &>/dev/null; then
            grub-mkconfig -o /boot/grub/grub.cfg // arch/generic
        fi
    fi
fi

echo "status: success - system locked and admin verified"
exit 0