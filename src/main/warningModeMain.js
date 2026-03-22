// Handles the Electron app running in --warning-mode (spawned by daemon as the desktop user).
// Enforcement events (exhausted, allowed-hours) show a fullscreen lockscreen with no dismiss.
// Soft warnings (low, app-low, …) show the regular bonus-time dialog.
import { ipcMain, app } from 'electron'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import { initWarningWindow, showWarningWindow } from './warningWindow.js'
import { runLockscreen } from './lockscreenWindow.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOCKET_PATH = '/run/next-exam.sock'
const REQUEST_TIMEOUT_MS = 8_000

// Enforcement types that require the fullscreen lockscreen (no dismiss button)
const ENFORCEMENT_TYPES = new Set(['exhausted', 'allowed-hours'])

function connectToDaemon() {
    return new Promise((resolve) => {
        const s = net.createConnection(SOCKET_PATH)
        s.once('connect', () => resolve(s))
        s.once('error', () => resolve(null))
        setTimeout(() => resolve(null), 3000)
    })
}

function daemonRequest(socket, cmd, replyType) {
    return new Promise((resolve) => {
        if (!socket) { resolve({ error: 'Daemon nicht verbunden.' }); return }
        let buf = ''
        let timer = null

        const onData = (chunk) => {
            buf += chunk.toString()
            let nl
            while ((nl = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, nl).trim()
                buf = buf.slice(nl + 1)
                try {
                    const msg = JSON.parse(line)
                    if (msg && msg.type === replyType) {
                        clearTimeout(timer)
                        socket.removeListener('data', onData)
                        resolve(msg)
                    }
                } catch { /* ignore bad JSON */ }
            }
        }

        timer = setTimeout(() => {
            socket.removeListener('data', onData)
            resolve({ error: 'Daemon antwortet nicht. Bitte erneut versuchen.' })
        }, REQUEST_TIMEOUT_MS)

        socket.on('data', onData)
        try { socket.write(JSON.stringify(cmd) + '\n') }
        catch { clearTimeout(timer); socket.removeListener('data', onData); resolve({ error: 'Sendefehler.' }) }
    })
}

/**
 * Entry point for --warning-mode.
 * @param {object} payload  Warning payload (type, appId, appName, effectiveLimit, …)
 */
export async function runWarningMode(payload) {
    const type = payload?.type || ''

    // Enforcement events → fullscreen lockscreen (no dismiss possible)
    if (ENFORCEMENT_TYPES.has(type)) {
        await runLockscreen(payload)
        return
    }

    // Soft warnings (low, app-low, app-five, app-final, app-exhausted) → standard bonus dialog
    const daemonSocket = await connectToDaemon()

    ipcMain.handle('schedules:grantBonusMinutes', async (_, { password, minutes } = {}) => {
        const result = await daemonRequest(daemonSocket, { type: 'extend', password, minutes }, 'extend-result')
        if (result.ok) return { ok: true, granted: minutes }
        return { error: result.error || 'Unbekannter Fehler.' }
    })

    ipcMain.handle('quota:grantAppBonus', async (_, { password, minutes, appId, linuxUser } = {}) => {
        const result = await daemonRequest(daemonSocket, { type: 'extend-app', password, minutes, appId, linuxUser }, 'extend-app-result')
        if (result.ok) return { ok: true, granted: minutes }
        return { error: result.error || 'Unbekannter Fehler.' }
    })

    const imagesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'images')
        : path.join(__dirname, '../../images')

    initWarningWindow(imagesDir)
    showWarningWindow(payload)

    // Quit when the soft-warning dialog is closed
    app.on('window-all-closed', () => app.quit())
}
