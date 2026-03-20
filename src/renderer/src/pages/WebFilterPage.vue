<template>
    <div class="pc-page-header d-flex align-items-start justify-content-between">
        <div>
            <h1>Web Filter</h1>
            <p>Block websites and domains via /etc/hosts</p>
        </div>
        <div class="d-flex align-items-center gap-3 pt-1">
            <span class="status-badge" :class="activeRuleCount > 0 ? 'active' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ activeRuleCount > 0 ? `${activeRuleCount} /etc/hosts rules` : 'No active rules' }}
            </span>
            <button class="btn-pc-primary" @click="onSave" :disabled="saving">
                <i class="bi bi-floppy me-1" />{{ saving ? 'Saving…' : 'Apply Changes' }}
            </button>
        </div>
    </div>

    <div class="pc-content">
        <div v-if="hostsBackupWarning" class="alert alert-warning py-2 px-3 mb-3" style="font-size:13px;">
            <i class="bi bi-exclamation-triangle me-2" />{{ hostsBackupWarning }}
        </div>
        <div class="row g-3 align-items-start">
            <!-- Domain list -->
            <div class="col-8">
                <div class="pc-card">
                    <div class="pc-card-header">
                        <h6>Custom domains ({{ search ? `${filteredEntries.length} / ${entries.length}` : entries.length }})</h6>
                        <div class="d-flex gap-2 flex-wrap">
                            <input
                                v-model="search"
                                class="pc-input"
                                style="width:170px;"
                                placeholder="Search domains…"
                            />
                            <input
                                v-model="newDomain"
                                class="pc-input"
                                style="width:190px;"
                                placeholder="e.g. facebook.com"
                                @keyup.enter="onAdd"
                            />
                            <button type="button" class="btn-pc-primary" @click="onAdd">
                                <i class="bi bi-plus-lg me-1" />Block host
                            </button>
                        </div>
                    </div>

                    <div v-if="entries.length === 0" class="pc-card-body text-center text-muted py-5">
                        <i class="bi bi-shield-check" style="font-size:40px;opacity:0.3;" />
                        <p class="mt-2">No custom domains yet. Add below or enable category lists (HaGeZi) in Quick Add.</p>
                    </div>

                    <div v-else-if="filteredEntries.length === 0" class="pc-card-body text-center text-muted py-5">
                        <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                        <p class="mt-2">No domains match "{{ search }}".</p>
                    </div>

                    <div v-else class="pc-scroll-list">
                        <div v-for="entry in filteredEntries" :key="entry.domain" class="pc-list-item pc-list-item--compact">
                            <div class="item-icon">
                                <i class="bi bi-globe" />
                            </div>
                            <div class="flex-grow-1">
                                <div class="item-name">{{ entry.domain }}</div>
                            </div>
                            <label class="pc-toggle me-3">
                                <input type="checkbox" v-model="entry.enabled" />
                                <span class="slider" />
                            </label>
                            <button class="btn-pc-danger" style="padding:4px 10px;" @click="onRemove(entry)">
                                <i class="bi bi-trash" />
                            </button>
                        </div>
                    </div>
                </div>
                <div class="pc-card mt-3">
                    <div class="pc-card-header">
                        <h6>Allow exceptions ({{ allowSearch ? `${filteredAllowlist.length} / ${allowlist.length}` : allowlist.length }})</h6>
                        <div class="d-flex gap-2 flex-wrap">
                            <input
                                v-model="allowSearch"
                                class="pc-input"
                                style="width:170px;"
                                placeholder="Search hosts…"
                            />
                            <input
                                v-model="allowNewDomain"
                                class="pc-input"
                                style="width:190px;"
                                placeholder="e.g. reddit.com"
                                :disabled="saving"
                                @keyup.enter="onAddAllow"
                            />
                            <button type="button" class="btn-pc-primary" :disabled="saving" @click="onAddAllow">
                                <i class="bi bi-plus-lg me-1" />Allow host
                            </button>
                        </div>
                    </div>
                    <div v-if="!allowlist.length" class="pc-card-body text-center text-muted py-5">
                        <i class="bi bi-shield-check" style="font-size:40px;opacity:0.3;" />
                        <p class="mt-2">No exceptions yet.</p>
                    </div>
                    <div v-else-if="filteredAllowlist.length === 0" class="pc-card-body text-center text-muted py-5">
                        <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                        <p class="mt-2">No hosts match "{{ allowSearch }}".</p>
                    </div>
                    <div v-else class="pc-scroll-list">
                        <div v-for="h in filteredAllowlist" :key="h" class="pc-list-item pc-list-item--compact">
                            <div class="item-icon">
                                <i class="bi bi-globe" />
                            </div>
                            <div class="flex-grow-1">
                                <div class="item-name">{{ h }}</div>
                            </div>
                            <button type="button" class="btn-pc-danger" style="padding:4px 10px;" :disabled="saving" @click="onRemoveAllow(h)">
                                <i class="bi bi-trash" />
                            </button>
                        </div>
                    </div>
                </div>
                <div
                    v-if="saveMsg"
                    class="alert mt-3 mb-0 py-2 px-3"
                    style="font-size: 13px;"
                    :class="saveError ? 'alert-danger' : 'alert-success'"
                    role="status"
                >
                    <i class="bi me-1" :class="saveError ? 'bi-exclamation-circle' : 'bi-check-circle'" />
                    {{ saveMsg }}
                </div>
            </div>

            <!-- Quick add categories -->
            <div class="col-4">
                <div class="pc-card">
                    <div class="pc-card-header">
                        <h6>Quick Add Categories</h6>
                    </div>
                    <div class="pc-card-body d-flex flex-column gap-2">
                        <button
                            v-for="cat in staticQuickCats"
                            :key="'static-' + cat"
                            type="button"
                            class="text-start btn-pc-outline"
                            :disabled="saving"
                            @click="onQuickCategory(cat)"
                        >
                            <i class="bi me-2" :class="categoryIcon(cat)" />
                            Add {{ cat }}
                        </button>
                        <hr
                            v-if="staticQuickCats.length && hageziQuickCats.length"
                            class="my-2 opacity-50"
                        />
                        <div
                            v-if="hageziQuickCats.length"
                            class="d-flex align-items-center justify-content-between gap-2 flex-wrap"
                        >
                            <h6 class="mb-0 webfilter-hagezi-subhead">HaGeZi lists</h6>
                            <button
                                type="button"
                                class="btn-pc-outline flex-shrink-0"
                                title="Download newer HaGeZi list versions when online (see README)"
                                :disabled="saving"
                                @click="onSyncFeeds"
                            >
                                <i class="bi bi-cloud-download me-1" />Update lists
                            </button>
                        </div>
                        <button
                            v-for="cat in hageziQuickCats"
                            :key="'hagezi-' + cat"
                            type="button"
                            class="text-start"
                            :class="feedOn(categoryFeedId(cat)) ? 'btn-pc-success-active' : 'btn-pc-outline'"
                            :disabled="saving"
                            @click="onQuickCategory(cat)"
                        >
                            <template v-if="feedOn(categoryFeedId(cat))">
                                <i class="bi bi-check-lg me-2" />
                                Disable {{ cat }}
                            </template>
                            <template v-else>
                                <i class="bi me-2" :class="categoryIcon(cat)" />
                                Enable {{ cat }}
                            </template>
                        </button>
                        <hr class="my-1" />
                        <button class="btn-pc-danger" :disabled="saving" @click="onClearAll">
                            <i class="bi bi-trash me-1" />Clear All Rules
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../stores/appStore.js'

