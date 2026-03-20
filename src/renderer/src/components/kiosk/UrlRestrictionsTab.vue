<template>
    <div class="d-flex h-100">
        <div class="flex-grow-1 overflow-auto border-end">
            <div
                v-for="(item, index) in store.urlItems"
                :key="index"
                class="pc-list-item"
                :class="{ 'selected': selectedIndex === index }"
                @click="selectedIndex = index"
            >
                <div class="item-icon" style="background:#FFF8E1;color:#F57F17;">
                    <i class="bi bi-folder" />
                </div>
                <span class="flex-grow-1 item-name text-truncate" style="max-width:300px;">{{ item.path }}</span>
                <div class="form-check mb-0 flex-shrink-0 me-2" @click.stop>
                    <input :id="`url-${index}`" v-model="item.allowed" type="checkbox" class="form-check-input" />
                    <label :for="`url-${index}`" class="form-check-label" style="font-size:12px;">Allow</label>
                </div>
            </div>
            <div v-if="store.urlItems.length === 0" class="text-center text-muted py-5">
                <i class="bi bi-folder-x" style="font-size:40px;opacity:0.3;" />
                <p class="mt-2">No URL restrictions set.</p>
            </div>
        </div>

        <div class="d-flex flex-column gap-2 p-3" style="width:190px;flex-shrink:0;">
            <button class="btn-pc-danger text-start" @click="onRemove">
                <i class="bi bi-x-circle me-1" />Remove
            </button>
            <button class="btn-pc-outline text-start" @click="onAdd">
                <i class="bi bi-folder-plus me-1" />Add Restriction
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { useKioskStore } from '../../stores/kioskStore.js'

const store = useKioskStore()
const selectedIndex = ref(null)

async function onAdd() {
    const dirPath = await window.api.system.openDirectory()
    if (dirPath) store.addUrl(dirPath)
}

function onRemove() {
    if (selectedIndex.value === null) return
    store.removeUrl(selectedIndex.value)
    selectedIndex.value = null
}
</script>

<style scoped>
.pc-list-item.selected { background: #E3F2FD; }
</style>
