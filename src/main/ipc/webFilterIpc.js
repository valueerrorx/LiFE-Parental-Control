import fs from 'fs'
import { daemonWriteHosts, daemonWriteDnsmasq, daemonRemoveDnsmasq, daemonGetDhcpDns } from '../daemonPrivilegedOps.js'
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
import { patchDefaultJson, readDefaultJson } from '../defaultProfileStore.js'

const HOSTS_FILE = '/etc/hosts'
const MARKER_BEGIN = '# LiFE Parental Control - BEGIN'
const MARKER_END = '# LiFE Parental Control - END'

// Bundled HaGeZi feed directory — set once by registerWebFilterIpc, used as fallback
// when /etc/life-parental/blocklists/ is empty (fresh install, AppImage without prior sync).
let _bundledDir = null

/** Past sinkhole IPs still parsed when reading the LiFE hosts block (re-apply migrates to current IP). */
const HOSTS_SINKHOLE_IPV4_RE = /^(?:192\.0\.2\.1|0\.0\.0\.0|127\.0\.0\.2)\s+(\S+)\s*$/

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

const VALID_DNS_MODES = ['dns4eu_protective', 'dns4eu_child', 'dns4eu_ads', 'dns4eu_child_ads', 'dhcp']

function readWebfilterFromConfig(configDir) {
    const wf = readDefaultJson(configDir)?.webfilter || {}
    return {
        enabled: wf.enabled !== false,
        entries: Array.isArray(wf.entries) ? wf.entries : [],
        feedState: (wf.feedState && typeof wf.feedState === 'object' && !Array.isArray(wf.feedState))
            ? { ...wf.feedState }
            : {},
        listAllowlist: Array.isArray(wf.listAllowlist) ? wf.listAllowlist : [],
        cachedHostRuleCount: typeof wf.cachedHostRuleCount === 'number' ? wf.cachedHostRuleCount : undefined,
        dnsMode: VALID_DNS_MODES.includes(wf.dnsMode) ? wf.dnsMode : 'dhcp',
        dhcpFallbackDns: typeof wf.dhcpFallbackDns === 'string' ? wf.dhcpFallbackDns : null
    }
}

function buildCombinedEntries(configDir, wf) {
    const blocked = new Set()
    for (const e of wf.entries) {
        if (e.enabled === false) continue
        blocked.add(String(e.domain).toLowerCase())
    }
    for (const d of domainsForEnabledFeeds(configDir, wf.feedState, _bundledDir)) {
        blocked.add(d)
    }
    const allow = new Set(normalizeAllowlist(wf.listAllowlist))
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
        .map((l) => {
            const disabled = l.startsWith('#')
            const rest = (disabled ? l.slice(1) : l).trim()
            const m = rest.match(HOSTS_SINKHOLE_IPV4_RE)
            if (!m) return null
            return { domain: m[1], enabled: !disabled }
        })
        .filter(Boolean)
}

async function writeHostsSectionAsync(entries) {
    // Delegate to daemon (root) — frontend no longer has write access to /etc/hosts.
    // Daemon also handles DNS cache flush after writing.
    const result = await daemonWriteHosts(entries)
    if (!result.ok) throw new Error(result.error || 'write-hosts failed')
}

async function persistWebfilterAndHosts(configDir, wf, { background = false } = {}) {
    const full = {
        enabled: wf.enabled !== false,
        entries: wf.entries,
        feedState: wf.feedState || {},
        listAllowlist: wf.listAllowlist ?? [],
        dnsMode: VALID_DNS_MODES.includes(wf.dnsMode) ? wf.dnsMode : 'dhcp',
        dhcpFallbackDns: typeof wf.dhcpFallbackDns === 'string' ? wf.dhcpFallbackDns : null
    }
    await new Promise((resolve) => globalThis.setImmediate(resolve))
    const combined = full.enabled ? buildCombinedEntries(configDir, full) : []
    patchDefaultJson(configDir, (d) => {
        d.webfilter = {
            enabled: full.enabled,
            entries: full.entries,
            feedState: full.feedState,
            listAllowlist: full.listAllowlist,
            cachedHostRuleCount: combined.length,
            dnsMode: full.dnsMode,
            ...(full.dhcpFallbackDns ? { dhcpFallbackDns: full.dhcpFallbackDns } : {})
        }
        return d
    })

    // background=true: fire-and-forget daemon calls (used during startup to avoid blocking UI)
    if (background) {
        writeHostsSectionAsync(combined).catch(e => console.warn('[LiFE webfilter] write-hosts (bg):', e.message))
        if (full.enabled && combined.length > 0) {
            daemonWriteDnsmasq(combined, full.dnsMode, full.dhcpFallbackDns).catch(e => console.warn('[LiFE webfilter] write-dnsmasq (bg):', e.message))
        } else {
            daemonRemoveDnsmasq().catch(e => console.warn('[LiFE webfilter] remove-dnsmasq (bg):', e.message))
        }
        return
    }

    await writeHostsSectionAsync(combined)
    // Also write dnsmasq config for subdomain filtering
    if (full.enabled && combined.length > 0) {
        const dnsResult = await daemonWriteDnsmasq(combined, full.dnsMode, full.dhcpFallbackDns)
        if (!dnsResult.ok) console.warn('[LiFE webfilter] write-dnsmasq failed:', dnsResult.error)
    } else {
        const dnsResult = await daemonRemoveDnsmasq()
        if (!dnsResult.ok) console.warn('[LiFE webfilter] remove-dnsmasq failed:', dnsResult.error)
    }
}

