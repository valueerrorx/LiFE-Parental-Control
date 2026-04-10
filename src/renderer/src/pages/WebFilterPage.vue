<template>
    <div class="pc-page-header d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-3">
            <label class="pc-toggle">
                <input type="checkbox" v-model="store.webFilterEnabled" />
                <span class="slider" />
            </label>
            <div>
                <h1>{{ $t('webFilter.title') }}</h1>
                <p class="mb-0">{{ $t('webFilter.subtitle') }}</p>
            </div>
        </div>
        <div class="d-flex align-items-center gap-3">
            <span v-if="isDirty" class="text-danger small">{{ $t('common.unsavedChanges') }}</span>
            <span class="status-badge" :class="!store.webFilterEnabled ? 'inactive' : activeRuleCount > 0 ? 'active' : 'inactive'">
                <i class="bi bi-circle-fill" style="font-size:7px;" />
                {{ !store.webFilterEnabled ? $t('common.disabled') : activeRuleCount > 0 ? $t('webFilter.hostRules', { count: activeRuleCount }) : $t('webFilter.noActiveRules') }}
            </span>
            <button class="btn-pc-primary" @click="onSave" :disabled="!isDirty || saving">
                <i class="bi bi-floppy me-1" />{{ saving ? $t('common.saving') : $t('common.applyChanges') }}
            </button>
        </div>
    </div>

    <div class="pc-content">
        <div v-if="hostsBackupWarning" class="alert alert-warning py-2 px-3 mb-3" style="font-size:13px;">
            <i class="bi bi-exclamation-triangle me-2" />{{ hostsBackupWarning }}
        </div>

        <div :class="{ 'opacity-50 pe-none': !store.webFilterEnabled }">
            <div class="row g-3 align-items-start">
                <!-- Domain list -->
                <div class="col-8">
                    <div class="pc-card">
                        <div class="pc-card-header">
                            <h6>{{ $t('webFilter.customDomains') }} ({{ search ? `${filteredEntries.length} / ${entries.length}` : entries.length }})</h6>
                            <div class="d-flex gap-2 flex-wrap">
                                <input
                                    v-model="search"
                                    class="pc-input"
                                    style="width:170px;"
                                    :placeholder="$t('webFilter.searchDomains')"
                                />
                                <input
                                    v-model="newDomain"
                                    class="pc-input"
                                    style="width:190px;"
                                    :placeholder="$t('webFilter.domainPlaceholder')"
                                    @keyup.enter="onAdd"
                                />
                                <button type="button" class="btn-pc-primary" @click="onAdd">
                                    <i class="bi bi-plus-lg me-1" />{{ $t('webFilter.blockHost') }}
                                </button>
                            </div>
                        </div>

                        <div v-if="entries.length === 0" class="pc-card-body text-center text-muted py-5">
                            <i class="bi bi-shield-check" style="font-size:40px;opacity:0.3;" />
                            <p class="mt-2">{{ $t('webFilter.noDomainsYet') }}</p>
                        </div>

                        <div v-else-if="filteredEntries.length === 0" class="pc-card-body text-center text-muted py-5">
                            <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                            <p class="mt-2">{{ $t('webFilter.noDomainsMatch', { search }) }}</p>
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
                            <h6>{{ $t('webFilter.allowExceptions') }} ({{ allowSearch ? `${filteredAllowlist.length} / ${allowlist.length}` : allowlist.length }})</h6>
                            <div class="d-flex gap-2 flex-wrap">
                                <input
                                    v-model="allowSearch"
                                    class="pc-input"
                                    style="width:170px;"
                                    :placeholder="$t('webFilter.searchHosts')"
                                />
                                <input
                                    v-model="allowNewDomain"
                                    class="pc-input"
                                    style="width:190px;"
                                    :placeholder="$t('webFilter.allowPlaceholder')"
                                    @keyup.enter="onAddAllow"
                                />
                                <button type="button" class="btn-pc-primary" @click="onAddAllow">
                                    <i class="bi bi-plus-lg me-1" />{{ $t('webFilter.allowHost') }}
                                </button>
                            </div>
                        </div>
                        <div v-if="!allowlist.length" class="pc-card-body text-center text-muted py-5">
                            <i class="bi bi-shield-check" style="font-size:40px;opacity:0.3;" />
                            <p class="mt-2">{{ $t('webFilter.noExceptionsYet') }}</p>
                        </div>
                        <div v-else-if="filteredAllowlist.length === 0" class="pc-card-body text-center text-muted py-5">
                            <i class="bi bi-search" style="font-size:40px;opacity:0.3;" />
                            <p class="mt-2">{{ $t('webFilter.noHostsMatch', { search: allowSearch }) }}</p>
                        </div>
                        <div v-else class="pc-scroll-list">
                            <div v-for="h in filteredAllowlist" :key="h" class="pc-list-item pc-list-item--compact">
                                <div class="item-icon">
                                    <i class="bi bi-globe" />
                                </div>
                                <div class="flex-grow-1">
                                    <div class="item-name">{{ h }}</div>
                                </div>
                                <button type="button" class="btn-pc-danger" style="padding:4px 10px;" @click="onRemoveAllow(h)">
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

                <!-- Quick add categories + DNS selection -->
                <div class="col-4">
             
                    <div class="pc-card mb-3">
                        <div class="pc-card-header">
                            <h6>{{ $t('webFilter.quickAddCategories') }}</h6>
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
                                {{ $t('webFilter.addCategory', { cat }) }}
                            </button>
                            <hr
                                v-if="staticQuickCats.length && hageziQuickCats.length"
                                class="my-2 opacity-50"
                            />
                            <div
                                v-if="hageziQuickCats.length"
                                class="d-flex align-items-center justify-content-between gap-2 flex-wrap"
                            >
                                <h6 class="mb-0 webfilter-hagezi-subhead">{{ $t('webFilter.hageziLists') }}</h6>
                                <span
                                    v-if="hageziLastUpdated"
                                    class="webfilter-hagezi-date"
                                >{{ hageziLastUpdated }}</span>
                                <button
                                    type="button"
                                    class="btn-pc-outline flex-shrink-0 ms-auto"
                                    :title="$t('webFilter.updateListsTitle')"
                                    :disabled="saving"
                                    @click="onSyncFeeds"
                                >
                                    <i class="bi bi-cloud-download me-1" />{{ $t('webFilter.updateLists') }}
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
                                    {{ $t('webFilter.categoryEnabled', { cat }) }}
                                </template>
                                <template v-else>
                                    <i class="bi me-2" :class="categoryIcon(cat)" />
                                    {{ $t('webFilter.categoryDisabled', { cat }) }}
                                </template>
                            </button>
                            <hr class="my-1" />
                            <button class="btn-pc-danger" :disabled="saving" @click="onClearAll">
                                <i class="bi bi-trash me-1" />{{ $t('webFilter.clearAllRules') }}
                            </button>
                        </div>
                    </div>

                    <!-- DNS upstream selection -->
                    <div class="pc-card mb-3">
                        <div class="pc-card-header">
                            <h6>{{ $t('webFilter.dnsUpstream') }}</h6>
                        </div>
                        <div class="pc-card-body d-flex flex-column gap-1">
                            <label
                                v-for="opt in dnsOptions"
                                :key="opt.value"
                                class="dns-option"
                                :class="{ 'dns-option--active': store.webFilterDnsMode === opt.value }"
                            >
                                <input
                                    type="radio"
                                    :value="opt.value"
                                    v-model="store.webFilterDnsMode"
                                    class="dns-option-input"
                                />
                                <div class="dns-option-content">
                                    <div class="dns-option-label">{{ opt.label }}</div>
                                    <div class="dns-option-sub">{{ opt.sub }}</div>
                                </div>
                            </label>
                        </div>
                    </div>


                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { confirm } from '../composables/useConfirm.js'
