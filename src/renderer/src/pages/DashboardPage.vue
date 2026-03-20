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
    </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useAppStore } from '../stores/appStore.js'

const store = useAppStore()

const filterCount = computed(() => store.webFilterEntries.filter(e => e.enabled).length)
const blockedCount = computed(() => store.blockedApps.length)
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

onMounted(async () => {
    await Promise.all([
        store.loadWebFilter(),
        store.loadBlockedApps(),
        store.loadSchedule(),
        store.loadKioskStatus()
    ])
})
</script>
