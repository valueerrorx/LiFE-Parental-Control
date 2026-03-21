<template>
    <Teleport to="body">
        <div v-if="visible" class="st-ex-overlay">
            <div class="st-ex-modal" role="dialog" aria-labelledby="st-ex-title" aria-modal="true">
                <div class="st-ex-header">
                    <span id="st-ex-title" class="fw-semibold">Screen time limit reached</span>
                </div>
                <div class="st-ex-body">
                    <p class="mb-2">
                        Today's allowed time is used up (<strong>{{ store.todayUsageMinutes }} min</strong> of
                        <strong>{{ effectiveLimit }} min</strong> allowed).
                        The session may keep locking until you add more time or reset usage on Screen Time.
                    </p>
                    <p class="text-muted small mb-3">
                        Add more minutes for today only (parent password required). This does not change logged usage — it raises today's allowance.
                    </p>
                    <div class="st-ex-field">
                        <label class="st-ex-label" for="st-ex-pw">Parent password</label>
                        <input
                            id="st-ex-pw"
                            v-model="password"
                            type="password"
                            class="pc-input"
                            autocomplete="off"
                            @keyup.enter="onGrant"
                        />
                    </div>
                    <div class="st-ex-field st-ex-field-narrow">
                        <label class="st-ex-label" for="st-ex-min">Extra minutes</label>
                        <select id="st-ex-min" v-model.number="grantMinutes" class="pc-input">
                            <option :value="5">5</option>
                            <option :value="15">15</option>
                            <option :value="30">30</option>
                            <option :value="60">60</option>
                        </select>
                    </div>
                    <p v-if="errorMsg" class="text-danger small mb-0">{{ errorMsg }}</p>
                </div>
                <div class="st-ex-footer">
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
const hideUntilMs = ref(0)
const password = ref('')
const grantMinutes = ref(30)
const busy = ref(false)
const errorMsg = ref('')

const POLL_MS = 30_000
let pollTimer = null

const effectiveLimit = computed(() =>
    (store.schedule?.dailyLimitMinutes ?? 0) + (store.todayExtraAllowanceMinutes ?? 0))

const exhausted = computed(() => {
    const s = store.schedule
    if (!s?.enabled || !s.dailyLimitEnabled) return false
    const lim = effectiveLimit.value
    return lim > 0 && store.todayUsageMinutes >= lim
})

const visible = computed(() => exhausted.value && Date.now() >= hideUntilMs.value)

useUrgentWindowPresent(visible)

watch(exhausted, (v) => {
    if (!v) hideUntilMs.value = 0
})


async function poll() {
    const s = store.schedule
    if (!s?.enabled || !s?.dailyLimitEnabled) return
    await store.loadSchedule()
}

function onDismiss() {
    hideUntilMs.value = Date.now() + 5 * 60 * 1000
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

onMounted(() => {
    void poll()
    pollTimer = window.setInterval(() => void poll(), POLL_MS)
})

onUnmounted(() => {
    if (pollTimer) window.clearInterval(pollTimer)
})
</script>

<style scoped>
.st-ex-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}
.st-ex-modal {
    background: #fff;
    border-radius: 10px;
    width: 480px;
    max-width: 92vw;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22);
    overflow: hidden;
}
.st-ex-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e0e0e0;
    font-size: 15px;
}
.st-ex-body {
    padding: 20px;
    font-size: 13.5px;
    line-height: 1.55;
}
.st-ex-footer {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid #e0e0e0;
}
.st-ex-field {
    margin-bottom: 12px;
}
.st-ex-field-narrow {
    max-width: 200px;
}
.st-ex-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #616161;
    margin-bottom: 4px;
}
</style>
