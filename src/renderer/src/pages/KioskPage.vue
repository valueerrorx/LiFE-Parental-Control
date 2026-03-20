<template>
    <div class="pc-page-header d-flex align-items-start justify-content-between">
        <div>
            <h1>KDE Kiosk Mode</h1>
            <p>Configure KDE Plasma lockdown restrictions via /etc/xdg/kdeglobals</p>
        </div>
        <div class="d-flex gap-2 pt-1">
            <button class="btn-pc-outline" @click="onDeactivate">
                <i class="bi bi-shield-slash me-1" />Deactivate
            </button>
            <button class="btn-pc-danger" @click="onActivate">
                <i class="bi bi-shield-lock me-1" />Activate Kiosk Mode
            </button>
        </div>
    </div>

    <div class="pc-content d-flex gap-3" style="min-height: 0;">
        <!-- Inner tabs -->
        <div class="pc-card pc-kiosk-subnav" style="width:200px;min-width:200px;padding:0;align-self:start;">
            <div style="padding:12px 0;">
                <button
                    class="nav-item-link w-100"
                    style="color:#212121;padding:9px 16px;"
                    :class="{ 'active-inner': activeTab === 'profiles' }"
                    @click="activeTab = 'profiles'"
                >
                    <i class="bi bi-people me-2" />Profiles
                </button>
                <button
                    class="nav-item-link w-100"
                    style="color:#212121;padding:9px 16px;"
                    :class="{ 'active-inner': activeTab === 'urls' }"
                    @click="activeTab = 'urls'"
                >
                    <i class="bi bi-folder-x me-2" />URL Restrictions
                </button>
                <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#9E9E9E;padding:10px 16px 4px;">
                    Restrictions
                </div>
                <button
                    v-for="cfg in store.configFiles"
                    :key="cfg.filename"
                    class="nav-item-link w-100"
                    style="color:#212121;padding:9px 16px;"
                    :class="{ 'active-inner': activeTab === cfg.filename }"
                    @click="activeTab = cfg.filename"
                >
                    <i class="bi me-2" :class="kdeIconToBootstrap(cfg.groupIcon)" />{{ cfg.groupName }}
                </button>
            </div>
        </div>

        <!-- Panel content -->
        <div class="flex-grow-1 pc-card" style="padding:0;overflow:hidden;">
            <ProfilesTab v-if="activeTab === 'profiles'" />
            <UrlRestrictionsTab v-else-if="activeTab === 'urls'" />
            <RestrictionTab v-else-if="activeTab" :config="currentConfig" />
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useKioskStore } from '../stores/kioskStore.js'
import { useAppStore } from '../stores/appStore.js'
import { useModal } from '../composables/useModal.js'
import ProfilesTab from '../components/kiosk/ProfilesTab.vue'
import UrlRestrictionsTab from '../components/kiosk/UrlRestrictionsTab.vue'
import RestrictionTab from '../components/kiosk/RestrictionTab.vue'

const store = useKioskStore()
const appStore = useAppStore()
const { confirm } = useModal()
const activeTab = ref('profiles')

const currentConfig = computed(() => store.configFiles.find(c => c.filename === activeTab.value))

const kdeIconMap = {
    kdeapp: 'bi-app-indicator',
    homerun: 'bi-grid-3x3-gap',
    'preferences-desktop-plasma': 'bi-gear',
    kolourpaint: 'bi-palette',
    plasmavault: 'bi-folder2-open',
    'security-high': 'bi-shield-lock',
    folder: 'bi-folder'
}
const kdeIconToBootstrap = (name) => kdeIconMap[name] ?? 'bi-gear'

onMounted(() => store.init())

async function onDeactivate() {
    const ok = await confirm(
        'Deactivate Kiosk Mode',
        'Remove all LiFE kiosk restrictions from /etc/xdg/kdeglobals and restart the KDE session?',
        { ok: 'Deactivate', cancel: 'Cancel' }
    )
    if (!ok) return
    const result = await window.api.system.activateKiosk('')
    if (result?.error) alert(`Failed: ${result.error}`)
    else {
        store.unloadProfile()
        await appStore.loadKioskStatus()
    }
}

async function onActivate() {
    const configText = await store.prepareActivation()
    const escapedText = configText.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<p>Merge the following blocks into <code>/etc/xdg/kdeglobals</code> (existing LiFE kiosk sections are replaced; other settings stay), then restart the KDE session?</p>
        <pre class="bg-light border rounded p-2" style="max-height:200px;overflow-y:auto;font-size:11px;">${escapedText || '(remove LiFE kiosk sections only)'}</pre>`
    const ok = await confirm('Activate Kiosk Mode', '', { html, ok: 'Activate', cancel: 'Cancel' })
    if (!ok) return
    const result = await window.api.system.activateKiosk(configText)
    if (result?.error) alert(`Failed: ${result.error}`)
    else await appStore.loadKioskStatus()
}
</script>

<style scoped>
/* Outer layout only; base .nav-item-link resets live in app.scss (.pc-kiosk-subnav) */
.pc-kiosk-subnav .nav-item-link.active-inner {
    background: #E3F2FD;
    color: var(--pc-primary) !important;
    font-weight: 600;
    border-left: 3px solid var(--pc-primary);
}
</style>
