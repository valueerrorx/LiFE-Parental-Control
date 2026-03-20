import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { localIsoDate } from './localCalendarDay.js'
import { appendActivity } from './activityLog.js'
import { assertParentalCronInstallDirs } from './cronInstallPaths.js'

const QUOTA_FILE = 'quota.json'
const QUOTA_SCRIPT = '/usr/local/bin/life-parental-quota'
const QUOTA_CRON = '/etc/cron.d/life-parental-quota'
const CRON_MARKER = '# LiFE Parental Control Quota'

function readQuotas(configDir) {
    try { return JSON.parse(fs.readFileSync(path.join(configDir, QUOTA_FILE), 'utf8')) } catch { return [] }
}

function saveQuotas(configDir, quotas) {
    fs.writeFileSync(path.join(configDir, QUOTA_FILE), JSON.stringify(quotas, null, 2), 'utf8')
}

function readUsage(configDir) {
    const today = localIsoDate()
    const file = path.join(configDir, `quota-usage-${today}.json`)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        return data.date === today ? (data.usage ?? {}) : {}
    } catch { return {} }
}

export function readAppMonitorUsage(configDir) {
    const today = localIsoDate()
    const file = path.join(configDir, `app-usage-${today}.json`)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        return data.date === today ? (data.usage ?? {}) : {}
    } catch { return {} }
}

function catalogHasMonitorableApps(configDir) {
    try {
        const c = JSON.parse(fs.readFileSync(path.join(configDir, 'app-monitor-catalog.json'), 'utf8'))
        const apps = c.apps
        if (!Array.isArray(apps)) return false
        return apps.some(a => a && String(a.processName || '').trim() && String(a.appId || '').length > 0)
    } catch {
        return false
    }
}

function monitorLabelsFromCatalog(configDir) {
    try {
        const c = JSON.parse(fs.readFileSync(path.join(configDir, 'app-monitor-catalog.json'), 'utf8'))
        const apps = Array.isArray(c.apps) ? c.apps : []
        const names = {}
        for (const a of apps) {
            const id = a?.appId
            if (!id) continue
            names[id] = typeof a.appName === 'string' && a.appName.length ? a.appName : (a.processName || id)
        }
        return names
    } catch {
        return {}
    }
}

