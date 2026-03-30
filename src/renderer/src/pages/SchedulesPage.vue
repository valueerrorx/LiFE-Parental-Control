<template>
    <div class="pc-page-header d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-3">
            <label class="pc-toggle">
                <input type="checkbox" v-model="schedule.enabled" />
                <span class="slider" />
            </label>
            <div>
                <h1>{{ $t('schedules.title') }}</h1>
                <p class="mb-0">{{ $t('schedules.subtitle') }}</p>
            </div>
        </div>
        <div class="d-flex align-items-center gap-2">
            <span v-if="isDirty" class="text-danger small">{{ $t('common.unsavedChanges') }}</span>
            <span class="status-badge" :class="schedule.enabled ? 'active' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ schedule.enabled ? $t('common.active') : $t('common.disabled') }}
            </span>
            <button class="btn-pc-primary" @click="onSave" :disabled="!isDirty || saving">
                <i class="bi bi-floppy me-1" />{{ saving ? $t('common.saving') : $t('common.applyChanges') }}
            </button>
        </div>
    </div>

    <div class="pc-content" v-if="schedule">
        <div :class="{ 'opacity-50 pe-none': !schedule.enabled }">

            <!-- Linux user selector (shared) -->
            <div class="pc-card mb-3">
                <div class="pc-card-header"><h6>{{ $t('schedules.limitForLinuxUser') }}</h6></div>
                <div class="pc-card-body">
                    <div class="d-flex flex-wrap align-items-center gap-3">
                        <select v-model="schedule.screenTimeLinuxUser" class="pc-input" style="max-width:280px;">
                            <option value="">{{ $t('schedules.allSessions') }}</option>
                            <option v-for="u in screenTimeUserOptions" :key="u" :value="u">{{ u }}</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Weekday settings (Mo–Fr) -->
            <div class="pc-card mb-3">
                <div class="pc-card-header"><h6>{{ $t('schedules.weekdaySettings') }}</h6></div>
                <div class="pc-card-body">
                    <!-- Weekday daily limit -->
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="text-muted small fw-semibold">{{ $t('schedules.dailyTimeLimit') }}</span>
                        <label class="pc-toggle">
                            <input type="checkbox" v-model="schedule.weekday.dailyLimitEnabled" />
                            <span class="slider" />
                        </label>
                    </div>
                    <div v-if="schedule.weekday.dailyLimitEnabled" class="d-flex align-items-center gap-3 mb-3">
                        <input v-model.number="schedule.weekday.dailyLimitMinutes" type="number" min="15" max="720" step="15" class="pc-input" style="width:90px;" />
                        <span class="text-muted small">{{ $t('schedules.minutes') }}</span>
                        <span class="text-muted small">({{ Math.floor(schedule.weekday.dailyLimitMinutes / 60) }}h {{ schedule.weekday.dailyLimitMinutes % 60 }}m)</span>
                    </div>
                    <!-- Weekday allowed hours -->
                    <div class="d-flex align-items-center justify-content-between mb-2 mt-3" style="border-top:1px solid var(--pc-border,#e0e0e0);padding-top:0.75rem;">
                        <span class="text-muted small fw-semibold">{{ $t('schedules.allowedHours') }}</span>
                        <label class="pc-toggle">
                            <input type="checkbox" v-model="schedule.weekday.allowedHoursEnabled" />
                            <span class="slider" />
                        </label>
                    </div>
                    <div v-if="schedule.weekday.allowedHoursEnabled" class="d-flex align-items-center gap-3 flex-wrap">
                        <label class="text-muted small" style="white-space:nowrap;">{{ $t('schedules.from') }}</label>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekday.allowedHoursStart.split(':')[0]" @change="schedule.weekday.allowedHoursStart = $event.target.value + ':' + schedule.weekday.allowedHoursStart.split(':')[1]">
                            <option v-for="h in 24" :key="h-1" :value="String(h-1).padStart(2,'0')">{{ String(h-1).padStart(2,'0') }}</option>
                        </select>
                        <span class="text-muted">:</span>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekday.allowedHoursStart.split(':')[1]" @change="schedule.weekday.allowedHoursStart = schedule.weekday.allowedHoursStart.split(':')[0] + ':' + $event.target.value">
                            <option v-for="m in ['00','15','30','45']" :key="m" :value="m">{{ m }}</option>
                        </select>
                        <label class="text-muted small" style="white-space:nowrap;">{{ $t('schedules.to') }}</label>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekday.allowedHoursEnd.split(':')[0]" @change="schedule.weekday.allowedHoursEnd = $event.target.value + ':' + schedule.weekday.allowedHoursEnd.split(':')[1]">
                            <option v-for="h in 24" :key="h-1" :value="String(h-1).padStart(2,'0')">{{ String(h-1).padStart(2,'0') }}</option>
                        </select>
                        <span class="text-muted">:</span>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekday.allowedHoursEnd.split(':')[1]" @change="schedule.weekday.allowedHoursEnd = schedule.weekday.allowedHoursEnd.split(':')[0] + ':' + $event.target.value">
                            <option v-for="m in ['00','15','30','45']" :key="m" :value="m">{{ m }}</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Weekend settings (Sa–So) -->
            <div class="pc-card mb-3">
                <div class="pc-card-header"><h6>{{ $t('schedules.weekendSettings') }}</h6></div>
                <div class="pc-card-body">
                    <!-- Weekend daily limit -->
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="text-muted small fw-semibold">{{ $t('schedules.dailyTimeLimit') }}</span>
                        <label class="pc-toggle">
                            <input type="checkbox" v-model="schedule.weekend.dailyLimitEnabled" />
                            <span class="slider" />
                        </label>
                    </div>
                    <div v-if="schedule.weekend.dailyLimitEnabled" class="d-flex align-items-center gap-3 mb-3">
                        <input v-model.number="schedule.weekend.dailyLimitMinutes" type="number" min="15" max="720" step="15" class="pc-input" style="width:90px;" />
                        <span class="text-muted small">{{ $t('schedules.minutes') }}</span>
                        <span class="text-muted small">({{ Math.floor(schedule.weekend.dailyLimitMinutes / 60) }}h {{ schedule.weekend.dailyLimitMinutes % 60 }}m)</span>
                    </div>
                    <!-- Weekend allowed hours -->
                    <div class="d-flex align-items-center justify-content-between mb-2 mt-3" style="border-top:1px solid var(--pc-border,#e0e0e0);padding-top:0.75rem;">
                        <span class="text-muted small fw-semibold">{{ $t('schedules.allowedHours') }}</span>
                        <label class="pc-toggle">
                            <input type="checkbox" v-model="schedule.weekend.allowedHoursEnabled" />
                            <span class="slider" />
                        </label>
                    </div>
                    <div v-if="schedule.weekend.allowedHoursEnabled" class="d-flex align-items-center gap-3 flex-wrap">
                        <label class="text-muted small" style="white-space:nowrap;">{{ $t('schedules.from') }}</label>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekend.allowedHoursStart.split(':')[0]" @change="schedule.weekend.allowedHoursStart = $event.target.value + ':' + schedule.weekend.allowedHoursStart.split(':')[1]">
                            <option v-for="h in 24" :key="h-1" :value="String(h-1).padStart(2,'0')">{{ String(h-1).padStart(2,'0') }}</option>
                        </select>
                        <span class="text-muted">:</span>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekend.allowedHoursStart.split(':')[1]" @change="schedule.weekend.allowedHoursStart = schedule.weekend.allowedHoursStart.split(':')[0] + ':' + $event.target.value">
                            <option v-for="m in ['00','15','30','45']" :key="m" :value="m">{{ m }}</option>
                        </select>
                        <label class="text-muted small" style="white-space:nowrap;">{{ $t('schedules.to') }}</label>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekend.allowedHoursEnd.split(':')[0]" @change="schedule.weekend.allowedHoursEnd = $event.target.value + ':' + schedule.weekend.allowedHoursEnd.split(':')[1]">
                            <option v-for="h in 24" :key="h-1" :value="String(h-1).padStart(2,'0')">{{ String(h-1).padStart(2,'0') }}</option>
                        </select>
                        <span class="text-muted">:</span>
                        <select class="pc-input" style="width:70px;" :value="schedule.weekend.allowedHoursEnd.split(':')[1]" @change="schedule.weekend.allowedHoursEnd = schedule.weekend.allowedHoursEnd.split(':')[0] + ':' + $event.target.value">
                            <option v-for="m in ['00','15','30','45']" :key="m" :value="m">{{ m }}</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Today's usage -->
            <div class="pc-card mb-3" v-if="activePeriod.dailyLimitEnabled">
                <div class="pc-card-header"><h6>{{ $t('schedules.todayUsage') }}</h6></div>
                <div class="pc-card-body">
                    <p v-if="todayExtraAllowance > 0" class="text-muted small mb-1" v-html="$t('schedules.todayAllowance', { min: todayExtraAllowance })" />
                    <div class="d-flex justify-content-between mb-1">
                        <span class="text-muted small">{{ $t('schedules.todayUsage') }}</span>
                        <span class="small fw-semibold" :style="usageColor">{{ todayMinutes }}m / {{ effectiveDailyLimit }}m</span>
                    </div>
                    <div class="usage-bar-track mb-3">
                        <div class="usage-bar-fill" :style="{ width: usagePercent + '%', background: usageBarColor }" />
                    </div>
                    <button type="button" class="btn-pc-outline st-action-btn" :disabled="saving" @click="onResetTodayUsage">
                        <i class="bi bi-arrow-counterclockwise me-1" />{{ $t('schedules.resetTodayUsage') }}
                    </button>
                    <p class="text-muted small mt-2 mb-0" style="max-width:52rem;">{{ $t('schedules.limitReachedHint') }}</p>
                </div>
            </div>
        </div>

        <div class="pc-card mb-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between">
                <h6 class="mb-0">{{ $t('schedules.recentScreenTime') }}</h6>
                <div class="d-flex align-items-center gap-2">
                    <select v-model.number="historyDays" class="pc-input" style="width:auto;padding:4px 8px;font-size:12px;" @change="refreshUsageData">
                        <option :value="7">{{ $t('schedules.7days') }}</option>
                        <option :value="14">{{ $t('schedules.14days') }}</option>
                        <option :value="30">{{ $t('schedules.30days') }}</option>
                        <option :value="90">{{ $t('schedules.90days') }}</option>
                    </select>
                    <button type="button" class="btn btn-sm btn-outline-secondary" @click="refreshUsageData">
                        {{ $t('common.refresh') }}
                    </button>
                </div>
            </div>
            <div class="pc-card-body">
                <div v-if="usageHistory.length === 0" class="text-muted small">{{ $t('schedules.noHistoryYet') }}</div>
                <div v-else class="d-flex flex-column gap-2">
                    <div v-for="row in usageHistory" :key="row.date" class="d-flex align-items-center gap-2 gap-md-3 flex-wrap">
                        <span style="min-width:92px;font-size:12px;" class="text-muted">{{ row.date }}</span>
                        <div class="flex-grow-1 usage-bar-track" style="min-width:120px;height:10px;">
                            <div class="usage-bar-fill" :style="historyBarStyle(row)" />
                        </div>
                        <span style="min-width:40px;font-size:12px;text-align:right;">{{ row.minutes }}m</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="pc-card mb-3">
            <div class="pc-card-header"><h6>{{ $t('schedules.profilePresets') }}</h6></div>
            <div class="pc-card-body">
                <p class="text-muted mb-2" style="font-size:12px;" v-html="$t('schedules.presetsHint')" />
                <div class="d-flex flex-wrap gap-2">
                    <button type="button" class="btn-pc-outline" @click="applyPreset('school')">
                        <i class="bi bi-mortarboard me-1" />{{ $t('schedules.schoolWeek') }}
                    </button>
                    <button type="button" class="btn-pc-outline" @click="applyPreset('leisure')">
                        <i class="bi bi-brightness-high me-1" />{{ $t('schedules.leisure') }}
                    </button>
                </div>
            </div>
        </div>

        <p v-if="saveMsg" class="mt-2" :class="saveError ? 'text-danger' : 'text-success'">
            <i class="bi me-1" :class="saveError ? 'bi-exclamation-circle' : 'bi-check-circle'" />
            {{ saveMsg }}
        </p>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import Swal from 'sweetalert2'
