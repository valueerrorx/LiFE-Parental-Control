import fs from 'fs'
import { readFile as readFileAsync, writeFile as writeFileAsync } from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import {
    WEB_FILTER_STATIC_CATEGORIES,
    CATEGORY_TO_HAGEZI_FEED,
    WEB_FILTER_QUICK_ADD_ORDER,
    isKnownWebFilterCategory
} from './webFilterCategories.js'
import {
    syncHageziFeeds,
    getFeedsMetaForUi,
    domainsForEnabledFeeds,
    HAGEZI_FEED_BY_ID
} from './webFilterHagezi.js'
import { appendActivity } from './activityLog.js'

const HOSTS_FILE = '/etc/hosts'
const MARKER_BEGIN = '# LiFE Parental Control - BEGIN'
const MARKER_END = '# LiFE Parental Control - END'
const CONFIG_FILE = 'webfilter.json'

/** @type {string|null} */
let hageziBundledDir = null

function setBundledDir(dir) {
    hageziBundledDir = typeof dir === 'string' ? dir : null
}

function requireBundledDir() {
    if (!hageziBundledDir) throw new Error('web filter: missing hagezi bundle path')
    return hageziBundledDir
}

function normalizeAllowlist(raw) {
    if (!Array.isArray(raw)) return []
    const out = new Set()
    for (const x of raw) {
        if (typeof x !== 'string') continue
        const d = x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split('/')[0]
        if (d) out.add(d)
    }
    return [...out].sort()
}

function readMirrorRaw(configDir) {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(configDir, CONFIG_FILE), 'utf8'))
        if (Array.isArray(parsed)) {
            return { entries: parsed, feedState: {}, listAllowlist: [] }
        }
        const entries = Array.isArray(parsed.entries)
            ? parsed.entries
                .filter(e => e && typeof e.domain === 'string')
                .map(e => ({ domain: String(e.domain).toLowerCase(), enabled: e.enabled !== false }))
            : []
        let feedState = {}
        if (parsed.feedState && typeof parsed.feedState === 'object' && !Array.isArray(parsed.feedState)) {
            feedState = { ...parsed.feedState }
        }
        const listAllowlist = normalizeAllowlist(parsed.listAllowlist)
        return { entries, feedState, listAllowlist }
    } catch {
        return { entries: [], feedState: {}, listAllowlist: [] }
    }
}

export function readWebFilterMirror(configDir) {
    return readMirrorRaw(configDir)
}

function writeMirrorToDisk(configDir, mirror) {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
        path.join(configDir, CONFIG_FILE),
        JSON.stringify({
            entries: mirror.entries,
            feedState: mirror.feedState,
            listAllowlist: normalizeAllowlist(mirror.listAllowlist),
            updatedAt: new Date().toISOString()
        }, null, 2),
        'utf8'
    )
}

function buildCombinedEntries(configDir, mirror) {
    const bd = requireBundledDir()
    const blocked = new Set()
    for (const e of mirror.entries) {
        if (e.enabled === false) continue
        blocked.add(String(e.domain).toLowerCase())
    }
    for (const d of domainsForEnabledFeeds(bd, configDir, mirror.feedState)) {
        blocked.add(d)
    }
    const allow = new Set(normalizeAllowlist(mirror.listAllowlist))
    for (const a of allow) blocked.delete(a)
    return [...blocked].sort().map(domain => ({ domain, enabled: true }))
}

function readHostsSection() {
    const content = fs.readFileSync(HOSTS_FILE, 'utf8')
    const begin = content.indexOf(MARKER_BEGIN)
    const end = content.indexOf(MARKER_END)
    if (begin === -1 || end === -1) return []
    const section = content.slice(begin + MARKER_BEGIN.length, end)
    return section.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('0.0.0.0 ') || l.startsWith('#0.0.0.0 '))
        .map(l => {
            const disabled = l.startsWith('#')
            const domain = (disabled ? l.slice(1) : l).replace('0.0.0.0 ', '').trim()
            return { domain, enabled: !disabled }
        })
}

async function writeHostsSectionAsync(entries) {
    const content = await readFileAsync(HOSTS_FILE, 'utf8')
    const lines = entries.map(e => `${e.enabled ? '' : '#'}0.0.0.0 ${e.domain}`)
    const section = `\n${lines.join('\n')}\n`
    const begin = content.indexOf(MARKER_BEGIN)
    const end = content.indexOf(MARKER_END)

    let newContent
    if (begin !== -1 && end !== -1) {
        newContent = content.slice(0, begin) + MARKER_BEGIN + section + MARKER_END + content.slice(end + MARKER_END.length)
    } else {
        newContent = content.trimEnd() + `\n\n${MARKER_BEGIN}${section}${MARKER_END}\n`
    }
    await writeFileAsync(HOSTS_FILE, newContent, 'utf8')
}

function flushDns() {
    execFile('systemd-resolve', ['--flush-caches'], { timeout: 3000 }, () => {})
    execFile('resolvectl', ['flush-caches'], { timeout: 3000 }, () => {})
    execFile('dnsmasq', ['--clear-on-reload'], { timeout: 3000 }, () => {})
}

async function persistMirrorAndHosts(configDir, mirror) {
    const full = {
        entries: mirror.entries,
        feedState: mirror.feedState || {},
        listAllowlist: mirror.listAllowlist ?? []
    }
    writeMirrorToDisk(configDir, full)
    await new Promise((resolve) => globalThis.setImmediate(resolve))
    const combined = buildCombinedEntries(configDir, full)
    await writeHostsSectionAsync(combined)
    flushDns()
}

