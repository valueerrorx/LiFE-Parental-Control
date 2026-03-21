// Read DISPLAY/Wayland and related keys from a desktop process of the target user so root-spawned tray helper matches the real session.
import fs from 'fs'
import { execFileSync } from 'child_process'

export function getUidForLinuxUser(username) {
    if (!username || typeof username !== 'string') return ''
    try {
        const line = execFileSync('getent', ['passwd', username], { encoding: 'utf8' }).trim()
        const p = line.split(':')
        return p[2] || ''
    } catch {
        return ''
    }
}

/** Try these first (KDE/GNOME/…); order matters for typical Plasma setups. */
const DESKTOP_COMM_FOR_ENV = [
    'plasmashell',
    'gnome-shell',
    'gnome-session',
    'xfce4-session',
    'budgie-wm',
    'cinnamon',
    'mate-session',
    'lxqt-session',
    'sway',
    'Hyprland'
]

/** Keys needed so Electron + StatusNotifier attach to the user’s real graphical session (root often lacks these). */
const KEYS_FROM_DESKTOP = [
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'WAYLAND_SOCKET',
    'XDG_SESSION_TYPE',
    'XDG_CURRENT_DESKTOP',
    'XDG_SESSION_DESKTOP',
    'DESKTOP_SESSION',
    'QT_QPA_PLATFORM',
    'QT_WAYLAND_RESCAN',
    'GDK_BACKEND',
    'GTK_MODULES',
    'CLUTTER_BACKEND',
    'MOZ_ENABLE_WAYLAND',
    'XDG_MENU_PREFIX',
    'XDG_DATA_DIRS',
    'XDG_CONFIG_DIRS',
    'XDG_SESSION_ID',
    'KDE_FULL_SESSION',
    'KDE_SESSION_VERSION'
]

function parseEnvNullBuffer(buf) {
    const out = {}
    let i = 0
    while (i < buf.length) {
        let j = buf.indexOf(0, i)
        if (j === -1) j = buf.length
        if (j > i) {
            const line = buf.subarray(i, j).toString('utf8')
            const eq = line.indexOf('=')
            if (eq !== -1) out[line.slice(0, eq)] = line.slice(eq + 1)
        }
        i = j + 1
    }
    return out
}

function readRunuserEnv(username) {
    if (!username) return {}
    try {
        const buf = execFileSync('runuser', ['-u', username, '--', '/usr/bin/env', '-0'], {
            encoding: 'buffer',
            maxBuffer: 2 * 1024 * 1024,
            timeout: 8000
        })
        return parseEnvNullBuffer(buf)
    } catch {
        return {}
    }
}

function parseProcEnviron(pid) {
    try {
        const buf = fs.readFileSync(`/proc/${pid}/environ`)
        const out = {}
        let i = 0
        while (i < buf.length) {
            let j = buf.indexOf(0, i)
            if (j === -1) j = buf.length
            if (j > i) {
                const line = buf.subarray(i, j).toString('utf8')
                const eq = line.indexOf('=')
                if (eq !== -1) out[line.slice(0, eq)] = line.slice(eq + 1)
            }
            i = j + 1
        }
        return out
    } catch {
        return {}
    }
}

function findDesktopPidForUid(uidOrName) {
    for (const comm of DESKTOP_COMM_FOR_ENV) {
        try {
            const out = execFileSync('pgrep', ['-u', uidOrName, '-x', '-o', comm], { encoding: 'utf8', timeout: 5000 })
            const pid = out.trim().split(/\s+/).filter(Boolean)[0]
            if (pid && /^\d+$/.test(pid)) return pid
        } catch {
            /* no match */
        }
    }
    return null
}

function pickKeysFromMaps(fromProc, fromRun) {
    const picked = {}
    for (const k of KEYS_FROM_DESKTOP) {
        const a = fromProc[k]
        const b = fromRun[k]
        const v = (a != null && String(a).length > 0) ? a : b
        if (v != null && String(v).length > 0) picked[k] = v
    }
    return picked
}

/** Subset of session env: live desktop process wins over runuser for same keys (plasmashell has current DISPLAY). */
export function readDesktopSessionEnvForUid(uidOrName) {
    const pid = findDesktopPidForUid(uidOrName)
    const fromProc = pid ? (() => {
        const full = parseProcEnviron(pid)
        const o = {}
        for (const k of KEYS_FROM_DESKTOP) {
            const v = full[k]
            if (v != null && String(v).length > 0) o[k] = v
        }
        return o
    })() : {}
    let username = uidOrName
    try {
        const line = execFileSync('getent', ['passwd', uidOrName], { encoding: 'utf8' }).trim()
        const p = line.split(':')
        if (p[0]) username = p[0]
    } catch {
        /* keep uidOrName */
    }
    const fromRun = readRunuserEnv(username)
    return pickKeysFromMaps(fromProc, fromRun)
}

/** True when the graphical session looks like GNOME Shell (StatusNotifier tray is unreliable; use dock + close-to-hide instead). */
export function isSessionGnomeShell(env) {
    const cur = String(env?.XDG_CURRENT_DESKTOP || '').toUpperCase()
    const sess = String(env?.XDG_SESSION_DESKTOP || '').toLowerCase()
    const desk = String(env?.DESKTOP_SESSION || '').toLowerCase()
    if (cur.includes('GNOME')) return true
    if (sess === 'gnome' || sess === 'ubuntu') return true
    if (desk === 'gnome' || desk === 'ubuntu') return true
    return false
}
