// Writes/removes a root-owned .desktop under /etc/xdg/autostart so LiFE launches at graphical login.
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export const SYSTEM_AUTOSTART_PATH = '/etc/xdg/autostart/org.tuxfamily.life-parental-control.desktop'

const DESKTOP_MARKER = 'X-LiFE-Autostart=true'

function execKeyForAutostart() {
    const exe = process.env.APPIMAGE || process.execPath
    if (!exe || typeof exe !== 'string') throw new Error('Could not resolve application executable path.')
    if (!exe.includes(' ') && !exe.includes('\t')) return `${exe} --no-sandbox`
    return `"${exe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" --no-sandbox`
}

export function systemAutostartDesktopPresent() {
    try {
        if (!fs.existsSync(SYSTEM_AUTOSTART_PATH)) return false
        return fs.readFileSync(SYSTEM_AUTOSTART_PATH, 'utf8').includes(DESKTOP_MARKER)
    } catch {
        return false
    }
}

export function writeSystemAutostartDesktop() {
    if (!app.isPackaged) throw new Error('Autostart applies to the packaged app only (deb or AppImage).')
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        throw new Error('Writing system autostart requires administrator rights.')
    }
    const dir = path.dirname(SYSTEM_AUTOSTART_PATH)
    fs.mkdirSync(dir, { recursive: true })
    const exec = execKeyForAutostart()
    const body = [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        'Name=LiFE Parental Control',
        'GenericName=Parental controls',
        'Comment=Parental controls for KDE Plasma — screen time, web filter, app limits',
        `Exec=${exec}`,
        'Icon=life-parental-control',
        'StartupNotify=false',
        'Terminal=false',
        'Categories=Settings;System;',
        'X-GNOME-Autostart-enabled=true',
        DESKTOP_MARKER,
        ''
    ].join('\n')
    fs.writeFileSync(SYSTEM_AUTOSTART_PATH, body, { encoding: 'utf8', mode: 0o644 })
}

export function removeSystemAutostartDesktop() {
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        throw new Error('Removing system autostart requires administrator rights.')
    }
    try {
        if (!fs.existsSync(SYSTEM_AUTOSTART_PATH)) return
        const raw = fs.readFileSync(SYSTEM_AUTOSTART_PATH, 'utf8')
        if (!raw.includes(DESKTOP_MARKER)) return
        fs.unlinkSync(SYSTEM_AUTOSTART_PATH)
    } catch (e) {
        if (e.code !== 'ENOENT') throw e
    }
}
