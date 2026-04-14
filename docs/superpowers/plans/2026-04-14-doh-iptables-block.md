# DoH iptables Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WebFilter UI toggle that enables/disables DoH blocking via `iptables`/`ip6tables` using the HaGeZi `ips/doh.txt` feed, persisted in `default.json` and enforced by the root daemon with full cleanup and status reporting.

**Architecture:** Extend existing “HaGeZi sync → cached files → default.json → daemon apply” pipeline. The main process persists `webfilter.dohIptablesEnabled`. The daemon reads the cached HaGeZi DoH IP list and applies/removes a dedicated `iptables`/`ip6tables` chain hooked into `OUTPUT`. UI queries daemon status via IPC.

**Tech Stack:** Electron + Vue (`src/renderer`), IPC handlers (`src/main/ipc`), root daemon (`daemon/*`), `iptables`/`ip6tables`.

---

### Task 1: Add config field to default.json schema

**Files:**
- Modify: `src/main/defaultProfileStore.js`

- [ ] **Step 1: Add the new default field**
  - Add `dohIptablesEnabled: false` under `EMPTY_DEFAULT.webfilter`.

- [ ] **Step 2: Parse/normalize the field from disk**
  - In `buildFromRaw`, read `wf.dohIptablesEnabled` (boolean) into `next.webfilter.dohIptablesEnabled`.

- [ ] **Step 3: Verify no lints**
  - Run diagnostics for `src/main/defaultProfileStore.js`.

---

### Task 2: Extend HaGeZi sync to fetch/cache DoH IP list

**Files:**
- Modify: `src/main/ipc/webFilterHagezi.js`
- Modify (if needed): `src/main/ipc/webFilterIpc.js` (to expose meta/status if desired)

- [ ] **Step 1: Locate the current HaGeZi download list**
  - Identify where feed URLs are defined and downloaded.

- [ ] **Step 2: Add download for `ips/doh.txt`**
  - URL: `https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/ips/doh.txt`
  - Cache path: `${configDir}/blocklists/ips/doh.txt` (create `ips/` dir).

- [ ] **Step 3: Add parser utility for IP list**
  - Ignore blank lines and comments.
  - Validate IPv4/IPv6 (basic regex or net parser).
  - Deduplicate + sort.
  - Persist the original text OR the normalized list (choose one; daemon can parse too).

- [ ] **Step 4: Ensure the manual “Listen aktualisieren” updates this list**
  - The existing `webfilter:syncFeeds` flow must trigger the DoH IP list update.

- [ ] **Step 5: Verify no lints**
  - Run diagnostics for touched IPC files.

---

### Task 3: Add daemon iptables/ip6tables enforcement + status

**Files:**
- Modify: `daemon/defaultSync.js`
- Modify: `daemon/parental-control-daemon.js` (only if new daemon command types are needed)
- Modify: `src/main/daemonPrivilegedOps.js` (only if new privileged ops wrapper is needed)

- [ ] **Step 1: Define chain/hook constants**
  - IPv4 chain: `LIFE_DOH_BLOCK`
  - IPv6 chain: `LIFE_DOH_BLOCK6`

- [ ] **Step 2: Implement `ensureDohIptablesEnabled`**
  - Read cached file `${configDir}/blocklists/ips/doh.txt`.
  - Parse IPs (IPv4 vs IPv6).
  - Apply rules idempotently:
    - Ensure chain exists.
    - Flush chain.
    - Add per-IP rules: `-d <ip> -p tcp --dport 443 -j REJECT`.
    - Ensure exactly one jump from `OUTPUT` to the chain.
  - IPv6:
    - Only if `ip6tables` exists and IPv6 is available (best-effort detection).

- [ ] **Step 3: Implement `ensureDohIptablesDisabled`**
  - Remove jump rule from `OUTPUT`.
  - Flush + delete chain.
  - Do it for v4 and v6 independently (best-effort; don’t fail the whole apply if v6 is unavailable).

- [ ] **Step 4: Wire enforcement into `applyFromDefault`**
  - Read `webfilter.dohIptablesEnabled` from `default.json` (same source used for other webfilter fields).
  - Call ensure enabled/disabled accordingly.

- [ ] **Step 5: Add daemon status query**
  - Add a daemon command (IPC line protocol) like `get-doh-iptables-status` returning:
    - `v4Active`, `v6Available`, `v6Active`
  - Status should reflect actual rules presence (chain exists + OUTPUT jump present).

- [ ] **Step 6: Verify no lints**
  - Run diagnostics for `daemon/defaultSync.js` and any touched daemon file.

---

### Task 4: Expose status in main process IPC + persist toggle

**Files:**
- Modify: `src/main/ipc/webFilterIpc.js`
- Modify: `src/preload/index.js` (if webFilter API needs new method)
- Modify: `src/renderer/src/stores/appStore.js` (or wherever webfilter state is stored)

- [ ] **Step 1: Persist new toggle in `webfilter:saveAll`**
  - Accept `dohIptablesEnabled` from UI payload.
  - `patchDefaultJson`: set `d.webfilter.dohIptablesEnabled = Boolean(data.dohIptablesEnabled)`.

- [ ] **Step 2: Return the toggle in `webfilter:getList`**
  - Include `dohIptablesEnabled` in the response.

- [ ] **Step 3: Add `webfilter:getDohIptablesStatus` IPC handler**
  - Ask the daemon for real status (new daemon command).

- [ ] **Step 4: Expose preload API**
  - `window.api.webFilter.getDohIptablesStatus()`

- [ ] **Step 5: Store wiring**
  - Add state field in the store:
    - `webFilterDohIptablesEnabled`
    - `webFilterDohIptablesStatus` (optional: `{ v4Active, v6Active, v6Available }`)
  - Update `loadWebFilter()` to populate it.
  - Update `saveWebFilterAll()` to include it in payload.

---

### Task 5: UI section in `WebFilterPage.vue`

**Files:**
- Modify: `src/renderer/src/pages/WebFilterPage.vue`
- Modify: `lang/en.json`
- Modify: `lang/de.json`

- [ ] **Step 1: Add card under DNS upstream selection**
  - Toggle bound to store field `webFilterDohIptablesEnabled`.
  - Read-only status line using store status object.

- [ ] **Step 2: Refresh status**
  - On mounted: call status IPC and store result.
  - After Apply: call status IPC again.

- [ ] **Step 3: i18n strings**
  - Add German/English keys for title, subtitle, status labels.

- [ ] **Step 4: Verify no lints**
  - Run diagnostics for `WebFilterPage.vue`.

---

### Task 6: Verification

**Files:**
- Modify: (none)

- [ ] **Step 1: Run unit/smoke checks (if available)**
  - Run whatever the repo uses for lint/test (e.g. `npm test`, `npm run lint`) if present.

- [ ] **Step 2: Manual test**
  - Open WebFilter page, toggle DoH iptables, Apply.
  - Confirm daemon reports status toggling.
  - Confirm rules appear/disappear:
    - `iptables -S | rg LIFE_DOH_BLOCK`
    - `ip6tables -S | rg LIFE_DOH_BLOCK6` (if available)

- [ ] **Step 3: Graphify rebuild (only if graphify-out exists and tool is installed)**
  - Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