import { normalizeQuotaLinuxUser } from '@shared/quotaUsageKey.js'
import { useAppStore } from '../stores/appStore.js'
import { useDesktopLoginUsers, loadDesktopLoginUsers } from '../composables/useDesktopLoginUsers.js'

const { t, tm } = useI18n()
const appStore = useAppStore()
const { desktopLoginUsers } = useDesktopLoginUsers()
const days = computed(() => tm('schedules.days'))
const schedule = reactive({
    enabled: false,
    screenTimeLinuxUser: '',
    weekday: { dailyLimitEnabled: false, dailyLimitMinutes: 120, allowedHoursEnabled: false, allowedHoursStart: '07:00', allowedHoursEnd: '22:00' },
    weekend: { dailyLimitEnabled: false, dailyLimitMinutes: 180, allowedHoursEnabled: false, allowedHoursStart: '09:00', allowedHoursEnd: '22:00' }
})
const saving  = ref(false)
const saveMsg = ref('')
const saveError = ref(false)
const savedSnapshot = ref(null)

function scheduleSnapshot() {
    return JSON.stringify({ ...schedule, weekday: { ...schedule.weekday }, weekend: { ...schedule.weekend } })
}

function takeSnapshot() {
    savedSnapshot.value = scheduleSnapshot()
}

