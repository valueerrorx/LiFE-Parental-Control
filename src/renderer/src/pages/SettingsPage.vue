<template>
    <div class="pc-page-header">
        <h1>{{ $t('settings.title') }}</h1>
        <p>{{ $t('settings.subtitle') }}</p>
    </div>

    <div class="pc-content">
        <div class="row g-3">
            <!-- School times + parent password + lockdown + session + maintenance/backup -->
            <div class="col-6">
                <div class="pc-card">
                    <div class="pc-card-header"><h6><i class="bi bi-mortarboard me-2" />{{ $t('settings.schoolTimesTitle') }}</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">{{ $t('settings.schoolTimesHint') }}</p>
                        <div v-for="key in schoolTimeKeys" :key="key" class="school-times-row">
                            <span class="small text-muted school-times-day">{{ $t(`settings.schoolDay_${key}`) }}</span>
                            <span class="school-times-pair">
                                <input v-model="schoolTimes[key].from" type="text" class="pc-input school-time-input" maxlength="5" inputmode="numeric" autocomplete="off"
                                       :placeholder="$t('settings.schoolTimesPlaceholder')" @blur="onSchoolTimeBlur(key, 'from')" />
                                <span class="text-muted small school-times-sep">–</span>
                                <input v-model="schoolTimes[key].to" type="text" class="pc-input school-time-input" maxlength="5" inputmode="numeric" autocomplete="off"
                                       :placeholder="$t('settings.schoolTimesPlaceholder')" @blur="onSchoolTimeBlur(key, 'to')" />
                            </span>
                        </div>
                        <p v-if="schoolTimesMsg" class="small mb-2 mt-2" :class="schoolTimesError ? 'text-danger' : 'text-success'">{{ schoolTimesMsg }}</p>
                        <button type="button" class="btn-pc-outline" @click="onSaveSchoolTimes">{{ $t('common.save') }}</button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header">
                        <h6><i class="bi bi-key me-2" />{{ $t('settings.changePassword') }}</h6>
                    </div>
                    <div class="pc-card-body">
                        <div class="mb-3">
                            <label class="form-label small text-muted" for="settings-pw-current">{{ $t('settings.currentPassword') }}</label>
                            <div class="pc-pw-wrap">
                                <input id="settings-pw-current" v-model="changePw.current"
                                       :type="showPwCurrent ? 'text' : 'password'" class="pc-input"
                                       :placeholder="$t('settings.currentPasswordPlaceholder')" autocomplete="current-password" />
                                <button type="button" class="pc-pw-toggle"
                                        :aria-label="showPwCurrent ? $t('common.hidePassword') : $t('common.showPassword')"
                                        :aria-pressed="showPwCurrent" @click="showPwCurrent = !showPwCurrent">
                                    <i :class="showPwCurrent ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label small text-muted" for="settings-pw-new1">{{ $t('settings.newPassword') }}</label>
                            <div class="pc-pw-wrap">
                                <input id="settings-pw-new1" v-model="changePw.new1"
                                       :type="showPwNew1 ? 'text' : 'password'" class="pc-input"
                                       :placeholder="$t('settings.newPasswordPlaceholder')" autocomplete="new-password" />
                                <button type="button" class="pc-pw-toggle"
                                        :aria-label="showPwNew1 ? $t('common.hidePassword') : $t('common.showPassword')"
                                        :aria-pressed="showPwNew1" @click="showPwNew1 = !showPwNew1">
                                    <i :class="showPwNew1 ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label small text-muted" for="settings-pw-new2">{{ $t('settings.confirmNewPassword') }}</label>
                            <div class="pc-pw-wrap">
                                <input id="settings-pw-new2" v-model="changePw.new2"
                                       :type="showPwNew2 ? 'text' : 'password'" class="pc-input"
                                       :placeholder="$t('settings.repeatPasswordPlaceholder')" autocomplete="new-password" />
                                <button type="button" class="pc-pw-toggle"
                                        :aria-label="showPwNew2 ? $t('common.hidePassword') : $t('common.showPassword')"
                                        :aria-pressed="showPwNew2" @click="showPwNew2 = !showPwNew2">
                                    <i :class="showPwNew2 ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                        <p v-if="pwMsg" :class="pwError ? 'text-danger' : 'text-success'" class="small">{{ pwMsg }}</p>
                        <button class="btn-pc-primary" @click="onChangePassword">{{ $t('settings.updatePassword') }}</button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header">
                        <h6><i class="bi bi-shield-exclamation me-2" />{{ $t('lockdown.title') }}</h6>
                    </div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-2">{{ $t('settings.lockdownIntroLead') }}</p>
                        <p class="text-muted small mb-3">{{ $t('settings.lockdownIntroSystem') }}</p>
                        <button type="button" class="btn btn-success" @click="appStore.showLockdownWizard = true">
                            <i class="bi bi-shield-lock me-1" />{{ $t('settings.runLockdownWizard') }}
                        </button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6><i class="bi bi-shield-lock me-2" />{{ $t('settings.sessionLock') }}</h6></div>
                    <div class="pc-card-body">
                        <p class="text-muted small mb-3">
                            {{ $t('settings.sessionLockHint') }}
                        </p>
                        <label class="form-label small text-muted session-lock-field-label">{{ $t('settings.autoLockAfterIdle') }}</label>
                        <select v-model.number="sessionPrefs.lockIdleMinutes" class="pc-input mb-3 session-lock-field-input" style="max-width:220px;">
                            <option v-for="opt in LOCK_IDLE_OPTIONS" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </option>
                        </select>
                        <p v-if="sessionPrefsMsg" class="small mb-2" :class="sessionPrefsError ? 'text-danger' : 'text-success'">{{ sessionPrefsMsg }}</p>
                        <button type="button" class="btn-pc-outline" @click="onSaveSessionPrefs">{{ $t('common.save') }}</button>
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
                            <button type="button" class="btn-pc-outline" :disabled="maintBusy" @click="onPruneUsageArchives">
                                <i class="bi bi-trash me-1" />{{ $t('settings.usageLogsOld') }}
                            </button>
                        </div>
                        <p v-if="maintMsg" class="small mt-2 mb-0" :class="maintError ? 'text-danger' : 'text-success'">{{ maintMsg }}</p>

                        <hr class="my-3" />

                        <div class="fw-semibold mb-2" style="font-size:13px;"><i class="bi bi-archive me-1" />{{ $t('settings.backupRestore') }}</div>
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

            </div>

            <!-- About + systemd daemon + grub + danger zone -->
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
                                {{ appInfo?.invokingLinuxUser || '—' }}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="pc-card mb-3">
                    <div class="pc-card-header"><h6><i class="bi bi-cpu me-2" />{{ $t('settings.systemdDaemon') }}</h6></div>
                    <div class="pc-card-body">
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
                            <button type="button" class="btn-pc-outline" :disabled="warningTestBusy" @click="onQueueDaemonWarningTest">
                                <i class="bi bi-window-stack me-1" />{{ $t('settings.warningTestBtn') }}
                            </button>
                        </div>
                        <p v-if="warningTestMsg" class="small mb-2" :class="warningTestError ? 'text-danger' : 'text-muted'">{{ warningTestMsg }}</p>
                        <p v-if="daemonCtrlMsg" class="small mb-2" :class="daemonCtrlError ? 'text-danger' : 'text-success'">{{ daemonCtrlMsg }}</p>
                        <p class="text-muted small mb-0" v-html="$t('settings.installDesc')" />

                        <hr class="my-3" />

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
                                <span class="status-badge" :class="nodeVersionOk ? 'active' : 'warning'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ nodeVersion ?? $t('settings.notFound') }}
                                </span>
                            </div>
                            <div>
                                <div class="small text-muted mb-1">{{ $t('settings.dnsmasq') }}</div>
                                <span class="status-badge" :class="dnsmasqOk ? 'active' : 'warning'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ dnsmasqVersion ?? $t('settings.notFound') }}
                                </span>
                            </div>
                            <button type="button" class="btn-pc-outline ms-auto" style="font-size:12px;" :disabled="daemonRefreshing" @click="loadDaemonInfo">
                                <i class="bi bi-arrow-repeat me-1" :class="{ 'spin': daemonRefreshing }" />{{ $t('settings.refresh') }}
                            </button>
                        </div>

                        <p v-if="nodeCheckReason === 'missing'" class="small text-danger mb-3" v-html="$t('settings.nodeNotFound')" />
                        <p v-else-if="nodeCheckReason === 'too_old'" class="small text-warning mb-3">{{ $t('settings.nodeTooOld') }}</p>
                        <p v-if="!dnsmasqOk" class="small text-warning mb-3" v-html="$t(`settings.dnsmasq_${dnsmasqReason}`)" />
                        <div v-if="!dnsmasqOk && dnsmasqReason === 'not_running'" class="border-top pt-3 mt-1 mb-3">
                            <div class="small text-muted mb-2" v-html="$t('settings.dnsmasqSetupHint')" />
                            <button type="button" class="btn-pc-primary" :disabled="dnsmasqSetupBusy" @click="onSetupDnsmasq">
                                <i class="bi bi-arrow-repeat me-1" :class="{ 'spin': dnsmasqSetupBusy }" />{{ $t('settings.dnsmasqSetupBtn') }}
                            </button>
                        </div>
                        <p v-if="dnsmasqSetupMsg" class="small mb-0 mt-2" :class="dnsmasqSetupError ? 'text-danger' : 'text-success'">{{ dnsmasqSetupMsg }}</p>
                    </div>
                </div>

                <div class="pc-card mb-3">
                    <div class="pc-card-header"><h6><i class="bi bi-hdd-rack me-2" />{{ $t('settings.grub') }}</h6></div>
                    <div class="pc-card-body">
                        <div class="d-flex flex-wrap align-items-center gap-3 mb-3">
                            <div>
                                <div class="small text-muted mb-1">{{ $t('settings.grubPassword') }}</div>
                                <span class="status-badge" :class="grubPasswordActive ? 'active' : 'inactive'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ grubPasswordActive ? $t('common.active') : $t('common.inactive') }}
                                </span>
                            </div>
                            <div>
                                <div class="small text-muted mb-1">{{ $t('settings.grubUnrestricted') }}</div>
                                <span class="status-badge" :class="grubUnrestricted ? 'active' : 'warning'">
                                    <i class="bi bi-circle-fill" style="font-size:7px;" />
                                    {{ grubUnrestricted ? $t('common.active') : $t('settings.notFound') }}
                                </span>
                            </div>
                            <button type="button" class="btn-pc-outline ms-auto" style="font-size:12px;" :disabled="grubRefreshing" @click="loadGrubInfo">
                                <i class="bi bi-arrow-repeat me-1" :class="{ 'spin': grubRefreshing }" />{{ $t('settings.refresh') }}
                            </button>
                        </div>
                        <p v-if="grubPasswordActive && !grubUnrestricted" class="small text-warning mb-3" v-html="$t('settings.grubUnrestrictedHint')" />
                        <p class="text-muted small mb-3" v-html="$t('settings.grubDesc')" />
                        <div class="mb-3">
                            <label class="form-label small text-muted" for="settings-grub-pw">{{ $t('settings.grubPasswordLabel') }}</label>
                            <div class="pc-pw-wrap">
                                <input id="settings-grub-pw" v-model="grubPassword"
                                       :type="showGrubPw ? 'text' : 'password'" class="pc-input"
                                       :placeholder="$t('settings.grubPasswordPlaceholder')" autocomplete="new-password" />
                                <button type="button" class="pc-pw-toggle"
                                        :aria-label="showGrubPw ? $t('common.hidePassword') : $t('common.showPassword')"
                                        :aria-pressed="showGrubPw" @click="showGrubPw = !showGrubPw">
                                    <i :class="showGrubPw ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                        <div class="d-flex flex-wrap gap-2">
                            <button type="button" class="btn-pc-primary" :disabled="grubBusy || !grubPassword" @click="onGrubEnable">
                                <i class="bi bi-lock me-1" />{{ $t('settings.grubEnable') }}
                            </button>
                            <button type="button" class="btn-pc-outline" :disabled="grubBusy || !grubPasswordActive" @click="onGrubDisable">
                                <i class="bi bi-lock-open me-1" />{{ $t('settings.grubDisable') }}
                            </button>
                        </div>
                        <p v-if="grubMsg" class="small mt-2 mb-0" :class="grubError ? 'text-danger' : 'text-success'">{{ grubMsg }}</p>
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
import { SCHOOL_TIME_WEEKDAY_KEYS, defaultSchoolTimes, normalizeTimeHHMM, normalizeSchoolTimes } from '@shared/schoolTimes.js'
import { normalizedLockIdleMinutesOrUndefined, LOCK_IDLE_OPTIONS, DEFAULT_LOCK_IDLE_MINUTES } from '@shared/lockIdleMinutes.js'
import { useAppStore } from '../stores/appStore.js'

