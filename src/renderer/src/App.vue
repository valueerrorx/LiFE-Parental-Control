<template>
    <AppModal />
    <!-- Daemon setup phase: installing or waiting for daemon to become ready -->
    <div v-if="daemonSetupPhase" class="pc-lockscreen">
        <Transition name="pc-lock-fade" appear>
            <div class="lock-card">
                <div class="lock-icon">
                    <i class="bi bi-shield-lock-fill" />
                </div>
                <h2>LiFE Parental Control</h2>
                <div class="lock-card-phase">
                    <p>{{ daemonSetupMsg }}</p>
                    <p v-if="daemonSetupError" class="text-danger small">{{ daemonSetupError }}</p>
                    <div v-if="!daemonSetupError" class="d-flex justify-content-center mt-3">
                        <div class="spinner-border spinner-border-sm text-secondary" role="status" />
                    </div>
                    <button v-if="daemonSetupError" class="btn-pc-primary w-100 mt-3" @click="runDaemonSetup">
                        {{ $t('app.daemonRetry') }}
                    </button>
                </div>
            </div>
        </Transition>
    </div>

    <!-- First-run: no password yet — full gate, no dashboard -->
    <div v-else-if="!passwordSet" class="pc-lockscreen">
        <Transition name="pc-lock-fade" appear>
            <div class="lock-card">
                <div class="lock-icon">
                    <i class="bi bi-shield-lock-fill" />
                </div>
                <h2>LiFE Parental Control</h2>
                <div class="lock-card-phase">
                    <p>{{ $t('app.createPassword') }}</p>
                    <div class="text-start mb-3">
                        <label class="form-label small text-muted">{{ $t('app.newPassword') }}</label>
                        <input v-model="pw1" type="password" class="pc-input mb-2" :placeholder="$t('app.enterPasswordPlaceholder')"
                               @keyup.enter="onSetPassword" />
                        <label class="form-label small text-muted">{{ $t('app.confirmPassword') }}</label>
                        <input v-model="pw2" type="password" class="pc-input" :placeholder="$t('app.repeatPasswordPlaceholder')"
                               @keyup.enter="onSetPassword" />
                    </div>
                    <p v-if="error" class="text-danger small">{{ error }}</p>
                    <button class="btn-pc-primary w-100" @click="onSetPassword">{{ $t('app.setPassword') }}</button>
                </div>
            </div>
        </Transition>
    </div>

    <!-- Lockdown wizard: shown after unlock until parent completes or dismisses it -->
    <LockdownWizard v-else-if="passwordSet && showLockdownWizard" @close="onLockdownWizardClose" />

    <!-- Password set: dashboard always mounted; session lock is a pale overlay -->
    <div v-else-if="passwordSet" class="pc-app-shell">
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
                    <p>{{ $t('app.enterToUnlock') }}</p>
                    <div class="text-start mb-3">
                        <input v-model="password" type="password" class="pc-input" :placeholder="$t('app.passwordPlaceholder')"
                               autofocus @keyup.enter="onUnlock" />
                    </div>
                    <p v-if="error" class="text-danger small">{{ error }}</p>
                    <button class="btn-pc-primary w-100" @click="onUnlock" :disabled="busy">{{ $t('app.unlock') }}</button>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { normalizedLockIdleMinutesOrUndefined } from '@shared/lockIdleMinutes.js'
import AppModal from './components/AppModal.vue'
import LockdownWizard from './components/LockdownWizard.vue'
import { useModal } from './composables/useModal.js'
import { quitWithParentPassword } from './parentQuit.js'

const isDevRelaxSessionLock = import.meta.env.DEV

const { t } = useI18n()
const { prompt } = useModal()

const unlocked = ref(false)
const passwordSet = ref(false)
const showLockdownWizard = ref(false)
const password = ref('')
const pw1 = ref('')
const pw2 = ref('')
const error = ref('')
const busy = ref(false)
const lockIdleMs = ref(0)
let idleTimer = null

// Daemon setup phase
const daemonSetupPhase = ref(false)
const daemonSetupMsg = ref('')
const daemonSetupError = ref('')

function quitRequestListener() {
    void handleQuitRequest()
}