function deployScript(configDir, quotas) {
    const quotaList = Array.isArray(quotas) ? quotas : []
    if (quotaList.length === 0 && !catalogHasMonitorableApps(configDir)) {
        if (fs.existsSync(QUOTA_CRON)) fs.unlinkSync(QUOTA_CRON)
        if (fs.existsSync(QUOTA_SCRIPT)) fs.unlinkSync(QUOTA_SCRIPT)
        return
    }

    assertParentalCronInstallDirs()

    const script = `#!/usr/bin/env python3
# LiFE Parental Control - app quota enforcement + per-app usage (runs every minute via cron)
import json, datetime, subprocess, os, pwd, shutil

QUOTA_FILE = "${configDir}/quota.json"
USAGE_DIR  = "${configDir}"
today      = datetime.date.today().isoformat()
WHITELIST_FILE = os.path.join(USAGE_DIR, 'process-whitelist.json')
CATALOG_FILE = os.path.join(USAGE_DIR, 'app-monitor-catalog.json')

try:
    with open(QUOTA_FILE) as f:
        quotas = json.load(f)
except Exception:
    quotas = []
if not isinstance(quotas, list):
    quotas = []

monitor_apps = []
try:
    with open(CATALOG_FILE) as f:
        _cat = json.load(f)
    monitor_apps = _cat.get('apps', [])
except Exception:
    monitor_apps = []
if not isinstance(monitor_apps, list):
    monitor_apps = []

if not quotas and not monitor_apps:
    exit(0)

def load_quota_exempt_app_ids():
    # AppIds exempt when daily quota is exhausted (Quota exemptions page / process-whitelist.json).
    try:
        with open(WHITELIST_FILE) as f:
            wl = json.load(f)
        if not wl.get('enabled', False):
            return set()
        ids = wl.get('allowedIds', [])
        return set(ids) if isinstance(ids, list) else set()
    except Exception:
        return set()

app_usage = {}
quota_exempt_app_ids = set()
usage_file = os.path.join(USAGE_DIR, 'quota-usage-' + today + '.json')
if quotas:
    quota_exempt_app_ids = load_quota_exempt_app_ids()
    try:
        with open(usage_file) as f:
            data = json.load(f)
        app_usage = data.get('usage', {}) if data.get('date') == today else {}
    except Exception:
        app_usage = {}

def _loginctl_session_props(sid):
    r = subprocess.run(
        ['loginctl', 'show-session', sid, '-p', 'Type', '-p', 'State', '-p', 'Class', '-p', 'Display'],
        capture_output=True, text=True, timeout=3, check=False
    )
    props = {}
    for line in r.stdout.strip().splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            props[k.strip()] = v.strip()
    return props

def get_active_sessions():
    sessions = []
    try:
        r = subprocess.run(['loginctl', 'list-sessions', '--no-legend'],
                           capture_output=True, text=True, timeout=5, check=False)
        for line in r.stdout.strip().splitlines():
            parts = line.split()
            if len(parts) < 3:
                continue
            sid, user = parts[0], parts[2]
            p = _loginctl_session_props(sid)
            cls = p.get('Class', '')
            if cls in ('greeter', 'background'):
                continue
            t = p.get('Type', '')
            st = p.get('State', '')
            if t in ('x11', 'wayland') and st in ('active', 'online'):
                sessions.append((user, sid))
    except Exception:
        pass
    return sessions

def unique_users_from_sessions(sessions):
    users = []
    seen = set()
    for user, _ in sessions:
        if user not in seen:
            users.append(user)
            seen.add(user)
    return users

def first_graphical_session_per_user(sessions):
    pairs = []
    seen = set()
    for user, sid in sessions:
        if user not in seen:
            pairs.append((user, sid))
            seen.add(user)
    return pairs

def _parse_proc_environ(pid):
    try:
        with open(os.path.join('/proc', pid, 'environ'), 'rb') as f:
            raw = f.read()
    except (FileNotFoundError, PermissionError, TypeError):
        return None
    env = {}
    for entry in raw.split(b'\\x00'):
        if not entry or b'=' not in entry:
            continue
        k, v = entry.split(b'=', 1)
        try:
            env[k.decode('utf-8', errors='replace')] = v.decode('utf-8', errors='replace')
        except Exception:
            pass
    return env or None

def _proc_uid_comm(pid):
    try:
        uid = None
        with open(os.path.join('/proc', pid, 'status'), encoding='utf-8', errors='replace') as f:
            for line in f:
                if line.startswith('Uid:'):
                    uid = int(line.split()[1])
                    break
        with open(os.path.join('/proc', pid, 'comm'), encoding='utf-8', errors='replace') as f:
            comm = f.read().strip()
        return uid, comm
    except Exception:
        return None, None

_SESSION_COMM_PRIORITY = ('plasmashell', 'kwin_wayland', 'kwin_x11', 'ksmserver', 'Xorg')

def _session_comm_rank(comm):
    try:
        return _SESSION_COMM_PRIORITY.index(comm)
    except ValueError:
        return 99

def desktop_session_env_for_uid(target_uid):
    target_uid = int(target_uid)
    hits = []
    for pid in os.listdir('/proc'):
        if not str(pid).isdigit():
            continue
        uid, comm = _proc_uid_comm(pid)
        if uid != target_uid or not comm:
            continue
        if comm not in _SESSION_COMM_PRIORITY and comm not in ('gnome-shell',):
            continue
        hits.append((pid, comm))
    hits.sort(key=lambda t: _session_comm_rank(t[1]))
    for pid, _ in hits:
        env = _parse_proc_environ(str(pid))
        if not env:
            continue
        if env.get('WAYLAND_DISPLAY') or (env.get('DISPLAY') and env.get('DISPLAY') not in ('', '-')):
            return env
    for pid, _ in hits:
        env = _parse_proc_environ(str(pid))
        if env:
            return env
    return None

def _notify_env_for_user(user):
    uid = pwd.getpwnam(user).pw_uid
    uid_s = str(uid)
    desk = desktop_session_env_for_uid(uid)
    env = {**desk} if desk else {**os.environ}
    env['XDG_RUNTIME_DIR'] = env.get('XDG_RUNTIME_DIR') or f'/run/user/{uid_s}'
    env['DBUS_SESSION_BUS_ADDRESS'] = f'unix:path=/run/user/{uid_s}/bus'
    if 'PATH' not in env or not env['PATH']:
        env['PATH'] = '/usr/local/bin:/usr/bin:/bin'
    return env

def notify_user(user, message):
    try:
        env = _notify_env_for_user(user)
        ns = shutil.which('notify-send') or '/usr/bin/notify-send'
        subprocess.run(
            [ns, '-u', 'critical', '-t', '60000', 'LiFE Parental Control', message],
            env=env, timeout=15, check=False
        )
    except Exception:
        pass

def _kdialog_popup(user, kdialog, urgency_flag, msg):
    try:
        env = _notify_env_for_user(user)
        subprocess.Popen(
            ['/usr/bin/runuser', '-u', user, '--', kdialog, '--title', 'LiFE Parental Control',
             urgency_flag, msg],
            env=env, start_new_session=True, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    except Exception:
        pass

def foreground_warn_quota_two_minutes(user, sid, name):
    msg = (
        f'{name}: About two minutes of allowed screen time left for today. '
        f'You will get a stronger warning in the last minute; then the app will close.'
    )
    notify_user(user, msg)
    kdialog = shutil.which('kdialog') or '/usr/bin/kdialog'
    if os.path.isfile(kdialog):
        _kdialog_popup(user, kdialog, '--sorry', msg)

def foreground_warn_quota_final_minute(user, sid, name):
    msg = (
        f'{name}: Final minute before this app is closed for today. Save your work now; '
        f'it will be stopped on the next check (about one minute).'
    )
    notify_user(user, msg)
    kdialog = shutil.which('kdialog') or '/usr/bin/kdialog'
    if os.path.isfile(kdialog):
        _kdialog_popup(user, kdialog, '--error', msg)

active_sessions  = get_active_sessions()
active_users     = unique_users_from_sessions(active_sessions)
notify_sid_pairs = first_graphical_session_per_user(active_sessions)

for q in quotas:
    app_id = q.get('appId', '')
    proc   = q.get('processName', '')
    limit  = max(1, int(q.get('minutesPerDay', 60)))
    name   = q.get('appName', proc)
    if not proc:
        continue

    is_running = False
    for user in active_users:
        r = subprocess.run(['pgrep', '-u', user, '-x', '-i', proc],
                           capture_output=True, text=True, timeout=3, check=False)
        if r.stdout.strip():
            is_running = True
            break

    used_before = app_usage.get(app_id, 0)

    if is_running:
        if app_id not in quota_exempt_app_ids and used_before >= limit:
            for user in active_users:
                subprocess.run(['pkill', '-u', user, '-x', '-i', proc], capture_output=True, check=False)
                notify_user(user, f'Daily time limit for {name} reached ({limit} minutes).')
        elif app_id not in quota_exempt_app_ids and used_before == limit - 1:
            for user, sid in notify_sid_pairs:
                foreground_warn_quota_final_minute(user, sid, name)
            app_usage[app_id] = limit
        else:
            app_usage[app_id] = used_before + 1

    used      = app_usage.get(app_id, 0)
    remaining = limit - used
    if (
        remaining == 2
        and is_running
        and app_id not in quota_exempt_app_ids
        and limit >= 3
    ):
        for user, sid in notify_sid_pairs:
            foreground_warn_quota_two_minutes(user, sid, name)
    elif remaining == 5 and is_running:
        for user in active_users:
            notify_user(user, f'{name}: 5 minutes of daily screen time remaining.')

if quotas:
    with open(usage_file, 'w') as f:
        json.dump({'date': today, 'usage': app_usage}, f)

if monitor_apps:
    app_track_file = os.path.join(USAGE_DIR, 'app-usage-' + today + '.json')
    try:
        with open(app_track_file) as f:
            td = json.load(f)
        app_track = td.get('usage', {}) if td.get('date') == today else {}
    except Exception:
        app_track = {}
    for entry in monitor_apps:
        if not isinstance(entry, dict):
            continue
        app_id = entry.get('appId') or entry.get('id') or ''
        proc = (entry.get('processName') or '').strip()
        if not app_id or not proc:
            continue
        is_running = False
        for user in active_users:
            r = subprocess.run(['pgrep', '-u', user, '-x', '-i', proc],
                               capture_output=True, text=True, timeout=3, check=False)
            if r.stdout.strip():
                is_running = True
                break
        if is_running:
            app_track[app_id] = app_track.get(app_id, 0) + 1
    with open(app_track_file, 'w') as f:
        json.dump({'date': today, 'usage': app_track}, f)
`
    fs.writeFileSync(QUOTA_SCRIPT, script, { mode: 0o755 })
    const content = `${CRON_MARKER}\n* * * * * root ${QUOTA_SCRIPT}\n`
    fs.writeFileSync(QUOTA_CRON, content, 'utf8')
    execFile('systemctl', ['reload', 'cron'],  { timeout: 3000 }, () => {})
    execFile('systemctl', ['reload', 'crond'], { timeout: 3000 }, () => {})
    try {
        pruneUsageArchives(configDir)
    } catch {
        // best-effort cleanup
    }
}

