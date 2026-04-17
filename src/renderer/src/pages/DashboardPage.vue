<template>
    <div class="pc-page-header">
        <h1>{{ $t('dashboard.title') }}</h1>
        <p>{{ $t('dashboard.subtitle') }}</p>
    </div>

    <div class="pc-content">
        <!-- Status cards row -->
        <div class="row g-3 mb-4 row-cols-2 row-cols-xl-5">
            <div class="col d-flex">
                <div
                    class="stat-card stat-card--clickable h-100 w-100"
                    role="button"
                    tabindex="0"
                    @click="go('/webfilter')"
                    @keydown.enter.prevent="go('/webfilter')"
                    @keydown.space.prevent="go('/webfilter')"
                >
                    <div class="stat-icon" style="background:#E3F2FD; color:#1565C0;">
                        <i class="bi bi-shield-x" />
                    </div>
                    <div class="stat-label">{{ $t('dashboard.webFilter') }}</div>
                    <div class="stat-value">
                        {{ filterCount }}<template v-if="store.webFilterEnabled && store.webFilterDnsMode !== 'dhcp'"><span class="text-muted" style="margin:0 4px;">|</span>dns4eu</template>
                    </div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="store.webFilterEnabled && (filterCount > 0 || store.webFilterDnsMode !== 'dhcp') ? 'active' : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ store.webFilterEnabled && (filterCount > 0 || store.webFilterDnsMode !== 'dhcp') ? $t('common.active') : $t('common.inactive') }}
                        </span>
                    </div>
                </div>
            </div>
            <div class="col d-flex">
                <div
                    class="stat-card stat-card--clickable h-100 w-100"
                    role="button"
                    tabindex="0"
                    @click="go('/apps')"
                    @keydown.enter.prevent="go('/apps')"
                    @keydown.space.prevent="go('/apps')"
                >
                    <div class="stat-icon" style="background:#FFF3E0; color:#E65100;">
                        <i class="bi bi-app-indicator" />
                    </div>
                    <div class="stat-label">{{ $t('dashboard.blockedAppsQuota') }}</div>
                    <div class="stat-value">{{ appControlCounts }}</div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="store.appControlEnabled ? (blockedCount > 0 ? 'warning' : 'active') : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ store.appControlEnabled ? $t('common.active') : $t('common.inactive') }}
                        </span>
                    </div>
                </div>
            </div>
            <div class="col d-flex">
                <div
                    class="stat-card stat-card--clickable h-100 w-100"
                    role="button"
                    tabindex="0"
                    @click="go('/process-whitelist')"
                    @keydown.enter.prevent="go('/process-whitelist')"
                    @keydown.space.prevent="go('/process-whitelist')"
                >
                    <div class="stat-icon" style="background:#E8F5E9; color:#2E7D32;">
                        <i class="bi bi-shield-check" />
                    </div>
                    <div class="stat-label">{{ $t('dashboard.appExemptions') }}</div>
                    <div class="stat-value">{{ effectiveExemptCount }}</div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="store.whitelistEnabled ? 'active' : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ store.whitelistEnabled ? $t('common.active') : $t('common.inactive') }}
                        </span>
                    </div>
                </div>
            </div>
            <div class="col d-flex">
                <div
                    class="stat-card stat-card--clickable h-100 w-100"
                    role="button"
                    tabindex="0"
                    @click="go('/schedules')"
                    @keydown.enter.prevent="go('/schedules')"
                    @keydown.space.prevent="go('/schedules')"
                >
                    <div class="stat-icon" style="background:#E8F5E9; color:#2E7D32;">
                        <i class="bi bi-clock-history" />
                    </div>
                    <div class="stat-label">{{ $t('dashboard.screenTimeLimit') }}</div>
                    <div class="stat-value">{{ screenTimeCounts }}</div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="scheduleEnabled ? 'active' : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ scheduleEnabled ? $t('common.active') : $t('common.disabled') }}
                        </span>
                    </div>
                </div>
            </div>
            <div v-if="isKDE" class="col d-flex">
                <div
                    class="stat-card stat-card--clickable h-100 w-100"
                    role="button"
                    tabindex="0"
                    @click="go('/kiosk')"
                    @keydown.enter.prevent="go('/kiosk')"
                    @keydown.space.prevent="go('/kiosk')"
                >
                    <div class="stat-icon" style="background:#F3E5F5; color:#6A1B9A;">
                        <i class="bi bi-lock-fill" />
                    </div>
                    <div class="stat-label">{{ $t('dashboard.kdeKiosk') }}</div>
                    <div class="stat-value">{{ kioskStatValue }}</div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="kioskBadgeClass">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ kioskBadgeLabel }}
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <div v-if="daemonServiceActive !== 'active'" class="alert alert-warning py-2 px-3 mb-3 d-flex align-items-center gap-2" style="font-size:13px;">
            <i class="bi bi-exclamation-triangle-fill" />
            <span>
                <strong>{{ $t('dashboard.daemonNotActive') }}</strong> — {{ $t('dashboard.daemonNotActiveMsg') }}
                <RouterLink to="/settings">{{ $t('dashboard.settingsLink') }}</RouterLink>.
            </span>
        </div>
        <div v-if="!dnsmasqOk" class="alert alert-warning py-2 px-3 mb-3 d-flex align-items-center gap-2" style="font-size:13px;">
            <i class="bi bi-exclamation-triangle-fill" />
            <span>
                <strong>{{ $t(`dashboard.dnsmasq_${dnsmasqReason}`) }}</strong> — {{ $t(`dashboard.dnsmasq_${dnsmasqReason}_msg`) }}
                <RouterLink to="/settings">{{ $t('dashboard.settingsLink') }}</RouterLink>.
            </span>
        </div>
        <div v-if="!apparmorOk" class="alert alert-warning py-2 px-3 mb-3 d-flex align-items-center gap-2" style="font-size:13px;">
            <i class="bi bi-exclamation-triangle-fill" />
            <span>
                <strong>{{ $t(`dashboard.apparmor_${apparmorReason}`) }}</strong> — {{ $t(`dashboard.apparmor_${apparmorReason}_msg`) }}
                <RouterLink to="/settings">{{ $t('dashboard.settingsLink') }}</RouterLink>.
            </span>
        </div>

        <!-- Screen time analytics -->
        <div class="pc-card mt-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">{{ $t('dashboard.screenTimeCard') }}</h6>
                <div class="d-flex flex-wrap gap-2">
                    <select v-if="appMonitorKnownUsers.length > 0" v-model="appMonitorViewUser" class="form-select form-select-sm" style="width:auto;">
                        <option value="">{{ $t('dashboard.allUsers') }}</option>
                        <option v-for="u in appMonitorKnownUsers" :key="u" :value="u">{{ u }}</option>
                    </select>
                    <button type="button" class="btn btn-sm btn-outline-secondary" @click="refreshScreenCharts">
                        {{ $t('common.refresh') }}
                    </button>
                    <RouterLink to="/schedules" class="btn btn-sm btn-outline-primary">
                        {{ $t('dashboard.rules') }}
                    </RouterLink>
                </div>
            </div>
            <div class="pc-card-body">
                <div class="row g-4 align-items-stretch">
                    <div class="col-12 col-lg-4 min-w-0 screen-time-donut-col">
                        <div class="donut-with-legend">
                            <ul
                                v-if="donutLegend.length"
                                class="donut-legend list-unstyled small mb-0 d-flex flex-column gap-1"
                            >
                                <li
                                    v-for="(row, idx) in donutLegend"
                                    :key="row.name + idx"
                                    class="donut-legend-row d-flex align-items-center gap-2"
                                >
                                    <span class="donut-swatch" :style="{ background: row.color }" />
                                    <span class="donut-legend-name text-truncate flex-grow-1" :title="row.name">{{ row.name }}</span>
                                    <span class="text-muted text-nowrap">{{ formatDonutLegendMinutes(row.value) }}</span>
                                </li>
                            </ul>
                            <div class="donut-chart-side d-flex justify-content-center align-items-start">
                                <div
                                    class="donut-wrap"
                                    :class="{ 'donut-wrap--empty': !donutGradient }"
                                    :style="donutGradient ? { background: donutGradient } : {}"
                                >
                                    <div class="donut-hole">
                                        <div class="donut-center-value">{{ donutCenterValue }}</div>
                                        <div class="text-muted small">{{ donutMinCaption }}</div>
                                        <div v-if="dailyCapSubtitle" class="text-muted small mt-1">{{ dailyCapSubtitle }}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p v-if="donutModel.overlap" class="small donut-overlap-hint mt-2 mb-0">
                            {{ $t('dashboard.trackedAppOverlap') }}
                        </p>
                    </div>
                    <div class="col-12 col-lg-8 min-w-0 d-flex flex-column week-chart-col-wrap">
                        <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
                            <h6 class="small text-muted mb-0">{{ $t('dashboard.last7Days') }}</h6>
                            <div class="d-flex flex-wrap gap-3 small text-muted justify-content-end">
                                <span v-if="store.schedule?.dailyLimitEnabled">
                                    {{ $t('dashboard.dailyCap') }} {{ store.schedule.dailyLimitMinutes }}m
                                    <template v-if="store.todayExtraAllowanceMinutes > 0">
                                        {{ $t('dashboard.bonusToday', { min: store.todayExtraAllowanceMinutes }) }}
                                    </template>
                                </span>
                                <span v-else>{{ $t('dashboard.noFixedCap') }}</span>
                                <span v-if="weekPeakDay">{{ weekPeakDay }}</span>
                            </div>
                        </div>
                        <div class="week-chart-anchor flex-grow-1 d-flex flex-column justify-content-end">
                            <div class="week-chart d-flex gap-1 align-items-stretch">
                                <div
                                    v-for="d in weekUsage"
                                    :key="d.date"
                                    class="week-chart-col flex-fill d-flex flex-column align-items-center"
                                    :class="{ 'week-chart-col--selected': isDonutDaySelected(d) }"
                                    role="button"
                                    tabindex="0"
                                    :aria-pressed="isDonutDaySelected(d) ? 'true' : 'false'"
                                    :title="$t('dashboard.weekBarSelectHint')"
                                    @click="onWeekBarClick(d)"
                                    @keydown.enter.prevent="onWeekBarClick(d)"
                                    @keydown.space.prevent="onWeekBarClick(d)"
                                >
                                    <div class="week-bar-track w-100" :style="{ height: WEEK_BAR_TRACK_PX + 'px' }">
                                        <div
                                            class="week-bar-fill w-100 bg-primary"
                                            :style="{ height: weekBarFillPx(d.minutes) + 'px' }"
                                        />
                                    </div>
                                    <div class="small text-muted mt-2 text-center text-truncate w-100">{{ d.shortLabel }}</div>
                                    <div class="small text-center">{{ d.minutes }}m</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="quotaCount" class="pc-card mt-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">{{ $t('dashboard.limitedApps') }}</h6>
                <RouterLink to="/apps" class="small text-decoration-none">{{ $t('dashboard.appControl') }}</RouterLink>
            </div>
            <div class="pc-card-body pt-2">
                <div v-for="row in quotaSummaryRows" :key="row.key" class="mb-3">
                    <div class="d-flex justify-content-between align-items-baseline small mb-1">
                        <span>{{ row.appName }}<small class="text-muted">{{ row.userSuffix }}</small></span>
                        <span class="text-muted">{{ row.used }} / {{ row.limit }} min</span>
                    </div>
                    <div class="progress" style="height:7px;">
                        <div
                            class="progress-bar"
                            :class="row.used >= row.limit ? 'bg-danger' : row.ratio >= 0.85 ? 'bg-warning' : 'bg-primary'"
                            role="progressbar"
                            :style="{ width: row.pct + '%' }"
                        />
                    </div>
                </div>
            </div>
        </div>

    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { normalizeQuotaLinuxUser, quotaUsedMinutes, quotaBonusMinutes } from '@shared/quotaUsageKey.js'
