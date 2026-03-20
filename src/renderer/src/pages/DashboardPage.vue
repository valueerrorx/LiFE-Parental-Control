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

        <div class="pc-card mt-3">
            <div class="pc-card-header">
                <h6>Family profiles</h6>
            </div>
            <div class="pc-card-body d-flex flex-wrap gap-2 align-items-start">
                <p class="text-muted w-100 mb-0" style="font-size:12px;">
                    One-click: screen time + web filter (school merges Social/Gaming; leisure removes those preset domains only) + clears blocked apps. KDE kiosk unchanged.
                </p>
                <button class="btn-pc-primary" :disabled="modeBusy" @click="onApplyLifeMode('school')">
                    <i class="bi bi-mortarboard me-2" />School
                </button>
                <button class="btn-pc-outline" :disabled="modeBusy" @click="onApplyLifeMode('leisure')">
                    <i class="bi bi-brightness-high me-2" />Leisure
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../stores/appStore.js'
import { useModal } from '../composables/useModal.js'

const store = useAppStore()
const { confirm } = useModal()
const modeBusy = ref(false)

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

async function onApplyLifeMode(key) {
    const label = key === 'school' ? 'School' : 'Leisure'
    const detail = key === 'school'
        ? 'Tight weekday schedule, merge Social Media + Gaming into /etc/hosts, unblock all launcher blocks.'
        : 'Relaxed schedule all week, remove Social/Gaming preset domains from /etc/hosts (your other rules stay), unblock all launcher blocks.'
    const ok = await confirm(
        `Apply ${label} profile?`,
        detail,
        { ok: 'Apply', cancel: 'Cancel' }
    )
    if (!ok) return
    modeBusy.value = true
    const result = await store.applyLifeMode(key)
    modeBusy.value = false
    if (result?.error) window.alert(result.error)
    else await store.refreshProtectionsState()
}
</script>
