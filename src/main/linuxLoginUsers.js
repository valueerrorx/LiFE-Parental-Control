import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Shells that cannot run an interactive / graphical session. */
const NO_LOGIN_SHELL = /[/\\](nologin|false|git-shell)$/i

function readUidMin() {
    try {
        const text = fs.readFileSync('/etc/login.defs', 'utf8')
        const m = text.match(/^\s*UID_MIN\s+(\d+)/m)
        if (m) {
            const n = Number(m[1])
            if (Number.isFinite(n) && n >= 100) return n
        }
    } catch {
        /* ignore */
    }
    return 1000
}

/**
 * Local login names that typically have a real shell (same pool as desktop session logins).
 * @returns {Promise<string[]>}
 */
export async function listDesktopLoginUsers() {
    const uidMin = readUidMin()
    try {
        const { stdout } = await execFileAsync('getent', ['passwd'], { timeout: 8000 })
        const out = new Set()
        for (const line of String(stdout || '').split('\n')) {
            if (!line.trim()) continue
            const parts = line.split(':')
            if (parts.length < 7) continue
            const name = parts[0]
            const uid = Number(parts[2])
            const shell = parts[6] || ''
            if (!Number.isFinite(uid) || uid < uidMin || uid >= 65534) continue
            if (NO_LOGIN_SHELL.test(shell)) continue
            if (name === 'nobody') continue
            if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue
            out.add(name)
        }
        return [...out].sort((a, b) => a.localeCompare(b))
    } catch {
        return []
    }
}
