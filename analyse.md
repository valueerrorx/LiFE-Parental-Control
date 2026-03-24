# LiFE Parental Control — Codeanalyse

> Erstellt: 2026-03-24
> Scope: Alle relevanten Quelldateien (Electron main/renderer, Daemon, Translations, Konfiguration)

---

## 1. Settings-Buttons: Was machen sie?

### 1.1 Systemd Daemon

| Button | IPC-Aufruf | Was passiert |
|--------|-----------|--------------|
| **Install & Start** | `daemon.serviceControl({ action: 'install' })` | Kopiert `parental-control-daemon.js` nach `/usr/bin/`, schreibt `/etc/systemd/system/parental-control.service`, führt `systemctl enable && start` aus |
| **Start** | `daemon.serviceControl({ action: 'start' })` | `systemctl start parental-control` |
| **Stop** | `daemon.serviceControl({ action: 'stop' })` | `systemctl stop parental-control` |
| **Restart** | `daemon.serviceControl({ action: 'restart' })` | `systemctl restart parental-control` |
| **Refresh** | Parallel: `serviceControl({status})`, `daemon.isConnected()`, `daemon.nodeCheck()`, `daemon.apparmorCheck()` | Aktualisiert Status-Badges (Service, Socket, Node.js, AppArmor) |

### 1.2 Session Lock

| Button | Was passiert |
|--------|-------------|
| **Save** | Schreibt `preferences.lockIdleMinutes` in `default.json`. Dispatcht `life-parental-lock-prefs` Event damit der Hauptprozess die Sperre sofort anpasst. |

### 1.3 Passwort ändern

| Button | Was passiert |
|--------|-------------|
| **Update Password** | Validiert altes Passwort, erzeugt neues Salt (16 Byte), speichert SHA256(passwort+salt) in `default.json.security`. |

### 1.4 Backup & Restore

| Button | Was passiert |
|--------|-------------|
| **Export…** | Öffnet Speicherdialog, schreibt ein JSON-Bundle mit schedule, webFilter, blockedApps, lifeModes, quotas, processWhitelist, preferences — OHNE Passwort und Usage-History |
| **Import…** | Öffnet Dateidialog, liest JSON-Bundle, wendet **nur vorhandene Top-Level-Keys** an. `webfilter.json` und `/etc/hosts` werden neu geschrieben wenn `webFilter` enthalten. |

### 1.5 Maintenance-Buttons (5 Stück)

| Button | IPC-Aufruf | Was WIRKLICH passiert |
|--------|-----------|----------------------|
| **Screen Time** | `schedules.redeploy()` | **Nur `{ ok: true }` — kein Code wird ausgeführt!** ⚠️ Zeigt trotzdem "usageArchiveCleanup"-Meldung. Irreführend. |
| **App Quotas** | `quota.redeploy()` | Ruft `redeployQuotaFromDisk(configDir)` auf — das macht nur `pruneUsageArchives()`. Alte Dateien werden bereinigt. |
| **Web Filter Restore** | `webFilter.reapplyMirror()` | Liest `webfilter.json`, baut `/etc/hosts`-Block neu auf, flusht DNS-Cache. Korrekt und sinnvoll. |
| **Quota Exemptions** | `processWhitelist.redeploy()` | Entfernt Legacy-Cron-Skripte (`life-parental-kill`), liest `quotaExemptions` aus `default.json` neu ein. |
| **Usage Logs (old)** | `settings.pruneUsageArchives()` | Löscht `usage-*.json`, `quota-usage-*.json`, `app-usage-*.json` älter als 120 Tage. Korrekt. |

### 1.6 Danger Zone

| Button | Was passiert |
|--------|-------------|
| **Stop all protections** | Deaktiviert schedule, leert Quotas, leert blockedApps, leert Web Filter (schreibt `/etc/hosts`), deaktiviert quotaExemptions, entfernt KDE Kiosk-Sections falls aktiv |
| **Delete all usage history** | Löscht ALLE `usage-*.json`, `quota-usage-*.json`, `app-usage-*.json` im Config-Dir |

