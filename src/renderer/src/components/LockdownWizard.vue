<template>
    <div class="pc-lockscreen lockdown-wizard-overlay">
        <Transition name="pc-lock-fade" appear>
            <div class="lock-card lockdown-card">

                <!-- Step 0: Welcome + user selection -->
                <template v-if="step === 0">
                    <div class="lock-icon"><i class="bi bi-shield-exclamation" /></div>
                    <h2>{{ $t('lockdown.title') }}</h2>
                    <p class="text-muted small mb-3">{{ $t('lockdown.intro') }}</p>

                    <div class="text-start mb-3">
                        <label class="form-label small text-muted">{{ $t('lockdown.targetUserLabel') }}</label>
                        <select v-model="targetUser" class="pc-input">
                            <option value="" disabled>{{ $t('lockdown.selectUser') }}</option>
                            <option v-for="u in loginUsers" :key="u" :value="u">{{ u }}</option>
                        </select>
                    </div>

                    <p v-if="stepError" class="text-danger small mb-2">{{ stepError }}</p>

                    <div class="d-flex gap-2 mt-2">
                        <button class="btn-pc-outline flex-fill" @click="onSkip">{{ $t('lockdown.skipForNow') }}</button>
                        <button class="btn-pc-primary flex-fill" :disabled="!targetUser || busy" @click="onAnalyze">
                            <span v-if="busy" class="spinner-border spinner-border-sm me-1" />
                            {{ $t('lockdown.analyzeBtn') }}
                        </button>
                    </div>
                </template>

                <!-- Step 1: Show findings + todo list + credential input -->
                <template v-else-if="step === 1">
                    <div class="lock-icon"><i class="bi bi-list-check" /></div>
                    <h2>{{ $t('lockdown.todoTitle') }}</h2>
                    <p class="text-muted small mb-3">{{ $t('lockdown.todoIntro') }}</p>

                    <!-- Findings checklist (informational, dynamic) -->
                    <div class="lockdown-todo-list mb-3">
                        <div class="lockdown-todo-item">
                            <i class="bi bi-person-dash-fill text-warning me-2" />
                            {{ $t('lockdown.todoFirstUser', { user: findings.targetUser || targetUser }) }}
                        </div>
                        <div v-if="findings.suidFiles?.length" class="lockdown-todo-item">
                            <i class="bi bi-exclamation-triangle-fill text-warning me-2" />
                            {{ $t('lockdown.todoSuid', { count: findings.suidFiles.length }) }}
                        </div>
                        <div v-if="!findings.rootPasswordSet" class="lockdown-todo-item">
                            <i class="bi bi-key-fill text-danger me-2" />
                            {{ $t('lockdown.todoRootPw') }}
                        </div>
                        <div class="lockdown-todo-item">
                            <i class="bi bi-person-plus-fill text-info me-2" />
                            {{ $t(useExistingAdmin ? 'lockdown.todoUseAdmin' : 'lockdown.todoCreateAdmin', { user: adminUser || '…' }) }}
                        </div>
                        <div v-if="!findings.grubPasswordSet" class="lockdown-todo-item">
                            <i class="bi bi-hdd-fill text-secondary me-2" />
                            {{ $t('lockdown.todoGrub') }}
                        </div>
                        <div class="lockdown-todo-item">
                            <i class="bi bi-box-seam text-warning me-2" />
                            {{ $t('lockdown.todoFuseRestrict', { user: findings.targetUser || targetUser }) }}
                        </div>
                    </div>

                    <!-- Admin account selection -->
                    <div class="text-start mb-3">
                        <!-- Mode toggle: only show if existing admins are available -->
                        <div v-if="existingAdmins.length > 0" class="d-flex gap-3 mb-2">
                            <div class="form-check">
                                <input id="admin-mode-new" v-model="useExistingAdmin" :value="false"
                                       class="form-check-input" type="radio" />
                                <label class="form-check-label small" for="admin-mode-new">
                                    {{ $t('lockdown.adminModeNew') }}
                                </label>
                            </div>
                            <div class="form-check">
                                <input id="admin-mode-existing" v-model="useExistingAdmin" :value="true"
                                       class="form-check-input" type="radio" />
                                <label class="form-check-label small" for="admin-mode-existing">
                                    {{ $t('lockdown.adminModeExisting') }}
                                </label>
                            </div>
                        </div>

                        <!-- New admin: username input (with duplicate check) -->
                        <template v-if="!useExistingAdmin">
                            <label class="form-label small text-muted">{{ $t('lockdown.adminUserLabel') }}</label>
                            <input v-model="adminUser" type="text" class="pc-input mb-1"
                                   :placeholder="$t('lockdown.adminUserPlaceholder')"
                                   :class="{ 'is-invalid': adminUserConflict }" />
                            <p v-if="adminUserConflict" class="text-danger small mb-2">
                                {{ $t('lockdown.adminUserConflict', { user: adminUser }) }}
                            </p>
                            <div v-else class="mb-2" />
                        </template>

                        <!-- Existing admin: dropdown -->
                        <template v-else>
                            <label class="form-label small text-muted">{{ $t('lockdown.adminUserExistingLabel') }}</label>
                            <select v-model="adminUser" class="pc-input mb-2">
                                <option value="" disabled>{{ $t('lockdown.selectUser') }}</option>
                                <option v-for="u in existingAdmins" :key="u" :value="u">{{ u }}</option>
                            </select>
                        </template>

                        <label class="form-label small text-muted" for="lockdown-admin-pw">
                            {{ $t(useExistingAdmin ? 'lockdown.adminPwLabelRootOnly' : 'lockdown.adminPwLabel') }}
                        </label>
                        <div class="pc-pw-wrap mb-2">
                            <input id="lockdown-admin-pw" v-model="adminPw"
                                   :type="showAdminPw ? 'text' : 'password'" class="pc-input"
                                   :placeholder="$t('lockdown.adminPwPlaceholder')" autocomplete="new-password" />
                            <button type="button" class="pc-pw-toggle"
                                    :aria-label="showAdminPw ? $t('common.hidePassword') : $t('common.showPassword')"
                                    :aria-pressed="showAdminPw" @click="showAdminPw = !showAdminPw">
                                <i :class="showAdminPw ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true" />
                            </button>
                        </div>

                        <label class="form-label small text-muted" for="lockdown-admin-pw2">{{ $t('lockdown.adminPwConfirmLabel') }}</label>
                        <div class="pc-pw-wrap">
                            <input id="lockdown-admin-pw2" v-model="adminPwConfirm"
                                   :type="showAdminPwConfirm ? 'text' : 'password'" class="pc-input"
                                   :placeholder="$t('lockdown.adminPwConfirmPlaceholder')" autocomplete="new-password" />
                            <button type="button" class="pc-pw-toggle"
                                    :aria-label="showAdminPwConfirm ? $t('common.hidePassword') : $t('common.showPassword')"
                                    :aria-pressed="showAdminPwConfirm" @click="showAdminPwConfirm = !showAdminPwConfirm">
                                <i :class="showAdminPwConfirm ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    <!-- Optional permissions for the restricted user -->
                    <div class="text-start mb-3">
                        <div class="form-label small text-muted mb-1">{{ $t('lockdown.optionsLabel') }}</div>
                        <div class="form-check">
                            <input id="opt-install" v-model="allowInstall" class="form-check-input" type="checkbox" />
                            <label class="form-check-label small" for="opt-install">
                                {{ $t('lockdown.optionInstall') }}
                                <span v-if="findings.packageKitAvailable" class="text-muted ms-1">({{ $t('lockdown.optionHintGui') }})</span>
                                <span v-else class="text-warning ms-1">({{ $t('lockdown.optionHintTerminalOnly') }})</span>
                            </label>
                        </div>
                        <div class="form-check">
                            <input id="opt-update" v-model="allowUpdate" class="form-check-input" type="checkbox" />
                            <label class="form-check-label small" for="opt-update">
                                {{ $t('lockdown.optionUpdate') }}
                                <span v-if="findings.packageKitAvailable" class="text-muted ms-1">({{ $t('lockdown.optionHintGui') }})</span>
                                <span v-else class="text-warning ms-1">({{ $t('lockdown.optionHintTerminalOnly') }})</span>
                            </label>
                        </div>
                        <div class="form-check">
                            <input id="opt-fuse" v-model="allowFuse" class="form-check-input" type="checkbox" />
                            <label class="form-check-label small" for="opt-fuse">
                                {{ $t('lockdown.optionFuse') }}
                            </label>
                        </div>
                    </div>

                    <!-- Acknowledgement checkbox -->
                    <div class="form-check text-start mb-3">
                        <input id="lockdown-ack" v-model="acknowledged" class="form-check-input" type="checkbox" />
                        <label class="form-check-label small lockdown-ack-label" for="lockdown-ack">
                            {{ $t('lockdown.ackLabel') }}
                        </label>
                    </div>

                    <p v-if="stepError" class="text-danger small mb-2">{{ stepError }}</p>

                    <div class="d-flex gap-2 mt-1">
                        <button class="btn-pc-outline" @click="step = 0">{{ $t('common.back') }}</button>
                        <button class="btn-pc-primary flex-fill"
                                :disabled="!acknowledged || !adminUser || !adminPw || adminUserConflict || busy"
                                @click="onExecute">
                            <span v-if="busy" class="spinner-border spinner-border-sm me-1" />
                            {{ $t('lockdown.executeBtn') }}
                        </button>
                    </div>
                </template>

                <!-- Step 2: Success -->
                <template v-else-if="step === 2">
                    <div class="lock-icon"><i class="bi bi-shield-check-fill text-success" /></div>
                    <h2>{{ $t('lockdown.doneTitle') }}</h2>
                    <p class="small text-muted mb-3">{{ $t('lockdown.doneText', { adminUser, targetUser }) }}</p>
                    <button class="btn-pc-primary w-100" @click="onClose">{{ $t('lockdown.doneBtn') }}</button>
                </template>

            </div>
        </Transition>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const emit = defineEmits(['close'])

