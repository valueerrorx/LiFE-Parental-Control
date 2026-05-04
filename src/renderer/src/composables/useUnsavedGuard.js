import { onBeforeRouteLeave } from 'vue-router'
import { promptUnsavedChanges } from './unsavedPrompt.js'
import { registerUnsavedQuitGuard } from './unsavedQuitRegistry.js'

/**
 * Call this inside a page's <script setup> to show a "You have unsaved changes"
 * modal when the user navigates away while isDirty is true.
 *
 * @param {import('vue').ComputedRef<boolean>} isDirty
 * @param {() => Promise<void>} onSave  - the page's existing save function
 */
export function useUnsavedGuard(isDirty, onSave) {
    registerUnsavedQuitGuard(isDirty, onSave)

    onBeforeRouteLeave(async () => {
        if (!isDirty.value) return true
        return promptUnsavedChanges(onSave)
    })
}