const isDirty = computed(() => {
    if (savedSnapshot.value === null) return false
    return scheduleSnapshot() !== savedSnapshot.value
})
const todayMinutes = ref(0)
const usageHistory = ref([])
const historyDays = ref(7)
const todayExtraAllowance = ref(0)

const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6
const activePeriod = computed(() => isWeekend ? schedule.weekend : schedule.weekday)
const effectiveDailyLimit = computed(() => (activePeriod.value.dailyLimitMinutes || 120) + todayExtraAllowance.value)

const screenTimeUserOptions = computed(() => {
    const cur = normalizeQuotaLinuxUser(schedule.screenTimeLinuxUser)
    const base = [...desktopLoginUsers.value]
    if (cur && !base.includes(cur)) base.push(cur)
    return base.sort((a, b) => a.localeCompare(b))
})

const usagePercent  = computed(() => Math.min(100, Math.round((todayMinutes.value / (effectiveDailyLimit.value || 1)) * 100)))
const usageBarColor = computed(() => usagePercent.value >= 100 ? '#C62828' : usagePercent.value >= 80 ? '#E65100' : '#1565C0')
const usageColor    = computed(() => ({ color: usageBarColor.value }))

watch(() => schedule.enabled, (enabled) => {
    if (enabled) return
    schedule.weekday.dailyLimitEnabled = false
    schedule.weekday.allowedHoursEnabled = false
    schedule.weekend.dailyLimitEnabled = false
    schedule.weekend.allowedHoursEnabled = false
})