const { t } = useI18n()
const appStore = useAppStore()
const appInfo = ref(null)
const sessionPrefs = reactive({ lockIdleMinutes: DEFAULT_LOCK_IDLE_MINUTES })
const sessionPrefsMsg = ref('')
const sessionPrefsError = ref(false)
const schoolTimeKeys = SCHOOL_TIME_WEEKDAY_KEYS
const schoolTimes = reactive(defaultSchoolTimes())
const schoolTimesMsg = ref('')
const schoolTimesError = ref(false)

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

const grubPasswordActive = ref(false)
const grubUnrestricted = ref(false)
const grubRefreshing = ref(false)
const grubBusy = ref(false)
const grubMsg = ref('')
const grubError = ref(false)
const grubPassword = ref('')
const showPwCurrent = ref(false)
const showPwNew1 = ref(false)
const showPwNew2 = ref(false)
const showGrubPw = ref(false)

const daemonServiceStatus = ref(null)
const daemonSocketConnected = ref(false)
const nodeVersion = ref(null)
const nodeVersionOk = ref(false)
const nodeCheckReason = ref('')
const nodeRequiredVersion = ref('>=22.22.0')
const dnsmasqOk = ref(false)
const dnsmasqVersion = ref(null)
const dnsmasqReason = ref('not_installed')
const dnsmasqSetupBusy = ref(false)
const dnsmasqSetupMsg = ref('')
const dnsmasqSetupError = ref(false)
const daemonRefreshing = ref(false)
const daemonCtrlBusy = ref(false)
const daemonCtrlMsg = ref('')
const daemonCtrlError = ref(false)
const warningTestBusy = ref(false)
const warningTestMsg = ref('')
const warningTestError = ref(false)

