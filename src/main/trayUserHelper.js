// Root main spawns Electron with desktop uid/gid; tray events are forwarded over 127.0.0.1 with a token.
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { execFileSync, spawn } from 'child_process'
import { app } from 'electron'
import { getAppImagePathIfAny } from './appImageResolve.js'
import { readDesktopSessionEnvForUid } from './desktopSessionEnviron.js'
import { trayDebugLog } from './trayDebugLog.js'

function passwdRow(uidOrName) {
    try {
        const line = execFileSync('getent', ['passwd', uidOrName], { encoding: 'utf8' }).trim()
        const p = line.split(':')
        if (p.length < 7) return null
        return { uid: p[2], gid: p[3], home: p[5] }
    } catch {
        return null
    }
}

export function startUserTrayHelper(opts) {
    const { uidS, trayIconPath, mainDir, electronExec, onShow, onQuitFromTray } = opts
    trayDebugLog('helper', 'startUserTrayHelper enter', { uidS, trayIconPath, mainDir, electronExec })
    const row = passwdRow(uidS)
    if (!row) {
        trayDebugLog('helper', 'getent passwd failed', { uidS })
        console.warn('[LiFE Parental Control] Tray helper: getent passwd failed for', uidS)
        return Promise.resolve(null)
    }
    const uid = Number(row.uid)
    const gid = Number(row.gid)
    if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
        trayDebugLog('helper', 'invalid uid/gid from passwd', { uid: row.uid, gid: row.gid })
        return Promise.resolve(null)
    }
    const uidStr = String(uid)
    trayDebugLog('helper', 'passwd ok', { uidStr, gid: row.gid, home: row.home })
    const helperPath = path.join(mainDir, 'trayHelperMain.js')
    if (!fs.existsSync(helperPath)) {
        trayDebugLog('helper', 'trayHelperMain.js missing', { helperPath })
        console.warn('[LiFE Parental Control] Tray helper: missing', helperPath)
        return Promise.resolve(null)
    }
    const token = crypto.randomBytes(16).toString('hex')
    return new Promise(res => {
        const server = net.createServer(sock => {
            let buf = ''
            sock.on('data', chunk => {
                buf += String(chunk)
                for (;;) {
                    const idx = buf.indexOf('\n')
                    if (idx === -1) break
                    const line = buf.slice(0, idx).trim()
                    buf = buf.slice(idx + 1)
                    const colon = line.indexOf(':')
                    if (colon === -1) continue
                    if (line.slice(0, colon) !== token) continue
                    const cmd = line.slice(colon + 1)
                    if (cmd === 'show') onShow()
                    if (cmd === 'quit') onQuitFromTray()
                }
            })
        })
        server.on('error', err => {
            trayDebugLog('helper', 'tcp server error', err.message)
            console.error('[LiFE Parental Control] Tray helper server:', err.message)
            res(null)
        })
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address()
            const port = typeof addr === 'object' && addr ? addr.port : null
            if (!Number.isFinite(port)) {
                trayDebugLog('helper', 'invalid listen port', { addr })
                try { server.close() } catch { /* */ }
                res(null)
                return
            }
            // AppImage ignores `-- script.js`; spawning it starts index.js → second non-root instance → pkexec loop. Use LIFE_TRAY_SPAWN=1 so index.js only loads trayHelperMain.js; exec on-disk *.AppImage, not the extract-dir binary (EACCES for uid).
            let spawnExec = electronExec
            let spawnArgs = [helperPath]
            let effectiveIconPath = trayIconPath
            const tmpCleanup = []
            const resolvedAppImage = app.isPackaged ? getAppImagePathIfAny() : ''
            if (resolvedAppImage) {
                try {
                    const tmpPng = path.join(os.tmpdir(), `life-parental-tray-icon-${uidStr}.png`)
                    if (trayIconPath && fs.existsSync(trayIconPath)) {
                        fs.copyFileSync(trayIconPath, tmpPng)
                        fs.chmodSync(tmpPng, 0o644)
                        tmpCleanup.push(tmpPng)
                        effectiveIconPath = tmpPng
                    }
                    if (fs.existsSync(resolvedAppImage)) {
                        spawnExec = resolvedAppImage
                    }
                    spawnArgs = ['--no-sandbox']
                    trayDebugLog('helper', 'AppImage tray spawn (LIFE_TRAY_SPAWN, icon copy only)', { tmpPng: effectiveIconPath })
                } catch (e) {
                    trayDebugLog('helper', 'AppImage shim copy failed', e?.message || String(e))
                    console.warn('[LiFE Parental Control] Tray helper: AppImage shim failed, falling back to execPath', e.message)
                }
            }
            trayDebugLog('helper', 'spawn plan', {
                resolvedAppImage: resolvedAppImage || '',
                spawnExec,
                spawnArgs,
                effectiveIconPath,
                helperPath
            })
            const childEnv = { ...process.env }
            Object.assign(childEnv, readDesktopSessionEnvForUid(uidS))
            childEnv.LIFE_TRAY_ICON_PATH = effectiveIconPath
            childEnv.LIFE_TRAY_PORT = String(port)
            childEnv.LIFE_TRAY_TOKEN = token
            childEnv.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${uidStr}/bus`
            childEnv.XDG_RUNTIME_DIR = `/run/user/${uidStr}`
            childEnv.HOME = row.home || process.env.HOME
            delete childEnv.APPIMAGE_EXTRACT_AND_RUN
            // Tray re-execs the same .AppImage; tell AppImageLauncher to skip the integrate dialog (ignored if not installed).
            if (resolvedAppImage && spawnExec === resolvedAppImage) {
                childEnv.APPIMAGE = resolvedAppImage
                childEnv.LIFE_TRAY_SPAWN = '1'
                childEnv.APPIMAGELAUNCHER_DISABLE = '1'
            } else {
                delete childEnv.APPIMAGE
                delete childEnv.LIFE_TRAY_SPAWN
            }
            const xa = path.join(row.home || '', '.Xauthority')
            try {
                if (fs.existsSync(xa)) childEnv.XAUTHORITY = xa
            } catch { /* */ }
            const passKeys = ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'QT_QPA_PLATFORM']
            for (const k of passKeys) {
                if (!childEnv[k] && process.env[k]) childEnv[k] = process.env[k]
            }
            if (process.platform === 'linux') {
                childEnv.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
                childEnv.GDK_BACKEND = 'x11'
            }
            trayDebugLog('helper', 'child env subset', {
                DISPLAY: childEnv.DISPLAY || '',
                WAYLAND_DISPLAY: childEnv.WAYLAND_DISPLAY || '',
                DBUS_SESSION_BUS_ADDRESS: childEnv.DBUS_SESSION_BUS_ADDRESS || '',
                XDG_RUNTIME_DIR: childEnv.XDG_RUNTIME_DIR || '',
                HOME: childEnv.HOME || '',
                APPIMAGE: childEnv.APPIMAGE ? '(set)' : '',
                APPIMAGE_EXTRACT_AND_RUN: childEnv.APPIMAGE_EXTRACT_AND_RUN || '',
                LIFE_TRAY_SPAWN: childEnv.LIFE_TRAY_SPAWN || '',
                ELECTRON_OZONE_PLATFORM_HINT: childEnv.ELECTRON_OZONE_PLATFORM_HINT || '',
                LIFE_TRAY_PORT: String(port),
                iconExists: Boolean(effectiveIconPath && fs.existsSync(effectiveIconPath))
            })
            let child
            let stderrBuf = ''
            try {
                child = spawn(spawnExec, spawnArgs, {
                    env: childEnv,
                    uid,
                    gid,
                    detached: true,
                    stdio: ['ignore', 'ignore', 'pipe']
                })
            } catch (err) {
                trayDebugLog('helper', 'spawn threw', err?.message || String(err))
                console.error('[LiFE Parental Control] Tray helper spawn:', err.message)
                try { server.close() } catch { /* */ }
                res(null)
                return
            }
            trayDebugLog('helper', 'spawned child', { pid: child.pid })
            if (child.stderr) {
                child.stderr.on('data', (d) => {
                    stderrBuf += String(d)
                    if (stderrBuf.length > 6000) stderrBuf = stderrBuf.slice(-6000)
                })
            }
            child.on('exit', (code, signal) => {
                trayDebugLog('helper', 'child exit', {
                    code,
                    signal: signal ?? '',
                    stderrTail: stderrBuf.slice(-800)
                })
                if (code !== 0 && code !== null) {
                    console.error('[LiFE Parental Control] Tray helper exited', { code, signal })
                    try {
                        fs.appendFileSync(
                            '/tmp/life-parental-tray-helper.log',
                            `${new Date().toISOString()} exit=${code} sig=${signal ?? ''} exec=${spawnExec} args=${JSON.stringify(spawnArgs)}\n${stderrBuf}\n---\n`
                        )
                    } catch { /* ignore */ }
                }
            })
            child.on('error', err => {
                trayDebugLog('helper', 'child error event', err?.message || String(err))
                console.error('[LiFE Parental Control] Tray helper process:', err.message)
                try { server.close() } catch { /* */ }
                res(null)
            })
            console.warn('[LiFE Parental Control] Tray: desktop-user helper (uid=' + uidStr + ') appimage=' + Boolean(resolvedAppImage))
            res({
                stop() {
                    const pid = child?.pid
                    try {
                        if (pid && process.platform === 'linux') {
                            try {
                                process.kill(-pid, 'SIGKILL')
                            } catch {
                                process.kill(pid, 'SIGKILL')
                            }
                        } else if (child && !child.killed) {
                            child.kill('SIGKILL')
                        }
                    } catch { /* */ }
                    for (const p of tmpCleanup) {
                        try {
                            fs.rmSync(p, { recursive: true, force: true })
                        } catch { /* */ }
                    }
                    try {
                        server.close()
                    } catch { /* */ }
                }
            })
        })
    })
}
