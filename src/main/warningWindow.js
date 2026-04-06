/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
import { BrowserWindow } from 'electron'
import { resolveWindowIconPath } from './windowIcon.js'
import { WARNING_PANEL_CSS } from './warningPanelTheme.js'

let _imagesDir = null
let warningWin = null

export function initWarningWindow(imagesDir) {
    _imagesDir = imagesDir
}

function escapeForInlineScriptJson(obj) {
    return JSON.stringify(obj ?? {}).replace(/</g, '\\u003c')
}

function makeHtml(payload) {
    const p = payload ?? {}
    const type = p.type || 'low'

    if (type === 'allowed-hours') {
        const msg = String(p.message || 'Die Computernutzung ist zu dieser Zeit nicht gestattet.')
        return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<div class="icon">🕐</div>
<h1>${String(p.heading || 'Computer jetzt nicht erlaubt')}</h1>
<p class="info">${msg}</p>
<button class="btn-block" id="dismiss">OK</button>
</div>
<script>
document.getElementById('dismiss').onclick = () => window.close()
</script></body></html>`
    }

    const isApp = String(type).startsWith('app-')
    const isExhausted = type === 'exhausted'
    const effectiveLimit = Number(p.effectiveLimit) || 0
    const usedMinutes = Number(p.usedMinutes) || 0
    const remaining = p.remaining != null ? Number(p.remaining) : Math.max(0, effectiveLimit - usedMinutes)

    // Global screen time exhausted: final notice only (main UI path when daemon did not spawn lockscreen).
    if (isExhausted) {
        const info = `Das Tageslimit von <strong>${effectiveLimit}</strong> Min. ist erreicht (${usedMinutes} Min. genutzt).`
        return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<div class="icon">⏱</div>
<h1>Bildschirmzeit aufgebraucht</h1>
<p class="info">${info}</p>
<p class="info">Die Sitzung wird in <strong id="cd">15</strong> Sekunden beendet.</p>
<button class="btn-block" id="ok">OK</button>
</div>
<script>
let s = 15
const cd = document.getElementById('cd')
const ok = document.getElementById('ok')
ok.onclick = () => window.close()
setInterval(() => { s--; if (cd) cd.textContent = s; if (s <= 0) window.close() }, 1000)
</script></body></html>`
    }

    let heading = 'Wenig Bildschirmzeit übrig'
    let info = `Noch etwa <strong>${remaining}</strong> Min. heute (${usedMinutes} von <strong>${effectiveLimit}</strong> Min. genutzt).`

    if (isApp) {
        const name = String(p.appName || 'Anwendung')
        if (type === 'app-exhausted') {
            heading = 'App-Zeit aufgebraucht'
            info = `Tageslimit für <strong>${name}</strong> ist erreicht (${usedMinutes} von ${effectiveLimit} Min.).`
        } else if (type === 'app-final') {
            heading = 'Letzte Minute'
            info = `<strong>${name}</strong>: letzte Minute, bevor die App für heute beendet wird. Bitte speichern.`
        } else if (type === 'app-low') {
            heading = 'Wenig App-Zeit'
            info = `<strong>${name}</strong>: nur noch etwa zwei Minuten erlaubte Zeit heute.`
        } else if (type === 'app-five') {
            heading = 'Wenig App-Zeit'
            info = `<strong>${name}</strong>: nur noch etwa fünf Minuten erlaubte Zeit heute.`
        }
    }

    const payloadJson = escapeForInlineScriptJson(p)
    const grantCall = isApp
        ? `ipcRenderer.invoke('quota:grantAppBonus', { password: pw.value, minutes: +mins.value, appId: payload.appId, linuxUser: payload.linuxUser || '' })`
        : `ipcRenderer.invoke('schedules:grantBonusMinutes', { password: pw.value, minutes: +mins.value })`

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<h2>${heading}</h2>
<p class="info">${info}<br><br>Elternkontroll-Passwort eingeben, um ${isApp ? 'Bonuszeit für diese App' : 'Bonuszeit für heute'} hinzuzufügen.</p>
<label>Elternkontroll-Passwort</label>
<div class="row">
  <div class="pw-wrap">
    <input type="password" id="pw" autocomplete="off" placeholder="Passwort"/>
    <button class="eye" id="eye" tabindex="-1" title="Passwort anzeigen">&#128065;</button>
  </div>
  <select id="mins" class="sel">
    <option value="10">+10 Min.</option>
    <option value="15">+15 Min.</option>
    <option value="20">+20 Min.</option>
    <option value="25">+25 Min.</option>
    <option value="30" selected>+30 Min.</option>
    <option value="40">+40 Min.</option>
    <option value="50">+50 Min.</option>
    <option value="60">+60 Min.</option>
  </select>
</div>
<p id="err" class="err"></p>
<div class="btn-row">
  <button class="btn-outline" id="dismiss">Später</button>
  <button id="grant">Zeit hinzufügen</button>
</div>
</div>
<script>
const {ipcRenderer} = require('electron')
const payload = ${payloadJson}
const pw = document.getElementById('pw')
const mins = document.getElementById('mins')
const err = document.getElementById('err')
const grantBtn = document.getElementById('grant')
document.getElementById('dismiss').onclick = () => window.close()
document.getElementById('eye').onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password' }
pw.addEventListener('keydown', e => { if (e.key === 'Enter') doGrant() })
grantBtn.onclick = doGrant
async function doGrant() {
  err.textContent = ''
  grantBtn.disabled = true
  grantBtn.textContent = '…'
  const r = await ${grantCall}
  if (r && r.error) {
    err.textContent = r.error
    grantBtn.disabled = false
    grantBtn.textContent = 'Zeit hinzufügen'
    return
  }
  window.close()
}
pw.focus()
</script></body></html>`
}

export function showWarningWindow(payload) {
    if (warningWin && !warningWin.isDestroyed()) {
        warningWin.show()
        warningWin.focus()
        return
    }
    const iconPath = _imagesDir ? resolveWindowIconPath(_imagesDir) : undefined
    warningWin = new BrowserWindow({
        width: 480,
        height: 480,
        frame: true,
        fullscreen: false,
        resizable: true,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        title: 'LiFE Parental Control',
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: { nodeIntegration: true, contextIsolation: false, devTools: false }
    })
    warningWin.removeMenu()
    try { warningWin.setAlwaysOnTop(true, 'screen-saver') } catch { warningWin.setAlwaysOnTop(true) }
    try { warningWin.setVisibleOnAllWorkspaces(true) } catch { /* ignore */ }
    warningWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(makeHtml(payload ?? {})))
    warningWin.once('ready-to-show', () => { try { warningWin.center() } catch { /* ignore */ } })
    warningWin.on('closed', () => { warningWin = null })
}
