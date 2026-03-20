import { app, BrowserWindow, dialog, ipcMain, Menu, Tray } from 'electron'
import path from 'path'
import fs, { mkdirSync } from 'fs'
import { spawn } from 'child_process'
import { registerConfigIpc } from './ipc/configIpc.js'
import { registerProfileIpc } from './ipc/profileIpc.js'
import { registerSystemIpc } from './ipc/systemIpc.js'
import { registerWebFilterIpc, runStartupHageziSync } from './ipc/webFilterIpc.js'
import { registerAppBlockerIpc, refreshAppMonitorCatalog } from './ipc/appBlockerIpc.js'
import { registerSchedulesIpc } from './ipc/schedulesIpc.js'
import { registerSettingsIpc, repairInvalidLockIdleInConfig } from './ipc/settingsIpc.js'
import { registerLifeModeIpc } from './ipc/lifeModeIpc.js'
import { registerBackupIpc } from './ipc/backupIpc.js'
import { registerQuotaIpc } from './ipc/quotaIpc.js'
import { registerProcessWhitelistIpc } from './ipc/processWhitelistIpc.js'
import { registerActivityIpc } from './ipc/activityIpc.js'
import { registerSettingsDangerIpc } from './ipc/settingsDangerIpc.js'
import { pruneUsageArchives } from './ipc/usageArchivePrune.js'
import { syncEmbeddedEnforcementIfNeeded } from './ipc/embeddedEnforcementSync.js'
import { loadTrayNativeImage, resolveTrayIconPath } from './trayIcon.js'
import { startUserTrayHelper } from './trayUserHelper.js'

// __dirname = out/main/ after electron-vite compilation

const APP_CONFIG_DIR = '/etc/life-parental'

let mainWindow = null
let tray = null
let trayUserHelper = null
let allowAppTermination = false

function readProcLoginUid() {
    try {
        const t = fs.readFileSync('/proc/self/loginuid', 'utf8').trim()
        const n = Number(t)
        if (!Number.isFinite(n) || n <= 0 || n >= 4294967295) return null
        return String(n)
    } catch {
        return null
    }
}

function firstNonRootUserBusUid() {
    try {
        const names = fs.readdirSync('/run/user')
        const uids = []
        for (const name of names) {
            if (!/^\d+$/.test(name) || name === '0') continue
            const bus = path.join('/run/user', name, 'bus')
            try {
                fs.accessSync(bus, fs.constants.R_OK)
                uids.push(Number(name))
            } catch {
                /* skip */
            }
        }
        uids.sort((a, b) => a - b)
        return uids.length ? String(uids[0]) : null
    } catch {
        return null
    }
}

