import fs from 'fs'
import path from 'path'

const DESKTOP_DIRS = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications'
]
// Desktop file overrides placed here (per-system, root-writable)
const OVERRIDE_DIR = '/usr/local/share/applications'
const CONFIG_FILE = 'blocked-apps.json'

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
        return { id: path.basename(filePath), name, exec, icon, filePath }
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
        const apps = []
        const seen = new Set()
        for (const dir of DESKTOP_DIRS) {
            if (!fs.existsSync(dir)) continue
            for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.desktop'))) {
                if (seen.has(file)) continue
                seen.add(file)
                const app = parseDesktopFile(path.join(dir, file))
                if (app) apps.push({ ...app, blocked: blocked.has(file) })
            }
        }
        return apps.sort((a, b) => a.name.localeCompare(b.name))
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
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('apps:getBlocked', () => readBlocked(configDir))
}