export function registerWebFilterIpc(ipcMain, configDir, opts = {}) {
    setBundledDir(opts.hageziBundledDir ?? null)

    ipcMain.handle('webfilter:getList', () => {
        const mirror = readMirrorRaw(configDir)
        const bd = hageziBundledDir
        const feedsMeta = bd ? getFeedsMetaForUi(configDir, bd) : {}
        let source = 'hosts'
        let error = ''
        try {
            readHostsSection()
        } catch (e) {
            source = 'mirror'
            error = `Could not read ${HOSTS_FILE}: ${e.message}. Showing data from ${CONFIG_FILE} (Apply may fail until permissions are fixed).`
        }
        let hostRuleCount = mirror.entries.filter(e => e.enabled !== false).length
        if (hageziBundledDir) {
            try {
                hostRuleCount = buildCombinedEntries(configDir, mirror).length
            } catch {
                /* ignore */
            }
        }
        return {
            entries: mirror.entries,
            feedState: mirror.feedState,
            listAllowlist: mirror.listAllowlist,
            categories: WEB_FILTER_QUICK_ADD_ORDER,
            feedsMeta,
            source,
            error,
            manualCount: mirror.entries.filter(e => e.enabled !== false).length,
            feedEnabledCount: Object.values(mirror.feedState).filter(Boolean).length,
            allowlistCount: mirror.listAllowlist.length,
            hostRuleCount
        }
    })

    ipcMain.handle('webfilter:setList', async (_, entries) => {
        try {
            const mirror = readMirrorRaw(configDir)
            mirror.entries = Array.isArray(entries)
                ? entries.filter(e => e && typeof e.domain === 'string').map(e => ({
                    domain: String(e.domain).toLowerCase(),
                    enabled: e.enabled !== false
                }))
                : []
            await persistMirrorAndHosts(configDir, mirror)
            return { ok: true }
        } catch (e) {
            try {
                const mirror = readMirrorRaw(configDir)
                mirror.entries = Array.isArray(entries) ? entries : []
                writeMirrorToDisk(configDir, mirror)
            } catch {
                /* ignore */
            }
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:setAllowlist', async (_, domains) => {
        try {
            const mirror = readMirrorRaw(configDir)
            mirror.listAllowlist = normalizeAllowlist(Array.isArray(domains) ? domains : [])
            await persistMirrorAndHosts(configDir, mirror)
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:setFeedEnabled', async (_, feedId, enabled) => {
        try {
            if (!HAGEZI_FEED_BY_ID.has(feedId)) return { error: 'Unknown feed' }
            const mirror = readMirrorRaw(configDir)
            mirror.feedState = { ...mirror.feedState, [feedId]: Boolean(enabled) }
            await persistMirrorAndHosts(configDir, mirror)
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:addCategory', async (_, categoryName) => {
        try {
            if (!isKnownWebFilterCategory(categoryName)) return { error: 'Unknown category' }
            const mirror = readMirrorRaw(configDir)
            const feedId = CATEGORY_TO_HAGEZI_FEED[categoryName]
            if (feedId) {
                mirror.feedState = { ...mirror.feedState, [feedId]: true }
                await persistMirrorAndHosts(configDir, mirror)
                return { added: -1, feed: feedId }
            }
            const existing = new Set(mirror.entries.map(e => e.domain))
            const toAdd = (WEB_FILTER_STATIC_CATEGORIES[categoryName] || []).filter(d => !existing.has(d))
            mirror.entries = [...mirror.entries, ...toAdd.map(d => ({ domain: d, enabled: true }))]
            await persistMirrorAndHosts(configDir, mirror)
            return { added: toAdd.length }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:clearAll', async () => {
        try {
            await persistMirrorAndHosts(configDir, { entries: [], feedState: {}, listAllowlist: [] })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:syncFeeds', async () => {
        try {
            const bd = requireBundledDir()
            const r = await syncHageziFeeds(bd, configDir)
            try {
                const mirror = readMirrorRaw(configDir)
                await persistMirrorAndHosts(configDir, mirror)
            } catch {
                /* hosts may be unreadable */
            }
            return r
        } catch (e) {
            return { error: e.message, updated: [], notModified: [], errors: [e.message] }
        }
    })

    ipcMain.handle('webfilter:reapplyMirror', async () => {
        try {
            await reapplyWebFilterFromMirror(configDir)
            appendActivity(configDir, { action: 'webfilter_reapply_mirror' })
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })
}

export function runStartupHageziSync(configDir) {
    if (!hageziBundledDir) return Promise.resolve()
    return syncHageziFeeds(hageziBundledDir, configDir)
        .then(async () => {
            try {
                const mirror = readMirrorRaw(configDir)
                await persistMirrorAndHosts(configDir, mirror)
            } catch {
                /* non-fatal */
            }
        })
        .catch(() => {
            /* offline: keep bundled/cache */
        })
}

/** @deprecated name — use readWebFilterMirror */
export function readWebFilterEntries(configDir) {
    return readMirrorRaw(configDir).entries
}

export async function persistWebFilterEntries(configDir, entries, feedState = undefined, listAllowlist = undefined) {
    const mirror = readMirrorRaw(configDir)
    mirror.entries = Array.isArray(entries)
        ? entries.filter(e => e && typeof e.domain === 'string').map(e => ({
            domain: String(e.domain).toLowerCase(),
            enabled: e.enabled !== false
        }))
        : []
    if (feedState !== undefined && feedState !== null && typeof feedState === 'object') {
        mirror.feedState = { ...feedState }
    }
    if (listAllowlist !== undefined) {
        mirror.listAllowlist = normalizeAllowlist(listAllowlist)
    }
    await persistMirrorAndHosts(configDir, mirror)
}

export async function reapplyWebFilterFromMirror(configDir) {
    const mirror = readMirrorRaw(configDir)
    await persistMirrorAndHosts(configDir, mirror)
}
