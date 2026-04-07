import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'

export const useAppStore = defineStore('app', () => {
    const webFilterEntries = ref([])
    const webFilterFeedState = ref({})
    const webFilterHostRuleCount = ref(0)
    const webFilterAllowlist = ref([])
    const blockedApps = ref([])
    const installedApps = ref(null) // null = not yet loaded; [] = loaded but empty
    let installedAppsPromise = null // in-flight dedup
    const appControlEnabled = ref(true)
    const quotaExemptAllowedIds = ref([])
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
    const invokingLinuxUser = ref('')
    const quotaViewLinuxUser = ref('')
    const showLockdownWizard = ref(false)

    const webFilterEnabled = ref(true)
    const webFilterDnsMode = ref('dhcp')

    async function loadWebFilter() {
        const result = await window.api.webFilter.getList()
        webFilterEnabled.value = result.enabled !== false
        webFilterEntries.value = result.entries ?? []
        webFilterFeedState.value = result.feedState && typeof result.feedState === 'object'
            ? { ...result.feedState }
            : {}
        webFilterHostRuleCount.value = typeof result.hostRuleCount === 'number' ? result.hostRuleCount : 0
        webFilterAllowlist.value = Array.isArray(result.listAllowlist) ? [...result.listAllowlist] : []
        webFilterDnsMode.value = typeof result.dnsMode === 'string' ? result.dnsMode : 'dhcp'
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

    async function saveWebFilterAll() {
        const entries = webFilterEntries.value.map((e) => {
            const o = toRaw(e)
            return { domain: String(o.domain), enabled: Boolean(o.enabled) }
        })
        const result = await window.api.webFilter.saveAll({
            enabled: webFilterEnabled.value,
            entries,
            feedState: { ...toRaw(webFilterFeedState.value) },
            listAllowlist: webFilterAllowlist.value.map(d => String(d)),
            dnsMode: webFilterDnsMode.value
        })
        if (!result?.error) await loadWebFilter()
        return result
    }

    async function loadInstalledApps() {
        if (installedAppsPromise) return installedAppsPromise
        installedAppsPromise = (async () => {
            await window.api.app.deferredHeavyWork()
            const list = await window.api.apps.list()
            installedApps.value = Array.isArray(list) ? list : []
            return installedApps.value
        })()
        return installedAppsPromise
    }

    async function loadBlockedApps() {
        blockedApps.value = await window.api.apps.getBlocked()
    }

    async function loadAppControlConfig() {
        const cfg = await window.api.apps.getControlConfig()
        appControlEnabled.value = cfg?.enabled !== false
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

    async function loadProcessWhitelist() {
        const cfg = await window.api.processWhitelist.get()
        whitelistEnabled.value = cfg?.enabled === true
        quotaExemptAllowedIds.value = Array.isArray(cfg?.allowedIds) ? [...cfg.allowedIds] : []
    }

    async function refreshProtectionsState() {
        const [info, cfg] = await Promise.all([
            window.api.system.getAppInfo(),
            window.api.settings.getConfig()
        ])
        await Promise.all([
            loadWebFilter(), loadAppControlConfig(), loadBlockedApps(), loadSchedule(), loadKioskStatus(), loadAppQuotas(), loadProcessWhitelist()
        ])
        runningAsRoot.value = info?.runningAsRoot ?? null
        xdgCurrentDesktop.value = info?.xdgCurrentDesktop ?? ''
        invokingLinuxUser.value = typeof info?.invokingLinuxUser === 'string' ? info.invokingLinuxUser : ''
        quotaViewLinuxUser.value = typeof cfg?.quotaViewLinuxUser === 'string' ? cfg.quotaViewLinuxUser : ''
    }

    async function setQuotaViewLinuxUser(username) {
        const v = typeof username === 'string' ? username.trim() : ''
        await window.api.settings.saveConfig({ quotaViewLinuxUser: v })
        quotaViewLinuxUser.value = v
    }

    return {
        webFilterEntries, webFilterFeedState, webFilterHostRuleCount, webFilterAllowlist, blockedApps, appControlEnabled, quotaExemptAllowedIds, schedule, todayUsageMinutes, todayExtraAllowanceMinutes, kioskStatus,
        appQuotas, appQuotaUsage, appQuotaExtra, appMonitorUsage, appMonitorLabels, statusMessage, whitelistEnabled, runningAsRoot, xdgCurrentDesktop,
        invokingLinuxUser, quotaViewLinuxUser,
        webFilterEnabled, webFilterDnsMode, installedApps,
        loadWebFilter, saveWebFilter, saveWebFilterAll, persistWebFilterAllowlist, loadAppControlConfig, loadBlockedApps, loadInstalledApps, loadSchedule, loadKioskStatus, loadAppQuotas,
        loadProcessWhitelist, refreshProtectionsState, setQuotaViewLinuxUser,
        showLockdownWizard
    }
})