export function readQuotaEntries(configDir) {
    const raw = readQuotas(configDir)
    return Array.isArray(raw) ? raw : []
}

export function redeployQuotaFromDisk(configDir) {
    deployScript(configDir, readQuotaEntries(configDir))
}

export function replaceQuotaEntries(configDir, entries) {
    const list = Array.isArray(entries)
        ? entries.filter(e =>
            e && typeof e.appId === 'string' && e.appId.endsWith('.desktop')
                && typeof e.processName === 'string' && e.processName.length > 0
                && Number.isFinite(Number(e.minutesPerDay)))
        : []
    const normalized = list.map(e => ({
        appId: e.appId,
        appName: typeof e.appName === 'string' && e.appName.length ? e.appName : e.processName,
        processName: e.processName,
        minutesPerDay: Math.max(1, Math.min(24 * 60, Math.floor(Number(e.minutesPerDay))))
    }))
    saveQuotas(configDir, normalized)
    deployScript(configDir, normalized)
}

export function registerQuotaIpc(ipcMain, configDir) {
    ipcMain.handle('quota:getList', () => readQuotaEntries(configDir))

    ipcMain.handle('quota:getUsage', () => readUsage(configDir))

    ipcMain.handle('quota:getAppMonitorUsage', () => ({
        usage: readAppMonitorUsage(configDir),
        labels: monitorLabelsFromCatalog(configDir)
    }))

    ipcMain.handle('quota:resetTodayUsage', () => {
        try {
            const file = path.join(configDir, `quota-usage-${localIsoDate()}.json`)
            if (fs.existsSync(file)) fs.unlinkSync(file)
            appendActivity(configDir, { action: 'quota_reset_today' })
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('quota:redeploy', () => {
        try {
            redeployQuotaFromDisk(configDir)
            appendActivity(configDir, { action: 'quota_cron_redeploy' })
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('quota:setEntry', (_, { appId, appName, processName, minutesPerDay }) => {
        try {
            const quotas = readQuotaEntries(configDir)
            const idx = quotas.findIndex(q => q.appId === appId)
            const entry = { appId, appName, processName, minutesPerDay }
            if (idx >= 0) quotas[idx] = entry
            else quotas.push(entry)
            saveQuotas(configDir, quotas)
            deployScript(configDir, quotas)
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('quota:removeEntry', (_, appId) => {
        try {
            const quotas = readQuotaEntries(configDir).filter(q => q.appId !== appId)
            saveQuotas(configDir, quotas)
            deployScript(configDir, quotas)
            return { ok: true }
        } catch (e) { return { error: e.message } }
    })
}
