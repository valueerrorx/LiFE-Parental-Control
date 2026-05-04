/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import { registerWebFilterIpc, runStartupHageziSync } from './ipc/webFilterIpc.js'
import { registerAppBlockerIpc } from './ipc/appBlockerIpc.js'
import { registerSchedulesIpc } from './ipc/schedulesIpc.js'
import { registerQuotaIpc } from './ipc/quotaIpc.js'
import { registerProcessWhitelistIpc } from './ipc/processWhitelistIpc.js'
import { registerActivityIpc } from './ipc/activityIpc.js'
import { registerBackupIpc } from './ipc/backupIpc.js'
import { registerSettingsDangerIpc } from './ipc/settingsDangerIpc.js'
import { registerLockdownIpc } from './ipc/lockdownIpc.js'
import { daemonConnect, daemonOn, daemonSend, daemonRequest, isDaemonConnected } from './daemonClient.js'
import { daemonServiceControl, daemonRegisterClient } from './daemonPrivilegedOps.js'
import { ensureSchoolTimesPersistedOnDisk } from './defaultProfileStore.js'

const execFileAsync = promisify(execFile)

// Set true to re-enable CDN fetch + hosts apply on startup (can be slow / block main when persist runs).
const RUN_STARTUP_HAGEZI_SYNC = false

// Wait until the daemon socket reconnects (after a restart/install), then resolve.
// Resolves immediately if already connected. Always resolves after timeoutMs even if not connected.
function waitForDaemonConnect(timeoutMs = 20_000) {
    return new Promise((resolve) => {
        if (isDaemonConnected()) { resolve(); return }
        let timer
        const unsub = daemonOn('connect', () => { clearTimeout(timer); unsub(); resolve() })
        timer = setTimeout(() => { unsub(); resolve() }, timeoutMs)
    })
}