import { useAppStore } from '../stores/appStore.js'
import { RouterLink } from 'vue-router'
import { useRouter } from 'vue-router'

const { t } = useI18n()

/** Light Material (100–200) tones for top-10 app slices plus "Other session time". */
const DONUT_COLORS = [
    '#BBDEFB', '#C8E6C9', '#FFECB3', '#E1BEE7', '#B2DFDB', '#FFCCBC', '#CFD8DC', '#D1C4E9',
    '#B3E5FC', '#DCEDC8', '#F8BBD0', '#B2EBF2', '#C5CAE9'
]
const DONUT_TOP_APPS = 10

/** Fixed scale for week column chart: full track = 12h; 0 min renders as 1px baseline. */
const WEEK_BAR_TRACK_PX = 120
const WEEK_BAR_FULL_MINUTES = 12 * 60

const store = useAppStore()
const router = useRouter()
// Same visibility rule as AppSidebar nav (KDE or unknown XDG_CURRENT_DESKTOP).
const isKDE = computed(() => {
    const d = (store.xdgCurrentDesktop || '').toUpperCase()
    return !d || d.includes('KDE')
})
const weekUsage = ref([])
/** null = today (live store); else YYYY-MM-DD for historical donut. */
const selectedDonutDate = ref(null)
const donutDayUsage = ref({})
const appMonitorViewUser = ref('')
const daemonServiceActive = ref(null) // 'active' | 'inactive' | null
const dnsmasqOk = ref(true) // true until loaded
const dnsmasqReason = ref('ok')
const apparmorOk = ref(true) // true until loaded
const apparmorReason = ref('ok')

