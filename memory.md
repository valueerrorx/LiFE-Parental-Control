# LiFE Kiosk — persistent context (compressed)

## Stack (actual)
electron-vite, Vue3+Pinia, Bootstrap5, Sass; **not** Quasar (`claude.md` stack line updated). **Only** `src/main/`, `src/preload/`, `src/renderer/` — no duplicate Vue tree under `src/`. Do **not** set npm `"type":"module"` (breaks preload path: outputs `.mjs` vs main expecting `.js`).

## IPC surface
`config:readFiles`; `profile:*`; `system:*` (incl. `system:getAppInfo`: name/version/packaged/electron/node); `webfilter:*` (incl. `webfilter:reapplyMirror` → `reapplyWebFilterFromMirror`: hosts from `webfilter.json`); `apps:*`; `quota:*` (incl. `quota:redeploy`); `schedules:*` (incl. `schedules:redeploy`); `lifeMode:*`; `backup:export|import`; `settings:*`. **Usage log retention:** main+`usageArchivePrune.js` deletes `usage-*.json` / `quota-usage-*.json` when filename date is older than **120 days** (UTC); runs at app start and after schedule persist/redeploy + quota deploy.

## KDE integration
Kiosk: merges into `/etc/xdg/kdeglobals` — strips prior LiFE sections (`[KDE Action Restrictions][$i]` etc.) then appends new blocks; never wipes unrelated keys. Session restart: `kquitapp6 ksmserver` → `kquitapp5 ksmserver` → `qdbus(6) org.kde.KSMServer|ksmserver /KSMServer logout 0 0 1`. Status IPC reads same section headers (must match `kioskStore.buildPlasmaConfig`).

## Recent changes (2026-03-20)
- **Usage archives**: `usageArchivePrune.js` removes `usage-YYYY-MM-DD.json` and `quota-usage-YYYY-MM-DD.json` older than 120d (filename date UTC); app start + schedule persist/redeploy + quota `deployScript`.
- **Navigation**: `MainLayout` refresh on mount; App Control badges (blocked / quotas); Screen Time **on** when `schedule.enabled`; Dashboard only loads `lifeMode:list` (no duplicate protection IPC). Screen Time **Save** calls `refreshProtectionsState` so sidebar badges update immediately.
- **Backup**: bundle includes `preferences` (session lock); import merges via `mergePreferencesFromBackup`; post-import syncs Session lock UI + `life-parental-lock-prefs`.
- **Auto-lock**: `config.json` `lockIdleMinutes` (0 / 5 / 15 / 30 / 60), Settings **Session lock**; idle timer on unlock + `life-parental-lock-prefs` event to refresh without re-login. `App.vue` fixes first-run `passwordSet` after `setPassword`.
- **About**: `system:getAppInfo` + Settings shows version, Electron/Node, dev vs packaged.
- **Web filter**: `webfilter:reapplyMirror` / `reapplyWebFilterFromMirror`; Settings **Maintenance** + Web Filter **Sync from disk**.
- **README.md**: aligned with Electron/Vue app (obsolete Python/PyQt text removed). **Settings**: “Cron scripts” maintenance card (schedule + quota redeploy).
- **Screen Time**: `schedules:redeploy` + Schedules page “Rewrite cron script” (`redeployScheduleCron` reads `schedules.json`, same `updateCron` as Save).
- **Dashboard**: “App time limits (today)” card with usage vs limit bars; **quota:redeploy** + App Control button rewrites cron/script; quota IPC uses `readQuotaEntries` for safe list/mutate.
- **Quota script**: `pgrep`/`pkill` use `-x -i` (exact comm, case-insensitive). Redeploy: change any quota in UI or re-save.
- **Session restart**: DBus logout fallbacks after kquitapp for Plasma 5/6 service name variants (root may still use wrong session bus — kquitapp remains primary).
- **Quota process names**: `execLineToProcessName` handles flatpak `--command=`, `flatpak run` (app id tail), `snap run`; App Control table edits process + optional override when adding.
- **App quotas (UI + wiring)**: `registerQuotaIpc` in main; App Control “Daily time limits”; `apps:list` includes `processName` from .desktop `Exec`; backup export/import `quotas`; Dashboard shows count of day limits.
- **After backup import**: `useAppStore().refreshProtectionsState()` from Settings. Example bundle: `examples/life-parental-backup-v1.example.json`.
- **Settings backup**: `backup:export` / `backup:import` — JSON v1 with schedules, webFilter entries, blocked `.desktop` ids, `quotas`, optional `lifeModes`, optional `preferences` (`lockIdleMinutes` only, via `settingsIpc`). Excludes password + usage files.
- **Allowed hours / cron**: Python check treats start-after-end as overnight window (e.g. 22:00–07:00); Schedules page note. Redeploy script: save Screen Time once while enforcement enabled (rewrites `/usr/local/bin/life-parental-check`).
- **Custom life modes**: `/etc/life-parental/life-modes.json` defines extra keys (cannot override `school`/`leisure`). `DEFAULT_SCHEDULE` merge, category lists filtered to known quick-add names, desktop ids must end with `.desktop`. Dashboard loads dynamic buttons; Settings documents schema.
- **`schedules:getUsageHistory`**: reads last N (default 14, max 90) `usage-YYYY-MM-DD.json` under config dir; Schedules page “Recent screen time” table + Refresh; bars scale to daily limit when enabled else to peak day.
- **Dashboard family profile + KDE**: optional checkbox applies after `lifeMode:apply`: School → `kioskStore.prepareActivation()` + `system:activateKiosk`; Leisure → `activateKiosk('')` (strip LiFE blocks). Session restart as on Kiosk page.
- **`lifeMode` leisure**: strips Social Media + Gaming preset hostnames from hosts/mirror (domains defined in `webFilterCategories.js` only); custom rules unchanged.
- **Repo hygiene**: Removed legacy duplicate frontend (`src/App.vue`, `src/pages`, `src/components`, …), root `index.html`; `npm run lint` scopes to `src/main|preload|renderer`. ESLint: Node globals for main/preload, browser globals for renderer; `vue/script-indent` baseIndent 0; `settings:getConfig|saveConfig` use `delete` instead of unused destructuring. `eslint --fix` applied across renderer.
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
- DBus logout as root: kquitapp fallbacks; on some Plasma 5 distros may need `qdbus` path variant.
- Quota: edge cases with wrapped binaries (manual process override in UI covers most cases).
