import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { localIsoDate } from './localCalendarDay.js'

const CONFIG_FILE = 'schedules.json'
const CRON_MARKER = '# LiFE Parental Control'
const CHECK_SCRIPT = '/usr/local/bin/life-parental-check'
const CRON_FILE = '/etc/cron.d/life-parental'

export const DEFAULT_SCHEDULE = {
    enabled: false,
    dailyLimitEnabled: false,
    dailyLimitMinutes: 120,
    allowedHoursEnabled: false,
    allowedHoursStart: '07:00',
    allowedHoursEnd: '22:00',
    allowedDays: [1, 2, 3, 4, 5, 6, 7]  // 1=Mon, 7=Sun
}

function readSchedule(configDir) {
    try { return { ...DEFAULT_SCHEDULE, ...JSON.parse(fs.readFileSync(path.join(configDir, CONFIG_FILE), 'utf8')) } } catch { return { ...DEFAULT_SCHEDULE } }
}

function readUsage(configDir) {
    const today = localIsoDate()
    const file = path.join(configDir, `usage-${today}.json`)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        return data.date === today ? data : { date: today, minutes: 0 }
    } catch {
        return { date: today, minutes: 0 }
    }
}

function readUsageHistory(configDir, maxDays) {
    const re = /^usage-(\d{4}-\d{2}-\d{2})\.json$/
    const entries = []
    for (const name of fs.readdirSync(configDir)) {
        const m = name.match(re)
        if (!m) continue
        const dateStr = m[1]
        try {
            const data = JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'))
            const minutes = data.date === dateStr ? (data.minutes ?? 0) : 0
            entries.push({ date: dateStr, minutes })
        } catch {
            entries.push({ date: dateStr, minutes: 0 })
        }
    }
    entries.sort((a, b) => b.date.localeCompare(a.date))
    return entries.slice(0, maxDays)
}

function installCheckScript(configDir) {
    // Python script deployed to /usr/local/bin — runs every minute via cron as root
    const script = `#!/usr/bin/env python3
# LiFE Parental Control - screen time enforcement
import json, datetime, subprocess, sys, os, pwd

SCHED_FILE = "${configDir}/schedules.json"
USAGE_DIR  = "${configDir}"

try:
    with open(SCHED_FILE) as f:
        s = json.load(f)
except Exception:
    sys.exit(0)

if not s.get('enabled'):
    sys.exit(0)

now     = datetime.datetime.now()
today   = now.strftime('%Y-%m-%d')
weekday = now.isoweekday()  # 1=Mon, 7=Sun

def get_active_graphical_sessions():
    """Return list of (session_id, username) for active X11/Wayland sessions."""
    sessions = []
    try:
        r = subprocess.run(
            ['loginctl', 'list-sessions', '--no-legend'],
            capture_output=True, text=True, timeout=5, check=False
        )
        for line in r.stdout.strip().splitlines():
            parts = line.split()
            if len(parts) < 3:
                continue
            sid, user = parts[0], parts[2]
            try:
                t  = subprocess.run(['loginctl', 'show-session', sid, '-p', 'Type',  '--value'], capture_output=True, text=True, timeout=3, check=False).stdout.strip()
                st = subprocess.run(['loginctl', 'show-session', sid, '-p', 'State', '--value'], capture_output=True, text=True, timeout=3, check=False).stdout.strip()
                if t in ('x11', 'wayland') and st == 'active':
                    sessions.append((sid, user))
            except Exception:
                pass
    except Exception:
        pass
    return sessions

def notify_user(user, message):
    # Use the user's systemd D-Bus socket at /run/user/<uid>/bus
    try:
        uid = pwd.getpwnam(user).pw_uid
        env = {**os.environ, 'DBUS_SESSION_BUS_ADDRESS': f'unix:path=/run/user/{uid}/bus'}
        subprocess.run(
            ['notify-send', '-u', 'critical', 'LiFE Parental Control', message],
            env=env, timeout=3, check=False
        )
    except Exception:
        pass

def lock_and_notify(message):
    subprocess.run(['loginctl', 'lock-sessions'], check=False, timeout=5)
    for _, user in get_active_graphical_sessions():
        notify_user(user, message)

active_sessions = get_active_graphical_sessions()

# --- Allowed hours check (supports window across midnight when start > end, e.g. 22:00-07:00) ---
if s.get('allowedHoursEnabled') and weekday in s.get('allowedDays', []):
    sh, sm = map(int, s['allowedHoursStart'].split(':'))
    eh, em = map(int, s['allowedHoursEnd'].split(':'))
    start  = datetime.time(sh, sm)
    end_t  = datetime.time(eh, em)
    now_t = now.time()
    if start <= end_t:
        allowed_now = start <= now_t <= end_t
    else:
        allowed_now = now_t >= start or now_t <= end_t
    if not allowed_now:
        lock_and_notify('Computer use is not allowed at this time.')
        sys.exit(0)

# --- Daily limit tracking & enforcement ---
if s.get('dailyLimitEnabled'):
    usage_file = os.path.join(USAGE_DIR, 'usage-' + today + '.json')
    try:
        with open(usage_file) as f:
            usage = json.load(f)
        if usage.get('date') != today:
            usage = {'date': today, 'minutes': 0}
    except Exception:
        usage = {'date': today, 'minutes': 0}

    # Increment counter only when an active graphical session exists
    if active_sessions:
        usage['minutes'] = usage.get('minutes', 0) + 1
        with open(usage_file, 'w') as f:
            json.dump(usage, f)

    limit = s.get('dailyLimitMinutes', 120)
    used  = usage.get('minutes', 0)
    remaining = limit - used
    if remaining <= 0:
        lock_and_notify(f'Daily screen time limit of {limit} minutes reached.')
    elif remaining == 5 and active_sessions:
        # 5-minute warning — only notify, do not lock yet
        for _, user in get_active_graphical_sessions():
            notify_user(user, f'Screen time: 5 minutes remaining today.')
`
    fs.writeFileSync(CHECK_SCRIPT, script, { mode: 0o755 })
}

