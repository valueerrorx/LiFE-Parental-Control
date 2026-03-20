<template>
    <aside class="pc-sidebar">
        <div class="pc-sidebar-brand d-flex align-items-center gap-2">
            <i class="bi bi-shield-check brand-icon" />
            <div>
                <div class="brand-name">LiFE Parental</div>
                <div class="brand-sub">Control Center</div>
            </div>
        </div>

        <nav>
            <div class="nav-section-label">Overview</div>
            <RouterLink to="/" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-speedometer2" /> Dashboard
                </button>
            </RouterLink>

            <div class="nav-section-label">Protection</div>
            <RouterLink to="/webfilter" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-shield-x" /> Web Filter
                    <span v-if="filterCount > 0" class="ms-auto badge-count">{{ filterCount }}</span>
                </button>
            </RouterLink>
            <RouterLink to="/apps" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-app-indicator" /> App Control
                    <span v-if="blockedCount > 0 || quotaCount > 0" class="ms-auto d-flex align-items-center gap-1">
                        <span v-if="blockedCount > 0" class="badge-count" title="Blocked apps">{{ blockedCount }}</span>
                        <span v-if="quotaCount > 0" class="badge-count badge-quota" title="Daily app time limits">{{ quotaCount }}</span>
                    </span>
                </button>
            </RouterLink>
            <RouterLink to="/schedules" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-clock-history" /> Screen Time
                    <span v-if="screenTimeOn" class="ms-auto badge-count badge-schedule" title="Screen time enforcement enabled">on</span>
                </button>
            </RouterLink>
            <RouterLink to="/process-whitelist" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-list-check" /> Quota exemptions
                    <span v-if="whitelistActive" class="ms-auto badge-count badge-schedule" title="Daily quota exemptions enabled">on</span>
                </button>
            </RouterLink>

            <div class="nav-section-label">Advanced</div>
            <RouterLink to="/kiosk" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-lock-fill" /> KDE Kiosk
                    <span v-if="kioskActive" class="ms-auto badge-count badge-schedule" title="KDE kiosk active">on</span>
                </button>
            </RouterLink>
            <RouterLink to="/settings" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-gear-fill" /> Settings
                </button>
            </RouterLink>
        </nav>

        <div class="pc-sidebar-footer d-flex align-items-center justify-content-between">
            <span :title="footerTitle">{{ footerLabel }}</span>
            <button class="nav-item-link p-1" style="width:auto;" @click="onExit" title="Exit">
                <i class="bi bi-box-arrow-right" style="font-size:16px;color:rgba(255,255,255,0.6);" />
            </button>
        </div>
    </aside>
</template>

<script setup>
import { computed } from 'vue'
import { useAppStore } from '../stores/appStore.js'

const store = useAppStore()
const filterCount = computed(() => store.webFilterHostRuleCount)
const blockedCount = computed(() => store.blockedApps.length)
const quotaCount = computed(() => store.appQuotas.length)
const screenTimeOn = computed(() => store.schedule?.enabled === true)
const kioskActive = computed(() => store.kioskStatus?.active === true)
const whitelistActive = computed(() => store.whitelistEnabled === true)

const footerLabel = computed(() => {
    if (store.runningAsRoot === true) return 'Running as root'
    if (store.runningAsRoot === false) return 'Not root'
    return '…'
})
const footerTitle = computed(() => {
    if (store.runningAsRoot === false) {
        return 'Elevated features need root — use packaged app with pkexec or npm run dev'
    }
    return undefined
})

async function onExit() {
    const ok = await window.api.system.showConfirm({
        title: 'Quit LiFE Parental Control',
        message: 'Quit the application?',
        okLabel: 'Quit',
        cancelLabel: 'Cancel'
    })
    if (ok) await window.api.system.quit()
}
</script>

<style scoped>
.badge-count {
    background: rgba(255,255,255,0.25);
    color: #fff;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 7px;
    min-width: 20px;
    text-align: center;
}
.badge-quota {
    background: rgba(129, 199, 132, 0.45);
}
.badge-schedule {
    background: rgba(100, 181, 246, 0.5);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.02em;
}
</style>
