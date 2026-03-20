import { WEB_FILTER_CATEGORIES } from './webFilterCategories.js'
import { persistSchedule } from './schedulesIpc.js'
import { readWebFilterEntries, persistWebFilterEntries } from './webFilterIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'

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

// One-shot bundles: schedule + optional web merges/strips + blocked desktop ids (empty = clear blocks).
const LIFE_MODES = {
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
        // Removes only domains that belong to these built-in lists (same as school preset adds).
        stripCategories: ['Social Media', 'Gaming'],
        blockedDesktopIds: []
    }
}

export function registerLifeModeIpc(ipcMain, configDir) {
    ipcMain.handle('lifeMode:list', () => ({ modes: Object.keys(LIFE_MODES) }))

    ipcMain.handle('lifeMode:apply', (_, modeKey) => {
        const mode = LIFE_MODES[modeKey]
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
                const merged = mergeCategoriesIntoEntries(cur, mode.mergeCategories)
                persistWebFilterEntries(configDir, merged)
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
