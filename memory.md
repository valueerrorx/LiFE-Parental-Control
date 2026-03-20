# LiFE Parental Control — persistent context (compressed)

## Stack (actual)
electron-vite, Vue3+Pinia, Bootstrap5, Sass; **not** Quasar (`claude.md` stack line updated). **`@eslint/js`** explicit in `package.json` (flat config import). **`src/shared/`** — cross-target modules (e.g. `lockIdleMinutes.js` imported via `@shared` alias in main + renderer). **Only** `src/main/`, `src/preload/`, `src/renderer/` for app code — no duplicate Vue tree under `src/`. Do **not** set npm `"type":"module"` (breaks preload path: outputs `.mjs` vs main expecting `.js`).

## IPC surface
`activity:list` → `{ entries }` from `activity-log.json` (ring buffer, not in backup bundle); `config:readFiles`; `profile:*`; `system:*` (incl. `system:getAppInfo`: name/version/packaged/electron/node); `webfilter:*` (incl. `webfilter:reapplyMirror` → `reapplyWebFilterFromMirror`: hosts from `webfilter.json`); `apps:*`; `quota:*` (incl. `quota:redeploy`, `quota:resetTodayUsage` → delete today `quota-usage-*.json`); `schedules:*` (incl. `schedules:redeploy`, `schedules:resetTodayUsage`, `schedules:grantBonusMinutes` → `checkParentPassword`, lowers today `usage-*` minutes); `lifeMode:*`; `backup:export|import`; `settings:*` (incl. `checkParentPassword` export for privileged IPC; `settings:getConfig` returns only whitelisted prefs (currently `lockIdleMinutes`, sanitized); `settings:saveConfig` only applies the same keys; main start `repairInvalidLockIdleInConfig` writes disk cleanup; `settings:pruneUsageArchives` → `{ ok, removed }`). **Usage log retention:** `usageArchivePrune.js` deletes `usage-*.json` / `quota-usage-*.json` when filename date is older than **120 days** (local calendar day, matches cron/Python); runs at app start, after schedule persist/redeploy + quota deploy, and manually from Settings **Maintenance**.

## KDE integration
Kiosk: merges into `/etc/xdg/kdeglobals` — strips prior LiFE sections (`[KDE Action Restrictions][$i]` etc.) then appends new blocks; never wipes unrelated keys. Session restart: `kquitapp6 ksmserver` → `kquitapp5 ksmserver` → for each **x11/wayland** session (`loginctl` state active or online, **not** `Class=greeter|background`), user from `list-sessions`, `qdbus` as that uid with `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<uid>/bus` (KSMServer variants + qt bin paths) → last resort same qdbus as root (legacy). Status IPC reads same section headers (must match `kioskStore.buildPlasmaConfig`).

