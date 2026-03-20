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

After writing kiosk restrictions to `/etc/xdg/kdeglobals`, the app triggers a Plasma session restart: `kquitapp6|5 ksmserver` first, then `qdbus` logout on **each** relevant `loginctl` session (**x11** / **wayland**, **active** or **online**, excluding **greeter** / **background** classes) on that user’s session bus (`/run/user/<uid>/bus`), then the same DBus calls as root as a last resort. Typical single-seat setups work out of the box; edge cases may still need a manual re-login.

Screen-time and app-quota cron jobs use the same session filter when detecting logged-in graphical users (redeploy scripts after upgrading the app).

## Development

Requires **Node ≥ 22** and **npm ≥ 10**.

```bash
npm install
npm run check   # lint + compile (out/; no AppImage/deb, no dev server)
npm run dev
```

Enforcement features touch system paths. For local dev with cron/scripts and `/etc` writes, use **`npm run dev:root`** (runs the Vite dev app under `sudo` with your user’s `XDG_RUNTIME_DIR` so the UI can start while policies still assume root).

**Production build:**

```bash
npm run build
```

### Backup (import / export)

Settings in the app export **version 1** JSON (no password, no usage history). A minimal valid shape is in **`examples/life-parental-backup-v1.example.json`**. On import, only **top-level keys present** in the file are applied; omitted keys leave the existing system config untouched.

**CI:** `.github/workflows/ci.yml` runs **`npm run check`** on every **pull request** and on **push to `main` or `master`**. **Dependabot** (`.github/dependabot.yml`) proposes monthly npm and GitHub Actions updates.

Authoring conventions and stack notes: root **`claude.md`** and **`memory.md`**.

## Legacy

The historical **Python / PyQt** prototype and `kiosk.py` workflow are **not** this app; the UI is the Vue renderer under `src/renderer/`.
