#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
'use strict';
// LiFE Parental Control root daemon — single source of truth for all timekeeping and enforcement

const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile, spawn, spawnSync } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const { createDefaultSync } = require('./defaultSync.js');

const execFileAsync = promisify(execFile);

const SOCKET_PATH = '/run/parental-control.sock';
const CONFIG_DIR = '/etc/life-parental';
const LOG_FILE = '/etc/life-parental/daemon.log';
const LOG_MAX_BYTES = 2 * 1024 * 1024; // rotate at 2 MB
const TICK_MS = 10_000;
const TICKS_PER_LOGGED_MINUTE = 60_000 / TICK_MS; // 6 ticks = 1 minute
const ALLOWED_HOURS_WARN_INTERVAL_MS = 5 * 60 * 1000;

const NOTIFY_SEND_BIN = (() => {
    try {
        if (fs.existsSync('/usr/bin/notify-send')) return '/usr/bin/notify-send';
        if (fs.existsSync('/bin/notify-send')) return '/bin/notify-send';
    } catch { /* ignore */ }
    return 'notify-send';
})();

const NOTIFY_APP_NAME = 'LiFE Parental Control';

// --- Exempt-app watchdog constants ---
const WD_INPUT_WINDOW_MS   = 8_000;  // user counts as "active" if input in last 8s
const WD_CPU_MIN_JIFFIES   = 5;      // minimum CPU jiffies delta to consider app "responsive"
const WD_WARN_MAX          = 4;      // number of notifications before hard logout
const WD_WARN_INTERVAL_MS  = 15_000; // 15s between each notification (test)
const WD_GRACE_MS          = 60_000; // 1 minute total grace before logout (test)

// --- File logger ---

function logLine(level, ...parts) {
    const ts = new Date().toISOString();
    const line = `${ts} [${level}] ${parts.join(' ')}\n`;
    process[level === 'ERROR' ? 'stderr' : 'stdout'].write(line);
    try {
        try {
            const stat = fs.statSync(LOG_FILE);
            if (stat.size > LOG_MAX_BYTES) {
                fs.renameSync(LOG_FILE, LOG_FILE + '.1');
            }
        } catch { /* file missing — will be created */ }
        fs.appendFileSync(LOG_FILE, line, 'utf8');
    } catch { /* ignore log write errors */ }
}

const log = {
    info:  (...a) => logLine('INFO',  ...a),
    warn:  (...a) => logLine('WARN',  ...a),
    error: (...a) => logLine('ERROR', ...a),
};

// Mutable tick state
let tickInMinute = 0;
let quotaWarnDate = '';
const appQuotaWarnOnce = new Set();
const quotaLinuxUserNoSessionWarnOnce = new Set(); // one warn per appId+linuxUser until next calendar day
let quotaTickSkippedAppControlWarned = false;
let quotaTickSkippedNoGraphicalSessionsWarned = false;
let lastAllowedHoursWarnAt = 0;

// Exempt-app watchdog state
let lastInputTimestamp = 0;   // last hardware input event seen by the input monitor
let inputMonitorStarted = false;
const exemptAppJiffies = {};  // processName → last CPU jiffies total
let wdWarnCount = 0;          // warnings sent in current grace-period cycle
let wdFirstWarnAt = 0;        // timestamp when the warning cycle started (0 = not started)
let wdLastWarnAt  = 0;        // timestamp of the most recent warning notification
let wdExemptActiveTicks = 0;  // consecutive ticks where exempt app was actively used

function resetExemptWatchdogState() {
    // Reset grace timers so the next login starts a fresh window.
    wdWarnCount = 0;
    wdFirstWarnAt = 0;
    wdLastWarnAt = 0;
    wdExemptActiveTicks = 0;
}

// Connected socket clients (Electron UI instances)
const clients = new Set();

// --- Date helpers (match existing app behavior) ---

function localIsoDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Linux user / quota key helpers (inlined from @shared) ---

function normalizeLinuxUser(raw) {
    if (raw == null || typeof raw !== 'string') return '';
    const s = raw.trim();
    if (!s || s.length > 32 || s.includes(':') || /\s/.test(s)) return '';
    if (!/^[a-zA-Z0-9._-]+$/.test(s)) return '';
    return s;
}

function quotaUsageKey(appId, linuxUser) {
    const u = normalizeLinuxUser(linuxUser);
    return u ? `${u}:${appId}` : appId;
}

function quotaUsedMinutes(usageMap, appId, linuxUser) {
    const u = normalizeLinuxUser(linuxUser);
    const key = quotaUsageKey(appId, u);
    const n = Number(usageMap[key]);
    if (Number.isFinite(n)) return Math.max(0, n);
    if (!u) return Math.max(0, Number(usageMap[appId]) || 0);
    return 0;
}

function quotaBonusMinutes(extraMap, appId, linuxUser) {
    const u = normalizeLinuxUser(linuxUser);
    const key = quotaUsageKey(appId, u);
    const n = Number(extraMap[key]);
    if (Number.isFinite(n)) return Math.max(0, n);
    if (!u) return Math.max(0, Number(extraMap[appId]) || 0);
    return 0;
}

function effectiveScreenMinutes(usage, screenTimeLinuxUser) {
    const lu = normalizeLinuxUser(screenTimeLinuxUser);
    const users = usage && typeof usage.users === 'object' ? usage.users : {};
    if (lu) return Math.max(0, Number(users[lu]?.minutes) || 0);
    if (users[''] != null) return Math.max(0, Number(users[''].minutes) || 0);
    return Math.max(0, Number(usage?.minutes) || 0);
}

// --- Config file readers / writers ---

const DEFAULT_SCHEDULE = {
    enabled: false, dailyLimitEnabled: false, dailyLimitMinutes: 120,
    screenTimeLinuxUser: '', allowedHoursEnabled: false,
    allowedHoursStart: '07:00', allowedHoursEnd: '22:00', allowedDays: [1, 2, 3, 4, 5, 6, 7]
};

const DEFAULT_JSON_FILE = 'default.json'

const DESKTOP_DIRS = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications'
]

let cachedDefaultMtimeMs = 0
let cachedDefaultConfig = null

function desktopIdStem(id) {
    return path.basename(String(id || ''), '.desktop').toLowerCase()
}

function desktopIdTailStem(id) {
    const stem = desktopIdStem(id)
    const parts = stem.split('.')
    return parts[parts.length - 1] || stem
}

function levenshtein(a, b) {
    const s = String(a)
    const t = String(b)
    const n = s.length
    const m = t.length
    if (n === 0) return m
    if (m === 0) return n
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = 0; i <= n; i++) dp[i][0] = i
    for (let j = 0; j <= m; j++) dp[0][j] = j
    for (let i = 1; i <= n; i++) {
        const si = s.charCodeAt(i - 1)
        for (let j = 1; j <= m; j++) {
            const cost = si === t.charCodeAt(j - 1) ? 0 : 1
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            )
        }
    }
    return dp[n][m]
}

function readInstalledDesktopIds() {
    const installed = new Set()
    for (const dir of DESKTOP_DIRS) {
        try {
            if (!fs.existsSync(dir)) continue
            for (const file of fs.readdirSync(dir)) {
                if (file.endsWith('.desktop')) installed.add(file)
            }
        } catch { /* ignore */ }
    }
    return installed
}

function resolveBlockedIdsAgainstInstalled(rawIds, installedIds) {
    const ids = Array.isArray(rawIds) ? rawIds : []
    const installed = new Set(Array.from(installedIds || []))

    // Index to make fuzzy resolution cheap.
    const byStem = new Map()
    const byTail = new Map()
    for (const id of installed) {
        const stem = desktopIdStem(id)
        const tail = desktopIdTailStem(id)
        if (!byStem.has(stem)) byStem.set(stem, [])
        byStem.get(stem).push(id)
        if (!byTail.has(tail)) byTail.set(tail, [])
        byTail.get(tail).push(id)
    }

    function fuzzyPick(rawWithExt) {
        const rawStem = desktopIdStem(rawWithExt)
        const rawTail = desktopIdTailStem(rawWithExt)
        const maxLen = Math.max(rawStem.length, rawTail.length)
        const threshold = maxLen <= 6 ? 2 : 3
        let best = null
        let bestId = ''
        for (const id of installed) {
            const dist = Math.min(
                levenshtein(rawTail, desktopIdTailStem(id)),
                levenshtein(rawStem, desktopIdStem(id))
            )
            if (dist > threshold) continue
            if (best === null || dist < best) {
                best = dist
                bestId = id
            } else if (dist === best && id !== bestId) {
                bestId = ''
            }
        }
        return bestId || null
    }

    const out = []
    const seen = new Set()
    for (const rawId of ids) {
        const raw = String(rawId || '').trim()
        if (!raw) continue
        const withExt = raw.endsWith('.desktop') ? raw : `${raw}.desktop`

        let resolved = ''
        if (installed.has(raw)) resolved = raw
        else if (installed.has(withExt)) resolved = withExt
        else {
            const stem = desktopIdStem(withExt)
            const tail = desktopIdTailStem(withExt)
            const stemMatches = byStem.get(stem) || []
            if (stemMatches.length === 1) resolved = stemMatches[0]
            else {
                const tailMatches = byTail.get(tail) || []
                if (tailMatches.length === 1) resolved = tailMatches[0]
                if (!resolved) resolved = fuzzyPick(withExt) || ''
            }
        }

        if (!resolved) resolved = withExt // keep as-is (may not exist)
        if (seen.has(resolved)) continue
        seen.add(resolved)
        out.push(resolved)
    }
    return out
}