---

## 2. `autostartEnabled` in default.json — Woher? Wird es gebraucht?

### Woher kommt der Eintrag?

`preferences.autostartEnabled` wird an drei Stellen in `default.json` geschrieben:

1. **Erster Passwort-Setup** (`settingsIpc.js`, `settings:setPassword`):
   Wenn `isFirstSetup && app.isPackaged && process.getuid() === 0` — wird automatisch auf `true` gesetzt und die Desktop-Datei unter `/etc/xdg/autostart/` erzeugt.

2. **Manuell via IPC** (`settings:setAutostart`):
   Schreibt `/etc/xdg/autostart/org.tuxfamily.life-parental-control.desktop` und setzt `autostartEnabled` im JSON synchron.

3. **Backup-Import** (`mergePreferencesFromBackup`):
   Wird aus dem importierten JSON übernommen, wenn vorhanden.

### Ist der Eintrag nötig?

**Teilweise nötig, aber inkonsistent exponiert:**

- Die tatsächliche Wahrheit liegt im Filesystem: ob `/etc/xdg/autostart/org.tuxfamily.life-parental-control.desktop` existiert.
- `settings:getConfig` gibt BEIDE zurück: `autostartEnabled` (aus JSON) und `autostartFilePresent` (Filesystem-Check).
- **Die Settings-UI zeigt keinen Autostart-Toggle** — weder Anzeige noch Button. Der Wert wird zwar vom Backend zurückgegeben aber im Frontend ignoriert.
- Das JSON-Flag kann **veraltet** sein, wenn die Desktop-Datei manuell gelöscht wird oder die App neu installiert wird.
- Für Backup/Restore ist es sinnvoll, den Wunsch-Zustand zu speichern.

**Fazit:** Der Eintrag ist für Backup/Restore nützlich, aber das UI zeigt und ermöglicht keine Steuerung. Die Settings-Page sollte entweder einen Autostart-Toggle haben oder den Wert komplett aus dem UI-Scope entfernen.

---

## 3. Code-Redundanzen und Vereinfachungspotenzial

### 3.1 KRITISCH: Duplizierte Bonus-Konstanten

**Dateien:** `src/main/ipc/schedulesIpc.js` (Zeilen 10–12) und `src/main/ipc/quotaIpc.js` (Zeilen 9–11)

```js
// Identisch in beiden Dateien:
const BONUS_MIN = 5
const BONUS_MAX = 180
const BONUS_DEFAULT = 30
```

Diese Konstanten sind in beiden Modulen identisch dupliziert. Sie sollten in eine gemeinsame Datei (z.B. `src/shared/bonusLimits.js`) ausgelagert werden.

### 3.2 Duplizierter DEFAULT_SCHEDULE

**Dateien:** `src/main/ipc/schedulesIpc.js` und `src/main/defaultProfileStore.js`

- `schedulesIpc.js` exportiert `DEFAULT_SCHEDULE` (Zeile 14–24)
- `defaultProfileStore.js` definiert `EMPTY_DEFAULT.schedule` mit exakt denselben Werten

`defaultProfileStore.js` sollte `DEFAULT_SCHEDULE` aus `schedulesIpc.js` importieren statt es selbst zu definieren. Risiko der Divergenz besteht.

### 3.3 schedules:redeploy ist ein No-Op

**Datei:** `src/main/ipc/schedulesIpc.js`, Zeile 150

```js
ipcMain.handle('schedules:redeploy', () => ({ ok: true }))
```

Der IPC-Handler tut buchstäblich nichts außer `{ ok: true }` zurückgeben. In `SettingsPage.vue` zeigt der "Screen Time"-Button danach aber `t('settings.usageArchiveCleanup')` an — als ob eine Bereinigung stattgefunden hätte. Das ist **irreführend**.

