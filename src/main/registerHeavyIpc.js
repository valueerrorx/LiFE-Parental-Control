import { app } from 'electron'
import { registerWebFilterIpc, runStartupHageziSync } from './ipc/webFilterIpc.js'
import { registerAppBlockerIpc, refreshAppMonitorCatalog } from './ipc/appBlockerIpc.js'
import { registerSchedulesIpc } from './ipc/schedulesIpc.js'
import { registerLifeModeIpc } from './ipc/lifeModeIpc.js'
import { registerQuotaIpc } from './ipc/quotaIpc.js'
import { registerProcessWhitelistIpc } from './ipc/processWhitelistIpc.js'
import { registerActivityIpc } from './ipc/activityIpc.js'
import { registerBackupIpc } from './ipc/backupIpc.js'
import { registerSettingsDangerIpc } from './ipc/settingsDangerIpc.js'
import { syncEmbeddedEnforcementIfNeeded } from './ipc/embeddedEnforcementSync.js'

// Set true to re-enable CDN fetch + hosts apply on startup (can be slow / block main when persist runs).
const RUN_STARTUP_HAGEZI_SYNC = false

export function registerHeavyIpc(ipcMain, { appConfigDir, hageziBundledDir, getMainWindow }) {
    registerWebFilterIpc(ipcMain, appConfigDir, { hageziBundledDir })
    registerAppBlockerIpc(ipcMain, appConfigDir)
    registerSchedulesIpc(ipcMain, appConfigDir)
    registerLifeModeIpc(ipcMain, appConfigDir)
    registerQuotaIpc(ipcMain, appConfigDir)
    registerProcessWhitelistIpc(ipcMain, appConfigDir)
    registerActivityIpc(ipcMain, appConfigDir)
    registerBackupIpc(ipcMain, appConfigDir, getMainWindow)
    registerSettingsDangerIpc(ipcMain, appConfigDir)
}

export function runDeferredStartupTasks(appConfigDir) {
    if (app.isPackaged && typeof process.getuid === 'function' && process.getuid() === 0) {
        try {
            syncEmbeddedEnforcementIfNeeded(appConfigDir, app.getVersion())
        } catch {
            // best-effort
        }
    }
    if (RUN_STARTUP_HAGEZI_SYNC) {
        void runStartupHageziSync(appConfigDir)
    }
    globalThis.setImmediate(() => {
        try {
            refreshAppMonitorCatalog(appConfigDir)
        } catch {
            // best-effort: catalog + cron so dashboard app-usage can run without opening App Control first
        }
    })
}
