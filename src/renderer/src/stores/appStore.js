import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'

export const useAppStore = defineStore('app', () => {
    const webFilterEntries = ref([])
    const webFilterFeedState = ref({})
    const webFilterHostRuleCount = ref(0)
    const webFilterAllowlist = ref([])
    const blockedApps = ref([])
    const schedule = ref(null)
    const todayUsageMinutes = ref(0)
    const todayExtraAllowanceMinutes = ref(0)
    const kioskStatus = ref({ active: false, restrictionCount: 0, plasmaLayoutLocked: false, ok: true })
    const appQuotas = ref([])
    const appQuotaUsage = ref({})
    const appQuotaExtra = ref({})
    const appMonitorUsage = ref({})
    const appMonitorLabels = ref({})
    const statusMessage = ref('')
    const whitelistEnabled = ref(false)
    const runningAsRoot = ref(null)
    const xdgCurrentDesktop = ref('')

    const webFilterEnabled = computed(() =>
        webFilterEntries.value.some(e => e.enabled)
        || Object.values(webFilterFeedState.value).some(Boolean)
    )

    async function loadWebFilter() {
        const result = await window.api.webFilter.getList()
        webFilterEntries.value = result.entries ?? []
        webFilterFeedState.value = result.feedState && typeof result.feedState === 'object'
            ? { ...result.feedState }
            : {}
        webFilterHostRuleCount.value = typeof result.hostRuleCount === 'number' ? result.hostRuleCount : 0
        webFilterAllowlist.value = Array.isArray(result.listAllowlist) ? [...result.listAllowlist] : []
        return result
    }

    async function persistWebFilterAllowlist() {
        const domains = webFilterAllowlist.value.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
        const result = await window.api.webFilter.setAllowlist(domains)
        await loadWebFilter()
        return result
    }

    async function saveWebFilter() {
        // Electron IPC cannot clone Vue proxies; unwrap to plain { domain, enabled } shapes.
        const entries = webFilterEntries.value.map((e) => {
            const o = toRaw(e)
            return { domain: String(o.domain), enabled: Boolean(o.enabled) }
        })
        const result = await window.api.webFilter.setList(entries)
        return result
    }

    async function loadBlockedApps() {
        blockedApps.value = await window.api.apps.getBlocked()
    }

    async function loadSchedule() {
        const [sched, usage] = await Promise.all([window.api.schedules.get(), window.api.schedules.getUsage()])
        schedule.value = sched
        todayUsageMinutes.value = usage?.minutes ?? 0
        todayExtraAllowanceMinutes.value = usage?.extraAllowanceMinutes ?? 0
    }

    async function loadKioskStatus() {
        const result = await window.api.system.getKioskStatus()
        kioskStatus.value = {
            active: result.active ?? false,
            restrictionCount: result.restrictionCount ?? 0,
            plasmaLayoutLocked: result.plasmaLayoutLocked ?? false,
            ok: result.ok !== false,
            error: result.error
        }
        return result
    }

    async function loadAppQuotas() {
        const [list, usage, mon] = await Promise.all([
            window.api.quota.getList(),
            window.api.quota.getUsage(),
            window.api.quota.getAppMonitorUsage()
        ])
        appQuotas.value = Array.isArray(list) ? list : []
        if (usage && typeof usage === 'object' && Object.hasOwn(usage, 'usage')) {
            appQuotaUsage.value = usage.usage && typeof usage.usage === 'object' ? usage.usage : {}
            appQuotaExtra.value = usage.appExtra && typeof usage.appExtra === 'object' ? usage.appExtra : {}
        } else {
            appQuotaUsage.value = usage && typeof usage === 'object' ? usage : {}
            appQuotaExtra.value = {}
        }
        appMonitorUsage.value = mon?.usage && typeof mon.usage === 'object' ? mon.usage : {}
        appMonitorLabels.value = mon?.labels && typeof mon.labels === 'object' ? mon.labels : {}
    }

    async function applyLifeMode(modeKey) {
        return window.api.lifeMode.apply(modeKey)
    }

    async function loadProcessWhitelist() {
        const cfg = await window.api.processWhitelist.get()
        whitelistEnabled.value = cfg?.enabled === true
    }

    async function refreshProtectionsState() {
        const [info] = await Promise.all([
            window.api.system.getAppInfo(),
            Promise.all([
                loadWebFilter(), loadBlockedApps(), loadSchedule(), loadKioskStatus(), loadAppQuotas(), loadProcessWhitelist()
            ])
        ])
        runningAsRoot.value = info?.runningAsRoot ?? null
        xdgCurrentDesktop.value = info?.xdgCurrentDesktop ?? ''
    }

    return {
        webFilterEntries, webFilterFeedState, webFilterHostRuleCount, webFilterAllowlist, blockedApps, schedule, todayUsageMinutes, todayExtraAllowanceMinutes, kioskStatus,
        appQuotas, appQuotaUsage, appQuotaExtra, appMonitorUsage, appMonitorLabels, statusMessage, whitelistEnabled, runningAsRoot, xdgCurrentDesktop,
        webFilterEnabled,
        loadWebFilter, saveWebFilter, persistWebFilterAllowlist, loadBlockedApps, loadSchedule, loadKioskStatus, loadAppQuotas,
        loadProcessWhitelist, applyLifeMode, refreshProtectionsState
    }
})
