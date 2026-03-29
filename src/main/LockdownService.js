/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import { log, error as logError } from './logger.js'

const execFileAsync = promisify(execFile)

/** Generate a GRUB pbkdf2 hash for the given password, returns empty string on failure. */
function grubHashPassword(password) {
    return new Promise((resolve) => {
        const child = execFile('grub-mkpasswd-pbkdf2', [], { timeout: 10_000 }, (err, stdout) => {
            if (err) { resolve(''); return }
            const match = stdout.match(/grub\.pbkdf2\.sha512\S+/)
            resolve(match ? match[0] : '')
        })
        // Write password twice (prompt expects two confirmations), then close stdin
        child.stdin.write(`${password}\n${password}\n`)
        child.stdin.end()
    })
}

// --- Analysis helpers ---

/** Run a shell command safely; return { stdout, stderr, ok, code }. */
async function run(cmd, args, opts = {}) {
    try {
        const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10_000, ...opts })
        return { ok: true, stdout: stdout ?? '', stderr: stderr ?? '' }
    } catch (e) {
        return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code }
    }
}

/** Collect system state needed to build the wizard todo list. */
export async function analyzeLockdownState(targetUser) {
    const findings = {
        targetUser,
        targetIsAdmin: false,       // is target in sudo/wheel?
        adminGroupMembers: [],      // other admins besides target
        rootPasswordSet: false,     // does /etc/shadow have a root hash?
        suidFiles: [],              // suspicious SUID paths
        grubPasswordSet: false,     // does grub config contain a password line?
        packageKitAvailable: false, // is packagekitd/pkcon present?
        fuseGroupExists: false,     // does the fuse group exist?
    }

    // Check if target user is in sudo/wheel
    const sudoMembers = await run('getent', ['group', 'sudo'])
    const wheelMembers = await run('getent', ['group', 'wheel'])
    const sudoLine = sudoMembers.stdout + wheelMembers.stdout
    if (sudoLine.includes(targetUser)) findings.targetIsAdmin = true

    // List all members of sudo/wheel to detect other admins
    const allAdmins = new Set()
    for (const line of sudoLine.split('\n')) {
        const parts = line.split(':')
        if (parts.length >= 4) {
            parts[3].split(',').filter(u => u.trim()).forEach(u => allAdmins.add(u.trim()))
        }
    }
    findings.adminGroupMembers = [...allAdmins].filter(u => u && u !== targetUser)

    // Check if root has a real password in /etc/shadow (needs root)
    const shadowCheck = await run('grep', ['-E', '^root:[^!*]', '/etc/shadow'])
    findings.rootPasswordSet = shadowCheck.ok && shadowCheck.stdout.trim().length > 0

    // Scan for SUID root files in home/tmp (needs root)
    const suidScan = await run('find', [
        `/home/${targetUser}`, '/tmp', '/var/tmp',
        '-xdev', '-perm', '-4000', '-user', 'root',
    ])
    findings.suidFiles = suidScan.stdout.split('\n').map(l => l.trim()).filter(Boolean)

    // Check /etc/grub.d/ only — /boot/grub/grub.cfg is root-readable only
    const grubCheckD = await run('grep', ['-r', 'password_pbkdf2', '/etc/grub.d/'])
    findings.grubPasswordSet = grubCheckD.ok && grubCheckD.stdout.trim().length > 0

    // Check if PackageKit is available (pkcon is the CLI tool, present when packagekit is installed)
    const pkCheck = await run('sh', ['-c', 'command -v pkcon || command -v packagekitd'])
    findings.packageKitAvailable = pkCheck.ok && pkCheck.stdout.trim().length > 0

    // Check if fuse group exists
    const fuseCheck = await run('getent', ['group', 'fuse'])
    findings.fuseGroupExists = fuseCheck.ok && fuseCheck.stdout.trim().length > 0

    log('[LockdownService] analysis:', JSON.stringify(findings))
    return findings
}

const LOCKDOWN_SCRIPT = '/usr/bin/life-parental-lockdown'

/**
 * Execute the lockdown shell script via pkexec.
 * @param {string} targetUser  – child account to de-privilege
 * @param {string} adminUser   – new parent admin to create/verify
 * @param {string} adminPw     – password for admin + root
 * @returns {{ ok: boolean, error?: string }}
 */
export async function executeLockdown(targetUser, adminUser, adminPw, options = {}) {
    // Pre-compute GRUB hash here (as non-root) — grub-mkpasswd-pbkdf2 needs stdin which pkexec blocks
    const grubHash = await grubHashPassword(adminPw)
    log(`[LockdownService] grub hash computed: ${grubHash ? 'ok' : 'unavailable'}`)

    if (!fs.existsSync(LOCKDOWN_SCRIPT)) {
        const msg = `Lockdown script not found: ${LOCKDOWN_SCRIPT} — run "Install daemon" first`
        logError('[LockdownService]', msg)
        return { ok: false, error: msg }
    }

    // Password written to a temp file (600) so it never appears in the pkexec dialog or process list
    const tmpPwFile = '/tmp/life-parental-lockdown.pw'
    try {
        fs.writeFileSync(tmpPwFile, adminPw, { mode: 0o600 })
    } catch (e) {
        return { ok: false, error: `Failed to stage lockdown script: ${e.message}` }
    }

    try {
        log(`[LockdownService] running pkexec lockdown targetUser=${targetUser} adminUser=${adminUser}`)
        const allowInstall = options.allowInstall ? 'true' : 'false'
        const allowUpdate  = options.allowUpdate  ? 'true' : 'false'
        const allowFuse    = options.allowFuse    ? 'true' : 'false'
        let stdout = '', stderr = ''
        try {
            // Password passed via temp file path — never visible in dialog or ps aux
            const result = await execFileAsync(
                'pkexec', [LOCKDOWN_SCRIPT, targetUser, adminUser, tmpPwFile, grubHash, allowInstall, allowUpdate, allowFuse],
                { timeout: 60_000 }
            )
            stdout = result.stdout ?? ''
            stderr = result.stderr ?? ''
        } catch (e) {
            // execFileAsync throws on non-zero exit — but stdout may still contain 'status: success'
            stdout = e.stdout ?? ''
            stderr = e.stderr ?? ''
            logError(`[LockdownService] pkexec non-zero exit: code=${e.code} stdout=${stdout.trim()} stderr=${stderr.trim()}`)
        }
        log(`[LockdownService] pkexec stdout=${stdout.trim()} stderr=${stderr.trim()}`)

        if (stdout.includes('status: success')) {
            return { ok: true }
        }
        const errLine = stdout.split('\n').find(l => l.startsWith('status: error'))
            || stderr.trim()
            || 'Unknown error'
        return { ok: false, error: errLine }
    } finally {
        try { fs.unlinkSync(tmpPwFile) } catch { /* ignore */ }
    }
}