function normalizeScheduleFromDefault(schedule) {
    const s = schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {}
    const allowedDays = Array.isArray(s.allowedDays)
        ? s.allowedDays.map(n => Number(n)).filter(n => Number.isFinite(n)).map(n => Math.trunc(n))
        : DEFAULT_SCHEDULE.allowedDays
    return {
        enabled: s.enabled === true,
        dailyLimitEnabled: s.dailyLimitEnabled === true,
        dailyLimitMinutes: Number.isFinite(Number(s.dailyLimitMinutes)) ? Number(s.dailyLimitMinutes) : DEFAULT_SCHEDULE.dailyLimitMinutes,
        screenTimeLinuxUser: typeof s.screenTimeLinuxUser === 'string' ? s.screenTimeLinuxUser : '',
        allowedHoursEnabled: s.allowedHoursEnabled === true,
        allowedHoursStart: typeof s.allowedHoursStart === 'string' ? s.allowedHoursStart : DEFAULT_SCHEDULE.allowedHoursStart,
        allowedHoursEnd: typeof s.allowedHoursEnd === 'string' ? s.allowedHoursEnd : DEFAULT_SCHEDULE.allowedHoursEnd,
        allowedDays: allowedDays.length ? allowedDays : DEFAULT_SCHEDULE.allowedDays
    }
}

function normalizeQuotaEntriesFromDefault(defaultQuota, installedIds) {
    const list = Array.isArray(defaultQuota) ? defaultQuota : []
    const out = []
    for (const e of list) {
        if (!e || typeof e !== 'object') continue
        const rawAppId = typeof e.appId === 'string' ? e.appId : ''
        if (!rawAppId) continue
        const appId = rawAppId.endsWith('.desktop') ? rawAppId : `${rawAppId}.desktop`
        const proc = typeof e.processName === 'string' ? e.processName.trim() : ''
        if (!proc) continue
        const mp = Number(e.minutesPerDay)
        if (!Number.isFinite(mp)) continue
        const canonAppId = resolveBlockedIdsAgainstInstalled([appId], installedIds)[0] || appId
        out.push({
            appId: canonAppId,
            appName: typeof e.appName === 'string' ? e.appName : proc,
            processName: proc,
            linuxUser: normalizeLinuxUser(e.linuxUser),
            minutesPerDay: Math.max(1, Math.floor(mp))
        })
    }
    return out
}

function getDefaultConfig() {
    const p = path.join(CONFIG_DIR, DEFAULT_JSON_FILE)
    try {
        const st = fs.statSync(p)
        const mtime = Number(st.mtimeMs) || 0
        if (cachedDefaultConfig && mtime === cachedDefaultMtimeMs) return cachedDefaultConfig
        cachedDefaultMtimeMs = mtime
        const raw = fs.readFileSync(p, 'utf8')
        const data = JSON.parse(raw)
        const installedIds = readInstalledDesktopIds()

        const schedule = normalizeScheduleFromDefault(data?.schedule)
        const appControlEnabled = data?.appControl?.enabled !== false
        const blockedResolved = resolveBlockedIdsAgainstInstalled(data?.blockedDesktopIds, installedIds)
        const blockedSet = new Set(blockedResolved)

        const allowedResolved = resolveBlockedIdsAgainstInstalled(
            data?.quotaExemptions?.allowedIds,
            installedIds
        )
        const quotaExemptionsEnabled = data?.quotaExemptions?.enabled === true
        const quotaAllowedIds = new Set()
        if (quotaExemptionsEnabled) {
            for (const id of allowedResolved) {
                if (!blockedSet.has(id)) quotaAllowedIds.add(id)
            }
        }

        const quotas = normalizeQuotaEntriesFromDefault(data?.quota, installedIds)

        cachedDefaultConfig = {
            schedule,
            appControlEnabled,
            blockedDesktopIds: blockedResolved,
            blockedSet,
            quotaExemptionsEnabled,
            quotaAllowedIds,
            quotaEntries: quotas,
            requestDaemonWarningTest: data?.requestDaemonWarningTest === true
        }
        return cachedDefaultConfig
    } catch {
        if (cachedDefaultConfig) return cachedDefaultConfig
        cachedDefaultConfig = {
            schedule: { ...DEFAULT_SCHEDULE },
            appControlEnabled: true,
            blockedDesktopIds: [],
            blockedSet: new Set(),
            quotaExemptionsEnabled: false,
            quotaAllowedIds: new Set(),
            quotaEntries: [],
            requestDaemonWarningTest: false
        }
        return cachedDefaultConfig
    }
}

function readSchedule() {
    return getDefaultConfig().schedule
}

function emptyUsage(today) {
    return { date: today, users: {}, extraAllowanceMinutes: 0, warnedLowScreenTime: false, warnedScreenTimeExhausted: false };
}

function readUsage() {
    const today = localIsoDate();
    const file = path.join(CONFIG_DIR, `usage-${today}.json`);
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data.date !== today) return emptyUsage(today);
        const users = {};
        if (data.users && typeof data.users === 'object') {
            for (const [k, v] of Object.entries(data.users))
                users[k] = { minutes: Math.max(0, Number(v?.minutes) || 0) };
        } else if (data.minutes != null) {
            users[''] = { minutes: Math.max(0, Number(data.minutes) || 0) };
        }
        return {
            date: today, users,
            extraAllowanceMinutes: Math.max(0, Number(data.extraAllowanceMinutes) || 0),
            warnedLowScreenTime: data.warnedLowScreenTime === true,
            warnSnapLimit: data.warnSnapLimit != null ? Number(data.warnSnapLimit) : undefined,
            warnedScreenTimeExhausted: data.warnedScreenTimeExhausted === true
        };
    } catch { return emptyUsage(today); }
}

function writeUsage(usage) {
    const today = localIsoDate();
    const file = path.join(CONFIG_DIR, `usage-${today}.json`);
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(usage, null, 2), 'utf8');
}

function readQuotaUsageState() {
    const today = localIsoDate();
    const file = path.join(CONFIG_DIR, `quota-usage-${today}.json`);
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data.date !== today) return { date: today, usage: {}, appExtra: {} };
        return {
            date: today,
            usage: typeof data.usage === 'object' && data.usage ? { ...data.usage } : {},
            appExtra: typeof data.appExtra === 'object' && data.appExtra ? { ...data.appExtra } : {}
        };
    } catch { return { date: today, usage: {}, appExtra: {} }; }
}

function writeQuotaUsageState(state) {
    const file = path.join(CONFIG_DIR, `quota-usage-${localIsoDate()}.json`);
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}

function readQuotaEntries() {
    return getDefaultConfig().quotaEntries
}

function loadBlockedAppIds() {
    return new Set(getDefaultConfig().blockedDesktopIds)
}

function loadQuotaExemptAppIds() {
    return getDefaultConfig().quotaAllowedIds
}

function readMonitorCatalogEntries() {
    try {
        const c = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'app-monitor-catalog.json'), 'utf8'));
        return Array.isArray(c.apps) ? c.apps : [];
    } catch { return []; }
}

function readAppMonitorUsage() {
    const today = localIsoDate();
    const file = path.join(CONFIG_DIR, `app-usage-${today}.json`);
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data.date === today ? (data.usage ?? {}) : {};
    } catch { return {}; }
}

function writeAppMonitorUsage(usageMap) {
    const today = localIsoDate();
    const file = path.join(CONFIG_DIR, `app-usage-${today}.json`);
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ date: today, usage: usageMap }, null, 2), 'utf8');
}

// --- Password validation (same algorithm as settingsIpc.js) ---

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

let cachedPasswordSecurity = null;
let cachedPasswordSecurityLoaded = false;

