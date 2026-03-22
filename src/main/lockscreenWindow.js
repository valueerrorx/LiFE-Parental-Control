// Fullscreen enforcement overlay spawned by the daemon when no Electron client is connected.
// Validates the parent password directly against the daemon socket; no dismiss without password.
import { BrowserWindow, app, ipcMain } from 'electron'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveWindowIconPath } from './trayIcon.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SOCKET_PATH = '/run/next-exam.sock'
const REQUEST_TIMEOUT_MS = 8_000

function connectToDaemon() {
    return new Promise((resolve) => {
        const s = net.createConnection(SOCKET_PATH)
        s.once('connect', () => resolve(s))
        s.once('error', () => resolve(null))
        setTimeout(() => resolve(null), 3000)
    })
}

// Send a command and wait for a specific reply type from the daemon socket
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
    const effectiveLimit = Number(p.effectiveLimit) || 0
    const usedMinutes = Number(p.usedMinutes) || 0

    let heading = 'Bildschirmzeit aufgebraucht'
    let info
    if (isAllowedHours) {
        heading = String(p.heading || 'Computer jetzt nicht erlaubt')
        info = String(p.message || 'Die Computernutzung ist zu dieser Zeit nicht gestattet.')
    } else {
        info = `Das Tageslimit von <strong>${effectiveLimit}</strong> Min. ist erreicht (${usedMinutes} Min. genutzt).`
    }

    // Inline grant section only for time-exhausted (not for allowed-hours scheduling)
    const showGrantSection = !isAllowedHours

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE – Zeitsperre</title><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100vw;height:100vh;overflow:hidden;background:rgba(12,16,35,0.98);
  font-family:system-ui,sans-serif;color:#fff;display:flex;align-items:center;justify-content:center}
.card{background:#151c30;border:1px solid #1e2d50;border-radius:18px;padding:52px 60px;
  max-width:500px;width:90%;text-align:center;box-shadow:0 12px 60px rgba(0,0,0,0.7)}
.icon{font-size:72px;margin-bottom:22px;user-select:none}
h1{font-size:22px;font-weight:700;margin-bottom:14px;color:#ff6b6b}
.info{color:#94a3b8;font-size:14px;line-height:1.7;margin-bottom:30px}
.divider{border:none;border-top:1px solid #1e2d50;margin:24px 0}
label{display:block;text-align:left;font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px}
.row{display:flex;gap:8px;align-items:center;margin-bottom:4px}
input[type=password]{flex:1;padding:12px 16px;background:#0c1020;border:1.5px solid #1e2d50;
  border-radius:8px;color:#fff;font-size:16px;outline:none;transition:border-color .2s}
input[type=password]:focus{border-color:#3b82f6}
select{padding:12px 10px;background:#0c1020;border:1.5px solid #1e2d50;border-radius:8px;
  color:#fff;font-size:14px;outline:none}
button{width:100%;padding:14px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;
  font-size:15px;font-weight:600;cursor:pointer;margin-top:14px;transition:background .2s}
button:hover{background:#1e40af}
button:disabled{background:#1e2d50;color:#475569;cursor:default}
.err{color:#f87171;font-size:13px;min-height:18px;margin-top:6px;text-align:left}
.ok{color:#4ade80;font-size:13px;min-height:18px;margin-top:6px}
</style></head>
<body><div class="card">
<div class="icon">🔒</div>
<h1>${heading}</h1>
<p class="info">${info}<br><br>Eltern-Passwort eingeben, um den Computer zu entsperren.</p>
${showGrantSection ? '<hr class="divider"><label>Zeitverlängerung</label><div class="row"><input type="password" id="pw" placeholder="Eltern-Passwort" autocomplete="off"/><select id="mins"><option value="15">+15 Min.</option><option value="30" selected>+30 Min.</option><option value="60">+60 Min.</option></select></div>' : '<label>Eltern-Passwort</label><div class="row"><input type="password" id="pw" placeholder="Passwort" autocomplete="off"/></div>'}
<div class="err" id="err"></div>
<button id="btn">${showGrantSection ? 'Zeit verlängern &amp; entsperren' : 'Entsperren'}</button>
</div>
<script>
const {ipcRenderer} = require('electron')
const SHOW_GRANT = ${showGrantSection ? 'true' : 'false'}
const pw = document.getElementById('pw')
const btn = document.getElementById('btn')
const err = document.getElementById('err')
const minsEl = document.getElementById('mins')
pw.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock() })
btn.addEventListener('click', doUnlock)
pw.focus()

async function doUnlock() {
  const password = pw.value
  if (!password) { err.textContent = 'Bitte Passwort eingeben.'; return }
  btn.disabled = true; btn.textContent = '…'; err.textContent = ''
  const minutes = minsEl ? Number(minsEl.value) : 0
  try {
    // Validate password via daemon; on success optionally also grant time
    const r = await ipcRenderer.invoke('lockscreen:unlock', { password, minutes, showGrant: SHOW_GRANT })
    if (r && r.ok) {
      btn.textContent = '✓ Entsperrt'
      setTimeout(() => ipcRenderer.invoke('lockscreen:quit'), 500)
    } else {
      err.textContent = (r && r.error) || 'Falsches Passwort.'
      btn.disabled = false
      btn.textContent = ${showGrantSection ? "'Zeit verlängern &amp; entsperren'" : "'Entsperren'"}
      pw.value = ''; pw.focus()
    }
  } catch(e) {
    err.textContent = 'Verbindungsfehler: ' + e.message
    btn.disabled = false
    btn.textContent = ${showGrantSection ? "'Zeit verlängern &amp; entsperren'" : "'Entsperren'"}
  }
}
</script></body></html>`
}

export async function runLockscreen(payload) {
    const daemonSocket = await connectToDaemon()

    // Register IPC handlers used by the lockscreen renderer
    ipcMain.handle('lockscreen:unlock', async (_, { password, minutes, showGrant } = {}) => {
        if (showGrant && minutes > 0) {
            // Validate + grant extra time in one step via daemon extend command
            const result = await daemonRequest(daemonSocket, { type: 'extend', password, minutes }, 'extend-result')
            if (!result.ok) return { error: result.error || 'Falsches Passwort.' }
            return { ok: true }
        }
        // Validate only (allowed-hours case: just check the password)
        const result = await daemonRequest(daemonSocket, { type: 'validate-password', password }, 'validate-password-result')
        if (!result.ok) return { error: result.error || 'Falsches Passwort.' }
        return { ok: true }
    })

    ipcMain.handle('lockscreen:quit', () => { app.quit() })

    const imagesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'images')
        : path.join(__dirname, '../../images')
    const iconPath = resolveWindowIconPath(imagesDir)

    const win = new BrowserWindow({
        fullscreen: true,
        alwaysOnTop: true,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        // closable: false prevents alt-F4; window can only be closed programmatically
        closable: false,
        skipTaskbar: true,
        title: 'LiFE Parental Control',
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            devTools: false
        }
    })

    try { win.setAlwaysOnTop(true, 'screen-saver') } catch { win.setAlwaysOnTop(true) }
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) } catch { /* ignore */ }

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(makeLockscreenHtml(payload ?? {})))
    app.on('window-all-closed', () => { /* keep running until lockscreen:quit */ })
}
