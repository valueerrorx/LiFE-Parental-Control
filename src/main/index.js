import { app, BrowserWindow, ipcMain, Menu, Tray } from 'electron'
import path from 'path'
import fs, { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { registerConfigIpc } from './ipc/configIpc.js'
import { registerProfileIpc } from './ipc/profileIpc.js'
import { registerSystemIpc } from './ipc/systemIpc.js'
import { registerSettingsIpc, repairInvalidLockIdleInConfig } from './ipc/settingsIpc.js'
import { pruneUsageArchives } from './ipc/usageArchivePrune.js'
import { loadTrayNativeImage, resolveTrayIconPath, resolveWindowIconPath } from './trayIcon.js'
import { startUserTrayHelper } from './trayUserHelper.js'
import { initWarningWindow } from './warningWindow.js'
import { stopEnforcementScheduler } from './enforcementScheduler.js'
import { resolveElevatedExecutablePath } from './appImageResolve.js'
import { getActiveGraphicalSessions } from './graphicalSessionDetect.js'
import { getUidForLinuxUser } from './desktopSessionEnviron.js'
import { trayDebugLog } from './trayDebugLog.js'

// __dirname = out/main/ after electron-vite compilation

const APP_CONFIG_DIR = '/etc/life-parental'

let mainWindow = null
let tray = null
let trayUserHelper = null
let allowAppTermination = false
let deferredHeavyWorkStarted = false

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

function appendElevateDebug(line) {
    try {
        fs.appendFileSync('/tmp/life-parental-elevate.log', `${new Date().toISOString()} ${line}\n`, 'utf8')
    } catch {
        /* ignore */
    }
}

function spawnPkexecRelaunch() {
    const self = resolveElevatedExecutablePath()
    const isAppImage = Boolean(process.env.APPIMAGE) || /\.AppImage$/i.test(self)
    const envPairs = buildPkexecForwardEnvPairs()
    if (isAppImage) {
        envPairs.push('APPIMAGE_EXTRACT_AND_RUN=1')
        if (!process.env.APPIMAGE) envPairs.push(`APPIMAGE=${self}`)
    }
    // Root Electron exits immediately unless Chromium sandbox is disabled (same as autostart --no-sandbox).
    const childArgs = [...process.argv.slice(1)]
    const hasNoSandbox = childArgs.some(a => a === '--no-sandbox' || a.startsWith('--no-sandbox='))
    if (!hasNoSandbox) childArgs.push('--no-sandbox')
    const hasExtract = childArgs.some(a => a === '--appimage-extract-and-run')
    const extractArg = isAppImage && !hasExtract ? ['--appimage-extract-and-run'] : []
    const pkexecArgv = ['/usr/bin/env', ...envPairs, self, ...extractArg, ...childArgs]
    appendElevateDebug(`elevate self=${self} argvLen=${pkexecArgv.length} appimage=${isAppImage}`)
    const child = spawn(
        'pkexec',
        pkexecArgv,
        { detached: true, stdio: 'ignore', env: process.env }
    )
    child.on('error', err => {
        console.error('[LiFE Parental Control] pkexec relaunch failed:', err.message)
        appendElevateDebug(`spawn error ${err.message}`)
        app.quit()
    })
    child.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
            appendElevateDebug(`pkexec exit code=${code} signal=${signal ?? ''}`)
        }
        // Quit only after pkexec (or the elevated app replacing its PID) exits — never while the auth dialog is open.
        app.quit()
    })
}

// Suppress Chromium D-Bus connection attempts when running as root (harmless but noisy stderr errors).
if (process.env.LIFE_TRAY_SPAWN !== '1' && typeof process.getuid === 'function' && process.getuid() === 0) {
    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('no-sandbox')
    }
    app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')
    app.commandLine.appendSwitch('disable-dbus')
}

