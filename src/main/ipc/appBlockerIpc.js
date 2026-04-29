import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { desktopIconToDataUrl } from './desktopIconResolve.js'
import { daemonSyncAppArmorAsync, daemonDesktopOverride } from '../daemonPrivilegedOps.js'
import { redeployQuotaFromDisk } from './quotaIpc.js'
import { appendActivity } from './activityLog.js'
import { patchDefaultJson, readDefaultJson } from '../defaultProfileStore.js'

const DESKTOP_DIRS = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications'
]
// Desktop file overrides placed here (per-system, root-writable)
const OVERRIDE_DIR = '/usr/local/share/applications'
const APP_MONITOR_BG_EXCLUDES_BASENAME = 'app-monitor-background-excludes.json'

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

function loadAppMonitorBackgroundExcludeSets(configDir) {
    const empty = () => ({ appIds: new Set(), processNames: new Set() })
    try {
        const p = path.join(configDir, APP_MONITOR_BG_EXCLUDES_BASENAME)
        if (!fs.existsSync(p)) return empty()
        const data = JSON.parse(fs.readFileSync(p, 'utf8'))
        const rows = Array.isArray(data?.excludes) ? data.excludes : (Array.isArray(data) ? data : [])
        const appIds = new Set()
        const processNames = new Set()
        for (const row of rows) {
            if (typeof row === 'string') {
                const s = row.trim()
                if (s) processNames.add(s.toLowerCase())
                continue
            }
            if (row && typeof row === 'object') {
                if (typeof row.appId === 'string' && row.appId.trim()) appIds.add(row.appId.trim().toLowerCase())
                if (typeof row.processName === 'string' && row.processName.trim()) processNames.add(row.processName.trim().toLowerCase())
            }
        }
        return { appIds, processNames }
    } catch {
        return empty()
    }
}

function isAppMonitorCatalogEntryExcluded(app, sets) {
    if (!app || !sets) return false
    const aid = String(app.id || '').trim().toLowerCase()
    const proc = String(app.processName || '').trim().toLowerCase()
    if (aid && sets.appIds.has(aid)) return true
    if (proc && sets.processNames.has(proc)) return true
    return false
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

function desktopIdStem(id) {
    return path.basename(String(id || ''), '.desktop').toLowerCase()
}

function desktopIdTailStem(id) {
    const stem = desktopIdStem(id)
    const parts = stem.split('.')
    return parts[parts.length - 1] || stem
}

function resolveBlockedIdsAgainstApps(ids, apps) {
    const appIds = new Set((apps || []).map(a => a.id))
    const byStem = new Map()
    const byTail = new Map()
    // Index for fuzzy resolution between provided IDs and installed apps.
    const appIndex = []
    for (const a of apps || []) {
        const id = String(a.id || '')
        if (!id) continue
        const stem = desktopIdStem(id)
        const tail = desktopIdTailStem(id)
        if (!byStem.has(stem)) byStem.set(stem, [])
        byStem.get(stem).push(id)
        if (!byTail.has(tail)) byTail.set(tail, [])
        byTail.get(tail).push(id)
        appIndex.push({
            id,
            tail,
            name: String(a.name || ''),
            processName: String(a.processName || '')
        })
    }

    const out = []
    const seen = new Set()

    function levenshtein(a, b) {
        const s = String(a)
        const t = String(b)
        const n = s.length
        const m = t.length
        if (n === 0) return m
        if (m === 0) return n
        const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
        for (let i = 0; i <= n; i++) dp[i][0] = i
        for (let j = 0; j <= m; j++) dp[0][j] = j
        for (let i = 1; i <= n; i++) {
            const si = s.charCodeAt(i - 1)
            for (let j = 1; j <= m; j++) {
                const cost = si === t.charCodeAt(j - 1) ? 0 : 1
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                )
            }
        }
        return dp[n][m]
    }

    function fuzzyResolve(rawWithExt) {
        const rawStem = desktopIdStem(rawWithExt)
        const rawTail = desktopIdTailStem(rawWithExt)
        const maxLen = Math.max(rawStem.length, rawTail.length)
        const threshold = maxLen <= 6 ? 2 : 3
        let best = null
        let bestId = ''
        for (const a of appIndex) {
            const dist = Math.min(
                levenshtein(rawTail, a.tail),
                levenshtein(rawStem, desktopIdStem(a.id))
            )
            if (dist > threshold) continue
            if (best === null || dist < best) {
                best = dist
                bestId = a.id
            } else if (dist === best && a.id !== bestId) {
                bestId = ''
            }
        }
        return bestId || null
    }

    for (const rawId of ids || []) {
        const raw = String(rawId || '').trim()
        if (!raw) continue
        const withExt = raw.endsWith('.desktop') ? raw : `${raw}.desktop`
        let resolved = ''

        if (appIds.has(raw)) resolved = raw
        else if (appIds.has(withExt)) resolved = withExt
        else {
            const stem = desktopIdStem(withExt)
            const tail = desktopIdTailStem(withExt)
            const stemMatches = byStem.get(stem) || []
            if (stemMatches.length === 1) {
                resolved = stemMatches[0]
            } else {
                const tailMatches = byTail.get(tail) || []
                if (tailMatches.length === 1) resolved = tailMatches[0]
                if (!resolved) {
                    const fuzzy = fuzzyResolve(withExt)
                    if (fuzzy) resolved = fuzzy
                }
            }
        }

        if (!resolved || seen.has(resolved)) continue
        seen.add(resolved)
        out.push(resolved)
    }
    return out
}