const store = useAppStore()
const entries = computed(() => store.webFilterEntries)
const categories = ref([])
const newDomain = ref('')
const search = ref('')
const saving = ref(false)
const allowNewDomain = ref('')
const allowSearch = ref('')
const allowlist = computed(() => store.webFilterAllowlist)

const filteredAllowlist = computed(() => {
    const q = allowSearch.value.trim().toLowerCase()
    if (!q) return allowlist.value
    return allowlist.value.filter((h) => h.includes(q))
})

const filteredEntries = computed(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return entries.value
    return entries.value.filter(e => e.domain.includes(q))
})
const saveMsg = ref('')
const saveError = ref(false)
const hostsBackupWarning = ref('')

const activeRuleCount = computed(() => store.webFilterHostRuleCount)

const CATEGORY_FEED = {
    'Social Media': 'social',
    'Adult Content': 'nsfw',
    'Fake & Scams': 'fake',
    Gambling: 'gambling',
    'Pop-up Ads': 'popupads',
    'Anti-Piracy': 'anti_piracy'
}

const CATEGORY_ICONS = {
    'Social Media': 'bi-people',
    'Video Streaming': 'bi-play-circle',
    Gaming: 'bi-controller',
    'Adult Content': 'bi-eye-slash',
    'Fake & Scams': 'bi-shield-exclamation',
    Gambling: 'bi-suit-diamond',
    'Pop-up Ads': 'bi-window-stack',
    'Anti-Piracy': 'bi-ban'
}
const categoryIcon = (cat) => CATEGORY_ICONS[cat] ?? 'bi-tag'
const categoryFeedId = (cat) => CATEGORY_FEED[cat] ?? null
const feedOn = (fid) => Boolean(store.webFilterFeedState[fid])

// Preserve server order: small domain packs first, then HaGeZi feeds (see WEB_FILTER_QUICK_ADD_ORDER).
const staticQuickCats = computed(() => categories.value.filter((c) => !categoryFeedId(c)))
const hageziQuickCats = computed(() => categories.value.filter((c) => categoryFeedId(c)))