import { useUnsavedGuard } from '../composables/useUnsavedGuard.js'
import { useAppStore } from '../stores/appStore.js'

const { t } = useI18n()
const store = useAppStore()

const dhcpDnsIp = ref(null)
async function fetchDhcpDns() {
    const r = await window.api.webFilter.getDhcpDns()
    dhcpDnsIp.value = (r?.ok && r.ip) ? r.ip : null
}

const dnsOptions = computed(() => [
    { value: 'dns4eu_protective',  label: t('webFilter.dns_protective'),       sub: '86.54.11.1' },
    { value: 'dns4eu_child',       label: t('webFilter.dns_child'),             sub: '86.54.11.12' },
    { value: 'dns4eu_ads',         label: t('webFilter.dns_ads'),               sub: '86.54.11.13' },
    { value: 'dns4eu_child_ads',   label: t('webFilter.dns_child_ads'),         sub: '86.54.11.11' },
    { value: 'dhcp',               label: t('webFilter.dns_dhcp'),              sub: dhcpDnsIp.value ?? t('webFilter.dns_dhcp_unknown') },
])
const entries = computed(() => store.webFilterEntries)
const categories = ref([])
const staticCategoryDomains = ref({})
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
const savedSnapshot = ref(null)

function takeSnapshot() {
    savedSnapshot.value = JSON.stringify({
        enabled: store.webFilterEnabled,
        entries: store.webFilterEntries.map(e => ({ domain: e.domain, enabled: e.enabled })),
        feedState: Object.fromEntries(Object.entries(store.webFilterFeedState).sort()),
        allowlist: [...store.webFilterAllowlist],
        dnsMode: store.webFilterDnsMode
    })
}