export function registerWebFilterIpc(ipcMain, configDir, bundledDir = null) {
    _bundledDir = bundledDir
    ipcMain.handle('webfilter:getList', () => {
        const wf = readWebfilterFromConfig(configDir)
        const feedsMeta = getFeedsMetaForUi(configDir)
        let source = 'hosts'
        let error = ''
        try {
            readHostsSection()
        } catch (e) {
            source = 'config'
            error = `Could not read ${HOSTS_FILE}: ${e.message}. Showing data from default.json (Apply may fail until permissions are fixed).`
        }
        // Use cached count from last persist — never call buildCombinedEntries here (multi-MB feeds block the main process for seconds).
        let hostRuleCount = wf.entries.filter(e => e.enabled !== false).length
        if (typeof wf.cachedHostRuleCount === 'number' && Number.isFinite(wf.cachedHostRuleCount)) {
            hostRuleCount = Math.max(0, Math.floor(wf.cachedHostRuleCount))
        }
        return {
            enabled: wf.enabled,
            entries: wf.entries,
            feedState: wf.feedState,
            listAllowlist: wf.listAllowlist,
            dnsMode: wf.dnsMode,
            categories: WEB_FILTER_QUICK_ADD_ORDER,
            staticCategories: WEB_FILTER_STATIC_CATEGORIES,
            feedsMeta,
            source,
            error,
            manualCount: wf.entries.filter(e => e.enabled !== false).length,
            feedEnabledCount: Object.values(wf.feedState).filter(Boolean).length,
            allowlistCount: wf.listAllowlist.length,
            hostRuleCount
        }
    })

    ipcMain.handle('webfilter:setList', async (_, entries) => {
        try {
            const wf = readWebfilterFromConfig(configDir)
            wf.entries = Array.isArray(entries)
                ? entries.filter(e => e && typeof e.domain === 'string').map(e => ({
                    domain: String(e.domain).toLowerCase(),
                    enabled: e.enabled !== false
                }))
                : []
            await persistWebfilterAndHosts(configDir, wf)
            appendActivity(configDir, { action: 'webfilter_list_set', count: wf.entries.filter(e => e.enabled !== false).length })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'webfilter_list_set_error', error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:setAllowlist', async (_, domains) => {
        try {
            const wf = readWebfilterFromConfig(configDir)
            wf.listAllowlist = normalizeAllowlist(Array.isArray(domains) ? domains : [])
            await persistWebfilterAndHosts(configDir, wf)
            appendActivity(configDir, { action: 'webfilter_allowlist_set', count: wf.listAllowlist.length })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'webfilter_allowlist_set_error', error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:setFeedEnabled', async (_, feedId, enabled) => {
        try {
            if (!HAGEZI_FEED_BY_ID.has(feedId)) return { error: 'Unknown feed' }
            const wf = readWebfilterFromConfig(configDir)
            wf.feedState = { ...wf.feedState, [feedId]: Boolean(enabled) }
            await persistWebfilterAndHosts(configDir, wf)
            appendActivity(configDir, { action: 'webfilter_feed_set', feedId, enabled: Boolean(enabled) })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'webfilter_feed_set_error', feedId, error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:addCategory', async (_, categoryName) => {
        try {
            if (!isKnownWebFilterCategory(categoryName)) return { error: 'Unknown category' }
            const wf = readWebfilterFromConfig(configDir)
            const feedId = CATEGORY_TO_HAGEZI_FEED[categoryName]
            if (feedId) {
                wf.feedState = { ...wf.feedState, [feedId]: true }
                await persistWebfilterAndHosts(configDir, wf)
                appendActivity(configDir, { action: 'webfilter_category_added', category: categoryName, feed: feedId })
                return { added: -1, feed: feedId }
            }
            const existing = new Set(wf.entries.map(e => e.domain))
            const toAdd = (WEB_FILTER_STATIC_CATEGORIES[categoryName] || []).filter(d => !existing.has(d))
            wf.entries = [...wf.entries, ...toAdd.map(d => ({ domain: d, enabled: true }))]
            await persistWebfilterAndHosts(configDir, wf)
            appendActivity(configDir, { action: 'webfilter_category_added', category: categoryName, added: toAdd.length })
            return { added: toAdd.length }
        } catch (e) {
            appendActivity(configDir, { action: 'webfilter_category_added_error', category: categoryName, error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:clearAll', async () => {
        try {
            const wf = readWebfilterFromConfig(configDir)
            await persistWebfilterAndHosts(configDir, { enabled: wf.enabled, entries: [], feedState: {}, listAllowlist: [] })
            appendActivity(configDir, { action: 'webfilter_cleared' })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'webfilter_cleared_error', error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:saveAll', async (_, data) => {
        try {
            if (!data || typeof data !== 'object') return { error: 'Invalid data' }
            const wf = readWebfilterFromConfig(configDir)
            wf.enabled = data.enabled !== false
            if (Array.isArray(data.entries)) {
                wf.entries = data.entries
                    .filter(e => e && typeof e.domain === 'string')
                    .map(e => ({ domain: String(e.domain).toLowerCase(), enabled: e.enabled !== false }))
            }
            if (data.feedState && typeof data.feedState === 'object' && !Array.isArray(data.feedState)) {
                wf.feedState = { ...data.feedState }
            }
            if (Array.isArray(data.listAllowlist)) {
                wf.listAllowlist = normalizeAllowlist(data.listAllowlist)
            }
            if (VALID_DNS_MODES.includes(data.dnsMode)) {
                wf.dnsMode = data.dnsMode
            }
            // Always refresh dhcpFallbackDns before persisting so write-dnsmasq
            // has a valid fallback even if the dispatcher hasn't run yet.
            const dhcpResult = await daemonGetDhcpDns()
            if (dhcpResult?.ok && dhcpResult.ip) wf.dhcpFallbackDns = dhcpResult.ip
            await persistWebfilterAndHosts(configDir, wf)
            appendActivity(configDir, { action: 'webfilter_saved', enabled: wf.enabled, manualCount: wf.entries.filter(e => e.enabled !== false).length, feedCount: Object.values(wf.feedState).filter(Boolean).length, allowlistCount: wf.listAllowlist.length })
            return { ok: true }
        } catch (e) {
            appendActivity(configDir, { action: 'webfilter_saved_error', error: e.message })
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:syncFeeds', async () => {
        try {
            const r = await syncHageziFeeds(configDir)
            try {
                const wf = readWebfilterFromConfig(configDir)
                await persistWebfilterAndHosts(configDir, wf)
            } catch {
                /* hosts may be unreadable */
            }
            appendActivity(configDir, { action: 'webfilter_feeds_synced', updated: r.updated?.length ?? 0, errors: r.errors?.length ?? 0 })
            return r
        } catch (e) {
            appendActivity(configDir, { action: 'webfilter_feeds_sync_error', error: e.message })
            return { error: e.message, updated: [], notModified: [], errors: [e.message] }
        }
    })

    ipcMain.handle('webfilter:getDhcpDns', async () => {
        return daemonGetDhcpDns()
    })

    ipcMain.handle('webfilter:reapplyMirror', async () => {
        try {
            await reapplyWebFilter(configDir)
            appendActivity(configDir, { action: 'webfilter_reapply_mirror' })
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })
}

export function runStartupHageziSync(configDir) {
    return syncHageziFeeds(configDir)
        .then(async () => {
            try {
                const wf = readWebfilterFromConfig(configDir)
                await persistWebfilterAndHosts(configDir, wf)
            } catch {
                /* non-fatal */
            }
        })
        .catch(() => {
            /* offline: keep bundled/cache */
        })
}

export async function persistWebFilterEntries(configDir, entries, feedState = undefined, listAllowlist = undefined, { background = false, enabled: enabledOverride } = {}) {
    const wf = readWebfilterFromConfig(configDir)
    if (enabledOverride !== undefined) wf.enabled = enabledOverride !== false
    wf.entries = Array.isArray(entries)
        ? entries.filter(e => e && typeof e.domain === 'string').map(e => ({
            domain: String(e.domain).toLowerCase(),
            enabled: e.enabled !== false
        }))
        : []
    if (feedState !== undefined && feedState !== null && typeof feedState === 'object') {
        wf.feedState = { ...feedState }
    }
    if (listAllowlist !== undefined) {
        wf.listAllowlist = normalizeAllowlist(listAllowlist)
    }
    await persistWebfilterAndHosts(configDir, wf, { background })
}

export async function reapplyWebFilter(configDir) {
    const wf = readWebfilterFromConfig(configDir)
    await persistWebfilterAndHosts(configDir, wf)
}

export function readWebFilterConfig(configDir) {
    const wf = readWebfilterFromConfig(configDir)
    return { entries: wf.entries, feedState: wf.feedState, listAllowlist: wf.listAllowlist }
}