function readPasswordSecurity() {
    if (cachedPasswordSecurityLoaded) return cachedPasswordSecurity;
    cachedPasswordSecurityLoaded = true;

    function readJsonSafe(p) {
        try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
    }

    const defaultPath = path.join(CONFIG_DIR, DEFAULT_JSON_FILE);

    const def = readJsonSafe(defaultPath);
    const sec = def && typeof def === 'object' ? def.security : null;
    if (sec && typeof sec === 'object' && typeof sec.passwordHash === 'string' && typeof sec.salt === 'string') {
        cachedPasswordSecurity = { passwordHash: sec.passwordHash, salt: sec.salt };
        return cachedPasswordSecurity;
    }

    cachedPasswordSecurity = { passwordHash: '', salt: '' };
    return cachedPasswordSecurity;
}

function checkParentPassword(plain) {
    const sec = readPasswordSecurity();
    if (!sec.passwordHash) return { ok: false, reason: 'no_password' };
    if (typeof plain !== 'string' || plain.length === 0) return { ok: false, reason: 'invalid' };
    if (hashPassword(plain, sec.salt) !== sec.passwordHash) return { ok: false, reason: 'invalid' };
    return { ok: true };
}

// --- Session detection (ported from graphicalSessionDetect.js) ---

const DESKTOP_COMM_NAMES = ['gnome-shell', 'plasmashell', 'xfce4-session', 'sway', 'Hyprland', 'cinnamon'];

function parseLoginctlSession(text) {
    const props = {};
    for (const line of String(text || '').trim().split('\n')) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        props[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return props;
}

async function userHasDesktopEnvironment(user) {
    for (const name of DESKTOP_COMM_NAMES) {
        try {
            const { stdout } = await execFileAsync('pgrep', ['-u', user, '-x', name], { timeout: 2000 });
            if (String(stdout || '').trim().length > 0) return true;
        } catch { /* process not running */ }
    }
    return false;
}

// VT/manual GNOME starts often report State=idle in loginctl; still a usable graphical session for quotas and warnings.
function logindSessionStateLive(state) {
    const s = String(state || '').trim();
    return s === 'active' || s === 'online' || s === 'idle';
}

async function getActiveGraphicalSessions() {
    try {
        const { stdout } = await execFileAsync('loginctl', ['list-sessions', '--no-legend'], { timeout: 5000 });
        const sessions = [];
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;
            const sid = parts[0];
            const user = parts[2];
            try {
                const { stdout: out2 } = await execFileAsync(
                    'loginctl', ['show-session', sid, '-p', 'Type', '-p', 'State', '-p', 'Class', '-p', 'Remote'],
                    { timeout: 3000 }
                );
                const p = parseLoginctlSession(out2);
                if (p.Class === 'greeter' || p.Class === 'background') continue;
                if (!logindSessionStateLive(p.State)) continue;
                const t = p.Type || '';
                if (t === 'x11' || t === 'wayland' || t === 'mir') {
                    sessions.push({ user, sid });
                } else if (t === 'tty' && p.Class === 'user' && p.Remote !== 'yes' && await userHasDesktopEnvironment(user)) {
                    sessions.push({ user, sid });
                }
            } catch { /* skip session */ }
        }
        return sessions;
    } catch { return []; }
}

function uniqueUsers(sessions) {
    const seen = new Set();
    return sessions.filter(({ user }) => seen.has(user) ? false : seen.add(user)).map(s => s.user);
}

// --- Process control ---

async function pgrepUserProcess(user, processName) {
    try {
        const { stdout } = await execFileAsync('pgrep', ['-u', user, '-x', '-i', processName], { timeout: 3000 });
        return String(stdout || '').trim().length > 0;
    } catch { return false; }
}

async function anyUserRunningProcess(users, processName) {
    for (const u of users) {
        if (await pgrepUserProcess(u, processName)) return true;
    }
    return false;
}

async function pkillAllUsers(users, processName) {
    for (const u of users) {
        try {
            await execFileAsync('pkill', ['-u', u, '-x', '-i', processName], { timeout: 3000 });
            log.info(`pkill OK proc=${processName} user=${u}`);
        } catch { log.info(`pkill noop proc=${processName} user=${u} (already gone)`); }
    }
}

// Terminate (log out) graphical sessions when screen time is exhausted
async function terminateSessionsForPolicy(sessions, targetUser) {
    const toTerminate = sessions.filter(({ user }) => !targetUser || user === targetUser);
    if (toTerminate.length === 0) return;

    for (const { user, sid } of toTerminate) {
        try {
            await execFileAsync('loginctl', ['terminate-session', String(sid)], { timeout: 5000 });
            log.info(`terminate-session sid=${sid} user=${user} OK`);
        } catch (e) { log.error(`terminate-session sid=${sid} user=${user} FAILED: ${e.message}`); }
    }

    // After killing the session, restart the display manager so the greeter reappears.
    // On Wayland the session and greeter share the same VT — without a DM restart the
    // screen stays black. Try display-manager.service (distro-agnostic alias), then
    // fall back to sddm/gdm/lightdm by name.
    await new Promise(r => setTimeout(r, 800));
    const dmServices = ['display-manager', 'sddm', 'gdm', 'lightdm'];
    for (const svc of dmServices) {
        try {
            await execFileAsync('systemctl', ['restart', svc], { timeout: 8000 });
            log.info(`display manager restarted via systemctl restart ${svc}`);
            break;
        } catch { /* try next */ }
    }
}

// --- Exempt-app watchdog ---

// Resolve process names for whitelisted (always-allowed) apps from quota + monitor catalog
function loadExemptAppProcessNames() {
    try {
        const def = getDefaultConfig()
        if (!def.quotaExemptionsEnabled || def.quotaAllowedIds.size === 0) return []
        const ids = def.quotaAllowedIds

        const names = new Map() // appId → processName (first match wins)

        // Prefer processName directly from default.quota entries.
        try {
            for (const q of def.quotaEntries) {
                if (q?.appId && ids.has(q.appId) && q.processName) names.set(q.appId, q.processName.trim())
            }
        } catch { /* ignore */ }

        // Fallback: app-monitor catalog may know processName even without quota entry.
        try {
            const cat = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'app-monitor-catalog.json'), 'utf8'))
            if (Array.isArray(cat.apps)) {
                for (const a of cat.apps) {
                    const id = a.appId || a.id
                    if (id && ids.has(id) && a.processName && !names.has(id)) names.set(id, String(a.processName).trim())
                }
            }
        } catch { /* catalog optional */ }

        return [...names.values()].filter(Boolean)
    } catch { return [] }
}

// Spawn cat processes on every raw input device so we track when the user is at the keyboard/mouse
function startInputMonitor() {
    if (inputMonitorStarted) return;
    inputMonitorStarted = true;
    try {
        const devicesInfo = fs.readFileSync('/proc/bus/input/devices', 'utf8');
        const matches = devicesInfo.match(/Handlers=.*event(\d+)/g) || [];
        const eventIds = matches.map(m => m.match(/\d+/)[0]);
        let started = 0;
        for (const id of eventIds) {
            try {
                const p = spawn('cat', [`/dev/input/event${id}`], { stdio: ['ignore', 'pipe', 'ignore'] });
                p.stdout.on('data', () => { lastInputTimestamp = Date.now(); });
                p.on('error', () => { /* device may not be readable */ });
                started++;
            } catch { /* skip unreadable device */ }
        }
        log.info(`exempt watchdog: input monitor started on ${started}/${eventIds.length} devices`);
    } catch (e) { log.warn(`exempt watchdog: input monitor failed: ${e.message}`); }
}

// Sum utime+stime jiffies for all PIDs of a named process
function getExemptAppJiffies(processName) {
    try {
        const r = spawnSync('pgrep', ['-x', '-i', processName], { encoding: 'utf8', timeout: 2000 });
        const pids = (r.stdout || '').trim().split('\n').filter(Boolean);
        let total = 0;
        for (const pid of pids) {
            try {
                const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
                total += (parseInt(stat[13]) || 0) + (parseInt(stat[14]) || 0);
            } catch { /* pid may have exited */ }
        }
        return total;
    } catch { return 0; }
}

// Returns true if any exempt app is running AND actively responding to the user's input.
// Updates exemptAppJiffies cache as a side-effect (must be called every tick).
function isExemptAppActivelyUsed(processNames) {
    const recentInput = (Date.now() - lastInputTimestamp) < WD_INPUT_WINDOW_MS;
    let anyActive = false;
    for (const proc of processNames) {
        const current = getExemptAppJiffies(proc);
        const prev = exemptAppJiffies[proc] || 0;
        const delta = current - prev;
        exemptAppJiffies[proc] = current;
        // Active = app has a process AND it consumed CPU AND input happened recently
        if (current > 0 && recentInput && delta >= WD_CPU_MIN_JIFFIES) anyActive = true;
    }
    return anyActive;
}

