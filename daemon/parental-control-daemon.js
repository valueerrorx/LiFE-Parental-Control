#!/usr/bin/env node
'use strict';
// LiFE Parental Control root daemon — single source of truth for all timekeeping and enforcement

const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFile, spawn, spawnSync } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

const SOCKET_PATH = '/run/parental-control.sock';
const CONFIG_DIR = '/etc/life-parental';
const LOG_FILE = '/etc/life-parental/daemon.log';
const LOG_MAX_BYTES = 2 * 1024 * 1024; // rotate at 2 MB
const TICK_MS = 10_000;
const TICKS_PER_LOGGED_MINUTE = 60_000 / TICK_MS; // 6 ticks = 1 minute
const ALLOWED_HOURS_WARN_INTERVAL_MS = 5 * 60 * 1000;

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
let lastAllowedHoursWarnAt = 0;

// Exempt-app watchdog state
let lastInputTimestamp = 0;   // last hardware input event seen by the input monitor
let inputMonitorStarted = false;
const exemptAppJiffies = {};  // processName → last CPU jiffies total
let wdWarnCount = 0;          // warnings sent in current grace-period cycle
let wdFirstWarnAt = 0;        // timestamp when the warning cycle started (0 = not started)
let wdLastWarnAt  = 0;        // timestamp of the most recent warning notification
let wdExemptActiveTicks = 0;  // consecutive ticks where exempt app was actively used

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

function readSchedule() {
    try { return { ...DEFAULT_SCHEDULE, ...JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'schedules.json'), 'utf8')) }; }
    catch { return { ...DEFAULT_SCHEDULE }; }
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
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'quota.json'), 'utf8'));
        if (!Array.isArray(raw)) return [];
        return raw.filter(e => e && typeof e.appId === 'string' && e.appId.endsWith('.desktop')
            && typeof e.processName === 'string' && e.processName.trim()
            && Number.isFinite(Number(e.minutesPerDay)));
    } catch { return []; }
}

function loadQuotaExemptAppIds() {
    try {
        const wl = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'process-whitelist.json'), 'utf8'));
        if (!wl?.enabled) return new Set();
        return Array.isArray(wl.allowedIds) ? new Set(wl.allowedIds) : new Set();
    } catch { return new Set(); }
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

function readConfig() {
    try { return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'config.json'), 'utf8')); }
    catch { return {}; }
}

function checkParentPassword(plain) {
    const cfg = readConfig();
    if (!cfg.passwordHash) return { ok: false, reason: 'no_password' };
    if (typeof plain !== 'string' || plain.length === 0) return { ok: false, reason: 'invalid' };
    if (hashPassword(plain, cfg.salt) !== cfg.passwordHash) return { ok: false, reason: 'invalid' };
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
                if (p.State !== 'active' && p.State !== 'online') continue;
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
        const wl = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'process-whitelist.json'), 'utf8'));
        if (!wl?.enabled || !Array.isArray(wl.allowedIds) || wl.allowedIds.length === 0) return [];
        const ids = new Set(wl.allowedIds);
        const names = new Map(); // appId → processName (first match wins)
        try {
            const quotas = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'quota.json'), 'utf8'));
            if (Array.isArray(quotas)) {
                for (const q of quotas) {
                    if (q.appId && ids.has(q.appId) && q.processName) names.set(q.appId, q.processName.trim());
                }
            }
        } catch { /* quota.json optional */ }
        try {
            const cat = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'app-monitor-catalog.json'), 'utf8'));
            if (Array.isArray(cat.apps)) {
                for (const a of cat.apps) {
                    const id = a.appId || a.id;
                    if (id && ids.has(id) && a.processName && !names.has(id)) names.set(id, a.processName.trim());
                }
            }
        } catch { /* catalog optional */ }
        return [...names.values()].filter(Boolean);
    } catch { return []; }
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

// Send a desktop notification to the active user via runuser+notify-send
function sendExemptWatchdogNotification(message, user, uid) {
    try {
        const dbusAddr = `unix:path=/run/user/${uid}/bus`;
        spawnSync('runuser', ['-u', user, '--',
            'env', `DBUS_SESSION_BUS_ADDRESS=${dbusAddr}`,
            'notify-send', '-u', 'critical', '-t', '8000',
            'LiFE Parental Control', message
        ], { timeout: 3000 });
    } catch { /* notification is best-effort */ }
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
        const remainingSec = Math.ceil((WD_GRACE_MS - elapsed) / 1000);
        const msg = `Warnung ${wdWarnCount}/${WD_WARN_MAX}: Kehre zur erlaubten App zurück! Logout in ~${remainingSec}s.`;
        log.warn(`exempt watchdog: warning ${wdWarnCount}/${WD_WARN_MAX} sent`);
        const info = getFirstActiveUserInfo();
        if (info) sendExemptWatchdogNotification(msg, info.user, info.uid);
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
        '/opt/LiFE Parental Control/life-parental-control',
        '/opt/life-parental-control/life-parental-control',
        '/usr/bin/life-parental-control',
        '/usr/local/bin/life-parental-control',
    ];
    for (const c of candidates) { if (fs.existsSync(c)) return c; }
    return null;
}

