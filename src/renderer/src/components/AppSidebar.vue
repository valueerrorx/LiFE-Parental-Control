<template>
    <aside class="pc-sidebar">
        <div class="pc-sidebar-brand d-flex align-items-center gap-2">
            <i class="bi bi-shield-check brand-icon" />
            <div>
                <div class="brand-name">{{ $t('sidebar.brand') }}</div>
                <div class="brand-sub">{{ $t('sidebar.controlCenter') }}</div>
            </div>
        </div>

        <nav>
            <div class="nav-section-label">{{ $t('nav.overview') }}</div>
            <RouterLink to="/" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-speedometer2" /> {{ $t('nav.dashboard') }}
                </button>
            </RouterLink>

            <div class="nav-section-label">{{ $t('nav.protection') }}</div>
            <RouterLink to="/webfilter" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-shield-x" /> {{ $t('nav.webFilter') }}
                    <span v-if="filterCount > 0" class="ms-auto badge-count">{{ filterCount }}</span>
                </button>
            </RouterLink>
            <RouterLink to="/apps" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-app-indicator" /> {{ $t('nav.appControl') }}
                    <span v-if="blockedCount > 0 || quotaCount > 0" class="ms-auto d-flex align-items-center gap-1">
                        <span v-if="blockedCount > 0" class="badge-count" :title="$t('sidebar.blockedAppsTitle')">{{ blockedCount }}</span>
                        <span v-if="quotaCount > 0" class="badge-count badge-quota" :title="$t('sidebar.dailyAppTimeLimits')">{{ quotaCount }}</span>
                    </span>
                </button>
            </RouterLink>
            <RouterLink to="/schedules" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-clock-history" /> {{ $t('nav.screenTime') }}
                    <span v-if="screenTimeOn" class="ms-auto badge-count badge-schedule" :title="$t('sidebar.screenTimeEnabled')">{{ $t('common.on') }}</span>
                </button>
            </RouterLink>
            <RouterLink to="/process-whitelist" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-list-check" /> {{ $t('nav.quotaExemptions') }}
                    <span v-if="whitelistActive" class="ms-auto badge-count badge-schedule" :title="$t('sidebar.dailyQuotaExemptions')">{{ $t('common.on') }}</span>
                </button>
            </RouterLink>

            <div class="nav-section-label">{{ $t('nav.advanced') }}</div>
            <RouterLink v-if="isKDE" to="/kiosk" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-lock-fill" /> {{ $t('nav.kdeKiosk') }}
                    <span v-if="kioskActive" class="ms-auto badge-count badge-schedule" :title="$t('sidebar.kdeKioskActive')">{{ $t('common.on') }}</span>
                </button>
            </RouterLink>
            <RouterLink to="/settings" custom v-slot="{ navigate, isExactActive }">
                <button class="nav-item-link" :class="{ active: isExactActive }" @click="navigate">
                    <i class="bi bi-gear-fill" /> {{ $t('nav.settings') }}
                </button>
            </RouterLink>
        </nav>

        <div class="pc-sidebar-footer">
            <div class="nav-section-label">{{ $t('nav.diagnostics') }}</div>
            <button type="button" class="nav-item-link about-btn" @click="openApplicationLog">
                <i class="bi bi-journal-text" /> {{ $t('nav.applicationLog') }}
            </button>
            <button type="button" class="nav-item-link about-btn" @click="onAbout">
                <span class="copyleft-icon">🄯</span> v{{ version }}
            </button>
            <div class="pc-sidebar-footer-meta d-flex align-items-center justify-content-between">
                <span :title="footerTitle">{{ footerLabel }}</span>
                <div class="d-flex align-items-center gap-1">
                    <button type="button" class="lang-toggle-btn" @click="toggleLang">{{ currentLocale === 'de' ? 'EN' : 'DE' }}</button>
                    <button type="button" class="nav-item-link nav-item-link-icon-only" @click="onExit" :title="$t('sidebar.exit')">
                        <i class="bi bi-box-arrow-right" />
                    </button>
                </div>
            </div>
        </div>
    </aside>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Swal from 'sweetalert2'
import { useAppStore } from '../stores/appStore.js'
import { useApplicationLogModal } from '../composables/useApplicationLogModal.js'
import { useModal } from '../composables/useModal.js'
import { quitWithParentPassword } from '../parentQuit.js'
import { setLocale } from '../i18n.js'
import ososSvg from '../../../../images/osos.svg?raw'
import { version } from '../../../../package.json'

const { t, locale } = useI18n()
const { prompt } = useModal()
const store = useAppStore()
const { openApplicationLog } = useApplicationLogModal()
const filterCount = computed(() => store.webFilterHostRuleCount)
const blockedCount = computed(() => (store.appControlEnabled ? store.blockedApps.length : 0))
const quotaCount = computed(() => (store.appControlEnabled ? store.appQuotas.length : 0))
const screenTimeOn = computed(() => store.schedule?.enabled === true)
const kioskActive = computed(() => store.kioskStatus?.active === true)
const whitelistActive = computed(() => store.whitelistEnabled === true)
const currentLocale = computed(() => locale.value)
// Show KDE Kiosk tab only on KDE; hide on GNOME/other desktops
const isKDE = computed(() => {
    const d = (store.xdgCurrentDesktop || '').toUpperCase()
    return !d || d.includes('KDE')
})

const footerLabel = computed(() => {
    if (store.runningAsRoot === true) return t('sidebar.runningAsRoot')
    if (store.runningAsRoot === false) return t('sidebar.notRoot')
    return '…'
})
const footerTitle = computed(() => {
    if (store.runningAsRoot === false) {
        return t('sidebar.rootTooltip')
    }
    return undefined
})

function toggleLang() {
    const next = locale.value === 'en' ? 'de' : 'en'
    setLocale(next)
}

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
        confirmButtonText: t('about.okBtn'),
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
.lang-toggle-btn {
    width: 30px;
    height: 30px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.85);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: background 0.15s, border-color 0.15s;
}
.lang-toggle-btn:hover {
    background: rgba(255, 255, 255, 0.22);
    border-color: rgba(255, 255, 255, 0.6);
}
</style>
