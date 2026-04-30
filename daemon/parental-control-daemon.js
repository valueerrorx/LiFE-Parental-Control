#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
'use strict';
// LiFE Parental Control root daemon — single source of truth for all timekeeping and enforcement

const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn, spawnSync } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const { createDefaultSync, dohIptablesStatus } = require('./defaultSync.js');

const execFileAsync = promisify(execFile);

const SOCKET_PATH = '/run/parental-control.sock';
const CONFIG_DIR = '/etc/life-parental';
const LOG_FILE = '/var/log/life-parental/daemon.log';
const ACTIVITY_LOG_FILE = '/var/log/life-parental/activity.json';
const ACTIVITY_LOG_MAX = 400;
const LOG_MAX_BYTES = 2 * 1024 * 1024; // rotate at 2 MB
const TICK_MS = 10_000;
const TICKS_PER_LOGGED_MINUTE = 60_000 / TICK_MS; // 6 ticks = 1 minute
const ALLOWED_HOURS_GRACE_MS = 60_000;
const EXHAUSTED_LOGOUT_GRACE_MS = 60_000; // Same wall-clock UX as allowed-hours; parent may grant bonus via lockscreen before terminate.
const RELOGIN_BUFFER_MINUTES = 2; // Same slack as post-exhausted minute rollback; allowed-hours uses override end (wall clock).

const APP_MONITOR_BG_EXCLUDES_BASENAME = 'app-monitor-background-excludes.json';
const PORTABLE_APPIMAGES_FILE = 'portable-appimages.json';
const PORTABLE_APPIMAGES_TTL_DAYS = 30;
const PORTABLE_SCAN_MIN_MS = 60_000;
const EXEMPT_SCREEN_TIME_INFO_COOLDOWN_MS = 15 * 60 * 1000;
let lastExemptScreenTimeInfoMs = 0;
const EXEMPT_SCREEN_TIME_PAUSED_INFO_COOLDOWN_MS = 15 * 60 * 1000;
let lastExemptScreenTimePausedInfoMs = 0;
let lastExemptScreenTimeInfoState = ''; // '' | 'paused' | 'counting'
const WHITELIST_ONLY_LOGOUT_DEBOUNCE_MS = 30_000;
let lastWhitelistOnlyBlockedLogoutMs = 0;
const LOGOUT_BLOCKED_INFO_ONCE_TYPES = new Set(); // in-memory: reset when blocking condition clears

const NOTIFY_SEND_BIN = (() => {
    try {
        if (fs.existsSync('/usr/bin/notify-send')) return '/usr/bin/notify-send';
        if (fs.existsSync('/bin/notify-send')) return '/bin/notify-send';
    } catch { /* ignore */ }
    return 'notify-send';
})();

// Resolve apparmor_parser without relying on PATH (Electron/daemon environments often omit /usr/sbin).
const APPARMOR_PARSER_BIN = (() => {
    for (const p of ['/usr/sbin/apparmor_parser', '/usr/bin/apparmor_parser', '/sbin/apparmor_parser']) {
        try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
    }
    return null;
})();

const NOTIFY_APP_NAME = 'LiFE Parental Control';

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

// Best-effort append to the shared activity log (same file as the UI's activityLog.js).
function appendActivityDaemon(entry) {
    try {
        let list = [];
        try { list = JSON.parse(fs.readFileSync(ACTIVITY_LOG_FILE, 'utf8')); if (!Array.isArray(list)) list = []; } catch { /* new file */ }
        list.push({ t: new Date().toISOString(), ...entry });
        if (list.length > ACTIVITY_LOG_MAX) list = list.slice(-ACTIVITY_LOG_MAX);
        fs.writeFileSync(ACTIVITY_LOG_FILE, JSON.stringify(list), 'utf8');
    } catch { /* best-effort */ }
}

// Mutable tick state: minute counter every TICK_MS on wall clock; tickWorkChain runs tick body strictly serialized (no overlap during long awaits).
let tickInMinute = 0;
let tickWorkChain = Promise.resolve();
let quotaWarnDate = '';
const appQuotaWarnOnce = new Set();
const quotaLinuxUserNoSessionWarnOnce = new Set(); // one warn per appId+linuxUser until next calendar day
let quotaTickSkippedAppControlWarned = false;
let quotaTickSkippedNoGraphicalSessionsWarned = false;
let allowedHoursGraceStartMs = 0;
let lastPortableScanMs = 0;

// Connected socket clients (Electron UI instances)
const clients = new Set();

// Exec path registered by the most recently connected frontend UI (used to spawn warning windows)
let registeredClientExecPath = '';

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

const DEFAULT_SCHEDULE_PERIOD = {
    dailyLimitEnabled: false, dailyLimitMinutes: 120,
    allowedHoursEnabled: false, allowedHoursStart: '07:00', allowedHoursEnd: '22:00'
};

const DEFAULT_SCHEDULE = {
    enabled: false,
    screenTimeLinuxUser: '',
    weekday: { ...DEFAULT_SCHEDULE_PERIOD },
    weekend: { ...DEFAULT_SCHEDULE_PERIOD, dailyLimitMinutes: 180 }
};

const DEFAULT_JSON_FILE = 'default.json'
const AUTH_JSON_FILE = 'auth.json'

const DESKTOP_DIRS = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications'
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
        // Portable IDs are already canonical and must not be rewritten to ".desktop".
        // Keeping them stable is critical for daemon enforcement + UI consistency.
        if (raw.startsWith('appimage:')) {
            if (seen.has(raw)) continue
            seen.add(raw)
            out.push(raw)
            continue
        }
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

function normalizePeriod(p, def) {
    const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {}
    return {
        dailyLimitEnabled: src.dailyLimitEnabled === true,
        dailyLimitMinutes: Number.isFinite(Number(src.dailyLimitMinutes)) ? Number(src.dailyLimitMinutes) : def.dailyLimitMinutes,
        allowedHoursEnabled: src.allowedHoursEnabled === true,
        allowedHoursStart: typeof src.allowedHoursStart === 'string' ? src.allowedHoursStart : def.allowedHoursStart,
        allowedHoursEnd: typeof src.allowedHoursEnd === 'string' ? src.allowedHoursEnd : def.allowedHoursEnd
    }
}

function normalizeScheduleFromDefault(schedule) {
    const s = schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {}
    // Backward compat: if old flat format, migrate to weekday/weekend structure
    const hasOldFormat = (s.dailyLimitEnabled != null || s.allowedHoursEnabled != null) && !s.weekday
    const legacyFlat = hasOldFormat ? {
        dailyLimitEnabled: s.dailyLimitEnabled === true,
        dailyLimitMinutes: Number.isFinite(Number(s.dailyLimitMinutes)) ? Number(s.dailyLimitMinutes) : DEFAULT_SCHEDULE_PERIOD.dailyLimitMinutes,
        allowedHoursEnabled: s.allowedHoursEnabled === true,
        allowedHoursStart: typeof s.allowedHoursStart === 'string' ? s.allowedHoursStart : DEFAULT_SCHEDULE_PERIOD.allowedHoursStart,
        allowedHoursEnd: typeof s.allowedHoursEnd === 'string' ? s.allowedHoursEnd : DEFAULT_SCHEDULE_PERIOD.allowedHoursEnd
    } : null

    return {
        enabled: s.enabled === true,
        screenTimeLinuxUser: typeof s.screenTimeLinuxUser === 'string' ? s.screenTimeLinuxUser : '',
        weekday: normalizePeriod(s.weekday ?? legacyFlat, DEFAULT_SCHEDULE_PERIOD),
        weekend: normalizePeriod(s.weekend ?? legacyFlat, { ...DEFAULT_SCHEDULE_PERIOD, dailyLimitMinutes: 180 })
    }
}

function normalizeQuotaEntriesFromDefault(defaultQuota, installedIds) {
    const list = Array.isArray(defaultQuota) ? defaultQuota : []
    const out = []
    for (const e of list) {
        if (!e || typeof e !== 'object') continue
        const rawAppId = typeof e.appId === 'string' ? e.appId : ''
        if (!rawAppId) continue
        const rawTrim = rawAppId.trim()
        if (!rawTrim) continue
        const isPortable = rawTrim.startsWith('appimage:')
        const appId = isPortable ? rawTrim : (rawTrim.endsWith('.desktop') ? rawTrim : `${rawTrim}.desktop`)
        const proc = typeof e.processName === 'string' ? e.processName.trim() : ''
        if (!proc) continue
        const mp = Number(e.minutesPerDay)
        if (!Number.isFinite(mp)) continue
        const canonAppId = isPortable ? appId : (resolveBlockedIdsAgainstInstalled([appId], installedIds)[0] || appId)
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
    return { date: today, users: {}, extraAllowanceMinutes: 0, allowedHoursExtraMinutes: 0, allowedHoursOverrideEnd: '', warned10: false, warned5: false, warned2: false, warnedScreenTimeExhausted: false, warnedAH10: false, warnedAH5: false, warnedAH2: false };
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
            warned10: data.warned10 === true,
            warned5: data.warned5 === true,
            warned2: data.warned2 === true,
            warnSnapLimit: data.warnSnapLimit != null ? Number(data.warnSnapLimit) : undefined,
            warnedScreenTimeExhausted: data.warnedScreenTimeExhausted === true,
            allowedHoursExtraMinutes: Math.max(0, Number(data.allowedHoursExtraMinutes) || 0),
            allowedHoursOverrideEnd: typeof data.allowedHoursOverrideEnd === 'string' ? data.allowedHoursOverrideEnd.trim() : '',
            warnedAH10: data.warnedAH10 === true,
            warnedAH5: data.warnedAH5 === true,
            warnedAH2: data.warnedAH2 === true,
            warnSnapAHEnd: data.warnSnapAHEnd != null ? Number(data.warnSnapAHEnd) : undefined
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

// --- Desktop app catalog builder ---

function execLineToProcessName(execLine) {
    if (!execLine || typeof execLine !== 'string') return '';
    const raw = execLine.trim().split(/\s+/).map(t => t.replace(/^['"]|['"]$/g, ''));
    const skipLead = new Set(['env', 'dbus-run-session', 'gdbus']);
    let i = 0;
    while (i < raw.length) {
        const t = raw[i];
        if (skipLead.has(t.toLowerCase())) { i++; continue; }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
        break;
    }
    const tokens = raw.slice(i);
    if (!tokens.length) return '';

    for (let j = 0; j < tokens.length; j++) {
        if (tokens[j].startsWith('--command=')) {
            const v = tokens[j].slice('--command='.length);
            if (v) return v.includes('/') ? (path.basename(v) || v) : v;
        }
        if (tokens[j] === '--command' && j + 1 < tokens.length) {
            const v = tokens[j + 1];
            return v.includes('/') ? (path.basename(v) || v) : v;
        }
    }

    for (let j = 0; j < tokens.length - 2; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j];
        if (base === 'snap' && tokens[j + 1] === 'run') {
            const v = tokens[j + 2];
            if (v && !v.startsWith('-')) return v.includes('/') ? (path.basename(v) || v) : v;
        }
    }

    const flatpakArgPair = new Set(['--arch', '--branch', '--share', '--socket', '--device', '--filesystem', '--env',
        '--own-name', '--talk-name', '--system-talk-name', '--persist', '--add-policy', '--remove-policy']);
    for (let j = 0; j < tokens.length - 1; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j];
        if (base !== 'flatpak' || tokens[j + 1] !== 'run') continue;
        let k = j + 2;
        while (k < tokens.length && tokens[k].startsWith('-')) {
            const t = tokens[k];
            if (t.startsWith('--command=') || t === '--command') break;
            if (t.includes('=')) { k++; continue; }
            if (flatpakArgPair.has(t) && k + 1 < tokens.length) { k += 2; continue; }
            k++;
        }
        if (k < tokens.length && !tokens[k].startsWith('-')) {
            const app = tokens[k];
            if (app.includes('/')) return path.basename(app) || app;
            if (app.includes('.')) {
                const tail = app.slice(app.lastIndexOf('.') + 1);
                return tail || app;
            }
            return app;
        }
        break;
    }

    for (let j = 0; j < tokens.length - 1; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j];
        const sh = base.toLowerCase();
        if ((sh === 'sh' || sh === 'bash' || sh === 'dash' || sh === 'zsh') && tokens[j + 1] === '-c') {
            const inner = tokens.slice(j + 2).join(' ').replace(/^['"]|['"]$/g, '');
            return inner ? (execLineToProcessName(inner) || '') : '';
        }
    }

    for (let j = 0; j < tokens.length; j++) {
        const base = tokens[j].includes('/') ? path.basename(tokens[j]) : tokens[j];
        if (base.toLowerCase() !== 'electron') continue;
        let k = j + 1;
        while (k < tokens.length && tokens[k].startsWith('-')) k++;
        if (k < tokens.length) {
            const nested = execLineToProcessName(tokens.slice(k).join(' '));
            if (nested) return nested;
        }
        break;
    }

    for (const t of tokens) {
        if (!/\.appimage$/i.test(t)) continue;
        const file = t.includes('/') ? path.basename(t) : t;
        const stem = file.replace(/\.appimage$/i, '');
        if (stem) return stem;
    }

    for (let p = 0; p < tokens.length; p++) {
        const t = tokens[p];
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
        if (t.includes('/')) return path.basename(t) || t;
        return t;
    }
    return '';
}

function parseDesktopFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const mainSection = content.split(/\[Desktop Entry\]/i)[1]?.split(/^\[/m)[0] || '';
        if (!mainSection) return null;
        const get = (key) => {
            const m = mainSection.match(new RegExp(`^${key}=(.*)$`, 'm'));
            return m ? m[1].trim() : '';
        };
        const name = get('Name\\[de\\]') || get('Name');
        const exec = get('Exec');
        const icon = get('Icon');
        const noDisplay = get('NoDisplay').toLowerCase() === 'true';
        const hidden = get('Hidden').toLowerCase() === 'true';
        if (!name || !exec || noDisplay || hidden) return null;
        return {
            appId: path.basename(filePath),
            appName: name,
            exec,
            icon,
            filePath,
            processName: execLineToProcessName(exec)
        };
    } catch { return null; }
}

function execLineToFullPath(execLine) {
    if (!execLine) return null;
    const clean = execLine.trim().replace(/%[a-zA-Z]/g, '').trim();
    const tokens = clean.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (['env', 'dbus-run-session', 'gdbus'].includes(t.toLowerCase())) { i++; continue; }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
        break;
    }
    if (i >= tokens.length) return null;
    const cmd = tokens[i];
    const base = cmd.includes('/') ? path.basename(cmd) : cmd;
    if (base === 'flatpak' || base === 'snap') return null;
    if (cmd.startsWith('/')) return cmd;
    try {
        const r = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 2000 });
        const found = (r.stdout || '').trim();
        if (found && found.startsWith('/')) return found;
    } catch { /* which not available */ }
    return null;
}

