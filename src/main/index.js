/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import path from 'path'
import { mkdirSync } from 'fs'
import { registerConfigIpc } from './ipc/configIpc.js'
import { registerProfileIpc } from './ipc/profileIpc.js'
import { registerSystemIpc } from './ipc/systemIpc.js'
import { registerSettingsIpc, repairInvalidLockIdleInConfig } from './ipc/settingsIpc.js'
import { resolveWindowIconPath } from './windowIcon.js'
import { initWarningWindow } from './warningWindow.js'
import { ensureDefaultJsonExistsForUi } from './defaultProfileStore.js'

const APP_CONFIG_DIR = '/etc/life-parental'

// Set LIFE_DEVTOOLS=1 when debugging a packaged build (e.g. white window on Ubuntu); opens DevTools after load.
function isMainWindowDevtoolsEnabled() {
    if (process.env.NODE_ENV === 'development') return true
    const v = process.env.LIFE_DEVTOOLS
    return v === '1' || v === 'true' || v === 'yes'
}

// In dev, blur/minimize/hide no longer fire session lock (detach DevTools); opt back in with LIFE_SESSION_LOCK=1.
function isSessionLockOnFocusLossEnabled() {
    if (process.env.NODE_ENV === 'development') {
        const v = process.env.LIFE_SESSION_LOCK
        return v === '1' || v === 'true' || v === 'yes'
    }
    return true
}

let mainWindow = null
let allowAppTermination = false
let deferredHeavyWorkPromise = null

// Detect warning mode (spawned by daemon as the desktop user, no root)
const warningModeArg = process.argv.find(a => a.startsWith('--warning-mode='))
const isWarningMode = Boolean(warningModeArg)

// Main UI only: optional Ozone/GPU from env — never mix with warning-mode spawn logic.
if (process.platform === 'linux' && !isWarningMode) {
    const oz = process.env.LIFE_OZONE_PLATFORM || process.env.ELECTRON_OZONE_PLATFORM_HINT
    if (oz === 'x11' || oz === 'wayland') {
        app.commandLine.appendSwitch('ozone-platform', oz)
    }
    const dg = process.env.LIFE_DISABLE_GPU
    if (dg === '1' || dg === 'true' || dg === 'yes') {
        app.commandLine.appendSwitch('disable-gpu')
        app.commandLine.appendSwitch('disable-gpu-compositing')
    }
    // Disable Wayland color management (wp-color-manager) — causes 3-4s startup delay on some compositors
    app.commandLine.appendSwitch('disable-features', 'WaylandColorManagement')
}





// Warning window only: systemd daemon spawns with session env (deb/AppImage); must pick Ozone explicitly — main window path does not apply.
if (process.platform === 'linux' && isWarningMode) {
    applyWarningModeLinuxChromiumSwitches()
}

function applyWarningModeLinuxChromiumSwitches() {
    const wl = process.env.WAYLAND_DISPLAY
    const xdg = process.env.XDG_SESSION_TYPE
    const disp = process.env.DISPLAY
    let oz = process.env.ELECTRON_OZONE_PLATFORM_HINT || process.env.LIFE_OZONE_PLATFORM
    if (!oz) {
        if (wl || xdg === 'wayland') oz = 'wayland'
        else if (xdg === 'x11' || (disp && !wl)) oz = 'x11'
    }
    if (oz === 'x11' || oz === 'wayland') {
        app.commandLine.appendSwitch('ozone-platform', oz)
    }
}

// Single-instance lock — warning-mode windows are exempt (each is a separate short-lived process)
if (!isWarningMode) {
    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
        app.quit()
    } else {
        app.on('second-instance', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore()
                if (!mainWindow.isMaximized()) mainWindow.maximize()
                mainWindow.show()
                mainWindow.focus()
            }
        })
    }
}

