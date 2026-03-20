# Project: LiFE Parental Control (KDE/Plasma)
# Architecture: Electron-Vite + Electron + Vue 3 + Bootstrap (see memory.md; Quasar not used)

## 🎯 Core Objectives
Development of a modern parental control suite for KDE/Plasma on Linux.
Modules: KDE Kiosk System, Web-Filtering, Time-Tracking, App-Blocking (Total & Quota-based), School/Leisure Profiles.
Features: Settings **About** exposes **`runningAsRoot`** from main; **Polkit**: packaged `.policy` + `.rules` under `packaging/polkit/`, shipped in app `resources/polkit/`, installed to `/usr/share/polkit-1/{actions,rules.d}` via **deb** `packaging/debian/postinst.sh` / removed in `packaging/debian/postrm.sh` (`.rules` JS: **pkexec** `command_line` must contain `life-parental-control` or `life parental control`, case-insensitive—covers deb binary and default AppImage name); packaged **version-gated** redeploy of screen-time / quota cron scripts (`.embedded-enforcement-version`); **Quota exemptions** (UI) / `process-whitelist.json` + `quotaIpc` cron (no separate kill-all cron; see `processWhitelistIpc.js`); backup v1 includes **`processWhitelist`**; **extra allowance** — `usage-*.json` field `extraAllowanceMinutes` adds to today’s cap without changing logged minutes; parent password in **limit-reached** dialog + `schedules:grantBonusMinutes`; **activity log** — `activity-log.json` + Dashboard “Recent activity” (incl. **`embedded_enforcement_redeploy`** on packaged version bump, screen/quota resets, bonuses, family profile apply, KDE kiosk apply/clear, parent password set/change, cron/webfilter maintenance, usage-archive prune).

## 🛠 Tech Stack & Standards
- **Runtime:** Node.js / Electron (Latest ESM, no `require`, use `import`).
- **Frontend:** Vue 3 (Composition API), Pinia, Bootstrap 5.
- **Styling:** Modern Flat Design (Google Material Style).
- **Environment:** Arch Linux, KDE/Plasma — integration via **`/etc/xdg/kdeglobals`** LiFE block merge, **`qdbus`** / **`kquitapp`** (session restart), **`loginctl`** (graphical sessions for cron + logout); root **cron** for screen time and quotas (`memory.md`). **Packaged, non-root:** small **elevation** `BrowserWindow` (German copy) → user clicks **Weiter** → **`pkexec` `/usr/bin/env` …** relaunch, then this process exits (`src/main/index.js`); **`child.on('error')`** logs **`[LiFE Parental Control] pkexec relaunch failed:`** (README Troubleshooting).

## 📜 Coding Rules
- **Indentation:** Exactly 4 spaces.
- **Code Logic:** Avoid micro-functions. Do not wrap 2 lines of code in a separate function unless repeated.
- **Modularity:** Balanced. Group similar logic (e.g., one central file for all IPC calls).
- **Comments:** - Always in English.
    - Always single-line (`//`).
    - Only for complex/important logic. Short and concise.
- **Response Style:** German (except code comments). Bullet points or tables. No apologies. No "As an AI" disclaimers. Technical and precise.

## 🧠 Memory & Persistent Context
Claude must maintain a file named `memory.md` in the project root to store persistent information across runs:
- **Format:** Compressed, AI-readable style (tokens/shorthand).
- **Content:** - Major tasks completed.
    - Lessons learned (what worked/what failed).
    - Decisions regarding KDE/Linux system integration.
    - State of IPC calls and module communication.
- **Action:** Update `memory.md` after significant changes or when a specific implementation strategy proved successful or problematic.

## 🚀 Interaction Protocol
- Deliver copy-pasteable, working code.
- Provide only the necessary functions or lines unless the full file is requested.
- Use modern JS standards (ES2022+).
- **Local dev:** `npm run dev` — **`sudo --preserve-env=…` whitelist** (not `sudo -E`) + `XDG_RUNTIME_DIR=/run/user/$(id -u)` + `--no-sandbox` so IDE/AppImage terminal env does not poison root Electron; **unpackaged** non-root **refuses to start** (dialog + stderr). `npm run dev:root` = `npm run dev`.
- **Packaged binary:** `electron-builder.yml` sets **`electronFuses.enableNodeOptionsEnvironmentVariable: false`** so host `NODE_OPTIONS` does not affect the shipped Electron binary (avoids dev-shell warnings in AppImage/deb).
- **Verification:** run `npm run check` (lint + compile) before treating a change as done; **`npm run build`** runs `electron-vite build` plus **`electron-builder --publish never`** (no `GH_TOKEN`); for GitHub/binary publishing, invoke `electron-builder` with explicit `--publish` / token. Update `memory.md` after substantive changes.