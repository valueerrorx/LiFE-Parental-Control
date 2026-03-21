<template>
    <div class="d-flex h-100 flex-column">
        <p class="small text-muted border-bottom mb-0 px-3 py-2" style="flex-shrink:0;">
            Listed folders are <strong>blocked</strong> for KDE apps using KIO (not a web URL list).
        </p>
        <div class="d-flex flex-grow-1" style="min-height:0;">
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
                </div>
                <div v-if="store.urlItems.length === 0" class="text-center text-muted py-5">
                    <i class="bi bi-folder-x" style="font-size:40px;opacity:0.3;" />
                    <p class="mt-2">No blocked paths.</p>
                    <p class="small px-3 mb-0">Each entry denies <code>open</code>/<code>list</code> for that folder via KDE URL rules (<code>file:</code>).</p>
                </div>
            </div>

            <div class="d-flex flex-column gap-2 p-3" style="width:190px;flex-shrink:0;">
                <button class="btn-pc-danger text-start" @click="onRemove">
                    <i class="bi bi-x-circle me-1" />Remove
                </button>
                <button class="btn-pc-outline text-start" @click="onAdd">
                    <i class="bi bi-folder-plus me-1" />Add blocked path
                </button>
            </div>
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
