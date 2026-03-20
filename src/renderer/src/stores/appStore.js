import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAppStore = defineStore('app', () => {
    const webFilterEntries = ref([])
    const blockedApps = ref([])
    const schedule = ref(null)
    const todayUsageMinutes = ref(0)
    const kioskStatus = ref({ active: false, restrictionCount: 0, ok: true })
    const statusMessage = ref('')

    const webFilterEnabled = computed(() => webFilterEntries.value.some(e => e.enabled))

    async function loadWebFilter() {
        const result = await window.api.webFilter.getList()
        webFilterEntries.value = result.entries ?? []
        return result
    }

    async function saveWebFilter() {
        const result = await window.api.webFilter.setList(webFilterEntries.value)
        return result
    }

    async function loadBlockedApps() {
        blockedApps.value = await window.api.apps.getBlocked()
    }

    async function loadSchedule() {
        const [sched, usage] = await Promise.all([window.api.schedules.get(), window.api.schedules.getUsage()])
        schedule.value = sched
        todayUsageMinutes.value = usage?.minutes ?? 0
    }

    async function loadKioskStatus() {
        const result = await window.api.system.getKioskStatus()
        kioskStatus.value = {
            active: result.active ?? false,
            restrictionCount: result.restrictionCount ?? 0,
            ok: result.ok !== false,
            error: result.error
        }
        return result
    }

    async function applyLifeMode(modeKey) {
        return window.api.lifeMode.apply(modeKey)
    }

    async function refreshProtectionsState() {
        await Promise.all([loadWebFilter(), loadBlockedApps(), loadSchedule(), loadKioskStatus()])
    }

    return {
        webFilterEntries, blockedApps, schedule, todayUsageMinutes, kioskStatus, statusMessage,
        webFilterEnabled,
        loadWebFilter, saveWebFilter, loadBlockedApps, loadSchedule, loadKioskStatus,
        applyLifeMode, refreshProtectionsState
    }
})
