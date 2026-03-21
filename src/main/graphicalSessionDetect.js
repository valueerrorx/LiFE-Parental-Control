import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Comm names for sessions where logind still reports Type=tty (e.g. desktop started from a VT without DM). */
const DESKTOP_COMM_NAMES = [
    'gnome-shell',
    'gnome-session',
    'plasmashell',
    'xfce4-session',
    'budgie-wm',
    'cinnamon',
    'mate-session',
    'lxqt-session',
    'sway',
    'Hyprland',
    'Xorg'
]

export function parseLoginctlSession(text) {
    const props = {}
    for (const line of String(text || '').trim().split('\n')) {
        const eq = line.indexOf('=')
        if (eq === -1) continue
        props[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    return props
}

async function userHasDesktopEnvironment(user) {
    for (const name of DESKTOP_COMM_NAMES) {
        try {
            const { stdout } = await execFileAsync('pgrep', ['-u', user, '-x', name], { timeout: 2000 })
            if (String(stdout || '').trim().length > 0) return true
        } catch {
            /* process not running */
        }
    }
    return false
}

/**
 * Graphical sessions for enforcement: logind x11/wayland, or tty-based desktop (VT start) when a desktop comm is present.
 */
export async function getActiveGraphicalSessions() {
    try {
        const { stdout } = await execFileAsync('loginctl', ['list-sessions', '--no-legend'], { timeout: 5000 })
        const sessions = []
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
            const parts = line.trim().split(/\s+/)
            if (parts.length < 3) continue
            const sid = parts[0]
            const user = parts[2]
            try {
                const { stdout: out2 } = await execFileAsync(
                    'loginctl',
                    ['show-session', sid, '-p', 'Type', '-p', 'State', '-p', 'Class', '-p', 'Remote'],
                    { timeout: 3000 }
                )
                const p = parseLoginctlSession(out2)
                if (p.Class === 'greeter' || p.Class === 'background') continue
                const live = p.State === 'active' || p.State === 'online'
                if (!live) continue
                const t = p.Type || ''
                if (t === 'x11' || t === 'wayland' || t === 'mir') {
                    sessions.push({ user, sid })
                    continue
                }
                if (t === 'tty' && p.Class === 'user' && p.Remote !== 'yes' && await userHasDesktopEnvironment(user)) {
                    sessions.push({ user, sid })
                }
            } catch {
                /* skip session */
            }
        }
        return sessions
    } catch {
        return []
    }
}
