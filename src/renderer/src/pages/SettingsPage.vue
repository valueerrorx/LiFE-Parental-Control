<template>
    <div class="pc-page-header">
        <h1>Settings</h1>
        <p>Password protection and application configuration</p>
    </div>

    <div class="pc-content">
        <div class="row g-3">
            <!-- Change password -->
            <div class="col-6">
                <div class="pc-card">
                    <div class="pc-card-header">
                        <h6><i class="bi bi-key me-2" />Change Password</h6>
                    </div>
                    <div class="pc-card-body">
                        <div class="mb-3">
                            <label class="form-label small text-muted">Current password</label>
                            <input v-model="changePw.current" type="password" class="pc-input" placeholder="Current password" />
                        </div>
                        <div class="mb-3">
                            <label class="form-label small text-muted">New password</label>
                            <input v-model="changePw.new1" type="password" class="pc-input" placeholder="New password" />
                        </div>
                        <div class="mb-3">
                            <label class="form-label small text-muted">Confirm new password</label>
                            <input v-model="changePw.new2" type="password" class="pc-input" placeholder="Repeat new password" />
                        </div>
                        <p v-if="pwMsg" :class="pwError ? 'text-danger' : 'text-success'" class="small">{{ pwMsg }}</p>
                        <button class="btn-pc-primary" @click="onChangePassword">Update Password</button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-box-arrow-in-right me-2" />Startup</h6></div>
                    <div class="pc-card-body">
                        <div class="form-check form-switch">
                            <input
                                id="life-autostart"
                                v-model="autostartEnabled"
                                class="form-check-input"
                                type="checkbox"
                                role="switch"
                                :disabled="!appInfo?.packaged || autostartBusy"
                                @change="onAutostartChange"
                            />
                            <label class="form-check-label" for="life-autostart">Start automatically at login</label>
                        </div>
                        <p v-if="autostartMismatch" class="small text-warning mb-0 mt-2">
                            Preference is on but the autostart file is missing — toggle off and on to restore, or check permissions.
                        </p>
                        <p v-if="autostartMsg" class="small mt-2 mb-0" :class="autostartError ? 'text-danger' : 'text-success'">{{ autostartMsg }}</p>
                        <p v-if="appInfo && !appInfo.packaged" class="small text-warning mb-0 mt-2">Not available in development builds.</p>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-shield-lock me-2" />Session lock</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            After unlocking with a password, the app locks again after inactivity (mouse, keyboard, scroll).
                        </p>
                        <label class="form-label small text-muted">Auto-lock after idle</label>
                        <select v-model.number="sessionPrefs.lockIdleMinutes" class="pc-input mb-3" style="max-width:220px;">
                            <option v-for="opt in LOCK_IDLE_OPTIONS" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </option>
                        </select>
                        <p v-if="sessionPrefsMsg" class="small mb-2" :class="sessionPrefsError ? 'text-danger' : 'text-success'">{{ sessionPrefsMsg }}</p>
                        <button type="button" class="btn-pc-outline" @click="onSaveSessionPrefs">Save</button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-archive me-2" />Backup &amp; restore</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            Export or import a JSON bundle: only <strong>top-level keys present</strong> in the file are applied; omitted keys leave the system unchanged. For <code>webFilter</code>, <code>blockedApps</code>, and <code>quotas</code>, a missing <code>entries</code> array or a non-array value clears that section (same as <code>[]</code>). <code>preferences</code> non-object (e.g. <code>null</code>) removes <code>lockIdleMinutes</code> from config (app default applies). Screen time, web filter, blocked apps, quotas, life modes, session lock, startup flag. Password and usage history are <strong>not</strong> included.
                        </p>
                        <div class="d-flex flex-wrap gap-2">
                            <button type="button" class="btn-pc-outline" :disabled="backupBusy" @click="onBackupExport">
                                <i class="bi bi-download me-1" />Export…
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="backupBusy" @click="onBackupImport">
                                <i class="bi bi-upload me-1" />Import…
                            </button>
                        </div>
                        <p v-if="backupMsg" class="small mt-2 mb-0" :class="backupError ? 'text-danger' : 'text-success'">{{ backupMsg }}</p>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-wrench-adjustable me-2" />Maintenance</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            Re-deploy cron jobs from JSON on disk if a script or cron file was removed or edited outside the app
                            (<strong>Save</strong> on Screen Time / App quotas / Quota exemptions already redeploys). Packaged installs also
                            <strong>auto-redeploy</strong> screen-time and quota cron on first root start after an <strong>app version</strong> bump (see Dashboard
                            <em>Recent activity</em>: <code>embedded_enforcement_redeploy</code>). <strong>Web filter</strong> is the same as
                            <strong>Restore from saved rules</strong> on the Web Filter page (rebuilds the hosts block from <code>webfilter.json</code>).
                            <strong>Usage logs</strong> removes <code>usage-*</code>, <code>quota-usage-*</code>, and <code>app-usage-*</code> JSON older than 120 days (same rule as automatic cleanup).
                        </p>
                        <div class="d-flex flex-wrap gap-2">
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployScheduleCron">
                                <i class="bi bi-arrow-repeat me-1" />Screen time
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployQuotaCron">
                                <i class="bi bi-arrow-repeat me-1" />App quotas
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onReapplyWebHosts">
                                <i class="bi bi-arrow-repeat me-1" />Web filter restore
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployKillCron">
                                <i class="bi bi-arrow-repeat me-1" />Quota exemptions
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onPruneUsageArchives">
                                <i class="bi bi-trash me-1" />Usage logs (old)
                            </button>
                        </div>
                        <p v-if="maintMsg" class="small mt-2 mb-0" :class="maintError ? 'text-danger' : 'text-success'">{{ maintMsg }}</p>
                    </div>
                </div>
            </div>

            <!-- About + danger zone -->
            <div class="col-6">
                <div class="pc-card mb-3">
                    <div class="pc-card-header"><h6><i class="bi bi-info-circle me-2" />About</h6></div>
                    <div class="pc-card-body">
                        <div class="d-flex flex-column gap-1" style="font-size:13px;">
                            <div>
                                <span class="text-muted" style="min-width:120px;display:inline-block;">Application</span>
                                {{ appInfo?.name || 'LiFE Parental Control' }}
                            </div>
                            <div>
                                <span class="text-muted" style="min-width:120px;display:inline-block;">Version</span>
                                {{ appInfo?.version ?? '—' }}
                                <span v-if="appInfo && !appInfo.packaged" class="text-muted small ms-1">(dev)</span>
                            </div>
                            <div><span class="text-muted" style="min-width:120px;display:inline-block;">Runtime</span> Electron {{ appInfo?.electron ?? '—' }}, Node {{ appInfo?.node ?? '—' }}</div>
                            <div><span class="text-muted" style="min-width:120px;display:inline-block;">Platform</span> KDE Plasma (Linux)</div>
                            <div><span class="text-muted" style="min-width:120px;display:inline-block;">Config directory</span> <code>/etc/life-parental/</code></div>
                            <div>
                                <span class="text-muted" style="min-width:120px;display:inline-block;">Running as</span>
                                <template v-if="appInfo?.runningAsRoot === true">root</template>
                                <template v-else-if="appInfo?.runningAsRoot === false">
                                    <span class="text-warning">regular user — system changes will fail; use packaged app with pkexec or <code>npm run dev</code></span>
                                </template>
                                <template v-else>—</template>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="pc-card mb-3">
                    <div class="pc-card-header"><h6><i class="bi bi-sliders me-2" />Custom family profiles</h6></div>
                    <div class="pc-card-body text-muted" style="font-size:12px;line-height:1.65;">
                        <p class="mb-2">Add modes to <code>/etc/life-parental/life-modes.json</code>. Keys must not be <code>school</code> or <code>leisure</code> (those stay built-in). Restart the app or rely on the next Dashboard load to see new buttons.</p>
                        <p class="mb-2 small"><strong>Fields:</strong> <code>label</code> (optional), <code>schedule</code> (same shape as Screen Time), <code>mergeCategories</code> / <code>stripCategories</code> (Web Filter category names only), <code>blockedDesktopIds</code> (e.g. <code>firefox.desktop</code>). If <code>mergeCategories</code> is non-empty, <code>stripCategories</code> is ignored for that mode.</p>
                        <pre class="bg-light border rounded p-2 mb-0" style="font-size:11px;max-height:220px;overflow:auto;">{
  "homework": {
    "label": "Homework",
    "schedule": {
      "enabled": true,
      "dailyLimitEnabled": true,
      "dailyLimitMinutes": 60,
      "allowedHoursEnabled": true,
      "allowedHoursStart": "17:00",
      "allowedHoursEnd": "20:00",
      "allowedDays": [1, 2, 3, 4, 5]
    },
    "mergeCategories": ["Video Streaming"],
    "stripCategories": [],
    "blockedDesktopIds": []
  }
}</pre>
                    </div>
                </div>

                <div class="pc-card" style="border-color:#FFCDD2;">
                    <div class="pc-card-header" style="background:#FFF5F5;">
                        <h6 style="color:#C62828;"><i class="bi bi-exclamation-triangle me-2" />Danger Zone</h6>
                    </div>
                    <div class="pc-card-body d-flex flex-column gap-3">
                        <p class="text-muted small mb-0">
                            Destructive actions for the whole system profile under <code>/etc/life-parental/</code>.
                        </p>
                        <div>
                            <div class="fw-semibold mb-1" style="font-size:13px;">Stop and remove all restrictions</div>
                            <p class="text-muted small mb-2">
                                Disables screen time (removes its cron), clears app quotas and quota cron,
                                unblocks all apps, removes web-filter rules from <code>/etc/hosts</code> (LiFE block),
                                turns off quota exemptions list, and removes KDE kiosk sections from
                                <code>kdeglobals</code> (only if kiosk rules are active — triggers a Plasma session restart then).
                            </p>
                            <button type="button" class="btn-pc-danger" :disabled="dangerBusy" @click="onStopAllProtections">
                                <i class="bi bi-slash-circle me-1" />Stop all protections
                            </button>
                        </div>
                        <div class="pt-2 border-top" style="border-color:#FFCDD2;">
                            <div class="fw-semibold mb-1" style="font-size:13px;">Delete all usage history</div>
                            <p class="text-muted small mb-2">
                                Deletes every <code>usage-*.json</code>, <code>quota-usage-*.json</code>, and <code>app-usage-*.json</code> file in the config directory
                                (all days — screen time and per-app quota logs). Does not change schedules or limits.
                            </p>
                            <button type="button" class="btn-pc-danger" :disabled="dangerBusy" @click="onDeleteAllUsageHistory">
                                <i class="bi bi-trash3 me-1" />Delete all usage history
                            </button>
                        </div>
                        <p v-if="dangerMsg" class="small mb-0" :class="dangerError ? 'text-danger' : 'text-success'">{{ dangerMsg }}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { normalizedLockIdleMinutesOrUndefined, LOCK_IDLE_OPTIONS } from '@shared/lockIdleMinutes.js'
