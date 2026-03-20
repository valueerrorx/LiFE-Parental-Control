# LiFE Kiosk — persistent context (compressed)

## Stack (actual)
electron-vite, Vue3+Pinia, Bootstrap5, Sass; **not** Quasar (claude.md outdated). Main: `src/main/`, renderer: `src/renderer/src/`.

## IPC surface
`config:readFiles` → kiosk `.kiosk` dir; `profile:*` → profiles dir; `system:activateKiosk|getKioskStatus|dialog:openDirectory|app:quit`; `webfilter:*`; `apps:*`; `schedules:get|getUsage|save`; `settings:*`.

## KDE integration
Kiosk: merges into `/etc/xdg/kdeglobals` — strips prior LiFE sections (`[KDE Action Restrictions][$i]` etc.) then appends new blocks; never wipes unrelated keys. Session restart: `kquitapp6 ksmserver` fallback `kquitapp5`. Status IPC reads same section headers (must match `kioskStore.buildPlasmaConfig`).

## Recent changes (2026-03-20)
- **Daily limit enforcement** implemented in check script: Python3 detects active X11/Wayland sessions via `loginctl show-session -p Type/State`, increments `usage-YYYY-MM-DD.json` (+1/min), locks via `loginctl lock-sessions` when >= limit. Notify via `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus`.
- **`schedules:getUsage` IPC** reads today's usage JSON → returned to renderer.
- **SchedulesPage**: progress bar shows today's usage vs. limit (color: blue→orange→red).
- **appStore**: `todayUsageMinutes` + `kioskStatus` refs; `loadSchedule` fetches both schedule+usage in parallel; `loadKioskStatus` added.
- **Dashboard**: Screen Time card shows `{used}m / {limit}m`; KDE Kiosk card shows restriction count.
- Dashboard: real KDE Kiosk stats via `getKioskStatus`; `usageLabel` formula live.

## Open / TODO
- Quota-based app blocking (per-app daily time limit, needs process monitoring)
- School/Leisure profile presets (one-click switch: web-filter + blocks + schedule)
- Plasma6: verify `ksmserver` quit still correct on all distros.
- Duplicate legacy trees (`src-electron/`, root `src/App.vue`) — confirm unused before deleting.