function readBlocked(configDir) {
    const def = readDefaultJson(configDir)
    return normalizeBlockedIds(Array.isArray(def?.blockedDesktopIds) ? def.blockedDesktopIds : [])
}

function readAppControlConfig(configDir) {
    const def = readDefaultJson(configDir)
    return { enabled: def?.appControl?.enabled !== false }
}

function saveBlocked(configDir, list) {
    const normalized = normalizeBlockedIds(Array.isArray(list) ? list : [])
    patchDefaultJson(configDir, (d) => {
        d.blockedDesktopIds = normalized
        return d
    })
}

// Extract the real executable absolute path from a .desktop Exec= line; also returns resolution status.
function execLineToFullPath(execLine) {
    if (!execLine) return { fullPath: null, mode: 'empty' }
    const clean = execLine.trim().replace(/%[a-zA-Z]/g, '').trim()
    const tokens = clean.split(/\s+/).filter(Boolean)
    if (!tokens.length) return { fullPath: null, mode: 'empty' }
    let i = 0
    while (i < tokens.length) {
        const t = tokens[i]
        if (['env', 'dbus-run-session', 'gdbus'].includes(t.toLowerCase())) { i++; continue }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue }
        break
    }
    if (i >= tokens.length) return { fullPath: null, mode: 'empty' }
    const cmd = tokens[i]
    const base = cmd.includes('/') ? path.basename(cmd) : cmd
    if (base === 'flatpak' || base === 'snap') return { fullPath: null, mode: 'container' }
    if (cmd.startsWith('/')) return { fullPath: cmd, mode: 'absolute' }
    try {
        const r = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 2000 })
        const found = (r.stdout || '').trim()
        if (found && found.startsWith('/')) return { fullPath: found, mode: 'which' }
    } catch { /* which not available */ }
    return { fullPath: null, mode: 'which_failed' }
}

// Omit list entries only when we are sure the target binary doesn't exist in PATH or on disk.
function desktopExecResolvedPathMissing(execLine) {
    const r = execLineToFullPath(execLine)
    if (r.mode === 'container' || r.mode === 'empty') return false
    if (r.mode === 'which_failed') return true
    if (!r.fullPath) return false
    try {
        return !fs.existsSync(r.fullPath)
    } catch {
        return false
    }
}

/** Desktop entries only (no icons); same discovery order as App Control. */
export function readAllDesktopApps(configDir = '/etc/life-parental') {
    const apps = []
    const seen = new Set()
    const excl = loadAppMonitorBackgroundExcludeSets(configDir)
    for (const dir of DESKTOP_DIRS) {
        if (!fs.existsSync(dir)) continue
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.desktop'))) {
            if (seen.has(file)) continue
            seen.add(file)
            const app = parseDesktopFile(path.join(dir, file))
            if (!app) continue
            if (desktopExecResolvedPathMissing(app.exec)) continue
            const row = {
                id: file,
                name: app.name,
                exec: app.exec,
                icon: app.icon,
                filePath: app.filePath,
                processName: app.processName
            }
            if (isAppMonitorCatalogEntryExcluded(row, excl)) continue
            apps.push(row)
        }
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name))
}

// --- AppArmor blocking ---

function buildApparmorProfile(entries) {
    // entries: Array of { execPath, appId }
    const header = '# Managed by LiFE Parental Control — do not edit manually\n' +
                   '# Rewritten automatically on block/unblock. Do not edit by hand.\n\n'
    if (entries.length === 0) return header
    return header + entries.map(({ execPath, appId }) =>
        `${execPath} {\n  # ${appId} — blocked by parental controls\n  deny /** rwxl,\n}\n`
    ).join('\n')
}

// Sync the AppArmor profile file with the current blocked list and reload.
// Delegates write + reload to daemon (root); frontend sends profile content.
export function syncAppArmor(configDir) {
    const control = readAppControlConfig(configDir)
    const blocked = control.enabled ? readBlocked(configDir) : []
    const apps = readAllDesktopApps(configDir)
    const appMap = new Map(apps.map(a => [a.id, a]))

    const entries = []
    const seen = new Set()
    for (const id of blocked) {
        const app = appMap.get(id)
        if (!app) continue
        const execPath = execLineToFullPath(app.exec).fullPath
        if (!execPath || seen.has(execPath)) continue
        seen.add(execPath)
        entries.push({ execPath, appId: id })
    }

    daemonSyncAppArmorAsync(buildApparmorProfile(entries))
}