import { useAppStore } from '../stores/appStore.js'

const appStore = useAppStore()
const appInfo = ref(null)
const sessionPrefs = reactive({ lockIdleMinutes: 15 })
const sessionPrefsMsg = ref('')
const sessionPrefsError = ref(false)

const changePw = reactive({ current: '', new1: '', new2: '' })
const pwMsg = ref('')
const pwError = ref(false)
const backupBusy = ref(false)
const backupMsg = ref('')
const backupError = ref(false)
const maintBusy = ref(false)
const maintMsg = ref('')
const maintError = ref(false)
const dangerBusy = ref(false)
const dangerMsg = ref('')
const dangerError = ref(false)
const autostartEnabled = ref(false)
const autostartFilePresent = ref(false)
const autostartBusy = ref(false)
const autostartMsg = ref('')
const autostartError = ref(false)

const autostartMismatch = computed(() => autostartEnabled.value && !autostartFilePresent.value)

onMounted(async () => {
    appInfo.value = await window.api.system.getAppInfo()
    const cfg = await window.api.settings.getConfig()
    sessionPrefs.lockIdleMinutes = normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes) ?? 15
    autostartEnabled.value = cfg.autostartEnabled === true
    autostartFilePresent.value = cfg.autostartFilePresent === true
})

async function onAutostartChange() {
    autostartMsg.value = ''
    autostartBusy.value = true
    const r = await window.api.settings.setAutostart(autostartEnabled.value)
    autostartBusy.value = false
    if (r?.error) {
        autostartError.value = true
        autostartMsg.value = r.error
        autostartEnabled.value = !autostartEnabled.value
    } else {
        autostartError.value = false
        autostartMsg.value = autostartEnabled.value
            ? 'Autostart installed under /etc/xdg/autostart.'
            : 'Autostart desktop file removed.'
        if (typeof r?.autostartFilePresent === 'boolean') autostartFilePresent.value = r.autostartFilePresent
        else {
            const cfg = await window.api.settings.getConfig()
            autostartFilePresent.value = cfg.autostartFilePresent === true
        }
    }
    setTimeout(() => { autostartMsg.value = '' }, 6000)
}