const step = ref(0)
const busy = ref(false)
const stepError = ref('')

const loginUsers = ref([])
const targetUser = ref('')
const adminUser = ref('parentadmin')
const adminPw = ref('')
const adminPwConfirm = ref('')
const acknowledged = ref(false)
const findings = ref({})
const useExistingAdmin = ref(false)
const allowInstall = ref(false)
const allowUpdate = ref(false)
const allowFuse = ref(false)
const showAdminPw = ref(false)
const showAdminPwConfirm = ref(false)

// Existing sudo/wheel members minus the target user
const existingAdmins = computed(() => findings.value.adminGroupMembers ?? [])

// Warn if a new admin username already exists as a system user
const adminUserConflict = computed(() => {
    if (useExistingAdmin.value) return false
    if (!adminUser.value) return false
    return loginUsers.value.includes(adminUser.value)
})

onMounted(async () => {
    try {
        const result = await window.api.system.listDesktopLoginUsers()
        loginUsers.value = result?.users ?? []
    } catch {
        loginUsers.value = []
    }
})

async function onAnalyze() {
    stepError.value = ''
    busy.value = true
    try {
        const result = await window.api.lockdown.analyze(targetUser.value)
        if (!result.ok) { stepError.value = result.error || t('lockdown.analyzeError'); return }
        findings.value = result.findings
        // Auto-select mode: if existing admins are present, default to picking one
        useExistingAdmin.value = (result.findings.adminGroupMembers?.length ?? 0) > 0
        if (useExistingAdmin.value) adminUser.value = result.findings.adminGroupMembers[0]
        step.value = 1
    } finally {
        busy.value = false
    }
}