app.whenReady().then(async () => {
    // Warning mode: spawned by daemon as desktop user, shows bonus-time dialog only
    if (isWarningMode) {
        let payload = {}
        try { payload = JSON.parse(warningModeArg.slice('--warning-mode='.length)) } catch { /* ignore */ }
        const { runWarningMode } = await import('./warningModeMain.js')
        runWarningMode(payload)
        return
    }

    const kioskDir = app.isPackaged
        ? path.join(process.resourcesPath, 'kiosk')
        : path.join(__dirname, '../../kiosk')

    const imagesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'images')
        : path.join(__dirname, '../../images')

    const profilesDir = app.isPackaged
        ? path.join(app.getPath('userData'), 'profiles')
        : path.join(__dirname, '../../profiles')

    initWarningWindow(imagesDir)
    mkdirSync(profilesDir, { recursive: true })
    ensureDefaultJsonExistsForUi(APP_CONFIG_DIR)
    try {
        repairInvalidLockIdleInConfig(APP_CONFIG_DIR)
    } catch {
        // best-effort
    }
    registerConfigIpc(ipcMain, kioskDir)
    registerProfileIpc(ipcMain, profilesDir, APP_CONFIG_DIR)
    registerSystemIpc(ipcMain, () => mainWindow, APP_CONFIG_DIR)
    registerSettingsIpc(ipcMain, APP_CONFIG_DIR)

    Menu.setApplicationMenu(null)

    let heavyIpcReadyResolve
    const heavyIpcReady = new Promise((resolve) => {
        heavyIpcReadyResolve = resolve
    })
    let heavyIpcScheduled = false
    const scheduleHeavyIpcRegistration = () => {
        if (heavyIpcScheduled) return
        heavyIpcScheduled = true
        globalThis.setImmediate(async () => {
            try {
                const { registerHeavyIpc } = await import('./registerHeavyIpc.js')
                const hageziBundledDir = app.isPackaged
                    ? path.join(process.resourcesPath, 'hagezi')
                    : path.resolve(path.join(__dirname, '../../hagezi'))
                registerHeavyIpc(ipcMain, {
                    appConfigDir: APP_CONFIG_DIR,
                    hageziBundledDir,
                    getMainWindow: () => mainWindow
                })
            } catch (e) {
                console.error('[LiFE Parental Control] Heavy IPC registration failed:', e)
            } finally {
                heavyIpcReadyResolve()
            }
        })
    }

    const windowIconPath = resolveWindowIconPath(imagesDir)
    const mainDevtools = isMainWindowDevtoolsEnabled()

    mainWindow = new BrowserWindow({
        width: 1600,
        height: 860,
        minWidth: 1100,
        minHeight: 700,
        show: false,
        title: 'LiFE Parental Control',
        ...(windowIconPath ? { icon: windowIconPath } : {}),
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            devTools: mainDevtools
        }
    })
    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.insertCSS('body { opacity: 0; transition: opacity 0.35s ease; }').then(() => {
            mainWindow.show()
            mainWindow.webContents.executeJavaScript('requestAnimationFrame(() => document.body.style.opacity = "1")')
        })
    })


    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.error('[LiFE Parental Control] did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame })
    })
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[LiFE Parental Control] render-process-gone', details)
    })

    // Lock UI on any focus loss — covers minimize, hide, click-away on all platforms including KDE/Wayland.
    let rendererLoaded = false
    mainWindow.webContents.once('did-finish-load', () => {
        rendererLoaded = true
        if (mainDevtools) {
            try {
                mainWindow.webContents.openDevTools()
            } catch {
                /* ignore */
            }
        }
    })
    const sendSessionLock = () => {
        if (!rendererLoaded || !mainWindow || mainWindow.isDestroyed()) return
        mainWindow.webContents.send('app:session-lock-request')
    }
    if (isSessionLockOnFocusLossEnabled()) {
        mainWindow.on('blur', sendSessionLock)
        mainWindow.on('minimize', sendSessionLock)
        mainWindow.on('hide', sendSessionLock)
    }

    // Open target="_blank" links in a new Electron window, never in the same window.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://')) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 1200,
                    height: 800,
                    autoHideMenuBar: true,
                    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
                }
            }
        }
        return { action: 'deny' }
    })

    mainWindow.on('close', e => {
        if (allowAppTermination) return
        e.preventDefault()
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('app:quit-request')
    })

    ipcMain.handle('shell:openExternal', (_, url) => {
        if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url)
    })

    ipcMain.handle('app:quit', () => {
        allowAppTermination = true
        app.quit()
    })

    ipcMain.handle('app:deferredHeavyWork', async () => {
        if (deferredHeavyWorkPromise) return deferredHeavyWorkPromise
        deferredHeavyWorkPromise = (async () => {
            scheduleHeavyIpcRegistration()
            await heavyIpcReady

            try {
                if (process.platform === 'linux') {
                    const { applyLifeModeDirect } = await import('./ipc/lifeModeIpc.js')
                    await applyLifeModeDirect(APP_CONFIG_DIR, 'default', { quiet: true, background: true })
                }
            } catch {
                // best-effort
            }

            const { runDeferredStartupTasks } = await import('./registerHeavyIpc.js')
            globalThis.setImmediate(() => runDeferredStartupTasks(APP_CONFIG_DIR))
            return { ok: true }
        })()
        return deferredHeavyWorkPromise
    })

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
})

app.on('before-quit', () => {
    allowAppTermination = true
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') return
    app.quit()
})