## Recent changes (2026-03-20)
- **Activity log**: **`lifeMode:apply`** success → `life_mode_apply` (mode key + label); Dashboard label.
- **Activity log**: also on **backup import/export** (basename only) and **process whitelist** save/redeploy; Dashboard labels extended.
- **Activity log**: `activityLog.js` + `activityIpc` (`activity:list`); append on screen-time bonus/reset and quota reset; Dashboard **Recent activity** card + refresh; `claude.md` Features updated (duplicate `quota:resetTodayUsage` handler removed).
- **Screen-time bonus (`claude.md`)**: `schedules:grantBonusMinutes` + `checkParentPassword` in `settingsIpc`; Schedules page +30 min after parent password (reduces stored `usage-*` minutes); preload `grantBonusMinutes`.
- **`package.json`**: explicit **`@eslint/js`** devDependency for `eslint.config.mjs` (no longer rely on transitive only).
- **`memory.md`**: document title **LiFE Parental Control** (replaces legacy “LiFE Kiosk” header; repo/npm may still use `life-kiosk` / `life-parental-control` paths).
- **`claude.md`**: product title **LiFE Parental Control**; Environment line matches real stack (`kdeglobals`, `qdbus`/`kquitapp`, `loginctl`, cron) — not `kwriteconfig6`.
- **README** modules table + **Dashboard** quota card: document `usage-*` / `quota-usage-*` “reset today” actions (Screen Time / App Control).
- **`quota:resetTodayUsage`**: IPC handler added to `quotaIpc.js`; preload + App Control button (`onResetQuotaTodayUsage`) already present — main-side handler was the missing piece.
- **SchedulesPage** “Recent screen time” blurb: matches embedded Python (`loginctl` Type/State/Class, greeter/background skip).
- **SchedulesPage**: `onResetTodayUsage` implemented — calls existing `schedules:resetTodayUsage` (button was broken).
- **Graphical session pick**: one `loginctl show-session` per id (`Type`/`State`/`Class`); skip `Class=greeter` and `background` (`systemIpc`, schedule + quota Python). Reduces bogus KSMServer/logout targets and cron user lists from login greeter sessions.
- **README**: session restart + note that cron scripts share the same `loginctl` class filter (redeploy after upgrade).
- **`settings:getConfig`**: returns only `lockIdleMinutes` when set/valid (no spread of full `config.json`); keeps password hash and stray file keys out of the renderer.
- **`settings:saveConfig`**: ignores unknown keys — only updates `lockIdleMinutes` (normalized); prevents polluting `config.json` via broad object merge.
- **Dashboard** “App time limits (today)”: short note linking to App Control — bars from usage file, enforcement via `pgrep -x -i` on configured process name.
- **App Control** “Daily time limits” blurb: documents current `Exec` parsing (shell `-c`, electron, AppImage stem) and manual `comm` override for Steam / edge AppImages.
- **README**: session restart documents **active|online** `loginctl` graphical sessions and per-user `qdbus` attempts.
- **`execLineToProcessName`**: token path ending `.AppImage` → basename without extension (best-effort quota name).
- **`eslint.config.mjs`**: flat config as explicit ESM (removed `eslint.config.js`) — drops Node `MODULE_TYPELESS_PACKAGE_JSON` reparse warning without adding `"type":"module"` to `package.json`.
- **`execLineToProcessName`**: `electron` + flags → first app arg (recurse); `sh|bash|dash|zsh -c` inner (recurse); flatpak/snap unchanged — better default `processName` for quota/App Control.
- **Graphical session detection**: `loginctl` filter uses `State` **active** or **online** for `Type` x11/wayland (`systemIpc` list for session restart; Python in `schedulesIpc` + `quotaIpc` cron scripts). Root: only one foreground session is `active`; other seats stay `online`.
- **`systemIpc` `restartKdeSession`**: after successful per-user `qdbus` KSMServer logout, call `next()` so **all** active graphical users get a logout attempt (multi-seat); previously stopped after first success.
- **`src/shared/lockIdleMinutes.js`**: `normalizedLockIdleMinutesOrUndefined` + `isLockIdleMinutesAllowed` (internal); consumers: `settingsIpc`, `App.vue`, `SettingsPage` (`LOCK_IDLE_OPTIONS` for `<select>`); Settings load/import pass raw `cfg.lockIdleMinutes` (normalizer does `Number()`).
- **`repairInvalidLockIdleInConfig`**: on app start, drops invalid `lockIdleMinutes` from `config.json`. **`settings:getConfig`** sanitizes IPC payload.
- **`src/shared/lockIdleMinutes.js`**: allowlist + **`LOCK_IDLE_OPTIONS`** (value/label) for Settings session-lock `<select>`; `settingsIpc`, `App.vue`, `SettingsPage`; `@shared`; `eslint` includes `src/shared`.
- **CI**: `.github/workflows/ci.yml` — Node 22, `npm ci`, `npm run check`, concurrency cancel, `permissions: contents: read`; triggers PR + push `main`/`master` only; **Dependabot** monthly npm + actions; `claude.md` / README aligned.
- **`package.json`**: `npm run check` = `lint` + `compile`; README dev uses `check` before `dev`. `compile` = `electron-vite build` only.
- **README**: **Backup** subsection — `examples/life-parental-backup-v1.example.json`, v1 bundle, partial import (keys present only).
- **electron-builder.yml**: `productName` + `linux.description` aligned with `package.json` / README (no longer “LiFE Kiosk” / kiosk-only wording).
- **Backup import**: `Object.hasOwn` on `schedules`, `webFilter`, `blockedApps`, `quotas`, `lifeModes`, `preferences` — absent key → unchanged; `preferences` non-object → `clearSessionLockPreference` (drop `lockIdleMinutes`); other rules unchanged (`lifeModes` non-object → unlink, etc.).
- **README**: Session restart behaviour (kquitapp → per-user session bus qdbus → root fallback); `dev:root` documented for sudo+Vite testing.
- **Session restart**: after kquitapp, DBus logout as each **active graphical** user (`loginctl` + `id -u/g`, `DBUS_SESSION_BUS_ADDRESS=/run/user/<uid>/bus`), then qt bin path + KSMServer name matrix as **root** fallback.
- **Settings**: Maintenance button **Usage logs (old)** → `settings:pruneUsageArchives`; `pruneUsageArchives` returns `{ removed }` for the toast.
- **Local calendar day**: `localCalendarDay.js` — `schedules:getUsage` / `quota:getUsage` / usage prune cutoff use same local `YYYY-MM-DD` as embedded Python (`date.today()`), not `toISOString()` UTC (fixes wrong “today” file near timezone midnight).
- **Usage archives**: `usageArchivePrune.js` removes `usage-YYYY-MM-DD.json` and `quota-usage-YYYY-MM-DD.json` older than 120d (filename date); app start + schedule persist/redeploy + quota `deployScript` + Settings **Usage logs (old)**.
- **Navigation**: `MainLayout` refresh on mount; App Control badges (blocked / quotas); Screen Time **on** when `schedule.enabled`; Dashboard only loads `lifeMode:list` (no duplicate protection IPC). Screen Time **Save** calls `refreshProtectionsState` so sidebar badges update immediately.
- **Backup**: bundle includes `preferences`; import merges allowed `lockIdleMinutes` via `mergePreferencesFromBackup`, or `clearSessionLockPreference` when key present but value not an object; post-import `life-parental-lock-prefs`.
- **Auto-lock**: `config.json` `lockIdleMinutes` (0 / 5 / 15 / 30 / 60), Settings **Session lock**; idle timer on unlock + `life-parental-lock-prefs` event to refresh without re-login. `App.vue` fixes first-run `passwordSet` after `setPassword`.
- **About**: `system:getAppInfo` + Settings shows version, Electron/Node, dev vs packaged.
- **Web filter**: `webfilter:reapplyMirror` / `reapplyWebFilterFromMirror`; Settings **Maintenance** + Web Filter **Sync from disk**.
- **README.md**: aligned with Electron/Vue app (obsolete Python/PyQt text removed). **Settings**: “Cron scripts” maintenance card (schedule + quota redeploy).
- **Screen Time**: `schedules:redeploy` + Schedules page “Rewrite cron script” (`redeployScheduleCron` reads `schedules.json`, same `updateCron` as Save).
- **Dashboard**: “App time limits (today)” card with usage vs limit bars; **quota:redeploy** + App Control button rewrites cron/script; quota IPC uses `readQuotaEntries` for safe list/mutate.
- **Quota script**: `pgrep`/`pkill` use `-x -i` (exact comm, case-insensitive). Redeploy: change any quota in UI or re-save.
- **Quota process names**: `execLineToProcessName` handles flatpak `--command=`, `flatpak run` (app id tail), `snap run`; App Control table edits process + optional override when adding.
- **App quotas (UI + wiring)**: `registerQuotaIpc` in main; App Control “Daily time limits”; `apps:list` includes `processName` from .desktop `Exec`; backup export/import `quotas`; Dashboard shows count of day limits.
- **After backup import**: `useAppStore().refreshProtectionsState()` from Settings. Example bundle: `examples/life-parental-backup-v1.example.json`.
- **Settings backup**: `backup:export` / `backup:import` — JSON v1; import applies only keys present in file (partial bundles). Excludes password + usage files.
- **Allowed hours / cron**: Python check treats start-after-end as overnight window (e.g. 22:00–07:00); Schedules page note. Redeploy script: save Screen Time once while enforcement enabled (rewrites `/usr/local/bin/life-parental-check`).
- **Custom life modes**: `/etc/life-parental/life-modes.json` defines extra keys (cannot override `school`/`leisure`). `DEFAULT_SCHEDULE` merge, category lists filtered to known quick-add names, desktop ids must end with `.desktop`. Dashboard loads dynamic buttons; Settings documents schema.
- **`schedules:getUsageHistory`**: reads last N (default 14, max 90) `usage-YYYY-MM-DD.json` under config dir; Schedules page “Recent screen time” table + Refresh; bars scale to daily limit when enabled else to peak day.
- **Dashboard family profile + KDE**: optional checkbox applies after `lifeMode:apply`: School → `kioskStore.prepareActivation()` + `system:activateKiosk`; Leisure → `activateKiosk('')` (strip LiFE blocks). Session restart as on Kiosk page.
- **`lifeMode` leisure**: strips Social Media + Gaming preset hostnames from hosts/mirror (domains defined in `webFilterCategories.js` only); custom rules unchanged.
- **Repo hygiene**: Removed legacy duplicate frontend (`src/App.vue`, `src/pages`, `src/components`, …), root `index.html`; `npm run lint` scopes to `src/main|preload|renderer|shared`. ESLint: Node globals for main/preload, browser globals for renderer; `vue/script-indent` baseIndent 0; `settings:getConfig|saveConfig` use `delete` instead of unused destructuring. `eslint --fix` applied across renderer.
- **`lifeMode:apply`**: `school` = schedule + merge Social+Gaming into hosts + clear blocked apps; `leisure` = relaxed schedule + clear blocked apps (web rules unchanged). Dashboard “Family profiles” + IPC `lifeMode:list`.
- **Web filter categories** moved to `src/main/ipc/webFilterCategories.js`; `readWebFilterEntries` / `persistWebFilterEntries` exported for presets.
- **`persistSchedule` exported** from `schedulesIpc.js`; **`replaceBlockedDesktopIds`** + shared override helper in `appBlockerIpc.js`.
- **Removed** dead `src-electron/` tree (electron-vite uses `src/main/` only).
- **Web filter**: `webfilter.json` mirror; hosts-unreadable fallback; Web Filter page warning.
- **App blocker**: safe unblock, legacy JSON ids normalized.
- **Schedules page**: School week / Leisure form presets (Save still required there); Dashboard profiles apply system-wide immediately.