`redeployScheduleCron(configDir)` (welche `pruneUsageArchives` aufruft) wird nur via `syncEmbeddedEnforcementIfNeeded` beim App-Start aufgerufen, nicht über diesen IPC-Handler.

**Verbesserung:** Handler sollte `pruneUsageArchives(configDir)` aufrufen und die korrekte Anzahl entfernter Dateien zurückgeben.

### 3.4 Daemon inlined Shared-Code (unvermeidlich, aber dokumentierenswert)

**Datei:** `daemon/parental-control-daemon.js`

Der Daemon ist ein eigenständiges CJS-Modul (`require`-basiert). Er kann die ES-Module aus `@shared/` nicht importieren. Daher sind `normalizeLinuxUser`, `quotaUsageKey` und `localIsoDate` im Daemon inline dupliziert. Das ist **architektonisch unvermeidlich** aber sollte bei Änderungen an den Shared-Helpers beachtet werden — Daemon muss manuell nachgezogen werden.

### 3.5 webfilter.json + default.json Dual-Write

**Datei:** `src/main/ipc/webFilterIpc.js`

Web-Filter-Daten werden doppelt geschrieben:
- `webfilter.json` (Mirror mit `cachedHostRuleCount` + `updatedAt`)
- `default.json` via `patchDefaultJson` (ohne `cachedHostRuleCount`)

Der Daemon liest aus `default.json`. Die `reapplyMirror`-Funktion liest aus `webfilter.json`.

**Problem:** Wenn nur `default.json` restored wird (z.B. bei einem Backup-Import ohne `webFilter`-Key), ist `webfilter.json` veraltet. Ein anschließendes `reapplyMirror` würde den falschen Stand aus `webfilter.json` nehmen.

**Empfehlung:** `reapplyMirror` sollte primär aus `default.json` lesen (wie der Daemon), nicht aus `webfilter.json`.

### 3.6 Private readConfig/saveConfig Pattern in jedem Modul (OK, aber konsistent halten)

Jedes IPC-Modul hat eigene private Wrapper:
- `processWhitelistIpc.js`: `readConfig()`, `saveConfig()`
- `quotaIpc.js`: `readQuotas()`, `saveQuotas()`
- `schedulesIpc.js`: `readSchedule()`, `persistSchedule()` (public export)

Das ist ein akzeptables Muster (jedes Modul besitzt seinen Abschnitt), aber die Konsistenz bei Benennung und Sichtbarkeit ist gering. Kein kritisches Problem.

---

## 4. Konfigurationskonsistenz: Electron UI ↔ Systemd Daemon ↔ default.json

### 4.1 Was liest/schreibt wo?

| Modul | Liest aus | Schreibt in |
|-------|----------|-------------|
| Schedule | `default.json` via `readDefaultJson` | `default.json` via `patchDefaultJson` |
| Web Filter | `webfilter.json` (Mirror) für UI | `webfilter.json` + `default.json` |
| App Blocker | `default.json` | `default.json` |
| Quotas | `default.json` | `default.json` |
| Quota Exemptions | `default.json` | `default.json` |
| Settings/Password | `default.json` | `default.json` |
| Preferences | `default.json` | `default.json` |
| **Daemon** | `default.json` direkt (raw JSON.parse) | `/etc/life-parental/usage-*.json`, `quota-usage-*.json` |

### 4.2 Potenzielle Inkonsistenz: Daemon liest raw JSON

Der Daemon liest `default.json` direkt ohne die Normalisierung aus `defaultProfileStore.js`. Wenn das JSON einen ungültigen Wert enthält (z.B. `allowedDays: "all"` statt Array), behandelt der Daemon das möglicherweise anders als der Electron-Main-Prozess.

**Bewertung:** Geringes praktisches Risiko, da `defaultProfileStore.js` beim Schreiben normalisiert. Der Daemon käme nur an invalide Daten, wenn jemand `default.json` manuell bearbeitet.

### 4.3 Was fehlt / ist überholt in default.json?