function applyLinuxUserSessionBusIfRoot() {
    if (process.platform !== 'linux') return
    if (typeof process.getuid !== 'function' || process.getuid() !== 0) return
    const cur = process.env.DBUS_SESSION_BUS_ADDRESS || ''
    if (cur && !cur.includes('/run/user/0/')) return
    const fromRt = (() => {
        const m = String(process.env.XDG_RUNTIME_DIR || '').match(/^\/run\/user\/(\d+)$/)
        return m ? m[1] : null
    })()
    const uid = process.env.SUDO_UID || process.env.PKEXEC_UID || readProcLoginUid()
        || (fromRt && fromRt !== '0' ? fromRt : null) || firstNonRootUserBusUid()
    if (!uid || uid === '0') return
    process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uid}/bus`
}

function buildPkexecForwardEnvPairs() {
    const envPairs = []
    const passKeys = [
        'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
        'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'QT_QPA_PLATFORM', 'APPIMAGE'
    ]
    for (const k of passKeys) {
        const v = process.env[k]
        if (v) envPairs.push(`${k}=${v}`)
    }
    return envPairs
}

function spawnPkexecRelaunch() {
    const self = process.env.APPIMAGE ?? process.execPath
    const child = spawn(
        'pkexec',
        ['/usr/bin/env', ...buildPkexecForwardEnvPairs(), self, ...process.argv.slice(1)],
        { detached: true, stdio: 'ignore', env: process.env }
    )
    child.on('error', err => {
        console.error('[LiFE Parental Control] pkexec relaunch failed:', err.message)
    })
    child.unref()
}

function showElevationGateAndWaitForPkexec() {
    const imagesDir = path.join(process.resourcesPath, 'images')
    const gateHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:20px 22px;background:#f8f9fa;color:#212529;line-height:1.45;}
h1{font-size:1.05rem;margin:0 0 10px;font-weight:600;}
p{margin:0 0 10px;font-size:14px;}
code{font-size:12px;background:#e9ecef;padding:1px 5px;border-radius:4px;}
button{margin-top:12px;padding:10px 20px;font-size:14px;font-weight:500;border:0;border-radius:6px;background:#0d6efd;color:#fff;cursor:pointer;}
button:hover{background:#0b5ed7;}
</style></head><body>
<h1>Administratorrechte erforderlich</h1>
<p>Diese Anwendung ändert Systemeinstellungen (z.&nbsp;B. unter <code>/etc</code>). </p>
<p>Mit <strong>Weiter</strong> öffnet sich die grafische Systemabfrage (Polkit) zur Passwort-Eingabe.</p>
<button id="go">Weiter</button>
<script>
document.getElementById('go').onclick=function(){
  require('electron').ipcRenderer.send('elevation:continue');
};
</script>
</body></html>`
    ipcMain.once('elevation:continue', () => {
        spawnPkexecRelaunch()
        app.quit()
    })
    const gate = new BrowserWindow({
        width: 480,
        height: 280,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        title: 'LiFE Parental Control',
        icon: path.join(imagesDir, 'pc.png'),
        show: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })
    gate.removeMenu()
    gate.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(gateHtml))
}