// Send a desktop notification to the active user via sudo+notify-send (same lift as spawnWarningWindow and notifyOrSpawn).
function sendExemptWatchdogNotification(message, info) {
    try {
        const notifyEnv = buildNotifySendEnvPairs(info);
        const { user } = info;
        const r = spawnSync(
            'sudo',
            [
                '-u', user, 'env', ...notifyEnv, NOTIFY_SEND_BIN,
                '-a', NOTIFY_APP_NAME, '-u', 'critical', '-t', '8000',
                NOTIFY_APP_NAME, message
            ],
            { timeout: 5000, encoding: 'utf8' }
        );
        if (r.error) log.warn(`notify-send (watchdog) spawn error: ${r.error.message}`);
        if (r.status !== 0) log.warn(`notify-send (watchdog) failed status=${r.status} stderr=${String(r.stderr || '').trim()}`);
    } catch (e) {
        log.warn(`notify-send (watchdog): ${e && e.message ? e.message : String(e)}`);
    }
}

// Called every tick when screen time is expired and exempt apps are configured.
// Returns true  → logout should be BLOCKED (user is using exempt app or still in grace period).
// Returns false → logout should PROCEED (grace period exhausted).
async function runExemptWatchdog(processNames) {
    const activelyUsed = isExemptAppActivelyUsed(processNames);

    if (activelyUsed) {
        wdExemptActiveTicks++;
        // Only reset the warning cycle after 2 consecutive ticks of genuine exempt-app usage
        // to prevent background CPU blips from spuriously restarting the countdown.
        if (wdFirstWarnAt !== 0 && wdExemptActiveTicks >= 2) {
            log.info('exempt watchdog: activity resumed in exempt app — logout blocked, warning cycle reset');
            wdWarnCount = 0; wdFirstWarnAt = 0; wdLastWarnAt = 0;
        }
        return true;
    }
    wdExemptActiveTicks = 0;

    const now = Date.now();
    const recentInput = (now - lastInputTimestamp) < WD_INPUT_WINDOW_MS;

    if (!recentInput) {
        // No input anywhere: user may be reading/watching — give benefit of the doubt
        // but still enforce the grace period if a warning cycle is already running
        if (wdFirstWarnAt === 0) return true; // no cycle started yet, keep blocking
        if (now - wdFirstWarnAt < WD_GRACE_MS) return true; // still within grace
        log.info('exempt watchdog: grace period exhausted (user idle) — logout will proceed');
        return false;
    }

    // Input is happening but NOT in the exempt app — start / continue warning cycle
    if (wdFirstWarnAt === 0) {
        wdFirstWarnAt = now;
        log.info(`exempt watchdog: input detected outside exempt app — grace period started (${WD_GRACE_MS / 1000}s)`);
    }

    const elapsed = now - wdFirstWarnAt;
    if (elapsed >= WD_GRACE_MS) {
        log.info('exempt watchdog: grace period exhausted — logout will proceed');
        return false;
    }

    // Send up to WD_WARN_MAX notifications spaced WD_WARN_INTERVAL_MS apart
    if (wdWarnCount < WD_WARN_MAX && (now - wdLastWarnAt) >= WD_WARN_INTERVAL_MS) {
        wdWarnCount++;
        wdLastWarnAt = now;
        const remainingMs = Math.max(0, WD_GRACE_MS - elapsed);
        const remainingSec = Math.floor(remainingMs / 1000);
        const remainingText = remainingSec > 0 ? `${remainingSec} Sekunden` : 'unter 1 Sekunde';
        const msg = `Warnung ${wdWarnCount}/${WD_WARN_MAX} (Screen-Time erschöpft): Kehre zur erlaubten App zurück! Logout in ${remainingText}.`;
        log.warn(`exempt watchdog: warning ${wdWarnCount}/${WD_WARN_MAX} sent`);
        const info = getFirstActiveUserInfo();
        if (info) sendExemptWatchdogNotification(msg, info);
    }

    return true; // still within grace period
}

// --- Socket broadcast helpers ---

function broadcast(msg) {
    const line = JSON.stringify(msg) + '\n';
    for (const c of clients) {
        try { c.write(line); } catch { /* ignore disconnected client */ }
    }
}

// Notify connected clients about a warning event (they will show the Electron warning window)
function broadcastWarn(payload) {
    broadcast({ type: 'warn', ...payload });
}

// --- Warning window spawning (for when the Electron UI is not connected) ---

// Resolve the installed Electron app executable path
function findElectronExecPath() {
    try {
        const stored = fs.readFileSync('/etc/life-parental/.electron-exec', 'utf8').trim();
        if (stored && fs.existsSync(stored)) return stored;
    } catch { /* ignore */ }
    const candidates = [
        '/opt/LiFE_Parental_Control/life-parental-control',
        '/opt/life-parental-control/life-parental-control',
        '/opt/LiFE Parental Control/life-parental-control',
        '/usr/bin/life-parental-control',
        '/usr/local/bin/life-parental-control',
    ];
    for (const c of candidates) { if (fs.existsSync(c)) return c; }
    return null;
}

function queryLoginctlSessionFields(sessionId) {
    try {
        const { stdout } = spawnSync('loginctl', [
            'show-session', String(sessionId),
            '-p', 'Type', '-p', 'Display', '-p', 'State', '-p', 'Class', '-p', 'Remote'
        ], { encoding: 'utf8', timeout: 3000 });
        const p = parseLoginctlSession(stdout || '');
        return {
            type: p.Type || '',
            display: p.Display || '',
            state: p.State || '',
            class: p.Class || '',
            remote: p.Remote || ''
        };
    } catch {
        return { type: '', display: '', state: '', class: '', remote: '' };
    }
}

function userHasDesktopEnvironmentSync(user) {
    for (const name of DESKTOP_COMM_NAMES) {
        try {
            const r = spawnSync('pgrep', ['-u', user, '-x', name], { encoding: 'utf8', timeout: 2000 });
            if (String(r.stdout || '').trim().length > 0) return true;
        } catch { /* process not running */ }
    }
    return false;
}

function waylandSocketName(uid) {
    let waylandDisplay = 'wayland-0';
    try {
        const files = fs.readdirSync(`/run/user/${uid}`);
        const wl = files.find(f => /^wayland-\d+$/.test(f));
        if (wl) waylandDisplay = wl;
    } catch { /* ignore */ }
    return waylandDisplay;
}

function getUnixHomeDir(user) {
    try {
        const { stdout } = spawnSync('getent', ['passwd', user], { encoding: 'utf8', timeout: 2000 });
        const line = String(stdout || '').trim().split('\n')[0];
        if (!line) return `/home/${user}`;
        const parts = line.split(':');
        if (parts.length >= 6 && parts[5]) return parts[5];
    } catch { /* ignore */ }
    return `/home/${user}`;
}