async function onSaveSessionPrefs() {
    sessionPrefsMsg.value = ''
    const minutes = Number(sessionPrefs.lockIdleMinutes)
    sessionPrefs.lockIdleMinutes = normalizedLockIdleMinutesOrUndefined(minutes) ?? 15
    try {
        await window.api.settings.saveConfig({ lockIdleMinutes: sessionPrefs.lockIdleMinutes })
        sessionPrefsMsg.value = 'Saved. Applies to the next unlock or immediately if already unlocked.'
        sessionPrefsError.value = false
        window.dispatchEvent(new CustomEvent('life-parental-lock-prefs'))
    } catch (e) {
        sessionPrefsMsg.value = e?.message || 'Save failed'
        sessionPrefsError.value = true
    }
    setTimeout(() => { sessionPrefsMsg.value = '' }, 5000)
}

async function onChangePassword() {
    pwMsg.value = ''
    if (!changePw.new1) { pwMsg.value = 'New password cannot be empty'; pwError.value = true; return }
    if (changePw.new1 !== changePw.new2) { pwMsg.value = 'Passwords do not match'; pwError.value = true; return }
    const result = await window.api.settings.changePassword(changePw.current, changePw.new1)
    if (result?.error) {
        pwMsg.value = result.error; pwError.value = true
    } else {
        pwMsg.value = 'Password updated successfully'; pwError.value = false
        changePw.current = changePw.new1 = changePw.new2 = ''
    }
}