async function loadDaemonInfo() {
    daemonRefreshing.value = true
    const [result] = await Promise.allSettled([
        Promise.all([
            window.api.daemon.serviceControl({ action: 'status' }),
            window.api.daemon.isConnected(),
            window.api.daemon.nodeCheck(),
            window.api.daemon.dnsmasqCheck()
        ]),
        new Promise(r => setTimeout(r, 600))
    ])
    if (result.status === 'fulfilled') {
        const [svc, connected, nodeCheck, dnsmasqCheck] = result.value
        daemonServiceStatus.value = svc?.status ?? null
        daemonSocketConnected.value = Boolean(connected)
        nodeVersion.value = nodeCheck?.version ?? null
        nodeVersionOk.value = nodeCheck?.ok === true
        nodeCheckReason.value = nodeCheck?.reason ?? ''
        nodeRequiredVersion.value = nodeCheck?.required ?? '>=22.22.0'
        dnsmasqOk.value = dnsmasqCheck?.ok === true
        dnsmasqVersion.value = dnsmasqCheck?.version ?? null
        dnsmasqReason.value = dnsmasqCheck?.reason ?? (dnsmasqOk.value ? 'ok' : 'not_installed')
    } else {
        daemonServiceStatus.value = null
        nodeVersion.value = null
        nodeVersionOk.value = false
        nodeCheckReason.value = 'missing'
        dnsmasqOk.value = false
        dnsmasqVersion.value = null
        dnsmasqReason.value = 'not_installed'
    }
    daemonRefreshing.value = false
}

