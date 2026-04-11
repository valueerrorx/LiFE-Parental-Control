// Logout-enforcement window: daemon-spawned --warning-mode child; session end is enforced by the daemon (terminate), not by this process alone.
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

function makeLogoutEnforcementHtml(payload) {
    const p = payload || {}
    const type = p.type || 'exhausted'
    const isAllowedHours = type === 'allowed-hours'
    const effectiveLimit = Number(p.effectiveLimit) || 0
    const usedMinutes = Number(p.usedMinutes) || 0
    const graceEndsAt = Number(p.graceEndsAt) > 0 ? Number(p.graceEndsAt) : (Date.now() + 60_000)

    let heading = 'Bildschirmzeit aufgebraucht'
    let info
    if (isAllowedHours) {
        heading = String(p.heading || 'Computer gesperrt')
        info = String(p.message || 'Die Computernutzung ist zu dieser Zeit nicht gestattet.')
    } else {
        info = `Das Tageslimit von <strong>${effectiveLimit}</strong> Min. ist erreicht (${usedMinutes} Min. genutzt).`
    }

    const icon = isAllowedHours ? '🔒' : '⏱'
    const countdownLine = isAllowedHours
        ? 'Abmeldung, sobald der Countdown 0 erreicht — außer du gibst unten das Elternpasswort ein, um die <strong>heutigen Nutzungszeiten</strong> freizuschalten.'
        : 'Abmeldung, sobald der Countdown 0 erreicht — außer du gibst unten das Elternpasswort ein und wählst <strong>Bonus-Bildschirmzeit</strong> (Abmeldung verhindern). Ohne Passwort trennt das System die Sitzung; beim nächsten Login gibt es kurz „Luft“, damit du wieder dieses Fenster siehst.'

    const pwLabel = isAllowedHours
        ? 'Eltern-Passwort (heute erlaubte Zeiten aussetzen)'
        : 'Eltern-Passwort (Bonus-Bildschirmzeit)'

    const bonusSelect = isAllowedHours ? '' : `
<label>Bonus hinzufügen</label>
<select id="mins" class="sel" style="max-width:220px;">
  <option value="10">+10 Min.</option>
  <option value="15">+15 Min.</option>
  <option value="20">+20 Min.</option>
  <option value="25">+25 Min.</option>
  <option value="30" selected>+30 Min.</option>
  <option value="40">+40 Min.</option>
  <option value="50">+50 Min.</option>
  <option value="60">+60 Min.</option>
</select>`

    const typeJson = JSON.stringify(type)

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control — Sitzungsende</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<div class="icon">${icon}</div>
<h1>${heading}</h1>
<p class="info">${info}</p>
<p class="info">${countdownLine}</p>
<p class="info">Verbleibend: <strong id="cd">0</strong> Sekunden</p>
<label>${pwLabel}</label>
<div class="row"><input type="password" id="pw" placeholder="Passwort" autocomplete="off"/></div>
${bonusSelect}
<div class="err" id="err"></div>
<button class="btn-block" id="btn">Passwort bestätigen</button>
</div>
<script>
const {ipcRenderer} = require('electron')
const graceEndsAt = ${graceEndsAt}
const enforcementType = ${typeJson}
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
pw.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit() })
btn.addEventListener('click', doSubmit)
pw.focus()

async function doSubmit() {
  const password = pw.value
  if (!password) { err.textContent = 'Bitte Passwort eingeben.'; return }
  btn.disabled = true; btn.textContent = '…'; err.textContent = ''
  try {
    let r
    if (enforcementType === 'allowed-hours') {
      r = await ipcRenderer.invoke('lockscreen:allowed-hours-bypass', { password })
    } else {
      const sel = document.getElementById('mins')
      const minutes = sel ? (+sel.value || 30) : 30
      r = await ipcRenderer.invoke('lockscreen:grantBonusMinutes', { password, minutes })
    }
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

// Daemon-spawned UI: exhausted ends session after grace unless parent grants bonus; allowed-hours ends session after grace unless bypass for today.
export async function runLockscreen(payload) {
    const daemonSocket = await connectToDaemon()

    ipcMain.handle('lockscreen:allowed-hours-bypass', async (_, { password } = {}) => {
        if (!daemonSocket) return { error: 'Daemon nicht verbunden.' }
        const result = await daemonRequest(daemonSocket, { type: 'allowed-hours-bypass', password }, 'allowed-hours-bypass-result')
        if (result.ok !== true) return { error: result.error || 'Falsches Passwort.' }
        return { ok: true }
    })

    ipcMain.handle('lockscreen:grantBonusMinutes', async (_, { password, minutes } = {}) => {
        if (!daemonSocket) return { error: 'Daemon nicht verbunden.' }
        const m = Math.min(180, Math.max(5, Math.floor(Number(minutes) || 30)))
        const result = await daemonRequest(daemonSocket, { type: 'extend', password, minutes: m }, 'extend-result')
        if (result.ok !== true) return { error: result.error || 'Falsches Passwort.' }
        return { ok: true }
    })

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
        title: 'LiFE Parental Control — Sitzungsende',
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

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(makeLogoutEnforcementHtml(payload ?? {})))
    win.once('ready-to-show', () => { try { win.center() } catch { /* ignore */ } })
    app.on('window-all-closed', () => { /* keep running until lockscreen:quit */ })
}
