<template>
    <div class="pc-page-header d-flex align-items-start justify-content-between">
        <div>
            <h1>Quota exemptions</h1>
            <p>Apps exempt from <strong>daily app quota</strong> enforcement when time is used up</p>
        </div>
        <div class="d-flex align-items-center gap-2 pt-1">
            <span class="status-badge" :class="config.enabled ? 'active' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ config.enabled ? 'Active' : 'Disabled' }}
            </span>
            <button class="btn-pc-primary" :disabled="saving" @click="onSave">
                <i class="bi bi-floppy me-1" />{{ saving ? 'Saving…' : 'Apply Changes' }}
            </button>
        </div>
    </div>

    <div class="pc-content">
        <!-- Master toggle -->
        <div class="pc-card mb-3">
            <div class="pc-card-body d-flex align-items-center justify-content-between">
                <div>
                    <div class="fw-semibold">Enable quota exemptions</div>
                    <div class="text-muted" style="font-size:12px;">
                        When on, checked apps are <strong>not killed</strong> when their daily app quota
                        is exhausted (same minute-based job as <strong>App Control</strong>).
                        Unchecked apps behave as before. Nothing is blocked from running only because it
                        is missing from this list.
                    </div>
                </div>
                <label class="pc-toggle">
                    <input type="checkbox" v-model="config.enabled" />
                    <span class="slider" />
                </label>
            </div>
        </div>

        <!-- App list -->
        <div class="pc-card mb-3">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">
                    Exempt applications
                    <span class="text-muted fw-normal" style="font-size:12px;">
                        ({{ allowedIds.size }} / {{ appsWithProcess.length }} exempt when limit reached)
                    </span>
                </h6>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <button type="button" class="btn-pc-outline btn-sm" @click="onAllowAll">Exempt all</button>
                    <button type="button" class="btn-pc-outline btn-sm" @click="onAllowNone">Exempt none</button>
                    <input v-model="search" class="pc-input" style="width:200px;" placeholder="Search apps…" />
                </div>
            </div>

            <div v-if="loading" class="pc-card-body text-center text-muted py-5">
                <div class="spinner-border spinner-border-sm me-2" />Loading applications…
            </div>

            <div v-else-if="appsWithProcess.length === 0" class="pc-card-body text-center text-muted py-5">
                <i class="bi bi-app" style="font-size:40px;opacity:0.3;" />
                <p class="mt-2">No applications with a known process name found.</p>
            </div>

            <div v-else-if="filteredApps.length === 0" class="pc-card-body text-center text-muted py-5">
                <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                <p class="mt-2">No applications match your search.</p>
            </div>

            <div v-else class="overflow-auto" style="max-height:540px;">
                <div v-for="app in filteredApps" :key="app.id" class="pc-list-item">
                    <AppListItemIcon
                        :icon-data-url="app.iconDataUrl || ''"
                        :extra-style="allowedIds.has(app.id) ? '' : 'opacity:0.85'"
                    />
                    <div class="flex-grow-1">
                        <div class="item-name">{{ app.name }}</div>
                        <div class="item-sub text-truncate" style="max-width:360px;">
                            <code>{{ app.processName }}</code>
                        </div>
                    </div>
                    <label class="pc-toggle">
                        <input
                            type="checkbox"
                            :checked="allowedIds.has(app.id)"
                            @change="onToggleApp(app.id)"
                        />
                        <span class="slider" />
                    </label>
                    <span
                        class="status-badge ms-2"
                        :class="allowedIds.has(app.id) ? 'active' : 'inactive'"
                    >
                        {{ allowedIds.has(app.id) ? 'Exempt' : 'Normal' }}
                    </span>
                </div>
            </div>
        </div>

        <!-- Feedback -->
        <div v-if="saveMsg" class="alert alert-success py-2 px-3 mb-3" style="font-size:13px;">
            <i class="bi bi-check-circle me-1" />{{ saveMsg }}
        </div>
        <div v-if="saveError" class="alert alert-danger py-2 px-3 mb-3" style="font-size:13px;">
            <i class="bi bi-exclamation-triangle me-1" />{{ saveError }}
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import AppListItemIcon from '../components/AppListItemIcon.vue'
import { useAppStore } from '../stores/appStore.js'

const store = useAppStore()
const loading  = ref(true)
const saving   = ref(false)
const saveMsg  = ref('')
const saveError = ref('')
const search   = ref('')

const config = ref({ enabled: false, allowedIds: [] })
const allowedIds = ref(new Set())
const allApps = ref([])

// Only apps that have a known processName
const appsWithProcess = computed(() =>
    allApps.value.filter(a => a.processName && a.processName.trim().length > 0)
)

const filteredApps = computed(() => {
    const q = search.value.toLowerCase()
    if (!q) return appsWithProcess.value
    return appsWithProcess.value.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.processName || '').toLowerCase().includes(q)
    )
})

onMounted(async () => {
    const [apps, cfg] = await Promise.all([
        window.api.apps.list(),
        window.api.processWhitelist.get()
    ])
    allApps.value = Array.isArray(apps) ? apps : []
    config.value  = cfg ?? { enabled: false, allowedIds: [] }
    allowedIds.value = new Set(Array.isArray(cfg?.allowedIds) ? cfg.allowedIds : [])
    loading.value = false
})

function onToggleApp(appId) {
    if (allowedIds.value.has(appId)) {
        allowedIds.value.delete(appId)
    } else {
        allowedIds.value.add(appId)
    }
    // Trigger reactivity by replacing the Set reference
    allowedIds.value = new Set(allowedIds.value)
}

function onAllowAll() {
    allowedIds.value = new Set(appsWithProcess.value.map(a => a.id))
}

function onAllowNone() {
    allowedIds.value = new Set()
}

async function onSave() {
    saving.value   = true
    saveMsg.value  = ''
    saveError.value = ''

    const r = await window.api.processWhitelist.save({
        enabled:    config.value.enabled,
        allowedIds: [...allowedIds.value]
    })

    saving.value = false
    if (r?.error) {
        saveError.value = r.error
    } else {
        await store.loadProcessWhitelist()
        saveMsg.value = 'Quota exemptions applied; quota script updated.'
        setTimeout(() => { saveMsg.value = '' }, 4000)
    }
}

</script>
