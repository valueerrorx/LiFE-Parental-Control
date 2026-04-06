import fs from 'fs'
import path from 'path'
import {
    WEB_FILTER_STATIC_CATEGORIES,
    CATEGORY_TO_HAGEZI_FEED,
    isKnownWebFilterCategory
} from './webFilterCategories.js'
import { DEFAULT_SCHEDULE, persistSchedule } from './schedulesIpc.js'
import { readWebFilterConfig, persistWebFilterEntries } from './webFilterIpc.js'
import { replaceBlockedDesktopIds } from './appBlockerIpc.js'
import { redeployQuotaFromDisk, replaceQuotaEntries } from './quotaIpc.js'
import { patchDefaultJson } from '../defaultProfileStore.js'

const DEFAULT_MODE_FILE = 'default.json'

const BUILTIN_DEFAULT_MODE = {
    label: 'Default',
    schedule: { ...DEFAULT_SCHEDULE },
    mergeCategories: [],
    stripCategories: [],
    blockedDesktopIds: [],
    webfilterMirror: undefined,
    quotaExemptions: undefined
}

let defaultModeReadOnceLogged = false

function filterCategoryNames(arr) {
    if (!Array.isArray(arr)) return []
    return arr.filter(c => isKnownWebFilterCategory(c))
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

function readDefaultMode(configDir) {
    const file = path.join(configDir, DEFAULT_MODE_FILE)
    try {
        if (!fs.existsSync(file)) {
            if (!defaultModeReadOnceLogged) {
                defaultModeReadOnceLogged = true
                console.info('[LiFE Parental Control] default.json not found, using built-in empty default mode')
            }
            return { ...BUILTIN_DEFAULT_MODE }
        }
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        const normalized = normalizeCustomMode('default', raw)
        if (!normalized) {
            if (!defaultModeReadOnceLogged) {
                defaultModeReadOnceLogged = true
                console.warn('[LiFE Parental Control] default.json invalid structure, using built-in empty default mode')
            }
            return { ...BUILTIN_DEFAULT_MODE }
        }

        const webfilterMirror = normalizeDefaultWebfilterMirror(raw)
        const quotaExemptions = normalizeDefaultQuotaExemptions(raw)

        if (!defaultModeReadOnceLogged) {
            defaultModeReadOnceLogged = true
            console.info('[LiFE Parental Control] default.json found and parsed', {
                hasWebfilter: Boolean(webfilterMirror),
                hasQuotaExemptions: Boolean(quotaExemptions),
                allowedIdsCount: Array.isArray(quotaExemptions?.allowedIds) ? quotaExemptions.allowedIds.length : 0
            })
        }

        return {
            ...BUILTIN_DEFAULT_MODE,
            ...normalized,
            label: normalized.label || 'Default',
            webfilterMirror,
            quotaExemptions,
            // normalizeCustomMode omits quota; without this, applyDefaultMergedState replaces disk with [] on every app start.
            quota: Array.isArray(raw.quota) ? raw.quota : []
        }
    } catch {
        if (!defaultModeReadOnceLogged) {
            defaultModeReadOnceLogged = true
            console.warn('[LiFE Parental Control] default.json could not be parsed, using built-in empty default mode')
        }
    }
    return { ...BUILTIN_DEFAULT_MODE }
}

function normalizeDefaultWebfilterMirror(raw) {
    if (!raw || typeof raw !== 'object' || !raw.webfilter) return undefined
    const w = raw.webfilter
    if (typeof w !== 'object' || w === null || Array.isArray(w)) return undefined

    const entries = Array.isArray(w.entries)
        ? w.entries
            .filter(e => e && typeof e.domain === 'string')
            .map(e => ({ domain: String(e.domain).toLowerCase(), enabled: e.enabled !== false }))
        : []

    const feedState = (w.feedState && typeof w.feedState === 'object' && !Array.isArray(w.feedState))
        ? { ...w.feedState }
        : {}

    const listAllowlist = Array.isArray(w.listAllowlist)
        ? w.listAllowlist.filter(d => typeof d === 'string')
        : []

    return { entries, feedState, listAllowlist }
}

function normalizeDefaultQuotaExemptions(raw) {
    if (!raw || typeof raw !== 'object' || !raw.quotaExemptions) return undefined
    const q = raw.quotaExemptions
    if (typeof q !== 'object' || q === null || Array.isArray(q)) return undefined

    const allowedIds = Array.isArray(q.allowedIds) ? q.allowedIds.filter(id => typeof id === 'string') : []
    const enabled = typeof q.enabled === 'boolean' ? q.enabled : allowedIds.length > 0
    return { enabled, allowedIds }
}

function persistQuotaExemptions(configDir, quotaExemptions) {
    const enabled = quotaExemptions?.enabled === true
    const allowedIds = enabled && Array.isArray(quotaExemptions?.allowedIds)
        ? quotaExemptions.allowedIds.filter(id => typeof id === 'string')
        : []
    patchDefaultJson(configDir, (d) => {
        d.quotaExemptions = { enabled, allowedIds }
        return d
    })
}

function mergeCategoriesIntoMirror(mirror, categoryNames) {
    const entries = [...mirror.entries]
    const feedState = { ...mirror.feedState }
    const existing = new Set(entries.map(e => e.domain))
    for (const name of categoryNames) {
        const feedId = CATEGORY_TO_HAGEZI_FEED[name]
        if (feedId) {
            feedState[feedId] = true
        } else {
            for (const d of WEB_FILTER_STATIC_CATEGORIES[name] || []) {
                if (!existing.has(d)) {
                    entries.push({ domain: d, enabled: true })
                    existing.add(d)
                }
            }
        }
    }
    return { entries, feedState }
}

function stripCategoriesFromMirror(mirror, categoryNames) {
    let entries = [...mirror.entries]
    const feedState = { ...mirror.feedState }
    const stripDomains = new Set()
    for (const name of categoryNames) {
        const feedId = CATEGORY_TO_HAGEZI_FEED[name]
        if (feedId) {
            feedState[feedId] = false
        } else {
            for (const d of WEB_FILTER_STATIC_CATEGORIES[name] || []) stripDomains.add(d)
        }
    }
    entries = entries.filter(e => !stripDomains.has(e.domain))
    return { entries, feedState }
}

/** Merge `default.json` into live enforcement (schedule, webfilter mirror, blocked apps, quotas) — used at app startup. */
export async function applyDefaultMergedState(configDir, { background = false } = {}) {
    const mode = readDefaultMode(configDir)
    const errs = []
    try {
        persistSchedule(configDir, mode.schedule)
    } catch (e) {
        errs.push(`schedule: ${e.message}`)
    }

    console.info('[LiFE Parental Control] applying default merged state from default.json', {
        scheduleEnabled: Boolean(mode.schedule?.enabled),
        dailyLimitEnabled: Boolean(mode.schedule?.dailyLimitEnabled)
    })
    try {
        if (mode.webfilterMirror?.entries) {
            const { entries, feedState, listAllowlist } = mode.webfilterMirror
            await persistWebFilterEntries(configDir, entries, feedState, listAllowlist, { background })
            console.info('[LiFE Parental Control] default webfilter mirror applied', {
                entryCount: entries?.length ?? 0
            })
        } else if (mode.mergeCategories?.length) {
            const cur = readWebFilterConfig(configDir)
            const next = mergeCategoriesIntoMirror(cur, mode.mergeCategories)
            await persistWebFilterEntries(configDir, next.entries, next.feedState, undefined, { background })
        } else if (mode.stripCategories?.length) {
            const cur = readWebFilterConfig(configDir)
            const next = stripCategoriesFromMirror(cur, mode.stripCategories)
            await persistWebFilterEntries(configDir, next.entries, next.feedState, undefined, { background })
        } else {
            await persistWebFilterEntries(configDir, [], {}, [], { background })
            console.info('[LiFE Parental Control] default webfilter mirror cleared (empty default)')
        }
    } catch (e) {
        errs.push(`webfilter: ${e.message}`)
    }

    try {
        replaceBlockedDesktopIds(configDir, mode.blockedDesktopIds ?? [])
        console.info('[LiFE Parental Control] default blocked apps set', {
            blockedCount: (mode.blockedDesktopIds ?? []).length
        })
    } catch (e) {
        errs.push(`apps: ${e.message}`)
    }

    try {
        const q = mode.quotaExemptions ?? { enabled: false, allowedIds: [] }
        persistQuotaExemptions(configDir, q)
        console.info('[LiFE Parental Control] default quota exemptions written', {
            enabled: Boolean(q?.enabled),
            allowedIdsCount: Array.isArray(q?.allowedIds) ? q.allowedIds.length : 0
        })
    } catch (e) {
        errs.push(`quota_exemptions: ${e.message}`)
    }

    try {
        const quotaEntries = Array.isArray(mode.quota) ? mode.quota : []
        replaceQuotaEntries(configDir, quotaEntries)
    } catch (e) {
        errs.push(`quota_entries: ${e.message}`)
    }

    try {
        await redeployQuotaFromDisk(configDir)
    } catch (e) {
        errs.push(`quota_redeploy: ${e.message}`)
    }

    return errs.length ? { error: errs.join(' — ') } : { ok: true }
}
