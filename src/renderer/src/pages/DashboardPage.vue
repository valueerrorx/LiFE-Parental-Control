<template>
    <div class="pc-page-header">
        <h1>Dashboard</h1>
        <p>Overview of active protections</p>
    </div>

    <div class="pc-content">
        <!-- Status cards row -->
        <div class="row g-3 mb-4">
            <div class="col-6 col-xl-3 d-flex">
                <div class="stat-card h-100 w-100">
                    <div class="stat-icon" style="background:#E3F2FD; color:#1565C0;">
                        <i class="bi bi-shield-x" />
                    </div>
                    <div class="stat-label">Web Filter</div>
                    <div class="stat-value">{{ filterCount }}</div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="filterCount > 0 ? 'active' : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ filterCount > 0 ? 'Active' : 'Inactive' }}
                        </span>
                    </div>
                </div>
            </div>
            <div class="col-6 col-xl-3 d-flex">
                <div class="stat-card h-100 w-100">
                    <div class="stat-icon" style="background:#FFF3E0; color:#E65100;">
                        <i class="bi bi-app-indicator" />
                    </div>
                    <div class="stat-label">Blocked Apps</div>
                    <div class="stat-value">{{ blockedCount }}</div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="blockedCount > 0 ? 'warning' : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ blockedCount > 0 ? 'Active' : 'None' }}
                        </span>
                        <span v-if="quotaCount" class="ms-1 text-muted" style="font-size:11px;">· {{ quotaCount }} day limit(s)</span>
                    </div>
                </div>
            </div>
            <div class="col-6 col-xl-3 d-flex">
                <div class="stat-card h-100 w-100">
                    <div class="stat-icon" style="background:#E8F5E9; color:#2E7D32;">
                        <i class="bi bi-clock-history" />
                    </div>
                    <div class="stat-label">Screen Time</div>
                    <div class="stat-value">{{ usageLabel }}</div>
                    <div class="stat-sub">
                        <span class="status-badge" :class="scheduleEnabled ? 'active' : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            {{ scheduleEnabled ? 'Active' : 'Disabled' }}
                        </span>
                    </div>
                </div>
            </div>
            <div class="col-6 col-xl-3 d-flex">
                <div class="stat-card h-100 w-100">
                    <div class="stat-icon" style="background:#F3E5F5; color:#6A1B9A;">
                        <i class="bi bi-lock-fill" />
                    </div>
                    <div class="stat-label">KDE Kiosk</div>
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

        <!-- Quick actions -->
        <div class="pc-card">
            <div class="pc-card-header">
                <h6>Quick Actions</h6>
            </div>
            <div class="pc-card-body d-flex flex-wrap gap-2">
                <RouterLink to="/webfilter">
                    <button class="btn-pc-outline">
                        <i class="bi bi-shield-plus me-2" />Add Web Filter Rule
                    </button>
                </RouterLink>
                <RouterLink to="/apps">
                    <button class="btn-pc-outline">
                        <i class="bi bi-app-indicator me-2" />Manage Apps
                    </button>
                </RouterLink>
                <RouterLink to="/schedules">
                    <button class="btn-pc-outline">
                        <i class="bi bi-clock me-2" />Set Screen Time
                    </button>
                </RouterLink>
                <RouterLink to="/kiosk">
                    <button class="btn-pc-outline">
                        <i class="bi bi-lock me-2" />KDE Kiosk Mode
                    </button>
                </RouterLink>
            </div>
        </div>

        <div v-if="quotaCount" class="pc-card mt-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">Limited apps — today’s usage</h6>
                <RouterLink to="/apps" class="small text-decoration-none">App Control</RouterLink>
            </div>
            <div class="pc-card-body pt-2">
                <div v-for="row in quotaSummaryRows" :key="row.appId" class="mb-3">
                    <div class="d-flex justify-content-between align-items-baseline small mb-1">
                        <span>{{ row.appName }}</span>
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

        <!-- Screen time analytics + application log -->
        <div class="pc-card mt-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">Screen time</h6>
                <div class="d-flex flex-wrap gap-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary" @click="refreshScreenCharts">
                        Refresh
                    </button>
                    <RouterLink to="/schedules" class="btn btn-sm btn-outline-primary">
                        Rules
                    </RouterLink>
                </div>
            </div>
            <div class="pc-card-body">
                <div class="row g-4 align-items-stretch">
                    <div class="col-lg-5">
                        <div class="donut-with-legend d-flex flex-column flex-md-row align-items-start justify-content-start">
                            <ul
                                v-if="donutLegend.length"
                                class="donut-legend list-unstyled small mb-0 order-2 order-md-1 flex-shrink-0 d-flex flex-column gap-1"
                            >
                                <li
                                    v-for="(row, idx) in donutLegend"
                                    :key="row.name + idx"
                                    class="donut-legend-row d-flex align-items-center gap-2"
                                >
                                    <span class="donut-swatch" :style="{ background: row.color }" />
                                    <span class="donut-legend-name text-truncate flex-grow-1" :title="row.name">{{ row.name }}</span>
                                    <span class="text-muted text-nowrap">{{ row.value }}m</span>
                                </li>
                            </ul>
                            <div class="donut-chart-side order-1 order-md-2 w-100 d-flex justify-content-center align-items-start">
                                <div
                                    class="donut-wrap"
                                    :class="{ 'donut-wrap--empty': !donutGradient }"
                                    :style="donutGradient ? { background: donutGradient } : {}"
                                >
                                    <div class="donut-hole">
                                        <div class="donut-center-value">{{ donutModel.screen }}</div>
                                        <div class="text-muted small">min today</div>
                                        <div v-if="dailyCapSubtitle" class="text-muted small mt-1">{{ dailyCapSubtitle }}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p v-if="donutModel.overlap" class="small donut-overlap-hint mt-2 mb-0">
                            Tracked app minutes can exceed session minutes when several catalog apps run at the same time.
                        </p>
                    </div>
                    <div class="col-lg-7 d-flex flex-column week-chart-col-wrap">
                        <div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
                            <h6 class="small text-muted mb-0">Last 7 days (logged minutes)</h6>
                            <div class="d-flex flex-wrap gap-3 small text-muted justify-content-end">
                                <span v-if="store.schedule?.dailyLimitEnabled">
                                    Daily cap: {{ store.schedule.dailyLimitMinutes }}m
                                    <template v-if="store.todayExtraAllowanceMinutes > 0">
                                        + {{ store.todayExtraAllowanceMinutes }}m bonus today
                                    </template>
                                </span>
                                <span v-else>No fixed daily cap (see Screen Time).</span>
                                <span v-if="weekPeakDay">{{ weekPeakDay }}</span>
                            </div>
                        </div>
                        <div class="week-chart-anchor flex-grow-1 d-flex flex-column justify-content-end">
                            <div class="week-chart d-flex gap-1 align-items-stretch">
                                <div
                                    v-for="d in weekUsage"
                                    :key="d.date"
                                    class="week-chart-col flex-fill d-flex flex-column align-items-center"
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

        <div class="pc-card mt-3">
            <div class="pc-card-header">
                <h6>Family profiles</h6>
            </div>
            <div class="pc-card-body d-flex flex-column gap-3 align-items-stretch">
                <div class="d-flex flex-wrap gap-2">
                    <template v-for="key in lifeModeKeys" :key="key">
                        <button
                            :class="key === 'school' ? 'btn-pc-primary' : 'btn-pc-outline'"
                            :disabled="modeBusy"
                            @click="onApplyLifeMode(key)"
                        >
                            <i class="bi me-2" :class="lifeModeIcon(key)" />{{ lifeModeLabels[key] || key }}
                        </button>
                    </template>
                </div>
                <label class="d-flex align-items-center gap-2 mb-0" style="cursor:pointer;font-size:13px;">
                    <input v-model="profileIncludeKiosk" type="checkbox" class="m-0" />
                    <span>Include KDE kiosk (merge current profile, or clear on Leisure)</span>
                </label>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../stores/appStore.js'
