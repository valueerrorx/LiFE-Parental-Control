#!/usr/bin/env node
/**
 * Read-only: lists catalog / blocked / quota entries whose process-name candidates contain "java".
 * Only these entries change behaviour through the java skip in quota pkill/match and the block poller.
 * Usage: node scripts/list-java-candidate-entries.mjs [configDir]   (default /etc/life-parental)
 */
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configDir = process.argv[2] || '/etc/life-parental'

// Reuse the daemon's own candidate logic (daemon is not importable: it starts a socket server).
const daemonSrc = fs.readFileSync(path.join(__dirname, '../daemon/parental-control-daemon.js'), 'utf8')
function extractFunction(name) {
    const start = daemonSrc.indexOf(`function ${name}(`)
    if (start < 0) throw new Error(`function ${name} not found in daemon`)
    const end = daemonSrc.indexOf('\n}\n', start)
    return daemonSrc.slice(start, end + 3)
}
const ctx = { path, TASK_COMM_MAX: 15, Set, Array, String }
vm.createContext(ctx)
vm.runInContext(['desktopIdStem', 'desktopIdTailStem', 'processNameCandidatesForAppEntry'].map(extractFunction).join('\n'), ctx)
const candidatesFor = (proc, appId, aliases) => ctx.processNameCandidatesForAppEntry(proc, appId, aliases)

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'))
    } catch (e) {
        console.log(`(${file}: ${e.code === 'ENOENT' ? 'not found' : e.code === 'EACCES' ? 'no read permission' : 'unreadable'})`)
        return null
    }
}

const catalog = readJson('app-monitor-catalog.json')
const def = readJson('default.json')
const catApps = Array.isArray(catalog?.apps) ? catalog.apps : []
const byId = new Map(catApps.map((a) => [String(a.appId || '').trim().toLowerCase(), a]))
let hits = 0

function report(kind, appId, appName, cands, note = '') {
    if (!cands.includes('java')) return
    hits++
    console.log(`${kind}\t${appId}\t${appName || '-'}\t[${cands.join(', ')}]${note ? `\t${note}` : ''}`)
}

for (const a of catApps) {
    report('catalog', a.appId, a.appName, candidatesFor(a.processName, a.appId, a.commAliases), 'monitor already skips java')
}
for (const raw of Array.isArray(def?.blockedDesktopIds) ? def.blockedDesktopIds : []) {
    if (!raw || typeof raw !== 'object') continue
    const cat = byId.get(String(raw.appId || '').trim().toLowerCase())
    const proc = String(cat?.processName || raw.processName || '').trim()
    const hasExecPath = !!String(cat?.exec || '').trim()
    report('blocked', raw.appId, raw.appName, candidatesFor(proc, raw.appId, cat?.commAliases),
        hasExecPath ? 'poller: exe filter applies' : 'poller: java comm now skipped')
}
for (const q of Array.isArray(def?.quota) ? def.quota : []) {
    if (!q || typeof q !== 'object') continue
    const cat = byId.get(String(q.appId || '').trim().toLowerCase())
    const cands = Array.from(new Set([
        ...candidatesFor(q.processName, q.appId, cat?.commAliases),
        ...candidatesFor(cat?.processName, q.appId, cat?.commAliases)
    ]))
    report('quota', q.appId, q.appName, cands, 'pgrep/pkill -x java now skipped')
}
console.log(`list-java-candidate-entries: ${hits} entr${hits === 1 ? 'y' : 'ies'} with "java" candidate (catalog ${catApps.length}, config ${configDir})`)
