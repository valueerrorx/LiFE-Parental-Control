// Minimal Electron main as desktop user: StatusNotifier talks to the real session D-Bus from here.
import { app, Tray, Menu } from 'electron'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { trayDebugLog } from './trayDebugLog.js'
import { createTrayNativeImageFromPath } from './trayIcon.js'

// Must be before ready; keep tray on module scope so V8 cannot GC the Tray (Electron removes icon if collected).
app.setName('LiFE Parental Control')
if (process.platform === 'linux') {
    // x11 uses XWayland when DISPLAY is set; auto/wayland often breaks StatusNotifier on Plasma with Electron tray.
    app.commandLine.appendSwitch('ozone-platform-hint', 'x11')
}
Menu.setApplicationMenu(null)

let tray = null

const iconPath = process.env.LIFE_TRAY_ICON_PATH
const port = Number(process.env.LIFE_TRAY_PORT)
const token = process.env.LIFE_TRAY_TOKEN || ''

trayDebugLog('helperChild', 'boot', {
    uid: process.getuid(),
    gid: process.getgid(),
    euid: process.geteuid(),
    iconPath: iconPath || '',
    iconExists: Boolean(iconPath && fs.existsSync(iconPath)),
    port,
    portOk: Number.isFinite(port),
    hasToken: Boolean(token),
    display: process.env.DISPLAY || '',
    wayland: process.env.WAYLAND_DISPLAY || '',
    dbus: process.env.DBUS_SESSION_BUS_ADDRESS ? '(set)' : '',
    xdgRuntime: process.env.XDG_RUNTIME_DIR || ''
})

function send(cmd) {
    const c = net.createConnection({ port, host: '127.0.0.1' }, () => {
        c.write(token + ':' + cmd + '\n')
        c.end()
    })
    c.on('error', () => { /* root parent may have exited */ })
}

app.whenReady().then(() => {
    trayDebugLog('helperChild', 'whenReady')
    app.setPath('userData', path.join(app.getPath('temp'), `life-parental-tray-${process.getuid()}`))
    if (!iconPath || !fs.existsSync(iconPath) || !Number.isFinite(port)) {
        trayDebugLog('helperChild', 'abort invalid env', {
            hasIconPath: Boolean(iconPath),
            iconExists: Boolean(iconPath && fs.existsSync(iconPath)),
            port,
            portFinite: Number.isFinite(port)
        })
        console.error('[LiFE tray helper] invalid LIFE_TRAY_ICON_PATH / LIFE_TRAY_PORT')
        app.quit()
        return
    }
    const icon = createTrayNativeImageFromPath(iconPath)
    trayDebugLog('helperChild', 'creating Tray', { iconPath, nativeImageOk: Boolean(icon) })
    tray = new Tray(icon || iconPath)
    tray.setToolTip('LiFE Parental Control')
    tray.on('click', () => send('show'))
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Show window', click: () => send('show') },
        { type: 'separator' },
        { label: 'Quit…', click: () => send('quit') }
    ]))
    trayDebugLog('helperChild', 'tray ready')
})