Die `EMPTY_DEFAULT`-Struktur in `defaultProfileStore.js` deckt alle aktiven Features ab:
- ✅ `schedule` — Bildschirmzeit
- ✅ `webfilter` — Web-Filter (entries + feedState + listAllowlist)
- ✅ `appControl` — App-Blocking
- ✅ `blockedDesktopIds` — geblockte Apps
- ✅ `quota` — App-Quotas
- ✅ `quotaExemptions` — App-Ausnahmen
- ✅ `security` — Passwort + Salt
- ✅ `preferences` — lockIdleMinutes, autostartEnabled, quotaViewLinuxUser

**Nicht in default.json:**
- KDE Kiosk-Konfiguration → liegt in `/etc/xdg/kdeglobals` (separates Format, kein JSON)
- Familien-Profile → liegen in `/etc/life-parental/life-modes.json` (separates File, by design)
- `webfilter.cachedHostRuleCount` + `updatedAt` → nur in `webfilter.json`, nicht in `default.json`

Das ist alles korrekt und sinnvoll.

---

## 5. Migration von mehreren Configs auf eine default.json: Inkonsistenzen?

### 5.1 webfilter.json — Legacy-Mirror bleibt bestehen

`webfilter.json` war früher die primäre Config-Datei für den Web-Filter. Nach der Migration ist sie ein "Mirror" mit Zusatzfeldern. Das ist intentional, aber:

**Problem A:** `reapplyMirror` liest aus `webfilter.json`, nicht aus `default.json`. Wenn ein Import nur `default.json` ändert ohne `webFilter`-Key, liest `reapplyMirror` den alten Stand.

**Problem B:** In `webFilterIpc.js` `webfilter:getList` werden Daten aus `readMirrorRaw()` (= `webfilter.json`) gelesen. Wenn `webfilter.json` fehlt aber `default.json` existiert, sieht die UI leere Webfilter-Einstellungen. Beim ersten Speichern wird `default.json` aber korrekt geschrieben.

**Empfehlung:** Die Initialisierung sollte `webfilter.json` aus `default.json` erzeugen falls die Mirror-Datei fehlt.

### 5.2 Legacy Cron-Referenzen im Code

Die Codebase enthält noch mehrere Cron-Reliquien:
- `src/main/ipc/cronInstallPaths.js` — Datei existiert noch
- `processWhitelistIpc.js` entfernt `LEGACY_KILL_CRON` und `LEGACY_KILL_SCRIPT`
- `embeddedEnforcementSync.js` ruft `removeLegacyProcessKillCronArtifacts()` auf

Das ist korrekt — Legacy-Cleanup läuft beim App-Start. Die Datei `cronInstallPaths.js` sollte auf Verwendung geprüft und ggf. entfernt werden.

### 5.3 `schedules:redeploy` Handler ist ein No-Op (bereits unter 3.3)

Nach der Migration von Cron zu Systemd-Daemon ist der `schedules:redeploy`-Handler leer geworden. Das ist eine direkte Folge der Migration und ist ein Bug der behoben werden sollte.

---

## 6. Übersetzungen: Vollständigkeit und Korrektheit

### 6.1 Verwaiste Translation-Keys (BEIDE Sprachen)

Folgende Keys existieren in `en.json` und `de.json`, werden aber **nirgendwo im UI verwendet**:

```
settings.defaultProfileTitle
settings.defaultProfileHint
settings.defaultProfileUploadBtn
settings.defaultProfileRemoveBtn
settings.defaultProfileSaved
settings.defaultProfileRemoved
```

Diese stammen offenbar von einem früheren "Default Profile Upload"-Feature das aus der Settings-Page entfernt wurde, aber dessen Übersetzungen noch in beiden Sprachdateien vorhanden sind.

### 6.2 Irreführende Formulierungen (Cron-Referenzen)

Folgende Translations erwähnen "Cron" obwohl kein Cron mehr verwendet wird:

