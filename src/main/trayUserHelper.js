// Root main spawns Electron with desktop uid/gid; tray events are forwarded over 127.0.0.1 with a token.
import crypto from 'crypto'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { execFileSync, spawn } from 'child_process'
import { app } from 'electron'
import { getAppImagePathIfAny } from './appImageResolve.js'

function passwdRow(uidS) {
    try {
        const line = execFileSync('getent', ['passwd', uidS], { encoding: 'utf8' }).trim()
        const p = line.split(':')
        if (p.length < 6) return null
        return { gid: p[3], home: p[5] }
    } catch {
        return null
    }
}

export function startUserTrayHelper(opts) {
    const { uidS, trayIconPath, mainDir, electronExec, onShow, onQuitFromTray } = opts
    const row = passwdRow(uidS)
    if (!row) {
        console.warn('[LiFE Parental Control] Tray helper: getent passwd failed for', uidS)
        return Promise.resolve(null)
    }
    const uid = Number(uidS)
    const gid = Number(row.gid)
    if (!Number.isFinite(uid) || !Number.isFinite(gid)) return Promise.resolve(null)
    const helperPath = path.join(mainDir, 'trayHelperMain.js')
    if (!fs.existsSync(helperPath)) {
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
            console.error('[LiFE Parental Control] Tray helper server:', err.message)
            res(null)
        })
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address()
            const port = typeof addr === 'object' && addr ? addr.port : null
            if (!Number.isFinite(port)) {
                try { server.close() } catch { /* */ }
                res(null)
                return
            }
            // Desktop uid cannot execute paths inside the AppImage FUSE mount; run the on-disk .AppImage with a /tmp script + icon copy.
            let spawnExec = electronExec
            let spawnArgs = [helperPath]
            let effectiveIconPath = trayIconPath
            const tmpCleanup = []
            // Dev: never use APPIMAGE from the shell — would spawn the wrong Electron instead of electron-vite’s binary.
            const resolvedAppImage = app.isPackaged ? getAppImagePathIfAny() : ''
            if (resolvedAppImage) {
                try {
                    const tmpJ = path.join(os.tmpdir(), `life-parental-tray-${uidS}.js`)
                    const tmpPng = path.join(os.tmpdir(), `life-parental-tray-icon-${uidS}.png`)
                    fs.copyFileSync(helperPath, tmpJ)
                    fs.chmodSync(tmpJ, 0o644)
                    tmpCleanup.push(tmpJ)
                    if (trayIconPath && fs.existsSync(trayIconPath)) {
                        fs.copyFileSync(trayIconPath, tmpPng)
                        fs.chmodSync(tmpPng, 0o644)
                        tmpCleanup.push(tmpPng)
                        effectiveIconPath = tmpPng
                    }
                    spawnExec = resolvedAppImage
                    // Match pkexec relaunch: extract avoids FUSE permission issues for the dropped-privilege child.
                    spawnArgs = ['--appimage-extract-and-run', '--no-sandbox', tmpJ]
                } catch (e) {
                    console.warn('[LiFE Parental Control] Tray helper: AppImage shim failed, falling back to execPath', e.message)
                }
            }
            const childEnv = {
                ...process.env,
                LIFE_TRAY_ICON_PATH: effectiveIconPath,
                LIFE_TRAY_PORT: String(port),
                LIFE_TRAY_TOKEN: token,
                DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uidS}/bus`,
                XDG_RUNTIME_DIR: `/run/user/${uidS}`,
                HOME: row.home || process.env.HOME
            }
            if (spawnExec === resolvedAppImage) {
                childEnv.APPIMAGE = resolvedAppImage
                childEnv.APPIMAGE_EXTRACT_AND_RUN = '1'
            }
            const xa = path.join(row.home || '', '.Xauthority')
            try {
                if (fs.existsSync(xa)) childEnv.XAUTHORITY = xa
            } catch { /* */ }
            const passKeys = ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'QT_QPA_PLATFORM']
            for (const k of passKeys) {
                if (!childEnv[k] && process.env[k]) childEnv[k] = process.env[k]
            }
            // Let Electron auto-detect X11 vs Wayland so SNI tray registers on the correct backend
            if (childEnv.WAYLAND_DISPLAY) childEnv.ELECTRON_OZONE_PLATFORM_HINT = 'auto'
            let child
            try {
                child = spawn(spawnExec, spawnArgs, {
                    env: childEnv,
                    uid,
                    gid,
                    detached: true,
                    stdio: 'ignore'
                })
            } catch (err) {
                console.error('[LiFE Parental Control] Tray helper spawn:', err.message)
                try { server.close() } catch { /* */ }
                res(null)
                return
            }
            child.unref()
            child.on('exit', (code, signal) => {
                if (code !== 0 && code !== null) {
                    console.error('[LiFE Parental Control] Tray helper exited', { code, signal })
                }
            })
            child.on('error', err => {
                console.error('[LiFE Parental Control] Tray helper process:', err.message)
                try { server.close() } catch { /* */ }
                res(null)
            })
            console.warn('[LiFE Parental Control] Tray: desktop-user helper (uid=' + uidS + ') appimage=' + Boolean(resolvedAppImage))
            res({
                stop() {
                    try {
                        if (child && !child.killed) child.kill('SIGTERM')
                    } catch { /* */ }
                    for (const p of tmpCleanup) {
                        try {
                            fs.unlinkSync(p)
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
