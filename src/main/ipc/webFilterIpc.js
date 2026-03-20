import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { WEB_FILTER_CATEGORIES } from './webFilterCategories.js'

const HOSTS_FILE = '/etc/hosts'
const MARKER_BEGIN = '# LiFE Parental Control - BEGIN'
const MARKER_END = '# LiFE Parental Control - END'
const CONFIG_FILE = 'webfilter.json'

function readMirror(configDir) {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(configDir, CONFIG_FILE), 'utf8'))
        const raw = parsed.entries ?? parsed
        if (!Array.isArray(raw)) return []
        return raw
            .filter(e => e && typeof e.domain === 'string')
            .map(e => ({ domain: e.domain, enabled: e.enabled !== false }))
    } catch {
        return []
    }
}

function writeMirror(configDir, entries) {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
        path.join(configDir, CONFIG_FILE),
        JSON.stringify({ entries, updatedAt: new Date().toISOString() }, null, 2),
        'utf8'
    )
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

function writeHostsSection(entries) {
    const content = fs.readFileSync(HOSTS_FILE, 'utf8')
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
    fs.writeFileSync(HOSTS_FILE, newContent, 'utf8')
}

function flushDns() {
    // Try multiple DNS flush methods for different systemd/resolv setups
    execFile('systemd-resolve', ['--flush-caches'], { timeout: 3000 }, () => {})
    execFile('resolvectl', ['flush-caches'], { timeout: 3000 }, () => {})
    execFile('dnsmasq', ['--clear-on-reload'], { timeout: 3000 }, () => {})
}

export function registerWebFilterIpc(ipcMain, configDir) {
    ipcMain.handle('webfilter:getList', () => {
        try {
            const entries = readHostsSection()
            return { entries, categories: Object.keys(WEB_FILTER_CATEGORIES), source: 'hosts' }
        } catch (e) {
            const entries = readMirror(configDir)
            return {
                entries,
                categories: Object.keys(WEB_FILTER_CATEGORIES),
                source: 'mirror',
                error: `Could not read ${HOSTS_FILE}: ${e.message}. Showing backup list from ${CONFIG_FILE} (blocks may be inactive).`
            }
        }
    })

    ipcMain.handle('webfilter:setList', (_, entries) => {
        try {
            writeHostsSection(entries)
            writeMirror(configDir, entries)
            flushDns()
        } catch (e) {
            try {
                writeMirror(configDir, entries)
            } catch {
                /* mirror is best-effort when hosts fails */
            }
            return { error: e.message }
        }
    })

    ipcMain.handle('webfilter:addCategory', (_, categoryName) => {
        try {
            let current
            try {
                current = readHostsSection()
            } catch {
                current = readMirror(configDir)
            }
            const existing = new Set(current.map(e => e.domain))
            const toAdd = (WEB_FILTER_CATEGORIES[categoryName] || []).filter(d => !existing.has(d))
            const entries = [...current, ...toAdd.map(d => ({ domain: d, enabled: true }))]
            writeHostsSection(entries)
            writeMirror(configDir, entries)
            flushDns()
            return { added: toAdd.length }
        } catch (e) {
            return { error: e.message }
        }
    })
}

export function readWebFilterEntries(configDir) {
    try {
        return readHostsSection()
    } catch {
        return readMirror(configDir)
    }
}

export function persistWebFilterEntries(configDir, entries) {
    writeHostsSection(entries)
    writeMirror(configDir, entries)
    flushDns()
}