**en.json:**
- `activityLog.quotaCronRedeploy`: "App quotas: enforcement cron/script rewritten from disk" — Cron existiert nicht mehr
- `activityLog.scheduleCronRedeploy`: "Screen time: enforcement state refreshed from current settings" — OK, kein Cron erwähnt (korrekt)

**de.json:**
- `activityLog.quotaCronRedeploy`: "App-Kontingente: Durchsetzungs-Cron/Skript von Disk neu geschrieben" — veraltet

### 6.3 Inkonsistenter Daemon-Name

- Englisch: `settings.systemdDaemon` = "Systemd Daemon"
- Deutsch: `settings.systemdDaemon` = "Systemd Service" (unterschiedlicher Begriff)
- `dashboard.settingsLink` EN: "Settings → Systemd Daemon"
- `dashboard.settingsLink` DE: "Einstellungen → Systemd Service"

Kein Funktionsfehler, aber der Begriff sollte konsistent sein (entweder "Daemon" oder "Service" in beiden Sprachen).

### 6.4 Strukturelle Vollständigkeit

Beide Sprachdateien (`en.json`, `de.json`) haben **identische Schlüsselstrukturen** — kein Key fehlt in der deutschen Version. Übersetzungsqualität ist gut. Kein technischer Fehler.

---

## 7. Code-Wiederverwendung zwischen Modulen

### 7.1 Zentrales Lesen/Schreiben: Gut umgesetzt

Alle Module verwenden korrekt die zentrale API:
- ✅ `readDefaultJson(configDir)` — alle Module
- ✅ `patchDefaultJson(configDir, patcher)` — alle Module
- ✅ `appendActivity(configDir, ...)` — alle Module

### 7.2 Shared Utilities: Gut genutzt

- ✅ `normalizeQuotaLinuxUser` aus `@shared/quotaUsageKey.js` wird in schedulesIpc, quotaIpc, settingsIpc, appBlockerIpc verwendet
- ✅ `effectiveScreenMinutes` aus `@shared/screenTimeUsage.js` in schedulesIpc
- ✅ `LOCK_IDLE_OPTIONS` aus `@shared/lockIdleMinutes.js` in settingsIpc + SettingsPage.vue

### 7.3 Was NICHT geteilt wird (Verbesserungspotenzial)

**Bonus-Konstanten** (BONUS_MIN/MAX/DEFAULT): In `schedulesIpc.js` UND `quotaIpc.js` identisch definiert. Sollten in `src/shared/bonusLimits.js` ausgelagert werden.

**DEFAULT_SCHEDULE**: In `schedulesIpc.js` exportiert, in `defaultProfileStore.js` dupliziert. `defaultProfileStore.js` sollte importieren statt re-definieren.

---

## 8. Zusammenfassung der Befunde

| # | Schwere | Bereich | Problem |
|---|---------|---------|---------|
| 1 | 🔴 Bug | Settings/Maintenance | `schedules:redeploy` IPC-Handler ist No-Op; zeigt aber Erfolg-Meldung |
| 2 | 🟠 Design | webFilter | `reapplyMirror` liest `webfilter.json` statt `default.json` — kann bei Backup-Import falschen Stand nehmen |
| 3 | 🟡 Redundanz | Code | BONUS_MIN/MAX/DEFAULT dupliziert in schedulesIpc.js + quotaIpc.js |
| 4 | 🟡 Redundanz | Code | DEFAULT_SCHEDULE dupliziert in schedulesIpc.js + defaultProfileStore.js |
| 5 | 🟡 UX | Settings | `autostartEnabled` in default.json ohne UI-Toggle — kein Autostart-Control in der Settings-Page |
| 6 | 🟡 Cleanup | Translations | Verwaiste Keys `settings.defaultProfile*` in en.json + de.json |
| 7 | 🟡 Accuracy | Translations | `activityLog.quotaCronRedeploy` DE erwähnt "Cron" — nicht mehr korrekt |
| 8 | 🟡 Konsistenz | Translations | "Systemd Daemon" vs "Systemd Service" inkonsistent EN ↔ DE |
| 9 | 🟢 Info | Code | Daemon inliniert Shared-Helpers (unvermeidlich, aber bei Änderungen beachten) |
| 10 | 🟢 Info | Code | `cronInstallPaths.js` sollte auf Verwendung geprüft werden |