const isDirty = computed(() => {
    if (savedSnapshot.value === null) return false
    const cur = JSON.stringify({
        enabled: store.webFilterEnabled,
        entries: store.webFilterEntries.map(e => ({ domain: e.domain, enabled: e.enabled })),
        feedState: Object.fromEntries(Object.entries(store.webFilterFeedState).sort()),
        allowlist: [...store.webFilterAllowlist],
        dnsMode: store.webFilterDnsMode
    })
    return cur !== savedSnapshot.value
})
useUnsavedGuard(isDirty, onSave)

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

const feedsMeta = ref({})
const hageziLastUpdated = computed(() => {
    const dates = Object.values(feedsMeta.value)
        .map(m => m?.cachedAt ? new Date(m.cachedAt) : null)
        .filter(Boolean)
    if (!dates.length) return null
    const d = new Date(Math.max(...dates.map(x => x.getTime())))
    return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
})

function applyFeedsMeta(result) {
    if (result?.feedsMeta && typeof result.feedsMeta === 'object') {
        feedsMeta.value = result.feedsMeta
    }
}

onMounted(async () => {
    const result = await store.loadWebFilter()
    categories.value = result.categories ?? []
    staticCategoryDomains.value = result.staticCategories ?? {}
    hostsBackupWarning.value = result.error || ''
    applyFeedsMeta(result)
    takeSnapshot()
    fetchDhcpDns()
})

