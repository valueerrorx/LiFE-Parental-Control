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
                    <div class="pc-card-header"><h6><i class="bi bi-cpu me-2" />Systemd Daemon</h6></div>
                    <div class="pc-card-body">
                        <div class="d-flex flex-wrap align-items-center gap-3 mb-3">
                            <div>
                                <div class="small text-muted mb-1">Service</div>
                                <span class="status-badge" :class="daemonServiceStatus === 'active' ? 'active' : 'inactive'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ daemonServiceStatus ?? 'Unbekannt' }}
                                </span>
                            </div>
                            <div>
                                <div class="small text-muted mb-1">Socket</div>
                                <span class="status-badge" :class="daemonSocketConnected ? 'active' : 'inactive'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ daemonSocketConnected ? 'Verbunden' : 'Getrennt' }}
                                </span>
                            </div>
                            <div>
                                <div class="small text-muted mb-1">Node.js</div>
                                <span class="status-badge" :class="nodeVersion ? 'active' : 'warning'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ nodeVersion ?? 'Nicht gefunden' }}
                                </span>
                            </div>
                            <button type="button" class="btn-pc-outline ms-auto" style="font-size:12px;" :disabled="daemonRefreshing" @click="loadDaemonInfo">
                                <i class="bi bi-arrow-repeat me-1" :class="{ 'spin': daemonRefreshing }" />Aktualisieren
                            </button>
                        </div>
                        <p v-if="!nodeVersion" class="small text-danger mb-3">
                            <i class="bi bi-exclamation-triangle me-1" /><strong>/usr/bin/node nicht gefunden</strong> — der Daemon benötigt Node.js.
                            Paket <code>nodejs</code> installieren, dann Daemon installieren.
                        </p>
                        <div class="d-flex flex-wrap gap-2 mb-3">
                            <button type="button" class="btn-pc-primary" :disabled="daemonCtrlBusy" @click="onDaemonControl('install')" title="Kopiert Daemon + Service-Datei, aktiviert und startet den Service">
                                <i class="bi bi-download me-1" />Installieren &amp; starten
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="daemonCtrlBusy" @click="onDaemonControl('start')">
                                <i class="bi bi-play me-1" />Start
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="daemonCtrlBusy" @click="onDaemonControl('stop')">
                                <i class="bi bi-stop me-1" />Stop
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="daemonCtrlBusy" @click="onDaemonControl('restart')">
                                <i class="bi bi-arrow-repeat me-1" />Neustart
                            </button>
                        </div>
                        <p v-if="daemonCtrlMsg" class="small mb-2" :class="daemonCtrlError ? 'text-danger' : 'text-success'">{{ daemonCtrlMsg }}</p>
                        <p class="text-muted small mb-0">
                            <strong>Installieren &amp; starten</strong> kopiert <code>/usr/bin/next-exam-daemon.js</code> und
                            <code>/etc/systemd/system/next-exam.service</code> aus dem App-Paket, führt
                            <code>systemctl enable &amp;&amp; start</code> aus. Erfordert <code>/usr/bin/node</code>.
                        </p>
                    </div>
                </div>

                <div class="pc-card mt-3">
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
                    <div class="pc-card-header"><h6><i class="bi bi-shield-lock me-2" />Session lock</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            After unlocking with a password, the app locks again after inactivity (mouse, keyboard, scroll).
                        </p>
                        <label class="form-label small text-muted mt-2">Auto-lock after idle</label>
                        <select v-model.number="sessionPrefs.lockIdleMinutes" class="pc-input mb-3 mt-1" style="max-width:220px;">
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
                            Screen time and app quotas are enforced by the systemd daemon (no cron). The buttons below only prune old usage JSON or refresh related state.
                            <strong>Web filter restore</strong> rebuilds the <code>/etc/hosts</code> block from <code>webfilter.json</code>.
                            <strong>Usage logs</strong> removes <code>usage-*</code>, <code>quota-usage-*</code>, and <code>app-usage-*</code> JSON older than 120 days.
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
                                Disables screen time, clears app quotas,
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
import { reactive, ref, onMounted } from 'vue'
import { confirm } from '../composables/useConfirm.js'
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
const daemonServiceStatus = ref(null)
const daemonSocketConnected = ref(false)
const nodeVersion = ref(null)
const daemonRefreshing = ref(false)
const daemonCtrlBusy = ref(false)
const daemonCtrlMsg = ref('')
const daemonCtrlError = ref(false)

