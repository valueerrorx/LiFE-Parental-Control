<template>
    <!-- Password gate — shown before router-view -->
    <div v-if="!unlocked" class="pc-lockscreen">
        <div class="lock-card">
            <div class="lock-icon">
                <i class="bi bi-shield-lock-fill" />
            </div>
            <h2>LiFE Parental Control</h2>

            <!-- First-run: set a password -->
            <template v-if="!passwordSet">
                <p>Create a password to protect parental control settings.</p>
                <div class="text-start mb-3">
                    <label class="form-label small text-muted">New password</label>
                    <input v-model="pw1" type="password" class="pc-input mb-2" placeholder="Enter password"
                           @keyup.enter="onSetPassword" />
                    <label class="form-label small text-muted">Confirm password</label>
                    <input v-model="pw2" type="password" class="pc-input" placeholder="Repeat password"
                           @keyup.enter="onSetPassword" />
                </div>
                <p v-if="error" class="text-danger small">{{ error }}</p>
                <button class="btn-pc-primary w-100" @click="onSetPassword">Set Password & Continue</button>
            </template>

            <!-- Normal unlock -->
            <template v-else>
                <p>Enter your parental control password to continue.</p>
                <div class="text-start mb-3">
                    <input v-model="password" type="password" class="pc-input" placeholder="Password"
                           autofocus @keyup.enter="onUnlock" />
                </div>
                <p v-if="error" class="text-danger small">{{ error }}</p>
                <button class="btn-pc-primary w-100" @click="onUnlock" :disabled="busy">Unlock</button>
                <button class="btn-pc-outline w-100 mt-2" @click="onExit">Exit</button>
            </template>
        </div>
    </div>

    <div v-else @pointerdown="onUserActivity">
        <router-view />
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const unlocked = ref(false)
const passwordSet = ref(false)
const password = ref('')
const pw1 = ref('')
const pw2 = ref('')
const error = ref('')
const busy = ref(false)
const lockIdleMs = ref(0)
let idleTimer = null

function idleMsFromConfig(cfg) {
    const m = Number(cfg?.lockIdleMinutes)
    if (!Number.isFinite(m) || m < 0) return 15 * 60 * 1000
    if (m === 0) return 0
    return Math.min(120, m) * 60 * 1000
}

function clearIdleLockTimer() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
}

function scheduleIdleLock() {
    clearIdleLockTimer()
    if (!unlocked.value || !passwordSet.value || lockIdleMs.value <= 0) return
    idleTimer = setTimeout(() => {
        idleTimer = null
        unlocked.value = false
        password.value = ''
        error.value = ''
    }, lockIdleMs.value)
}

function onUserActivity() {
    scheduleIdleLock()
}

onMounted(async () => {
    passwordSet.value = await window.api.settings.isPasswordSet()
    window.addEventListener('wheel', onUserActivity, { passive: true })
    window.addEventListener('keydown', onUserActivity)
    window.addEventListener('life-parental-lock-prefs', onLockPrefsChanged)
})

onUnmounted(() => {
    window.removeEventListener('wheel', onUserActivity)
    window.removeEventListener('keydown', onUserActivity)
    window.removeEventListener('life-parental-lock-prefs', onLockPrefsChanged)
    clearIdleLockTimer()
})

function onLockPrefsChanged() {
    if (unlocked.value && passwordSet.value) void applyUnlockIdlePolicy()
}

watch(unlocked, (open) => {
    if (!open) clearIdleLockTimer()
})

async function applyUnlockIdlePolicy() {
    const cfg = await window.api.settings.getConfig()
    lockIdleMs.value = idleMsFromConfig(cfg)
    scheduleIdleLock()
}

async function onSetPassword() {
    error.value = ''
    if (!pw1.value) { error.value = 'Password cannot be empty'; return }
    if (pw1.value !== pw2.value) { error.value = 'Passwords do not match'; return }
    await window.api.settings.setPassword(pw1.value)
    passwordSet.value = true
    unlocked.value = true
    pw1.value = pw2.value = ''
    await applyUnlockIdlePolicy()
}

async function onUnlock() {
    if (!password.value) { error.value = 'Enter your password'; return }
    busy.value = true
    const ok = await window.api.settings.checkPassword(password.value)
    busy.value = false
    if (ok) {
        unlocked.value = true
        error.value = ''
        password.value = ''
        await applyUnlockIdlePolicy()
    } else {
        error.value = 'Incorrect password'
        password.value = ''
    }
}

function onExit() {
    window.api.system.quit()
}
</script>
