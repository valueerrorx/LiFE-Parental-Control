import { BrowserWindow } from 'electron'
import { resolveWindowIconPath } from './trayIcon.js'

let _imagesDir = null
let warningWin = null

export function initWarningWindow(imagesDir) {
    _imagesDir = imagesDir
}

function makeHtml({ type, remaining, effectiveLimit, usedMinutes }) {
    const isExhausted = type === 'exhausted'
    const heading = isExhausted ? 'Screen time limit reached' : 'Screen time running low'
    const info = isExhausted
        ? `Today&#39;s limit of <b>${effectiveLimit}</b> min is used up (${usedMinutes} min logged).`
        : `About <b>${remaining}</b> min left today (${usedMinutes} of ${effectiveLimit} used).`
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;font-size:14px;background:#fff;color:#212529;padding:18px 20px}
h2{font-size:15px;font-weight:600;margin-bottom:8px;color:#c62828}
p{color:#555;font-size:13px;line-height:1.5;margin-bottom:10px}
label{display:block;font-size:11px;font-weight:600;color:#616161;margin:10px 0 3px}
input,select{width:100%;padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;outline:none}
input:focus,select:focus{border-color:#1976d2}
.row{display:flex;gap:8px}.sel{flex:0 0 110px}
.btns{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
button{padding:7px 18px;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500}
.primary{background:#1976d2;color:#fff}.primary:hover{background:#1565c0}
.primary:disabled{background:#90caf9;cursor:default}
.outline{background:#f5f5f5;color:#333}.outline:hover{background:#e0e0e0}
.err{color:#c62828;font-size:12px;margin-top:6px;min-height:16px}
</style></head><body>
<h2>${heading}</h2>
<p>${info} Enter the parent password to add bonus time.</p>
<label>Parent password</label>
<div class="row">
  <input type="password" id="pw" autocomplete="off" placeholder="Password"/>
  <select id="mins" class="sel">
    <option value="5">+5 min</option>
    <option value="15">+15 min</option>
    <option value="30" selected>+30 min</option>
    <option value="60">+60 min</option>
  </select>
</div>
<p id="err" class="err"></p>
<div class="btns">
  <button class="outline" id="dismiss">Not now</button>
  <button class="primary" id="grant">Add time</button>
</div>
<script>
const {ipcRenderer} = require('electron')
const pw = document.getElementById('pw')
const mins = document.getElementById('mins')
const err = document.getElementById('err')
const grantBtn = document.getElementById('grant')
document.getElementById('dismiss').onclick = () => window.close()
pw.addEventListener('keydown', e => { if (e.key === 'Enter') doGrant() })
grantBtn.onclick = doGrant
async function doGrant() {
  err.textContent = ''
  grantBtn.disabled = true
  grantBtn.textContent = '…'
  const r = await ipcRenderer.invoke('schedules:grantBonusMinutes', { password: pw.value, minutes: +mins.value })
  if (r && r.error) {
    err.textContent = r.error
    grantBtn.disabled = false
    grantBtn.textContent = 'Add time'
    return
  }
  window.close()
}
pw.focus()
</script></body></html>`
}

// Shows (or focuses) the always-on-top warning window with a bonus-time form.
export function showWarningWindow(payload) {
    if (warningWin && !warningWin.isDestroyed()) {
        warningWin.show()
        warningWin.focus()
        return
    }
    const iconPath = _imagesDir ? resolveWindowIconPath(_imagesDir) : undefined
    warningWin = new BrowserWindow({
        width: 430,
        height: 280,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        title: 'LiFE Parental Control',
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    warningWin.removeMenu()
    // Use screen-saver level so the window appears above lock screens too
    try { warningWin.setAlwaysOnTop(true, 'screen-saver') } catch { warningWin.setAlwaysOnTop(true) }
    try { warningWin.setVisibleOnAllWorkspaces(true) } catch { /* ignore */ }
    warningWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(makeHtml(payload ?? {})))
    warningWin.on('closed', () => { warningWin = null })
}
