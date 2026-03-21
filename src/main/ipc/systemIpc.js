import { app, dialog, Notification } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import { appendActivity } from './activityLog.js'
import { showWarningWindow } from '../warningWindow.js'

const KDEGLOBALS_PATH = '/etc/xdg/kdeglobals'
const PLASMA_APPLETSRC_PATH = '/etc/xdg/plasma-appletsrc'

// Kiosk lockdown sections written by buildPlasmaConfig (must match kioskStore keys).
const KIOSK_SECTION_HEADERS = new Set([
    '[KDE Action Restrictions][$i]',
    '[KDE Control Module Restrictions][$i]',
    '[KDE URL Restrictions][$i]',
    '[KDE Resource Restrictions][$i]'
])

function stripLiFEKioskSections(text) {
    const out = []
    let skip = false
    for (const line of text.split('\n')) {
        const t = line.trim()
        const isSection = t.startsWith('[') && t.endsWith(']')
        if (isSection) {
            skip = KIOSK_SECTION_HEADERS.has(t)
            if (!skip) out.push(line)
            continue
        }
        if (!skip) out.push(line)
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function summarizeKdeglobalsKiosk(text) {
    let inKioskSection = false
    let restrictionCount = 0
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#') || line.startsWith(';')) continue
        if (line.startsWith('[') && line.endsWith(']')) {
            inKioskSection = KIOSK_SECTION_HEADERS.has(line)
            continue
        }
        if (!inKioskSection) continue
        if (line.includes('=')) restrictionCount++
    }
    return { active: restrictionCount > 0, restrictionCount }
}

function parseLoginctlShowSession(text) {
    const props = {}
    for (const line of String(text || '').trim().split('\n')) {
        const eq = line.indexOf('=')
        if (eq === -1) continue
        props[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    return props
}

function listGraphicalUsers(cb) {
    execFile('loginctl', ['list-sessions', '--no-legend'], { timeout: 5000 }, (err, stdout) => {
        if (err || !stdout) return cb([])
        const lines = stdout.trim().split('\n').filter(Boolean)
        const users = new Set()
        const step = (i) => {
            if (i >= lines.length) return cb([...users])
            const parts = lines[i].trim().split(/\s+/)
            if (parts.length < 3) return step(i + 1)
            const sid = parts[0]
            const user = parts[2]
            execFile(
                'loginctl',
                ['show-session', sid, '-p', 'Type', '-p', 'State', '-p', 'Class'],
                { timeout: 3000 },
                (e, out) => {
                    const p = parseLoginctlShowSession(out)
                    const t = p.Type || ''
                    const s = p.State || ''
                    const cls = p.Class || ''
                    if (cls === 'greeter' || cls === 'background') return step(i + 1)
                    // Only one session is typically active; other X11/Wayland seats often report online.
                    const live = s === 'active' || s === 'online'
                    if ((t === 'x11' || t === 'wayland') && live) users.add(user)
                    step(i + 1)
                }
            )
        }
        step(0)
    })
}

function restartKdeSession() {
    const dbusBins = ['qdbus6', 'qdbus', '/usr/lib/qt6/bin/qdbus', '/usr/lib/qt5/bin/qdbus', '/usr/lib64/qt6/bin/qdbus', '/usr/lib64/qt5/bin/qdbus']
    const dbusServices = ['org.kde.KSMServer', 'org.kde.ksmserver']
    const dbusAttempts = []
    for (const bin of dbusBins) {
        for (const svc of dbusServices) dbusAttempts.push([bin, svc])
    }
    const runDbusChain = idx => {
        if (idx >= dbusAttempts.length) return
        const [bin, svc] = dbusAttempts[idx]
        execFile(bin, [svc, '/KSMServer', 'logout', '0', '0', '1'], { timeout: 8000 }, err => {
            if (!err) return
            runDbusChain(idx + 1)
        })
    }
    const runAllDbusAsUser = (username, next) => {
        execFile('id', ['-u', username], { timeout: 3000 }, (e1, uOut) => {
            if (e1) return next()
            const uid = Number(String(uOut).trim())
            if (!Number.isFinite(uid)) return next()
            execFile('id', ['-g', username], { timeout: 3000 }, (e2, gOut) => {
                if (e2) return next()
                const gid = Number(String(gOut).trim())
                const tryBin = ai => {
                    if (ai >= dbusAttempts.length) return next()
                    const [bin, svc] = dbusAttempts[ai]
                    execFile(bin, [svc, '/KSMServer', 'logout', '0', '0', '1'], {
                        timeout: 8000,
                        uid,
                        gid,
                        env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus` }
                    }, err => {
                        if (!err) return next()
                        tryBin(ai + 1)
                    })
                }
                tryBin(0)
            })
        })
    }
    const tryUsersThenRoot = (users, i) => {
        if (i >= users.length) return runDbusChain(0)
        runAllDbusAsUser(users[i], () => tryUsersThenRoot(users, i + 1))
    }
    execFile('kquitapp6', ['ksmserver'], { timeout: 8000 }, err => {
        if (!err) return
        execFile('kquitapp5', ['ksmserver'], { timeout: 8000 }, err2 => {
            if (!err2) return
            listGraphicalUsers(users => tryUsersThenRoot(users, 0))
        })
    })
}

export function readPlasmaLayoutLockActive() {
    try {
        const text = fs.readFileSync(PLASMA_APPLETSRC_PATH, 'utf8')
        return (text.split('\n')[0] ?? '').trim() === '[$i]'
    } catch (err) {
        if (err.code === 'ENOENT') return false
        throw err
    }
}

export function readKioskLockdownSummary() {
    try {
        const text = fs.readFileSync(KDEGLOBALS_PATH, 'utf8')
        const { active, restrictionCount } = summarizeKdeglobalsKiosk(text)
        return { active, restrictionCount, plasmaLayoutLocked: readPlasmaLayoutLockActive() }
    } catch (err) {
        if (err.code === 'ENOENT') {
            return { active: false, restrictionCount: 0, plasmaLayoutLocked: readPlasmaLayoutLockActive() }
        }
        throw err
    }
}

function applyPlasmaLayoutHardLock() {
    let existing = ''
    try {
        existing = fs.readFileSync(PLASMA_APPLETSRC_PATH, 'utf8')
    } catch (e) {
        if (e.code !== 'ENOENT') throw e
    }
    const first = (existing.split('\n')[0] ?? '').trim()
    if (first === '[$i]') return
    fs.writeFileSync(PLASMA_APPLETSRC_PATH, existing ? `[$i]\n${existing}` : `[$i]\n`, 'utf8')
}

function stripPlasmaLayoutHardLock() {
    let existing = ''
    try {
        existing = fs.readFileSync(PLASMA_APPLETSRC_PATH, 'utf8')
    } catch (e) {
        if (e.code === 'ENOENT') return
        throw e
    }
    const lines = existing.split('\n')
    if ((lines[0] ?? '').trim() !== '[$i]') return
    const rest = lines.slice(1)
    while (rest.length && rest[0].trim() === '') rest.shift()
    const next = rest.join('\n')
    if (!next.trim()) {
        try {
            fs.unlinkSync(PLASMA_APPLETSRC_PATH)
        } catch {
            /* ignore */
        }
    } else {
        fs.writeFileSync(PLASMA_APPLETSRC_PATH, next, 'utf8')
    }
}

export function persistKioskConfigText(configDir, configText, plasmaLayoutHardLock = false) {
    let existing = ''
    try {
        existing = fs.readFileSync(KDEGLOBALS_PATH, 'utf8')
    } catch (e) {
        if (e.code !== 'ENOENT') throw e
    }
    const stripped = stripLiFEKioskSections(existing).trimEnd()
    const block = (configText ?? '').trim()
    const next = block
        ? (stripped ? `${stripped}\n\n${block}\n` : `${block}\n`)
        : (stripped ? `${stripped}\n` : '')
    fs.writeFileSync(KDEGLOBALS_PATH, next, 'utf8')
    if (block === '') {
        stripPlasmaLayoutHardLock()
    } else if (plasmaLayoutHardLock) {
        applyPlasmaLayoutHardLock()
    } else {
        stripPlasmaLayoutHardLock()
    }
    if (configDir) {
        appendActivity(configDir, { action: block ? 'kiosk_apply' : 'kiosk_strip' })
    }
    restartKdeSession()
}

function applyUrgentWindowPresentation(win) {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    try {
        win.setVisibleOnAllWorkspaces(true)
    } catch {
        /* ignore */
    }
    try {
        win.setAlwaysOnTop(true, 'screen-saver')
    } catch {
        try {
            win.setAlwaysOnTop(true, 'floating')
        } catch {
            try {
                win.setAlwaysOnTop(true)
            } catch {
                /* ignore */
            }
        }
    }
    try {
        win.moveTop()
    } catch {
        /* ignore */
    }
}

function clearUrgentWindowPresentation(win) {
    if (!win || win.isDestroyed()) return
    try {
        win.setAlwaysOnTop(false)
    } catch {
        /* ignore */
    }
    try {
        win.setVisibleOnAllWorkspaces(false)
    } catch {
        /* ignore */
    }
}

export function registerSystemIpc(ipcMain, getWindow, configDir) {
    let urgentPresentDepth = 0
    ipcMain.handle('system:getAppInfo', () => ({
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        node: process.versions.node,
        runningAsRoot: typeof process.getuid === 'function' ? process.getuid() === 0 : null,
        xdgCurrentDesktop: process.env.XDG_CURRENT_DESKTOP ?? ''
    }))

    ipcMain.handle('system:getKioskStatus', async () => {
        try {
            return { ok: true, ...readKioskLockdownSummary() }
        } catch (err) {
            return { ok: false, error: err.message, active: false, restrictionCount: 0, plasmaLayoutLocked: false }
        }
    })

    ipcMain.handle('system:activateKiosk', async (_, payload) => {
        try {
            const configText = typeof payload === 'string' ? payload : (payload?.configText ?? '')
            const plasmaLayoutHardLock = typeof payload === 'object' && payload?.plasmaLayoutHardLock === true
            persistKioskConfigText(configDir, configText, plasmaLayoutHardLock)
            return { ok: true }
        } catch (err) {
            return { error: err.message }
        }
    })

    ipcMain.handle('dialog:openDirectory', async () => {
        const win = getWindow()
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            properties: ['openDirectory'],
            title: 'Select Directory'
        })
        return canceled ? null : filePaths[0]
    })

    ipcMain.handle('dialog:showError', async (_, { title, message }) => {
        const win = getWindow()
        await dialog.showMessageBox(win, {
            type: 'error',
            title: title || 'LiFE Parental Control',
            message: String(message ?? '')
        })
    })

    ipcMain.handle('dialog:showConfirm', async (_, opts) => {
        const win = getWindow()
        const title = (opts && opts.title) || 'Confirm'
        const message = String((opts && opts.message) ?? '')
        const okLabel = (opts && opts.okLabel) || 'OK'
        const cancelLabel = (opts && opts.cancelLabel) || 'Cancel'
        const { response } = await dialog.showMessageBox(win, {
            type: 'question',
            buttons: [cancelLabel, okLabel],
            defaultId: 0,
            cancelId: 0,
            title,
            message
        })
        return response === 1
    })

    ipcMain.handle('window:beginUrgentPresent', () => {
        const win = getWindow()
        urgentPresentDepth += 1
        if (urgentPresentDepth === 1) applyUrgentWindowPresentation(win)
        return { ok: true }
    })

    ipcMain.handle('window:endUrgentPresent', () => {
        const win = getWindow()
        if (urgentPresentDepth <= 0) return { ok: true }
        urgentPresentDepth -= 1
        if (urgentPresentDepth === 0) clearUrgentWindowPresentation(win)
        return { ok: true }
    })

    ipcMain.handle('window:isObscured', () => {
        const win = getWindow()
        if (!win || win.isDestroyed()) return true
        return win.isMinimized() || !win.isVisible()
    })

    ipcMain.handle('window:showUrgentWarning', (_, payload) => {
        try {
            showWarningWindow(payload ?? {})
            appendActivity(configDir, { action: 'warning_window_shown', type: payload?.type })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'warning_window_error', error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('window:showNativeNotification', (_, payload) => {
        const title = String((payload && payload.title) || 'LiFE Parental Control')
        const body = String((payload && payload.body) ?? '')
        if (!Notification.isSupported()) return { ok: false, reason: 'not_supported' }
        try {
            const n = new Notification({ title, body })
            n.on('click', () => {
                const win = getWindow()
                if (!win || win.isDestroyed()) return
                if (win.isMinimized()) win.restore()
                win.show()
                win.focus()
            })
            n.show()
            return { ok: true }
        } catch (e) {
            return { ok: false, error: String(e && e.message ? e.message : e) }
        }
    })
}