async function onStopAllProtections() {
    if (!window.confirm(
        'Stop and remove ALL LiFE protections? This clears schedules (screen time off), quotas, blocks, web filter hosts block, quota exemptions, and KDE kiosk (if active — session will restart).'
    )) return
    dangerBusy.value = true
    dangerMsg.value = ''
    const r = await window.api.settings.stopAllProtections()
    dangerBusy.value = false
    if (r?.error) {
        dangerMsg.value = r.error
        dangerError.value = true
    } else {
        dangerMsg.value = 'All protections removed. Refresh sidebar state…'
        dangerError.value = false
        await appStore.refreshProtectionsState()
    }
    setTimeout(() => { dangerMsg.value = '' }, 8000)
}

async function onDeleteAllUsageHistory() {
    if (!window.confirm(
        'Delete ALL screen-time and app-usage daily log files (usage-*.json, quota-usage-*.json, app-usage-*.json)? This cannot be undone.'
    )) return
    dangerBusy.value = true
    dangerMsg.value = ''
    const r = await window.api.settings.deleteAllUsageHistory()
    dangerBusy.value = false
    if (r?.error) {
        dangerMsg.value = r.error
        dangerError.value = true
    } else {
        dangerMsg.value = `Removed ${r?.removed ?? 0} log file(s).`
        dangerError.value = false
        await appStore.refreshProtectionsState()
    }
    setTimeout(() => { dangerMsg.value = '' }, 8000)
}

async function onRedeployScheduleCron() {
    if (!window.confirm('Rewrite /usr/local/bin/life-parental-check and /etc/cron.d/life-parental from saved schedules.json?')) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.schedules.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = 'Screen time cron and check script updated.'
        maintError.value = false
    }
}

async function onRedeployQuotaCron() {
    if (!window.confirm('Rewrite /usr/local/bin/life-parental-quota and /etc/cron.d/life-parental-quota from quota.json?')) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.quota.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = 'App quota cron and script updated.'
        maintError.value = false
    }
}

async function onRedeployKillCron() {
    if (!window.confirm(
        'Re-deploy /usr/local/bin/life-parental-quota from disk (pick up process-whitelist.json) and remove legacy life-parental-kill files if present?'
    )) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.processWhitelist.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = 'Quota script re-deployed; quota exemptions picked up from disk.'
        maintError.value = false
    }
}

async function onPruneUsageArchives() {
    if (!window.confirm(
        'Delete usage-*.json, quota-usage-*.json, and app-usage-*.json in /etc/life-parental/ older than 120 days (by date in the filename)?'
    )) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.settings.pruneUsageArchives()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = `Removed ${r?.removed ?? 0} old file(s).`
        maintError.value = false
    }
}

async function onReapplyWebHosts() {
    if (!window.confirm(
        'Restore web filter: replace the hosts-file block with /etc/life-parental/webfilter.json? (same as Web Filter → Restore from saved rules.)'
    )) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.webFilter.reapplyMirror()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        await appStore.loadWebFilter()
        maintMsg.value = 'Web filter restored from webfilter.json.'
        maintError.value = false
    }
}

async function onBackupExport() {
    backupMsg.value = ''
    backupBusy.value = true
    const r = await window.api.backup.export()
    backupBusy.value = false
    if (r?.canceled) return
    if (r?.error) {
        backupMsg.value = r.error
        backupError.value = true
    } else {
        backupMsg.value = `Saved: ${r.path}`
        backupError.value = false
    }
}

async function onBackupImport() {
    backupMsg.value = ''
    if (!window.confirm(
        'Import from the selected backup? Only top-level sections present in the file are applied (/etc/hosts + mirror when webFilter is included; cron when schedules, quotas, or processWhitelist change). Omitted sections are left unchanged.'
    )) return
    backupBusy.value = true
    const r = await window.api.backup.import()
    backupBusy.value = false
    if (r?.canceled) return
    if (r?.error) {
        backupMsg.value = r.error
        backupError.value = true
    } else {
        await appStore.refreshProtectionsState()
        const cfg = await window.api.settings.getConfig()
        sessionPrefs.lockIdleMinutes = normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes) ?? sessionPrefs.lockIdleMinutes
        window.dispatchEvent(new CustomEvent('life-parental-lock-prefs'))
        backupMsg.value = 'Import completed. Protection state refreshed (open Dashboard to reload family profile buttons).'
        backupError.value = false
    }
}
</script>
