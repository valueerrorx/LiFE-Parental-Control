<template>
    <div class="d-flex h-100">
        <div class="flex-grow-1 d-flex flex-column overflow-hidden border-end">
            <div class="overflow-auto flex-grow-1">
                <div
                    v-for="profile in store.profiles"
                    :key="profile"
                    class="pc-list-item"
                    :class="{ 'selected': selectedProfile === profile }"
                    @click="selectedProfile = profile"
                >
                    <div class="item-icon" :style="selectedProfile === profile ? 'background:#1565C0;color:#fff;' : ''">
                        <i class="bi bi-lock" />
                    </div>
                    <div class="flex-grow-1 item-name">{{ profile }}</div>
                </div>
            </div>
            <div class="px-3 py-2 border-top text-muted" style="font-size:12px;">{{ store.statusMessage || '\u00a0' }}</div>
        </div>

        <div class="d-flex flex-column gap-2 p-3" style="width:190px;flex-shrink:0;">
            <button class="btn-pc-outline text-start" @click="store.unloadProfile()">
                <i class="bi bi-x-circle me-1" />{{ $t('profiles.unload') }}
            </button>
            <button class="btn-pc-outline text-start" @click="onLoad">
                <i class="bi bi-folder2-open me-1" />{{ $t('profiles.loadSelected') }}
            </button>
            <button class="btn-pc-danger text-start" @click="onDelete">
                <i class="bi bi-trash me-1" />{{ $t('profiles.deleteProfile') }}
            </button>
            <hr class="my-1" />
            <button class="btn-pc-outline text-start" @click="onSave">
                <i class="bi bi-save me-1" />{{ $t('profiles.saveProfile') }}
            </button>
            <button class="btn-pc-outline text-start" @click="onSaveAs">
                <i class="bi bi-save2 me-1" />{{ $t('profiles.saveAs') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useKioskStore } from '../../stores/kioskStore.js'
import { useModal } from '../../composables/useModal.js'

const { t } = useI18n()
const store = useKioskStore()
const { confirm, prompt } = useModal()
const selectedProfile = ref(null)

async function onLoad() {
    if (!selectedProfile.value) { store.statusMessage = t('profiles.noProfileSelected'); return }
    await store.loadProfile(selectedProfile.value + '.profile')
}

async function onSave() {
    if (!selectedProfile.value) { store.statusMessage = t('profiles.noProfileSelected'); return }
    await store.saveProfile(selectedProfile.value + '.profile')
}

async function onSaveAs() {
    const name = await prompt(t('profiles.saveAsTitle'), t('profiles.saveAsLabel'))
    if (!name) return
    const clean = name.trim().replace(/\.profile$/i, '')
    if (clean) await store.saveProfile(clean + '.profile')
}

async function onDelete() {
    if (!selectedProfile.value) { store.statusMessage = t('profiles.noProfileSelected'); return }
    const ok = await confirm(t('profiles.deleteConfirmTitle'), t('profiles.deleteConfirmMsg', { profile: selectedProfile.value }))
    if (!ok) return
    await store.deleteProfile(selectedProfile.value + '.profile')
    selectedProfile.value = null
}
</script>

<style scoped>
.pc-list-item.selected { background: #E3F2FD; }
</style>
