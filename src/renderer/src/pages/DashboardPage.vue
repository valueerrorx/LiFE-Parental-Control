<template>
    <div class="pc-page-header">
        <h1>Dashboard</h1>
        <p>Overview of active protections</p>
    </div>

    <div class="pc-content">
        <!-- Status cards row -->
        <div class="row g-3 mb-4">
            <div class="col-6 col-xl-3">
                <div class="stat-card">
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
            <div class="col-6 col-xl-3">
                <div class="stat-card">
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
            <div class="col-6 col-xl-3">
                <div class="stat-card">
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
            <div class="col-6 col-xl-3">
                <div class="stat-card">
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
                <h6 class="mb-0">App time limits (today)</h6>
                <RouterLink to="/apps" class="small text-decoration-none">App Control</RouterLink>
            </div>
            <div class="pc-card-body pt-2">
                <p class="text-muted small mb-3">
                    Bars use today’s quota usage file; enforcement on the device matches the process name from
                    <RouterLink to="/apps" class="text-decoration-none">App Control</RouterLink>
                    (<code>pgrep -x -i</code>).
                    To clear today’s tallies, use <strong>Reset today’s quota usage</strong> on that page (screen time has an equivalent for <code>usage-*</code>).
                </p>
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

        <div class="pc-card mt-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">Recent activity</h6>
                <button type="button" class="btn btn-sm btn-outline-secondary" @click="loadActivity">
                    Refresh
                </button>
            </div>
            <div class="pc-card-body pt-2">
                <p class="text-muted small mb-2">
                    Backup import/export, process whitelist, screen time &amp; quota actions (<code>/etc/life-parental/activity-log.json</code>, last 400 events).
                </p>
                <div v-if="activityEntries.length === 0" class="text-muted small mb-0">No entries yet.</div>
                <ul v-else class="list-unstyled mb-0 small" style="max-height:220px;overflow-y:auto;">
                    <li v-for="(e, idx) in activityEntries" :key="idx" class="mb-2 pb-2 border-bottom border-light">
                        <div class="text-muted" style="font-size:11px;">{{ formatActivityTime(e.t) }}</div>
                        <div>{{ activityLabel(e) }}</div>
                    </li>
                </ul>
            </div>
        </div>

        <div class="pc-card mt-3">
            <div class="pc-card-header">
                <h6>Family profiles</h6>
            </div>
            <div class="pc-card-body d-flex flex-wrap gap-2 align-items-start">
                <p class="text-muted w-100 mb-0" style="font-size:12px;">
                    Built-in School / Leisure plus optional custom modes from <code>/etc/life-parental/life-modes.json</code> (see Settings).
                    Optional KDE kiosk merge (or clear on Leisure) restarts the session.
                </p>
                <label class="d-flex align-items-center gap-2 w-100 mb-1" style="cursor:pointer;font-size:13px;">
                    <input v-model="profileIncludeKiosk" type="checkbox" class="m-0" />
                    <span>Include KDE kiosk (merge current profile, or clear on Leisure)</span>
                </label>
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
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../stores/appStore.js'
import { useKioskStore } from '../stores/kioskStore.js'
import { useModal } from '../composables/useModal.js'

const store = useAppStore()
const kioskStore = useKioskStore()
const { confirm } = useModal()
const modeBusy = ref(false)
const profileIncludeKiosk = ref(false)
const lifeModeKeys = ref(['school', 'leisure'])
const lifeModeLabels = ref({ school: 'School', leisure: 'Leisure' })
const activityEntries = ref([])

const filterCount = computed(() => store.webFilterEntries.filter(e => e.enabled).length)
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

function lifeModeIcon(key) {
    if (key === 'school') return 'bi-mortarboard'
    if (key === 'leisure') return 'bi-brightness-high'
    return 'bi-sliders'
}

function formatActivityTime(iso) {
    try {
        return new Date(iso).toLocaleString()
    } catch {
        return iso || '—'
    }
}

function activityLabel(e) {
    switch (e.action) {
    case 'screen_time_bonus':
        return `Screen time bonus: -${e.granted ?? '?'} min logged (now ${e.minutesAfter ?? '--'} min today)`
    case 'screen_time_reset_today':
        return "Screen time: today's usage file cleared"
    case 'quota_reset_today':
        return "App quotas: today's usage file cleared"
    case 'backup_export':
        return `Settings backup exported (${e.file || 'file'})`
    case 'backup_import':
        return `Settings backup imported (${e.file || 'file'})`
    case 'process_whitelist_save':
        return `Process whitelist saved (on: ${e.enabled ? 'yes' : 'no'}, ${e.allowedIds ?? 0} apps, ${e.killNames ?? 0} kill names)`
    case 'process_whitelist_redeploy':
        return 'Process whitelist: cron/script rewritten from disk'
    default:
        return typeof e.action === 'string' ? e.action : JSON.stringify(e)
    }
}

async function loadActivity() {
    const r = await window.api.activity.list(25)
    activityEntries.value = Array.isArray(r?.entries) ? r.entries : []
}

onMounted(async () => {
    const lm = await window.api.lifeMode.list()
    if (lm?.modes?.length) {
        lifeModeKeys.value = lm.modes
        lifeModeLabels.value = lm.labels ?? {}
    }
    await loadActivity()
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
    await loadActivity()
}
</script>