function go(path) {
    router.push(path)
}

function localIsoDate(d = new Date()) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

function isDonutDaySelected(d) {
    const todayIso = localIsoDate()
    if (d.date === todayIso) return selectedDonutDate.value === null
    return selectedDonutDate.value === d.date
}

async function onWeekBarClick(d) {
    const todayIso = localIsoDate()
    if (d.date === todayIso) {
        selectedDonutDate.value = null
        donutDayUsage.value = {}
        return
    }
    selectedDonutDate.value = d.date
    try {
        const r = await window.api.quota.getAppMonitorUsageForDate({ date: d.date })
        donutDayUsage.value = r?.usage && typeof r.usage === 'object' ? { ...r.usage } : {}
    } catch {
        donutDayUsage.value = {}
    }
}

async function loadDaemonStatus() {
    try {
        const [svc, dnsmasq, apparmor] = await Promise.all([
            window.api.daemon.serviceControl({ action: 'status' }),
            window.api.daemon.dnsmasqCheck(),
            window.api.daemon.apparmorCheck(),
        ])
        daemonServiceActive.value = svc?.status ?? null
        dnsmasqOk.value = dnsmasq?.ok === true
        dnsmasqReason.value = dnsmasq?.reason ?? 'ok'
        apparmorOk.value = apparmor?.ok === true
        apparmorReason.value = apparmor?.reason ?? 'ok'
    } catch {
        daemonServiceActive.value = null
    }
}