onMounted(async () => {
    const result = await store.loadWebFilter()
    categories.value = result.categories ?? []
    hostsBackupWarning.value = result.error || ''
})

function onAdd() {
    const d = newDomain.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!d) return
    if (entries.value.find(e => e.domain === d)) {
        saveMsg.value = `"${d}" is already in the list`
        saveError.value = true
        setTimeout(() => { saveMsg.value = '' }, 3000)
        return
    }
    store.webFilterEntries.push({ domain: d, enabled: true })
    newDomain.value = ''
}

function onRemove(entry) {
    const idx = store.webFilterEntries.indexOf(entry)
    if (idx >= 0) store.webFilterEntries.splice(idx, 1)
}

async function onQuickCategory(cat) {
    const fid = categoryFeedId(cat)
    saving.value = true
    let result
    if (fid && feedOn(fid)) {
        result = await window.api.webFilter.setFeedEnabled(fid, false)
    } else {
        result = await window.api.webFilter.addCategory(cat)
    }
    await store.loadWebFilter()
    saving.value = false
    if (result?.error) { saveMsg.value = `Error: ${result.error}`; saveError.value = true }
    else if (fid) {
        saveMsg.value = store.webFilterFeedState[fid]
            ? `Enabled HaGeZi list: ${cat}`
            : `Disabled HaGeZi list: ${cat}`
        saveError.value = false
    } else {
        saveMsg.value = `Added ${result?.added ?? 0} new domains from "${cat}"`
        saveError.value = false
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onSave() {
    saving.value = true
    const result = await store.saveWebFilter()
    saving.value = false
    if (result?.error) { saveMsg.value = `Error: ${result.error}`; saveError.value = true }
    else {
        saveMsg.value = 'Rules applied to /etc/hosts — DNS cache flushed'
        saveError.value = false
        hostsBackupWarning.value = ''
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onClearAll() {
    const n = entries.value.length + Object.values(store.webFilterFeedState).filter(Boolean).length
    if (!window.confirm(`Clear all custom domains and disable all category lists (${n} sources)? This writes immediately to /etc/hosts and webfilter.json.`)) return
    saving.value = true
    const r = await window.api.webFilter.clearAll()
    saving.value = false
    if (r?.error) {
        saveMsg.value = `Error: ${r.error}`
        saveError.value = true
    } else {
        await store.loadWebFilter()
        search.value = ''
        saveMsg.value = 'All web filter rules cleared'
        saveError.value = false
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onAddAllow() {
    const d = allowNewDomain.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split('/')[0]
    if (!d) return
    if (allowlist.value.includes(d)) {
        saveMsg.value = `"${d}" is already allowed`
        saveError.value = true
        setTimeout(() => { saveMsg.value = '' }, 3000)
        return
    }
    store.webFilterAllowlist.push(d)
    allowNewDomain.value = ''
    saving.value = true
    const r = await store.persistWebFilterAllowlist()
    saving.value = false
    if (r?.error) {
        store.webFilterAllowlist.pop()
        saveMsg.value = `Error: ${r.error}`
        saveError.value = true
    } else {
        saveMsg.value = `Allowed: ${d} (removed from block set if present)`
        saveError.value = false
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onRemoveAllow(h) {
    const idx = store.webFilterAllowlist.indexOf(h)
    if (idx < 0) return
    saving.value = true
    store.webFilterAllowlist.splice(idx, 1)
    const r = await store.persistWebFilterAllowlist()
    saving.value = false
    if (r?.error) {
        store.webFilterAllowlist.splice(idx, 0, h)
        saveMsg.value = `Error: ${r.error}`
        saveError.value = true
    } else {
        saveMsg.value = `Removed exception: ${h}`
        saveError.value = false
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onSyncFeeds() {
    saving.value = true
    saveMsg.value = ''
    const r = await window.api.webFilter.syncFeeds()
    await store.loadWebFilter()
    saving.value = false
    if (r?.error) {
        saveMsg.value = `Update: ${r.error}`
        saveError.value = true
    } else {
        const u = r?.updated?.length ? ` updated ${r.updated.join(', ')}` : ''
        const e = r?.errors?.length ? ` — warnings: ${r.errors.join('; ')}` : ''
        saveMsg.value = `List files synced.${u}${e}`
        saveError.value = Boolean(r?.errors?.length)
    }
    setTimeout(() => { saveMsg.value = '' }, 6000)
}
</script>

<style scoped>
/* Subhead beside Update lists; aligns visually with pc-card-header h6. */
.webfilter-hagezi-subhead {
    font-size: 14px;
    font-weight: 600;
    color: var(--pc-text);
}

</style>