app.whenReady().then(async () => {
    // All app.* calls are safe inside whenReady — avoids top-level require('electron') resolution issues

    if (!app.isPackaged && typeof process.getuid === 'function' && process.getuid() !== 0) {
        const msg =
            'LiFE Parental Control benötigt root (Schreibzugriff auf /etc/life-parental/). ' +
            'Entwicklung: npm run dev (startet mit sudo).'
        console.error('[LiFE Parental Control]', msg)
        dialog.showErrorBox('LiFE Parental Control', msg)
        app.quit()
        return
    }

    if (app.isPackaged && typeof process.getuid === 'function' && process.getuid() !== 0) {
        showElevationGateAndWaitForPkexec()
        return
    }

    applyLinuxUserSessionBusIfRoot()

    const kioskDir = app.isPackaged
        ? path.join(process.resourcesPath, 'kiosk')
        : path.join(__dirname, '../../kiosk')

    const imagesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'images')
        : path.join(__dirname, '../../images')

    const profilesDir = (() => {
        if (!app.isPackaged) return path.join(__dirname, '../../profiles')
        if (process.env.APPIMAGE) return path.join(path.dirname(process.env.APPIMAGE), 'profiles')
        return path.join(process.resourcesPath, 'profiles')
    })()

    mkdirSync(profilesDir, { recursive: true })
    mkdirSync(APP_CONFIG_DIR, { recursive: true })
    try {
        repairInvalidLockIdleInConfig(APP_CONFIG_DIR)
    } catch {
        // best-effort
    }
    try {
        pruneUsageArchives(APP_CONFIG_DIR)
    } catch {
        // best-effort cleanup
    }
    if (app.isPackaged && typeof process.getuid === 'function' && process.getuid() === 0) {
        try {
            syncEmbeddedEnforcementIfNeeded(APP_CONFIG_DIR, app.getVersion())
        } catch {
            // best-effort: enforcement scripts must not block startup
        }
    }

    registerConfigIpc(ipcMain, kioskDir)
    registerProfileIpc(ipcMain, profilesDir)
    registerSystemIpc(ipcMain, () => mainWindow, APP_CONFIG_DIR)
    const hageziBundledDir = app.isPackaged
        ? path.join(process.resourcesPath, 'hagezi')
        : path.resolve(path.join(__dirname, '../../hagezi'))
    registerWebFilterIpc(ipcMain, APP_CONFIG_DIR, { hageziBundledDir })
    void runStartupHageziSync(APP_CONFIG_DIR)
    registerAppBlockerIpc(ipcMain, APP_CONFIG_DIR)
    registerSchedulesIpc(ipcMain, APP_CONFIG_DIR)
    registerSettingsIpc(ipcMain, APP_CONFIG_DIR)
    registerLifeModeIpc(ipcMain, APP_CONFIG_DIR)
    registerQuotaIpc(ipcMain, APP_CONFIG_DIR)
    try {
        refreshAppMonitorCatalog(APP_CONFIG_DIR)
    } catch {
        // best-effort: catalog + cron so dashboard app-usage can run without opening App Control first
    }
    registerProcessWhitelistIpc(ipcMain, APP_CONFIG_DIR)
    registerActivityIpc(ipcMain, APP_CONFIG_DIR)
    registerBackupIpc(ipcMain, APP_CONFIG_DIR, () => mainWindow)
    registerSettingsDangerIpc(ipcMain, APP_CONFIG_DIR)

    Menu.setApplicationMenu(null)

    mainWindow = new BrowserWindow({
        width: 1600,
        height: 860,
        minWidth: 1100,
        minHeight: 700,
        title: 'LiFE Parental Control',
        icon: path.join(imagesDir, 'pc.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    })

    mainWindow.on('close', e => {
        if (allowAppTermination) return
        e.preventDefault()
        if (!mainWindow.isDestroyed()) mainWindow.hide()
    })

    ipcMain.handle('app:quit', () => {
        allowAppTermination = true
        app.quit()
    })

    const showMainWindow = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
    }
    const quitFromTray = () => {
        showMainWindow()
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('app:quit-from-tray')
    }

    const trayPath = resolveTrayIconPath(imagesDir)
    const fromRtUid = (() => {
        const m = String(process.env.XDG_RUNTIME_DIR || '').match(/^\/run\/user\/(\d+)$/)
        return m ? m[1] : null
    })()
    const desktopUidForTray =
        process.env.SUDO_UID || process.env.PKEXEC_UID || readProcLoginUid()
        || (fromRtUid && fromRtUid !== '0' ? fromRtUid : null) || firstNonRootUserBusUid()

    if (process.platform === 'linux' && process.getuid?.() === 0 && desktopUidForTray && desktopUidForTray !== '0' && trayPath) {
        trayUserHelper = await startUserTrayHelper({
            uidS: desktopUidForTray,
            trayIconPath: trayPath,
            mainDir: __dirname,
            electronExec: process.execPath,
            onShow: showMainWindow,
            onQuitFromTray: quitFromTray
        })
    }

    if (!trayUserHelper) {
        try {
            tray = trayPath ? new Tray(trayPath) : new Tray(loadTrayNativeImage(imagesDir))
        } catch (err) {
            console.error('[LiFE Parental Control] Tray init failed:', err)
            tray = new Tray(loadTrayNativeImage(imagesDir))
        }
        tray.setToolTip('LiFE Parental Control')
        tray.on('click', showMainWindow)
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Show window', click: showMainWindow },
            { type: 'separator' },
            { label: 'Quit…', click: quitFromTray }
        ]))
    }
    if (process.platform === 'linux' && process.getuid?.() === 0) {
        console.warn(
            '[LiFE Parental Control] Tray: root main; userHelper=',
            Boolean(trayUserHelper),
            'DBUS_SESSION_BUS_ADDRESS=',
            process.env.DBUS_SESSION_BUS_ADDRESS || '(unset)'
        )
    }

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
})

app.on('before-quit', () => {
    allowAppTermination = true
})

app.on('will-quit', () => {
    if (trayUserHelper) {
        trayUserHelper.stop()
        trayUserHelper = null
    }
    if (tray) {
        tray.destroy()
        tray = null
    }
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') return
    app.quit()
})
