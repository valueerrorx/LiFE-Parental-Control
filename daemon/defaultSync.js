/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');

const DEFAULT_JSON_FILE = 'default.json';

const EMPTY_DEFAULT = {
    label: 'Default',
    schedule: {
        enabled: false,
        screenTimeLinuxUser: '',
        allowedDays: [1, 2, 3, 4, 5, 6, 7],
        weekday: { dailyLimitEnabled: false, dailyLimitMinutes: 120, allowedHoursEnabled: false, allowedHoursStart: '07:00', allowedHoursEnd: '22:00' },
        weekend: { dailyLimitEnabled: false, dailyLimitMinutes: 180, allowedHoursEnabled: false, allowedHoursStart: '09:00', allowedHoursEnd: '21:00' }
    },
    webfilter: {
        enabled: true,
        feedState: {},
        entries: [],
        listAllowlist: []
    },
    appControl: {
        enabled: true
    },
    blockedDesktopIds: [],
    quotaExemptions: {
        enabled: false,
        allowedIds: []
    },
    quota: []
};

const HOSTS_FILE = '/etc/hosts';
const MARKER_BEGIN = '# LiFE Parental Control - BEGIN';
const MARKER_END = '# LiFE Parental Control - END';

const HAGEZI_DIR = '/usr/share/life-parental/hagezi';

const HAGEZI_FEEDS = [
    { id: 'social', file: 'social.txt' },
    { id: 'nsfw', file: 'nsfw.txt' },
    { id: 'fake', file: 'fake.txt' },
    { id: 'gambling', file: 'gambling.txt' },
    { id: 'anti_piracy', file: 'anti.piracy.txt' },
    { id: 'popupads', file: 'popupads.txt' }
];

const HAGEZI_FEED_BY_ID = new Map(HAGEZI_FEEDS.map(f => [f.id, f]));

const DESKTOP_DIRS = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    '/var/lib/flatpak/exports/share/applications'
];

const OVERRIDE_DIR = '/usr/local/share/applications';
const APPARMOR_PROFILE = '/etc/apparmor.d/life-parental-blocked';

function desktopIdStem(id) {
    return path.basename(String(id || ''), '.desktop').toLowerCase();
}

function desktopIdTailStem(id) {
    const stem = desktopIdStem(id);
    const parts = stem.split('.');
    return parts[parts.length - 1] || stem;
}

