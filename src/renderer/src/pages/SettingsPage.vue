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
                    <div class="pc-card-header"><h6><i class="bi bi-shield-lock me-2" />Session lock</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            After unlocking with a password, the app locks again after inactivity (mouse, keyboard, scroll).
                        </p>
                        <label class="form-label small text-muted">Auto-lock after idle</label>
                        <select v-model.number="sessionPrefs.lockIdleMinutes" class="pc-input mb-3" style="max-width:220px;">
                            <option :value="0">Off</option>
                            <option :value="5">5 minutes</option>
                            <option :value="15">15 minutes</option>
                            <option :value="30">30 minutes</option>
                            <option :value="60">60 minutes</option>
                        </select>
                        <p v-if="sessionPrefsMsg" class="small mb-2" :class="sessionPrefsError ? 'text-danger' : 'text-success'">{{ sessionPrefsMsg }}</p>
                        <button type="button" class="btn-pc-outline" @click="onSaveSessionPrefs">Save</button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-archive me-2" />Backup &amp; restore</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            Export or import a JSON bundle: only <strong>top-level keys present</strong> in the file are applied; omitted keys leave the system unchanged. For <code>webFilter</code>, <code>blockedApps</code>, and <code>quotas</code>, a missing <code>entries</code> array or a non-array value clears that section (same as <code>[]</code>). Screen time, web filter (<code>/etc/hosts</code> + mirror), blocked <code>.desktop</code> ids, app quotas (<code>quota.json</code> + cron), life modes (<code>lifeModes: null</code> removes <code>life-modes.json</code>), session lock (<code>lockIdleMinutes</code>). Password and usage history are <strong>not</strong> included.
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
                            Re-deploy cron jobs from JSON on disk (after app updates) — same as <strong>Screen Time</strong> /
                            <strong>App Control</strong> “Rewrite”. <strong>Web filter</strong> rewrites the LiFE
                            <code>/etc/hosts</code> block from <code>webfilter.json</code> (e.g. hosts edited by hand).
                            <strong>Usage logs</strong> removes <code>usage-*</code> and <code>quota-usage-*</code> JSON older than 120 days (same rule as automatic cleanup).
                        </p>
                        <div class="d-flex flex-wrap gap-2">
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployScheduleCron">
                                <i class="bi bi-arrow-repeat me-1" />Screen time
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployQuotaCron">
                                <i class="bi bi-arrow-repeat me-1" />App quotas
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onReapplyWebHosts">
                                <i class="bi bi-arrow-repeat me-1" />Web filter hosts
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
                            <div><span class="text-muted" style="min-width:120px;display:inline-block;">Running as</span> root</div>
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
                    <div class="pc-card-body d-flex flex-column gap-2">
                        <button class="btn-pc-danger" @click="onExit">
                            <i class="bi bi-box-arrow-right me-1" />Exit Application
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
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

onMounted(async () => {
    appInfo.value = await window.api.system.getAppInfo()
    const cfg = await window.api.settings.getConfig()
    const m = Number(cfg.lockIdleMinutes)
    sessionPrefs.lockIdleMinutes = Number.isFinite(m) && m >= 0 && [0, 5, 15, 30, 60].includes(m)
        ? m
        : 15
})

async function onSaveSessionPrefs() {
    sessionPrefsMsg.value = ''
    const minutes = Math.max(0, Math.min(120, Number(sessionPrefs.lockIdleMinutes) || 0))
    sessionPrefs.lockIdleMinutes = [0, 5, 15, 30, 60].includes(minutes) ? minutes : 15
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

function onExit() {
    window.api.system.quit()
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

async function onPruneUsageArchives() {
    if (!window.confirm(
        'Delete usage-*.json and quota-usage-*.json in /etc/life-parental/ older than 120 days (by date in the filename)?'
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
    if (!window.confirm('Rewrite the LiFE block in /etc/hosts from /etc/life-parental/webfilter.json?')) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.webFilter.reapplyMirror()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        await appStore.loadWebFilter()
        maintMsg.value = 'Web filter hosts block updated from webfilter.json.'
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
        'Import from the selected backup? Only top-level sections present in the file are applied (/etc/hosts + mirror when webFilter is included; cron when schedules/quotas change). Omitted sections are left unchanged.'
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
        const m = Number(cfg.lockIdleMinutes)
        sessionPrefs.lockIdleMinutes = Number.isFinite(m) && m >= 0 && [0, 5, 15, 30, 60].includes(m)
            ? m
            : sessionPrefs.lockIdleMinutes
        window.dispatchEvent(new CustomEvent('life-parental-lock-prefs'))
        backupMsg.value = 'Import completed. Protection state refreshed (open Dashboard to reload family profile buttons).'
        backupError.value = false
    }
}
</script>
