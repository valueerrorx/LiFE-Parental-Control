<template>
    <div class="pc-page-header">
        <h1>{{ $t('settings.title') }}</h1>
        <p>{{ $t('settings.subtitle') }}</p>
    </div>

    <div class="pc-content">
        <div class="row g-3">
            <!-- Daemon + Password + Session + Backup + Maintenance -->
            <div class="col-6">
                <div class="pc-card">
                    <div class="pc-card-header"><h6><i class="bi bi-cpu me-2" />{{ $t('settings.systemdDaemon') }}</h6></div>
                    <div class="pc-card-body">
                        <div class="d-flex flex-wrap align-items-center gap-3 mb-3">
                            <div>
                                <div class="small text-muted mb-1">{{ $t('settings.service') }}</div>
                                <span class="status-badge" :class="daemonServiceStatus === 'active' ? 'active' : 'inactive'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ daemonServiceStatus ?? $t('common.unknown') }}
                                </span>
                            </div>
                            <div>
                                <div class="small text-muted mb-1">{{ $t('settings.socket') }}</div>
                                <span class="status-badge" :class="daemonSocketConnected ? 'active' : 'inactive'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ daemonSocketConnected ? $t('settings.connected') : $t('settings.disconnected') }}
                                </span>
                            </div>
                            <div>
                                <div class="small text-muted mb-1">{{ $t('settings.nodeJs') }}</div>
                                <span class="status-badge" :class="nodeVersion ? 'active' : 'warning'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ nodeVersion ?? $t('settings.notFound') }}
                                </span>
                            </div>
                            <button type="button" class="btn-pc-outline ms-auto" style="font-size:12px;" :disabled="daemonRefreshing" @click="loadDaemonInfo">
                                <i class="bi bi-arrow-repeat me-1" :class="{ 'spin': daemonRefreshing }" />{{ $t('settings.refresh') }}
                            </button>
                        </div>
                        <p v-if="!nodeVersion" class="small text-danger mb-3" v-html="$t('settings.nodeNotFound')" />
                        <div class="d-flex flex-wrap gap-2 mb-3">
                            <button type="button" class="btn-pc-primary" :disabled="daemonCtrlBusy" @click="onDaemonControl('install')" :title="$t('settings.installAndStart')">
                                <i class="bi bi-download me-1" />{{ $t('settings.installAndStart') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="daemonCtrlBusy" @click="onDaemonControl('start')">
                                <i class="bi bi-play me-1" />{{ $t('settings.start') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="daemonCtrlBusy" @click="onDaemonControl('stop')">
                                <i class="bi bi-stop me-1" />{{ $t('settings.stop') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="daemonCtrlBusy" @click="onDaemonControl('restart')">
                                <i class="bi bi-arrow-repeat me-1" />{{ $t('settings.restart') }}
                            </button>
                        </div>
                        <p v-if="daemonCtrlMsg" class="small mb-2" :class="daemonCtrlError ? 'text-danger' : 'text-success'">{{ daemonCtrlMsg }}</p>
                        <p class="text-muted small mb-0" v-html="$t('settings.installDesc')" />
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header">
                        <h6><i class="bi bi-key me-2" />{{ $t('settings.changePassword') }}</h6>
                    </div>
                    <div class="pc-card-body">
                        <div class="mb-3">
                            <label class="form-label small text-muted">{{ $t('settings.currentPassword') }}</label>
                            <input v-model="changePw.current" type="password" class="pc-input" :placeholder="$t('settings.currentPasswordPlaceholder')" />
                        </div>
                        <div class="mb-3">
                            <label class="form-label small text-muted">{{ $t('settings.newPassword') }}</label>
                            <input v-model="changePw.new1" type="password" class="pc-input" :placeholder="$t('settings.newPasswordPlaceholder')" />
                        </div>
                        <div class="mb-3">
                            <label class="form-label small text-muted">{{ $t('settings.confirmNewPassword') }}</label>
                            <input v-model="changePw.new2" type="password" class="pc-input" :placeholder="$t('settings.repeatPasswordPlaceholder')" />
                        </div>
                        <p v-if="pwMsg" :class="pwError ? 'text-danger' : 'text-success'" class="small">{{ pwMsg }}</p>
                        <button class="btn-pc-primary" @click="onChangePassword">{{ $t('settings.updatePassword') }}</button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-shield-lock me-2" />{{ $t('settings.sessionLock') }}</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            {{ $t('settings.sessionLockHint') }}
                        </p>
                        <label class="form-label small text-muted mt-2">{{ $t('settings.autoLockAfterIdle') }}</label>
                        <select v-model.number="sessionPrefs.lockIdleMinutes" class="pc-input mb-3 mt-1" style="max-width:220px;">
                            <option v-for="opt in LOCK_IDLE_OPTIONS" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </option>
                        </select>
                        <p v-if="sessionPrefsMsg" class="small mb-2" :class="sessionPrefsError ? 'text-danger' : 'text-success'">{{ sessionPrefsMsg }}</p>
                        <button type="button" class="btn-pc-outline" @click="onSaveSessionPrefs">{{ $t('common.save') }}</button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-archive me-2" />{{ $t('settings.backupRestore') }}</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3" v-html="$t('settings.backupDesc')" />
                        <div class="d-flex flex-wrap gap-2">
                            <button type="button" class="btn-pc-outline" :disabled="backupBusy" @click="onBackupExport">
                                <i class="bi bi-download me-1" />{{ $t('settings.exportBtn') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="backupBusy" @click="onBackupImport">
                                <i class="bi bi-upload me-1" />{{ $t('settings.importBtn') }}
                            </button>
                        </div>
                        <p v-if="backupMsg" class="small mt-2 mb-0" :class="backupError ? 'text-danger' : 'text-success'">{{ backupMsg }}</p>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-wrench-adjustable me-2" />{{ $t('settings.maintenance') }}</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3" v-html="$t('settings.maintenanceDesc')" />
                        <div class="d-flex flex-wrap gap-2">
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployScheduleCron">
                                <i class="bi bi-arrow-repeat me-1" />{{ $t('settings.screenTime') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployQuotaCron">
                                <i class="bi bi-arrow-repeat me-1" />{{ $t('settings.appQuotas') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onReapplyWebHosts">
                                <i class="bi bi-arrow-repeat me-1" />{{ $t('settings.webFilterRestore') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onRedeployKillCron">
                                <i class="bi bi-arrow-repeat me-1" />{{ $t('settings.quotaExemptions') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onPruneUsageArchives">
                                <i class="bi bi-trash me-1" />{{ $t('settings.usageLogsOld') }}
                            </button>
                        </div>
                        <p v-if="maintMsg" class="small mt-2 mb-0" :class="maintError ? 'text-danger' : 'text-success'">{{ maintMsg }}</p>
                    </div>
                </div>
            </div>

            <!-- About + danger zone -->
            <div class="col-6">
                <div class="pc-card mb-3">
                    <div class="pc-card-header"><h6><i class="bi bi-info-circle me-2" />{{ $t('settings.about') }}</h6></div>
                    <div class="pc-card-body">
                        <div class="d-flex flex-column gap-1" style="font-size:13px;">
                            <div>
                                <span class="text-muted" style="min-width:120px;display:inline-block;">{{ $t('settings.application') }}</span>
                                {{ appInfo?.name || 'LiFE Parental Control' }}
                            </div>
                            <div>
                                <span class="text-muted" style="min-width:120px;display:inline-block;">{{ $t('settings.version') }}</span>
                                {{ appInfo?.version ?? '—' }}
                                <span v-if="appInfo && !appInfo.packaged" class="text-muted small ms-1">{{ $t('settings.devLabel') }}</span>
                            </div>
                            <div><span class="text-muted" style="min-width:120px;display:inline-block;">{{ $t('settings.runtime') }}</span> Electron {{ appInfo?.electron ?? '—' }}, Node {{ appInfo?.node ?? '—' }}</div>
                            <div><span class="text-muted" style="min-width:120px;display:inline-block;">{{ $t('settings.platform') }}</span> {{ $t('settings.platformLabel') }}</div>
                            <div><span class="text-muted" style="min-width:120px;display:inline-block;">{{ $t('settings.configDirectory') }}</span> <code>/etc/life-parental/</code></div>
                            <div>
                                <span class="text-muted" style="min-width:120px;display:inline-block;">{{ $t('settings.runningAs') }}</span>
                                <template v-if="appInfo?.runningAsRoot === true">{{ $t('settings.rootUser') }}</template>
                                <template v-else-if="appInfo?.runningAsRoot === false">
                                    <span class="text-warning" v-html="$t('settings.regularUserWarning')" />
                                </template>
                                <template v-else>—</template>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="pc-card mb-3">
                    <div class="pc-card-header"><h6><i class="bi bi-sliders me-2" />{{ $t('settings.customFamilyProfiles') }}</h6></div>
                    <div class="pc-card-body text-muted" style="font-size:12px;line-height:1.65;">
                        <p class="mb-2" v-html="$t('settings.customFamilyDesc')" />
                        <p class="mb-2 small" v-html="$t('settings.customFamilyFields')" />
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
                        <h6 style="color:#C62828;"><i class="bi bi-exclamation-triangle me-2" />{{ $t('settings.dangerZone') }}</h6>
                    </div>
                    <div class="pc-card-body d-flex flex-column gap-3">
                        <p class="text-muted small mb-0" v-html="$t('settings.dangerZoneDesc')" />
                        <div>
                            <div class="fw-semibold mb-1" style="font-size:13px;">{{ $t('settings.stopAllRestrictions') }}</div>
                            <p class="text-muted small mb-2" v-html="$t('settings.stopAllDesc')" />
                            <button type="button" class="btn-pc-danger" :disabled="dangerBusy" @click="onStopAllProtections">
                                <i class="bi bi-slash-circle me-1" />{{ $t('settings.stopAllProtections') }}
                            </button>
                        </div>
                        <div class="pt-2 border-top" style="border-color:#FFCDD2;">
                            <div class="fw-semibold mb-1" style="font-size:13px;">{{ $t('settings.deleteAllUsageHistory') }}</div>
                            <p class="text-muted small mb-2" v-html="$t('settings.deleteAllUsageDesc')" />
                            <button type="button" class="btn-pc-danger" :disabled="dangerBusy" @click="onDeleteAllUsageHistory">
                                <i class="bi bi-trash3 me-1" />{{ $t('settings.deleteAllUsageBtn') }}
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
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import { normalizedLockIdleMinutesOrUndefined, LOCK_IDLE_OPTIONS } from '@shared/lockIdleMinutes.js'
import { useAppStore } from '../stores/appStore.js'

const { t } = useI18n()
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
        daemonCtrlMsg.value = action === 'install'
            ? t('settings.daemonInstalled')
            : t('settings.serviceAction', { action })
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
        sessionPrefsMsg.value = t('settings.savePrefsSaved')
        sessionPrefsError.value = false
        window.dispatchEvent(new CustomEvent('life-parental-lock-prefs'))
    } catch (e) {
        sessionPrefsMsg.value = e?.message || t('settings.saveFailed')
        sessionPrefsError.value = true
    }
    setTimeout(() => { sessionPrefsMsg.value = '' }, 5000)
}

async function onChangePassword() {
    pwMsg.value = ''
    if (!changePw.new1) { pwMsg.value = t('settings.newPasswordEmpty'); pwError.value = true; return }
    if (changePw.new1 !== changePw.new2) { pwMsg.value = t('settings.passwordMismatch'); pwError.value = true; return }
    const result = await window.api.settings.changePassword(changePw.current, changePw.new1)
    if (result?.error) {
        pwMsg.value = result.error; pwError.value = true
    } else {
        pwMsg.value = t('settings.passwordUpdated'); pwError.value = false
        changePw.current = changePw.new1 = changePw.new2 = ''
    }
}

async function onStopAllProtections() {
    if (!await confirm({ title: t('settings.stopAllConfirmTitle'), message: t('settings.stopAllConfirmMsg'), okLabel: t('settings.stopAllLabel'), danger: true })) return
    dangerBusy.value = true
    dangerMsg.value = ''
    const r = await window.api.settings.stopAllProtections()
    dangerBusy.value = false
    if (r?.error) {
        dangerMsg.value = r.error
        dangerError.value = true
    } else {
        dangerMsg.value = t('settings.allProtectionsRemoved')
        dangerError.value = false
        await appStore.refreshProtectionsState()
    }
    setTimeout(() => { dangerMsg.value = '' }, 8000)
}

async function onDeleteAllUsageHistory() {
    if (!await confirm({ title: t('settings.deleteHistoryConfirmTitle'), message: t('settings.deleteHistoryConfirmMsg'), okLabel: t('settings.deleteLabel'), danger: true })) return
    dangerBusy.value = true
    dangerMsg.value = ''
    const r = await window.api.settings.deleteAllUsageHistory()
    dangerBusy.value = false
    if (r?.error) {
        dangerMsg.value = r.error
        dangerError.value = true
    } else {
        dangerMsg.value = t('settings.removedLogFiles', { count: r?.removed ?? 0 })
        dangerError.value = false
        await appStore.refreshProtectionsState()
    }
    setTimeout(() => { dangerMsg.value = '' }, 8000)
}

async function onRedeployScheduleCron() {
    if (!await confirm({ title: t('settings.screenTimeCleanupTitle'), message: t('settings.screenTimeCleanupMsg') })) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.schedules.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = t('settings.usageArchiveCleanup')
        maintError.value = false
    }
}

async function onRedeployQuotaCron() {
    if (!await confirm({ title: t('settings.appQuotaCleanupTitle'), message: t('settings.appQuotaCleanupMsg') })) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.quota.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = t('settings.usageArchiveCleanup')
        maintError.value = false
    }
}

async function onRedeployKillCron() {
    if (!await confirm({ title: t('settings.quotaExemptionsTitle'), message: t('settings.quotaExemptionsMsg') })) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.processWhitelist.redeploy()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = t('settings.quotaScriptRedeployed')
        maintError.value = false
    }
}

async function onPruneUsageArchives() {
    if (!await confirm({ title: t('settings.pruneLogsTitle'), message: t('settings.pruneLogsMsg'), okLabel: t('settings.deleteLabel'), danger: true })) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.settings.pruneUsageArchives()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        maintMsg.value = t('settings.removedOldFiles', { count: r?.removed ?? 0 })
        maintError.value = false
    }
}

async function onReapplyWebHosts() {
    if (!await confirm({ title: t('settings.webFilterRestoreTitle'), message: t('settings.webFilterRestoreMsg') })) return
    maintBusy.value = true
    maintMsg.value = ''
    const r = await window.api.webFilter.reapplyMirror()
    maintBusy.value = false
    if (r?.error) {
        maintMsg.value = r.error
        maintError.value = true
    } else {
        await appStore.loadWebFilter()
        maintMsg.value = t('settings.webFilterRestored')
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
        backupMsg.value = t('settings.savedPath', { path: r.path })
        backupError.value = false
    }
}

async function onBackupImport() {
    backupMsg.value = ''
    if (!await confirm({ title: t('settings.importConfirmTitle'), message: t('settings.importConfirmMsg') })) return
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
        backupMsg.value = t('settings.importCompleted')
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