import { useKioskStore } from '../stores/kioskStore.js'
import { useModal } from '../composables/useModal.js'

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
const kioskStore = useKioskStore()
const { confirm } = useModal()
const modeBusy = ref(false)
const profileIncludeKiosk = ref(false)
const lifeModeKeys = ref(['school', 'leisure'])
const lifeModeLabels = ref({ school: 'School', leisure: 'Leisure' })
const weekUsage = ref([])

const filterCount = computed(() => store.webFilterHostRuleCount)
const blockedCount = computed(() => store.blockedApps.length)
const quotaCount = computed(() => store.appQuotas.length)
const quotaSummaryRows = computed(() => {
    const usage = store.appQuotaUsage || {}
    const rows = store.appQuotas.map(q => {
        const limit = Math.max(1, Number(q.minutesPerDay) || 1)
        const rawUsed = Number(usage[q.appId]) || 0
        const used = Math.max(0, rawUsed)
        const ratio = used / limit
        const pct = Math.min(100, Math.round(ratio * 100))
        return { appId: q.appId, appName: q.appName || q.processName, used, limit, ratio, pct }
    })
    rows.sort((a, b) => b.ratio - a.ratio)
    return rows
})
const scheduleEnabled = computed(() => store.schedule?.enabled ?? false)

const usageLabel = computed(() => {
    const s = store.schedule
    if (!s) return '–'
    if (!s.dailyLimitEnabled) return s.allowedHoursEnabled ? 'Window' : '∞'
    const used = store.todayUsageMinutes ?? 0
    return `${used}m / ${s.dailyLimitMinutes}m`
})

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
    if (!k.ok) return 'Unreadable'
    return k.active ? 'Active' : 'Inactive'
})

