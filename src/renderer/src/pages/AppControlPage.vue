<template>
    <div class="pc-page-header d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-3">
            <label class="pc-toggle">
                <input type="checkbox" v-model="appControlEnabled" />
                <span class="slider" />
            </label>
            <div>
                <h1>{{ $t('appControl.title') }}</h1>
                <p class="mb-0">{{ $t('appControl.subtitle') }}</p>
            </div>
        </div>
        <div class="d-flex align-items-center gap-2">
            <span v-if="isDirty" class="text-danger small">{{ $t('common.unsavedChanges') }}</span>
            <span class="status-badge" :class="appControlEnabled && blockedCount > 0 ? 'warning' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ $t('appControl.blockedCount', { count: blockedCount }) }}
            </span>
            <button
                type="button"
                class="btn-pc-primary"
                :disabled="!isDirty || quotaBusy"
                :title="$t('appControl.applyTitle')"
                @click="onApplyAllQuotas"
            >
                <i class="bi bi-floppy me-1" />{{ quotaBusy ? $t('common.saving') : $t('common.applyChanges') }}
            </button>
        </div>
    </div>

    <div class="pc-content">
        <div :class="{ 'opacity-50 pe-none': !appControlEnabled }">
            <div class="pc-card">
                <div class="pc-card-header">
                    <h6>{{ $t('appControl.installedApps', { count: filtered.length }) }}</h6>
                    <input v-model="search" class="pc-input" style="width:220px;" :placeholder="$t('appControl.searchApps')" />
                </div>

                <div v-if="loading" class="pc-card-body text-center text-muted py-5">
                    <div class="spinner-border spinner-border-sm me-2" />{{ $t('common.loadingApps') }}
                </div>

                <div v-else-if="filtered.length === 0" class="pc-card-body text-center text-muted py-5">
                    <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                    <p class="mt-2">{{ $t('appControl.noAppsFound') }}</p>
                </div>

                <div v-else class="overflow-auto" style="max-height: 540px;">
                    <div v-for="app in filtered" :key="app.id" class="pc-list-item">
                        <AppListItemIcon
                            :icon-data-url="app.iconDataUrl || ''"
                            :extra-style="app.blocked ? 'background:#FFEBEE;color:#C62828;' : ''"
                        />
                        <div class="flex-grow-1">
                            <div class="item-name">{{ app.name }}</div>
                            <div class="item-sub text-truncate" style="max-width:360px;">{{ app.exec }}</div>
                        </div>
                        <span v-if="pendingBlocked.has(app.id)" class="text-muted me-2" style="font-size:11px;">{{ $t('common.unsaved') }}</span>
                        <label class="pc-toggle">
                            <input type="checkbox" :checked="app.blocked" @change="onToggle(app)" />
                            <span class="slider" />
                        </label>
                        <span v-if="app.blocked" class="status-badge warning ms-2">{{ $t('common.blocked') }}</span>
                    </div>
                </div>
            </div>

            <div class="pc-card mt-3">
                <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                    <h6 class="mb-0">{{ $t('appControl.dailyLimits') }}</h6>
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                        <div class="d-flex align-items-center gap-1">
                            <label class="small text-muted mb-0">{{ $t('appControl.showLimitsFor') }}</label>
                            <select
                                class="pc-input pc-input-sm"
                                style="min-width:140px;"
                                :value="store.quotaViewLinuxUser"
                                @change="onQuotaViewUserChange($event.target.value)"
                            >
                                <option value="">{{ $t('common.allAccounts') }}</option>
                                <option v-for="u in quotaFilterUserOptions" :key="u" :value="u">{{ u }}</option>
                            </select>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="quotaBusy" @click="onResetQuotaTodayUsage">
                            {{ $t('appControl.resetTodayUsage') }}
                        </button>
                        <span class="status-badge" :class="filteredQuotas.length > 0 ? 'active' : 'inactive'">
                            <i class="bi bi-circle-fill" style="font-size:7px;" />
                            <template v-if="quotaViewFilterActive">
                                {{ $t('appControl.appQuotasFiltered', { filtered: filteredQuotas.length, total: quotas.length }) }}
                            </template>
                            <template v-else>
                                {{ $t('appControl.appQuotas', { count: filteredQuotas.length }) }}
                            </template>
                        </span>
                    </div>
                </div>
                <div class="pc-card-body">
                    <div v-if="quotas.length" class="table-responsive mb-0">
                        <p v-if="quotaViewFilterActive && filteredQuotas.length === 0" class="small text-muted mb-2">
                            {{ $t('appControl.noQuotasForAccount') }}
                        </p>
                        <table v-if="filteredQuotas.length" class="table table-sm align-middle mb-0">
                            <thead>
                                <tr>
                                    <th>{{ $t('appControl.tableApp') }}</th>
                                    <th>{{ $t('appControl.tableLinuxAccount') }}</th>
                                    <th>{{ $t('appControl.tableProcess') }}</th>
                                    <th>{{ $t('appControl.tableLimit') }}</th>
                                    <th>{{ $t('appControl.tableUsedToday') }}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="q in filteredQuotas" :key="quotaRowKey(q)">
                                    <td>{{ q.appName }}</td>
                                    <td class="text-nowrap">{{ q.linuxUser || $t('appControl.allAccountsOption') }}</td>
                                    <td style="min-width:120px;">
                                        <input v-model="q.editProcess" type="text" class="pc-input pc-input-sm" style="width:100%;" autocomplete="off" />
                                    </td>
                                    <td style="width:110px;">
                                        <input v-model.number="q.editLimit" type="number" min="1" max="1440" class="pc-input pc-input-sm" style="width:100%;" />
                                    </td>
                                    <td>{{ $t('appControl.usedMin', { min: quotaUsedForRow(q) }) }}</td>
                                    <td class="text-nowrap">
                                        <button type="button" class="btn btn-sm btn-outline-danger" :disabled="quotaBusy" @click="onRemoveQuota(q.appId, q.linuxUser)">
                                            {{ $t('common.remove') }}
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div
                        class="d-flex flex-wrap gap-2 align-items-end"
                        :class="quotas.length ? 'mt-4 pt-3 border-top border-light' : ''"
                    >
                        <div>
                            <label class="form-label small text-muted mb-1 d-block">{{ $t('appControl.addLimitForApp') }}</label>
                            <select v-model="addAppId" class="pc-input" style="min-width:240px;">
                                <option disabled value="">{{ $t('appControl.chooseApp') }}</option>
                                <option v-for="a in appsForQuota" :key="a.id" :value="a.id">
                                    {{ a.name }} ({{ a.processName || '—' }})
                                </option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label small text-muted mb-1 d-block">{{ $t('appControl.linuxAccount') }}</label>
                            <select v-model="addLinuxUser" class="pc-input" style="min-width:180px;">
                                <option value="">{{ $t('common.allAccounts') }}</option>
                                <option v-for="u in addQuotaLinuxUserOptions" :key="u" :value="u">{{ u }}</option>
                            </select>
                        </div>
                        <div>
                            <label class="form-label small text-muted mb-1 d-block">{{ $t('appControl.minutesPerDay') }}</label>
                            <input v-model.number="addMinutes" type="number" min="1" max="1440" class="pc-input" style="width:100px;" />
                        </div>
                        <div>
                            <label class="form-label small text-muted mb-1 d-block">{{ $t('appControl.overrideProcess') }}</label>
                            <input v-model="addProcessOverride" type="text" class="pc-input" style="width:140px;" :placeholder="$t('common.optional')" autocomplete="off" />
                        </div>
                        <button type="button" class="btn-pc-primary mt-3 mt-sm-4" :disabled="quotaBusy || !addAppId || !canAddQuota" @click="onAddQuota">
                            <i class="bi bi-plus-lg me-1" />{{ $t('appControl.addLimit') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div
            v-if="applyMsg"
            class="alert mt-3 mb-0 py-2 px-3"
            style="font-size:13px;"
            :class="applyError ? 'alert-danger' : 'alert-success'"
            role="status"
        >
            <i class="bi me-1" :class="applyError ? 'bi-exclamation-circle' : 'bi-check-circle'" />{{ applyMsg }}
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import { normalizeQuotaLinuxUser, quotaUsedMinutes } from '@shared/quotaUsageKey.js'
import { useAppStore } from '../stores/appStore.js'
import { useDesktopLoginUsers, loadDesktopLoginUsers } from '../composables/useDesktopLoginUsers.js'
import AppListItemIcon from '../components/AppListItemIcon.vue'

const { t } = useI18n()
const store = useAppStore()
const { desktopLoginUsers } = useDesktopLoginUsers()
const apps = ref([])
const search = ref('')
const loading = ref(true)
const quotas = ref([])
const quotaBusy = ref(false)
const applyMsg = ref('')
const applyError = ref(false)
const pendingBlocked = ref(new Set()) // appIds with unsaved block-state changes
const addAppId = ref('')
const addMinutes = ref(60)
const addProcessOverride = ref('')
const addLinuxUser = ref('')
const appControlEnabled = ref(true)
const savedAppControlEnabled = ref(null)

const isDirty = computed(() => {
    if (savedAppControlEnabled.value === null) return false
    if (pendingBlocked.value.size > 0) return true
    if (appControlEnabled.value !== savedAppControlEnabled.value) return true
    return quotas.value.some(q => q.editLimit !== q.minutesPerDay || q.editProcess.trim() !== (q.processName || '').trim())
})

const filtered = computed(() => {
    const q = search.value.toLowerCase()
    const list = apps.value.filter(a => !q ||
        a.name.toLowerCase().includes(q) ||
        (a.exec || '').toLowerCase().includes(q) ||
        (a.processName || '').toLowerCase().includes(q))
    return [...list].sort((a, b) => {
        const aScore = a.blocked ? 0 : 1
        const bScore = b.blocked ? 0 : 1
        if (aScore !== bScore) return aScore - bScore
        return String(a.name || '').localeCompare(String(b.name || ''))
    })
})
const blockedCount = computed(() => apps.value.filter(a => a.blocked).length)

function quotaRowKey(q) {
    return `${q.appId}\0${q.linuxUser || ''}`
}

const quotaViewFilterActive = computed(() => Boolean(normalizeQuotaLinuxUser(store.quotaViewLinuxUser)))

const filteredQuotas = computed(() => {
    const f = normalizeQuotaLinuxUser(store.quotaViewLinuxUser)
    if (!f) return quotas.value
    return quotas.value.filter((q) => {
        const lu = normalizeQuotaLinuxUser(q.linuxUser)
        return !lu || lu === f
    })
})

const quotaFilterUserOptions = computed(() => {
    const set = new Set(desktopLoginUsers.value)
    for (const q of quotas.value) {
        const u = normalizeQuotaLinuxUser(q.linuxUser)
        if (u) set.add(u)
    }
    const inv = normalizeQuotaLinuxUser(store.invokingLinuxUser)
    if (inv) set.add(inv)
    const cur = normalizeQuotaLinuxUser(store.quotaViewLinuxUser)
    if (cur) set.add(cur)
    return [...set].sort((a, b) => a.localeCompare(b))
})

const addQuotaLinuxUserOptions = computed(() => {
    const set = new Set(desktopLoginUsers.value)
    for (const q of quotas.value) {
        const u = normalizeQuotaLinuxUser(q.linuxUser)
        if (u) set.add(u)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
})

function quotaUsedForRow(q) {
    return quotaUsedMinutes(store.appQuotaUsage || {}, q.appId, q.linuxUser)
}

async function onQuotaViewUserChange(raw) {
    await store.setQuotaViewLinuxUser(typeof raw === 'string' ? raw : '')
}

const appsForQuota = computed(() =>
    apps.value.filter(a => !quotas.value.some((q) => {
        const ql = normalizeQuotaLinuxUser(q.linuxUser)
        const al = normalizeQuotaLinuxUser(addLinuxUser.value)
        return q.appId === a.id && ql === al
    }))
)

const canAddQuota = computed(() => {
    const app = apps.value.find(a => a.id === addAppId.value)
    if (!app) return false
    const override = (addProcessOverride.value || '').trim()
    const auto = (app.processName || '').trim()
    return (override || auto).length > 0
})

onMounted(async () => {
    // Wait for deferred heavy init so default-rollout state is fully applied before listing apps.
    await window.api.app.deferredHeavyWork()
    const ctl = await window.api.apps.getControlConfig()
    appControlEnabled.value = ctl?.enabled !== false
    savedAppControlEnabled.value = appControlEnabled.value
    await store.loadBlockedApps()
    await loadDesktopLoginUsers()
    apps.value = await window.api.apps.list()
    await loadQuotas()
    if (!addAppId.value) addAppId.value = appsForQuota.value[0]?.id ?? ''
    loading.value = false
})

async function onResetQuotaTodayUsage() {
    if (!await confirm({ title: t('appControl.resetTodayTitle'), message: t('appControl.resetTodayMsg'), okLabel: t('appControl.reset'), danger: true })) return
    quotaBusy.value = true
    const r = await window.api.quota.resetTodayUsage()
    quotaBusy.value = false
    if (r?.error) {
        await window.api.system.showError({ title: 'LiFE Parental Control', message: r.error })
        return
    }
    await loadQuotas()
    await store.loadAppQuotas()
}

async function loadQuotas() {
    await store.loadAppQuotas()
    quotas.value = store.appQuotas.map(q => ({
        appId: q.appId,
        appName: q.appName,
        processName: q.processName,
        linuxUser: q.linuxUser || '',
        minutesPerDay: q.minutesPerDay,
        editLimit: q.minutesPerDay,
        editProcess: q.processName || ''
    }))
}

async function onAddQuota() {
    const app = apps.value.find(a => a.id === addAppId.value)
    if (!app) return
    const proc = (addProcessOverride.value || '').trim() || (app.processName || '').trim()
    if (!proc) return
    quotaBusy.value = true
    const r = await window.api.quota.setEntry({
        appId: app.id,
        appName: app.name,
        processName: proc,
        minutesPerDay: Math.max(1, Math.min(1440, Number(addMinutes.value) || 60)),
        linuxUser: addLinuxUser.value
    })
    quotaBusy.value = false
    if (r?.error) {
        await window.api.system.showError({ title: 'LiFE Parental Control', message: r.error })
        return
    }
    await loadQuotas()
    await store.loadAppQuotas()
    addAppId.value = appsForQuota.value[0]?.id ?? ''
    addProcessOverride.value = ''
}

async function onApplyAllQuotas() {
    applyMsg.value = ''
    quotaBusy.value = true

    const controlRes = await window.api.apps.setControlConfig({ enabled: appControlEnabled.value })
    if (controlRes?.error) {
        quotaBusy.value = false
        applyMsg.value = controlRes.error
        applyError.value = true
        setTimeout(() => { applyMsg.value = '' }, 5000)
        return
    }
    appControlEnabled.value = controlRes.enabled !== false

    if (!appControlEnabled.value) {
        // Disabled app control means nothing stays blocked in UI or persisted state.
        for (const app of apps.value) app.blocked = false
        pendingBlocked.value = new Set()
        store.blockedApps.splice(0, store.blockedApps.length)
    } else {
        // Apply pending app block changes first
        for (const appId of pendingBlocked.value) {
            const app = apps.value.find(a => a.id === appId)
            if (!app) continue
            const r = await window.api.apps.setBlocked(appId, app.blocked)
            if (r?.error) {
                quotaBusy.value = false
                applyMsg.value = r.error
                applyError.value = true
                setTimeout(() => { applyMsg.value = '' }, 5000)
                return
            }
            if (app.blocked) { if (!store.blockedApps.includes(appId)) store.blockedApps.push(appId) }
            else store.blockedApps.splice(store.blockedApps.indexOf(appId), 1)
        }
        pendingBlocked.value = new Set()
    }

    // Keep global UI state in sync even when there are no quotas below.
    await Promise.all([store.loadAppControlConfig(), store.loadBlockedApps()])

    if (!appControlEnabled.value) {
        await store.loadAppQuotas()
        quotas.value = []
        addAppId.value = appsForQuota.value[0]?.id ?? ''
        quotaBusy.value = false
        savedAppControlEnabled.value = appControlEnabled.value
        applyMsg.value = t('appControl.changesSaved')
        applyError.value = false
        setTimeout(() => { applyMsg.value = '' }, 4000)
        return
    }

    if (!quotas.value.length) {
        quotaBusy.value = false
        savedAppControlEnabled.value = appControlEnabled.value
        applyMsg.value = t('appControl.changesSaved')
        applyError.value = false
        setTimeout(() => { applyMsg.value = '' }, 4000)
        return
    }
    for (const q of quotas.value) {
        const minutes = Math.max(1, Math.min(1440, Number(q.editLimit) || 1))
        const proc = (q.editProcess || '').trim()
        if (!proc) {
            quotaBusy.value = false
            applyMsg.value = t('appControl.processRequired')
            applyError.value = true
            setTimeout(() => { applyMsg.value = '' }, 5000)
            return
        }
        const r = await window.api.quota.setEntry({
            appId: q.appId,
            appName: q.appName,
            processName: proc,
            minutesPerDay: minutes,
            linuxUser: q.linuxUser
        })
        if (r?.error) {
            quotaBusy.value = false
            applyMsg.value = r.error
            applyError.value = true
            setTimeout(() => { applyMsg.value = '' }, 5000)
            return
        }
        q.minutesPerDay = minutes
        q.processName = proc
    }
    await loadQuotas()
    await Promise.all([store.loadAppControlConfig(), store.loadBlockedApps(), store.loadAppQuotas()])
    quotaBusy.value = false
    savedAppControlEnabled.value = appControlEnabled.value
    applyMsg.value = t('appControl.quotaSaved')
    applyError.value = false
    setTimeout(() => { applyMsg.value = '' }, 4000)
}

async function onRemoveQuota(appId, linuxUser) {
    quotaBusy.value = true
    const r = await window.api.quota.removeEntry({ appId, linuxUser: linuxUser || '' })
    quotaBusy.value = false
    if (r?.error) {
        await window.api.system.showError({ title: 'LiFE Parental Control', message: r.error })
        return
    }
    await loadQuotas()
    await store.loadAppQuotas()
    if (!addAppId.value) addAppId.value = appsForQuota.value[0]?.id ?? ''
}

function onToggle(app) {
    app.blocked = !app.blocked
    // Track as pending: if toggled back to original state, remove from pending
    const orig = store.blockedApps.includes(app.id)
    if (app.blocked !== orig) pendingBlocked.value.add(app.id)
    else pendingBlocked.value.delete(app.id)
    pendingBlocked.value = new Set(pendingBlocked.value)
}
</script>
