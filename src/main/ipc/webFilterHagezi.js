import fs from 'fs'
import path from 'path'

// HaGeZi DNS blocklists — DNSMasq format: https://github.com/hagezi/dns-blocklists (GPL-3.0)

export const HAGEZI_REPO = 'https://github.com/hagezi/dns-blocklists'

export const HAGEZI_CDN_DNSMASQ_BASE = 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/dnsmasq/'

export const HAGEZI_FEEDS = [
    { id: 'social', file: 'social.txt' },
    { id: 'nsfw', file: 'nsfw.txt' },
    { id: 'fake', file: 'fake.txt' },
    { id: 'gambling', file: 'gambling.txt' },
    { id: 'anti_piracy', file: 'anti.piracy.txt' },
    { id: 'popupads', file: 'popupads.txt' }
]

/** @type {Map<string, { id: string, file: string }>} */
export const HAGEZI_FEED_BY_ID = new Map(HAGEZI_FEEDS.map(f => [f.id, f]))

const ALLOWED_FETCH_PREFIX = 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@'

const MAX_FETCH_BYTES = 32 * 1024 * 1024

export function parseDnsmasqDomains(text) {
    const domains = []
    if (typeof text !== 'string') return domains
    for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const m = t.match(/^local=\/(.+)\/$/)
        if (m) domains.push(String(m[1]).toLowerCase())
    }
    return domains
}

export function extractListVersion(text) {
    const m = typeof text === 'string' && text.match(/^#\s*Version:\s*(.+)$/m)
    return m ? m[1].trim() : null
}

export function feedUrl(feed) {
    return `${HAGEZI_CDN_DNSMASQ_BASE}${feed.file}`
}

function assertAllowedUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(ALLOWED_FETCH_PREFIX)) {
        throw new Error('web filter: blocked feed URL')
    }
}

function readJsonSafe(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
        return null
    }
}

function readFeedMeta(configDir) {
    const p = path.join(configDir, 'blocklists', 'meta.json')
    const j = readJsonSafe(p)
    return j && typeof j === 'object' && !Array.isArray(j) ? j : { feeds: {} }
}

function writeFeedMeta(configDir, meta) {
    const dir = path.join(configDir, 'blocklists')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
}

/**
 * @param {string} bundledDir
 * @param {string} configDir
 * @returns {Promise<{ updated: string[], errors: string[], notModified: string[] }>}
 */
export async function syncHageziFeeds(bundledDir, configDir) {
    const updated = []
    const notModified = []
    const errors = []
    const meta = readFeedMeta(configDir)
    if (!meta.feeds || typeof meta.feeds !== 'object') meta.feeds = {}

    for (const feed of HAGEZI_FEEDS) {
        const url = feedUrl(feed)
        try {
            assertAllowedUrl(url)
            const prev = meta.feeds[feed.id] && typeof meta.feeds[feed.id] === 'object' ? meta.feeds[feed.id] : {}
            const prevEtag = typeof prev.etag === 'string' ? prev.etag : undefined
            const headers = { 'User-Agent': 'life-parental-control/webfilter' }
            if (prevEtag) headers['If-None-Match'] = prevEtag

            const ac = new AbortController()
            const t = setTimeout(() => ac.abort(), 120_000)
            const res = await fetch(url, { headers, signal: ac.signal })
            clearTimeout(t)

            if (res.status === 304) {
                notModified.push(feed.id)
                continue
            }
            if (!res.ok) {
                errors.push(`${feed.id}: HTTP ${res.status}`)
                continue
            }
            const etag = res.headers.get('etag') || undefined
            const buf = await res.arrayBuffer()
            if (buf.byteLength > MAX_FETCH_BYTES) {
                errors.push(`${feed.id}: response too large`)
                continue
            }
            const text = new TextDecoder('utf8', { fatal: false }).decode(buf)
            const ver = extractListVersion(text)
            if (!ver || !text.includes('HaGeZi')) {
                errors.push(`${feed.id}: unexpected body`)
                continue
            }
            const dir = path.join(configDir, 'blocklists')
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, feed.file), text, 'utf8')
            meta.feeds[feed.id] = {
                etag: etag || null,
                version: ver,
                cachedAt: new Date().toISOString(),
                url
            }
            updated.push(feed.id)
        } catch (e) {
            const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e))
            errors.push(`${feed.id}: ${msg}`)
        }
    }
    writeFeedMeta(configDir, meta)
    return { updated, notModified, errors }
}

// Version metadata lives in the file header — avoid reading multi‑MB lists into memory for UI metadata only.
const VERSION_HEAD_BYTES = 65536

export function readBundledFeedVersion(bundledDir, feed) {
    try {
        const p = path.join(bundledDir, feed.file)
        const fd = fs.openSync(p, 'r')
        try {
            const buf = Buffer.alloc(VERSION_HEAD_BYTES)
            const n = fs.readSync(fd, buf, 0, VERSION_HEAD_BYTES, 0)
            return extractListVersion(buf.subarray(0, n).toString('utf8'))
        } finally {
            fs.closeSync(fd)
        }
    } catch {
        return null
    }
}

export function getFeedsMetaForUi(configDir, bundledDir) {
    const diskMeta = readFeedMeta(configDir)
    const feeds = {}
    for (const feed of HAGEZI_FEEDS) {
        const m = diskMeta.feeds?.[feed.id]
        feeds[feed.id] = {
            version: m?.version ?? readBundledFeedVersion(bundledDir, feed),
            source: m?.version ? 'cache' : 'bundled',
            cachedAt: m?.cachedAt ?? null
        }
    }
    return feeds
}

export function loadFeedFileText(bundledDir, configDir, feedId) {
    const feed = HAGEZI_FEED_BY_ID.get(feedId)
    if (!feed) return null
    const cached = path.join(configDir, 'blocklists', feed.file)
    try {
        return fs.readFileSync(cached, 'utf8')
    } catch {
        try {
            return fs.readFileSync(path.join(bundledDir, feed.file), 'utf8')
        } catch {
            return null
        }
    }
}

export function domainsForEnabledFeeds(bundledDir, configDir, feedState) {
    const set = new Set()
    if (!feedState || typeof feedState !== 'object') return set
    for (const [id, on] of Object.entries(feedState)) {
        if (!on) continue
        const text = loadFeedFileText(bundledDir, configDir, id)
        if (!text) continue
        for (const d of parseDnsmasqDomains(text)) set.add(d)
    }
    return set
}
