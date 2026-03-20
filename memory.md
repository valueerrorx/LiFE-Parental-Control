# LiFE Kiosk — persistent context (compressed)

## Stack (actual)
electron-vite, Vue3+Pinia, Bootstrap5, Sass; **not** Quasar (claude.md outdated). **Only** `src/main/`, `src/preload/`, `src/renderer/` — no duplicate Vue tree under `src/`. Do **not** set npm `"type":"module"` (breaks preload path: outputs `.mjs` vs main expecting `.js`).

## IPC surface
`config:readFiles`; `profile:*`; `system:*`; `webfilter:*` (hosts + `webfilter.json`); `apps:*`; `schedules:*`; `lifeMode:list|apply`; `settings:*`.

## KDE integration
Kiosk: merges into `/etc/xdg/kdeglobals` — strips prior LiFE sections (`[KDE Action Restrictions][$i]` etc.) then appends new blocks; never wipes unrelated keys. Session restart: `kquitapp6 ksmserver` fallback `kquitapp5`. Status IPC reads same section headers (must match `kioskStore.buildPlasmaConfig`).

## Recent changes (2026-03-20)
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

## Open / TODO
- Quota-based app blocking (per-app daily time limit, needs process monitoring)
- Optional: one UI action = `lifeMode:apply` + KDE kiosk activate from current profile
- Plasma6: verify `ksmserver` quit still correct on all distros.