// Prefer systemd session env (same cookie GNOME/KDE/SDDM use); then known file locations.
function querySessionXauthorityFromLogind(sessionId) {
    if (sessionId == null || sessionId === '') return '';
    try {
        const { stdout } = spawnSync('loginctl', ['show-session', String(sessionId), '-p', 'Environment'], { encoding: 'utf8', timeout: 3000 });
        const m = String(stdout || '').match(/(?:^|\s)XAUTHORITY=(\S+)/);
        if (m && m[1]) {
            const p = m[1].trim();
            try {
                if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
    return '';
}

function findUserXauthorityPath(uid, homeDir) {
    const runUser = `/run/user/${uid}`;
    const candidates = [
        path.join(runUser, 'gdm', 'Xauthority'),
        path.join(runUser, 'sddm', 'Xauthority'),
        path.join(runUser, 'lightdm', 'Xauthority'),
        path.join(String(homeDir), '.Xauthority'),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch { /* ignore */ }
    }
    try {
        for (const name of fs.readdirSync(runUser)) {
            const full = path.join(runUser, name);
            let st;
            try { st = fs.statSync(full); } catch { continue; }
            if (!st.isFile()) continue;
            if (/^\.mutter-Xwayland-auth/.test(name)) return full;
            if (/^xauth/i.test(name)) return full;
        }
    } catch { /* ignore */ }
    return '';
}

function resolveXauthorityForX11Session(sessionId, uid, homeDir) {
    const fromLogind = querySessionXauthorityFromLogind(sessionId);
    if (fromLogind) return fromLogind;
    return findUserXauthorityPath(uid, homeDir);
}

const SKIP_LOGIN_USERS = new Set(['gdm', 'lightdm', 'sddm', 'lxdm', 'display', 'Debian-gdm']);

// Same rules as getActiveGraphicalSessions (active/online, not greeter) so Wayland is not mistaken for blind X11 :0.
function trySessionToActiveUserInfo(sessionId, uid, user) {
    if (!user || user === 'root') return null;
    if (uid === '0') return null;
    if (SKIP_LOGIN_USERS.has(user)) return null;
    const p = queryLoginctlSessionFields(sessionId);
    if (p.class === 'greeter' || p.class === 'background') return null;
    if (!logindSessionStateLive(p.state)) return null;
    let hasWl = false;
    try {
        const files = fs.readdirSync(`/run/user/${uid}`);
        hasWl = files.some(f => /^wayland-\d+$/.test(f));
    } catch { /* ignore */ }
    if (p.type === 'wayland') {
        return {
            user,
            uid,
            sessionId,
            sessionKind: 'wayland',
            waylandDisplay: waylandSocketName(uid),
            x11Display: ''
        };
    }
    if (p.type === 'x11') {
        const x11 = p.display && /^:[0-9]+(\.[0-9]+)?$/.test(p.display) ? p.display : ':0';
        return {
            user,
            uid,
            sessionId,
            sessionKind: 'x11',
            waylandDisplay: '',
            x11Display: x11
        };
    }
    if (p.type === 'mir' && hasWl) {
        return {
            user,
            uid,
            sessionId,
            sessionKind: 'wayland',
            waylandDisplay: waylandSocketName(uid),
            x11Display: ''
        };
    }
    if (p.type === 'tty' && p.class === 'user' && p.remote !== 'yes') {
        if (hasWl) {
            return {
                user,
                uid,
                sessionId,
                sessionKind: 'wayland',
                waylandDisplay: waylandSocketName(uid),
                x11Display: ''
            };
        }
        if (userHasDesktopEnvironmentSync(user)) {
            const x11 = p.display && /^:[0-9]+(\.[0-9]+)?$/.test(p.display) ? p.display : ':0';
            return {
                user,
                uid,
                sessionId,
                sessionKind: 'x11',
                waylandDisplay: '',
                x11Display: x11
            };
        }
        let runUserDirExists = false;
        try {
            runUserDirExists = fs.existsSync(`/run/user/${uid}`);
        } catch { /* ignore */ }
        // Manually started desktops often keep logind Type=tty; still attempt warn spawn when user runtime exists.
        if (runUserDirExists) {
            const x11Hint = p.display && /^:[0-9]+(\.[0-9]+)?$/.test(p.display) ? p.display : '';
            if (x11Hint) {
                return {
                    user,
                    uid,
                    sessionId,
                    sessionKind: 'x11',
                    waylandDisplay: '',
                    x11Display: x11Hint
                };
            }
            return {
                user,
                uid,
                sessionId,
                sessionKind: 'wayland',
                waylandDisplay: waylandSocketName(uid),
                x11Display: ''
            };
        }
    }
    return null;
}

function listActiveUserInfos() {
    const out = [];
    try {
        const { stdout } = spawnSync('loginctl', ['list-sessions', '--no-legend'], { encoding: 'utf8', timeout: 3000 });
        for (const line of (stdout || '').trim().split('\n').filter(Boolean)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;
            const sessionId = parts[0];
            const uid = parts[1];
            const user = parts[2];
            const info = trySessionToActiveUserInfo(sessionId, uid, user);
            if (info) out.push(info);
        }
    } catch { /* ignore */ }
    return out;
}

/** Prefer schedule.screenTimeLinuxUser so daemon warnings go to the child session when multiple desktops are logged in (e.g. GNOME + KDE on another TTY). */
function preferredLinuxUserForWarnings() {
    return normalizeLinuxUser(readSchedule().screenTimeLinuxUser);
}

// loginctl list-sessions is ordered by ascending id; list[0] was always the oldest login (often wrong VT when two users are on seat0).
function pickLatestSessionById(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const sorted = [...list].sort((a, b) => (Number(b.sessionId) || 0) - (Number(a.sessionId) || 0));
    const chosen = sorted[0];
    log.info(`getFirstActiveUserInfo: chosen sessionId=${chosen.sessionId} user=${chosen.user} (${list.length} candidates; prefer highest session id)`);
    return chosen;
}

function getFirstActiveUserInfo() {
    const list = listActiveUserInfos();
    if (!list.length) return null;
    const pref = preferredLinuxUserForWarnings();
    if (pref) {
        const hit = list.find((s) => s.user === pref);
        if (hit) {
            log.info(`getFirstActiveUserInfo: using schedule.screenTimeLinuxUser session user=${pref} sid=${hit.sessionId}`);
            return hit;
        }
        log.warn(`getFirstActiveUserInfo: no active session for screenTimeLinuxUser=${pref} (have: ${list.map((s) => s.user).join(', ')}); using ranked session`);
    } else if (list.length > 1) {
        log.info(`getFirstActiveUserInfo: ${list.length} active graphical sessions; set schedule.screenTimeLinuxUser to pin daemon warnings/notify-send to that login`);
    }
    return pickLatestSessionById(list);
}

// Logind Environment keys merged into warning spawn (session identity for GNOME vs KDE; after base, before DISPLAY/WAYLAND).
const WARNING_LOGIND_ENV_KEYS = ['XDG_CURRENT_DESKTOP'];

// Prefer loginctl session Environment for notify-send so WAYLAND_DISPLAY matches the real compositor (our socket guess can be wrong).
const NOTIFY_SEND_LOGIND_ENV_KEYS = [
    'XDG_CURRENT_DESKTOP',
    'WAYLAND_DISPLAY',
    'DISPLAY',
    'GDK_BACKEND',
    'GNOME_SETUP_DISPLAY',
    'DESKTOP_SESSION',
    'XDG_SESSION_DESKTOP'
];

function envPairsFromLoginctlSessionEnvironment(sessionId, keys) {
    const pairs = [];
    if (sessionId == null || sessionId === '') return pairs;
    try {
        const { stdout } = spawnSync('loginctl', ['show-session', String(sessionId), '-p', 'Environment'], { encoding: 'utf8', timeout: 3000 });
        const s = String(stdout || '');
        for (const k of keys) {
            const re = new RegExp(`(?:^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(\\S+)`);
            const m = s.match(re);
            if (m && m[1]) pairs.push(`${k}=${m[1]}`);
        }
    } catch { /* ignore */ }
    return pairs;
}

// Env for systemd-spawned --warning-mode only (deb or AppImage × X11 or Wayland); main UI uses a different code path.
function buildWarningWindowEnvPairs(info, homeDir, xauthorityPath, isAppImage, execPath) {
    const { uid, sessionKind, waylandDisplay, x11Display, sessionId, user } = info;
    const basePairs = [
        `XDG_RUNTIME_DIR=/run/user/${uid}`,
        `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`,
        `HOME=${homeDir}`,
        `USER=${user}`,
        `LOGNAME=${user}`
    ];
    const forkPairs = envPairsFromLoginctlSessionEnvironment(sessionId, WARNING_LOGIND_ENV_KEYS);
    const sessionPairs =
        sessionKind === 'x11'
            ? [
                `DISPLAY=${x11Display}`,
                'XDG_SESSION_TYPE=x11',
                'ELECTRON_OZONE_PLATFORM_HINT=x11',
                ...(xauthorityPath ? [`XAUTHORITY=${xauthorityPath}`] : [])
            ]
            : [
                `WAYLAND_DISPLAY=${waylandDisplay}`,
                'XDG_SESSION_TYPE=wayland',
                'ELECTRON_OZONE_PLATFORM_HINT=wayland'
            ];
    const appImagePairs = isAppImage
        ? [`APPIMAGE=${execPath}`, 'APPIMAGE_EXTRACT_AND_RUN=1', 'APPIMAGELAUNCHER_DISABLE=1']
        : [];
    return [...basePairs, ...forkPairs, ...sessionPairs, ...appImagePairs];
}

// notify-send needs the same Wayland/X11 session identity as the compositor; merge logind Environment so DISPLAY/WAYLAND match gnome-shell.
function buildNotifySendEnvPairs(info) {
    const { uid, user, sessionKind, waylandDisplay, x11Display, sessionId } = info;
    const homeDir = getUnixHomeDir(user);
    const m = new Map([
        ['PATH', '/usr/bin:/bin:/usr/local/bin'],
        ['XDG_RUNTIME_DIR', `/run/user/${uid}`],
        ['DBUS_SESSION_BUS_ADDRESS', `unix:path=/run/user/${uid}/bus`],
        ['HOME', homeDir],
        ['USER', user],
        ['LOGNAME', user]
    ]);
    for (const kv of envPairsFromLoginctlSessionEnvironment(sessionId, NOTIFY_SEND_LOGIND_ENV_KEYS)) {
        const eq = kv.indexOf('=');
        if (eq === -1) continue;
        m.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
    if (sessionKind === 'x11') {
        if (!m.has('DISPLAY')) m.set('DISPLAY', x11Display);
        m.set('XDG_SESSION_TYPE', 'x11');
    } else {
        if (!m.has('WAYLAND_DISPLAY')) m.set('WAYLAND_DISPLAY', waylandDisplay);
        m.set('XDG_SESSION_TYPE', 'wayland');
    }
    return [...m.entries()].map(([k, v]) => `${k}=${v}`);
}

// PID of currently running warning window (spawned by daemon)
let warningWindowPid = null;

// Spawn the Electron app as the desktop user in --warning-mode for interactive time extension
function spawnWarningWindow(payload, sessionInfo) {
    log.info(`spawnWarningWindow called type=${payload.type || '?'} clients=${clients.size}`);

    // End previous warning-mode process so a new notification always gets a window (notify-send has no such skip).
    if (warningWindowPid != null) {
        try {
            process.kill(warningWindowPid, 'SIGTERM');
        } catch { /* ESRCH: already gone */ }
        warningWindowPid = null;
    }

    const execPath = findElectronExecPath();
    if (!execPath) {
        log.error('spawnWarningWindow FAILED: Electron executable not found (checked /etc/life-parental/.electron-exec and fallback paths)');
        return;
    }
    log.info(`spawnWarningWindow execPath=${execPath}`);

    const info = sessionInfo === undefined ? getFirstActiveUserInfo() : sessionInfo;
    if (!info) {
        log.error('spawnWarningWindow FAILED: no active graphical session found via loginctl');
        return;
    }

    const { user, uid, sessionKind, waylandDisplay, x11Display, sessionId } = info;
    const homeDir = getUnixHomeDir(user);
    const xauthorityPath = sessionKind === 'x11' ? resolveXauthorityForX11Session(sessionId, uid, homeDir) : '';
    log.info(`spawnWarningWindow session user=${user} uid=${uid} kind=${sessionKind} wl=${waylandDisplay || '-'} x11=${x11Display || '-'}`);

    const payloadArg = `--warning-mode=${JSON.stringify(payload)}`;
    const isAppImage = execPath.toLowerCase().endsWith('.appimage');
    const pkgKind = isAppImage ? 'appimage' : 'deb';
    log.info(`spawnWarningWindow pkg=${pkgKind} session=${sessionKind}`);

    const envPairs = buildWarningWindowEnvPairs(info, homeDir, xauthorityPath, isAppImage, execPath);
    if (sessionKind === 'x11') {
        if (xauthorityPath) {
            log.info(`spawnWarningWindow X11 XAUTHORITY=${xauthorityPath}`);
        } else {
            log.warn(`spawnWarningWindow X11: no Xauthority cookie found for uid=${uid} home=${homeDir} (Electron may exit immediately)`);
        }
    }
    const appArgs = [
        ...(isAppImage ? ['--appimage-extract-and-run'] : []),
        '--no-sandbox',
        payloadArg
    ];

    log.info(`spawnWarningWindow spawning: sudo -u ${user} env [${envPairs.slice(0,3).join(' ')}...] ${execPath} --no-sandbox --warning-mode=...`);
    const child = spawn('sudo', ['-u', user, 'env', ...envPairs, execPath, ...appArgs], {
        detached: true, stdio: 'ignore'
    });
    if (!child.pid) {
        log.error('spawnWarningWindow FAILED: spawn returned no PID');
        return;
    }
    warningWindowPid = child.pid;
    log.info(`spawnWarningWindow spawned PID=${child.pid} user=${user} type=${payload.type || '?'}`);
    child.on('error', (e) => {
        log.error(`spawnWarningWindow spawn error PID=${child.pid}: ${e.message}`);
        if (warningWindowPid === child.pid) warningWindowPid = null;
    });
    child.on('exit', (code) => {
        if (warningWindowPid === child.pid) warningWindowPid = null;
        log.info(`spawnWarningWindow PID=${child.pid} exited code=${code}`);
    });
    child.unref();
}

// Notify connected clients AND always spawn a user-context warning window.
// Root Electron cannot reliably open windows on the user's Wayland session,
// so the --warning-mode process (running as desktop user) handles the actual UI.
function notifyOrSpawn(payload, notifySummary, notifyBody, urgency = 'normal', skipWindow = false) {
    broadcastWarn(payload); // broadcast to connected clients (for status/dashboard updates)
    const info = getFirstActiveUserInfo();
    if (!skipWindow) spawnWarningWindow(payload, info);
    // notify-send must use the same session as the window (same sudo -u + env as Electron); runuser often targets a different bus.
    if (!info) return;
    try {
        const { user } = info;
        const notifyEnv = buildNotifySendEnvPairs(info);
        const r = spawnSync(
            'sudo',
            [
                '-u', user, 'env', ...notifyEnv, NOTIFY_SEND_BIN,
                '-a', NOTIFY_APP_NAME, '-u', urgency, '-t', '30000',
                notifySummary, notifyBody
            ],
            { timeout: 5000, encoding: 'utf8' }
        );
        if (r.error) log.warn(`notify-send spawn error: ${r.error.message}`);
        if (r.status !== 0) {
            log.warn(`notify-send failed status=${r.status} stderr=${String(r.stderr || '').trim()}`);
        } else {
            const err = String(r.stderr || '').trim();
            if (err) log.info(`notify-send stderr (non-fatal): ${err}`);
            log.info(`notify-send ok sid=${info.sessionId} user=${user} wl=${info.waylandDisplay || '-'}`);
        }
    } catch (e) {
        log.warn(`notify-send: ${e && e.message ? e.message : String(e)}`);
    }
}

// --- Enforcement tick helpers ---

function isoWeekday(d) {
    const n = d.getDay();
    return n === 0 ? 7 : n; // 1=Mon … 7=Sun
}

function isWithinAllowedHours(s, now) {
    const [sh, sm] = String(s.allowedHoursStart || '07:00').split(':').map(Number);
    const [eh, em] = String(s.allowedHoursEnd || '22:00').split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    const nowT = now.getHours() * 60 + now.getMinutes();
    if (start <= end) return nowT >= start && nowT <= end;
    return nowT >= start || nowT <= end; // midnight wrap
}

function atLoggedMinuteBoundary() {
    tickInMinute = (tickInMinute + 1) % TICKS_PER_LOGGED_MINUTE;
    return tickInMinute === 0;
}

function ensureUserMinutes(usage, key) {
    if (!usage.users || typeof usage.users !== 'object') usage.users = {};
    if (!usage.users[key]) usage.users[key] = { minutes: 0 };
}

// --- Screen time enforcement ---

async function tickScreenTime(logMinute) {
    const s = readSchedule();
    const now = new Date();
    const today = localIsoDate(now);
    const weekday = isoWeekday(now);
    const sessions = await getActiveGraphicalSessions();
    const activeUsers = uniqueUsers(sessions);
    const limitLu = normalizeLinuxUser(s.screenTimeLinuxUser);
    const hasSessionForLimit = limitLu ? activeUsers.includes(limitLu) : activeUsers.length > 0;

    let usage = readUsage();
    if (usage.date !== today) usage = emptyUsage(today);

    // Accrue screen time every full minute when the target user has an active session
    if (limitLu) {
        if (logMinute && activeUsers.includes(limitLu)) {
            ensureUserMinutes(usage, limitLu);
            usage.users[limitLu].minutes = Math.max(0, Number(usage.users[limitLu].minutes) || 0) + 1;
        }
    } else if (logMinute && activeUsers.length > 0) {
        ensureUserMinutes(usage, '');
        usage.users[''].minutes = Math.max(0, Number(usage.users[''].minutes) || 0) + 1;
    }
    usage.date = today;

    const minutes = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
    const limitBase = Math.max(0, Number(s.dailyLimitMinutes) || 0);
    const extra = Math.max(0, Number(usage.extraAllowanceMinutes) || 0);
    const limit = limitBase + extra;

    if (!s.enabled) {
        writeUsage(usage);
        broadcast({ type: 'status', screenTime: { enabled: false, minutes, limitMinutes: limit, remaining: limit - minutes } });
        return;
    }

    // Enforce allowed hours window; terminate session if outside allowed hours
    if (s.allowedHoursEnabled && Array.isArray(s.allowedDays) && s.allowedDays.includes(weekday)) {
        if (!isWithinAllowedHours(s, now)) {
            writeUsage(usage);
            await terminateSessionsForPolicy(sessions, limitLu);
            if (Date.now() - lastAllowedHoursWarnAt >= ALLOWED_HOURS_WARN_INTERVAL_MS) {
                lastAllowedHoursWarnAt = Date.now();
                const warnPayload = { type: 'allowed-hours', heading: 'Computer jetzt nicht erlaubt', message: 'Die Computernutzung ist zu dieser Zeit nicht gestattet.' };
                notifyOrSpawn(warnPayload, 'Computer jetzt nicht erlaubt', 'Die Computernutzung ist zu dieser Zeit nicht gestattet.', 'critical');
            }
            return;
        }
    }

    if (!s.dailyLimitEnabled) {
        writeUsage(usage);
        return;
    }

    // Reset stale low-warning flag when time was extended or remaining grew
    if (usage.warnedLowScreenTime) {
        const remainingCheck = limit - minutes;
        const snap = usage.warnSnapLimit;
        if (remainingCheck > 5 || snap == null || Number(snap) !== Number(limit)) {
            usage.warnedLowScreenTime = false;
            delete usage.warnSnapLimit;
        }
    }

    const remaining = limit - minutes;

    if (logMinute) log.info(`screenTime sessions=${sessions.length} users=[${activeUsers.join(',')}] minutes=${minutes} limit=${limit} remaining=${remaining} limitEnabled=${s.dailyLimitEnabled}`);

    if (remaining <= 0) {
        const exemptProcs = loadExemptAppProcessNames();
        if (exemptProcs.length > 0) {
            // Exempt apps configured: watchdog decides whether to block or allow the logout
            startInputMonitor();
            const blocked = await runExemptWatchdog(exemptProcs);
            if (!blocked) {
                resetExemptWatchdogState();
                await terminateSessionsForPolicy(sessions, limitLu);
                if (!usage.warnedScreenTimeExhausted) {
                    usage.warnedScreenTimeExhausted = true;
                    broadcastWarn({ type: 'exhausted', effectiveLimit: limit, usedMinutes: minutes, remaining: 0 });
                }
            }
        } else {
            // No exempt apps: terminate immediately
            await terminateSessionsForPolicy(sessions, limitLu);
            if (!usage.warnedScreenTimeExhausted) {
                usage.warnedScreenTimeExhausted = true;
                const warnPayload = { type: 'exhausted', effectiveLimit: limit, usedMinutes: minutes, remaining: 0 };
                notifyOrSpawn(warnPayload, 'Bildschirmzeit aufgebraucht', `Tageslimit von ${limit} Min. erreicht.`, 'critical');
            }
        }
    } else {
        // Time still available: reset watchdog warning cycle so it fires fresh next expiry
        if (wdFirstWarnAt !== 0) { wdWarnCount = 0; wdFirstWarnAt = 0; wdLastWarnAt = 0; wdExemptActiveTicks = 0; }
        if (usage.warnedScreenTimeExhausted) usage.warnedScreenTimeExhausted = false;
        if (remaining >= 1 && remaining <= 5 && !usage.warnedLowScreenTime && hasSessionForLimit) {
            usage.warnedLowScreenTime = true;
            usage.warnSnapLimit = limit;
            const warnPayload = { type: 'low', effectiveLimit: limit, usedMinutes: minutes, remaining };
            notifyOrSpawn(warnPayload, 'Bildschirmzeit fast aufgebraucht', `Noch ${remaining} Min. übrig heute.`, 'normal');
        }
    }

    writeUsage(usage);
    broadcast({ type: 'status', screenTime: { enabled: true, dailyLimitEnabled: true, minutes, limitMinutes: limit, remaining: Math.max(0, remaining) } });
}

// --- App quota enforcement ---

function resetAppQuotaWarnIfNewDay() {
    const t = localIsoDate();
    if (t !== quotaWarnDate) {
        quotaWarnDate = t;
        appQuotaWarnOnce.clear();
        quotaLinuxUserNoSessionWarnOnce.clear();
    }
}

async function tickAppQuotas(logMinute) {
    const def = getDefaultConfig();
    resetAppQuotaWarnIfNewDay();
    const quotas = readQuotaEntries();
    if (def.appControlEnabled !== true) {
        if (quotas.length > 0 && !quotaTickSkippedAppControlWarned) {
            quotaTickSkippedAppControlWarned = true;
            log.warn('daemon: quotas not applied — appControl.enabled is false in default.json (enable App-Kontrolle / App Control for counting and enforcement)');
        }
        return;
    }
    if (quotas.length === 0) return;
    const exempt = loadQuotaExemptAppIds();
    const sessions = await getActiveGraphicalSessions();
    const activeUsers = uniqueUsers(sessions);
    if (activeUsers.length === 0) {
        if (!quotaTickSkippedNoGraphicalSessionsWarned) {
            quotaTickSkippedNoGraphicalSessionsWarned = true;
            log.warn('daemon: quotas stay at 0 — no active graphical loginctl sessions (activeUsers empty). "All users" still needs at least one desktop session listed by loginctl list-sessions.');
        }
        return;
    }

    const state = readQuotaUsageState();
    const today = localIsoDate();
    if (state.date !== today) { state.date = today; state.usage = {}; state.appExtra = {}; }
    const appUsage = state.usage;
    const appExtra = state.appExtra;

    for (const q of quotas) {
        const appId = q.appId || '';
        const proc = String(q.processName || '').trim();
        const baseLimit = Math.max(1, Math.floor(Number(q.minutesPerDay) || 60));
        const name = q.appName || proc;
        const lu = normalizeLinuxUser(q.linuxUser);
        if (!proc || !appId) continue;

        const usersForQuota = lu ? activeUsers.filter(u => u === lu) : activeUsers;
        if (lu && usersForQuota.length === 0) {
            const wk = `${appId}:${lu}`;
            if (!quotaLinuxUserNoSessionWarnOnce.has(wk)) {
                quotaLinuxUserNoSessionWarnOnce.add(wk);
                log.warn(`quota ${name}: linuxUser=${lu} has no active graphical session in loginctl (active: ${activeUsers.join(', ') || 'none'}). Minutes stay 0; set Quota linuxUser to the desktop user who runs this app (same as their GNOME login).`);
            }
            continue;
        }
        const isRunning = usersForQuota.length > 0 && await anyUserRunningProcess(usersForQuota, proc);
        const uk = quotaUsageKey(appId, lu);
        const bonus = quotaBonusMinutes(appExtra, appId, lu);
        const limit = baseLimit + bonus;
        const usedBefore = quotaUsedMinutes(appUsage, appId, lu);

        // When usage was reset to 0, clear warn-once flags so warnings fire again in the new session
        if (usedBefore === 0) {
            for (const k of appQuotaWarnOnce) { if (k.startsWith(uk + ':')) appQuotaWarnOnce.delete(k); }
        }

        if (logMinute) log.info(`quota app=${name} proc=${proc} running=${isRunning} used=${usedBefore} limit=${limit} bonus=${bonus}`);

        if (isRunning) {
            if (!exempt.has(appId) && usedBefore >= limit) {
                const key = `${uk}:kill`;
                if (!appQuotaWarnOnce.has(key)) {
                    appQuotaWarnOnce.add(key);
                    const warnPayload = { type: 'app-exhausted', appId, appName: name, processName: proc, effectiveLimit: limit, usedMinutes: usedBefore, linuxUser: lu || undefined };
                    notifyOrSpawn(warnPayload, `${name}: Zeit aufgebraucht`, `Tageslimit von ${limit} Min. erreicht.`, 'critical');
                }
                await pkillAllUsers(usersForQuota, proc);
            } else if (!exempt.has(appId) && usedBefore === limit - 1) {
                if (logMinute) {
                    appUsage[uk] = limit;
                    const k = `${uk}:final`;
                    if (!appQuotaWarnOnce.has(k)) {
                        appQuotaWarnOnce.add(k);
                        const warnPayload = { type: 'app-final', appId, appName: name, processName: proc, effectiveLimit: limit, usedMinutes: usedBefore, linuxUser: lu || undefined };
                        notifyOrSpawn(warnPayload, `${name}: Letzte Minute`, `Letzte Minute für ${name}. Arbeit speichern!`, 'normal');
                    }
                }
            } else if (logMinute) {
                appUsage[uk] = usedBefore + 1;
            }
        }

        const used = quotaUsedMinutes(appUsage, appId, lu);
        const remaining = limit - used;

        if (remaining === 2 && isRunning && !exempt.has(appId) && limit >= 3) {
            const k = `${uk}:2`;
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k);
                const low2Payload = { type: 'app-low', appId, appName: name, processName: proc, effectiveLimit: limit, usedMinutes: used, remaining: 2, linuxUser: lu || undefined };
                notifyOrSpawn(low2Payload, `${name}: Zeit fast aufgebraucht`, `Noch 2 Min. für ${name}.`, 'normal');
            }
        } else if (remaining === 5 && isRunning) {
            const k = `${uk}:5`;
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k);
                const low5Payload = { type: 'app-five', appId, appName: name, processName: proc, effectiveLimit: limit, usedMinutes: used, remaining: 5, linuxUser: lu || undefined };
                notifyOrSpawn(low5Payload, `${name}: Zeit fast aufgebraucht`, `Noch 5 Min. für ${name}.`, 'normal');
            }
        }
    }

    state.usage = appUsage;
    state.appExtra = appExtra;
    writeQuotaUsageState(state);
}

