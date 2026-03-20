import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'

const WHITELIST_FILE = 'process-whitelist.json'
const KILL_SCRIPT    = '/usr/local/bin/life-parental-kill'
const KILL_CRON      = '/etc/cron.d/life-parental-kill'
const CRON_MARKER    = '# LiFE Parental Control Kill'

function readConfig(configDir) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(configDir, WHITELIST_FILE), 'utf8'))
        return {
            enabled:          raw.enabled === true,
            allowedIds:       Array.isArray(raw.allowedIds) ? raw.allowedIds : [],
            killProcessNames: Array.isArray(raw.killProcessNames) ? raw.killProcessNames : []
        }
    } catch {
        return { enabled: false, allowedIds: [], killProcessNames: [] }
    }
}

function saveConfig(configDir, config) {
    fs.writeFileSync(path.join(configDir, WHITELIST_FILE), JSON.stringify(config, null, 2), 'utf8')
}

function deployScript(configDir, config) {
    if (!config.enabled || !config.killProcessNames.length) {
        // Remove cron and script when disabled or no processes to kill
        if (fs.existsSync(KILL_CRON))   fs.unlinkSync(KILL_CRON)
        if (fs.existsSync(KILL_SCRIPT)) fs.unlinkSync(KILL_SCRIPT)
        return
    }

    const script = `#!/usr/bin/env python3
# LiFE Parental Control - process whitelist enforcement (runs every minute via cron)
import json, subprocess, os, pwd

WHITELIST_FILE = "${path.join(configDir, WHITELIST_FILE)}"

try:
    with open(WHITELIST_FILE) as f:
        cfg = json.load(f)
except Exception:
    exit(0)

if not cfg.get('enabled', False):
    exit(0)

kill_procs = cfg.get('killProcessNames', [])
if not kill_procs:
    exit(0)

def _loginctl_session_props(sid):
    r = subprocess.run(
        ['loginctl', 'show-session', sid, '-p', 'Type', '-p', 'State', '-p', 'Class'],
        capture_output=True, text=True, timeout=3, check=False
    )
    props = {}
    for line in r.stdout.strip().splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            props[k.strip()] = v.strip()
    return props

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
            p = _loginctl_session_props(sid)
            cls = p.get('Class', '')
            if cls in ('greeter', 'background'):
                continue
            t = p.get('Type', '')
            st = p.get('State', '')
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

for proc in kill_procs:
    for user in active_users:
        r = subprocess.run(['pgrep', '-u', user, '-x', '-i', proc],
                           capture_output=True, text=True, timeout=3, check=False)
        if r.stdout.strip():
            subprocess.run(['pkill', '-u', user, '-x', '-i', proc], capture_output=True, check=False)
            notify_user(user, f'{proc} is not allowed by parental controls.')
`
    fs.writeFileSync(KILL_SCRIPT, script, { mode: 0o755 })
    const content = `${CRON_MARKER}\n* * * * * root ${KILL_SCRIPT}\n`
    fs.writeFileSync(KILL_CRON, content, 'utf8')
    execFile('systemctl', ['reload', 'cron'],  { timeout: 3000 }, () => {})
    execFile('systemctl', ['reload', 'crond'], { timeout: 3000 }, () => {})
}

export function registerProcessWhitelistIpc(ipcMain, configDir) {
    ipcMain.handle('processWhitelist:get', () => {
        return readConfig(configDir)
    })

    ipcMain.handle('processWhitelist:save', (_, payload) => {
        try {
            const enabled          = payload.enabled === true
            const allowedIds       = Array.isArray(payload.allowedIds)       ? payload.allowedIds.filter(s => typeof s === 'string')       : []
            const killProcessNames = Array.isArray(payload.killProcessNames) ? payload.killProcessNames.filter(s => typeof s === 'string' && s.length > 0) : []
            const config = { enabled, allowedIds, killProcessNames }
            saveConfig(configDir, config)
            deployScript(configDir, config)
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })

    ipcMain.handle('processWhitelist:redeploy', () => {
        try {
            const config = readConfig(configDir)
            deployScript(configDir, config)
            return { ok: true }
        } catch (e) {
            return { error: e.message }
        }
    })
}