function onAdd() {
    const d = newDomain.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!d) return
    if (entries.value.find(e => e.domain === d)) {
        saveMsg.value = t('webFilter.alreadyInList', { domain: d })
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

function onQuickCategory(cat) {
    const fid = categoryFeedId(cat)
    if (fid) {
        // Toggle feed state locally — no IPC until Apply
        store.webFilterFeedState[fid] = !feedOn(fid)
        saveMsg.value = feedOn(fid)
            ? t('webFilter.enabledList', { cat })
            : t('webFilter.disabledList', { cat })
        saveError.value = false
    } else {
        // Add static category domains locally using server-provided lists
        const domains = staticCategoryDomains.value[cat] || []
        const existing = new Set(entries.value.map(e => e.domain))
        const toAdd = domains.filter(d => !existing.has(d))
        store.webFilterEntries.push(...toAdd.map(d => ({ domain: d, enabled: true })))
        saveMsg.value = t('webFilter.addedDomains', { count: toAdd.length, cat })
        saveError.value = false
    }
    setTimeout(() => { saveMsg.value = '' }, 3000)
}

async function onSave() {
    saving.value = true
    const result = await store.saveWebFilterAll()
    saving.value = false
    if (result?.error) { saveMsg.value = `Error: ${result.error}`; saveError.value = true }
    else {
        saveMsg.value = t('webFilter.rulesApplied')
        saveError.value = false
        hostsBackupWarning.value = ''
        takeSnapshot()
    }
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

async function onClearAll() {
    const n = entries.value.length + Object.values(store.webFilterFeedState).filter(Boolean).length
    if (!await confirm({ title: t('webFilter.clearAllConfirmTitle'), message: t('webFilter.clearAllConfirmMsg', { count: n }), okLabel: t('webFilter.clearLabel'), danger: true })) return
    store.webFilterEntries.splice(0)
    store.webFilterFeedState = {}
    store.webFilterAllowlist.splice(0)
    search.value = ''
    saveMsg.value = t('webFilter.allRulesCleared')
    saveError.value = false
    setTimeout(() => { saveMsg.value = '' }, 4000)
}

function onAddAllow() {
    const d = allowNewDomain.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split('/')[0]
    if (!d) return
    if (allowlist.value.includes(d)) {
        saveMsg.value = t('webFilter.alreadyAllowed', { host: d })
        saveError.value = true
        setTimeout(() => { saveMsg.value = '' }, 3000)
        return
    }
    store.webFilterAllowlist.push(d)
    allowNewDomain.value = ''
    saveMsg.value = t('webFilter.allowed', { host: d })
    saveError.value = false
    setTimeout(() => { saveMsg.value = '' }, 3000)
}

function onRemoveAllow(h) {
    const idx = store.webFilterAllowlist.indexOf(h)
    if (idx >= 0) {
        store.webFilterAllowlist.splice(idx, 1)
        saveMsg.value = t('webFilter.removedException', { host: h })
        saveError.value = false
        setTimeout(() => { saveMsg.value = '' }, 3000)
    }
}

async function onSyncFeeds() {
    saving.value = true
    saveMsg.value = ''
    const r = await window.api.webFilter.syncFeeds()
    applyFeedsMeta(await store.loadWebFilter())
    saving.value = false
    if (r?.error) {
        saveMsg.value = `Update: ${r.error}`
        saveError.value = true
    } else {
        const u = r?.updated?.length ? t('webFilter.listsUpdated', { list: r.updated.join(', ') }) : ''
        const e = r?.errors?.length ? t('webFilter.listsWarnings', { list: r.errors.join('; ') }) : ''
        saveMsg.value = t('webFilter.listsSynced') + u + e
        saveError.value = Boolean(r?.errors?.length)
    }
    setTimeout(() => { saveMsg.value = '' }, 6000)
}
</script>

<style scoped>
.dns-option {
    position: relative;
    display: flex;
    align-items: center;
    padding: 7px 10px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
}
/* Full-row hit target: visually-hidden clips the focus box to a tiny rect off-flow, so scroll-into-view jumps main; absolute inset matches the row. */
.dns-option-input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    opacity: 0;
    cursor: pointer;
}
.dns-option:hover {
    background: var(--pc-hover, rgba(255,255,255,0.05));
}
.dns-option--active {
    background: var(--pc-accent-subtle, rgba(99,102,241,0.12));
    border-color: var(--pc-accent, #6366f1);
}
.dns-option-content {
    position: relative;
    z-index: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.dns-option-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--pc-text);
}
.dns-option--active .dns-option-label {
    color: var(--pc-accent, #6366f1);
}
.dns-option-sub {
    font-size: 11px;
    color: var(--pc-text-muted, #888);
    font-family: monospace;
}

/* Subhead beside Update lists; aligns visually with pc-card-header h6. */
.webfilter-hagezi-subhead {
    font-size: 14px;
    font-weight: 600;
    color: var(--pc-text);
}
.webfilter-hagezi-date {
    font-size: 12px;
    color: var(--pc-text-muted, #888);
    white-space: nowrap;
    margin-right: auto;
}

</style>