// --- App monitor (usage tracking without enforcement) ---

async function tickAppMonitor(logMinute) {
    const entries = readMonitorCatalogEntries();
    if (!entries.length) return;
    const sessions = await getActiveGraphicalSessions();
    const activeUsers = uniqueUsers(sessions);
    if (activeUsers.length === 0) return;

    let track = readAppMonitorUsage();
    if (typeof track !== 'object' || track === null) track = {};
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const appId = entry.appId || entry.id || '';
        const proc = String(entry.processName || '').trim();
        if (!appId || !proc) continue;
        if (await anyUserRunningProcess(activeUsers, proc) && logMinute) track[appId] = (track[appId] || 0) + 1;
    }
    writeAppMonitorUsage(track);
}

// --- Main tick function ---

function clearRequestDaemonWarningTestFlag() {
    const p = path.join(CONFIG_DIR, DEFAULT_JSON_FILE);
    try {
        const raw = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(raw);
        if (data.requestDaemonWarningTest !== true) return;
        delete data.requestDaemonWarningTest;
        const tmp = path.join(CONFIG_DIR, `.default.json.tmp-daemon-${process.pid}-${Date.now()}`);
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmp, p);
        cachedDefaultConfig = null;
        cachedDefaultMtimeMs = 0;
    } catch (e) {
        log.warn(`clearRequestDaemonWarningTestFlag: ${e && e.message ? e.message : String(e)}`);
    }
}

