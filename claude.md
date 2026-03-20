# Project: LiFE Parental Control (KDE/Plasma)
# Architecture: Electron-Vite + Electron + Vue 3 + Bootstrap (see memory.md; Quasar not used)

## 🎯 Core Objectives
Development of a modern parental control suite for KDE/Plasma on Linux.
Modules: KDE Kiosk System, Web-Filtering, Time-Tracking, App-Blocking (Total & Quota-based), School/Leisure Profiles.
Features: process allowlist (see `processWhitelistIpc.js`); **bonus time** — +30 min screen time per parent password (Screen Time); **activity log** — `activity-log.json` + Dashboard “Recent activity” (screen/quota resets, bonuses, family profile apply).

## 🛠 Tech Stack & Standards
- **Runtime:** Node.js / Electron (Latest ESM, no `require`, use `import`).
- **Frontend:** Vue 3 (Composition API), Pinia, Bootstrap 5.
- **Styling:** Modern Flat Design (Google Material Style).
- **Environment:** Arch Linux, KDE/Plasma — integration via **`/etc/xdg/kdeglobals`** LiFE block merge, **`qdbus`** / **`kquitapp`** (session restart), **`loginctl`** (graphical sessions for cron + logout); root **cron** for screen time and quotas (`memory.md`).

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
- **Verification:** run `npm run check` (lint + compile) before treating a change as done; release artifacts use `npm run build`. Update `memory.md` after substantive changes.