<template>
    <div class="pc-page-header d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-3">
            <label class="pc-toggle">
                <input type="checkbox" v-model="config.enabled" />
                <span class="slider" />
            </label>
            <div>
                <h1>{{ $t('processWhitelist.title') }}</h1>
                <p class="mb-0" v-html="$t('processWhitelist.subtitle')" />
            </div>
        </div>
        <div class="d-flex align-items-center gap-2">
            <span v-if="isDirty" class="text-danger small">{{ $t('common.unsavedChanges') }}</span>
            <span class="status-badge" :class="config.enabled ? 'active' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ config.enabled ? $t('common.active') : $t('common.disabled') }}
            </span>
            <button class="btn-pc-primary" :disabled="!isDirty || saving" @click="onSave">
                <i class="bi bi-floppy me-1" />{{ saving ? $t('common.saving') : $t('common.applyChanges') }}
            </button>
        </div>
    </div>

    <div class="pc-content">
        <!-- App list -->
        <div class="pc-card mb-3" :class="{ 'section-disabled': !config.enabled }" :aria-disabled="!config.enabled">
            <div class="pc-card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
                <h6 class="mb-0">
                    {{ $t('processWhitelist.exemptApps') }}
                    <span class="text-muted fw-normal" style="font-size:12px;">
                        ({{ $t('processWhitelist.exemptCount', { count: effectiveExemptAppCount, total: appsWithProcess.length }) }})
                    </span>
                </h6>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <button type="button" class="btn-pc-outline btn-sm" :disabled="!config.enabled" @click="onAllowAll">{{ $t('processWhitelist.exemptAll') }}</button>
                    <button type="button" class="btn-pc-outline btn-sm" :disabled="!config.enabled" @click="onAllowNone">{{ $t('processWhitelist.exemptNone') }}</button>
                    <input v-model="search" class="pc-input" style="width:200px;" :placeholder="$t('processWhitelist.searchApps')" :disabled="!config.enabled" />
                </div>
            </div>

            <div v-if="loading" class="pc-card-body text-center text-muted py-5">
                <div class="spinner-border spinner-border-sm me-2" />{{ $t('common.loadingApps') }}
            </div>

            <div v-else-if="appsWithProcess.length === 0" class="pc-card-body text-center text-muted py-5">
                <i class="bi bi-app" style="font-size:40px;opacity:0.3;" />
                <p class="mt-2">{{ $t('processWhitelist.noAppsWithProcess') }}</p>
            </div>

            <div v-else-if="filteredApps.length === 0" class="pc-card-body text-center text-muted py-5">
                <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                <p class="mt-2">{{ $t('processWhitelist.noAppsMatch') }}</p>
            </div>

            <div v-else class="overflow-auto" style="max-height:540px;">
                <div v-for="app in filteredApps" :key="app.id" class="pc-list-item">
                    <AppListItemIcon
                        :icon-data-url="app.iconDataUrl || ''"
                        :extra-style="isEffectiveExempt(app) ? '' : 'opacity:0.85'"
                    />
                    <div class="flex-grow-1">
                        <div class="item-name">{{ app.name }}</div>
                        <div class="item-sub text-truncate" style="max-width:360px;">
                            <code>{{ app.processName }}</code>
                        </div>
                    </div>
                    <span v-if="isAppUnsaved(app)" class="text-muted me-2" style="font-size:11px;">{{ $t('common.unsaved') }}</span>
                    <label class="pc-toggle">
                        <input
                            type="checkbox"
                            :checked="isEffectiveExempt(app)"
                            :disabled="!config.enabled || isAppBlocked(app)"
                            @change="onToggleApp(app.id)"
                        />
                        <span class="slider" />
                    </label>
                    <span
                        class="status-badge ms-2"
                        :class="isAppBlocked(app) ? 'warning' : (isEffectiveExempt(app) ? 'active' : 'inactive')"
                    >
                        {{
                            isAppBlocked(app)
                                ? $t('processWhitelist.deactivatedBlocked')
                                : isEffectiveExempt(app)
                                    ? $t('processWhitelist.exempt')
                                    : $t('processWhitelist.normal')
                        }}
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
import { useI18n } from 'vue-i18n'
import AppListItemIcon from '../components/AppListItemIcon.vue'
import { useAppStore } from '../stores/appStore.js'

