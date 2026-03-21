<template>
    <Teleport to="body">
        <div v-if="visible" class="st-low-overlay">
            <div class="st-low-modal" role="dialog" aria-labelledby="st-low-title" aria-modal="true">
                <div class="st-low-header">
                    <span id="st-low-title" class="fw-semibold">Screen time running low</span>
                </div>
                <div class="st-low-body">
                    <p class="mb-2">
                        About <strong>{{ remaining }} minute{{ remaining === 1 ? '' : 's' }}</strong> left today
                        (<strong>{{ store.todayUsageMinutes }}</strong> of <strong>{{ effectiveLimit }}</strong> used).
                    </p>
                    <p class="text-muted small mb-3">
                        Add more minutes for today only (parent password). This does not change logged usage — it raises today’s allowance.
                    </p>
                    <div class="st-low-field">
                        <label class="st-low-label" for="st-low-pw">Parent password</label>
                        <input
                            id="st-low-pw"
                            v-model="password"
                            type="password"
                            class="pc-input"
                            autocomplete="off"
                            @keyup.enter="onGrant"
                        />
                    </div>
                    <div class="st-low-field st-low-field-narrow">
                        <label class="st-low-label" for="st-low-min">Extra minutes</label>
                        <select id="st-low-min" v-model.number="grantMinutes" class="pc-input">
                            <option :value="5">5</option>
                            <option :value="15">15</option>
                            <option :value="30">30</option>
                            <option :value="60">60</option>
                        </select>
                    </div>
                    <p v-if="errorMsg" class="text-danger small mb-0">{{ errorMsg }}</p>
                </div>
                <div class="st-low-footer">
                    <button type="button" class="btn-pc-outline" :disabled="busy" @click="onDismiss">
                        Not now
                    </button>
                    <button type="button" class="btn-pc-primary" :disabled="busy" @click="onGrant">
                        {{ busy ? '…' : `Add ${grantMinutes} min` }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../stores/appStore.js'
import { useUrgentWindowPresent } from '../composables/useUrgentWindowPresent.js'

const store = useAppStore()
const dismissed = ref(false)
const password = ref('')
const grantMinutes = ref(30)
const busy = ref(false)
const errorMsg = ref('')

const POLL_MS = 30_000
let pollTimer = null

function todayKey() {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
}

function dismissedStorageKey() {
    return `life-screen-low-dismissed-${todayKey()}`
}

function nativeToastStorageKey() {
    return `life-screen-low-native-${todayKey()}`
}

const effectiveLimit = computed(() =>
    (store.schedule?.dailyLimitMinutes ?? 0) + (store.todayExtraAllowanceMinutes ?? 0))

const remaining = computed(() => {
    const lim = effectiveLimit.value
    if (lim <= 0) return 0
    return Math.max(0, lim - (store.todayUsageMinutes ?? 0))
})

const inLowBand = computed(() => {
    const s = store.schedule
    if (!s?.enabled || !s.dailyLimitEnabled) return false
    const r = remaining.value
    return r >= 1 && r <= 5
})

const exhausted = computed(() => {
    const s = store.schedule
    if (!s?.enabled || !s.dailyLimitEnabled) return false
    const lim = effectiveLimit.value
    return lim > 0 && store.todayUsageMinutes >= lim
})

const visible = computed(
    () => inLowBand.value && !exhausted.value && !dismissed.value
)

useUrgentWindowPresent(visible)

watch(remaining, (r) => {
    if (r > 5) {
        dismissed.value = false
        try {
            window.sessionStorage.removeItem(dismissedStorageKey())
            window.sessionStorage.removeItem(nativeToastStorageKey())
        } catch {
            /* ignore */
        }
    }
})


function onDismiss() {
    try {
        window.sessionStorage.setItem(dismissedStorageKey(), '1')
    } catch {
        /* ignore */
    }
    dismissed.value = true
    errorMsg.value = ''
}

async function onGrant() {
    errorMsg.value = ''
    busy.value = true
    const r = await window.api.schedules.grantBonusMinutes({
        password: password.value,
        minutes: grantMinutes.value
    })
    busy.value = false
    if (r?.error) {
        errorMsg.value = r.error
        return
    }
    password.value = ''
    await store.loadSchedule()
    void store.refreshProtectionsState()
}

async function maybeDesktopToast() {
    if (!inLowBand.value || exhausted.value || dismissed.value) return
    try {
        const obscured = await window.api.system.isWindowObscured()
        if (!obscured) return
        if (window.sessionStorage.getItem(nativeToastStorageKey()) === '1') return
        const rem = remaining.value
        const r = await window.api.system.showNativeNotification({
            title: 'LiFE Parental Control',
            body: `Screen time: about ${rem} minute${rem === 1 ? '' : 's'} left today. Open the app to add bonus time.`
        })
        if (r?.ok) window.sessionStorage.setItem(nativeToastStorageKey(), '1')
    } catch {
        /* ignore */
    }
}

async function poll() {
    const s = store.schedule
    if (!s?.enabled || !s?.dailyLimitEnabled) return
    await store.loadSchedule()
    await maybeDesktopToast()
}

onMounted(() => {
    try {
        dismissed.value = window.sessionStorage.getItem(dismissedStorageKey()) === '1'
    } catch {
        dismissed.value = false
    }
    void poll()
    pollTimer = window.setInterval(() => void poll(), POLL_MS)
})

onUnmounted(() => {
    if (pollTimer) window.clearInterval(pollTimer)
})
</script>

<style scoped>
.st-low-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9998;
}
.st-low-modal {
    background: #fff;
    border-radius: 10px;
    width: 480px;
    max-width: 92vw;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
    overflow: hidden;
}
.st-low-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e0e0e0;
    font-size: 15px;
}
.st-low-body {
    padding: 20px;
    font-size: 13.5px;
    line-height: 1.55;
}
.st-low-footer {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid #e0e0e0;
}
.st-low-field {
    margin-bottom: 12px;
}
.st-low-field-narrow {
    max-width: 200px;
}
.st-low-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #616161;
    margin-bottom: 4px;
}
</style>