function historyBarStyle(row) {
    const limit = schedule.weekday.dailyLimitEnabled ? (schedule.weekday.dailyLimitMinutes || 120) : 0
    if (limit > 0) {
        const pct = Math.min(100, Math.round((row.minutes / limit) * 100))
        const bg = pct >= 100 ? '#C62828' : pct >= 80 ? '#E65100' : '#1565C0'
        return { width: `${pct}%`, background: bg }
    }
    const peak = Math.max(...usageHistory.value.map(d => d.minutes), 1)
    const pct = Math.min(100, Math.round((row.minutes / peak) * 100))
    return { width: `${pct}%`, background: '#1565C0' }
}

async function refreshUsageData() {
    const [usage, hist] = await Promise.all([
        window.api.schedules.getUsage(),
        window.api.schedules.getUsageHistory(historyDays.value)
    ])
    if (usage) {
        todayMinutes.value = usage.minutes ?? 0
        todayExtraAllowance.value = usage.extraAllowanceMinutes ?? 0
    }
    usageHistory.value = hist.days ?? []
}

onMounted(async () => {
    await loadDesktopLoginUsers()
    const saved = await window.api.schedules.get()
    if (saved) {
        const { weekday, weekend, allowedDays: _dropped, ...rest } = saved
        Object.assign(schedule, rest)
        if (weekday) Object.assign(schedule.weekday, weekday)
        if (weekend) Object.assign(schedule.weekend, weekend)
    }
    takeSnapshot()
    await refreshUsageData()
})

