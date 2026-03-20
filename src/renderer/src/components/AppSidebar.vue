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
                    <span v-if="blockedCount > 0" class="ms-auto badge-count">{{ blockedCount }}</span>
                </button>
            </RouterLink>
            <RouterLink to="/schedules" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-clock-history" /> Screen Time
                </button>
            </RouterLink>

            <div class="nav-section-label">Advanced</div>
            <RouterLink to="/kiosk" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-lock-fill" /> KDE Kiosk
                </button>
            </RouterLink>
            <RouterLink to="/settings" custom v-slot="{ navigate, isActive }">
                <button class="nav-item-link" :class="{ active: isActive }" @click="navigate">
                    <i class="bi bi-gear-fill" /> Settings
                </button>
            </RouterLink>
        </nav>

        <div class="pc-sidebar-footer d-flex align-items-center justify-content-between">
            <span>Running as root</span>
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
const filterCount = computed(() => store.webFilterEntries.filter(e => e.enabled).length)
const blockedCount = computed(() => store.blockedApps.length)

function onExit() {
    window.api.system.quit()
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
</style>