function levenshtein(a, b) {
    const s = String(a);
    const t = String(b);
    const n = s.length;
    const m = t.length;
    if (n === 0) return m;
    if (m === 0) return n;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        const si = s.charCodeAt(i - 1);
        for (let j = 1; j <= m; j++) {
            const cost = si === t.charCodeAt(j - 1) ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[n][m];
}

function resolveBlockedIdsAgainstInstalled(rawIds, installedIds) {
    const ids = Array.isArray(rawIds) ? rawIds : [];
    const installed = new Set(Array.from(installedIds || []));

    const byStem = new Map();
    const byTail = new Map();
    for (const id of installed) {
        const stem = desktopIdStem(id);
        const tail = desktopIdTailStem(id);
        if (!byStem.has(stem)) byStem.set(stem, []);
        byStem.get(stem).push(id);
        if (!byTail.has(tail)) byTail.set(tail, []);
        byTail.get(tail).push(id);
    }

    function fuzzyPick(rawWithExt) {
        const rawStem = desktopIdStem(rawWithExt);
        const rawTail = desktopIdTailStem(rawWithExt);
        const maxLen = Math.max(rawStem.length, rawTail.length);
        const threshold = maxLen <= 6 ? 2 : 3;
        let best = '';
        let bestDist = null;
        for (const inst of installed) {
            const dist = Math.min(
                levenshtein(rawTail, desktopIdTailStem(inst)),
                levenshtein(rawStem, desktopIdStem(inst))
            );
            if (dist > threshold) continue;
            if (bestDist === null || dist < bestDist) {
                bestDist = dist;
                best = inst;
            } else if (dist === bestDist && inst !== best) {
                best = '';
            }
        }
        return best || null;
    }

    const out = [];
    const seen = new Set();
    for (const rawId of ids) {
        const raw = String(rawId || '').trim();
        if (!raw) continue;
        const withExt = raw.endsWith('.desktop') ? raw : `${raw}.desktop`;

        let resolved = '';
        if (installed.has(raw)) resolved = raw;
        else if (installed.has(withExt)) resolved = withExt;
        else {
            const stem = desktopIdStem(withExt);
            const tail = desktopIdTailStem(withExt);
            const stemMatches = byStem.get(stem) || [];
            if (stemMatches.length === 1) resolved = stemMatches[0];
            else {
                const tailMatches = byTail.get(tail) || [];
                if (tailMatches.length === 1) resolved = tailMatches[0];
                if (!resolved) resolved = fuzzyPick(withExt) || '';
            }
        }

        if (!resolved) resolved = withExt; // keep as-is (may not exist)
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        out.push(resolved);
    }
    return out;
}

function readInstalledDesktopIds() {
    const installed = new Set();
    for (const dir of DESKTOP_DIRS) {
        try {
            if (!fs.existsSync(dir)) continue;
            for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.desktop'))) installed.add(file);
        } catch {
            /* ignore */
        }
    }
    return installed;
}

function normalizeAllowlist(domains) {
    if (!Array.isArray(domains)) return [];
    const out = new Set();
    for (const x of domains) {
        if (typeof x !== 'string') continue;
        const d = x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split('/')[0];
        if (d) out.add(d);
    }
    return Array.from(out).sort();
}

function parseDnsmasqDomains(text) {
    const domains = [];
    if (typeof text !== 'string') return domains;
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const m = t.match(/^local=\/(.+)\/$/);
        if (m) domains.push(String(m[1]).toLowerCase());
    }
    return domains;
}

function loadFeedFileText(feedId) {
    const feed = HAGEZI_FEED_BY_ID.get(feedId);
    if (!feed) return null;
    try {
        return fs.readFileSync(path.join(HAGEZI_DIR, feed.file), 'utf8');
    } catch {
        return null;
    }
}

function buildWebBlockedDomains(defaultWebfilter) {
    const wf = defaultWebfilter && typeof defaultWebfilter === 'object' && !Array.isArray(defaultWebfilter)
        ? defaultWebfilter
        : {};

    if (wf.enabled === false) return [];

    const feedState = (wf.feedState && typeof wf.feedState === 'object' && !Array.isArray(wf.feedState))
        ? wf.feedState
        : {};

    const manualEntries = Array.isArray(wf.entries) ? wf.entries : [];
    const allowlist = normalizeAllowlist(wf.listAllowlist);

    const blocked = new Set();

    for (const e of manualEntries) {
        if (!e || typeof e !== 'object') continue;
        if (e.enabled === false) continue;
        if (typeof e.domain !== 'string') continue;
        blocked.add(e.domain.toLowerCase());
    }

    for (const [id, on] of Object.entries(feedState)) {
        if (!on) continue;
        const text = loadFeedFileText(id);
        if (!text) continue;
        for (const d of parseDnsmasqDomains(text)) blocked.add(d);
    }

    for (const a of allowlist) blocked.delete(a);
    return Array.from(blocked).sort();
}

function flushDns() {
    execFile('systemd-resolve', ['--flush-caches'], { timeout: 3000 }, () => {});
    execFile('resolvectl', ['flush-caches'], { timeout: 3000 }, () => {});
    execFile('dnsmasq', ['--clear-on-reload'], { timeout: 3000 }, () => {});
}