function readAllDesktopApps() {
    const apps = [];
    const seen = new Set();
    for (const dir of DESKTOP_DIRS) {
        try {
            if (!fs.existsSync(dir)) continue;
            for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.desktop'))) {
                if (seen.has(file)) continue;
                seen.add(file);
                const app = parseDesktopFile(path.join(dir, file));
                if (!app) continue;
                // Skip apps whose binary is not on disk
                const fullPath = execLineToFullPath(app.exec);
                if (fullPath !== null && !fs.existsSync(fullPath)) continue;
                apps.push(app);
            }
        } catch { /* skip unreadable dir */ }
    }
    return apps.sort((a, b) => a.appName.localeCompare(b.appName));
}

function loadAppMonitorBackgroundExcludeSets() {
    const empty = () => ({ appIds: new Set(), processNames: new Set() });
    const p = path.join(CONFIG_DIR, APP_MONITOR_BG_EXCLUDES_BASENAME);
    try {
        if (!fs.existsSync(p)) return empty();
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        const rows = Array.isArray(data.excludes) ? data.excludes : (Array.isArray(data) ? data : []);
        const appIds = new Set();
        const processNames = new Set();
        for (const row of rows) {
            if (typeof row === 'string') {
                const s = row.trim();
                if (s) processNames.add(s.toLowerCase());
                continue;
            }
            if (row && typeof row === 'object') {
                if (typeof row.appId === 'string' && row.appId.trim()) appIds.add(row.appId.trim().toLowerCase());
                if (typeof row.processName === 'string' && row.processName.trim()) processNames.add(row.processName.trim().toLowerCase());
            }
        }
        return { appIds, processNames };
    } catch (e) {
        log.warn(`app-monitor-background-excludes: read failed: ${e.message}`);
        return empty();
    }
}

function isAppMonitorCatalogEntryExcluded(entry, sets) {
    if (!entry || !sets) return false;
    const aid = String(entry.appId || '').trim().toLowerCase();
    const proc = String(entry.processName || '').trim().toLowerCase();
    if (aid && sets.appIds.has(aid)) return true;
    if (proc && sets.processNames.has(proc)) return true;
    return false;
}

function portableIdForAppImagePath(execPath) {
    try {
        const abs = path.resolve(String(execPath || ''));
        const h = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 16);
        return `appimage:${h}`;
    } catch {
        return '';
    }
}

function readPortableAppImagesState() {
    const p = path.join(CONFIG_DIR, PORTABLE_APPIMAGES_FILE);
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        const list = Array.isArray(raw?.apps) ? raw.apps : (Array.isArray(raw) ? raw : []);
        const out = new Map();
        for (const a of list) {
            if (!a || typeof a !== 'object') continue;
            const id = typeof a.appId === 'string' ? a.appId.trim() : '';
            const execPath = typeof a.execPath === 'string' ? a.execPath.trim() : '';
            if (!id || !execPath) continue;
            out.set(id, {
                appId: id,
                appName: typeof a.appName === 'string' ? a.appName : '',
                processName: typeof a.processName === 'string' ? a.processName : '',
                execPath,
                lastSeenAt: typeof a.lastSeenAt === 'string' ? a.lastSeenAt : ''
            });
        }
        return out;
    } catch {
        return new Map();
    }
}

function writePortableAppImagesState(map) {
    const list = [];
    for (const v of map.values()) {
        if (!v?.appId || !v?.execPath) continue;
        list.push({
            appId: v.appId,
            appName: v.appName || '',
            processName: v.processName || '',
            execPath: v.execPath,
            lastSeenAt: v.lastSeenAt || new Date().toISOString()
        });
    }
    const p = path.join(CONFIG_DIR, PORTABLE_APPIMAGES_FILE);
    const tmp = p + `.tmp-${process.pid}-${Date.now()}`;
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ apps: list }, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
    fs.renameSync(tmp, p);
    try { fs.chmodSync(p, 0o644); } catch { /* ignore */ }
}

function scanRunningAppImagesProc() {
    const out = new Map(); // appId → entry
    if (process.platform !== 'linux') return out;
    const helperCommLower = new Set([
        'binfmt-bypass',
        'chrome_crashpad',
        'crashpad_handler',
        'crashpad-handler',
        'xdg-dbus-proxy',
        'xdg-document-portal',
        'xdg-desktop-portal',
        'xdg-desktop-portal-gtk',
        'xdg-desktop-portal-kde',
        'zygote',
        'zygote64',
        'gpu-process',
        'utility',
        'broker',
        'appimageruntime',
        'apprun',
    ]);

    function scoreCandidate({ comm, exeBase, argv0Base, stem }) {
        const commLower = String(comm || '').trim().toLowerCase();
        const exeLower = String(exeBase || '').trim().toLowerCase();
        const argvLower = String(argv0Base || '').trim().toLowerCase();
        const stemLower = String(stem || '').trim().toLowerCase();

        let score = 0;
        if (commLower) score += 20;
        if (exeLower) score += 12;
        if (argvLower) score += 5;

        if (stemLower && commLower === stemLower) score += 40;
        if (stemLower && exeLower === stemLower) score += 25;

        if (helperCommLower.has(commLower)) score -= 120;
        if (helperCommLower.has(exeLower)) score -= 80;
        if (helperCommLower.has(argvLower)) score -= 40;

        // Prefer non-generic names even if they don't match the stem exactly.
        if (commLower && commLower.length >= 6) score += 8;
        if (exeLower && exeLower.length >= 6) score += 5;

        return score;
    }

    function pickProcessName({ comm, exeBase, argv0Base, stem, base }) {
        const c = String(comm || '').trim();
        if (c && !helperCommLower.has(c.toLowerCase())) return c;
        const e = String(exeBase || '').trim();
        if (e && !helperCommLower.has(e.toLowerCase())) return e;
        const a0 = String(argv0Base || '').trim();
        if (a0 && !helperCommLower.has(a0.toLowerCase())) return a0;
        const s = String(stem || '').trim();
        if (s) return s;
        return String(base || '').trim();
    }

    function readProcStatPpid(pid) {
        try {
            const s = fs.readFileSync(path.join('/proc', pid, 'stat'), 'utf8');
            const r = String(s || '').trim();
            if (!r) return '';
            const end = r.lastIndexOf(')');
            if (end === -1) return '';
            const tail = r.slice(end + 1).trim().split(/\s+/);
            // Fields: pid (comm) state ppid ...
            return tail.length >= 2 ? String(tail[1] || '') : '';
        } catch {
            return '';
        }
    }

    function readProcBasics(pid) {
        const commPath = path.join('/proc', pid, 'comm');
        const exePath = path.join('/proc', pid, 'exe');
        const cmdlinePath = path.join('/proc', pid, 'cmdline');
        let comm = '';
        let exeBase = '';
        let argv0Base = '';
        try { comm = String(fs.readFileSync(commPath, 'utf8') || '').trim(); } catch { /* ignore */ }
        try { exeBase = path.basename(fs.readlinkSync(exePath) || ''); } catch { /* ignore */ }
        try {
            const buf = fs.readFileSync(cmdlinePath);
            if (buf && buf.length) {
                const i0 = buf.indexOf(0);
                const token = (i0 === -1 ? buf : buf.subarray(0, i0)).toString('utf8').trim();
                if (token) argv0Base = path.basename(token);
            }
        } catch { /* ignore */ }
        return { comm, exeBase, argv0Base };
    }

    let dirs = [];
    try { dirs = fs.readdirSync('/proc', { withFileTypes: true }); } catch { return out; }
    const pidList = [];
    for (const d of dirs) {
        if (!d.isDirectory()) continue;
        if (!/^\d+$/.test(d.name)) continue;
        pidList.push(d.name);
    }
    const childrenByPpid = new Map();
    for (const pid of pidList) {
        const ppid = readProcStatPpid(pid);
        if (!ppid) continue;
        if (!childrenByPpid.has(ppid)) childrenByPpid.set(ppid, []);
        childrenByPpid.get(ppid).push(pid);
    }

    for (const d of dirs) {
        if (!d.isDirectory()) continue;
        if (!/^\d+$/.test(d.name)) continue;
        const pid = d.name;
        const cmdlinePath = path.join('/proc', pid, 'cmdline');
        const environPath = path.join('/proc', pid, 'environ');
        let cmdBuf = null;
        let envBuf = null;
        try { cmdBuf = fs.readFileSync(cmdlinePath); } catch { /* ignore */ }
        try { envBuf = fs.readFileSync(environPath); } catch { /* ignore */ }

        const cmdTokens = [];
        if (cmdBuf && cmdBuf.length) {
            let i = 0;
            while (i < cmdBuf.length) {
                let j = cmdBuf.indexOf(0, i);
                if (j === -1) j = cmdBuf.length;
                if (j > i) {
                    const token = cmdBuf.subarray(i, j).toString('utf8').trim();
                    if (token) cmdTokens.push(token);
                }
                i = j + 1;
            }
        }

        const argv0Base = cmdTokens.length ? path.basename(cmdTokens[0]) : '';

        let appImageFromEnv = '';
        if (envBuf && envBuf.length) {
            let i = 0;
            while (i < envBuf.length) {
                let j = envBuf.indexOf(0, i);
                if (j === -1) j = envBuf.length;
                if (j > i) {
                    const kv = envBuf.subarray(i, j).toString('utf8');
                    if (kv.startsWith('APPIMAGE=')) {
                        const v = kv.slice('APPIMAGE='.length).trim();
                        if (v) { appImageFromEnv = v; break; }
                    }
                }
                i = j + 1;
            }
        }

        const candidatePaths = [];
        if (appImageFromEnv) candidatePaths.push(appImageFromEnv);
        for (const t of cmdTokens) {
            if (/\.appimage$/i.test(t)) candidatePaths.push(t);
        }

        for (const p of candidatePaths) {
            const full = path.isAbsolute(p) ? p : path.resolve('/', p);
            try {
                if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
                const base = path.basename(full);
                const stem = base.replace(/\.appimage$/i, '');
                const appId = portableIdForAppImagePath(full);
                if (!appId) continue;

                // Prefer a meaningful descendant process if this PID is only a wrapper (binfmt_misc).
                let best = { comm: '', exeBase: '', argv0Base: '', pid, score: -9999 };
                const seen = new Set();
                const q = [pid];
                let budget = 140; // bound /proc reads
                while (q.length && budget-- > 0) {
                    const cur = q.shift();
                    if (!cur || seen.has(cur)) continue;
                    seen.add(cur);
                    const b = readProcBasics(cur);
                    const s = scoreCandidate({ ...b, stem });
                    if (s > best.score) best = { ...b, pid: cur, score: s };
                    const kids = childrenByPpid.get(cur) || [];
                    for (const k of kids) q.push(k);
                }

                const procName = pickProcessName({ ...best, stem, base });
                const score = best.score;
                const existing = out.get(appId);
                if (!existing || (Number(existing._score) || 0) < score) {
                    out.set(appId, {
                        appId,
                        appName: stem || base,
                        processName: procName,
                        execPath: full,
                        lastSeenAt: new Date().toISOString(),
                        _score: score
                    });
                }
            } catch { /* ignore */ }
        }
    }
    for (const [id, e] of out) {
        if (e && typeof e === 'object' && '_score' in e) delete e._score;
    }
    return out;
}

function updatePortableAppImagesCache() {
    const nowIso = new Date().toISOString();
    const prev = readPortableAppImagesState();
    const found = scanRunningAppImagesProc();
    for (const [id, e] of found) {
        prev.set(id, { ...e, lastSeenAt: nowIso });
    }
    const keepMs = PORTABLE_APPIMAGES_TTL_DAYS * 86400_000;
    const cutoff = Date.now() - keepMs;
    const blocked = loadBlockedAppIds();
    for (const [id, e] of prev) {
        if (blocked.has(id)) continue;
        const t = Date.parse(e.lastSeenAt || '');
        if (!Number.isFinite(t) || t < cutoff) prev.delete(id);
    }
    writePortableAppImagesState(prev);
    return prev;
}

function portableAppImageCatalogEntries() {
    const st = readPortableAppImagesState();
    return Array.from(st.values()).map((e) => ({
        appId: e.appId,
        appName: e.appName,
        processName: e.processName,
        execPath: e.execPath,
        portableKind: 'appimage',
        lastSeenAt: e.lastSeenAt
    }));
}

function loadQuotaExemptProcessNamesLower() {
    const out = new Set();
    for (const n of loadExemptAppProcessNames()) {
        const s = String(n || '').trim().toLowerCase();
        if (s) out.add(s);
    }
    return out;
}

async function catalogHasNonQuotaExemptAppRunning(limitLu, activeUsers, exemptIdsRaw) {
    const entries = readMonitorCatalogEntries();
    const users = limitLu ? [limitLu] : activeUsers;
    if (!users.length) return false;
    const exemptLower = new Set();
    try {
        for (const id of exemptIdsRaw) exemptLower.add(String(id).trim().toLowerCase());
    } catch { /* ignore */ }
    const exemptProcLower = loadQuotaExemptProcessNamesLower();
    for (const u of users) {
        for (const e of entries) {
            const id = String(e.appId || '').trim();
            if (id && exemptLower.has(id.toLowerCase())) continue;
            const candidates = processNameCandidatesForAppEntry(e.processName, e.appId);
            if (!candidates.length) continue;
            const isExemptProc = candidates.some(c => exemptProcLower.has(String(c).toLowerCase()));
            if (isExemptProc) continue;
            const matched = await pgrepUserAnyCandidate(u, candidates);
            if (matched) return true;
        }
    }
    return false;
}

