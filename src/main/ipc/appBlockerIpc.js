import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { desktopIconToDataUrl } from './desktopIconResolve.js'
import { redeployQuotaFromDisk } from './quotaIpc.js'
import { appendActivity } from './activityLog.js'

const DESKTOP_DIRS = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications'
]
// Desktop file overrides placed here (per-system, root-writable)
const OVERRIDE_DIR = '/usr/local/share/applications'
const CONFIG_FILE = 'blocked-apps.json'
const APP_MONITOR_CATALOG = 'app-monitor-catalog.json'

// Best-effort name for pgrep -x: flatpak/snap, shell -c, electron, *.AppImage stem, first real executable.
function execLineToProcessName(execLine) {
    if (!execLine || typeof execLine !== 'string') return ''
    const raw = execLine.trim().split(/\s+/).map(t => t.replace(/^['"]|['"]$/g, ''))
    const skipLead = new Set(['env', 'dbus-run-session', 'gdbus'])
    let i = 0
    while (i < raw.length) {
        const t = raw[i]
        if (skipLead.has(t.toLowerCase())) {
            i++
            continue
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
            i++
            continue
        }
        break
    }
    const tokens = raw.slice(i)
    if (!tokens.length) return ''

    for (let j = 0; j < tokens.length; j++) {
        if (tokens[j].startsWith('--command=')) {
            const v = tokens[j].slice('--command='.length)
            if (v) return v.includes('/') ? (path.basename(v) || v) : v
        }
        if (tokens[j] === '--command' && j + 1 < tokens.length) {
            const v = tokens[j + 1]
            return v.includes('/') ? (path.basename(v) || v) : v
        }
    }

    for (let j = 0; j < tokens.length - 2; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j]
        if (base === 'snap' && tokens[j + 1] === 'run') {
            const v = tokens[j + 2]
            if (v && !v.startsWith('-')) return v.includes('/') ? (path.basename(v) || v) : v
        }
    }

    const flatpakArgPair = new Set(['--arch', '--branch', '--share', '--socket', '--device', '--filesystem', '--env',
        '--own-name', '--talk-name', '--system-talk-name', '--persist', '--add-policy', '--remove-policy'])
    for (let j = 0; j < tokens.length - 1; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j]
        if (base !== 'flatpak' || tokens[j + 1] !== 'run') continue
        let k = j + 2
        while (k < tokens.length && tokens[k].startsWith('-')) {
            const t = tokens[k]
            if (t.startsWith('--command=') || t === '--command') break
            if (t.includes('=')) {
                k++
                continue
            }
            if (flatpakArgPair.has(t) && k + 1 < tokens.length) {
                k += 2
                continue
            }
            k++
        }
        if (k < tokens.length && !tokens[k].startsWith('-')) {
            const app = tokens[k]
            if (app.includes('/')) return path.basename(app) || app
            if (app.includes('.')) {
                const tail = app.slice(app.lastIndexOf('.') + 1)
                return tail || app
            }
            return app
        }
        break
    }

    // Unwrap shell -c "…" / sh -c … so pgrep targets the real binary, not sh/bash.
    for (let j = 0; j < tokens.length - 1; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j]
        const sh = base.toLowerCase()
        if ((sh === 'sh' || sh === 'bash' || sh === 'dash' || sh === 'zsh') && tokens[j + 1] === '-c') {
            const inner = tokens.slice(j + 2).join(' ').replace(/^['"]|['"]$/g, '')
            return inner ? (execLineToProcessName(inner) || '') : ''
        }
    }

    // Electron launcher: skip flags (e.g. --no-sandbox) then use the app path/script for the real comm/name.
    for (let j = 0; j < tokens.length; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j]
        if (base.toLowerCase() !== 'electron') continue
        let k = j + 1
        while (k < tokens.length && tokens[k].startsWith('-')) k++
        if (k < tokens.length) {
            const nested = execLineToProcessName(tokens.slice(k).join(' '))
            if (nested) return nested
        }
        break
    }

    // AppImage path: stem often matches the sandboxed comm better than the runtime wrapper chain.
    for (const t of tokens) {
        if (!/\.appimage$/i.test(t)) continue
        const file = t.includes('/') ? path.basename(t) : t
        const stem = file.replace(/\.appimage$/i, '')
        if (stem) return stem
    }

    for (let p = 0; p < tokens.length; p++) {
        const t = tokens[p]
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue
        if (t.includes('/')) return path.basename(t) || t
        return t
    }
    return ''
}

function parseDesktopFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8')
        const get = (key) => {
            const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
            return m ? m[1].trim() : ''
        }
        const name = get('Name')
        const exec = get('Exec')
        const icon = get('Icon')
        const noDisplay = get('NoDisplay').toLowerCase() === 'true'
        const hidden = get('Hidden').toLowerCase() === 'true'
        if (!name || !exec || noDisplay || hidden) return null
        return { id: path.basename(filePath), name, exec, icon, filePath, processName: execLineToProcessName(exec) }
    } catch { return null }
}