const donutModel = computed(() => {
    const screen = Math.max(0, Number(store.todayUsageMinutes) || 0)
    const usage = store.appMonitorUsage || {}
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
    if (other > 0) slices.push({ name: 'Other session time', value: other })
    if (slices.length === 0 && screen > 0) {
        slices.push({ name: 'Session (no catalog app usage yet)', value: screen })
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

const dailyCapSubtitle = computed(() => {
    const s = store.schedule
    if (!s?.dailyLimitEnabled) return ''
    const cap = Number(s.dailyLimitMinutes) || 0
    const extra = Math.max(0, Number(store.todayExtraAllowanceMinutes) || 0)
    if (extra > 0) return `of ${cap + extra}m cap (+bonus)`
    return `of ${cap}m cap`
})

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
    return `Peak this week: ${top.shortLabel} (${top.minutes}m)`
})

function lifeModeIcon(key) {
    if (key === 'school') return 'bi-mortarboard'
    if (key === 'leisure') return 'bi-brightness-high'
    return 'bi-sliders'
}

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
    await Promise.all([store.loadSchedule(), store.loadAppQuotas(), loadWeekUsage()])
}

onMounted(async () => {
    const lm = await window.api.lifeMode.list()
    if (lm?.modes?.length) {
        lifeModeKeys.value = lm.modes
        lifeModeLabels.value = lm.labels ?? {}
    }
    await refreshScreenCharts()
})

async function onApplyLifeMode(key) {
    const label = lifeModeLabels.value[key] || key
    let detail
    if (key === 'school') {
        detail = 'Tight weekday schedule, merge Social Media + Gaming into /etc/hosts, unblock all launcher blocks.'
    } else if (key === 'leisure') {
        detail = 'Relaxed schedule all week, remove Social/Gaming preset domains from /etc/hosts (your other rules stay), unblock all launcher blocks.'
    } else {
        detail = `Custom profile "${label}": schedule, web categories, and blocked apps from life-modes.json (unknown categories are ignored).`
    }
    if (profileIncludeKiosk.value) {
        detail += key === 'leisure'
            ? ' KDE: remove LiFE kiosk sections from kdeglobals and restart the session.'
            : ' KDE: merge current Kiosk tab profile into kdeglobals and restart the session.'
    }
    const ok = await confirm(
        `Apply ${label} profile?`,
        detail,
        { ok: 'Apply', cancel: 'Cancel' }
    )
    if (!ok) return
    modeBusy.value = true
    const result = await store.applyLifeMode(key)
    if (result?.error) {
        modeBusy.value = false
        window.alert(result.error)
        return
    }
    if (profileIncludeKiosk.value) {
        if (key === 'leisure') {
            const kr = await window.api.system.activateKiosk('')
            if (kr?.error) window.alert(`KDE kiosk: ${kr.error}`)
        } else {
            await kioskStore.init()
            const configText = await kioskStore.prepareActivation()
            const kr = await window.api.system.activateKiosk(configText)
            if (kr?.error) window.alert(`KDE kiosk: ${kr.error}`)
        }
    }
    modeBusy.value = false
    await store.refreshProtectionsState()
    await refreshScreenCharts()
}
</script>

<style scoped>
.donut-overlap-hint {
    color: #b0bec5;
}
.donut-with-legend {
    width: 100%;
    gap: 1.25rem;
}
@media (min-width: 768px) {
    .donut-with-legend {
        gap: 1.25rem 3rem;
    }
}
.donut-legend {
    width: 100%;
    max-width: 220px;
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
    flex: 1 1 auto;
    min-width: 0;
}
.donut-wrap {
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
