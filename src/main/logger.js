import fs from 'fs'
import path from 'path'

const LOG_PATH = '/var/log/life-parental/app.log'
const LOG_FALLBACK = '/tmp/life-parental-debug.log'

let logPath = null
let logStream = null

function openStream(p) {
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true })
        logStream = fs.createWriteStream(p, { flags: 'a' })
        logPath = p
        return true
    } catch {
        return false
    }
}

function writeLine(level, parts) {
    const msg = parts.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`
    if (logStream) {
        try { logStream.write(line) } catch { /* ignore */ }
    }
    // Keep original console output
    if (level === 'ERROR') process.stderr.write(line)
    else process.stdout.write(line)
}

export function initLogger() {
    if (!openStream(LOG_PATH)) openStream(LOG_FALLBACK)
    if (logPath) writeLine('INFO', [`Log file: ${logPath}`])
}

export function log(...args)   { writeLine('INFO',  args) }
export function warn(...args)  { writeLine('WARN',  args) }
export function error(...args) { writeLine('ERROR', args) }

/** Forward BrowserWindow renderer console messages into the log file. */
export function attachRendererLogging(webContents) {
    webContents.on('console-message', (_e, level, message, line, sourceId) => {
        const lvl = level === 3 ? 'ERROR' : level === 2 ? 'WARN' : 'INFO'
        const src = sourceId ? ` (${path.basename(sourceId)}:${line})` : ''
        writeLine(`RENDERER-${lvl}`, [`${message}${src}`])
    })
    webContents.on('render-process-gone', (_e, details) => {
        writeLine('ERROR', [`Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`])
    })
    webContents.on('did-fail-load', (_e, code, desc, url) => {
        writeLine('ERROR', [`did-fail-load: ${code} ${desc} url=${url}`])
    })
    webContents.on('did-finish-load', () => {
        writeLine('INFO', ['Renderer did-finish-load'])
    })
    webContents.on('crashed', () => {
        writeLine('ERROR', ['Renderer crashed'])
    })
}
