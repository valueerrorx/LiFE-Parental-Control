import { onUnmounted, shallowRef } from 'vue'

/** @type {import('vue').ShallowRef<{ id: number, isDirty: import('vue').Ref<boolean>, onSave: () => Promise<void> } | null>} */
const activeGuard = shallowRef(null)
let nextId = 0

/** Tracks the active route page's unsaved state so app quit (X / menu) can reuse the same guard. */
export function registerUnsavedQuitGuard(isDirty, onSave) {
    const id = ++nextId
    const entry = { id, isDirty, onSave }
    activeGuard.value = entry
    onUnmounted(() => {
        if (activeGuard.value?.id === id) activeGuard.value = null
    })
}

export function getActiveUnsavedQuitGuard() {
    return activeGuard.value
}