async function onExecute() {
    stepError.value = ''
    if (adminPw.value !== adminPwConfirm.value) {
        stepError.value = t('lockdown.pwMismatch')
        return
    }
    if (adminPw.value.length < 8) {
        stepError.value = t('lockdown.pwTooShort')
        return
    }
    if (adminUserConflict.value) {
        stepError.value = t('lockdown.adminUserConflict', { user: adminUser.value })
        return
    }

    busy.value = true
    try {
        const result = await window.api.lockdown.execute({
            targetUser: targetUser.value,
            adminUser: adminUser.value,
            adminPw: adminPw.value,
            allowInstall: allowInstall.value,
            allowUpdate: allowUpdate.value,
            allowFuse: allowFuse.value,
        })
        if (!result.ok) { stepError.value = result.error || t('lockdown.executeError'); return }
        step.value = 2
    } finally {
        busy.value = false
        adminPw.value = ''
        adminPwConfirm.value = ''
        showAdminPw.value = false
        showAdminPwConfirm.value = false
    }
}

function onSkip() {
    emit('close') // skip: don't persist, wizard reappears next unlock
}

function onClose() {
    emit('close')
}
</script>

<style scoped>
.lockdown-wizard-overlay {
    z-index: 9000;
}

.lockdown-card {
    max-width: 520px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
}

.lockdown-todo-list {
    background: var(--pc-surface-2, rgba(255,255,255,0.04));
    border-radius: 8px;
    padding: 0.75rem 1rem;
    text-align: left;
}

.lockdown-todo-item {
    padding: 0.35rem 0;
    font-size: 0.875rem;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
}

.lockdown-todo-item:last-child {
    border-bottom: none;
}

.lockdown-ack-label {
    color: var(--pc-danger, #8b0000);
}
</style>
