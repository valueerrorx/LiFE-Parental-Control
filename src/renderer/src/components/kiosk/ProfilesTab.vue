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
                <i class="bi bi-x-circle me-1" />Unload
            </button>
            <button class="btn-pc-outline text-start" @click="onLoad">
                <i class="bi bi-folder2-open me-1" />Load Selected
            </button>
            <button class="btn-pc-danger text-start" @click="onDelete">
                <i class="bi bi-trash me-1" />Delete
            </button>
            <hr class="my-1" />
            <button class="btn-pc-outline text-start" @click="onSave">
                <i class="bi bi-save me-1" />Save Profile
            </button>
            <button class="btn-pc-outline text-start" @click="onSaveAs">
                <i class="bi bi-save2 me-1" />Save As…
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useKioskStore } from '../../stores/kioskStore.js'
import { useModal } from '../../composables/useModal.js'

const store = useKioskStore()
const { confirm, prompt } = useModal()
const selectedProfile = ref(null)

async function onLoad() {
    if (!selectedProfile.value) { store.statusMessage = 'No profile selected'; return }
    await store.loadProfile(selectedProfile.value + '.profile')
}

async function onSave() {
    if (!selectedProfile.value) { store.statusMessage = 'No profile selected'; return }
    await store.saveProfile(selectedProfile.value + '.profile')
}

async function onSaveAs() {
    const name = await prompt('Save As', 'Enter a profile name')
    if (name) await store.saveProfile(name + '.profile')
}

async function onDelete() {
    if (!selectedProfile.value) { store.statusMessage = 'No profile selected'; return }
    const ok = await confirm('Delete Profile', `Delete "${selectedProfile.value}.profile"?`)
    if (!ok) return
    await store.deleteProfile(selectedProfile.value + '.profile')
    selectedProfile.value = null
}
</script>

<style scoped>
.pc-list-item.selected { background: #E3F2FD; }
</style>