function maybeHandleDaemonWarningTestRequest() {
    let want;
    try {
        want = getDefaultConfig().requestDaemonWarningTest === true;
    } catch { return; }
    if (!want) return;
    clearRequestDaemonWarningTestFlag();
    log.info('default.json requestDaemonWarningTest: spawning daemon warning test window');
    const payload = { type: 'low', effectiveLimit: 99, usedMinutes: 0, remaining: 99 };
    notifyOrSpawn(payload, 'LiFE Test', 'Warnfenster-Test (Systemd-Daemon).', 'normal');
}

async function tick() {
    maybeHandleDaemonWarningTestRequest();
    const logMinute = atLoggedMinuteBoundary();
    if (logMinute) {
        try { await defaultSync.maybeSync(); } catch (e) { log.warn(`defaultSync tick: ${e && e.message ? e.message : String(e)}`); }
    }
    try { await tickScreenTime(logMinute); } catch (e) { log.error(`tick screen-time: ${e.message}`); }
    try { await tickAppQuotas(logMinute); } catch (e) { log.error(`tick quotas: ${e.message}`); }
    try { await tickAppMonitor(logMinute); } catch (e) { log.error(`tick app-monitor: ${e.message}`); }
}

// --- Socket command handlers ---

function handleClientCommand(client, cmd) {
    if (!cmd || typeof cmd.type !== 'string') return;

    if (cmd.type === 'extend') {
        // Add bonus screen time; requires parent password
        const gate = checkParentPassword(cmd.password);
        if (!gate.ok) {
            const err = gate.reason === 'no_password' ? 'Kein Eltern-Passwort gesetzt.' : 'Falsches Passwort.';
            client.write(JSON.stringify({ type: 'extend-result', ok: false, error: err }) + '\n');
            return;
        }
        const minutes = Math.min(180, Math.max(5, Math.floor(Number(cmd.minutes) || 30)));
        try {
            const usage = readUsage();
            const prev = Math.max(0, Number(usage.extraAllowanceMinutes) || 0);
            usage.extraAllowanceMinutes = prev + minutes;
            usage.warnedLowScreenTime = false;
            usage.warnedScreenTimeExhausted = false;
            writeUsage(usage);
            const s = readSchedule();
            const mins = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
            const limit = Math.max(0, Number(s.dailyLimitMinutes) || 0) + usage.extraAllowanceMinutes;
            client.write(JSON.stringify({ type: 'extend-result', ok: true, minutes, newRemaining: Math.max(0, limit - mins) }) + '\n');
            broadcast({ type: 'bonus-granted', minutes });
        } catch (e) {
            client.write(JSON.stringify({ type: 'extend-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'extend-app') {
        // Add bonus quota time for a specific app; requires parent password
        const gate = checkParentPassword(cmd.password);
        if (!gate.ok) {
            const err = gate.reason === 'no_password' ? 'Kein Eltern-Passwort gesetzt.' : 'Falsches Passwort.';
            client.write(JSON.stringify({ type: 'extend-app-result', ok: false, error: err }) + '\n');
            return;
        }
        const minutes = Math.min(180, Math.max(5, Math.floor(Number(cmd.minutes) || 30)));
        const appId = typeof cmd.appId === 'string' ? cmd.appId : '';
        const lu = normalizeLinuxUser(cmd.linuxUser);
        if (!appId) {
            client.write(JSON.stringify({ type: 'extend-app-result', ok: false, error: 'Keine App angegeben.' }) + '\n');
            return;
        }
        try {
            const state = readQuotaUsageState();
            const uk = quotaUsageKey(appId, lu);
            const prev = Math.max(0, Number(state.appExtra[uk]) || 0);
            state.appExtra[uk] = prev + minutes;
            writeQuotaUsageState(state);
            client.write(JSON.stringify({ type: 'extend-app-result', ok: true, appId, minutes }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'extend-app-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'validate-password') {
        // Validate parent password (used by the standalone lockscreen overlay process)
        const gate = checkParentPassword(cmd.password);
        if (gate.ok) {
            client.write(JSON.stringify({ type: 'validate-password-result', ok: true }) + '\n');
        } else {
            const err = gate.reason === 'no_password' ? 'Kein Eltern-Passwort gesetzt.' : 'Falsches Passwort.';
            client.write(JSON.stringify({ type: 'validate-password-result', ok: false, error: err }) + '\n');
        }
        return;
    }

    if (cmd.type === 'status') {
        // Respond with current screen time status
        const usage = readUsage();
        const s = readSchedule();
        const minutes = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
        const limit = Math.max(0, Number(s.dailyLimitMinutes) || 0) + Math.max(0, Number(usage.extraAllowanceMinutes) || 0);
        client.write(JSON.stringify({
            type: 'status',
            screenTime: { enabled: s.enabled, dailyLimitEnabled: s.dailyLimitEnabled, minutes, limitMinutes: limit, remaining: Math.max(0, limit - minutes) }
        }) + '\n');
        return;
    }
}

// --- Unix socket server ---

function startSocketServer() {
    // Clean up stale socket from a previous run
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore: socket may not exist */ }

    const server = net.createServer((client) => {
        clients.add(client);
        log.info(`client connected clients=${clients.size}`);
        let buf = '';

        client.on('data', (data) => {
            buf += data.toString();
            let nl;
            while ((nl = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!line) continue;
                try { handleClientCommand(client, JSON.parse(line)); }
                catch { /* ignore malformed JSON */ }
            }
        });

        client.on('close', () => { clients.delete(client); log.info(`client disconnected clients=${clients.size}`); });
        client.on('error', (e) => { clients.delete(client); log.info(`client error: ${e.message} clients=${clients.size}`); });
    });

    server.listen(SOCKET_PATH, () => {
        // 0o666 so the user-mode warning window process can also connect
        try { fs.chmodSync(SOCKET_PATH, 0o666); } catch { /* ignore */ }
        log.info(`listening on ${SOCKET_PATH}`);
    });

    server.on('error', (e) => log.error(`socket server error: ${e.message}`));
}

// --- Entry point ---

if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    log.error('must run as root');
    process.exit(1);
}

log.info(`starting PID=${process.pid} node=${process.version}`);
fs.mkdirSync(CONFIG_DIR, { recursive: true });

const defaultSync = createDefaultSync({ configDir: CONFIG_DIR, log });
defaultSync.maybeSync().catch(e => log.warn(`defaultSync initial: ${e && e.message ? e.message : String(e)}`));

startSocketServer();

// First tick immediately, then on TICK_MS interval
tick().catch(e => log.error(`initial tick: ${e.message}`));
setInterval(() => tick().catch(e => log.error(`tick: ${e.message}`)), TICK_MS);

process.on('SIGTERM', () => {
    log.info('shutting down (SIGTERM)');
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    process.exit(0);
});

process.on('SIGINT', () => {
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    process.exit(0);
});