async function onSetupDnsmasq() {
    dnsmasqSetupMsg.value = ''
    dnsmasqSetupError.value = false
    dnsmasqSetupBusy.value = true
    const r = await window.api.daemon.setupDnsmasq()
    dnsmasqSetupBusy.value = false
    if (r?.ok) {
        dnsmasqSetupMsg.value = t('settings.dnsmasqSetupOk')
        dnsmasqSetupError.value = false
        await loadDaemonInfo()
    } else {
        dnsmasqSetupMsg.value = r?.error || t('settings.dnsmasqSetupFailed')
        dnsmasqSetupError.value = true
    }
    setTimeout(() => { dnsmasqSetupMsg.value = '' }, 8000)
}

async function loadGrubInfo() {
    grubRefreshing.value = true
    const r = await window.api.daemon.grubCheck()
    grubPasswordActive.value = r?.passwordActive === true
    grubUnrestricted.value = r?.unrestricted === true
    grubRefreshing.value = false
}

async function onGrubEnable() {
    grubMsg.value = ''
    grubError.value = false
    grubBusy.value = true
    const r = await window.api.daemon.grubEnable(grubPassword.value)
    grubPassword.value = ''
    showGrubPw.value = false
    grubBusy.value = false
    if (r?.ok) {
        grubMsg.value = t('settings.grubEnableOk')
        grubError.value = false
        await loadGrubInfo()
    } else {
        grubMsg.value = r?.error || t('settings.grubFailed')
        grubError.value = true
    }
    setTimeout(() => { grubMsg.value = '' }, 8000)
}

