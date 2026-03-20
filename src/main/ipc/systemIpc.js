import { app, dialog } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'

const KDEGLOBALS_PATH = '/etc/xdg/kdeglobals'

// Kiosk lockdown sections written by buildPlasmaConfig (must match kioskStore keys).
const KIOSK_SECTION_HEADERS = new Set([
    '[KDE Action Restrictions][$i]',
    '[KDE Control Module Restrictions][$i]',
    '[KDE URL Restrictions][$i]'
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

function summarizeKdeglobalsKiosk(text) {
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

export function registerSystemIpc(ipcMain, getWindow) {
    ipcMain.handle('system:getAppInfo', () => ({
        name: app.getName(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        node: process.versions.node
    }))

    ipcMain.handle('system:getKioskStatus', async () => {
        try {
            const text = fs.readFileSync(KDEGLOBALS_PATH, 'utf8')
            return { ok: true, ...summarizeKdeglobalsKiosk(text) }
        } catch (err) {
            if (err.code === 'ENOENT') return { ok: true, active: false, restrictionCount: 0 }
            return { ok: false, error: err.message, active: false, restrictionCount: 0 }
        }
    })

    ipcMain.handle('system:activateKiosk', async (_, configText) => {
        try {
            let existing = ''
            try {
                existing = fs.readFileSync(KDEGLOBALS_PATH, 'utf8')
            } catch (e) {
                if (e.code !== 'ENOENT') throw e
            }
            const stripped = stripLiFEKioskSections(existing).trimEnd()
            const block = (configText ?? '').trim()
            const next = block ? (stripped ? `${stripped}\n\n${block}\n` : `${block}\n`) : (stripped ? `${stripped}\n` : '')
            fs.writeFileSync(KDEGLOBALS_PATH, next, 'utf8')
            restartKdeSession()
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

    ipcMain.handle('app:quit', () => app.quit())
}