const filterCount = computed(() => store.webFilterHostRuleCount)
const blockedCount = computed(() => (store.appControlEnabled ? store.blockedApps.length : 0))
const effectiveExemptCount = computed(() => {
    const enabled = store.whitelistEnabled === true
    if (!enabled) return 0
    const blockedSet = new Set(store.blockedApps || [])
    const allowed = Array.isArray(store.quotaExemptAllowedIds) ? store.quotaExemptAllowedIds : []
    let count = 0
    for (const id of allowed) {
        if (typeof id !== 'string') continue
        if (!blockedSet.has(id)) count++
    }
    return count
})
const quotaCount = computed(() => {
    if (store.appControlEnabled !== true) return 0
    const f = normalizeQuotaLinuxUser(store.quotaViewLinuxUser)
    const list = f
        ? store.appQuotas.filter((q) => {
            const lu = normalizeQuotaLinuxUser(q.linuxUser)
            return !lu || lu === f
        })
        : store.appQuotas
    return list.length
})
const appControlCounts = computed(() => `${blockedCount.value} / ${quotaCount.value}`)
const screenTimeCounts = computed(() => {
    const s = store.schedule
    if (!s?.enabled) return '0 / 0'
    const used = Number(store.todayUsageMinutes ?? 0)
    const isWe = new Date().getDay() === 0 || new Date().getDay() === 6
    const period = isWe ? s.weekend : s.weekday
    const limit = period?.dailyLimitEnabled ? Number(period.dailyLimitMinutes || 0) : 0
    const extra = Number(store.todayExtraAllowanceMinutes ?? 0)
    const effectiveLimit = limit + extra
    const extraStr = extra > 0 ? ` (+${extra}min)` : ''
    return `${used}min / ${effectiveLimit}min${extraStr}`
})
const quotaSummaryRows = computed(() => {
    const usage = store.appQuotaUsage || {}
    const extra = store.appQuotaExtra || {}
    const f = normalizeQuotaLinuxUser(store.quotaViewLinuxUser)
    const quotas = f
        ? store.appQuotas.filter((q) => {
            const lu = normalizeQuotaLinuxUser(q.linuxUser)
            return !lu || lu === f
        })
        : store.appQuotas
    const rows = quotas.map((q) => {
        const base = Math.max(1, Number(q.minutesPerDay) || 1)
        const bonus = quotaBonusMinutes(extra, q.appId, q.linuxUser)
        const limit = base + bonus
        const used = quotaUsedMinutes(usage, q.appId, q.linuxUser)
        const ratio = used / limit
        const pct = Math.min(100, Math.round(ratio * 100))
        const lu = normalizeQuotaLinuxUser(q.linuxUser)
        const userSuffix = lu ? ` · ${lu}` : ` · ${t('dashboard.allAccountsSuffix')}`
        return {
            key: `${q.appId}\0${lu || ''}`,
            appId: q.appId,
            appName: q.appName || q.processName,
            userSuffix,
            used,
            limit,
            ratio,
            pct
        }
    })
    rows.sort((a, b) => b.ratio - a.ratio)
    return rows
})
const scheduleEnabled = computed(() => store.schedule?.enabled ?? false)