// Get info about the first active graphical desktop session
function getFirstActiveUserInfo() {
    try {
        const { stdout } = spawnSync('loginctl', ['list-sessions', '--no-legend'], { encoding: 'utf8', timeout: 3000 });
        for (const line of (stdout || '').trim().split('\n').filter(Boolean)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;
            const user = parts[2];
            if (!user || user === 'root') continue;
            const uid = spawnSync('id', ['-u', user], { encoding: 'utf8' }).stdout.trim();
            if (!uid || uid === '0') continue;
            // Detect Wayland socket in user's runtime dir
            let waylandDisplay = 'wayland-0';
            try {
                const files = fs.readdirSync(`/run/user/${uid}`);
                const wl = files.find(f => /^wayland-\d+$/.test(f));
                if (wl) waylandDisplay = wl;
            } catch { /* ignore */ }
            return { user, uid, waylandDisplay };
        }
    } catch { /* ignore */ }
    return null;
}

// PID of currently running warning window (spawned by daemon)
let warningWindowPid = null;

// Spawn the Electron app as the desktop user in --warning-mode for interactive time extension
function spawnWarningWindow(payload) {
    log.info(`spawnWarningWindow called type=${payload.type || '?'} clients=${clients.size}`);

    // De-duplicate: do not spawn if a window is already open
    if (warningWindowPid != null) {
        try {
            process.kill(warningWindowPid, 0);
            log.info(`spawnWarningWindow skipped — existing window PID=${warningWindowPid} still running`);
            return;
        } catch { warningWindowPid = null; }
    }

    const execPath = findElectronExecPath();
    if (!execPath) {
        log.error('spawnWarningWindow FAILED: Electron executable not found (checked /etc/life-parental/.electron-exec and fallback paths)');
        return;
    }
    log.info(`spawnWarningWindow execPath=${execPath}`);

    const info = getFirstActiveUserInfo();
    if (!info) {
        log.error('spawnWarningWindow FAILED: no active graphical session found via loginctl');
        return;
    }

    const { user, uid, waylandDisplay } = info;
    log.info(`spawnWarningWindow session user=${user} uid=${uid} WAYLAND_DISPLAY=${waylandDisplay}`);

    const payloadArg = `--warning-mode=${JSON.stringify(payload)}`;
    const isAppImage = execPath.toLowerCase().endsWith('.appimage');

    const envPairs = [
        `WAYLAND_DISPLAY=${waylandDisplay}`,
        `XDG_RUNTIME_DIR=/run/user/${uid}`,
        `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`,
        `HOME=/home/${user}`,
        `USER=${user}`,
        `LOGNAME=${user}`,
        'DISPLAY=',
        'XDG_SESSION_TYPE=wayland',
        ...(isAppImage ? ['APPIMAGELAUNCHER_DISABLE=1'] : [])
    ];
    const appArgs = [
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
    if (!skipWindow) spawnWarningWindow(payload); // spawn user-context window (skipped for post-kill events)
    // notify-send as additional fallback so the user sees something even if Electron fails
    try {
        const info = getFirstActiveUserInfo();
        if (!info) return;
        const { user, uid } = info;
        const dbusAddr = `unix:path=/run/user/${uid}/bus`;
        spawnSync('runuser', ['-u', user, '--',
            'env', `DBUS_SESSION_BUS_ADDRESS=${dbusAddr}`,
            'notify-send', '-u', urgency, 'LiFE Parental Control', `${notifySummary}\n${notifyBody}`
        ], { timeout: 3000 });
    } catch { /* notify-send optional */ }
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
    }
}

async function tickAppQuotas(logMinute) {
    resetAppQuotaWarnIfNewDay();
    const quotas = readQuotaEntries();
    const exempt = loadQuotaExemptAppIds();
    const sessions = await getActiveGraphicalSessions();
    const activeUsers = uniqueUsers(sessions);
    if (activeUsers.length === 0) return;

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
                    notifyOrSpawn(warnPayload, `${name}: Zeit aufgebraucht`, `Tageslimit von ${limit} Min. erreicht.`, 'critical', true);
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

async function tick() {
    const logMinute = atLoggedMinuteBoundary();
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