---

## 9. Arbeitsanweisungen für Claude Code

Die folgenden Aufgaben sind priorisiert und kontextbezogen formuliert, damit sie direkt umgesetzt werden können.

---

### Aufgabe 1: `schedules:redeploy` Handler reparieren

**Datei:** `src/main/ipc/schedulesIpc.js`

**Problem:** Der IPC-Handler `schedules:redeploy` (Zeile 150) gibt nur `{ ok: true }` zurück ohne etwas zu tun. Die Settings-Page zeigt danach aber "Nutzungsarchiv-Bereinigung abgeschlossen" an.

**Fix:**
```js
// Vorher:
ipcMain.handle('schedules:redeploy', () => ({ ok: true }))

// Nachher:
ipcMain.handle('schedules:redeploy', () => {
    try {
        const { removed } = pruneUsageArchives(configDir)
        appendActivity(configDir, { action: 'schedule_cron_redeploy' })
        return { ok: true, removed }
    } catch (e) {
        return { error: e.message }
    }
})
```

Die `pruneUsageArchives`-Funktion ist bereits importiert. `appendActivity` ist ebenfalls bereits importiert.

---

### Aufgabe 2: Bonus-Konstanten in Shared auslagern

**Dateien:**
- NEU: `src/shared/bonusLimits.js` erstellen
- `src/main/ipc/schedulesIpc.js` — Konstanten durch Import ersetzen
- `src/main/ipc/quotaIpc.js` — Konstanten durch Import ersetzen

**Vorgehen:**

1. Neue Datei `src/shared/bonusLimits.js`:
```js
export const BONUS_MIN = 5
export const BONUS_MAX = 180
export const BONUS_DEFAULT = 30
```

2. In `schedulesIpc.js` die drei `const`-Zeilen durch Import ersetzen:
```js
import { BONUS_MIN, BONUS_MAX, BONUS_DEFAULT } from '@shared/bonusLimits.js'
```

3. In `quotaIpc.js` identisch.

4. Sicherstellen, dass `@shared` in `vite.config` / `electron.vite.config.mjs` als Alias aufgelöst wird (ist bereits konfiguriert für andere shared files).

---

### Aufgabe 3: DEFAULT_SCHEDULE nicht duplizieren

**Dateien:**
- `src/main/defaultProfileStore.js`
- `src/main/ipc/schedulesIpc.js` (exportiert `DEFAULT_SCHEDULE`)

**Vorgehen:**

In `defaultProfileStore.js`:
```js
// Import hinzufügen:
import { DEFAULT_SCHEDULE } from './ipc/schedulesIpc.js'
// ... und in EMPTY_DEFAULT:
const EMPTY_DEFAULT = {
    label: 'Default',
    schedule: { ...DEFAULT_SCHEDULE },
    // ... rest bleibt gleich
}
```

**Achtung:** Circular-Import prüfen! `schedulesIpc.js` importiert bereits `readDefaultJson` und `patchDefaultJson` aus `defaultProfileStore.js`. Ein Import in die andere Richtung würde einen Zirkel erzeugen.

**Alternativer Fix (sicherer):** `DEFAULT_SCHEDULE` in eine eigene kleine Datei `src/shared/defaultSchedule.js` auslagern, damit beide Dateien dort importieren können ohne Zirkel.

---

### Aufgabe 4: reapplyMirror aus default.json lesen

**Datei:** `src/main/ipc/webFilterIpc.js`

**Problem:** `reapplyWebFilterFromMirror` liest aus `webfilter.json`. Wenn diese Datei fehlt oder veraltet ist (z.B. nach Backup-Import), werden falsche Daten in `/etc/hosts` geschrieben.