const kioskStatValue = computed(() => {
    const k = store.kioskStatus
    if (!k.ok) return '–'
    return k.active ? k.restrictionCount : '–'
})

const kioskBadgeClass = computed(() => {
    const k = store.kioskStatus
    if (!k.ok) return 'warning'
    return k.active ? 'active' : 'inactive'
})

const kioskBadgeLabel = computed(() => {
    const k = store.kioskStatus
    if (!k.ok) return t('dashboard.unreadable')
    return k.active ? t('common.active') : t('common.inactive')
})

const screenMinutesForDonut = computed(() => {
    if (selectedDonutDate.value === null) return Math.max(0, Number(store.todayUsageMinutes) || 0)
    const row = weekUsage.value.find((x) => x.date === selectedDonutDate.value)
    return row ? Math.max(0, Number(row.minutes) || 0) : 0
})

function filterUsageByUser(raw, user) {
    if (!user) {
        // Alle User: summiere user:appId Keys auf appId
        const out = {}
        for (const [k, v] of Object.entries(raw)) {
            const colonIdx = k.indexOf(':')
            const appId = colonIdx !== -1 ? k.slice(colonIdx + 1) : k
            out[appId] = (out[appId] || 0) + Math.max(0, Number(v) || 0)
        }
        return out
    }
    const prefix = user + ':'
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = Math.max(0, Number(v) || 0)
    }
    return out
}

const appMonitorKnownUsers = computed(() => {
    const raw = store.appMonitorUsage || {}
    const users = new Set()
    for (const k of Object.keys(raw)) {
        const colonIdx = k.indexOf(':')
        if (colonIdx !== -1) users.add(k.slice(0, colonIdx))
    }
    return [...users].sort()
})

const usageMapForDonut = computed(() => {
    const raw = selectedDonutDate.value === null ? (store.appMonitorUsage || {}) : donutDayUsage.value
    return filterUsageByUser(raw, appMonitorViewUser.value)
})

