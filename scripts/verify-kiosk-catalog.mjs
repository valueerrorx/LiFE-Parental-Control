#!/usr/bin/env node
/**
 * Validates bundled .kiosk catalogs: action key shape and (optional) KCM ids vs kcmshell6 --list.
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const kioskDir = path.join(__dirname, '../kiosk')

const GENERIC_ACTION_KEYS = new Set([
    'shell_access', 'logout', 'lock_screen', 'run_command', 'run_desktop_files',
    'lineedit_text_completion', 'movable_toolbars', 'ghns'
])

function parseKioskIni(content) {
    const sections = {}
    let current = null
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim()
        if (!line || line[0] === ';' || line[0] === '#') continue
        if (line[0] === '[' && line.at(-1) === ']') {
            current = line.slice(1, -1).trim()
            sections[current] = {}
        } else if (current) {
            const eq = line.indexOf('=')
            if (eq > 0) sections[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
        }
    }
    return sections
}

function isValidActionKey(key) {
    if (key.startsWith('action/')) return true
    if (key.startsWith('plasma/') || key.startsWith('plasma-desktop/')) return true
    if (GENERIC_ACTION_KEYS.has(key)) return true
    return false
}

const KNOWN_RESOURCE_KEYS = new Set([
    'all', 'autostart', 'data', 'cache', 'services',
    'print/copies', 'print/dialog', 'print/options', 'print/properties', 'print/selection', 'print/system'
])

function isValidResourceKey(key) {
    if (KNOWN_RESOURCE_KEYS.has(key)) return true
    if (key.startsWith('print/') && /^print\/[a-z0-9_-]+$/.test(key)) return true
    return false
}

function loadKcmIds() {
    try {
        const out = execFileSync('kcmshell6', ['--list'], { encoding: 'utf8', timeout: 8000 })
        const ids = new Set()
        for (const line of out.split('\n')) {
            const m = line.match(/^\s*(kcm_[a-zA-Z0-9_-]+)\s+-/)
            if (m) ids.add(m[1])
        }
        return ids
    } catch {
        return null
    }
}

let errors = 0
const kcmIds = loadKcmIds()

for (const filename of fs.readdirSync(kioskDir).filter(f => f.endsWith('.kiosk')).sort()) {
    const parsed = parseKioskIni(fs.readFileSync(path.join(kioskDir, filename), 'utf8'))
    for (const [secName, sec] of Object.entries(parsed)) {
        if (secName === 'Group' || !sec.Type) continue
        if (sec.Type !== 'actionrestriction' && sec.Type !== 'module' && sec.Type !== 'resource' && sec.Type !== 'plasmaLayoutLock') continue
        const k = sec.Key
        if (!k) {
            console.error(`${filename} [${secName}]: missing Key`)
            errors++
            continue
        }
        if (sec.Type === 'actionrestriction' && !isValidActionKey(k)) {
            console.error(`${filename} [${secName}]: unexpected action Key=${k}`)
            errors++
        }
        if (sec.Type === 'module') {
            if (!/^kcm_[a-zA-Z0-9_-]+$/.test(k)) {
                console.error(`${filename} [${secName}]: module Key must be a kcm_* id, got ${k}`)
                errors++
            } else if (kcmIds && !kcmIds.has(k)) {
                console.error(`${filename} [${secName}]: KCM ${k} not in kcmshell6 --list on this system`)
                errors++
            }
        }
        if (sec.Type === 'resource' && !isValidResourceKey(k)) {
            console.error(`${filename} [${secName}]: unexpected resource Key=${k}`)
            errors++
        }
        if (sec.Type === 'plasmaLayoutLock' && k !== 'hard_lock') {
            console.error(`${filename} [${secName}]: plasmaLayoutLock Key must be hard_lock, got ${k}`)
            errors++
        }
    }
}

if (errors) {
    console.error(`verify-kiosk-catalog: ${errors} error(s)`)
    process.exit(1)
}
console.log('verify-kiosk-catalog: ok' + (kcmIds ? ` (${kcmIds.size} KCMs from kcmshell6)` : ' (kcmshell6 skipped)'))