if (process.env.LIFE_TRAY_SPAWN === '1') {
    void import('./trayHelperMain.js')
} else {
    app.whenReady().then(() => {
    // Linux: require root; non-root processes only relaunch via pkexec (Polkit) and exit.
        if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() !== 0) {
            spawnPkexecRelaunch()
            return
        }

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

        initWarningWindow(imagesDir)
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
        registerConfigIpc(ipcMain, kioskDir)
        registerProfileIpc(ipcMain, profilesDir)
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

        mainWindow = new BrowserWindow({
            width: 1600,
            height: 860,
            minWidth: 1100,
            minHeight: 700,
            title: 'LiFE Parental Control',
            ...(windowIconPath ? { icon: windowIconPath } : {}),
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                devTools: false
            }
        })

        mainWindow.on('close', e => {
            if (allowAppTermination) return
            e.preventDefault()
            if (!mainWindow.isDestroyed()) mainWindow.hide()
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

        let trayIconForHelper = resolveTrayIconPath(imagesDir)
        if (!trayIconForHelper) {
            try {
                const img = loadTrayNativeImage(imagesDir)
                const p = path.join(tmpdir(), `life-parental-tray-fallback-${process.pid}.png`)
                fs.writeFileSync(p, img.toPNG())
                trayIconForHelper = p
            } catch (e) {
                console.warn('[LiFE Parental Control] Tray: could not create icon file for helper', e?.message)
            }
        }
        const fromRtUid = (() => {
            const m = String(process.env.XDG_RUNTIME_DIR || '').match(/^\/run\/user\/(\d+)$/)
            return m ? m[1] : null
        })()
        const desktopUidForTray =
        process.env.SUDO_UID || process.env.PKEXEC_UID || readProcLoginUid()
        || (fromRtUid && fromRtUid !== '0' ? fromRtUid : null) || firstNonRootUserBusUid()

        const startTrayAfterUiReady = async () => {
            trayDebugLog('main', 'startTrayAfterUiReady', {
                uid: typeof process.getuid === 'function' ? process.getuid() : null,
                packaged: app.isPackaged,
                execPath: process.execPath,
                argv0: process.argv[0],
                hasAPPIMAGE: Boolean(process.env.APPIMAGE),
                NODE_ENV: process.env.NODE_ENV || '',
                SUDO_UID: process.env.SUDO_UID || '',
                PKEXEC_UID: process.env.PKEXEC_UID || '',
                desktopUidForTray: desktopUidForTray || '',
                imagesDir,
                trayIconForHelper: trayIconForHelper || ''
            })
            // Set D-Bus address late so Chromium does not inherit it at window creation (avoids multi-second D-Bus timeouts).
            applyLinuxUserSessionBusIfRoot()
            let trayTargetUser = desktopUidForTray
            try {
                const sessions = await getActiveGraphicalSessions()
                trayDebugLog('main', 'getActiveGraphicalSessions', { count: sessions.length, sessions })
                if (sessions.length > 0) {
                    const sudo = process.env.SUDO_UID || process.env.PKEXEC_UID
                    let pick = sessions[0]
                    if (sudo) {
                        const hit = sessions.find(s => getUidForLinuxUser(s.user) === String(sudo))
                        if (hit) pick = hit
                    }
                    trayTargetUser = pick.user
                }
            } catch (e) {
                trayDebugLog('main', 'getActiveGraphicalSessions error', e?.message || String(e))
                console.warn('[LiFE Parental Control] Tray: session list failed', e?.message)
            }
            trayDebugLog('main', 'trayTargetUser resolved', { trayTargetUser: trayTargetUser || '', willTryHelper: Boolean(
                process.platform === 'linux' && process.getuid?.() === 0 && trayTargetUser && trayTargetUser !== '0' && trayIconForHelper
            ) })
            if (process.platform === 'linux' && process.getuid?.() === 0 && trayTargetUser && trayTargetUser !== '0' && trayIconForHelper) {
                trayUserHelper = await startUserTrayHelper({
                    uidS: String(trayTargetUser),
                    trayIconPath: trayIconForHelper,
                    mainDir: __dirname,
                    electronExec: process.execPath,
                    onShow: showMainWindow,
                    onQuitFromTray: quitFromTray
                })
                trayDebugLog('main', 'startUserTrayHelper result', { ok: Boolean(trayUserHelper) })
            }
            if (!trayUserHelper) {
                trayDebugLog('main', 'using root fallback Tray (no user helper)')
                const trayPath = trayIconForHelper || resolveTrayIconPath(imagesDir)
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
                trayDebugLog('main', 'summary', {
                    userHelper: Boolean(trayUserHelper),
                    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || '(unset)',
                    logFile: '/tmp/life-parental-tray-debug.log'
                })
                console.warn(
                    '[LiFE Parental Control] Tray: root main; userHelper=',
                    Boolean(trayUserHelper),
                    'DBUS_SESSION_BUS_ADDRESS=',
                    process.env.DBUS_SESSION_BUS_ADDRESS || '(unset)',
                    '| tray debug:',
                    '/tmp/life-parental-tray-debug.log'
                )
            }
        }

        ipcMain.handle('app:quit', () => {
            allowAppTermination = true
            app.quit()
        })

        ipcMain.handle('app:deferredHeavyWork', async () => {
            if (deferredHeavyWorkStarted) return { ok: true }
            deferredHeavyWorkStarted = true
            scheduleHeavyIpcRegistration()
            await heavyIpcReady
            const { runDeferredStartupTasks } = await import('./registerHeavyIpc.js')
            globalThis.setImmediate(() => runDeferredStartupTasks(APP_CONFIG_DIR))
            return { ok: true }
        })

        if (process.env.NODE_ENV === 'development') {
            mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
        } else {
            mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
        }
        mainWindow.webContents.once('did-finish-load', () => {
            globalThis.setImmediate(() => {
                void startTrayAfterUiReady().catch(err => {
                    console.error('[LiFE Parental Control] Tray startup failed:', err)
                })
            })
        })
    })

    app.on('before-quit', () => {
        allowAppTermination = true
    })

    app.on('will-quit', () => {
        stopEnforcementScheduler()
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
}