async function listNonQuotaExemptRunningCatalogApps(limitLu, activeUsers, exemptIdsRaw) {
    const entries = readMonitorCatalogEntries();
    const users = limitLu ? [limitLu] : activeUsers;
    if (!users.length) return [];
    const exemptLower = new Set();
    try {
        for (const id of exemptIdsRaw) exemptLower.add(String(id).trim().toLowerCase());
    } catch { /* ignore */ }
    const exemptProcLower = loadQuotaExemptProcessNamesLower();
    const out = [];
    const seen = new Set();
    for (const u of users) {
        for (const e of entries) {
            const id = String(e.appId || '').trim();
            if (id && exemptLower.has(id.toLowerCase())) continue;
            const candidates = processNameCandidatesForAppEntry(e.processName, e.appId);
            if (!candidates.length) continue;
            const isExemptProc = candidates.some(c => exemptProcLower.has(String(c).toLowerCase()));
            if (isExemptProc) continue;
            const matchedProc = await pgrepUserAnyCandidate(u, candidates);
            if (!matchedProc) continue;
            const key = `${id}\0${matchedProc}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ appId: id || undefined, appName: e.appName || undefined, processName: matchedProc });
        }
    }
    return out;
}

// True when every running app-monitor catalog process is quota-exempt (all whitelisted desktop ids and same-binary duplicates); false if any non-exempt catalog app is running.
async function onlyWhitelistedMonitorCatalogAppsRunning(limitLu, activeUsers) {
    const hasOther = await catalogHasNonQuotaExemptAppRunning(limitLu, activeUsers, loadQuotaExemptAppIds());
    return !hasOther;
}

async function anyWhitelistedMonitorCatalogAppRunning(limitLu, activeUsers) {
    const entries = readMonitorCatalogEntries();
    const users = limitLu ? [limitLu] : activeUsers;
    if (!users.length) return false;
    const exemptIds = loadQuotaExemptAppIds();
    const exemptProcLower = loadQuotaExemptProcessNamesLower();
    for (const u of users) {
        for (const e of entries) {
            const id = String(e.appId || '').trim();
            const isExemptId = id && exemptIds.has(id);
            const candidates = processNameCandidatesForAppEntry(e.processName, e.appId);
            const isExemptProc = candidates.some(c => exemptProcLower.has(String(c).toLowerCase()));
            if (!isExemptId && !isExemptProc) continue;
            const matched = await pgrepUserAnyCandidate(u, candidates);
            if (matched) return true;
        }
    }
    return false;
}

function notifyExemptScreenTimeStillCountingIfNeeded(limitLu, otherApps = []) {
    const now = Date.now();
    if (now - lastExemptScreenTimeInfoMs < EXEMPT_SCREEN_TIME_INFO_COOLDOWN_MS) return;
    lastExemptScreenTimeInfoMs = now;
    const pin = typeof limitLu === 'string' ? limitLu : '';
    const list = Array.isArray(otherApps) ? otherApps : [];
    const shown = list
        .map(a => (a && typeof a === 'object' ? (String(a.appName || a.processName || a.appId || '').trim()) : ''))
        .filter(Boolean)
        .slice(0, 6);
    const lines = shown.map(s => `- ${s}`);
    if (list.length > shown.length) lines.push('- …');
    const suffix = lines.length ? `\n\nAndere Apps:\n${lines.join('\n')}` : '';
    notifyOrSpawn(
        { type: 'low', subtype: 'exempt-screen-time-counting' },
        'Bildschirmzeit läuft weiter',
        `Whitelist-App aktiv, aber andere erfasste Apps laufen — die Bildschirmzeit zählt weiter.${suffix}`,
        'normal',
        true,
        pin
    );
}

function notifyExemptScreenTimePausedIfNeeded(limitLu, exemptApps = []) {
    const now = Date.now();
    if (now - lastExemptScreenTimePausedInfoMs < EXEMPT_SCREEN_TIME_PAUSED_INFO_COOLDOWN_MS) return;
    lastExemptScreenTimePausedInfoMs = now;
    const pin = typeof limitLu === 'string' ? limitLu : '';
    const list = Array.isArray(exemptApps) ? exemptApps : [];
    const shown = list
        .map(a => (a && typeof a === 'object' ? (String(a.appName || a.processName || a.appId || '').trim()) : ''))
        .filter(Boolean)
        .slice(0, 6);
    const lines = shown.map(s => `- ${s}`);
    if (list.length > shown.length) lines.push('- …');
    const suffix = lines.length ? `\n\nWhitelist-Apps:\n${lines.join('\n')}` : '';
    notifyOrSpawn(
        { type: 'low', subtype: 'exempt-screen-time-paused' },
        'Bildschirmzeit pausiert',
        `Nur Whitelist-Apps laufen — die Bildschirmzeit-Zählung ist pausiert.${suffix}`,
        'normal',
        true,
        pin
    );
}

function notifyLogoutBlockedWhileWhitelistOnlyOnce(type, limitLu) {
    const k = `${String(type || '')}::${String(limitLu || '')}`;
    if (LOGOUT_BLOCKED_INFO_ONCE_TYPES.has(k)) return;
    LOGOUT_BLOCKED_INFO_ONCE_TYPES.add(k);
    notifyOrSpawn(
        { type: 'low', subtype: 'logout-blocked-whitelist-only' },
        'Logout blockiert',
        'Zeit abgelaufen. Logout wird blockiert solange nur Whitelist-Apps laufen.',
        'normal',
        true,
        typeof limitLu === 'string' ? limitLu : ''
    );
}

function buildAndWriteAppCatalog() {
    try {
        const excl = loadAppMonitorBackgroundExcludeSets();
        const rawApps = readAllDesktopApps();
        const portable = portableAppImageCatalogEntries();
        const mergedRaw = rawApps.concat(portable);
        const before = mergedRaw.length;
        const apps = mergedRaw.filter(a => !isAppMonitorCatalogEntryExcluded(a, excl));
        if (before !== apps.length) log.info(`app-catalog: excluded ${before - apps.length} background/service entries`);
        const payload = {
            updatedAt: new Date().toISOString(),
            apps: apps.filter(a => (a.processName || '').trim().length > 0 || desktopIdTailStem(a.appId))
        };
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(
            path.join(CONFIG_DIR, 'app-monitor-catalog.json'),
            JSON.stringify(payload, null, 2),
            { encoding: 'utf8', mode: 0o644 }
        );
        log.info(`app-catalog: built ${payload.apps.length} entries`);
    } catch (e) {
        log.warn(`app-catalog: build failed: ${e.message}`);
    }
}

// --- DNS probe helper ---

function probeDns4euSync(ip) {
    // Quick TCP connect to port 53, 1-second timeout.
    // Returns true if reachable, false otherwise (also on nc-not-found).
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
    try {
        execFileSync('nc', ['-w', '1', '-z', ip, '53'], { timeout: 2000 });
        return true;
    } catch { return false; }
}

// --- Password validation (same algorithm as settingsIpc.js) ---

function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

let cachedPasswordSecurity = null;

function readPasswordSecurity() {
    if (cachedPasswordSecurity) return cachedPasswordSecurity;
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, AUTH_JSON_FILE), 'utf8'));
        if (raw && typeof raw.passwordHash === 'string' && typeof raw.salt === 'string') {
            cachedPasswordSecurity = { passwordHash: raw.passwordHash, salt: raw.salt };
            return cachedPasswordSecurity;
        }
    } catch { /* file may not exist yet */ }
    cachedPasswordSecurity = { passwordHash: '', salt: '' };
    return cachedPasswordSecurity;
}

function writeAuthFile(passwordHash, salt) {
    const p = path.join(CONFIG_DIR, AUTH_JSON_FILE);
    const tmp = p + `.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify({ passwordHash, salt }, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, p);
    fs.chmodSync(p, 0o600);
    cachedPasswordSecurity = { passwordHash, salt };
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

function processNameCandidatesForAppEntry(processName, appId) {
    const out = new Set();
    const p = String(processName || '').trim();
    if (p) out.add(p);
    if (p && p.includes('.')) out.add(p.slice(p.lastIndexOf('.') + 1));
    const tail = desktopIdTailStem(appId);
    if (tail) out.add(tail);
    return Array.from(out).filter(Boolean);
}

async function pgrepUserAnyCandidate(user, candidates) {
    const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    for (const c of list) {
        if (await pgrepUserProcess(user, c)) return c;
    }
    return '';
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

    const terminatedUsers = new Set();
    for (const { user, sid } of toTerminate) {
        try {
            await execFileAsync('loginctl', ['terminate-session', String(sid)], { timeout: 5000 });
            log.info(`terminate-session sid=${sid} user=${user} OK`);
            appendActivityDaemon({ action: 'session_terminated', user, sessionId: String(sid) });
            terminatedUsers.add(user);
        } catch (e) {
            log.error(`terminate-session sid=${sid} user=${user} FAILED: ${e.message}`);
            appendActivityDaemon({ action: 'session_terminate_failed', user, sessionId: String(sid), error: e.message });
        }
    }

    // terminate-user cleans up /run/user/<uid>/ sockets/locks so the next GNOME
    // login does not hit a login loop caused by stale wayland/dbus sockets.
    await new Promise(r => setTimeout(r, 500));
    for (const user of terminatedUsers) {
        try {
            await execFileAsync('loginctl', ['terminate-user', user], { timeout: 5000 });
            log.info(`terminate-user user=${user} OK`);
        } catch (e) {
            log.warn(`terminate-user user=${user} FAILED: ${e.message}`);
        }
    }

    // After killing the session, restart the display manager so the greeter reappears.
    // On Wayland the session and greeter share the same VT — without a DM restart the
    // screen stays black. Try display-manager.service (distro-agnostic alias), then
    // fall back to sddm/gdm/lightdm by name.
    await new Promise(r => setTimeout(r, 500));
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
    if (registeredClientExecPath && fs.existsSync(registeredClientExecPath)) return registeredClientExecPath;
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

function preferredLinuxUserForWarnings() {
    return normalizeLinuxUser(readSchedule().screenTimeLinuxUser);
}

/** Returns the loginctl session ID that is currently on the active VT of seat0, or null if unavailable. */
function getActiveSeatSessionId() {
    try {
        const r = spawnSync('loginctl', ['show-seat', 'seat0', '-p', 'ActiveSession'], { encoding: 'utf8', timeout: 3000 });
        const m = String(r.stdout || '').match(/^ActiveSession=(\S+)/m);
        if (m && m[1] && m[1] !== '') return m[1];
    } catch { /* ignore */ }
    return null;
}

function getFirstActiveUserInfo() {
    const list = listActiveUserInfos();
    if (!list.length) return null;

    // Primary: the session physically on the screen right now (seat0 active VT).
    // This works correctly when multiple desktops run simultaneously (e.g. KDE at boot + GNOME on another TTY).
    const activeSid = getActiveSeatSessionId();
    if (activeSid) {
        const hit = list.find((s) => s.sessionId === activeSid);
        if (hit) {
            log.info(`getFirstActiveUserInfo: seat0 active sid=${activeSid} user=${hit.user} kind=${hit.sessionKind}`);
            return hit;
        }
        // seat0 reports an active session but it didn't make it into listActiveUserInfos
        // (e.g. locked screen, display manager session) — fall through to config-based selection
        log.info(`getFirstActiveUserInfo: seat0 active sid=${activeSid} not in graphical session list; falling back`);
    }

    // Secondary: explicit user pin in schedule config (kept for headless / no-seat setups)
    const pref = preferredLinuxUserForWarnings();
    if (pref) {
        const hit = list.find((s) => s.user === pref);
        if (hit) {
            log.info(`getFirstActiveUserInfo: using schedule.screenTimeLinuxUser session user=${pref} sid=${hit.sessionId}`);
            return hit;
        }
        log.warn(`getFirstActiveUserInfo: no active session for screenTimeLinuxUser=${pref} (have: ${list.map((s) => s.user).join(', ')}); using first session`);
    } else if (list.length > 1) {
        log.info(`getFirstActiveUserInfo: ${list.length} active graphical sessions; seat0 query yielded no match — using first listed session`);
    }
    return list[0];
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

// Compositor processes checked first — they inherit the full session environment.
const COMPOSITOR_PROCS_FOR_ENV = ['gnome-shell', 'plasmashell', 'sway', 'Hyprland', 'kwin_wayland', 'kwin_x11', 'mutter', 'cinnamon', 'xfce4-session'];

/**
 * Read environment variables from a running process owned by `user`.
 * Checks compositor processes first (they carry the full session env including D-Bus address).
 * The daemon runs as root so /proc/PID/environ is readable for any user.
 * Used as fallback when logind does not store the session environment (TTY-started desktops).
 */
function readEnvVarsFromUserProcess(user, keys) {
    const result = new Map();
    if (!keys.length) return result;

    // Prefer compositor PIDs — they have the complete session environment
    const pids = [];
    for (const comm of COMPOSITOR_PROCS_FOR_ENV) {
        try {
            const r = spawnSync('pgrep', ['-u', user, '-x', comm], { encoding: 'utf8', timeout: 1500 });
            for (const p of String(r.stdout || '').trim().split('\n').filter(Boolean)) {
                if (!pids.includes(p)) pids.push(p);
            }
        } catch { /* ignore */ }
    }
    // Add remaining user processes as fallback
    try {
        const r = spawnSync('pgrep', ['-u', user], { encoding: 'utf8', timeout: 2000 });
        for (const p of String(r.stdout || '').trim().split('\n').filter(Boolean)) {
            if (!pids.includes(p)) pids.push(p);
        }
    } catch { /* ignore */ }

    for (const pid of pids.slice(0, 30)) {
        try {
            const buf = fs.readFileSync(`/proc/${pid}/environ`);
            for (const entry of buf.toString('latin1').split('\0')) {
                const eq = entry.indexOf('=');
                if (eq === -1) continue;
                const k = entry.slice(0, eq);
                const v = entry.slice(eq + 1);
                if (keys.includes(k) && !result.has(k)) result.set(k, v);
            }
            if (result.size === keys.length) break;
        } catch { /* EACCES or process gone */ }
    }
    return result;
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
    // For TTY-started desktops (e.g. GNOME launched from a VT), logind stores no session environment.
    // Read the actual DBUS_SESSION_BUS_ADDRESS and WAYLAND_DISPLAY directly from the compositor
    // process so notify-send connects to the right D-Bus instance.
    const procEnv = readEnvVarsFromUserProcess(user, ['DBUS_SESSION_BUS_ADDRESS', 'WAYLAND_DISPLAY', 'DISPLAY']);
    for (const [k, v] of procEnv) {
        if (v) m.set(k, v);
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
        if (sessionInfo === null) {
            log.info(`spawnWarningWindow skipped: pinned notify had no graphical session for that user type=${payload?.type || '?'}`);
        } else {
            log.warn(`spawnWarningWindow skipped: no graphical session for notify target type=${payload?.type || '?'}`);
        }
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
// Optional notifyLinuxUser: if set, notify-send and warning window use only that user's graphical session.
function notifyOrSpawn(payload, notifySummary, notifyBody, urgency = 'normal', skipWindow = false, notifyLinuxUser = '') {
    const payloadType = payload?.type || 'unknown';
    appendActivityDaemon({ action: 'notification_sent', type: payloadType, summary: notifySummary, appId: payload.appId || undefined, appName: payload.appName || undefined });
    broadcastWarn(payload); // broadcast to connected clients (for status/dashboard updates)
    const pin = normalizeLinuxUser(notifyLinuxUser);
    let info;
    let resolvePath = 'seat0_first';
    let graphCount = 0;
    if (pin) {
        resolvePath = 'pinned_user';
        const list = listActiveUserInfos();
        graphCount = list.length;
        info = list.find((s) => normalizeLinuxUser(s.user) === pin) || null;
    } else {
        info = getFirstActiveUserInfo();
        graphCount = listActiveUserInfos().length;
    }
    const target = info ? `${info.user}@sid=${info.sessionId}` : 'NONE';
    const desktopPlan = info ? 'notify-send+window' : 'SKIP_NO_SESSION';
    log.info(`notifyOrSpawn: type=${payloadType} summary="${notifySummary}" pinRaw=${typeof notifyLinuxUser === 'string' && notifyLinuxUser ? JSON.stringify(notifyLinuxUser) : '(none)'} pinNorm=${pin || '—'} resolve=${resolvePath} graphSessions=${graphCount} target=${target} desktop=${desktopPlan} skipWindow=${skipWindow}`);
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

function scheduleStartDayMinutes(period) {
    const [sh, sm] = String(period.allowedHoursStart || '07:00').split(':').map(Number);
    return (Math.max(0, sh) * 60 + Math.max(0, sm)) || 0;
}

function scheduleEndDayMinutes(period) {
    const [eh, em] = String(period.allowedHoursEnd || '22:00').split(':').map(Number);
    return (Math.max(0, eh) * 60 + Math.max(0, em)) || 0;
}

/** Parses HH:MM (24h); "24:00" → end of calendar day. Returns null if invalid. */
function parseOverrideEndDayMinutes(raw) {
    if (raw == null || typeof raw !== 'string') return null;
    const s = raw.trim();
    if (s === '24:00') return 24 * 60;
    const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/** HH:MM local for now + buffer, capped to 24:00 same calendar day (no next-day override). */
function allowedHoursPostLogoutOverrideEndHHMM(now) {
    const t = new Date(now.getTime() + RELOGIN_BUFFER_MINUTES * 60_000);
    if (localIsoDate(t) !== localIsoDate(now)) return '24:00';
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

function effectiveAllowedHoursEndDayMinutes(period, usage) {
    const start = scheduleStartDayMinutes(period);
    const baseEnd = scheduleEndDayMinutes(period);
    if (start > baseEnd) {
        return baseEnd + Math.max(0, Number(usage?.allowedHoursExtraMinutes) || 0);
    }
    const ov = parseOverrideEndDayMinutes(usage?.allowedHoursOverrideEnd);
    if (ov != null && ov > baseEnd && ov <= 24 * 60) return ov;
    return baseEnd + Math.max(0, Number(usage?.allowedHoursExtraMinutes) || 0);
}

/** HH:MM labels from first full hour after schedule end through 24:00 (same calendar day). */
function allowedHoursOverrideOptionHHMMs(period) {
    const start = scheduleStartDayMinutes(period);
    const baseEnd = scheduleEndDayMinutes(period);
    if (start > baseEnd) return [];
    const firstHour = Math.floor(baseEnd / 60) + 1;
    const out = [];
    for (let h = firstHour; h <= 24; h++) {
        if (h === 24) out.push('24:00');
        else out.push(`${String(h).padStart(2, '0')}:00`);
    }
    return out;
}

function isWithinAllowedHours(period, now, usage = {}) {
    const start = scheduleStartDayMinutes(period);
    const baseEnd = scheduleEndDayMinutes(period);
    const end = effectiveAllowedHoursEndDayMinutes(period, usage);
    const nowT = now.getHours() * 60 + now.getMinutes();
    if (start <= baseEnd) return nowT >= start && nowT <= end;
    return nowT >= start || nowT <= end; // midnight wrap (override end not applied here)
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
    const isWeekend = weekday >= 6; // 6=Sat, 7=Sun
    const period = isWeekend ? s.weekend : s.weekday;
    const sessions = await getActiveGraphicalSessions();
    const activeUsers = uniqueUsers(sessions);
    const limitLu = normalizeLinuxUser(s.screenTimeLinuxUser);
    let hasSessionForLimit;
    if (!limitLu) {
        hasSessionForLimit = activeUsers.length > 0;
    } else if (!activeUsers.includes(limitLu)) {
        hasSessionForLimit = false;
    } else {
        const activeSid = getActiveSeatSessionId();
        const seatHit = activeSid ? sessions.find((s) => String(s.sid) === String(activeSid)) : null;
        const seatUser = seatHit ? normalizeLinuxUser(seatHit.user) : null;
        // If seat0 cannot be mapped to a listed graphical session, keep legacy behavior (headless / odd logind).
        hasSessionForLimit = seatUser == null || seatUser === limitLu;
    }

    let usage = readUsage();
    if (usage.date !== today) usage = emptyUsage(today);

    // Accrue screen time every full minute when the pinned user is on seat0 (same gate as warnings/logout); pool mode uses any GUI session.
    const exemptAppIds = loadQuotaExemptAppIds();
    let skipMinuteForExemptOnly = false;
    let wlCtx = null; // { whitelistRunning, onlyWhitelist, others, whitelistApps }
    async function computeWhitelistContextNow(sessionsNow) {
        if (!exemptAppIds || exemptAppIds.size === 0) return null;
        const activeUsersNow = uniqueUsers(sessionsNow);
        const whitelistRunning = await anyWhitelistedMonitorCatalogAppRunning(limitLu, activeUsersNow);
        if (!whitelistRunning) return { whitelistRunning: false, onlyWhitelist: false, others: [], whitelistApps: [] };
        const others = await listNonQuotaExemptRunningCatalogApps(limitLu, activeUsersNow, loadQuotaExemptAppIds());
        return { whitelistRunning: true, onlyWhitelist: others.length === 0, others, whitelistApps: [] };
    }
    if (exemptAppIds && exemptAppIds.size > 0) {
        const whitelistRunning = await anyWhitelistedMonitorCatalogAppRunning(limitLu, activeUsers);
        if (whitelistRunning) {
            const others = await listNonQuotaExemptRunningCatalogApps(limitLu, activeUsers, loadQuotaExemptAppIds());
            const onlyWhitelist = others.length === 0;
            let whitelistApps = [];
            if (onlyWhitelist && lastExemptScreenTimeInfoState !== 'paused') {
                try {
                    const entries = readMonitorCatalogEntries();
                    const exemptIdsLower = new Set([...loadQuotaExemptAppIds()].map(s => String(s || '').trim().toLowerCase()).filter(Boolean));
                    const exemptProcLower = loadQuotaExemptProcessNamesLower();
                    whitelistApps = entries
                        .filter(e => {
                            const id = String(e?.appId || '').trim().toLowerCase();
                            const proc = String(e?.processName || '').trim().toLowerCase();
                            return (id && exemptIdsLower.has(id)) || (proc && exemptProcLower.has(proc));
                        })
                        .slice(0, 12)
                        .map(e => ({ appId: e.appId || undefined, appName: e.appName || undefined, processName: e.processName || undefined }));
                } catch { /* ignore */ }
            }
            wlCtx = { whitelistRunning, onlyWhitelist, others, whitelistApps };
        } else if (lastExemptScreenTimeInfoState) {
            lastExemptScreenTimeInfoState = '';
        }
    }

    if (wlCtx && logMinute) {
        if (wlCtx.onlyWhitelist) {
            skipMinuteForExemptOnly = true;
            log.info(`screenTime: whitelisted app running — skipping minute increment`);
            if (lastExemptScreenTimeInfoState !== 'paused') {
                lastExemptScreenTimeInfoState = 'paused';
                lastExemptScreenTimeInfoMs = 0;
                notifyExemptScreenTimePausedIfNeeded(limitLu, wlCtx.whitelistApps);
            }
        } else {
            if (wlCtx.others.length) log.info(`screenTime: whitelist active but other apps running: ${wlCtx.others.map(a => a.processName || a.appId || '?').join(', ')}`);
            if (lastExemptScreenTimeInfoState !== 'counting') {
                lastExemptScreenTimeInfoState = 'counting';
                lastExemptScreenTimePausedInfoMs = 0;
            }
            notifyExemptScreenTimeStillCountingIfNeeded(limitLu, wlCtx.others);
        }
    }

    if (logMinute) {
        if (!skipMinuteForExemptOnly) {
            if (limitLu) {
                if (hasSessionForLimit) {
                    ensureUserMinutes(usage, limitLu);
                    usage.users[limitLu].minutes = Math.max(0, Number(usage.users[limitLu].minutes) || 0) + 1;
                }
            } else if (activeUsers.length > 0) {
                ensureUserMinutes(usage, '');
                usage.users[''].minutes = Math.max(0, Number(usage.users[''].minutes) || 0) + 1;
            }
        }
    }
    usage.date = today;

    const minutes = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
    const limitBase = Math.max(0, Number(period.dailyLimitMinutes) || 0);
    const extra = Math.max(0, Number(usage.extraAllowanceMinutes) || 0);
    const limit = limitBase + extra;

    if (!s.enabled) {
        writeUsage(usage);
        broadcast({ type: 'status', screenTime: { enabled: false, minutes, limitMinutes: limit, remaining: limit - minutes } });
        return;
    }

    // Enforce allowed hours: grace period, then terminate (parent may set override end time for today via lockscreen)
    if (period.allowedHoursEnabled) {
        if (!isWithinAllowedHours(period, now, usage)) {
            if (allowedHoursGraceStartMs === 0) {
                allowedHoursGraceStartMs = Date.now();
                const graceEndsAt = allowedHoursGraceStartMs + ALLOWED_HOURS_GRACE_MS;
                const warnPayload = {
                    type: 'allowed-hours',
                    heading: 'Computer um diese Zeit nicht erlaubt',
                    message: 'Die Computernutzung ist zu dieser Zeit nicht gestattet.',
                    graceEndsAt,
                    allowedHoursOverrideOptions: allowedHoursOverrideOptionHHMMs(period)
                };
                writeUsage(usage);
                notifyOrSpawn(warnPayload, 'Computer um diese Zeit nicht erlaubt', 'Die Computernutzung ist zu dieser Zeit nicht gestattet.', 'critical', false, limitLu);
                return;
            }
            if (Date.now() - allowedHoursGraceStartMs < ALLOWED_HOURS_GRACE_MS) {
                writeUsage(usage);
                return;
            }
            writeUsage(usage);
            const wlNow = await computeWhitelistContextNow(sessions);
            if (wlNow?.whitelistRunning && wlNow.onlyWhitelist) {
                notifyLogoutBlockedWhileWhitelistOnlyOnce('allowed-hours', limitLu);
                lastWhitelistOnlyBlockedLogoutMs = Date.now();
                return;
            }
            LOGOUT_BLOCKED_INFO_ONCE_TYPES.delete(`allowed-hours::${String(limitLu || '')}`);
            if ((Date.now() - lastWhitelistOnlyBlockedLogoutMs) < WHITELIST_ONLY_LOGOUT_DEBOUNCE_MS) {
                log.info(`allowedHours: debounce active after whitelist-only block — skipping terminate (cooldown)`);
                return;
            }
            await terminateSessionsForPolicy(sessions, limitLu);
            allowedHoursGraceStartMs = 0;
            const startM = scheduleStartDayMinutes(period);
            const baseEnd = scheduleEndDayMinutes(period);
            if (startM <= baseEnd) {
                const endHHMM = allowedHoursPostLogoutOverrideEndHHMM(now);
                const ov = parseOverrideEndDayMinutes(endHHMM);
                if (ov != null && ov > baseEnd) {
                    usage.allowedHoursOverrideEnd = endHHMM;
                    usage.allowedHoursExtraMinutes = 0;
                    appendActivityDaemon({ action: 'allowed_hours_post_logout_override', endHHMM });
                    writeUsage(usage);
                }
            }
            return;
        } else if (allowedHoursGraceStartMs !== 0) {
            allowedHoursGraceStartMs = 0;
            LOGOUT_BLOCKED_INFO_ONCE_TYPES.delete(`allowed-hours::${String(limitLu || '')}`);
        }

        // Warn 10/5/2 minutes before allowed-hours end time (only while within the window and session is active)
        if (hasSessionForLimit) {
            const effectiveEnd = effectiveAllowedHoursEndDayMinutes(period, usage);
            const nowT = now.getHours() * 60 + now.getMinutes();
            const minutesUntilEnd = effectiveEnd - nowT;

            // Reset warn flags when effective end time shifted (bonus/override applied)
            if (usage.warnSnapAHEnd == null || Number(usage.warnSnapAHEnd) !== effectiveEnd) {
                usage.warnedAH10 = false; usage.warnedAH5 = false; usage.warnedAH2 = false;
                usage.warnSnapAHEnd = effectiveEnd;
            }

            const ahOverrideOpts = allowedHoursOverrideOptionHHMMs(period);
            if (minutesUntilEnd <= 2 && minutesUntilEnd > 0 && !usage.warnedAH2) {
                usage.warnedAH2 = true;
                if (!usage.warnedAH10) { usage.warnedAH10 = true; usage.warnedAH5 = true; }
                notifyOrSpawn({ type: 'low', subtype: 'allowed-hours', remaining: minutesUntilEnd, allowedHoursOverrideOptions: ahOverrideOpts }, 'Computer bald gesperrt', `Noch ${minutesUntilEnd} Min. bis zum Ende der erlaubten Zeit.`, 'critical', false, limitLu);
            } else if (minutesUntilEnd <= 5 && minutesUntilEnd > 0 && !usage.warnedAH5) {
                usage.warnedAH5 = true;
                if (!usage.warnedAH10) { usage.warnedAH10 = true; }
                notifyOrSpawn({ type: 'low', subtype: 'allowed-hours', remaining: minutesUntilEnd, allowedHoursOverrideOptions: ahOverrideOpts }, 'Computer bald gesperrt', `Noch ${minutesUntilEnd} Min. bis zum Ende der erlaubten Zeit.`, 'normal', false, limitLu);
            } else if (minutesUntilEnd <= 10 && minutesUntilEnd > 0 && !usage.warnedAH10) {
                usage.warnedAH10 = true;
                notifyOrSpawn({ type: 'low', subtype: 'allowed-hours', remaining: minutesUntilEnd, allowedHoursOverrideOptions: ahOverrideOpts }, 'Computer bald gesperrt', `Noch ${minutesUntilEnd} Min. bis zum Ende der erlaubten Zeit.`, 'normal', false, limitLu);
            }
        }
    }

    if (!period.dailyLimitEnabled) {
        writeUsage(usage);
        return;
    }

    // Reset warn flags when time was extended or limit changed (snap mismatch)
    const snap = usage.warnSnapLimit;
    const snapMismatch = snap == null || Number(snap) !== Number(limit);
    const remainingCheck = limit - minutes;
    if (snapMismatch || remainingCheck > 10) {
        usage.warned10 = false; usage.warned5 = false; usage.warned2 = false;
        delete usage.warnSnapLimit;
    } else if (remainingCheck > 5) {
        usage.warned5 = false; usage.warned2 = false;
    } else if (remainingCheck > 2) {
        usage.warned2 = false;
    }

    const remaining = limit - minutes;

    if (logMinute) log.info(`screenTime sessions=${sessions.length} users=[${activeUsers.join(',')}] minutes=${minutes} limit=${limit} remaining=${remaining} limitEnabled=${period.dailyLimitEnabled} period=${isWeekend?'weekend':'weekday'}`);

    if (remaining <= 0) {
        // Skip exhausted enforcement when pinned user is not on seat0 or has no GUI session (avoid parent receiving child limit warnings).
        if (limitLu && !hasSessionForLimit) {
            usage.warnedScreenTimeExhausted = false;
        } else {
            if (!usage.warnedScreenTimeExhausted) {
                usage.warnedScreenTimeExhausted = true;
                const graceEndsAt = Date.now() + EXHAUSTED_LOGOUT_GRACE_MS;
                const warnPayload = { type: 'exhausted', effectiveLimit: limit, usedMinutes: minutes, remaining: 0, graceEndsAt };
                notifyOrSpawn(warnPayload, 'Bildschirmzeit aufgebraucht', `Tageslimit von ${limit} Min. erreicht.`, 'critical', false, limitLu);
                writeUsage(usage);
                await new Promise(r => setTimeout(r, EXHAUSTED_LOGOUT_GRACE_MS));
            }
            const freshAfterExhaustWait = readUsage();
            if (freshAfterExhaustWait.date === usage.date) {
                usage.extraAllowanceMinutes = freshAfterExhaustWait.extraAllowanceMinutes;
            }
            const limitAfterWait = Math.max(0, Number(period.dailyLimitMinutes) || 0) + Math.max(0, Number(usage.extraAllowanceMinutes) || 0);
            const minutesAfterWait = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
            const remainingAfterWait = limitAfterWait - minutesAfterWait;
            if (remainingAfterWait > 0) {
                usage.warnedScreenTimeExhausted = false;
                usage.warned10 = false; usage.warned5 = false; usage.warned2 = false;
                delete usage.warnSnapLimit;
            } else {
                const sessionsNow = await getActiveGraphicalSessions();
                const wlNow = await computeWhitelistContextNow(sessionsNow);
                if (wlNow?.whitelistRunning && wlNow.onlyWhitelist) {
                    notifyLogoutBlockedWhileWhitelistOnlyOnce('exhausted', limitLu);
                    writeUsage(usage);
                    lastWhitelistOnlyBlockedLogoutMs = Date.now();
                    return;
                }
                LOGOUT_BLOCKED_INFO_ONCE_TYPES.delete(`exhausted::${String(limitLu || '')}`);
                if ((Date.now() - lastWhitelistOnlyBlockedLogoutMs) < WHITELIST_ONLY_LOGOUT_DEBOUNCE_MS) {
                    log.info(`exhausted: debounce active after whitelist-only block — skipping terminate (cooldown)`);
                    writeUsage(usage);
                    return;
                }
                await terminateSessionsForPolicy(sessionsNow, limitLu);
                // Roll back 2 minutes so the next login session starts cleanly without immediately triggering exhausted again.
                const userKey = limitLu || '';
                if (usage.users && usage.users[userKey] && typeof usage.users[userKey].minutes === 'number') {
                    usage.users[userKey].minutes = Math.max(0, usage.users[userKey].minutes - RELOGIN_BUFFER_MINUTES);
                }
                usage.warnedScreenTimeExhausted = false;
                usage.warned10 = false; usage.warned5 = false; usage.warned2 = false;
                delete usage.warnSnapLimit;
                writeUsage(usage);
            }
        }
    } else {
        if (usage.warnedScreenTimeExhausted) usage.warnedScreenTimeExhausted = false;
        LOGOUT_BLOCKED_INFO_ONCE_TYPES.delete(`exhausted::${String(limitLu || '')}`);
        if (hasSessionForLimit) {
            if (remaining <= 2 && !usage.warned2) {
                usage.warned2 = true;
                if (!usage.warnSnapLimit) { usage.warned10 = true; usage.warned5 = true; usage.warnSnapLimit = limit; }
                notifyOrSpawn({ type: 'low', effectiveLimit: limit, usedMinutes: minutes, remaining }, 'Bildschirmzeit fast aufgebraucht', `Noch ${remaining} Min. übrig heute.`, 'critical', false, limitLu);
            } else if (remaining <= 5 && !usage.warned5) {
                usage.warned5 = true;
                if (!usage.warnSnapLimit) { usage.warned10 = true; usage.warnSnapLimit = limit; }
                notifyOrSpawn({ type: 'low', effectiveLimit: limit, usedMinutes: minutes, remaining }, 'Bildschirmzeit fast aufgebraucht', `Noch ${remaining} Min. übrig heute.`, 'normal', false, limitLu);
            } else if (remaining <= 10 && !usage.warned10) {
                usage.warned10 = true;
                usage.warnSnapLimit = limit;
                notifyOrSpawn({ type: 'low', effectiveLimit: limit, usedMinutes: minutes, remaining }, 'Bildschirmzeit fast aufgebraucht', `Noch ${remaining} Min. übrig heute.`, 'normal', false, limitLu);
            }
        }
    }

    const minutesStatus = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
    const limitStatus = Math.max(0, Number(period.dailyLimitMinutes) || 0) + Math.max(0, Number(usage.extraAllowanceMinutes) || 0);
    const remainingStatus = limitStatus - minutesStatus;
    writeUsage(usage);
    broadcast({ type: 'status', screenTime: { enabled: true, dailyLimitEnabled: true, minutes: minutesStatus, limitMinutes: limitStatus, remaining: Math.max(0, remainingStatus) } });
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
    const monitorEntries = readMonitorCatalogEntries();
    const procByAppIdLower = new Map();
    for (const e of monitorEntries) {
        const id = String(e?.appId || '').trim();
        const proc = String(e?.processName || '').trim();
        if (!id || !proc) continue;
        procByAppIdLower.set(id.toLowerCase(), proc);
    }

    for (const q of quotas) {
        const appId = q.appId || '';
        const procFromQuota = String(q.processName || '').trim();
        const baseLimit = Math.max(1, Math.floor(Number(q.minutesPerDay) || 60));
        const name = q.appName || procFromQuota;
        const lu = normalizeLinuxUser(q.linuxUser);
        if (!appId) continue;

        const usersForQuota = lu ? activeUsers.filter(u => u === lu) : activeUsers;
        if (lu && usersForQuota.length === 0) {
            const wk = `${appId}:${lu}`;
            if (!quotaLinuxUserNoSessionWarnOnce.has(wk)) {
                quotaLinuxUserNoSessionWarnOnce.add(wk);
                log.warn(`quota ${name}: linuxUser=${lu} has no active graphical session in loginctl (active: ${activeUsers.join(', ') || 'none'}). Minutes stay 0; set Quota linuxUser to the desktop user who runs this app (same as their GNOME login).`);
            }
            continue;
        }
        const catProc = procByAppIdLower.get(String(appId).trim().toLowerCase()) || '';
        const candidatesSet = new Set([
            ...processNameCandidatesForAppEntry(procFromQuota, appId),
            ...processNameCandidatesForAppEntry(catProc, appId)
        ].filter(Boolean));
        const procCandidates = Array.from(candidatesSet);
        const runningCandidates = [];
        for (const cand of procCandidates) {
            if (await anyUserRunningProcess(usersForQuota, cand)) runningCandidates.push(cand);
        }
        const isRunning = runningCandidates.length > 0;
        const procForMsg = runningCandidates[0] || procFromQuota;
        const uk = quotaUsageKey(appId, lu);
        const bonus = quotaBonusMinutes(appExtra, appId, lu);
        const limit = baseLimit + bonus;
        const usedBefore = quotaUsedMinutes(appUsage, appId, lu);

        // When usage was reset to 0, clear warn-once flags so warnings fire again in the new session
        if (usedBefore === 0) {
            for (const k of appQuotaWarnOnce) { if (k.startsWith(uk + ':')) appQuotaWarnOnce.delete(k); }
        }

        if (logMinute) log.info(`quota app=${name} proc=${procForMsg} running=${isRunning} used=${usedBefore} limit=${limit} bonus=${bonus}`);

        if (isRunning) {
            if (!exempt.has(appId) && usedBefore >= limit) {
                const key = `${uk}:kill`;
                if (!appQuotaWarnOnce.has(key)) {
                    appQuotaWarnOnce.add(key);
                    const warnPayload = { type: 'app-exhausted', appId, appName: name, processName: procForMsg, effectiveLimit: limit, usedMinutes: usedBefore, linuxUser: lu || undefined };
                    notifyOrSpawn(warnPayload, `${name}: Zeit aufgebraucht`, `Tageslimit von ${limit} Min. erreicht.`, 'critical');
                }
                for (const cand of runningCandidates) await pkillAllUsers(usersForQuota, cand);
                appendActivityDaemon({ action: 'app_killed_quota_exhausted', appId, appName: name, processName: procForMsg, usedMinutes: usedBefore, limit, linuxUser: lu || undefined });
            } else if (logMinute) {
                if (!exempt.has(appId) && usedBefore === limit - 1) {
                    const k = `${uk}:final`;
                    if (!appQuotaWarnOnce.has(k)) {
                        // First time hitting limit-1: warn but don't increment yet — gives ~60s grace before kill.
                        appQuotaWarnOnce.add(k);
                        const warnPayload = { type: 'app-final', appId, appName: name, processName: procForMsg, effectiveLimit: limit, usedMinutes: usedBefore, linuxUser: lu || undefined };
                        notifyOrSpawn(warnPayload, `${name}: Letzte Minute`, `Letzte Minute für ${name}. Arbeit speichern!`, 'normal');
                    } else {
                        appUsage[uk] = usedBefore + 1;
                    }
                } else {
                    appUsage[uk] = usedBefore + 1;
                }
            }
        }

        const used = quotaUsedMinutes(appUsage, appId, lu);
        const remaining = limit - used;

        if (remaining === 2 && isRunning && !exempt.has(appId) && limit >= 3) {
            const k = `${uk}:2`;
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k);
                const low2Payload = { type: 'app-low', appId, appName: name, processName: procForMsg, effectiveLimit: limit, usedMinutes: used, remaining: 2, linuxUser: lu || undefined };
                notifyOrSpawn(low2Payload, `${name}: Zeit fast aufgebraucht`, `Noch 2 Min. für ${name}.`, 'normal');
            }
        } else if (remaining === 5 && isRunning) {
            const k = `${uk}:5`;
            if (!appQuotaWarnOnce.has(k)) {
                appQuotaWarnOnce.add(k);
                const low5Payload = { type: 'app-five', appId, appName: name, processName: procForMsg, effectiveLimit: limit, usedMinutes: used, remaining: 5, linuxUser: lu || undefined };
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
    const tickDate = localIsoDate();
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
        const candidates = processNameCandidatesForAppEntry(entry.processName, appId);
        if (!appId || !candidates.length) continue;
        for (const user of activeUsers) {
            const matched = await pgrepUserAnyCandidate(user, candidates);
            if (matched && logMinute) {
                const key = `${user}:${appId}`;
                track[key] = (track[key] || 0) + 1;
            }
        }
    }
    // Guard against midnight-crossing: if the date changed during the async loop,
    // the track was read from yesterday's file. Discard to avoid polluting today's file.
    if (localIsoDate() !== tickDate) return;
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
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
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
    const payload = { type: 'exhausted', effectiveLimit: 120, usedMinutes: 120, remaining: 0, graceEndsAt: Date.now() + EXHAUSTED_LOGOUT_GRACE_MS };
    notifyOrSpawn(payload, 'LiFE Test', 'Warnfenster-Test (Systemd-Daemon).', 'normal');
}

async function tickWork(logMinute) {
    maybeHandleDaemonWarningTestRequest();
    if (logMinute) {
        try { await defaultSync.maybeSync(); } catch (e) { log.warn(`defaultSync tick: ${e && e.message ? e.message : String(e)}`); }
    }
    if (logMinute) {
        const now = Date.now();
        if (now - lastPortableScanMs >= PORTABLE_SCAN_MIN_MS) {
            lastPortableScanMs = now;
            try { updatePortableAppImagesCache(); } catch (e) { log.warn(`portable appimages scan failed: ${e && e.message ? e.message : String(e)}`); }
            try { buildAndWriteAppCatalog(); } catch (e) { log.warn(`app-catalog: portable refresh failed: ${e && e.message ? e.message : String(e)}`); }
        }
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
            usage.warned10 = false; usage.warned5 = false; usage.warned2 = false;
            usage.warnedScreenTimeExhausted = false;
            delete usage.warnSnapLimit;
            writeUsage(usage);
            const s = readSchedule();
            const _extNow = new Date(); const _extWd = _extNow.getDay(); const _extPeriod = (_extWd === 0 || _extWd === 6) ? s.weekend : s.weekday;
            const mins = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
            const limit = Math.max(0, Number(_extPeriod.dailyLimitMinutes) || 0) + usage.extraAllowanceMinutes;
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

    if (cmd.type === 'allowed-hours-extend') {
        const gate = checkParentPassword(cmd.password);
        if (!gate.ok) {
            const err = gate.reason === 'no_password' ? 'Kein Eltern-Passwort gesetzt.' : 'Falsches Passwort.';
            client.write(JSON.stringify({ type: 'allowed-hours-extend-result', ok: false, error: err }) + '\n');
            return;
        }
        const minutes = Math.min(180, Math.max(5, Math.floor(Number(cmd.minutes) || 30)));
        try {
            const usage = readUsage();
            usage.allowedHoursExtraMinutes = Math.max(0, Number(usage.allowedHoursExtraMinutes) || 0) + minutes;
            allowedHoursGraceStartMs = 0;
            writeUsage(usage);
            appendActivityDaemon({ action: 'allowed_hours_extended', minutes, total: usage.allowedHoursExtraMinutes });
            client.write(JSON.stringify({ type: 'allowed-hours-extend-result', ok: true, minutes, total: usage.allowedHoursExtraMinutes }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'allowed-hours-extend-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'allowed-hours-override-end') {
        const gate = checkParentPassword(cmd.password);
        if (!gate.ok) {
            const err = gate.reason === 'no_password' ? 'Kein Eltern-Passwort gesetzt.' : 'Falsches Passwort.';
            client.write(JSON.stringify({ type: 'allowed-hours-override-end-result', ok: false, error: err }) + '\n');
            return;
        }
        const endHHMM = typeof cmd.endHHMM === 'string' ? cmd.endHHMM.trim() : '';
        try {
            const s = readSchedule();
            const now = new Date();
            const wd = isoWeekday(now);
            const period = wd >= 6 ? s.weekend : s.weekday;
            const allowed = allowedHoursOverrideOptionHHMMs(period);
            if (!allowed.includes(endHHMM)) {
                client.write(JSON.stringify({ type: 'allowed-hours-override-end-result', ok: false, error: 'Ungültige Endzeit.' }) + '\n');
                return;
            }
            const usage = readUsage();
            usage.allowedHoursOverrideEnd = endHHMM;
            usage.allowedHoursExtraMinutes = 0;
            allowedHoursGraceStartMs = 0;
            writeUsage(usage);
            appendActivityDaemon({ action: 'allowed_hours_override_end', endHHMM });
            client.write(JSON.stringify({ type: 'allowed-hours-override-end-result', ok: true, endHHMM }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'allowed-hours-override-end-result', ok: false, error: e.message }) + '\n');
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
        const _now = new Date();
        const _wd = _now.getDay(); const _isWe = _wd === 0 || _wd === 6;
        const _period = _isWe ? s.weekend : s.weekday;
        const minutes = effectiveScreenMinutes(usage, s.screenTimeLinuxUser);
        const limit = Math.max(0, Number(_period.dailyLimitMinutes) || 0) + Math.max(0, Number(usage.extraAllowanceMinutes) || 0);
        client.write(JSON.stringify({
            type: 'status',
            screenTime: { enabled: s.enabled, dailyLimitEnabled: _period.dailyLimitEnabled, minutes, limitMinutes: limit, remaining: Math.max(0, limit - minutes) }
        }) + '\n');
        return;
    }

    // --- New privileged commands (frontend runs as normal user, daemon executes as root) ---

    if (cmd.type === 'register-client') {
        // Frontend registers its executable path so daemon can spawn warning windows
        if (typeof cmd.execPath === 'string' && cmd.execPath) {
            registeredClientExecPath = cmd.execPath;
            try {
                fs.writeFileSync(
                    path.join(CONFIG_DIR, '.electron-exec'),
                    cmd.execPath + '\n',
                    { encoding: 'utf8', mode: 0o644 }
                );
            } catch { /* best-effort */ }
        }
        client.write(JSON.stringify({ type: 'register-client-result', ok: true }) + '\n');
        return;
    }

    if (cmd.type === 'write-config') {
        // Write /etc/life-parental/default.json atomically; invalidate in-memory cache.
        // Strip security section — auth is stored in auth.json (600) not here.
        try {
            const content = typeof cmd.content === 'string' ? cmd.content : null;
            if (!content) throw new Error('no content');
            const parsed = JSON.parse(content);
            delete parsed.security; // never store password hash in world-readable file
            const p = path.join(CONFIG_DIR, 'default.json');
            const tmp = path.join(CONFIG_DIR, `.default.json.tmp-${Date.now()}`);
            fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o644 });
            fs.renameSync(tmp, p);
            cachedDefaultConfig = null;
            cachedDefaultMtimeMs = 0;
            log.info('write-config: ok');
            client.write(JSON.stringify({ type: 'write-config-result', ok: true }) + '\n');
        } catch (e) {
            log.error('write-config: ' + e.message);
            client.write(JSON.stringify({ type: 'write-config-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'auth:is-set') {
        const sec = readPasswordSecurity();
        client.write(JSON.stringify({ type: 'auth:is-set-result', ok: true, isSet: !!sec.passwordHash }) + '\n');
        return;
    }

    if (cmd.type === 'auth:check') {
        const sec = readPasswordSecurity();
        let valid = false;
        if (!sec.passwordHash) {
            valid = true; // no password set → allow through
        } else if (typeof cmd.password === 'string' && cmd.password.length > 0) {
            valid = hashPassword(cmd.password, sec.salt) === sec.passwordHash;
        }
        client.write(JSON.stringify({ type: 'auth:check-result', ok: true, valid }) + '\n');
        return;
    }

    if (cmd.type === 'auth:set') {
        try {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = hashPassword(typeof cmd.password === 'string' ? cmd.password : '', salt);
            writeAuthFile(hash, salt);
            log.info('auth:set ok');
            client.write(JSON.stringify({ type: 'auth:set-result', ok: true }) + '\n');
        } catch (e) {
            log.error('auth:set: ' + e.message);
            client.write(JSON.stringify({ type: 'auth:set-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'auth:change') {
        try {
            const sec = readPasswordSecurity();
            if (sec.passwordHash) {
                const oldOk = typeof cmd.oldPassword === 'string' &&
                    hashPassword(cmd.oldPassword, sec.salt) === sec.passwordHash;
                if (!oldOk) {
                    client.write(JSON.stringify({ type: 'auth:change-result', ok: false, error: 'Current password is incorrect' }) + '\n');
                    return;
                }
            }
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = hashPassword(typeof cmd.newPassword === 'string' ? cmd.newPassword : '', salt);
            writeAuthFile(hash, salt);
            log.info('auth:change ok');
            client.write(JSON.stringify({ type: 'auth:change-result', ok: true }) + '\n');
        } catch (e) {
            log.error('auth:change: ' + e.message);
            client.write(JSON.stringify({ type: 'auth:change-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'write-hosts') {
        // Splice LiFE section into /etc/hosts and flush DNS caches
        const MARKER_BEGIN = '# LiFE Parental Control - BEGIN';
        const MARKER_END = '# LiFE Parental Control - END';
        try {
            const entries = Array.isArray(cmd.entries) ? cmd.entries : [];
            const content = fs.readFileSync('/etc/hosts', 'utf8');
            const lines = entries.map(e => `${e.enabled ? '' : '#'}0.0.0.0 ${e.domain}`);
            const section = `\n${lines.join('\n')}\n`;
            const begin = content.indexOf(MARKER_BEGIN);
            const end = content.indexOf(MARKER_END);
            let newContent;
            if (begin !== -1 && end !== -1) {
                newContent = content.slice(0, begin) + MARKER_BEGIN + section + MARKER_END + content.slice(end + MARKER_END.length);
            } else {
                newContent = content.trimEnd() + `\n\n${MARKER_BEGIN}${section}${MARKER_END}\n`;
            }
            fs.writeFileSync('/etc/hosts', newContent, 'utf8');
            execFile('systemd-resolve', ['--flush-caches'], { timeout: 3000 }, () => {});
            execFile('resolvectl', ['flush-caches'], { timeout: 3000 }, () => {});
            execFile('dnsmasq', ['--clear-on-reload'], { timeout: 3000 }, () => {});
            log.info(`write-hosts: applied ${entries.length} entries`);
            client.write(JSON.stringify({ type: 'write-hosts-result', ok: true }) + '\n');
        } catch (e) {
            log.error('write-hosts: ' + e.message);
            client.write(JSON.stringify({ type: 'write-hosts-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'write-dnsmasq') {
        // Write /etc/dnsmasq.conf with blocked domains + upstream DNS, set /etc/resolv.conf to use local dnsmasq,
        // protect resolv.conf with chattr +i so NetworkManager cannot overwrite it.
        const DNSMASQ_CONF = '/etc/dnsmasq.conf';
        const RESOLV_CONF  = '/etc/resolv.conf';
        // dns4eu server IPs
        const DNS4EU = {
            dns4eu_protective:  '86.54.11.1',
            dns4eu_child:       '86.54.11.12',
            dns4eu_ads:         '86.54.11.13',
            dns4eu_child_ads:   '86.54.11.11',
        };
        try {
            const entries  = Array.isArray(cmd.entries) ? cmd.entries : [];
            const dnsMode  = cmd.dnsMode || 'dns4eu_protective';
            const dhcpFallbackDns = typeof cmd.dhcpFallbackDns === 'string' ? cmd.dhcpFallbackDns : null;
            let upstreamDns;
            if (dnsMode === 'dhcp') {
                // Use cached DHCP DNS from config first (written by NM dispatcher on every network-up)
                upstreamDns = dhcpFallbackDns || null;
                if (!upstreamDns) {
                    try {
                        const out = execFileSync('nmcli', ['-t', '-f', 'IP4.DNS', 'dev', 'show'], { timeout: 5000, encoding: 'utf8' });
                        const match = out.match(/IP4\.DNS\[1\]:([^\n]+)/);
                        upstreamDns = match ? match[1].trim() : null;
                    } catch { upstreamDns = null; }
                }
                if (!upstreamDns) {
                    try {
                        const out = fs.readFileSync('/run/NetworkManager/resolv.conf', 'utf8');
                        const m = out.match(/^nameserver\s+([^\s]+)/m);
                        upstreamDns = m ? m[1] : null;
                    } catch { upstreamDns = null; }
                }
                if (!upstreamDns) {
                    client.write(JSON.stringify({ type: 'write-dnsmasq-result', ok: false, error: 'dhcp: could not detect local DNS server' }) + '\n');
                    return;
                }
            } else {
                // Probe dns4eu reachability — if unreachable on this network (e.g. school),
                // fall back to the DHCP DNS immediately. No fallback entry in dnsmasq
                // avoids the 5-second timeout dnsmasq imposes before trying the next server.
                const dns4euIp = DNS4EU[dnsMode] || DNS4EU['dns4eu_protective'];
                if (probeDns4euSync(dns4euIp)) {
                    upstreamDns = dns4euIp;
                } else {
                    upstreamDns = dhcpFallbackDns;
                    if (!upstreamDns) {
                        client.write(JSON.stringify({ type: 'write-dnsmasq-result', ok: false, error: 'dns4eu unreachable and no DHCP fallback DNS available' }) + '\n');
                        return;
                    }
                    log.warn(`write-dnsmasq: dns4eu unreachable, using DHCP fallback ${upstreamDns}`);
                }
            }

            // DoH endpoints + canary domains — always blocked when web filter is active.
            // Browsers (Firefox, all Chromium-based) detect these as unavailable and
            // automatically fall back to system DNS (dnsmasq).
            // Canary domains only — browsers check these at startup and disable DoH
            // automatically if they return NXDOMAIN. Safe: browsers don't load content
            // from these domains, so blocking them never breaks browsing.
            const DOH_BLOCK = [
                'use-application-dns.net',   // Firefox canary
                'dns-over-https.invalid',    // Chrome/Brave/Edge/Opera/Vivaldi canary
            ].map(d => `local=/${d}/`).join('\n');

            // Build /etc/dnsmasq.d/life-parental-blocked.conf with blocked domains
            const blockedLines = entries
                .filter(e => e.enabled !== false)
                .map(e => `local=/${e.domain}/`)
                .join('\n');

            fs.mkdirSync('/etc/dnsmasq.d', { recursive: true });
            fs.writeFileSync('/etc/dnsmasq.d/life-parental-blocked.conf',
                '# Generated by LiFE Parental Control — do not edit manually\n' +
                '# DoH endpoints blocked to force system DNS usage\n' +
                DOH_BLOCK + '\n\n' +
                '# Blocked domains (NXDOMAIN — overrides DoH/DoT upstreams)\n' +
                blockedLines + '\n', 'utf8');

            // Build /etc/dnsmasq.conf — single upstream only.
            // No fallback server, no strict-order: dnsmasq never waits 5s before
            // giving up on an unreachable server. The upstream was already chosen
            // (dns4eu or DHCP) based on a live probe done before writing this file.
            const dnsmasqConf = [
                '# Generated by LiFE Parental Control — do not edit manually',
                'listen-address=127.0.0.1',
                'bind-interfaces',
                `server=${upstreamDns}`,
                'no-resolv',
                'no-poll',
                'cache-size=1000',
                'domain-needed',
                'bogus-priv',
                'conf-dir=/etc/dnsmasq.d/,*.conf',
            ].join('\n') + '\n';

            fs.writeFileSync(DNSMASQ_CONF, dnsmasqConf, 'utf8');
            try { fs.chmodSync(DNSMASQ_CONF, 0o644); } catch { /* ignore */ }

            // Write /etc/resolv.conf — remove immutable bit first, write, re-apply
            try { execFileSync('chattr', ['-i', RESOLV_CONF], { timeout: 3000 }); } catch { /* not immutable yet, ok */ }
            fs.writeFileSync(RESOLV_CONF, 'nameserver 127.0.0.1\n', 'utf8');
            try { fs.chmodSync(RESOLV_CONF, 0o644); } catch { /* ignore */ }
            try { execFileSync('chattr', ['+i', RESOLV_CONF], { timeout: 3000 }); } catch (e) {
                log.warn('write-dnsmasq: chattr +i failed: ' + e.message);
            }

            // Reload dnsmasq
            execFile('systemctl', ['restart', 'dnsmasq.service'], { timeout: 10000 }, () => {});

            log.info(`write-dnsmasq: applied ${entries.filter(e => e.enabled !== false).length} blocked domains, upstream=${upstreamDns}`);
            client.write(JSON.stringify({ type: 'write-dnsmasq-result', ok: true }) + '\n');
        } catch (e) {
            log.error('write-dnsmasq: ' + e.message);
            client.write(JSON.stringify({ type: 'write-dnsmasq-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }


    if (cmd.type === 'get-dhcp-dns') {
        try {
            let ip = null;
            try {
                const out = execFileSync('nmcli', ['-t', '-f', 'IP4.DNS', 'dev', 'show'], { timeout: 5000, encoding: 'utf8' });
                const m = out.match(/IP4\.DNS\[1\]:([^\n]+)/);
                ip = m ? m[1].trim() : null;
            } catch { /* ignore */ }
            if (!ip) {
                try {
                    const resolvContent = fs.readFileSync('/run/systemd/resolve/resolv.conf', 'utf8');
                    const m = resolvContent.match(/^nameserver\s+([^\s]+)/m);
                    ip = m ? m[1] : null;
                } catch { /* ignore */ }
            }
            client.write(JSON.stringify({ type: 'get-dhcp-dns-result', ok: true, ip }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'get-dhcp-dns-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'remove-dnsmasq') {
        // Remove LiFE webfilter rules, keep dnsmasq enabled as neutral local resolver.
        const DNSMASQ_CONF = '/etc/dnsmasq.conf';
        const RESOLV_CONF  = '/etc/resolv.conf';
        try {
            // Ensure resolv.conf points to local dnsmasq and remains protected.
            try { execFileSync('chattr', ['-i', RESOLV_CONF], { timeout: 3000 }); } catch { /* ignore */ }
            fs.writeFileSync(RESOLV_CONF, 'nameserver 127.0.0.1\n', 'utf8');
            try { fs.chmodSync(RESOLV_CONF, 0o644); } catch { /* ignore */ }
            try { execFileSync('chattr', ['+i', RESOLV_CONF], { timeout: 3000 }); } catch { /* ignore */ }

            // Clear blocked domains file, reset dnsmasq.conf to DHCP-following pass-through.
            try { fs.writeFileSync('/etc/dnsmasq.d/life-parental-blocked.conf', '# LiFE Parental Control — web filter disabled\n', 'utf8'); } catch { /* ignore */ }
            fs.writeFileSync(DNSMASQ_CONF, [
                '# Generated by LiFE Parental Control — web filter disabled',
                'listen-address=127.0.0.1',
                'bind-interfaces',
                'resolv-file=/run/NetworkManager/resolv.conf',
                'no-poll',
                'cache-size=1000',
                'domain-needed',
                'bogus-priv',
                'conf-dir=/etc/dnsmasq.d/,*.conf',
            ].join('\n') + '\n', 'utf8');

            execFile('systemctl', ['restart', 'dnsmasq.service'], { timeout: 10000 }, () => {});
            log.info('remove-dnsmasq: filter cleared, dnsmasq set to DHCP pass-through');
            client.write(JSON.stringify({ type: 'remove-dnsmasq-result', ok: true }) + '\n');
        } catch (e) {
            log.error('remove-dnsmasq: ' + e.message);
            client.write(JSON.stringify({ type: 'remove-dnsmasq-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'grub-enable') {
        (async () => {
            const GRUB_CUSTOM = '/etc/grub.d/40_custom_life_parental';
            const GRUB_10_LINUX = '/etc/grub.d/10_linux';
            try {
                const password = typeof cmd.password === 'string' ? cmd.password : '';
                if (!password) throw new Error('Kein Passwort angegeben.');

                // Generate pbkdf2 hash via grub-mkpasswd-pbkdf2 (pipe password twice via stdin)
                const mkpasswd = spawnSync('grub-mkpasswd-pbkdf2', [], {
                    input: `${password}\n${password}\n`,
                    timeout: 15000,
                    encoding: 'utf8'
                });
                if (mkpasswd.status !== 0) throw new Error('grub-mkpasswd-pbkdf2 fehlgeschlagen: ' + (mkpasswd.stderr || '').trim());
                const combined = (mkpasswd.stdout || '') + (mkpasswd.stderr || '');
                const m = /grub\.pbkdf2\.sha512\.[^\s]+/.exec(combined);
                if (!m) throw new Error('grub-mkpasswd-pbkdf2 lieferte keinen Hash. Output: ' + combined.trim());
                const grubHash = m[0];

                // Write /etc/grub.d/40_custom_life_parental
                const customContent = [
                    '#!/bin/sh',
                    'exec tail -n +3 "$0"',
                    '# LiFE Parental Control — GRUB password (blocks edit/shell, not booting)',
                    'set superusers="life-parental"',
                    `password_pbkdf2 life-parental ${grubHash}`,
                ].join('\n') + '\n';
                fs.writeFileSync(GRUB_CUSTOM, customContent, 'utf8');
                fs.chmodSync(GRUB_CUSTOM, 0o755);

                // Patch 10_linux: add --unrestricted to CLASS if not already present
                if (fs.existsSync(GRUB_10_LINUX)) {
                    const content = fs.readFileSync(GRUB_10_LINUX, 'utf8');
                    if (!content.includes('--unrestricted')) {
                        fs.writeFileSync(GRUB_10_LINUX,
                            content.replace(/^CLASS="--class/m, 'CLASS="--unrestricted --class'),
                            'utf8');
                        log.info('grub-enable: patched 10_linux with --unrestricted');
                    }
                }

                // Regenerate grub.cfg
                if (fs.existsSync('/usr/bin/update-grub')) {
                    execFileSync('update-grub', [], { timeout: 30000 });
                } else if (fs.existsSync('/usr/sbin/grub-mkconfig') || fs.existsSync('/usr/bin/grub-mkconfig')) {
                    execFileSync('grub-mkconfig', ['-o', '/boot/grub/grub.cfg'], { timeout: 30000 });
                } else {
                    throw new Error('Weder update-grub noch grub-mkconfig gefunden.');
                }

                log.info('grub-enable: GRUB password set, grub.cfg regenerated');
                client.write(JSON.stringify({ type: 'grub-enable-result', ok: true }) + '\n');
            } catch (e) {
                log.error('grub-enable: ' + e.message);
                client.write(JSON.stringify({ type: 'grub-enable-result', ok: false, error: e.message }) + '\n');
            }
        })();
        return;
    }

    if (cmd.type === 'grub-disable') {
        // Remove /etc/grub.d/40_custom_life_parental, remove --unrestricted from 10_linux, regenerate grub.cfg.
        const GRUB_CUSTOM = '/etc/grub.d/40_custom_life_parental';
        const GRUB_10_LINUX = '/etc/grub.d/10_linux';
        try {
            // Remove password file
            try { fs.unlinkSync(GRUB_CUSTOM); } catch { /* already gone */ }

            // Remove --unrestricted patch from 10_linux
            if (fs.existsSync(GRUB_10_LINUX)) {
                const content = fs.readFileSync(GRUB_10_LINUX, 'utf8');
                if (content.includes('--unrestricted')) {
                    fs.writeFileSync(GRUB_10_LINUX,
                        content.replace(/^CLASS="--unrestricted --class/m, 'CLASS="--class'),
                        'utf8');
                    log.info('grub-disable: removed --unrestricted from 10_linux');
                }
            }

            // Regenerate grub.cfg
            if (fs.existsSync('/usr/bin/update-grub')) {
                execFileSync('update-grub', [], { timeout: 30000 });
            } else if (fs.existsSync('/usr/sbin/grub-mkconfig') || fs.existsSync('/usr/bin/grub-mkconfig')) {
                execFileSync('grub-mkconfig', ['-o', '/boot/grub/grub.cfg'], { timeout: 30000 });
            } else {
                throw new Error('Weder update-grub noch grub-mkconfig gefunden.');
            }

            log.info('grub-disable: GRUB password removed, grub.cfg regenerated');
            client.write(JSON.stringify({ type: 'grub-disable-result', ok: true }) + '\n');
        } catch (e) {
            log.error('grub-disable: ' + e.message);
            client.write(JSON.stringify({ type: 'grub-disable-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'setup-dnsmasq') {
        // One-time setup: disable systemd-resolved (frees port 53), write minimal dnsmasq.conf,
        // write /etc/resolv.conf → 127.0.0.1 with chattr +i, enable + start dnsmasq.
        const DNSMASQ_CONF = '/etc/dnsmasq.conf';
        const RESOLV_CONF  = '/etc/resolv.conf';
        try {
            // 1. Stop and disable systemd-resolved so port 53 is free
            try { execFileSync('systemctl', ['disable', '--now', 'systemd-resolved'], { timeout: 10000 }); } catch { /* may not be running */ }

            // 2. Create dnsmasq.d and write secure base dnsmasq.conf
            fs.mkdirSync('/etc/dnsmasq.d', { recursive: true });
            const dnsmasqConf = [
                '# Generated by LiFE Parental Control — initial setup',
                'listen-address=127.0.0.1',
                'bind-interfaces',
                'resolv-file=/run/NetworkManager/resolv.conf',
                'no-poll',
                'cache-size=1000',
                'domain-needed',
                'bogus-priv',
                'conf-dir=/etc/dnsmasq.d/,*.conf',
            ].join('\n') + '\n';
            fs.writeFileSync(DNSMASQ_CONF, dnsmasqConf, 'utf8');
            try { fs.chmodSync(DNSMASQ_CONF, 0o644); } catch { /* ignore */ }

            // 3. Write resolv.conf → local dnsmasq, protect with chattr +i
            try { execFileSync('chattr', ['-i', RESOLV_CONF], { timeout: 3000 }); } catch { /* not immutable yet */ }
            fs.writeFileSync(RESOLV_CONF, 'nameserver 127.0.0.1\n', 'utf8');
            try { fs.chmodSync(RESOLV_CONF, 0o644); } catch { /* ignore */ }
            try { execFileSync('chattr', ['+i', RESOLV_CONF], { timeout: 3000 }); } catch (e) {
                log.warn('setup-dnsmasq: chattr +i failed: ' + e.message);
            }

            // 4. Grant dnsmasq binary cap_net_bind_service so the dnsmasq user can bind port 53
            try { execFileSync('setcap', ['cap_net_bind_service=+ep', '/usr/bin/dnsmasq'], { timeout: 5000 }); } catch (e) {
                log.warn('setup-dnsmasq: setcap failed: ' + e.message);
            }

            // 5. Kill any stuck dnsmasq process, then enable and start via systemd
            try { execFileSync('killall', ['dnsmasq'], { timeout: 5000 }); } catch { /* not running, ok */ }
            try { execFileSync('systemctl', ['reset-failed', 'dnsmasq.service'], { timeout: 5000 }); } catch { /* ignore */ }
            try { execFileSync('systemctl', ['enable', 'dnsmasq.service'], { timeout: 5000 }); } catch { /* ignore */ }
            try { execFileSync('systemctl', ['restart', 'dnsmasq.service'], { timeout: 10000 }); } catch (e) {
                throw new Error('dnsmasq start failed: ' + e.message);
            }

            log.info('setup-dnsmasq: systemd-resolved disabled, dnsmasq enabled and started');
            client.write(JSON.stringify({ type: 'setup-dnsmasq-result', ok: true }) + '\n');
        } catch (e) {
            log.error('setup-dnsmasq: ' + e.message);
            client.write(JSON.stringify({ type: 'setup-dnsmasq-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'setup-apparmor') {
        // Enable and start the apparmor systemd service.
        try {
            try { execFileSync('systemctl', ['reset-failed', 'apparmor.service'], { timeout: 5000 }); } catch { /* ignore */ }
            execFileSync('systemctl', ['enable', 'apparmor.service'], { timeout: 10000 });
            execFileSync('systemctl', ['start', 'apparmor.service'], { timeout: 10000 });
            log.info('setup-apparmor: apparmor enabled and started');
            client.write(JSON.stringify({ type: 'setup-apparmor-result', ok: true }) + '\n');
        } catch (e) {
            log.error('setup-apparmor: ' + e.message);
            client.write(JSON.stringify({ type: 'setup-apparmor-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'sync-apparmor') {
        // Write /etc/apparmor.d/life-parental-blocked and reload it
        const APPARMOR_PROFILE = '/etc/apparmor.d/life-parental-blocked';
        try {
            if (!APPARMOR_PARSER_BIN) throw new Error('apparmor_parser not found');
            const content = typeof cmd.profileContent === 'string' ? cmd.profileContent : '';
            if (fs.existsSync(APPARMOR_PROFILE)) {
                spawnSync(APPARMOR_PARSER_BIN, ['-R', APPARMOR_PROFILE], { timeout: 5000, stdio: 'ignore' });
            }
            try { fs.mkdirSync(path.dirname(APPARMOR_PROFILE), { recursive: true }); } catch { /* exists */ }
            fs.writeFileSync(APPARMOR_PROFILE, content, 'utf8');
            if (content.includes('deny')) {
                spawnSync(APPARMOR_PARSER_BIN, ['-a', APPARMOR_PROFILE], { timeout: 5000, stdio: 'ignore' });
            }
            log.info('sync-apparmor: ok');
            client.write(JSON.stringify({ type: 'sync-apparmor-result', ok: true }) + '\n');
        } catch (e) {
            log.error('sync-apparmor: ' + e.message);
            client.write(JSON.stringify({ type: 'sync-apparmor-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'desktop-override') {
        // Write/delete .desktop override files in /usr/local/share/applications + refresh DB
        const OVERRIDE_DIR = '/usr/local/share/applications';
        try {
            fs.mkdirSync(OVERRIDE_DIR, { recursive: true });
            const toWrite = Array.isArray(cmd.write) ? cmd.write : [];
            const toDelete = Array.isArray(cmd.delete) ? cmd.delete : [];
            for (const { appId, content } of toWrite) {
                if (typeof appId !== 'string' || !appId.endsWith('.desktop') || typeof content !== 'string') continue;
                fs.writeFileSync(path.join(OVERRIDE_DIR, appId), content, 'utf8');
            }
            for (const appId of toDelete) {
                if (typeof appId !== 'string' || !appId.endsWith('.desktop')) continue;
                try { fs.unlinkSync(path.join(OVERRIDE_DIR, appId)); } catch { /* already gone */ }
            }
            execFile('update-desktop-database', [OVERRIDE_DIR], { timeout: 5000 }, () => {});
            log.info(`desktop-override: wrote ${toWrite.length} deleted ${toDelete.length}`);
            client.write(JSON.stringify({ type: 'desktop-override-result', ok: true }) + '\n');
        } catch (e) {
            log.error('desktop-override: ' + e.message);
            client.write(JSON.stringify({ type: 'desktop-override-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'write-kiosk') {
        // Write /etc/xdg/kdeglobals and optionally /etc/xdg/plasma-appletsrc
        try {
            fs.mkdirSync('/etc/xdg', { recursive: true });
            if (typeof cmd.kdeglobalsContent === 'string') {
                fs.writeFileSync('/etc/xdg/kdeglobals', cmd.kdeglobalsContent, 'utf8');
            }
            if (cmd.plasmaAppletsrcContent === null) {
                try { fs.unlinkSync('/etc/xdg/plasma-appletsrc'); } catch { /* already gone */ }
            } else if (typeof cmd.plasmaAppletsrcContent === 'string') {
                fs.writeFileSync('/etc/xdg/plasma-appletsrc', cmd.plasmaAppletsrcContent, 'utf8');
            }
            log.info('write-kiosk: ok');
            client.write(JSON.stringify({ type: 'write-kiosk-result', ok: true }) + '\n');
        } catch (e) {
            log.error('write-kiosk: ' + e.message);
            client.write(JSON.stringify({ type: 'write-kiosk-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'get-app-catalog') {
        try {
            let entries = readMonitorCatalogEntries();
            if (!entries.length) {
                buildAndWriteAppCatalog();
                entries = readMonitorCatalogEntries();
            }
            client.write(JSON.stringify({ type: 'get-app-catalog-result', ok: true, apps: entries }) + '\n');
        } catch (e) {
            log.error('get-app-catalog: ' + e.message);
            client.write(JSON.stringify({ type: 'get-app-catalog-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'service-control') {
        // systemctl actions on parental-control.service
        const allowed = ['start', 'stop', 'restart', 'enable', 'disable', 'status'];
        if (!allowed.includes(cmd.action)) {
            client.write(JSON.stringify({ type: 'service-control-result', ok: false, error: 'Invalid action' }) + '\n');
            return;
        }
        if (cmd.action === 'status') {
            execFile('systemctl', ['is-active', 'parental-control.service'], { timeout: 5000 }, (err, stdout) => {
                const status = String(stdout || (err && err.stdout) || '').trim() || (err ? 'inactive' : 'active');
                client.write(JSON.stringify({ type: 'service-control-result', ok: true, status }) + '\n');
            });
            return;
        }
        if (cmd.action === 'stop' || cmd.action === 'disable') {
            // Send reply before self-termination so client receives it
            client.write(JSON.stringify({ type: 'service-control-result', ok: true }) + '\n');
            setTimeout(() => execFile('systemctl', [cmd.action, 'parental-control.service'], { timeout: 10000 }, () => {}), 300);
            return;
        }
        execFile('systemctl', [cmd.action, 'parental-control.service'], { timeout: 10000 }, (err) => {
            if (err) client.write(JSON.stringify({ type: 'service-control-result', ok: false, error: err.message }) + '\n');
            else client.write(JSON.stringify({ type: 'service-control-result', ok: true }) + '\n');
        });
        return;
    }

    if (cmd.type === 'reset-today-usage') {
        // Delete today's usage file (screen time reset)
        try {
            const file = path.join(CONFIG_DIR, `usage-${localIsoDate()}.json`);
            try { fs.unlinkSync(file); } catch { /* already gone */ }
            log.info('reset-today-usage: ok');
            client.write(JSON.stringify({ type: 'reset-today-usage-result', ok: true }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'reset-today-usage-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'clear-today-overrides') {
        // Reset all temporary overrides and warning flags in today's usage file.
        // Called when the parent saves the schedule — any prior extensions are invalidated.
        try {
            const file = path.join(CONFIG_DIR, `usage-${localIsoDate()}.json`);
            let raw = {};
            try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* no file yet */ }
            raw.allowedHoursOverrideEnd = '';
            raw.allowedHoursExtraMinutes = 0;
            raw.extraAllowanceMinutes = 0;
            raw.warned10 = false;
            raw.warned5 = false;
            raw.warned2 = false;
            raw.warnedScreenTimeExhausted = false;
            raw.warnedAH10 = false;
            raw.warnedAH5 = false;
            raw.warnedAH2 = false;
            delete raw.warnSnapAHEnd;
            delete raw.warnSnapLimit;
            fs.writeFileSync(file, JSON.stringify(raw, null, 2), { encoding: 'utf8', mode: 0o644 });
            log.info('clear-today-overrides: ok');
            client.write(JSON.stringify({ type: 'clear-today-overrides-result', ok: true }) + '\n');
        } catch (e) {
            log.error('clear-today-overrides: ' + e.message);
            client.write(JSON.stringify({ type: 'clear-today-overrides-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'reset-today-quota-usage') {
        // Delete today's quota-usage file (app quota reset)
        try {
            const file = path.join(CONFIG_DIR, `quota-usage-${localIsoDate()}.json`);
            try { fs.unlinkSync(file); } catch { /* already gone */ }
            log.info('reset-today-quota-usage: ok');
            client.write(JSON.stringify({ type: 'reset-today-quota-usage-result', ok: true }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'reset-today-quota-usage-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'wipe-usage-history') {
        // Delete all usage/quota-usage/app-usage JSON files (full history wipe)
        const re = /^(usage|quota-usage|app-usage)-\d{4}-\d{2}-\d{2}\.json$/;
        let removed = 0;
        try {
            for (const name of fs.readdirSync(CONFIG_DIR)) {
                if (!re.test(name)) continue;
                try { fs.unlinkSync(path.join(CONFIG_DIR, name)); removed++; } catch { /* skip */ }
            }
            log.info(`wipe-usage-history: removed ${removed}`);
            client.write(JSON.stringify({ type: 'wipe-usage-history-result', ok: true, removed }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'wipe-usage-history-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'append-activity') {
        // Append a single entry to the activity ring-buffer log (max 400 entries)
        const LOG_FILE = ACTIVITY_LOG_FILE;
        const MAX_ENTRIES = 400;
        try {
            let list = [];
            try { const d = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); if (Array.isArray(d)) list = d; } catch { /* first write */ }
            list.push({ t: new Date().toISOString(), ...(cmd.entry || {}) });
            if (list.length > MAX_ENTRIES) list = list.slice(-MAX_ENTRIES);
            fs.writeFileSync(LOG_FILE, JSON.stringify(list), 'utf8');
            try { fs.chmodSync(LOG_FILE, 0o644); } catch { /* already set */ }
        } catch { /* best-effort */ }
        // Fire-and-forget: no result expected
        return;
    }

    if (cmd.type === 'write-hagezi-cache') {
        // Write downloaded hagezi feed files and meta to /etc/life-parental/blocklists/
        try {
            const dir = path.join(CONFIG_DIR, 'blocklists');
            fs.mkdirSync(dir, { recursive: true });
            for (const f of (cmd.files || [])) {
                if (typeof f.name !== 'string' || typeof f.content !== 'string') continue;
                const rel = path.normalize(f.name).replace(/^([/\\])+/, '');
                if (!rel || rel.startsWith('.')) continue;
                const outPath = path.resolve(dir, rel);
                if (!outPath.startsWith(dir + path.sep)) continue;
                fs.mkdirSync(path.dirname(outPath), { recursive: true });
                fs.writeFileSync(outPath, f.content, 'utf8');
                try { fs.chmodSync(outPath, 0o644); } catch { /* ignore */ }
            }
            if (cmd.meta && typeof cmd.meta === 'object') {
                fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(cmd.meta, null, 2), 'utf8');
                try { fs.chmodSync(path.join(dir, 'meta.json'), 0o644); } catch { /* ignore */ }
            }
            client.write(JSON.stringify({ type: 'write-hagezi-cache-result', ok: true }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'write-hagezi-cache-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'get-doh-iptables-status') {
        try {
            const st = dohIptablesStatus();
            client.write(JSON.stringify({ type: 'get-doh-iptables-status-result', ...st }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'get-doh-iptables-status-result', ok: false, error: e.message }) + '\n');
        }
        return;
    }

    if (cmd.type === 'prune-archives') {
        // Delete usage/quota/app-usage files older than 90 days
        try {
            const KEEP_DAYS = 90;
            const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000);
            const re = /^(usage|quota-usage|app-usage)-(\d{4}-\d{2}-\d{2})\.json$/;
            let removed = 0;
            for (const name of fs.readdirSync(CONFIG_DIR)) {
                const m = name.match(re);
                if (!m) continue;
                if (new Date(m[2]) < cutoff) {
                    try { fs.unlinkSync(path.join(CONFIG_DIR, name)); removed++; } catch { /* skip */ }
                }
            }
            log.info(`prune-archives: removed ${removed}`);
            client.write(JSON.stringify({ type: 'prune-archives-result', ok: true, removed }) + '\n');
        } catch (e) {
            client.write(JSON.stringify({ type: 'prune-archives-result', ok: false, error: e.message }) + '\n');
        }
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

fs.mkdirSync('/var/log/life-parental', { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true });
log.info(`starting PID=${process.pid} node=${process.version}`);

// Ensure default.json exists (644, no security section) and auth.json exists (600, password only).
try {
    const defaultJsonPath = path.join(CONFIG_DIR, 'default.json');
    const authJsonPath = path.join(CONFIG_DIR, AUTH_JSON_FILE);

    if (!fs.existsSync(defaultJsonPath)) {
        const empty = { label: 'Default', schedule: { enabled: false, dailyLimitEnabled: false, dailyLimitMinutes: 120, screenTimeLinuxUser: '', allowedHoursEnabled: false, allowedHoursStart: '07:00', allowedHoursEnd: '22:00', allowedDays: [1,2,3,4,5,6,7] }, webfilter: { enabled: false, feedState: {}, entries: [], listAllowlist: [] }, appControl: { enabled: false }, preferences: { lockIdleMinutes: null, quotaViewLinuxUser: '' }, blockedDesktopIds: [], quotaExemptions: { enabled: false, allowedIds: [] }, quota: [], requestDaemonWarningTest: false };
        fs.writeFileSync(defaultJsonPath, JSON.stringify(empty, null, 2), { encoding: 'utf8', mode: 0o644 });
    } else {
        // Migrate: if default.json has a security section, move it to auth.json then strip it
        try {
            const existing = JSON.parse(fs.readFileSync(defaultJsonPath, 'utf8'));
            if (existing && existing.security && existing.security.passwordHash && !fs.existsSync(authJsonPath)) {
                writeAuthFile(existing.security.passwordHash, existing.security.salt || '');
                log.info('migrated password hash from default.json to auth.json');
            }
            if (existing && existing.security) {
                delete existing.security;
                fs.writeFileSync(defaultJsonPath, JSON.stringify(existing, null, 2), { encoding: 'utf8', mode: 0o644 });
            } else {
                fs.chmodSync(defaultJsonPath, 0o644);
            }
        } catch { fs.chmodSync(defaultJsonPath, 0o644); }
    }

    // Ensure auth.json exists (empty = no password set) and is root-only
    if (!fs.existsSync(authJsonPath)) {
        fs.writeFileSync(authJsonPath, JSON.stringify({ passwordHash: '', salt: '' }, null, 2), { encoding: 'utf8', mode: 0o600 });
    } else {
        fs.chmodSync(authJsonPath, 0o600);
    }
} catch { /* best-effort */ }

const defaultSync = createDefaultSync({ configDir: CONFIG_DIR, log });
defaultSync.maybeSync().catch(e => log.warn(`defaultSync initial: ${e && e.message ? e.message : String(e)}`));

startSocketServer();
buildAndWriteAppCatalog();

// Wall clock: advance minute counter every TICK_MS; run heavy tick work strictly one at a time (no overlap during exhausted wait).
tickWorkChain = tickWorkChain.then(() => tickWork(atLoggedMinuteBoundary())).catch((e) => log.error(`initial tick: ${e && e.message ? e.message : String(e)}`));
setInterval(() => {
    const logMinute = atLoggedMinuteBoundary();
    tickWorkChain = tickWorkChain.then(() => tickWork(logMinute)).catch((e) => log.error(`tick: ${e && e.message ? e.message : String(e)}`));
}, TICK_MS);

process.on('SIGTERM', () => {
    log.info('shutting down (SIGTERM)');
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    process.exit(0);
});

process.on('SIGINT', () => {
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    process.exit(0);
});
