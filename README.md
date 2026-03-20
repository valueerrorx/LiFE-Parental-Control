# LiFE Parental Control (`life-kiosk`)

Desktop app for **KDE Plasma (Linux)**: parental controls via **Electron**, **Vue 3**, **Pinia**, and **Bootstrap 5**. Kiosk restrictions use `.kiosk` profile snippets merged into `/etc/xdg/kdeglobals`.

## Modules

| Area | What it does |
|------|----------------|
| **KDE kiosk** | Lockdown sections in `kdeglobals` (actions, URLs, control modules); session restart after apply |
| **Web filter** | `webfilter.json` + `/etc/hosts` marker block; category presets |
| **Screen time** | `schedules.json`; root cron → `/usr/local/bin/life-parental-check` (limits, allowed hours, overnight windows) |
| **App blocking** | `.desktop` overrides under `/usr/local/share/applications/` |
| **App quotas** | `quota.json`; cron → `/usr/local/bin/life-parental-quota` (`pgrep` / `pkill` per process name) |
| **Profiles** | School / Leisure + optional `life-modes.json`; backup/export JSON bundle |

**Config:** `/etc/life-parental/` (app expects elevated rights when packaged; see main process).

### Session restart (KDE)

After writing kiosk restrictions to `/etc/xdg/kdeglobals`, the app triggers a Plasma session restart: `kquitapp6|5 ksmserver` first, then `qdbus` logout on each **active graphical** user’s session bus (`/run/user/<uid>/bus`), then the same DBus calls as root as a last resort. Single-seat desktop setups are the main target; exotic multi-seat setups may need a manual re-login.

## Development

Requires **Node ≥ 22** and **npm ≥ 10**.

```bash
npm install
npm run lint
npm run dev
```

Enforcement features touch system paths. For local dev with cron/scripts and `/etc` writes, use **`npm run dev:root`** (runs the Vite dev app under `sudo` with your user’s `XDG_RUNTIME_DIR` so the UI can start while policies still assume root).

**Production build:**

```bash
npm run build
```

Authoring conventions and stack notes: root **`claude.md`** and **`memory.md`**.

## Legacy

The historical **Python / PyQt** prototype and `kiosk.py` workflow are **not** this app; the UI is the Vue renderer under `src/renderer/`.
