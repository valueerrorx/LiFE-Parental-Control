<template>
    <div class="pc-page-header d-flex align-items-start justify-content-between">
        <div>
            <h1>App Control</h1>
            <p>Block applications from launching via desktop file overrides</p>
        </div>
        <div class="d-flex align-items-center gap-2 pt-1">
            <span class="status-badge" :class="blockedCount > 0 ? 'warning' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ blockedCount }} blocked
            </span>
            <button
                type="button"
                class="btn-pc-primary"
                :disabled="quotaBusy || quotas.length === 0"
                title="Apply all quota limits and process names in the table below"
                @click="onApplyAllQuotas"
            >
                <i class="bi bi-floppy me-1" />{{ quotaBusy ? 'Saving…' : 'Apply Changes' }}
            </button>
        </div>
    </div>

    <div class="pc-content">
        <div class="pc-card">
            <div class="pc-card-header">
                <h6>Installed Applications ({{ filtered.length }})</h6>
                <input v-model="search" class="pc-input" style="width:220px;" placeholder="Search apps…" />
            </div>

            <div v-if="loading" class="pc-card-body text-center text-muted py-5">
                <div class="spinner-border spinner-border-sm me-2" />Loading applications…
            </div>

            <div v-else-if="filtered.length === 0" class="pc-card-body text-center text-muted py-5">
                <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                <p class="mt-2">No applications found.</p>
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
                    <label class="pc-toggle">
                        <input type="checkbox" :checked="app.blocked" @change="onToggle(app)" />
                        <span class="slider" />
                    </label>
                    <span v-if="app.blocked" class="status-badge warning ms-2">Blocked</span>
                </div>
            </div>
        </div>

        <div class="pc-card mt-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">Daily time limits for individual apps</h6>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="quotaBusy" @click="onResetQuotaTodayUsage">
                        Reset today’s quota usage
                    </button>
                    <span class="status-badge" :class="quotas.length > 0 ? 'active' : 'inactive'">
                        <i class="bi bi-circle-fill" style="font-size:7px;" />
                        {{ quotas.length }} app quota(s)
                    </span>
                </div>
            </div>
            <div class="pc-card-body">
                <div v-if="quotas.length" class="table-responsive mb-0">
                    <table class="table table-sm align-middle mb-0">
                        <thead>
                            <tr>
                                <th>Application</th>
                                <th>Process</th>
                                <th>Limit (min/day)</th>
                                <th>Used today</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="q in quotas" :key="q.appId">
                                <td>{{ q.appName }}</td>
                                <td style="min-width:120px;">
                                    <input v-model="q.editProcess" type="text" class="pc-input pc-input-sm" style="width:100%;" autocomplete="off" />
                                </td>
                                <td style="width:110px;">
                                    <input v-model.number="q.editLimit" type="number" min="1" max="1440" class="pc-input pc-input-sm" style="width:100%;" />
                                </td>
                                <td>{{ store.appQuotaUsage[q.appId] ?? 0 }} min</td>
                                <td class="text-nowrap">
                                    <button type="button" class="btn btn-sm btn-outline-danger" :disabled="quotaBusy" @click="onRemoveQuota(q.appId)">
                                        Remove
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
                        <label class="form-label small text-muted mb-1 d-block">Add limit for app</label>
                        <select v-model="addAppId" class="pc-input" style="min-width:240px;">
                            <option disabled value="">Choose application…</option>
                            <option v-for="a in appsForQuota" :key="a.id" :value="a.id">
                                {{ a.name }} ({{ a.processName || '—' }})
                            </option>
                        </select>
                    </div>
                    <div>
                        <label class="form-label small text-muted mb-1 d-block">Minutes / day</label>
                        <input v-model.number="addMinutes" type="number" min="1" max="1440" class="pc-input" style="width:100px;" />
                    </div>
                    <div>
                        <label class="form-label small text-muted mb-1 d-block">Override process name</label>
                        <input v-model="addProcessOverride" type="text" class="pc-input" style="width:140px;" placeholder="optional" autocomplete="off" />
                    </div>
                    <button type="button" class="btn-pc-primary mt-3 mt-sm-4" :disabled="quotaBusy || !addAppId || !canAddQuota" @click="onAddQuota">
                        <i class="bi bi-plus-lg me-1" />Add limit
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../stores/appStore.js'
import AppListItemIcon from '../components/AppListItemIcon.vue'

const store = useAppStore()
const apps = ref([])
const search = ref('')
const loading = ref(true)
const quotas = ref([])
const quotaBusy = ref(false)
const addAppId = ref('')
const addMinutes = ref(60)
const addProcessOverride = ref('')

const filtered = computed(() => {
    const q = search.value.toLowerCase()
    return apps.value.filter(a => !q ||
        a.name.toLowerCase().includes(q) ||
        (a.exec || '').toLowerCase().includes(q) ||
        (a.processName || '').toLowerCase().includes(q))
}
)
const blockedCount = computed(() => apps.value.filter(a => a.blocked).length)

const appsForQuota = computed(() =>
    apps.value.filter(a => !quotas.value.some(q => q.appId === a.id))
)

const canAddQuota = computed(() => {
    const app = apps.value.find(a => a.id === addAppId.value)
    if (!app) return false
    const override = (addProcessOverride.value || '').trim()
    const auto = (app.processName || '').trim()
    return (override || auto).length > 0
})

onMounted(async () => {
    apps.value = await window.api.apps.list()
    await loadQuotas()
    if (!addAppId.value) addAppId.value = appsForQuota.value[0]?.id ?? ''
    loading.value = false
})

async function onResetQuotaTodayUsage() {
    if (!window.confirm('Delete today’s quota-usage file? All “used today” minutes reset to 0; cron starts counting again on the next run.')) return
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
        minutesPerDay: Math.max(1, Math.min(1440, Number(addMinutes.value) || 60))
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
    if (!quotas.value.length) return
    quotaBusy.value = true
    for (const q of quotas.value) {
        const minutes = Math.max(1, Math.min(1440, Number(q.editLimit) || 1))
        const proc = (q.editProcess || '').trim()
        if (!proc) {
            quotaBusy.value = false
            await window.api.system.showError({
                title: 'LiFE Parental Control',
                message: 'Process name is required for each row (must match a running command name for pgrep -x -i).'
            })
            return
        }
        const r = await window.api.quota.setEntry({
            appId: q.appId,
            appName: q.appName,
            processName: proc,
            minutesPerDay: minutes
        })
        if (r?.error) {
            quotaBusy.value = false
            await window.api.system.showError({ title: 'LiFE Parental Control', message: r.error })
            return
        }
        q.minutesPerDay = minutes
        q.processName = proc
    }
    await loadQuotas()
    await store.loadAppQuotas()
    quotaBusy.value = false
}

async function onRemoveQuota(appId) {
    quotaBusy.value = true
    const r = await window.api.quota.removeEntry(appId)
    quotaBusy.value = false
    if (r?.error) {
        await window.api.system.showError({ title: 'LiFE Parental Control', message: r.error })
        return
    }
    await loadQuotas()
    await store.loadAppQuotas()
    if (!addAppId.value) addAppId.value = appsForQuota.value[0]?.id ?? ''
}

async function onToggle(app) {
    const newState = !app.blocked
    const result = await window.api.apps.setBlocked(app.id, newState)
    if (!result?.error) {
        app.blocked = newState
        if (newState) store.blockedApps.push(app.id)
        else store.blockedApps.splice(store.blockedApps.indexOf(app.id), 1)
    }
}
</script>
