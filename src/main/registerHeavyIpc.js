import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
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
import { daemonConnect, daemonOn, daemonSend, daemonRequest, isDaemonConnected } from './daemonClient.js'

const execFileAsync = promisify(execFile)

// Set true to re-enable CDN fetch + hosts apply on startup (can be slow / block main when persist runs).
const RUN_STARTUP_HAGEZI_SYNC = false

function cleanupLegacyCronFiles() {
    const paths = [
        '/etc/cron.d/life-parental',
        '/etc/cron.d/life-parental-quota',
        '/usr/local/bin/life-parental-check',
        '/usr/local/bin/life-parental-quota'
    ]
    for (const p of paths) {
        try {
            if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch {
            /* ignore */
        }
    }
    execFile('systemctl', ['reload', 'cron'], { timeout: 3000 }, () => {})
    execFile('systemctl', ['reload', 'crond'], { timeout: 3000 }, () => {})
}

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

    // Daemon connection status
    ipcMain.handle('daemon:isConnected', () => isDaemonConnected())

    // Check if /usr/bin/node exists and return its version
    ipcMain.handle('daemon:nodeCheck', async () => {
        try {
            const { stdout } = await execFileAsync('/usr/bin/node', ['--version'], { timeout: 5000 })
            return { ok: true, version: stdout.trim() }
        } catch {
            return { ok: false, error: '/usr/bin/node nicht gefunden — nodejs-Paket installieren.' }
        }
    })

    // Control and install the parental-control systemd service (app runs as root — no password needed)
    ipcMain.handle('daemon:serviceControl', async (_, { action } = {}) => {
        const allowed = ['start', 'stop', 'restart', 'enable', 'disable', 'status', 'install']
        if (!allowed.includes(action)) return { error: 'Ungültige Aktion.' }

        // install: copy daemon + service files then enable + start
        if (action === 'install') {
            const resBase = app.isPackaged ? process.resourcesPath : app.getAppPath()
            const daemonSrc = path.join(resBase, 'daemon', 'next-exam-daemon.js')
            const serviceSrc = app.isPackaged
                ? path.join(resBase, 'systemd', 'parental-control.service')
                : path.join(resBase, 'packaging', 'systemd', 'parental-control.service')
            try {
                if (!fs.existsSync(daemonSrc)) return { error: `Daemon-Datei nicht gefunden: ${daemonSrc}` }
                if (!fs.existsSync(serviceSrc)) return { error: `Service-Datei nicht gefunden: ${serviceSrc}` }
                fs.copyFileSync(daemonSrc, '/usr/bin/next-exam-daemon.js')
                fs.chmodSync('/usr/bin/next-exam-daemon.js', 0o755)
                fs.mkdirSync('/etc/systemd/system', { recursive: true })
                fs.copyFileSync(serviceSrc, '/etc/systemd/system/parental-control.service')
                await execFileAsync('systemctl', ['daemon-reload'], { timeout: 10_000 })
                await execFileAsync('systemctl', ['enable', 'parental-control.service'], { timeout: 10_000 })
                await execFileAsync('systemctl', ['start', 'parental-control.service'], { timeout: 10_000 })
                return { ok: true }
            } catch (e) {
                return { error: e.message }
            }
        }

        try {
            if (action === 'status') {
                const { stdout } = await execFileAsync('systemctl', ['is-active', 'parental-control.service'], { timeout: 5000 })
                return { ok: true, status: stdout.trim() }
            }
            await execFileAsync('systemctl', [action, 'parental-control.service'], { timeout: 10_000 })
            return { ok: true }
        } catch (e) {
            // is-active exits with code 3 when inactive — still return the status text
            if (action === 'status' && e.stdout) return { ok: true, status: e.stdout.trim() }
            return { error: e.message }
        }
    })

    // Forward daemon status snapshots to any renderer that requests them
    ipcMain.handle('daemon:getStatus', () => {
        return new Promise((resolve) => {
            if (!isDaemonConnected()) { resolve({ connected: false }); return }
            const unsub = daemonOn('status', (msg) => {
                unsub()
                resolve({ connected: true, ...msg })
            })
            daemonSend({ type: 'status' })
            setTimeout(() => { unsub(); resolve({ connected: isDaemonConnected() }); }, 3000)
        })
    })

    // Proxy bonus-time grant to the daemon (avoids duplicating password validation)
    ipcMain.handle('daemon:extend', async (_, { minutes, password } = {}) => {
        if (!isDaemonConnected()) return { error: 'Daemon nicht verbunden.' }
        try {
            return await daemonRequest({ type: 'extend', minutes, password }, 'extend-result')
        } catch (e) {
            return { error: e.message }
        }
    })

    // Proxy app-quota bonus grant to the daemon
    ipcMain.handle('daemon:extendApp', async (_, { minutes, password, appId, linuxUser } = {}) => {
        if (!isDaemonConnected()) return { error: 'Daemon nicht verbunden.' }
        try {
            return await daemonRequest({ type: 'extend-app', minutes, password, appId, linuxUser }, 'extend-app-result')
        } catch (e) {
            return { error: e.message }
        }
    })
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
            // best-effort: catalog so dashboard app-usage can run without opening App Control first
        }
    })
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
        try {
            cleanupLegacyCronFiles()
        } catch {
            /* ignore */
        }

        // Connect to the root daemon — it is the sole source of truth for timekeeping.
        // Warnings are handled by --warning-mode (user-context Electron), not by this root process.
        daemonConnect()
    }
}