async function writeHostsBlockedDomains(domains) {
    let content = '';
    try { content = fs.readFileSync(HOSTS_FILE, 'utf8'); } catch { return; }

    const lines = domains.map(d => `0.0.0.0 ${d}`);
    const section = `\n${lines.join('\n')}\n`;
    const begin = content.indexOf(MARKER_BEGIN);
    const end = content.indexOf(MARKER_END);

    let newContent;
    if (begin !== -1 && end !== -1) {
        newContent = content.slice(0, begin) + MARKER_BEGIN + section + MARKER_END + content.slice(end + MARKER_END.length);
    } else {
        newContent = content.trimEnd() + `\n\n${MARKER_BEGIN}${section}${MARKER_END}\n`;
    }
    try {
        fs.writeFileSync(HOSTS_FILE, newContent, 'utf8');
    } catch {
        /* ignore */
    }
    flushDns();
}

function normalizeSchedule(schedule) {
    const s = schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {};
    const out = { ...EMPTY_DEFAULT.schedule, ...s };
    out.enabled = out.enabled === true;
    out.dailyLimitEnabled = out.dailyLimitEnabled === true;
    out.dailyLimitMinutes = Number.isFinite(Number(out.dailyLimitMinutes)) ? Number(out.dailyLimitMinutes) : 120;
    out.screenTimeLinuxUser = typeof out.screenTimeLinuxUser === 'string' ? out.screenTimeLinuxUser : '';
    out.allowedHoursEnabled = out.allowedHoursEnabled === true;
    out.allowedHoursStart = typeof out.allowedHoursStart === 'string' ? out.allowedHoursStart : '07:00';
    out.allowedHoursEnd = typeof out.allowedHoursEnd === 'string' ? out.allowedHoursEnd : '22:00';
    out.allowedDays = Array.isArray(out.allowedDays)
        ? out.allowedDays.map(n => Number(n)).filter(n => Number.isFinite(n)).map(n => Math.trunc(n))
        : [1, 2, 3, 4, 5, 6, 7];
    return out;
}

function normalizeBlockedIds(blockedDesktopIds) {
    const list = Array.isArray(blockedDesktopIds) ? blockedDesktopIds : [];
    const out = [];
    for (const item of list) {
        const id = typeof item === 'string' ? item : item && typeof item === 'object' ? item.id : '';
        if (typeof id !== 'string') continue;
        if (!id.endsWith('.desktop')) continue;
        out.push(id);
    }
    return out;
}

function normalizeAppControl(appControl) {
    const c = appControl && typeof appControl === 'object' && !Array.isArray(appControl)
        ? appControl
        : {};
    return { enabled: c.enabled !== false };
}

function normalizeQuotaExemptions(quotaExemptions) {
    const q = quotaExemptions && typeof quotaExemptions === 'object' && !Array.isArray(quotaExemptions)
        ? quotaExemptions
        : {};
    const enabled = q.enabled === true;
    const allowedIds = Array.isArray(q.allowedIds) ? q.allowedIds.filter(s => typeof s === 'string') : [];
    return { enabled, allowedIds };
}

function normalizeQuotaEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const out = [];
    for (const e of list) {
        if (!e || typeof e !== 'object') continue;
        const appId = typeof e.appId === 'string' ? e.appId : '';
        const processName = typeof e.processName === 'string' ? e.processName.trim() : '';
        const minutesPerDay = Number(e.minutesPerDay);
        if (!appId || !appId.endsWith('.desktop')) continue;
        if (!processName) continue;
        if (!Number.isFinite(minutesPerDay)) continue;
        out.push({
            appId,
            appName: typeof e.appName === 'string' ? e.appName : '',
            processName,
            linuxUser: typeof e.linuxUser === 'string' ? e.linuxUser : '',
            minutesPerDay: Math.floor(minutesPerDay)
        });
    }
    return out;
}

function writeJsonFile(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
}