const donutMinCaption = computed(() => {
    if (selectedDonutDate.value === null) return t('dashboard.minToday')
    const row = weekUsage.value.find((x) => x.date === selectedDonutDate.value)
    const dayLabel = row?.shortLabel || selectedDonutDate.value
    return t('dashboard.minOnDay', { day: dayLabel })
})

const donutModel = computed(() => {
    const screen = screenMinutesForDonut.value
    const usage = usageMapForDonut.value
    const labels = store.appMonitorLabels || {}
    const pairs = Object.entries(usage)
        .map(([appId, v]) => ({
            name: labels[appId] || String(appId).replace(/\.desktop$/i, ''),
            value: Math.max(0, Number(v) || 0)
        }))
        .filter(s => s.value > 0)
        .sort((a, b) => b.value - a.value)
    const sumAllTracked = pairs.reduce((a, s) => a + s.value, 0)
    const top = pairs.slice(0, DONUT_TOP_APPS)
    const sumTop = top.reduce((a, s) => a + s.value, 0)
    const slices = top.map(s => ({ name: s.name, value: s.value }))
    const other = Math.max(0, screen - sumTop)
    if (other > 0) slices.push({ name: t('dashboard.otherSessionTime'), value: other })
    if (slices.length === 0 && screen > 0) {
        slices.push({ name: t('dashboard.sessionNoUsage'), value: screen })
    }
    const total = slices.reduce((a, s) => a + s.value, 0)
    return { screen, slices, total, overlap: sumAllTracked > screen && screen > 0 }
})

const donutGradient = computed(() => {
    const { slices, total } = donutModel.value
    if (total <= 0) return null
    let acc = 0
    const parts = slices.map((sl, i) => {
        const start = (acc / total) * 100
        acc += sl.value
        const end = (acc / total) * 100
        const c = DONUT_COLORS[i % DONUT_COLORS.length]
        return `${c} ${start.toFixed(3)}% ${end.toFixed(3)}%`
    })
    return `conic-gradient(from -90deg, ${parts.join(', ')})`
})

const donutLegend = computed(() => donutModel.value.slices.map((s, i) => ({
    name: s.name,
    value: s.value,
    color: DONUT_COLORS[i % DONUT_COLORS.length]
})))

const donutCenterValue = computed(() => formatDonutLegendMinutes(donutModel.value.screen))

const dailyCapSubtitle = computed(() => {
    if (selectedDonutDate.value !== null) return ''
    const s = store.schedule
    if (!s?.enabled || !s?.dailyLimitEnabled) return ''
    const cap = Number(s.dailyLimitMinutes) || 0
    const extra = Math.max(0, Number(store.todayExtraAllowanceMinutes) || 0)
    if (extra > 0) return t('dashboard.ofCapBonus', { cap: cap + extra })
    return t('dashboard.ofCap', { cap })
})

/** Legend duration: minutes below 1h, then "Xh" or "Xh Ym" for readability. */
function formatDonutLegendMinutes(raw) {
    const m = Math.max(0, Math.floor(Number(raw) || 0))
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    const rest = m % 60
    if (rest === 0) return `${h}h`
    const restStr = String(rest).padStart(2, '0')
    return `${h}h ${restStr}m`
}

function weekBarFillPx(minutes) {
    const m = Math.max(0, Number(minutes) || 0)
    if (m <= 0) return 1
    const h = (m / WEEK_BAR_FULL_MINUTES) * WEEK_BAR_TRACK_PX
    return Math.min(WEEK_BAR_TRACK_PX, Math.max(1, Math.round(h)))
}

const weekPeakDay = computed(() => {
    if (!weekUsage.value.length) return ''
    const top = weekUsage.value.reduce((a, d) => (d.minutes > a.minutes ? d : a), weekUsage.value[0])
    if (!top || top.minutes <= 0) return ''
    return t('dashboard.peakThisWeek', { day: top.shortLabel, min: top.minutes })
})