function normalizeBlockedIds(raw) {
    if (!Array.isArray(raw)) return []
    return raw.map(item => (typeof item === 'string' ? item : item?.id)).filter(Boolean)
}

function readBlocked(configDir) {
    try {
        return normalizeBlockedIds(JSON.parse(fs.readFileSync(path.join(configDir, CONFIG_FILE), 'utf8')))
    } catch {
        return []
    }
}

function saveBlocked(configDir, list) {
    fs.writeFileSync(path.join(configDir, CONFIG_FILE), JSON.stringify(list, null, 2), 'utf8')
}

/** Desktop entries only (no icons); same discovery order as App Control. */
export function readAllDesktopApps() {
    const apps = []
    const seen = new Set()
    for (const dir of DESKTOP_DIRS) {
        if (!fs.existsSync(dir)) continue
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.desktop'))) {
            if (seen.has(file)) continue
            seen.add(file)
            const app = parseDesktopFile(path.join(dir, file))
            if (!app) continue
            apps.push({
                id: file,
                name: app.name,
                exec: app.exec,
                icon: app.icon,
                filePath: app.filePath,
                processName: app.processName
            })
        }
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name))
}

export function writeAppMonitorCatalog(configDir, apps) {
    const payload = {
        updatedAt: new Date().toISOString(),
        apps: apps
            .filter(a => (a.processName || '').trim().length > 0)
            .map(a => ({
                appId: a.id,
                appName: a.name,
                processName: (a.processName || '').trim()
            }))
    }
    fs.writeFileSync(path.join(configDir, APP_MONITOR_CATALOG), JSON.stringify(payload, null, 2), 'utf8')
}

/** Refresh catalog from disk and ensure cron script runs app-usage tally when quotas or catalog exist. */
export function refreshAppMonitorCatalog(configDir) {
    writeAppMonitorCatalog(configDir, readAllDesktopApps())
    redeployQuotaFromDisk(configDir)
}

function applyDesktopOverride(configDir, appId, block) {
    fs.mkdirSync(OVERRIDE_DIR, { recursive: true })
    const overridePath = path.join(OVERRIDE_DIR, appId)
    if (block) {
        let originalPath = null
        for (const dir of DESKTOP_DIRS) {
            const p = path.join(dir, appId)
            if (fs.existsSync(p)) {
                originalPath = p
                break
            }
        }
        if (originalPath && originalPath !== overridePath) {
            const original = fs.readFileSync(originalPath, 'utf8')
            let modified = original.replace(/^(NoDisplay=.*)$/m, 'NoDisplay=true')
            if (!modified.includes('NoDisplay=true')) {
                modified = modified.replace(/(\[Desktop Entry\])/, '$1\nNoDisplay=true')
            }
            modified = modified.replace(/^Exec=.*$/m,
                'Exec=notify-send -u critical "LiFE Parental Control" "This application is blocked by parental controls."')
            fs.writeFileSync(overridePath, modified, 'utf8')
        }
    } else if (fs.existsSync(overridePath)) {
        fs.unlinkSync(overridePath)
    }
    // Refresh the app launcher database so GNOME and other desktops pick up the NoDisplay change
    execFile('update-desktop-database', [OVERRIDE_DIR], { timeout: 5000 }, () => {})
}

export function replaceBlockedDesktopIds(configDir, nextIds) {
    const next = new Set(nextIds)
    const prev = readBlocked(configDir)
    for (const id of prev) {
        if (!next.has(id)) applyDesktopOverride(configDir, id, false)
    }
    for (const id of next) {
        if (!prev.includes(id)) applyDesktopOverride(configDir, id, true)
    }
    saveBlocked(configDir, [...next])
}

export function registerAppBlockerIpc(ipcMain, configDir) {
    ipcMain.handle('apps:list', () => {
        const blocked = new Set(readBlocked(configDir))
        const base = readAllDesktopApps()
        const apps = base.map((app) => {
            const file = app.id
            const row = {
                id: file,
                name: app.name,
                exec: app.exec,
                icon: app.icon,
                filePath: app.filePath,
                processName: app.processName,
                blocked: blocked.has(file)
            }
            const stem = path.basename(file, '.desktop')
            const iconDataUrl = desktopIconToDataUrl(app.icon, app.filePath, [
                stem,
                execLineToProcessName(app.exec)
            ])
            if (iconDataUrl) row.iconDataUrl = iconDataUrl
            return row
        })
        writeAppMonitorCatalog(configDir, base)
        redeployQuotaFromDisk(configDir)
        return apps
    })

    ipcMain.handle('apps:setBlocked', (_, appId, block) => {
        try {
            const list = readBlocked(configDir)
            if (block && !list.includes(appId)) list.push(appId)
            else if (!block) {
                const i = list.indexOf(appId)
                if (i !== -1) list.splice(i, 1)
            }
            saveBlocked(configDir, list)
            applyDesktopOverride(configDir, appId, block)
            appendActivity(configDir, { action: block ? 'app_blocked' : 'app_unblocked', appId })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'app_block_error', appId, error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('apps:getBlocked', () => readBlocked(configDir))
}
