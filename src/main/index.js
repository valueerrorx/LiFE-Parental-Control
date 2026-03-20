import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import path from 'path'
import { mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { registerConfigIpc } from './ipc/configIpc.js'
import { registerProfileIpc } from './ipc/profileIpc.js'
import { registerSystemIpc } from './ipc/systemIpc.js'
import { registerWebFilterIpc } from './ipc/webFilterIpc.js'
import { registerAppBlockerIpc } from './ipc/appBlockerIpc.js'
import { registerSchedulesIpc } from './ipc/schedulesIpc.js'
import { registerSettingsIpc, repairInvalidLockIdleInConfig } from './ipc/settingsIpc.js'
import { registerLifeModeIpc } from './ipc/lifeModeIpc.js'
import { registerBackupIpc } from './ipc/backupIpc.js'
import { registerQuotaIpc } from './ipc/quotaIpc.js'
import { registerProcessWhitelistIpc } from './ipc/processWhitelistIpc.js'
import { registerActivityIpc } from './ipc/activityIpc.js'
import { pruneUsageArchives } from './ipc/usageArchivePrune.js'

// __dirname = out/main/ after electron-vite compilation

const APP_CONFIG_DIR = '/etc/life-parental'

let mainWindow = null

app.whenReady().then(() => {
    // All app.* calls are safe inside whenReady — avoids top-level require('electron') resolution issues

    if (app.isPackaged && process.getuid && process.getuid() !== 0) {
        const self = process.env.APPIMAGE ?? process.execPath
        execFile('pkexec', [self], { detached: true, stdio: 'ignore' })
        app.quit()
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
    registerSystemIpc(ipcMain, () => mainWindow)
    registerWebFilterIpc(ipcMain, APP_CONFIG_DIR)
    registerAppBlockerIpc(ipcMain, APP_CONFIG_DIR)
    registerSchedulesIpc(ipcMain, APP_CONFIG_DIR)
    registerSettingsIpc(ipcMain, APP_CONFIG_DIR)
    registerLifeModeIpc(ipcMain, APP_CONFIG_DIR)
    registerQuotaIpc(ipcMain, APP_CONFIG_DIR)
    registerProcessWhitelistIpc(ipcMain, APP_CONFIG_DIR)
    registerActivityIpc(ipcMain, APP_CONFIG_DIR)
    registerBackupIpc(ipcMain, APP_CONFIG_DIR, () => mainWindow)

    Menu.setApplicationMenu(null)

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 860,
        minWidth: 1100,
        minHeight: 700,
        title: 'LiFE Parental Control',
        icon: path.join(imagesDir, 'kiosk.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    })

    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
        mainWindow.webContents.openDevTools()
    } else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
})

app.on('window-all-closed', () => app.quit())
