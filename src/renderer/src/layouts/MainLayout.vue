<template>
    <div class="pc-layout">
        <AppSidebar />
        <main class="pc-main">
            <router-view />
        </main>
    </div>
    <ScreenTimeLowWarningModal />
    <ScreenTimeExhaustedModal />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import AppSidebar from '../components/AppSidebar.vue'
import ScreenTimeLowWarningModal from '../components/ScreenTimeLowWarningModal.vue'
import ScreenTimeExhaustedModal from '../components/ScreenTimeExhaustedModal.vue'
import { useAppStore } from '../stores/appStore.js'

const store = useAppStore()
// Poll quota daily usage JSON on the cron cadence and when the window is focused again.
const QUOTA_USAGE_POLL_MS = 60_000
let quotaPollTimer = null

function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
        void store.loadAppQuotas()
        void store.loadSchedule()
    }
}

onMounted(() => {
    void store.refreshProtectionsState()
    quotaPollTimer = setInterval(() => void store.loadAppQuotas(), QUOTA_USAGE_POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
    if (quotaPollTimer != null) clearInterval(quotaPollTimer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>