function sessionLockListener() {
    if (isDevRelaxSessionLock) return
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

async function runDaemonSetup() {
    daemonSetupError.value = ''

    // Check installed version vs. app version
    daemonSetupMsg.value = t('app.daemonChecking')
    let versionInfo = null
    try {
        versionInfo = await window.api.daemon.checkInstalledVersion()
    } catch {
        versionInfo = { ok: false, upToDate: false, installedVersion: null }
    }

    const connected = await window.api.daemon.isConnected()

    // If daemon is connected and up-to-date, we're done
    if (connected && versionInfo?.upToDate) {
        daemonSetupPhase.value = false
        passwordSet.value = await window.api.settings.isPasswordSet()
        if (isDevRelaxSessionLock && passwordSet.value) {
            unlocked.value = true
            lockIdleMs.value = 0
        }
        return
    }

    // Step 3: install/update daemon via pkexec
    daemonSetupMsg.value = versionInfo?.installedVersion
        ? t('app.daemonUpdating')
        : t('app.daemonInstalling')

    const result = await window.api.daemon.serviceControl({ action: 'install' })
    if (result?.error) {
        daemonSetupError.value = result.error
        return
    }

    // Step 4: wait briefly and re-check connection
    daemonSetupMsg.value = t('app.daemonWaiting')
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1500))
        const ok = await window.api.daemon.isConnected()
        if (ok) break
    }

    daemonSetupPhase.value = false
    passwordSet.value = await window.api.settings.isPasswordSet()
    if (isDevRelaxSessionLock && passwordSet.value) {
        unlocked.value = true
        lockIdleMs.value = 0
    }
}

onMounted(async () => {
    window.addEventListener('wheel', onUserActivity, { passive: true })
    window.addEventListener('keydown', onUserActivity)
    window.addEventListener('life-parental-lock-prefs', onLockPrefsChanged)
    window.api.system.onQuitRequest(quitRequestListener)
    window.api.system.onSessionLockRequest(sessionLockListener)

    // Trigger heavy IPC registration and wait for it so daemon:* handlers are available
    await window.api.app.deferredHeavyWork()

    // Check whether daemon is reachable and version matches before showing UI
    let needsSetup = false
    try {
        const [connected, versionInfo] = await Promise.all([
            window.api.daemon.isConnected(),
            window.api.daemon.checkInstalledVersion()
        ])
        needsSetup = !connected || !versionInfo?.upToDate
    } catch {
        needsSetup = true
    }

    if (needsSetup) {
        daemonSetupPhase.value = true
        await runDaemonSetup()
    } else {
        passwordSet.value = await window.api.settings.isPasswordSet()
        if (isDevRelaxSessionLock && passwordSet.value) {
            unlocked.value = true
            lockIdleMs.value = 0
            await checkLockdownWizard()
        }
    }
})

onUnmounted(() => {
    window.removeEventListener('wheel', onUserActivity)
    window.removeEventListener('keydown', onUserActivity)
    window.removeEventListener('life-parental-lock-prefs', onLockPrefsChanged)
    window.api.system.offQuitRequest(quitRequestListener)
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
    if (isDevRelaxSessionLock) {
        lockIdleMs.value = 0
        clearIdleLockTimer()
        return
    }
    const cfg = await window.api.settings.getConfig()
    lockIdleMs.value = idleMsFromConfig(cfg)
    scheduleIdleLock()
}

async function onSetPassword() {
    error.value = ''
    if (!pw1.value) { error.value = t('app.passwordEmpty'); return }
    if (pw1.value !== pw2.value) { error.value = t('app.passwordMismatch'); return }
    await window.api.settings.setPassword(pw1.value)
    passwordSet.value = true
    unlocked.value = true
    pw1.value = pw2.value = ''
    await applyUnlockIdlePolicy()
    await checkLockdownWizard()
}

async function onUnlock() {
    if (!password.value) { error.value = t('app.enterYourPassword'); return }
    busy.value = true
    const ok = await window.api.settings.checkPassword(password.value)
    busy.value = false
    if (ok) {
        unlocked.value = true
        error.value = ''
        password.value = ''
        await applyUnlockIdlePolicy()
        await checkLockdownWizard()
    } else {
        error.value = t('app.incorrectPassword')
        password.value = ''
    }
}

async function handleQuitRequest() {
    await quitWithParentPassword(prompt)
}

/** Check if lockdown wizard should be shown (only after the user is unlocked). */
async function checkLockdownWizard() {
    try {
        const finished = await window.api.lockdown.isFinished()
        showLockdownWizard.value = !finished
    } catch {
        showLockdownWizard.value = false
    }
}

function onLockdownWizardClose() {
    showLockdownWizard.value = false
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
