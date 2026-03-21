<template>
    <AppModal />
    <!-- First-run: no password yet — full gate, no dashboard -->
    <div v-if="!passwordSet" class="pc-lockscreen">
        <Transition name="pc-lock-fade" appear>
            <div class="lock-card">
                <div class="lock-icon">
                    <i class="bi bi-shield-lock-fill" />
                </div>
                <h2>LiFE Parental Control</h2>
                <div class="lock-card-phase">
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
                </div>
            </div>
        </Transition>
    </div>

    <!-- Password set: dashboard always mounted; session lock is a pale overlay -->
    <div v-else class="pc-app-shell">
        <div
            class="pc-app-shell-main"
            :class="{ 'pc-app-shell-main--locked': !unlocked }"
            :inert="!unlocked"
            @pointerdown="onUserActivity"
        >
            <router-view />
        </div>
        <Transition name="pc-session-overlay-fade">
            <div v-if="!unlocked" class="pc-session-overlay">
                <div class="lock-card">
                    <div class="lock-icon">
                        <i class="bi bi-shield-lock-fill" />
                    </div>
                    <h2>LiFE Parental Control</h2>
                    <p>Enter your parental control password to continue.</p>
                    <div class="text-start mb-3">
                        <input v-model="password" type="password" class="pc-input" placeholder="Password"
                               autofocus @keyup.enter="onUnlock" />
                    </div>
                    <p v-if="error" class="text-danger small">{{ error }}</p>
                    <button class="btn-pc-primary w-100" @click="onUnlock" :disabled="busy">Unlock</button>
                    <button class="btn-pc-outline w-100 mt-2" @click="onExit">Exit</button>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { normalizedLockIdleMinutesOrUndefined } from '@shared/lockIdleMinutes.js'
import AppModal from './components/AppModal.vue'
import { useModal } from './composables/useModal.js'
import { quitWithParentPassword } from './parentQuit.js'

const { prompt } = useModal()

const unlocked = ref(false)
const passwordSet = ref(false)
const password = ref('')
const pw1 = ref('')
const pw2 = ref('')
const error = ref('')
const busy = ref(false)
const lockIdleMs = ref(0)
let idleTimer = null

function trayQuitListener() {
    void handleQuitFromTray()
}

function sessionLockListener() {
    if (!passwordSet.value) return
    unlocked.value = false
    password.value = ''
    error.value = ''
}


function idleMsFromConfig(cfg) {
    const m = normalizedLockIdleMinutesOrUndefined(cfg?.lockIdleMinutes)
    if (m === undefined) return 15 * 60 * 1000
    if (m === 0) return 0
    return m * 60 * 1000
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
    void window.api.app.deferredHeavyWork()
    window.addEventListener('wheel', onUserActivity, { passive: true })
    window.addEventListener('keydown', onUserActivity)
    window.addEventListener('life-parental-lock-prefs', onLockPrefsChanged)
    window.api.system.onQuitFromTray(trayQuitListener)
    window.api.system.onSessionLockRequest(sessionLockListener)
})

onUnmounted(() => {
    window.removeEventListener('wheel', onUserActivity)
    window.removeEventListener('keydown', onUserActivity)
    window.removeEventListener('life-parental-lock-prefs', onLockPrefsChanged)
    window.api.system.offQuitFromTray(trayQuitListener)
    window.api.system.offSessionLockRequest(sessionLockListener)
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

async function handleQuitFromTray() {
    await quitWithParentPassword(prompt)
}

async function onExit() {
    await quitWithParentPassword(prompt)
}
</script>

<style scoped>
/* Soft entrance for password gate; inner Transition crossfades setup ↔ unlock. */
.pc-lock-fade-enter-active,
.pc-lock-fade-appear-active {
    transition: opacity 0.45s ease, transform 0.45s ease;
}

.pc-lock-fade-enter-from,
.pc-lock-fade-appear-from {
    opacity: 0;
    transform: translateY(12px);
}

.lock-card-phase {
    min-height: 4.5rem;
}

.pc-session-overlay-fade-enter-active,
.pc-session-overlay-fade-leave-active {
    transition: opacity 0.28s ease;
}

.pc-session-overlay-fade-enter-from,
.pc-session-overlay-fade-leave-to {
    opacity: 0;
}
</style>