async function onGrubDisable() {
    grubMsg.value = ''
    grubError.value = false
    grubBusy.value = true
    const r = await window.api.daemon.grubDisable()
    grubBusy.value = false
    if (r?.ok) {
        grubMsg.value = t('settings.grubDisableOk')
        grubError.value = false
        await loadGrubInfo()
    } else {
        grubMsg.value = r?.error || t('settings.grubFailed')
        grubError.value = true
    }
    setTimeout(() => { grubMsg.value = '' }, 8000)
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

async function onQueueDaemonWarningTest() {
    warningTestMsg.value = ''
    warningTestError.value = false
    warningTestBusy.value = true
    const r = await window.api.settings.queueDaemonWarningTest()
    warningTestBusy.value = false
    if (r?.error) {
        warningTestMsg.value = r.error
        warningTestError.value = true
    } else {
        warningTestMsg.value = t('settings.warningTestQueued')
    }
    setTimeout(() => { warningTestMsg.value = '' }, 12000)
}

onMounted(async () => {
    appInfo.value = await window.api.system.getAppInfo()
    const cfg = await window.api.settings.getConfig()
    sessionPrefs.lockIdleMinutes = normalizedLockIdleMinutesOrUndefined(cfg.lockIdleMinutes) ?? DEFAULT_LOCK_IDLE_MINUTES
    const st = await window.api.settings.getSchoolTimes()
    for (const k of SCHOOL_TIME_WEEKDAY_KEYS) {
        schoolTimes[k].from = st[k].from
        schoolTimes[k].to = st[k].to
    }
    await loadDaemonInfo()
    await loadGrubInfo()
})

async function onSaveSessionPrefs() {
    sessionPrefsMsg.value = ''
    const minutes = Number(sessionPrefs.lockIdleMinutes)
    sessionPrefs.lockIdleMinutes = normalizedLockIdleMinutesOrUndefined(minutes) ?? DEFAULT_LOCK_IDLE_MINUTES
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

function onSchoolTimeBlur(dayKey, field) {
    const fb = defaultSchoolTimes()[dayKey][field]
    schoolTimes[dayKey][field] = normalizeTimeHHMM(schoolTimes[dayKey][field], fb)
}

async function onSaveSchoolTimes() {
    schoolTimesMsg.value = ''
    try {
        const normalized = normalizeSchoolTimes(JSON.parse(JSON.stringify(schoolTimes)))
        await window.api.settings.saveSchoolTimes(normalized)
        for (const k of SCHOOL_TIME_WEEKDAY_KEYS) {
            schoolTimes[k].from = normalized[k].from
            schoolTimes[k].to = normalized[k].to
        }
        schoolTimesMsg.value = t('settings.schoolTimesSaved')
        schoolTimesError.value = false
    } catch (e) {
        schoolTimesMsg.value = e?.message || t('settings.saveFailed')
        schoolTimesError.value = true
    }
    setTimeout(() => { schoolTimesMsg.value = '' }, 5000)
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
        showPwCurrent.value = showPwNew1.value = showPwNew2.value = false
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
.session-lock-field-label {
    display: block;
    margin-top: 4px;
    margin-bottom: 4px;
}
.session-lock-field-input {
    display: block;
    margin-top: 4px;
}
.school-times-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-bottom: 0.35rem;
}
.school-times-day {
    flex: 0 0 auto;
    min-width: 2rem;
}
.school-times-pair {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex: 0 0 auto;
}
.school-times-sep {
    line-height: 1;
    user-select: none;
}
.school-time-input {
    box-sizing: border-box;
    width: 6.6ch;
    min-width: 6.6ch;
    max-width: 6.6ch;
    padding: 0.2rem 0.25rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
}
</style>
