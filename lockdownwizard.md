Act as a Senior Linux System Architect and Node.js Developer. 
I need to implement a "Lockdown-Wizard" for my Electron/Vue Parental Control app.

### Goal:
Ensure the system is secure by de-privileging users while maintaining a "Fail-Safe" Admin access.

### Logic & Constraints:
1. **Startup Check:** On app launch, check `config/default.json`. If `"finishedLockdownWizard": true` is missing or false, trigger the Wizard UI.
2. **Analysis Phase:** Run the following checks via `child_process.exec`:
   - `sudo -l -U [targetUser]` & `groups [targetUser]` (Identify privileges)
   - `sudo find /home /tmp /var/tmp -xdev -perm -4000 -user root 2>/dev/null` (Find SUID backdoors)
   - `sudo grep "root:" /etc/shadow` (Check if root password is set)
   - `getent group sudo || getent group wheel` (Verify if at least one other Admin exists)
   - `sudo grep -r "password" /boot/grub/` (Check for GRUB password)

3. **UI Generation (Vue):** Present a list of "To-Dos" with checkboxes:
   - [ ] "Remove SUID bit from: [path]" (if found)
   - [ ] "Set/Change Root Password" (if none or desired)
   - [ ] "Demote User [name] from Admin" (Only if another verified Admin exists!)
   - [ ] "Set GRUB password"

4. **Fail-Safe Protocol:** - NEVER allow removing a user from `sudo`/`wheel` if it's the last admin.
   - Before demoting the current user, force a "Verify Admin Access" step (e.g., let the user set a root password and confirm they know it).

5. **Optional Privileges (PolKit):** After lockdown, offer selective permissions for the restricted user:
   - [ ] Allow app installation (`org.freedesktop.packagekit.package-install`)
   - [ ] Allow system updates (`org.freedesktop.packagekit.system-update`)
   - [ ] Allow FUSE mounts (for AppImages)

6. **Finalization:** - Apply changes using `pkexec` for a shell script.
   - Re-run all checks to verify success.
   - Update `default.json` with `"finishedLockdownWizard": true`.

### Task:**
1. Create a `LockdownService.js` to handle the shell command logic.
2. Create the Vue Wizard component with the checkbox logic.
3. Use `import` instead of `require`.
4. Comment code in English (concise, same line //).
5. Output must be valid, copy-pasteable code for an existing Electron environment.