## Earlier (2026-03-20)
- **Daily limit enforcement** implemented in check script: Python3 detects active X11/Wayland sessions via `loginctl show-session -p Type/State`, increments `usage-YYYY-MM-DD.json` (+1/min), locks via `loginctl lock-sessions` when >= limit. Notify via `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus`.
- **`schedules:getUsage` IPC** reads today's usage JSON → returned to renderer.
- **SchedulesPage**: progress bar shows today's usage vs. limit (color: blue→orange→red).
- **appStore**: `todayUsageMinutes` + `kioskStatus` refs; `loadSchedule` fetches both schedule+usage in parallel; `loadKioskStatus` added.
- **Dashboard**: Screen Time card shows `{used}m / {limit}m`; KDE Kiosk card shows restriction count.
- Dashboard: real KDE Kiosk stats via `getKioskStatus`; `usageLabel` formula live.

## Recent changes (2026-03-20 continued)
- **Idle-timeout auto-lock**: `App.vue` resets timer on pointer/wheel/keydown; `lockIdleMinutes` in `settings:getConfig` (0=off, default 15); SettingsPage "Session lock" card; `life-parental-lock-prefs` CustomEvent for hot-reload.
- **Maintenance panel** (Settings): one-click redeploy buttons for schedule cron, quota cron, web filter hosts mirror.
- **`system:getAppInfo`**: returns name/version/packaged/electron/node; Settings About shows live version + "(dev)" badge.
- **`webfilter:reapplyMirror`** IPC + `reapplyWebFilterFromMirror` export: rewrites `/etc/hosts` block from `webfilter.json`.
- **`quota:redeploy`** + **`schedules:redeploy`** IPC: redeploy cron scripts from JSON on disk; buttons in App Control, Schedules, Settings.
- **`pgrep`/`pkill` `-x -i`**: case-insensitive exact comm matching in quota enforcement script.
- **Dashboard "App time limits"** card: per-app usage bars sorted by ratio; `quotaSummaryRows` computed from `appStore.appQuotas`+`appQuotaUsage`.

## Open / TODO
- Session logout: rare stale `loginctl` rows; kquitapp remains preferred. **Multi-seat:** per-user `qdbus` after success; sessions active|online; greeter/background skipped.
- Quota: AppImage `AppRun` comm mismatch and Steam game subprocesses require manual override via the process-name edit field in App Control.