async function applyDesktopOverride(configDir, appId, block) {
    void configDir
    if (block) {
        // Build modified .desktop content locally (reading original is unprivileged — files are 0644)
        let content = null
        for (const dir of DESKTOP_DIRS) {
            const p = path.join(dir, appId)
            if (fs.existsSync(p) && p !== path.join(OVERRIDE_DIR, appId)) {
                try {
                    const original = fs.readFileSync(p, 'utf8')
                    let modified = original.replace(/^(NoDisplay=.*)$/m, 'NoDisplay=true')
                    if (!modified.includes('NoDisplay=true')) {
                        modified = modified.replace(/(\[Desktop Entry\])/, '$1\nNoDisplay=true')
                    }
                    modified = modified.replace(/^Exec=.*$/m,
                        'Exec=notify-send -u critical "LiFE Parental Control" "This application is blocked by parental controls."')
                    content = modified
                } catch { /* skip unreadable */ }
                break
            }
        }
        if (content) {
            await daemonDesktopOverride([{ appId, content }], [])
        }
    } else {
        await daemonDesktopOverride([], [appId])
    }
}

export async function replaceBlockedDesktopIds(configDir, nextIds) {
    const knownApps = readAllDesktopApps(configDir)
    const nextResolved = resolveBlockedIdsAgainstApps(Array.isArray(nextIds) ? nextIds : [], knownApps)
    const prevResolved = resolveBlockedIdsAgainstApps(readBlocked(configDir), knownApps)
    const next = new Set(nextResolved)
    const prev = prevResolved
    saveBlocked(configDir, [...next])
    for (const id of prev) {
        if (!next.has(id)) await applyDesktopOverride(configDir, id, false)
    }
    for (const id of next) {
        if (!prev.includes(id)) await applyDesktopOverride(configDir, id, true)
    }
}

export function registerAppBlockerIpc(ipcMain, configDir) {
    ipcMain.handle('apps:getControlConfig', () => {
        return readAppControlConfig(configDir)
    })

    ipcMain.handle('apps:setControlConfig', async (_, payload) => {
        try {
            const enabled = payload?.enabled !== false
            const cfg = { enabled }
            patchDefaultJson(configDir, (d) => {
                d.appControl = { enabled: cfg.enabled }
                return d
            })
            if (cfg.enabled) {
                syncAppArmor(configDir)
            } else {
                const blocked = readBlocked(configDir)
                for (const appId of blocked) await applyDesktopOverride(configDir, appId, false)
                patchDefaultJson(configDir, (d) => {
                    d.blockedDesktopIds = []
                    d.quota = []
                    return d
                })
                syncAppArmor(configDir)
            }
            appendActivity(configDir, { action: 'app_control_toggle', enabled: cfg.enabled })
            return { ok: true, ...cfg }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('apps:list', () => {
        const base = readAllDesktopApps(configDir)
        const resolvedBlocked = resolveBlockedIdsAgainstApps(readBlocked(configDir), base)
        const control = readAppControlConfig(configDir)
        const blocked = new Set(resolvedBlocked)
        const apps = base.map((app) => {
            const file = app.id
            const row = {
                id: file,
                name: app.name,
                exec: app.exec,
                icon: app.icon,
                filePath: app.filePath,
                processName: app.processName,
                blocked: control.enabled ? blocked.has(file) : false
            }
            const stem = path.basename(file, '.desktop')
            const iconDataUrl = desktopIconToDataUrl(app.icon, app.filePath, [
                stem,
                execLineToProcessName(app.exec)
            ])
            if (iconDataUrl) row.iconDataUrl = iconDataUrl
            return row
        })
        redeployQuotaFromDisk(configDir)
        return apps
    })

    ipcMain.handle('apps:setBlocked', async (_, appId, block) => {
        try {
            const list = readBlocked(configDir)
            const control = readAppControlConfig(configDir)
            if (block && !list.includes(appId)) list.push(appId)
            else if (!block) {
                const i = list.indexOf(appId)
                if (i !== -1) list.splice(i, 1)
            }
            saveBlocked(configDir, list)
            if (control.enabled) {
                await applyDesktopOverride(configDir, appId, block)
                syncAppArmor(configDir)
            }
            appendActivity(configDir, { action: block ? 'app_blocked' : 'app_unblocked', appId })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'app_block_error', appId, error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('apps:getBlocked', () => {
        const base = readAllDesktopApps(configDir)
        return resolveBlockedIdsAgainstApps(readBlocked(configDir), base)
    })
}