function updateCron(schedule, configDir) {
    if (!schedule.enabled) {
        if (fs.existsSync(CRON_FILE)) fs.unlinkSync(CRON_FILE)
        if (fs.existsSync(CHECK_SCRIPT)) fs.unlinkSync(CHECK_SCRIPT)
        return
    }
    installCheckScript(configDir)
    const content = `${CRON_MARKER}\n* * * * * root ${CHECK_SCRIPT}\n`
    fs.writeFileSync(CRON_FILE, content, 'utf8')
    execFile('systemctl', ['reload', 'cron'],  { timeout: 3000 }, () => {})
    execFile('systemctl', ['reload', 'crond'], { timeout: 3000 }, () => {})
}

export function redeployScheduleCron(configDir) {
    updateCron(readSchedule(configDir), configDir)
    try {
        pruneUsageArchives(configDir)
    } catch {
        // best-effort cleanup
    }
}

export function persistSchedule(configDir, schedule) {
    fs.writeFileSync(path.join(configDir, CONFIG_FILE), JSON.stringify(schedule, null, 2), 'utf8')
    updateCron(schedule, configDir)
    try {
        pruneUsageArchives(configDir)
    } catch {
        // best-effort cleanup
    }
}

export function registerSchedulesIpc(ipcMain, configDir) {
    ipcMain.handle('schedules:get', () => readSchedule(configDir))

    ipcMain.handle('schedules:getUsage', () => readUsage(configDir))

    ipcMain.handle('schedules:getUsageHistory', (_, rawMax) => {
        try {
            const maxDays = Math.min(90, Math.max(1, Number(rawMax) || 14))
            return { days: readUsageHistory(configDir, maxDays) }
        } catch (e) {
            return { days: [], error: e.message }
        }
    })

    ipcMain.handle('schedules:save', (_, schedule) => {
        try {
            persistSchedule(configDir, schedule)
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('schedules:redeploy', () => {
        try {
            redeployScheduleCron(configDir)
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })
}