function parseDesktopFile(filePath) {
    let content = '';
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { return null; }
    const get = (key) => {
        const re = new RegExp(`^${key}=(.*)$`, 'm');
        const m = content.match(re);
        return m ? String(m[1]).trim() : '';
    };
    const name = get('Name');
    const exec = get('Exec');
    const noDisplay = String(get('NoDisplay')).toLowerCase() === 'true';
    const hidden = String(get('Hidden')).toLowerCase() === 'true';
    if (!name || !exec || noDisplay || hidden) return null;
    return { name, exec };
}

function execLineToFullPath(execLine) {
    if (!execLine) return null;
    const clean = String(execLine).trim().replace(/%[a-zA-Z]/g, '').trim();
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
    } catch {
        /* ignore */
    }
    return null;
}

function buildApparmorProfile(entries) {
    const header = '# Managed by LiFE Parental Control — do not edit manually\n' +
        '# Rewritten automatically on block/unblock. Do not edit by hand.\n\n';
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return header;
    return header + list.map(({ execPath, appId }) =>
        `${execPath} {\n  # ${appId} — blocked by parental controls\n  deny /** rwxl,\n}\n`
    ).join('\n');
}

function applyDesktopOverride(blockedIds) {
    const blocked = new Set(blockedIds);
    if (!fs.existsSync(OVERRIDE_DIR)) return;

    for (const id of blocked) {
        const overridePath = path.join(OVERRIDE_DIR, id);
        if (fs.existsSync(overridePath)) {
            // Always rewrite so it matches current Exec/NoDisplay replacement.
        }
        let originalPath = null;
        for (const dir of DESKTOP_DIRS) {
            const p = path.join(dir, id);
            if (fs.existsSync(p)) { originalPath = p; break; }
        }
        if (!originalPath) continue;
        if (originalPath === overridePath) continue;
        const original = fs.readFileSync(originalPath, 'utf8');
        let modified = original.replace(/^(NoDisplay=.*)$/m, 'NoDisplay=true');
        if (!modified.includes('NoDisplay=true')) modified = modified.replace(/(\[Desktop Entry\])/, '$1\nNoDisplay=true');
        modified = modified.replace(/^Exec=.*$/m,
            'Exec=notify-send -u critical "LiFE Parental Control" "This application is blocked by parental controls."');
        fs.writeFileSync(overridePath, modified, 'utf8');
    }

    // Remove overrides that are no longer blocked.
    try {
        for (const file of fs.readdirSync(OVERRIDE_DIR).filter(f => f.endsWith('.desktop'))) {
            const id = file;
            if (!blocked.has(id)) {
                const overridePath = path.join(OVERRIDE_DIR, id);
                if (!fs.existsSync(overridePath)) continue;
                try {
                    const c = fs.readFileSync(overridePath, 'utf8');
                    // Only remove overrides created by LiFE Parental Control.
                    if (c.includes('This application is blocked by parental controls.') && c.includes('LiFE Parental Control')) fs.unlinkSync(overridePath);
                } catch {
                    /* ignore */
                }
            }
        }
    } catch { /* ignore */ }

    // Refresh the launcher database.
    try {
        execFile('update-desktop-database', [OVERRIDE_DIR], { timeout: 5000 }, () => {});
    } catch { /* ignore */ }
}

function syncAppArmor(blockedIds, log) {
    const blocked = new Set(blockedIds);
    const entries = [];
    const seenExec = new Set();

    for (const id of blocked) {
        let originalPath = null;
        for (const dir of DESKTOP_DIRS) {
            const p = path.join(dir, id);
            if (fs.existsSync(p)) { originalPath = p; break; }
        }
        if (!originalPath) continue;
        const d = parseDesktopFile(originalPath);
        if (!d) continue;
        const full = execLineToFullPath(d.exec);
        if (!full || seenExec.has(full)) continue;
        seenExec.add(full);
        entries.push({ execPath: full, appId: id });
    }

    // Remove previously loaded profiles from this file before rewriting.
    if (fs.existsSync(APPARMOR_PROFILE)) {
        try {
            spawnSync('apparmor_parser', ['-R', APPARMOR_PROFILE], { timeout: 5000, stdio: 'ignore' });
        } catch { /* ignore */ }
    }

    try { fs.mkdirSync(path.dirname(APPARMOR_PROFILE), { recursive: true }) } catch { /* ignore */ }
    try {
        fs.writeFileSync(APPARMOR_PROFILE, buildApparmorProfile(entries), 'utf8');
    } catch {
        log && log.warn && log.warn('defaultSync: failed to write AppArmor profile');
        return;
    }

    if (entries.length > 0) {
        try {
            spawnSync('apparmor_parser', ['-a', APPARMOR_PROFILE], { timeout: 5000, stdio: 'ignore' });
        } catch { /* ignore */ }
    }
}

