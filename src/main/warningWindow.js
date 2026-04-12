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
<html><head><meta charset="utf-8"><title>LiFE Parental Control - Warning</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<div class="icon">🕐</div>
<h1>${String(p.heading || 'Computer um diese Uhrzeit nicht erlaubt')}</h1>
<p class="info">${msg}</p>
<button class="btn-block" id="dismiss">OK</button>
</div>
<script>
document.getElementById('dismiss').onclick = () => window.close()
</script></body></html>`
    }

    const subtype = p.subtype || ''
    const isAllowedHoursLow = subtype === 'allowed-hours'
    const isApp = String(type).startsWith('app-')
    const effectiveLimit = Number(p.effectiveLimit) || 0
    const usedMinutes = Number(p.usedMinutes) || 0
    const remaining = p.remaining != null ? Number(p.remaining) : Math.max(0, effectiveLimit - usedMinutes)
    const overrideOpts = Array.isArray(p.allowedHoursOverrideOptions) ? p.allowedHoursOverrideOptions : []
    const useEndOverride = isAllowedHoursLow && overrideOpts.length > 0

    let heading = 'Wenig Bildschirmzeit übrig'
    let info = `Noch etwa <strong>${remaining}</strong> Min. heute (${usedMinutes} von <strong>${effectiveLimit}</strong> Min. genutzt). Sichere deine Arbeit rechtzeitig!`

    if (isAllowedHoursLow) {
        heading = 'Computer bald gesperrt'
        info = `Noch etwa <strong>${remaining}</strong> Min. bis zum Ende der erlaubten Zeit. Passwort eingeben, um die Endzeit anzupassen.`
    } else if (isApp) {
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
    const optsJson = JSON.stringify(overrideOpts)

    const minuteOptionsHtml = `
  <select id="mins" class="sel">
    <option value="10">+10 Min.</option>
    <option value="15">+15 Min.</option>
    <option value="20">+20 Min.</option>
    <option value="25">+25 Min.</option>
    <option value="30" selected>+30 Min.</option>
    <option value="40">+40 Min.</option>
    <option value="50">+50 Min.</option>
    <option value="60">+60 Min.</option>
  </select>`

    let secondControlHtml
    let btnLabel
    let grantCall
    if (useEndOverride) {
        const endOverrideOptionsHtml = overrideOpts.map((h) => `<option value="${h}">${h}</option>`).join('')
        secondControlHtml = `<select id="endOv" class="sel">${endOverrideOptionsHtml}</select>`
        btnLabel = 'Endzeit setzen'
        grantCall = `ipcRenderer.invoke('schedules:setAllowedHoursOverride', { password: pw.value, endHHMM: document.getElementById('endOv').value })`
    } else if (isAllowedHoursLow) {
        secondControlHtml = minuteOptionsHtml
        btnLabel = 'Bonus-Zeit gewähren'
        grantCall = `ipcRenderer.invoke('schedules:grantAllowedHoursBonus', { password: pw.value, minutes: +document.getElementById('mins').value })`
    } else if (isApp) {
        secondControlHtml = minuteOptionsHtml
        btnLabel = 'Zeit hinzufügen'
        grantCall = `ipcRenderer.invoke('quota:grantAppBonus', { password: pw.value, minutes: +document.getElementById('mins').value, appId: payload.appId, linuxUser: payload.linuxUser || '' })`
    } else {
        secondControlHtml = minuteOptionsHtml
        btnLabel = 'Zeit hinzufügen'
        grantCall = `ipcRenderer.invoke('schedules:grantBonusMinutes', { password: pw.value, minutes: +document.getElementById('mins').value })`
    }

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>LiFE Parental Control - Warning</title><style>${WARNING_PANEL_CSS}</style></head>
<body><div class="card">
<h2>${heading}</h2>
<p class="info">${info}</p>
<label>Elternkontroll-Passwort</label>
<div class="row">
  <div class="pw-wrap">
    <input type="password" id="pw" autocomplete="off" placeholder="Passwort"/>
    <button class="eye" id="eye" tabindex="-1" title="Passwort anzeigen">&#128065;</button>
  </div>
  ${secondControlHtml}
</div>
<p id="err" class="err"></p>
<div class="btn-row">
  <button class="btn-outline" id="dismiss">Später</button>
  <button id="grant">${btnLabel}</button>
</div>
</div>
<script>
const {ipcRenderer} = require('electron')
const payload = ${payloadJson}
const overrideOptions = ${optsJson}
const pw = document.getElementById('pw')
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
    grantBtn.textContent = ${JSON.stringify(btnLabel)}
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
        show: false,
        frame: true,
        fullscreen: false,
        resizable: true,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        title: 'LiFE Parental Control - Warning',
        ...(iconPath ? { icon: iconPath } : {}),
        webPreferences: { nodeIntegration: true, contextIsolation: false, devTools: false }
    })
    warningWin.removeMenu()
    try { warningWin.setAlwaysOnTop(true, 'screen-saver') } catch { warningWin.setAlwaysOnTop(true) }
    try { warningWin.setVisibleOnAllWorkspaces(true) } catch { /* ignore */ }
    warningWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(makeHtml(payload ?? {})))
    warningWin.webContents.once('did-finish-load', () => {
        try { warningWin.center() } catch { /* ignore */ }
        warningWin.show()
    })
    warningWin.on('closed', () => { warningWin = null })
}
