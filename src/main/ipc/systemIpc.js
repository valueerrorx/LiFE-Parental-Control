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

function restartKdeSession() {
    const dbusBins = ['qdbus6', 'qdbus', '/usr/lib/qt6/bin/qdbus', '/usr/lib/qt5/bin/qdbus', '/usr/lib64/qt6/bin/qdbus', '/usr/lib64/qt5/bin/qdbus']
    const dbusServices = ['org.kde.KSMServer', 'org.kde.ksmserver']
    const dbusAttempts = []
    for (const bin of dbusBins) {
        for (const svc of dbusServices) dbusAttempts.push([bin, svc])
    }
    const runDbusChain = (idx) => {
        if (idx >= dbusAttempts.length) return
        const [bin, svc] = dbusAttempts[idx]
        execFile(bin, [svc, '/KSMServer', 'logout', '0', '0', '1'], { timeout: 8000 }, err => {
            if (!err) return
            runDbusChain(idx + 1)
        })
    }
    execFile('kquitapp6', ['ksmserver'], { timeout: 8000 }, err => {
        if (!err) return
        execFile('kquitapp5', ['ksmserver'], { timeout: 8000 }, err2 => {
            if (!err2) return
            runDbusChain(0)
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