**Fix:** Die Funktion soll primär aus `default.json` lesen und nur als Fallback `webfilter.json` nutzen:

```js
export async function reapplyWebFilterFromMirror(configDir) {
    // Primär aus default.json lesen (authoritative source)
    const { readDefaultJson } = await import('../defaultProfileStore.js')
    const def = readDefaultJson(configDir)
    const mirror = {
        entries: def?.webfilter?.entries ?? [],
        feedState: def?.webfilter?.feedState ?? {},
        listAllowlist: def?.webfilter?.listAllowlist ?? []
    }
    // Fallback auf webfilter.json wenn default.json keinen webfilter-Eintrag hat
    if (!mirror.entries.length && !Object.keys(mirror.feedState).length) {
        const fromMirror = readMirrorRaw(configDir)
        Object.assign(mirror, fromMirror)
    }
    await persistMirrorAndHosts(configDir, mirror)
}
```

**Hinweis:** `readDefaultJson` ist bereits in der Datei zugänglich über den Patcher-Aufruf. Den Import ggf. als statischen Top-Level-Import ergänzen.

---

### Aufgabe 5: Verwaiste Translation-Keys entfernen

**Dateien:** `lang/en.json` und `lang/de.json`

**Zu entfernende Keys** (in beiden Dateien im Abschnitt `"settings"`):
- `defaultProfileTitle`
- `defaultProfileHint`
- `defaultProfileUploadBtn`
- `defaultProfileRemoveBtn`
- `defaultProfileSaved`
- `defaultProfileRemoved`

**Vorgehen:** Keys in beiden Dateien suchen und entfernen. Vorher mit `grep -r "defaultProfile" src/` sicherstellen, dass sie wirklich nirgendwo im Code verwendet werden.

---

### Aufgabe 6: Veralteten Translations-Text korrigieren

**Datei:** `lang/de.json`

**Problem:** `activityLog.quotaCronRedeploy` erwähnt "Cron" obwohl kein Cron mehr verwendet wird.

**Aktueller Wert DE:**
```json
"quotaCronRedeploy": "App-Kontingente: Durchsetzungs-Cron/Skript von Disk neu geschrieben"
```

**Neuer Wert DE** (konsistent mit EN-Formulierung):
```json
"quotaCronRedeploy": "App-Kontingente: Durchsetzungsstatus aus aktuellen Einstellungen aktualisiert"
```

**Gleichzeitig prüfen EN:**
```json
"quotaCronRedeploy": "App quotas: enforcement cron/script rewritten from disk"
```
Sollte geändert werden zu:
```json
"quotaCronRedeploy": "App quotas: enforcement state refreshed from current settings"
```

---

### Aufgabe 7: Daemon-Name in Translations vereinheitlichen

**Dateien:** `lang/de.json`

Die deutsche Übersetzung verwendet "Systemd Service" wo die englische "Systemd Daemon" sagt.

**Entscheidung treffen:** Entweder beide auf "Daemon" oder beide auf "Service". Empfehlung: "Daemon" in beiden (technisch präziser).

**Zu ändernde Keys in de.json:**
- `settings.systemdDaemon`: "Systemd Service" → "Systemd Daemon"
- `dashboard.settingsLink`: "Einstellungen → Systemd Service" → "Einstellungen → Systemd Daemon"

---

### Aufgabe 8: Autostart-Toggle in Settings-UI ergänzen (Optional/niedrige Prio)

**Datei:** `src/renderer/src/pages/SettingsPage.vue`

**Problem:** `autostartEnabled` existiert in `default.json` und wird vom Backend verwaltet, aber die Settings-Page zeigt keinen Toggle dafür. Der IPC-Handler `settings:setAutostart` existiert (`settingsIpc.js` Zeile 171), wird aber von keiner UI aufgerufen.

**Fix:** Im Session-Lock-Card oder einem eigenen "Startup" Card einen Toggle hinzufügen:

