<template>
    <div class="pc-page-header d-flex align-items-start justify-content-between">
        <div>
            <h1>Web Filter</h1>
            <p>Block websites and domains via /etc/hosts</p>
        </div>
        <div class="d-flex align-items-center gap-3 pt-1">
            <span class="status-badge" :class="activeCount > 0 ? 'active' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ activeCount > 0 ? `${activeCount} active rules` : 'No active rules' }}
            </span>
            <button type="button" class="btn-pc-outline" @click="onReapplyFromMirror" :disabled="saving">
                <i class="bi bi-arrow-counterclockwise me-1" />Sync from disk
            </button>
            <button class="btn-pc-primary" @click="onSave" :disabled="saving">
                <i class="bi bi-floppy me-1" />{{ saving ? 'Saving…' : 'Apply Changes' }}
            </button>
        </div>
    </div>

    <div class="pc-content">
        <div v-if="hostsBackupWarning" class="alert alert-warning py-2 px-3 mb-3" style="font-size:13px;">
            <i class="bi bi-exclamation-triangle me-2" />{{ hostsBackupWarning }}
        </div>
        <div class="row g-3">
            <!-- Domain list -->
            <div class="col-8">
                <div class="pc-card h-100">
                    <div class="pc-card-header">
                        <h6>Blocked Domains ({{ search ? `${filteredEntries.length} / ${entries.length}` : entries.length }})</h6>
                        <div class="d-flex gap-2">
                            <input v-model="search" class="pc-input" style="width:170px;"
                                   placeholder="Search domains…" />
                            <input v-model="newDomain" class="pc-input" style="width:190px;"
                                   placeholder="e.g. facebook.com" @keyup.enter="onAdd" />
                            <button class="btn-pc-primary" @click="onAdd">
                                <i class="bi bi-plus-lg" />
                            </button>
                        </div>
                    </div>

                    <div v-if="entries.length === 0" class="pc-card-body text-center text-muted py-5">
                        <i class="bi bi-shield-check" style="font-size:40px;opacity:0.3;" />
                        <p class="mt-2">No rules yet. Add a domain or use the Quick Add panel.</p>
                    </div>

                    <div v-else-if="filteredEntries.length === 0" class="pc-card-body text-center text-muted py-5">
                        <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                        <p class="mt-2">No domains match "{{ search }}".</p>
                    </div>

                    <div v-else class="overflow-auto" style="max-height: 480px;">
                        <div v-for="entry in filteredEntries" :key="entry.domain" class="pc-list-item">
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
            </div>

            <!-- Quick add categories -->
            <div class="col-4">
                <div class="pc-card">
                    <div class="pc-card-header">
                        <h6>Quick Add Categories</h6>
                    </div>
                    <div class="pc-card-body d-flex flex-column gap-2">
                        <p class="text-muted" style="font-size:12px;">Add predefined lists of domains for common categories.</p>
                        <button
                            v-for="cat in categories"
                            :key="cat"
                            class="btn-pc-outline text-start"
                            @click="onAddCategory(cat)"
                        >
                            <i class="bi me-2" :class="categoryIcon(cat)" />{{ cat }}
                        </button>
                        <hr class="my-1" />
                        <button class="btn-pc-danger" @click="onClearAll">
                            <i class="bi bi-trash me-1" />Clear All Rules
                        </button>
                    </div>
                </div>

                <div class="pc-card mt-3">
                    <div class="pc-card-header"><h6>Info</h6></div>
                    <div class="pc-card-body text-muted" style="font-size:12px; line-height:1.7;">
                        Rules are written to <code>/etc/hosts</code> and mirrored in <code>webfilter.json</code>.
                        <strong>Sync from disk</strong> reloads the in-app list from mirror and rewrites the hosts block (drops unsaved edits).
                        DNS cache is flushed on apply. Blocked domains use <code>0.0.0.0</code>.
                    </div>
                </div>
            </div>
        </div>

        <p v-if="saveMsg" class="mt-3" :class="saveError ? 'text-danger' : 'text-success'">
            <i class="bi me-1" :class="saveError ? 'bi-exclamation-circle' : 'bi-check-circle'" />
            {{ saveMsg }}
        </p>
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

const filteredEntries = computed(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return entries.value
    return entries.value.filter(e => e.domain.includes(q))
})
const saveMsg = ref('')
const saveError = ref(false)
const hostsBackupWarning = ref('')

const activeCount = computed(() => entries.value.filter(e => e.enabled).length)

const CATEGORY_ICONS = {
    'Social Media': 'bi-people',
    'Video Streaming': 'bi-play-circle',
    'Gaming': 'bi-controller',
    'Adult Content': 'bi-eye-slash'
}
const categoryIcon = (cat) => CATEGORY_ICONS[cat] ?? 'bi-tag'

onMounted(async () => {
    const result = await store.loadWebFilter()
    categories.value = result.categories ?? []
    hostsBackupWarning.value = result.source === 'mirror' && result.error ? result.error : ''
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

async function onAddCategory(cat) {
    saving.value = true
    const result = await window.api.webFilter.addCategory(cat)
    await store.loadWebFilter()
    saving.value = false
    if (result?.error) { saveMsg.value = `Error: ${result.error}`; saveError.value = true }
    else { saveMsg.value = `Added ${result?.added ?? 0} new domains from "${cat}"`; saveError.value = false }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onReapplyFromMirror() {
    if (!window.confirm('Reload rules from webfilter.json and rewrite /etc/hosts? Unsaved changes in this page will be lost.')) return
    saving.value = true
    saveMsg.value = ''
    const r = await window.api.webFilter.reapplyMirror()
    saving.value = false
    if (r?.error) {
        saveMsg.value = `Error: ${r.error}`
        saveError.value = true
    } else {
        await store.loadWebFilter()
        saveMsg.value = 'Hosts block synced from webfilter.json — list reloaded'
        saveError.value = false
        hostsBackupWarning.value = ''
    }
    setTimeout(() => { saveMsg.value = '' }, 5000)
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

function onClearAll() {
    if (!window.confirm(`Remove all ${entries.value.length} blocked domain rules? (Unsaved changes are also lost. Click "Apply Changes" to write the cleared list to /etc/hosts.)`)) return
    store.webFilterEntries.splice(0)
    search.value = ''
}
</script>