const { t } = useI18n()

const store = useAppStore()
const loading  = ref(true)
const saving   = ref(false)
const saveMsg  = ref('')
const saveError = ref('')
const search   = ref('')

const config = ref({ enabled: false, allowedIds: [] })
const allowedIds = ref(new Set())
const savedEnabled = ref(false)
const savedAllowedIds = ref(new Set())
const allApps = ref([])

const blockedIdSet = computed(() => new Set(store.blockedApps))

const isDirty = computed(() => {
    if (loading.value) return false
    if (config.value.enabled !== savedEnabled.value) return true
    if (allowedIds.value.size !== savedAllowedIds.value.size) return true
    for (const id of allowedIds.value) if (!savedAllowedIds.value.has(id)) return true
    return false
})

function isAppBlocked(app) {
    return Boolean(app?.blocked) || (app?.id ? blockedIdSet.value.has(app.id) : false)
}

function isEffectiveExempt(app) {
    if (!app?.id || !config.value.enabled) return false
    return allowedIds.value.has(app.id) && !isAppBlocked(app)
}

function isSavedEffectiveExempt(app) {
    if (!app?.id || !savedEnabled.value) return false
    return savedAllowedIds.value.has(app.id) && !isAppBlocked(app)
}

function isAppUnsaved(app) {
    if (!config.value.enabled || !savedEnabled.value) return false
    return isEffectiveExempt(app) !== isSavedEffectiveExempt(app)
}

// Only apps that have a known processName
const appsWithProcess = computed(() =>
    allApps.value.filter(a => a.processName && a.processName.trim().length > 0)
)

const effectiveExemptAppCount = computed(() =>
    appsWithProcess.value.filter(a => isEffectiveExempt(a)).length
)

const filteredApps = computed(() => {
    const q = search.value.toLowerCase()
    const list = q
        ? appsWithProcess.value.filter(a =>
            a.name.toLowerCase().includes(q) ||
            (a.processName || '').toLowerCase().includes(q)
        )
        : appsWithProcess.value
    const score = (app) => {
        if (isAppBlocked(app)) return 0
        if (isEffectiveExempt(app)) return 1
        return 2
    }
    return [...list].sort((a, b) => score(a) - score(b))
})

onMounted(async () => {
    // Ensure Heavy IPC + rollout/default.json are applied before reading blocked/exempt state.
    await window.api.app.deferredHeavyWork()
    const [apps, cfg] = await Promise.all([
        window.api.apps.list(),
        window.api.processWhitelist.get(),
        store.loadBlockedApps()
    ])
    allApps.value = Array.isArray(apps) ? apps : []
    config.value  = cfg ?? { enabled: false, allowedIds: [] }
    allowedIds.value = new Set(Array.isArray(cfg?.allowedIds) ? cfg.allowedIds : [])
    savedEnabled.value = config.value.enabled === true
    savedAllowedIds.value = new Set(Array.isArray(cfg?.allowedIds) ? cfg.allowedIds : [])
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
    allowedIds.value = new Set(appsWithProcess.value.filter(a => !isAppBlocked(a)).map(a => a.id))
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
        if (!config.value.enabled) allowedIds.value = new Set()
        savedEnabled.value = config.value.enabled === true
        savedAllowedIds.value = new Set(allowedIds.value)
        await store.loadProcessWhitelist()
        saveMsg.value = t('processWhitelist.exemptionsSaved')
        setTimeout(() => { saveMsg.value = '' }, 4000)
    }
}

</script>

<style scoped>
.section-disabled {
    opacity: 0.6;
}
</style>