async function loadWeekUsage() {
    const r = await window.api.schedules.getUsageHistory(14)
    const days = Array.isArray(r?.days) ? r.days : []
    const map = new Map(days.map(d => [d.date, d.minutes]))
    const out = []
    for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() - i)
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const iso = `${y}-${m}-${day}`
        const minutes = Math.max(0, Number(map.get(iso)) || 0)
        out.push({
            date: iso,
            shortLabel: d.toLocaleDateString(undefined, { weekday: 'short' }),
            minutes
        })
    }
    weekUsage.value = out
}

async function refreshScreenCharts() {
    await Promise.all([store.loadSchedule(), store.loadAppQuotas(), loadWeekUsage(), loadDaemonStatus()])
    if (selectedDonutDate.value) {
        try {
            const r = await window.api.quota.getAppMonitorUsageForDate({ date: selectedDonutDate.value })
            donutDayUsage.value = r?.usage && typeof r.usage === 'object' ? { ...r.usage } : {}
        } catch {
            donutDayUsage.value = {}
        }
    }
}

onMounted(async () => {
    await refreshScreenCharts()
    // Prefetch app list in background so AppControl/ProcessWhitelist pages open instantly
    store.loadInstalledApps().catch(() => {})
})
</script>

<style scoped>
.stat-card--clickable {
    cursor: pointer;
}
.donut-overlap-hint {
    color: #b0bec5;
}
.screen-time-donut-col {
    max-width: 100%;
}
.donut-with-legend {
    display: grid;
    width: 100%;
    gap: 1rem 1.25rem;
    align-items: start;
    justify-items: stretch;
}
@media (min-width: 768px) {
    .donut-with-legend {
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 1rem 1.5rem;
    }
    .donut-with-legend:has(> .donut-chart-side:only-child) {
        grid-template-columns: 1fr;
        justify-items: center;
    }
}
@media (max-width: 767.98px) {
    .donut-with-legend {
        grid-template-columns: 1fr;
        justify-items: center;
    }
    .donut-with-legend .donut-legend {
        grid-row: 2;
        justify-self: stretch;
    }
    .donut-with-legend .donut-chart-side {
        grid-row: 1;
    }
}
.donut-legend {
    width: min(220px, 100%);
    min-width: 0;
    /* Exactly 10 rows (DONUT_TOP_APPS): 10×row + 9×gap; scroll only if 11th slice (e.g. Other session time). */
    max-height: calc(10 * 1.375rem + 9 * 0.25rem);
    overflow-y: auto;
    padding-right: 2px;
    -webkit-overflow-scrolling: touch;
}
.donut-legend-row {
    min-height: 1.375rem;
    flex-shrink: 0;
}
@media (max-width: 767.98px) {
    .donut-legend {
        max-width: none;
        max-height: calc(10 * 1.375rem + 9 * 0.25rem);
    }
}
.donut-legend-name {
    min-width: 0;
}
.donut-chart-side {
    min-width: 0;
    justify-self: center;
}
@media (min-width: 768px) {
    .donut-chart-side {
        justify-self: end;
    }
    .donut-legend {
        justify-self: start;
    }
}
.donut-wrap {
    flex-shrink: 0;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    position: relative;
}
.donut-wrap--empty {
    background: #F5F5F5;
    border: 2px dashed #E0E0E0;
}
.donut-hole {
    position: absolute;
    /* Larger hole = thinner ring (~Material-style weight) */
    inset: 18%;
    background: #fff;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 8px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.donut-center-value {
    font-size: 1.65rem;
    font-weight: 700;
    line-height: 1.1;
    color: #212121;
}
.donut-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
}
.week-chart-col {
    min-width: 0;
    cursor: pointer;
    border-radius: 6px;
    padding: 4px 2px 0;
    outline: none;
    transition: background 0.15s ease;
}
.week-chart-col:hover {
    background: rgba(0, 0, 0, 0.04);
}
.week-chart-col:focus-visible {
    box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.45);
}
.week-chart-col--selected {
    background: rgba(25, 118, 210, 0.08);
}
.week-chart-col-wrap {
    min-height: 0;
}
.week-chart-anchor {
    min-height: 0;
}
.week-bar-track {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    flex-shrink: 0;
}
.week-bar-fill {
    flex-shrink: 0;
    border-radius: 4px 4px 0 0;
}
</style>
