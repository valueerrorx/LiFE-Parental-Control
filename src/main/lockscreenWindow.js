// Enforcement overlay spawned by the daemon when no Electron client is connected (warning-mode).
// exhausted: final notice only (countdown, no password). allowed-hours: parent password to unlock.
import { BrowserWindow, app, ipcMain } from 'electron'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveWindowIconPath } from './windowIcon.js'
import { WARNING_PANEL_CSS } from './warningPanelTheme.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOCKET_PATH = '/run/parental-control.sock'
const REQUEST_TIMEOUT_MS = 8_000

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

function makeLockscreenHtml(payload) {
    const p = payload || {}
    const type = p.type || 'exhausted'
    const isAllowedHours = type === 'allowed-hours'
    const isExhausted = type === 'exhausted'
    const effectiveLimit = Number(p.effectiveLimit) || 0
    const usedMinutes = Number(p.usedMinutes) || 0

    let heading = 'Bildschirmzeit aufgebraucht'
    let info
    if (isAllowedHours) {
        heading = String(p.heading || 'Computer gesperrt')
        info = String(p.message || 'Die Computernutzung ist zu dieser Zeit nicht gestattet.')
    } else {
        info = `Das Tageslimit von <strong>${effectiveLimit}</strong> Min. ist erreicht (${usedMinutes} Min. genutzt).`
    }

    // Final screen-time exhaustion: no password — session ends shortly (daemon enforces shutdown).
    if (isExhausted) {
        return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control - Lockscreen</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<div class="icon">⏱</div>
<h1>${heading}</h1>
<p class="info">${info}</p>
<p class="info">Die Sitzung wird in <strong id="cd">15</strong> Sekunden beendet.</p>
<button class="btn-block" id="btn">OK</button>
</div>
<script>
const {ipcRenderer} = require('electron')
const btn = document.getElementById('btn')
let s = 15
const cd = document.getElementById('cd')
function done() { ipcRenderer.invoke('lockscreen:quit') }
btn.addEventListener('click', () => done())
setInterval(() => {
  s--;
  if (cd) cd.textContent = s
  if (s <= 0) done()
}, 1000)
</script></body></html>`
    }

    // allowed-hours: countdown then logout unless parent grants calendar-day bypass via password.
    const graceEndsAt = Number(p.graceEndsAt) > 0 ? Number(p.graceEndsAt) : (Date.now() + 60_000)
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control - Lockscreen</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<div class="icon">🔒</div>
<h1>${heading}</h1>
<p class="info">${info}</p>
<p class="info">Ausloggen in <strong id="cd">60</strong> Sekunden, sofern kein Elternpasswort eingegeben wird.</p>
<label>Eltern-Passwort (heute erlaubte Zeiten aussetzen)</label>
<div class="row"><input type="password" id="pw" placeholder="Passwort" autocomplete="off"/></div>
<div class="err" id="err"></div>
<button class="btn-block" id="btn">Passwort bestätigen</button>
</div>
<script>
const {ipcRenderer} = require('electron')
const graceEndsAt = ${graceEndsAt}
const pw = document.getElementById('pw')
const btn = document.getElementById('btn')
const err = document.getElementById('err')
const cd = document.getElementById('cd')
function tickCd() {
  const s = Math.max(0, Math.ceil((graceEndsAt - Date.now()) / 1000))
  if (cd) cd.textContent = s
}
setInterval(tickCd, 500)
tickCd()
pw.addEventListener('keydown', e => { if (e.key === 'Enter') doBypass() })
btn.addEventListener('click', doBypass)
pw.focus()

async function doBypass() {
  const password = pw.value
  if (!password) { err.textContent = 'Bitte Passwort eingeben.'; return }
  btn.disabled = true; btn.textContent = '…'; err.textContent = ''
  try {
    const r = await ipcRenderer.invoke('lockscreen:allowed-hours-bypass', { password })
    if (r && r.ok) {
      btn.textContent = '✓ Gespeichert'
      setTimeout(() => ipcRenderer.invoke('lockscreen:quit'), 500)
    } else {
      err.textContent = (r && r.error) || 'Falsches Passwort.'
      btn.disabled = false
      btn.textContent = 'Passwort bestätigen'
      pw.value = ''; pw.focus()
    }
  } catch(e) {
    err.textContent = 'Verbindungsfehler: ' + e.message
    btn.disabled = false
    btn.textContent = 'Passwort bestätigen'
  }
}
</script></body></html>`
}

export async function runLockscreen(payload) {
    const type = payload?.type || 'exhausted'
    const isAllowedHours = type === 'allowed-hours'
    let daemonSocket = null
    if (isAllowedHours) {
        daemonSocket = await connectToDaemon()
    }

    if (isAllowedHours) {
        ipcMain.handle('lockscreen:allowed-hours-bypass', async (_, { password } = {}) => {
            const result = await daemonRequest(daemonSocket, { type: 'allowed-hours-bypass', password }, 'allowed-hours-bypass-result')
            if (result.ok !== true) return { error: result.error || 'Falsches Passwort.' }
            return { ok: true }
        })
    }

    ipcMain.handle('lockscreen:quit', () => { app.quit() })

    const imagesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'images')
        : path.join(__dirname, '../../images')
    const iconPath = resolveWindowIconPath(imagesDir)

    const win = new BrowserWindow({
        width: 1560,
        height: 640,
        fullscreen: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        frame: true,
        resizable: true,
        movable: true,
        minimizable: false,
        closable: false,
        skipTaskbar: false,
        title: 'LiFE Parental Control - Lockscreen',
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            devTools: false
        }
    })
    win.removeMenu()

    try { win.setAlwaysOnTop(true, 'screen-saver') } catch { win.setAlwaysOnTop(true) }
    try { win.setVisibleOnAllWorkspaces(true) } catch { /* ignore */ }

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(makeLockscreenHtml(payload ?? {})))
    win.once('ready-to-show', () => { try { win.center() } catch { /* ignore */ } })
    app.on('window-all-closed', () => { /* keep running until lockscreen:quit */ })
}
