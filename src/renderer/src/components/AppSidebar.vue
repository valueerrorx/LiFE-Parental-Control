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
            <RouterLink to="/" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-speedometer2" /> Dashboard
                </button>
            </RouterLink>

            <div class="nav-section-label">Protection</div>
            <RouterLink to="/webfilter" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-shield-x" /> Web Filter
                    <span v-if="filterCount > 0" class="ms-auto badge-count">{{ filterCount }}</span>
                </button>
            </RouterLink>
            <RouterLink to="/apps" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-app-indicator" /> App Control
                    <span v-if="blockedCount > 0 || quotaCount > 0" class="ms-auto d-flex align-items-center gap-1">
                        <span v-if="blockedCount > 0" class="badge-count" title="Blocked apps">{{ blockedCount }}</span>
                        <span v-if="quotaCount > 0" class="badge-count badge-quota" title="Daily app time limits">{{ quotaCount }}</span>
                    </span>
                </button>
            </RouterLink>
            <RouterLink to="/schedules" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-clock-history" /> Screen Time
                    <span v-if="screenTimeOn" class="ms-auto badge-count badge-schedule" title="Screen time enforcement enabled">on</span>
                </button>
            </RouterLink>
            <RouterLink to="/process-whitelist" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-list-check" /> Quota exemptions
                    <span v-if="whitelistActive" class="ms-auto badge-count badge-schedule" title="Daily quota exemptions enabled">on</span>
                </button>
            </RouterLink>

            <div class="nav-section-label">Advanced</div>
            <RouterLink v-if="isKDE" to="/kiosk" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-lock-fill" /> KDE Kiosk
                    <span v-if="kioskActive" class="ms-auto badge-count badge-schedule" title="KDE kiosk active">on</span>
                </button>
            </RouterLink>
            <RouterLink to="/settings" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-gear-fill" /> Settings
                </button>
            </RouterLink>
        </nav>

        <div class="pc-sidebar-footer">
            <div class="nav-section-label">Diagnostics</div>
            <button type="button" class="nav-item-link" @click="openApplicationLog">
                <i class="bi bi-journal-text" /> Application log
            </button>
            <button type="button" class="nav-item-link about-btn" @click="onAbout">
                <span class="copyleft-icon">🄯</span> v{{ version }}
            </button>
            <div class="pc-sidebar-footer-meta d-flex align-items-center justify-content-between">
                <span :title="footerTitle">{{ footerLabel }}</span>
                <button type="button" class="nav-item-link nav-item-link-icon-only" @click="onExit" title="Exit">
                    <i class="bi bi-box-arrow-right" />
                </button>
            </div>
        </div>
    </aside>
</template>

<script setup>
import { computed } from 'vue'
import Swal from 'sweetalert2'
import { useAppStore } from '../stores/appStore.js'
import { useApplicationLogModal } from '../composables/useApplicationLogModal.js'
import { useModal } from '../composables/useModal.js'
import { quitWithParentPassword } from '../parentQuit.js'
import ososSvg from '../../../../images/osos.svg?raw'
import { version } from '../../../../package.json'

const { prompt } = useModal()
const store = useAppStore()
const { openApplicationLog } = useApplicationLogModal()
const filterCount = computed(() => store.webFilterHostRuleCount)
const blockedCount = computed(() => store.blockedApps.length)
const quotaCount = computed(() => store.appQuotas.length)
const screenTimeOn = computed(() => store.schedule?.enabled === true)
const kioskActive = computed(() => store.kioskStatus?.active === true)
const whitelistActive = computed(() => store.whitelistEnabled === true)
// Show KDE Kiosk tab only on KDE; hide on GNOME/other desktops
const isKDE = computed(() => {
    const d = (store.xdgCurrentDesktop || '').toUpperCase()
    return !d || d.includes('KDE')
})

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
    await quitWithParentPassword(prompt)
}

async function onAbout() {
    await Swal.fire({
        icon: 'info',
        html: `
            <div style="text-align:center;padding:4px 0;">
                <div style="font-size:17px;font-weight:700;margin-bottom:4px;">LiFE Parental Control</div>
                <div style="color:#64748b;font-size:13px;margin-bottom:2px;">Version ${version}</div>
                <div style="color:#64748b;font-size:13px;margin-bottom:20px;">🄯 2026 · Mag. Thomas Michael Weissel</div>
                <div style="max-width:150px;margin:0 auto;display:flex;align-items:center;justify-content:center;">${ososSvg.replace('<svg', '<svg style="width:100%;height:auto;"')}</div>
                <a href="https://linux-bildung.at" target="_blank" style="display:inline-block;margin-top:14px;font-size:12px;color:#1565C0;text-decoration:none;">🌐 linux-bildung.at</a>
            </div>
        `,
        showConfirmButton: true,
        confirmButtonText: 'OK',
        confirmButtonColor: '#1565C0',
        width: 320
    })
}
</script>

<style scoped>
.about-btn {
    opacity: 0.6;
}
.about-btn:hover {
    opacity: 1;
}
.copyleft-icon {
    font-size: 1.2em;
    line-height: 1;
    vertical-align: -0.15em;
    display: inline-block;
    width: 1em;
    text-align: center;
}
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
