import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { pruneUsageArchives } from './usageArchivePrune.js'
import { localIsoDate } from './localCalendarDay.js'

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

function deployScript(configDir, quotas) {
    if (!quotas.length) {
        if (fs.existsSync(QUOTA_CRON)) fs.unlinkSync(QUOTA_CRON)
        if (fs.existsSync(QUOTA_SCRIPT)) fs.unlinkSync(QUOTA_SCRIPT)
        return
    }

    const script = `#!/usr/bin/env python3
# LiFE Parental Control - app quota enforcement (runs every minute via cron)
import json, datetime, subprocess, os, pwd

QUOTA_FILE = "${configDir}/quota.json"
USAGE_DIR  = "${configDir}"
today      = datetime.date.today().isoformat()

try:
    with open(QUOTA_FILE) as f:
        quotas = json.load(f)
except Exception:
    exit(0)

if not quotas:
    exit(0)

usage_file = os.path.join(USAGE_DIR, 'quota-usage-' + today + '.json')
try:
    with open(usage_file) as f:
        data = json.load(f)
    app_usage = data.get('usage', {}) if data.get('date') == today else {}
except Exception:
    app_usage = {}

def get_active_users():
    users = []
    try:
        r = subprocess.run(['loginctl', 'list-sessions', '--no-legend'],
                           capture_output=True, text=True, timeout=5, check=False)
        for line in r.stdout.strip().splitlines():
            parts = line.split()
            if len(parts) < 3:
                continue
            sid, user = parts[0], parts[2]
            t  = subprocess.run(['loginctl', 'show-session', sid, '-p', 'Type',  '--value'], capture_output=True, text=True, timeout=3, check=False).stdout.strip()
            st = subprocess.run(['loginctl', 'show-session', sid, '-p', 'State', '--value'], capture_output=True, text=True, timeout=3, check=False).stdout.strip()
            if t in ('x11', 'wayland') and st in ('active', 'online'):
                users.append(user)
    except Exception:
        pass
    return users

def notify_user(user, message):
    try:
        uid = pwd.getpwnam(user).pw_uid
        env = {**os.environ, 'DBUS_SESSION_BUS_ADDRESS': f'unix:path=/run/user/{uid}/bus'}
        subprocess.run(['notify-send', '-u', 'critical', 'LiFE Parental Control', message],
                      env=env, timeout=3, check=False)
    except Exception:
        pass

active_users = get_active_users()
changed = False

for q in quotas:
    app_id = q.get('appId', '')
    proc   = q.get('processName', '')
    limit  = int(q.get('minutesPerDay', 60))
    name   = q.get('appName', proc)
    if not proc:
        continue

    # Check if process is running for any active user
    is_running = False
    for user in active_users:
        r = subprocess.run(['pgrep', '-u', user, '-x', '-i', proc],
                           capture_output=True, text=True, timeout=3, check=False)
        if r.stdout.strip():
            is_running = True
            break

    if is_running:
        app_usage[app_id] = app_usage.get(app_id, 0) + 1
        changed = True

    used      = app_usage.get(app_id, 0)
    remaining = limit - used
    if remaining <= 0:
        for user in active_users:
            subprocess.run(['pkill', '-u', user, '-x', '-i', proc], capture_output=True, check=False)
            notify_user(user, f'Daily time limit for {name} reached ({limit} minutes).')
    elif remaining == 5 and is_running:
        # 5-minute warning — notify but do not kill yet
        for user in active_users:
            notify_user(user, f'{name}: 5 minutes of daily screen time remaining.')

if changed:
    with open(usage_file, 'w') as f:
        json.dump({'date': today, 'usage': app_usage}, f)
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

    ipcMain.handle('quota:redeploy', () => {
        try {
            redeployQuotaFromDisk(configDir)
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
        } catch (e) { return { error: e.message } }
    })

    ipcMain.handle('quota:removeEntry', (_, appId) => {
        try {
            const quotas = readQuotaEntries(configDir).filter(q => q.appId !== appId)
            saveQuotas(configDir, quotas)
            deployScript(configDir, quotas)
        } catch (e) { return { error: e.message } }
    })
}