async function applyFromDefault({ configDir, log }) {
    const defaultPath = path.join(configDir, DEFAULT_JSON_FILE);
    const raw = fs.readFileSync(defaultPath, 'utf8');
    const data = JSON.parse(raw);

    const schedule = normalizeSchedule(data.schedule);
    const appControl = normalizeAppControl(data.appControl);
    const blockedIdsRaw = normalizeBlockedIds(data.blockedDesktopIds);
    const quotaExemptions = normalizeQuotaExemptions(data.quotaExemptions);
    const quotaEntries = normalizeQuotaEntries(data.quota);

    const installed = readInstalledDesktopIds();
    const blockedResolved = resolveBlockedIdsAgainstInstalled(blockedIdsRaw, installed);

    const quotaAllowedResolved = resolveBlockedIdsAgainstInstalled(quotaExemptions.allowedIds, installed);
    const blockedSet = new Set(blockedResolved);
    const quotaAllowed = quotaAllowedResolved.filter(id => !blockedSet.has(id));

    // Enforce app blocking runtime (desktop overrides + AppArmor).
    try {
        applyDesktopOverride(appControl.enabled ? blockedResolved : []);
    } catch { /* ignore */ }
    try {
        syncAppArmor(appControl.enabled ? blockedResolved : [], log);
    } catch { /* ignore */ }

    // Enforce webfilter runtime (respects enabled flag; reads entries/feedState/allowlist from default.json).
    const wf = data.webfilter && typeof data.webfilter === 'object' && !Array.isArray(data.webfilter) ? data.webfilter : {};
    const blockedDomains = buildWebBlockedDomains(wf);
    await writeHostsBlockedDomains(blockedDomains);
}

function ensureDefaultJsonExists({ configDir, log }) {
    const p = path.join(configDir, DEFAULT_JSON_FILE);
    try {
        if (fs.existsSync(p)) return false;
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(p, JSON.stringify(EMPTY_DEFAULT, null, 2), { encoding: 'utf8', mode: 0o600 });
        log && log.info && log.info('defaultSync: created default.json')
        return true;
    } catch {
        /* ignore */
        return false
    }
}

function fileHash(p) {
    try {
        const buf = fs.readFileSync(p);
        return crypto.createHash('sha256').update(buf).digest('hex');
    } catch {
        return null;
    }
}

function createDefaultSync({ configDir, log }) {
    let lastHash = null;
    let lastRunAt = 0;
    const minIntervalMs = 15_000;

    ensureDefaultJsonExists({ configDir, log });

    return {
        maybeSync: async () => {
            const now = Date.now();
            if (now - lastRunAt < minIntervalMs) return;
            lastRunAt = now;

            const defaultPath = path.join(configDir, DEFAULT_JSON_FILE);
            const h = fileHash(defaultPath);
            if (!h) return;
            if (h === lastHash) return;
            lastHash = h;

            try {
                log && log.info && log.info('defaultSync: applying from default.json');
                await applyFromDefault({ configDir, log });
                log && log.info && log.info('defaultSync: apply success');
            } catch (e) {
                log && log.warn && log.warn('defaultSync: apply failed', e && e.message ? e.message : String(e));
            }
        }
    };
}

module.exports = { createDefaultSync };