```html
<div class="form-check form-switch mt-3">
    <input class="form-check-input" type="checkbox" id="autostartToggle"
        v-model="sessionPrefs.autostartEnabled"
        :disabled="!appInfo?.packaged || !appInfo?.runningAsRoot" />
    <label class="form-check-label" for="autostartToggle">
        {{ $t('settings.autostartLabel') }}
    </label>
    <div class="small text-muted">{{ $t('settings.autostartHint') }}</div>
</div>
```

Dazu müssen neue Translation-Keys hinzugefügt werden:
```json
// en.json settings:
"autostartLabel": "Start at login",
"autostartHint": "Automatically open LiFE Parental Control when a user logs in (requires packaged app as root)."

// de.json settings:
"autostartLabel": "Beim Login starten",
"autostartHint": "LiFE Elternkontrolle automatisch öffnen wenn ein Benutzer sich anmeldet (erfordert gepackte App als Root)."
```

Und im Script:
```js
async function onToggleAutostart(enabled) {
    const r = await window.api.settings.setAutostart(enabled)
    if (r?.error) { /* zeige Fehler */ }
    else { sessionPrefs.autostartEnabled = r?.autostartFilePresent ?? enabled }
}
```

---

### Aufgabe 9: cronInstallPaths.js auf Verwendung prüfen

**Datei:** `src/main/ipc/cronInstallPaths.js`

Mit `grep -r "cronInstallPaths" src/` prüfen ob diese Datei noch importiert/verwendet wird. Falls nicht, Datei löschen.

---

### Aufgabe 10: webfilter.json-Initialisierung aus default.json

**Datei:** `src/main/ipc/webFilterIpc.js`

**Problem:** Wenn `webfilter.json` fehlt aber `default.json` Web-Filter-Daten enthält, zeigt das UI einen leeren Web-Filter bis der Nutzer etwas speichert.

**Fix:** In `registerWebFilterIpc` beim ersten Lesen, falls `webfilter.json` leer/fehlend, aus `default.json` initialisieren:

```js
// Am Anfang von registerWebFilterIpc():
const { readDefaultJson } = await import('../defaultProfileStore.js') // falls nicht schon statisch
// Prüfe ob Mirror-Datei fehlt:
const mirrorPath = path.join(configDir, CONFIG_FILE)
if (!fs.existsSync(mirrorPath)) {
    const def = readDefaultJson(configDir)
    if (def?.webfilter) {
        // Mirror aus default.json initialisieren
        writeMirrorToDisk(configDir, {
            entries: def.webfilter.entries ?? [],
            feedState: def.webfilter.feedState ?? {},
            listAllowlist: def.webfilter.listAllowlist ?? []
        })
    }
}
```

---

## Anhang: Dateien die geändert werden müssen

| Datei | Änderungen |
|-------|-----------|
| `src/main/ipc/schedulesIpc.js` | schedules:redeploy No-Op reparieren; BONUS_MIN/MAX/DEFAULT auslagern |
| `src/main/ipc/quotaIpc.js` | BONUS_MIN/MAX/DEFAULT auslagern |
| `src/main/defaultProfileStore.js` | DEFAULT_SCHEDULE-Duplikat entfernen |
| `src/main/ipc/webFilterIpc.js` | reapplyMirror aus default.json lesen; Mirror-Initialisierung |
| `lang/en.json` | Verwaiste defaultProfile*-Keys entfernen; quotaCronRedeploy korrigieren |
| `lang/de.json` | Verwaiste defaultProfile*-Keys entfernen; quotaCronRedeploy korrigieren; Daemon-Name vereinheitlichen |
| `src/renderer/src/pages/SettingsPage.vue` | Autostart-Toggle ergänzen (optional) |
| `src/shared/bonusLimits.js` | NEU: BONUS_MIN/MAX/DEFAULT |
| `src/shared/defaultSchedule.js` | NEU (optional): DEFAULT_SCHEDULE |