async function applyPreset(kind) {
    const presetLabel = kind === 'school' ? t('schedules.schoolWeek') : t('schedules.leisure')
    const presetDesc = kind === 'school' ? t('schedules.presetSchoolDesc') : t('schedules.presetLeisureDesc')
    const result = await Swal.fire({
        title: t('schedules.presetConfirmTitle'),
        html: `<strong>${presetLabel}</strong><br><br><span style="font-size:13px;color:#555;">${presetDesc}</span><br><br><span style="font-size:12px;color:#999;">${t('schedules.presetOverwriteHint')}</span>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: t('common.applyChanges'),
        cancelButtonText: t('common.cancel'),
        confirmButtonColor: '#1565C0',
        cancelButtonColor: '#757575',
        focusCancel: true,
        customClass: { popup: 'life-swal-popup' }
    })
    if (!result.isConfirmed) return

    if (kind === 'school') {
        schedule.enabled = true
        Object.assign(schedule.weekday, { dailyLimitEnabled: false, dailyLimitMinutes: 0, allowedHoursEnabled: true, allowedHoursStart: '07:30', allowedHoursEnd: '13:30' })
        Object.assign(schedule.weekend, { dailyLimitEnabled: true, dailyLimitMinutes: 180, allowedHoursEnabled: true, allowedHoursStart: '09:00', allowedHoursEnd: '21:00' })
    } else if (kind === 'leisure') {
        schedule.enabled = true
        Object.assign(schedule.weekday, { dailyLimitEnabled: true, dailyLimitMinutes: 180, allowedHoursEnabled: true, allowedHoursStart: '09:00', allowedHoursEnd: '21:00' })
        Object.assign(schedule.weekend, { dailyLimitEnabled: true, dailyLimitMinutes: 180, allowedHoursEnabled: true, allowedHoursStart: '09:00', allowedHoursEnd: '21:00' })
    }
    saveMsg.value = t('schedules.presetApplied')
    saveError.value = false
    setTimeout(() => { saveMsg.value = '' }, 5000)
}

async function onResetTodayUsage() {
    if (!await confirm({ title: t('schedules.resetTodayTitle'), message: t('schedules.resetTodayMsg'), okLabel: t('appControl.reset'), danger: true })) return
    saving.value = true
    const result = await window.api.schedules.resetTodayUsage()
    saving.value = false
    if (result?.error) {
        saveMsg.value = `Error: ${result.error}`
        saveError.value = true
    } else {
        saveMsg.value = t('schedules.todayUsageReset')
        saveError.value = false
        await refreshUsageData()
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onSave() {
    saving.value = true
    // IPC cannot clone reactive `allowedDays` array; copy to a plain array.
    const result = await window.api.schedules.save({ ...schedule, weekday: { ...schedule.weekday }, weekend: { ...schedule.weekend } })
    saving.value = false
    if (result?.error) { saveMsg.value = `Error: ${result.error}`; saveError.value = true }
    else {
        saveMsg.value = t('schedules.screenTimeApplied')
        saveError.value = false
        takeSnapshot()
        void appStore.refreshProtectionsState()
        await refreshUsageData()
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}
</script>

<style scoped>
.usage-bar-wrap {
    padding-top: 4px;
}
.st-usage-actions {
    margin-top: 1.35rem;
    padding-top: 1.35rem;
    border-top: 1px solid var(--pc-border, #e0e0e0);
}
.st-usage-section-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--pc-text-secondary, #616161);
    margin-bottom: 0.35rem;
}
.st-usage-hint {
    font-size: 12px;
    line-height: 1.55;
    color: var(--pc-text-secondary, #616161);
    margin: 0 0 0.85rem;
    max-width: 52rem;
}
.st-action-btn {
    padding: 8px 18px;
    font-size: 13.5px;
    min-height: 38px;
    box-sizing: border-box;
}

.usage-bar-track {
    height: 8px;
    background: #E0E0E0;
    border-radius: 4px;
    overflow: hidden;
}
.usage-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s, background 0.3s;
}

.day-pill {
    display: inline-flex;
    align-items: center;
    cursor: pointer;

    input { display: none; }
    span {
        display: inline-block;
        padding: 5px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid #E0E0E0;
        color: #616161;
        background: #fff;
        transition: all 0.15s;
        user-select: none;
    }
    input:checked ~ span {
        background: var(--pc-primary);
        color: #fff;
        border-color: var(--pc-primary);
    }
}
</style>