export function registerHeavyIpc(ipcMain, { appConfigDir, getMainWindow }) {
    const bundledDir = app.isPackaged ? process.resourcesPath : app.getAppPath()
    registerWebFilterIpc(ipcMain, appConfigDir, bundledDir)
    registerAppBlockerIpc(ipcMain, appConfigDir)
    registerSchedulesIpc(ipcMain, appConfigDir)
    registerQuotaIpc(ipcMain, appConfigDir)
    registerProcessWhitelistIpc(ipcMain, appConfigDir)
    registerActivityIpc(ipcMain, appConfigDir)
    registerBackupIpc(ipcMain, appConfigDir, getMainWindow)
    registerSettingsDangerIpc(ipcMain, appConfigDir)
    registerLockdownIpc(ipcMain, appConfigDir)

    // Daemon connection status
    ipcMain.handle('daemon:isConnected', () => isDaemonConnected())

    // Check if /usr/bin/node exists and return its version
    // Check whether the installed daemon version matches the running app
    ipcMain.handle('daemon:checkInstalledVersion', () => {
        const versionFile = '/usr/lib/life-parental/.installed-version'
        try {
            const installed = fs.readFileSync(versionFile, 'utf8').trim()
            const current = app.getVersion()
            return { ok: true, installedVersion: installed, appVersion: current, upToDate: installed === current }
        } catch {
            return { ok: true, installedVersion: null, appVersion: app.getVersion(), upToDate: false }
        }
    })

    ipcMain.handle('daemon:nodeCheck', async () => {
        try {
            const { stdout } = await execFileAsync('/usr/bin/node', ['--version'], { timeout: 5000 })
            const version = String(stdout || '').trim()
            const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version)
            if (!m) return { ok: false, version, reason: 'unparseable' }
            const major = Number(m[1])
            const minor = Number(m[2])
            const patch = Number(m[3])
            const ok = major >= 22
            return { ok, version, reason: ok ? 'ok' : 'too_old', required: '>=22.0.0' }
        } catch {
            return { ok: false, version: null, reason: 'missing', error: '/usr/bin/node nicht gefunden — nodejs-Paket installieren.' }
        }
    })

    ipcMain.handle('daemon:apparmorCheck', async () => {
        const profilePath = '/etc/apparmor.d/life-parental-blocked'
        const enabledPath = '/sys/module/apparmor/parameters/enabled'
        try {
            let enabled = false
            try {
                const raw = fs.readFileSync(enabledPath, 'utf8')
                enabled = String(raw).trim().toLowerCase().startsWith('y')
            } catch {
                enabled = fs.existsSync('/sys/kernel/security/apparmor')
            }

            let parser = false
            try {
                const apparmorParserBin = ['/usr/sbin/apparmor_parser', '/usr/bin/apparmor_parser', '/sbin/apparmor_parser']
                    .find(p => fs.existsSync(p))
                if (!apparmorParserBin) throw new Error('apparmor_parser binary not found')
                await execFileAsync(apparmorParserBin, ['--version'], { timeout: 5000 })
                parser = true
            } catch { parser = false }

            const profileExists = fs.existsSync(profilePath)

            // Check if apparmor.service ran successfully.
            // Type=oneshot without RemainAfterExit exits with code 3 ("inactive") even when
            // AppArmor IS loaded — so fall back to checking Result=success in that case.
            let serviceActive = false
            try {
                const { stdout: svcOut } = await execFileAsync('systemctl', ['is-active', 'apparmor.service'], { timeout: 3000 })
                serviceActive = String(svcOut).trim() === 'active'
            } catch {
                try {
                    const { stdout: showOut } = await execFileAsync(
                        'systemctl', ['show', 'apparmor.service', '--property=Result'], { timeout: 3000 }
                    )
                    serviceActive = String(showOut).trim() === 'Result=success'
                } catch { serviceActive = false }
            }

            const ok = Boolean(enabled && parser && profileExists && serviceActive)
            const reason = ok
                ? 'ok'
                : !enabled
                    ? 'disabled'
                    : !parser
                        ? 'parser_missing'
                        : !profileExists
                            ? 'profile_missing'
                            : 'profile_not_loaded'
            return { ok, enabled, parser, profileExists, serviceActive, reason }
        } catch {
            return { ok: false, enabled: false, parser: false, profileExists: false, serviceActive: false, reason: 'error' }
        }
    })

    ipcMain.handle('daemon:dnsmasqCheck', async () => {
        // Resolve binary path — Electron may run without /usr/sbin in PATH (common on Debian)
        const dnsmasqBin = ['/usr/bin/dnsmasq', '/usr/sbin/dnsmasq', '/sbin/dnsmasq']
            .find(p => fs.existsSync(p))
        if (!dnsmasqBin) return { ok: false, version: null, running: false, reason: 'not_installed' }
        try {
            const { stdout } = await execFileAsync(dnsmasqBin, ['--version'], { timeout: 5000 })
            const version = String(stdout || '').split('\n')[0].trim() // e.g. "Dnsmasq version 2.90  Copyright..."
            const m = /(\d+\.\d+(?:\.\d+)?)/.exec(version)
            const versionShort = m ? m[1] : version || null
            // Check if the service is active
            let running = false
            try {
                const { stdout: svcOut } = await execFileAsync('systemctl', ['is-active', 'dnsmasq.service'], { timeout: 3000 })
                running = String(svcOut).trim() === 'active'
            } catch { running = false }
            const reason = running ? 'ok' : 'not_running'
            return { ok: running, version: versionShort, running, reason }
        } catch {
            return { ok: false, version: null, running: false, reason: 'not_installed' }
        }
    })

    ipcMain.handle('daemon:grubCheck', () => {
        const GRUB_D_DIR = '/etc/grub.d'
        const GRUB_10_LINUX = '/etc/grub.d/10_linux'
        const GRUB_CFG = '/boot/grub/grub.cfg'

        const hasGrubPasswordMarkers = (text) => {
            if (!text) return false
            return text.includes('password_pbkdf2') || text.includes('set superusers=')
        }

        const safeReadText = (p) => {
            try { return fs.readFileSync(p, 'utf8') } catch { return '' }
        }

        let passwordActive = false
        try {
            if (fs.existsSync(GRUB_D_DIR)) {
                for (const f of fs.readdirSync(GRUB_D_DIR)) {
                    const p = path.join(GRUB_D_DIR, f)
                    try {
                        const st = fs.statSync(p)
                        if (!st.isFile()) continue
                    } catch { continue }
                    if (hasGrubPasswordMarkers(safeReadText(p))) { passwordActive = true; break }
                }
            }
        } catch { /* ignore */ }
        if (!passwordActive && fs.existsSync(GRUB_CFG)) {
            if (hasGrubPasswordMarkers(safeReadText(GRUB_CFG))) passwordActive = true
        }

        let unrestrictedConfigured = false
        try {
            const content = fs.readFileSync(GRUB_10_LINUX, 'utf8')
            unrestrictedConfigured = content.includes('--unrestricted')
        } catch { /* grub not installed */ }

        const grubCfgExists = fs.existsSync(GRUB_CFG)
        const unrestrictedEffective = grubCfgExists
            ? safeReadText(GRUB_CFG).includes('--unrestricted')
            : unrestrictedConfigured

        const unrestricted = passwordActive ? unrestrictedEffective : true
        return { passwordActive, unrestricted, unrestrictedConfigured, grubCfgExists }
    })

    ipcMain.handle('daemon:grubEnable', async (_, password) => {
        if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
        if (!password || typeof password !== 'string') return { ok: false, error: 'Kein Passwort angegeben.' }
        try { return await daemonRequest({ type: 'grub-enable', password }, 'grub-enable-result', 30_000) }
        catch (e) { return { ok: false, error: e.message } }
    })

    ipcMain.handle('daemon:grubDisable', async () => {
        if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
        try { return await daemonRequest({ type: 'grub-disable' }, 'grub-disable-result', 30_000) }
        catch (e) { return { ok: false, error: e.message } }
    })

    ipcMain.handle('daemon:setupDnsmasq', async () => {
        if (!isDaemonConnected()) return { ok: false, error: 'Daemon nicht verbunden.' }
        try { return await daemonRequest({ type: 'setup-dnsmasq' }, 'setup-dnsmasq-result', 30_000) }
        catch (e) { return { ok: false, error: e.message } }
    })

    // Control and install the parental-control systemd service
    ipcMain.handle('daemon:serviceControl', async (_, { action } = {}) => {
        console.log(`[LiFE serviceControl] action=${action}`)
        const allowed = ['start', 'stop', 'restart', 'enable', 'disable', 'status', 'install']
        if (!allowed.includes(action)) return { error: 'Ungültige Aktion.' }

        // install: requires root — delegate to pkexec install script
        if (action === 'install') {
            const resBase = app.isPackaged ? process.resourcesPath : app.getAppPath()
            const installScriptSrc = app.isPackaged
                ? path.join(resBase, 'life-parental-install.sh')
                : path.join(app.getAppPath(), 'packaging', 'life-parental-install.sh')
            console.log(`[LiFE serviceControl/install] resBase=${resBase}`)
            console.log(`[LiFE serviceControl/install] scriptSrc=${installScriptSrc} exists=${fs.existsSync(installScriptSrc)}`)

            if (!fs.existsSync(installScriptSrc)) {
                console.error(`[LiFE serviceControl/install] install script not found: ${installScriptSrc}`)
                return { error: `Install-Script nicht gefunden: ${installScriptSrc}` }
            }

            // AppImage FUSE mounts (/tmp/.mount_*) are not accessible by root (squashfuse mounts without allow_root).
            // Script is staged to /tmp/ (user-writable) — polkit rule matches by script name, not path.
            const tmpScript = '/tmp/life-parental-install'
            const tmpResBase = '/tmp/life-parental-res'
            try {
                // Copy install script
                fs.copyFileSync(installScriptSrc, tmpScript)
                fs.chmodSync(tmpScript, 0o755)

                // Copy daemon JS files (required)
                const daemonSrc = path.join(resBase, 'daemon')
                const daemonDst = path.join(tmpResBase, 'daemon')
                fs.mkdirSync(daemonDst, { recursive: true })
                for (const f of fs.readdirSync(daemonSrc).filter(f => f.endsWith('.js'))) {
                    fs.copyFileSync(path.join(daemonSrc, f), path.join(daemonDst, f))
                }

                // Copy systemd service file (required)
                // packaged: resBase/systemd/  dev: resBase/packaging/systemd/
                const systemdSrc = fs.existsSync(path.join(resBase, 'systemd', 'parental-control.service'))
                    ? path.join(resBase, 'systemd', 'parental-control.service')
                    : path.join(resBase, 'packaging', 'systemd', 'parental-control.service')
                fs.mkdirSync(path.join(tmpResBase, 'systemd'), { recursive: true })
                fs.copyFileSync(systemdSrc, path.join(tmpResBase, 'systemd', 'parental-control.service'))

                // Copy polkit rules (best-effort)
                // packaged: resBase/polkit/  dev: resBase/packaging/polkit/
                const polkitSrc = fs.existsSync(path.join(resBase, 'polkit', '50-org.tuxfamily.life-parental-control.rules'))
                    ? path.join(resBase, 'polkit', '50-org.tuxfamily.life-parental-control.rules')
                    : path.join(resBase, 'packaging', 'polkit', '50-org.tuxfamily.life-parental-control.rules')
                if (fs.existsSync(polkitSrc)) {
                    fs.mkdirSync(path.join(tmpResBase, 'polkit'), { recursive: true })
                    fs.copyFileSync(polkitSrc, path.join(tmpResBase, 'polkit', '50-org.tuxfamily.life-parental-control.rules'))
                }

                // Copy lockdown script (best-effort)
                // packaged: resBase/life-parental-lockdown.sh  dev: resBase/packaging/life-parental-lockdown.sh
                const lockdownSrc = fs.existsSync(path.join(resBase, 'life-parental-lockdown.sh'))
                    ? path.join(resBase, 'life-parental-lockdown.sh')
                    : path.join(resBase, 'packaging', 'life-parental-lockdown.sh')
                if (fs.existsSync(lockdownSrc)) {
                    fs.mkdirSync(path.join(tmpResBase, 'packaging'), { recursive: true })
                    fs.copyFileSync(lockdownSrc, path.join(tmpResBase, 'packaging', 'life-parental-lockdown.sh'))
                }

                // Copy NM dispatcher script (best-effort)
                // packaged: resBase/99-life-parental-dns  dev: resBase/packaging/99-life-parental-dns
                const nmDispatcherSrc = fs.existsSync(path.join(resBase, '99-life-parental-dns'))
                    ? path.join(resBase, '99-life-parental-dns')
                    : path.join(resBase, 'packaging', '99-life-parental-dns')
                if (fs.existsSync(nmDispatcherSrc)) {
                    fs.mkdirSync(path.join(tmpResBase, 'packaging'), { recursive: true })
                    fs.copyFileSync(nmDispatcherSrc, path.join(tmpResBase, 'packaging', '99-life-parental-dns'))
                }

                // Copy app-monitor background excludes (required for correct catalog/usage filtering)
                // packaged: resBase/app-monitor-background-excludes.json  dev: resBase/packaging/app-monitor-background-excludes.json
                const excludesSrc = fs.existsSync(path.join(resBase, 'app-monitor-background-excludes.json'))
                    ? path.join(resBase, 'app-monitor-background-excludes.json')
                    : path.join(resBase, 'packaging', 'app-monitor-background-excludes.json')
                if (fs.existsSync(excludesSrc)) {
                    fs.copyFileSync(excludesSrc, path.join(tmpResBase, 'app-monitor-background-excludes.json'))
                } else {
                    console.warn(`[LiFE serviceControl/install] WARNING missing app-monitor-background-excludes.json at ${excludesSrc}`)
                }

                // Copy bundled HaGeZi feeds (best-effort)
                const hageziSrc = path.join(resBase, 'hagezi')
                if (fs.existsSync(hageziSrc)) {
                    const hageziDst = path.join(tmpResBase, 'hagezi')
                    fs.mkdirSync(hageziDst, { recursive: true })
                    for (const f of fs.readdirSync(hageziSrc).filter(f => f.endsWith('.txt'))) {
                        fs.copyFileSync(path.join(hageziSrc, f), path.join(hageziDst, f))
                    }
                }

                console.log(`[LiFE serviceControl/install] resources staged to ${tmpResBase}, spawning pkexec...`)
                console.log(`[LiFE serviceControl/pkexec-env] DBUS=${process.env.DBUS_SESSION_BUS_ADDRESS} DISPLAY=${process.env.DISPLAY} WAYLAND=${process.env.WAYLAND_DISPLAY} XDG_RUNTIME=${process.env.XDG_RUNTIME_DIR}`)
                const { stdout, stderr } = await execFileAsync('pkexec', [tmpScript, tmpResBase, app.getVersion()], { timeout: 120_000 })
                console.log(`[LiFE serviceControl/install] pkexec OK stdout=${stdout?.trim()} stderr=${stderr?.trim()}`)
                console.log('[LiFE serviceControl/install] waiting for daemon reconnect...')
                await waitForDaemonConnect(25_000)
                console.log(`[LiFE serviceControl/install] daemon connected=${isDaemonConnected()}`)
                return { ok: true }
            } catch (e) {
                console.error(`[LiFE serviceControl/install] pkexec FAILED code=${e.code} signal=${e.signal} stderr=${e.stderr?.trim()} message=${e.message}`)
                if (e.code === 126 || e.code === 127) return { error: 'Authentifizierung fehlgeschlagen oder abgebrochen.' }
                return { error: e.message }
            } finally {
                try { fs.unlinkSync(tmpScript) } catch { /* ignore */ }
                try { fs.rmSync(tmpResBase, { recursive: true, force: true }) } catch { /* ignore */ }
            }
        }

        // start/restart when daemon is not connected: daemon socket is gone, fall back to pkexec systemctl directly
        if ((action === 'start' || action === 'restart') && !isDaemonConnected()) {
            console.log(`[LiFE serviceControl] daemon not connected, using pkexec for action=${action}`)
            console.log(`[LiFE serviceControl/pkexec-env] DBUS=${process.env.DBUS_SESSION_BUS_ADDRESS} DISPLAY=${process.env.DISPLAY} WAYLAND=${process.env.WAYLAND_DISPLAY} XDG_RUNTIME=${process.env.XDG_RUNTIME_DIR}`)
            try {
                await execFileAsync('pkexec', ['systemctl', action, 'parental-control.service'], { timeout: 30_000 })
                console.log(`[LiFE serviceControl] pkexec systemctl ${action} OK`)
                return { ok: true }
            } catch (e) {
                console.error(`[LiFE serviceControl/pkexec-systemctl] FAILED code=${e.code} stderr=${e.stderr?.trim()} message=${e.message}`)
                if (e.code === 126 || e.code === 127) return { error: 'Authentifizierung fehlgeschlagen. Führe manuell aus: sudo systemctl start parental-control.service' }
                return { error: e.message }
            }
        }

        // All other actions routed through the running daemon (it has root)
        console.log(`[LiFE serviceControl] routing to daemon: action=${action}`)
        const result = await daemonServiceControl(action)
        console.log(`[LiFE serviceControl] daemon result: ok=${result.ok} error=${result.error ?? '-'}`)
        return result.ok ? { ok: true, ...(result.status != null ? { status: result.status } : {}) } : { error: result.error }
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
    if (RUN_STARTUP_HAGEZI_SYNC) {
        void runStartupHageziSync(appConfigDir)
    }
    // Register exec path with daemon on every (re)connect so warning windows can be spawned.
    // AppImage: use process.env.APPIMAGE (the actual .AppImage file) so the daemon can re-spawn
    // it correctly as the desktop user with APPIMAGE_EXTRACT_AND_RUN=1.
    daemonOn('connect', () => {
        daemonRegisterClient(process.env.APPIMAGE || app.getPath('exe'))
        ensureSchoolTimesPersistedOnDisk(appConfigDir)
    })
    daemonConnect()
}