async function loadDaemonInfo() {
    daemonRefreshing.value = true
    const [result] = await Promise.allSettled([
        Promise.all([
            window.api.daemon.serviceControl({ action: 'status' }),
            window.api.daemon.isConnected(),
            window.api.daemon.nodeCheck()
        ]),
        new Promise(r => setTimeout(r, 600))
    ])
    if (result.status === 'fulfilled') {
        const [svc, connected, nodeCheck] = result.value
        daemonServiceStatus.value = svc?.status ?? null
        daemonSocketConnected.value = Boolean(connected)
        nodeVersion.value = nodeCheck?.ok ? nodeCheck.version : null
    } else {
        daemonServiceStatus.value = null
    }
    daemonRefreshing.value = false
}

async function onDaemonControl(action) {
    daemonCtrlMsg.value = ''
    daemonCtrlBusy.value = true
    const r = await window.api.daemon.serviceControl({ action })
    daemonCtrlBusy.value = false
    if (r?.error) {
        daemonCtrlMsg.value = r.error
        daemonCtrlError.value = true
    } else {
        daemonCtrlMsg.value = action === 'install' ? 'Daemon installiert und gestartet.' : `Service ${action} ausgeführt.`
        daemonCtrlError.value = false
        await loadDaemonInfo()
    }
    setTimeout(() => { daemonCtrlMsg.value = '' }, 6000)
}

onMounted(async () => {
    appInfo.value = await window.api.system.getAppInfo()
    const cfg = await window.api.settings.getConfig()
    sessionPrefs.lockIdleMinutes = normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes) ?? 15
    await loadDaemonInfo()
})

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
    if (!await confirm({ title: 'Stop all protections', message: 'Stop and remove ALL LiFE protections? This clears schedules (screen time off), quotas, blocks, web filter hosts block, quota exemptions, and KDE kiosk (if active — session will restart).', okLabel: 'Stop all', danger: true })) return
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
    if (!await confirm({ title: 'Delete all usage history', message: 'Delete ALL screen-time and app-usage daily log files (usage-*.json, quota-usage-*.json, app-usage-*.json)? This cannot be undone.', okLabel: 'Delete', danger: true })) return
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
    if (!await confirm({ title: 'Screen time cleanup', message: 'Prune old screen-time usage archives under /etc/life-parental/? (Enforcement runs in the LiFE app; there is no cron script to rewrite.)' })) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.schedules.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = 'Usage archive cleanup completed.'
        maintError.value = false
    }
}

async function onRedeployQuotaCron() {
    if (!await confirm({ title: 'App quota cleanup', message: 'Prune old quota usage archives under /etc/life-parental/? (Enforcement runs in the LiFE app.)' })) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.quota.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = 'Usage archive cleanup completed.'
        maintError.value = false
    }
}

async function onRedeployKillCron() {
    if (!await confirm({ title: 'Quota exemptions', message: 'Re-deploy /usr/local/bin/life-parental-quota from disk (pick up process-whitelist.json) and remove legacy life-parental-kill files if present?' })) return
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
    if (!await confirm({ title: 'Prune old usage logs', message: 'Delete usage-*.json, quota-usage-*.json, and app-usage-*.json in /etc/life-parental/ older than 120 days (by date in the filename)?', okLabel: 'Delete', danger: true })) return
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
    if (!await confirm({ title: 'Web filter restore', message: 'Restore web filter: rebuild the /etc/hosts block from /etc/life-parental/webfilter.json?' })) return
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
    if (!await confirm({ title: 'Import backup', message: 'Import from the selected backup? Only top-level sections present in the file are applied (/etc/hosts + mirror when webFilter is included; schedules, quotas, processWhitelist JSON when present). Omitted sections are left unchanged.' })) return
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

<style scoped>
@keyframes spin {
    to { transform: rotate(360deg); }
}
.spin {
    display: inline-block;
    animation: spin 0.7s linear infinite;
}
</style>
