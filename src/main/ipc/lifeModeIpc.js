import fs from 'fs'
import path from 'path'
import { WEB_FILTER_CATEGORIES } from './webFilterCategories.js'
import { DEFAULT_SCHEDULE, persistSchedule } from './schedulesIpc.js'
import { readWebFilterEntries, persistWebFilterEntries } from './webFilterIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'

const LIFE_MODES_FILE = 'life-modes.json'
const RESERVED_KEYS = new Set(['school', 'leisure'])
const KNOWN_CATEGORIES = new Set(Object.keys(WEB_FILTER_CATEGORIES))

const BUILTIN_LABELS = { school: 'School', leisure: 'Leisure' }

const BUILTIN_LIFE_MODES = {
    school: {
        schedule: {
            enabled: true,
            dailyLimitEnabled: true,
            dailyLimitMinutes: 90,
            allowedHoursEnabled: true,
            allowedHoursStart: '16:00',
            allowedHoursEnd: '20:00',
            allowedDays: [1, 2, 3, 4, 5]
        },
        mergeCategories: ['Social Media', 'Gaming'],
        blockedDesktopIds: []
    },
    leisure: {
        schedule: {
            enabled: true,
            dailyLimitEnabled: true,
            dailyLimitMinutes: 180,
            allowedHoursEnabled: true,
            allowedHoursStart: '09:00',
            allowedHoursEnd: '21:00',
            allowedDays: [1, 2, 3, 4, 5, 6, 7]
        },
        mergeCategories: [],
        stripCategories: ['Social Media', 'Gaming'],
        blockedDesktopIds: []
    }
}

function filterCategoryNames(arr) {
    if (!Array.isArray(arr)) return []
    return arr.filter(c => KNOWN_CATEGORIES.has(c))
}

function normalizeCustomMode(modeId, def) {
    if (typeof def !== 'object' || def === null) return null
    const schedIn = def.schedule && typeof def.schedule === 'object' ? def.schedule : {}
    return {
        schedule: { ...DEFAULT_SCHEDULE, ...schedIn },
        mergeCategories: filterCategoryNames(def.mergeCategories),
        stripCategories: filterCategoryNames(def.stripCategories),
        blockedDesktopIds: Array.isArray(def.blockedDesktopIds)
            ? def.blockedDesktopIds.filter(id => typeof id === 'string' && id.endsWith('.desktop'))
            : [],
        label: typeof def.label === 'string' && def.label.trim() ? def.label.trim() : modeId
    }
}

function readCustomLifeModes(configDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(configDir, LIFE_MODES_FILE), 'utf8'))
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
        return raw
    } catch {
        return {}
    }
}

function getAllLifeModes(configDir) {
    const out = { ...BUILTIN_LIFE_MODES }
    for (const [key, def] of Object.entries(readCustomLifeModes(configDir))) {
        if (RESERVED_KEYS.has(key)) continue
        const norm = normalizeCustomMode(key, def)
        if (norm) out[key] = norm
    }
    return out
}

function mergeCategoriesIntoEntries(entries, categoryNames) {
    const existing = new Set(entries.map(e => e.domain))
    const out = [...entries]
    for (const name of categoryNames) {
        for (const d of WEB_FILTER_CATEGORIES[name] || []) {
            if (!existing.has(d)) {
                out.push({ domain: d, enabled: true })
                existing.add(d)
            }
        }
    }
    return out
}

function stripCategoryDomainsFromEntries(entries, categoryNames) {
    const strip = new Set()
    for (const name of categoryNames) {
        for (const d of WEB_FILTER_CATEGORIES[name] || []) strip.add(d)
    }
    return entries.filter(e => !strip.has(e.domain))
}

export function registerLifeModeIpc(ipcMain, configDir) {
    ipcMain.handle('lifeMode:list', () => {
        const merged = getAllLifeModes(configDir)
        const modes = Object.keys(merged)
        const labels = {}
        for (const k of modes) {
            labels[k] = BUILTIN_LABELS[k] ?? merged[k].label ?? k
        }
        return { modes, labels, customPath: path.join(configDir, LIFE_MODES_FILE) }
    })

    ipcMain.handle('lifeMode:apply', (_, modeKey) => {
        const all = getAllLifeModes(configDir)
        const mode = all[modeKey]
        if (!mode) return { error: `Unknown mode: ${modeKey}` }
        const errs = []
        try {
            persistSchedule(configDir, mode.schedule)
        } catch (e) {
            errs.push(`schedule: ${e.message}`)
        }
        try {
            if (mode.mergeCategories?.length) {
                const cur = readWebFilterEntries(configDir)
                const mergedHosts = mergeCategoriesIntoEntries(cur, mode.mergeCategories)
                persistWebFilterEntries(configDir, mergedHosts)
            } else if (mode.stripCategories?.length) {
                const cur = readWebFilterEntries(configDir)
                const stripped = stripCategoryDomainsFromEntries(cur, mode.stripCategories)
                persistWebFilterEntries(configDir, stripped)
            }
        } catch (e) {
            errs.push(`webfilter: ${e.message}`)
        }
        try {
            replaceBlockedDesktopIds(configDir, mode.blockedDesktopIds ?? [])
        } catch (e) {
            errs.push(`apps: ${e.message}`)
        }
        return errs.length ? { error: errs.join(' — ') } : { ok: true }
    })
}
