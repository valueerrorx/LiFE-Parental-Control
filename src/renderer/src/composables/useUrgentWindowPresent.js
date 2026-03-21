import { watch, onUnmounted, unref } from 'vue'

/** Pushes the main BrowserWindow on top (incl. KDE screen-saver level) while a blocking screen-time modal is visible. */
export function useUrgentWindowPresent(visibleRef) {
    watch(
        () => unref(visibleRef),
        (v) => {
            if (v) void window.api.system.beginUrgentPresent()
            else void window.api.system.endUrgentPresent()
        },
        { immediate: true }
    )
    onUnmounted(() => {
        if (unref(visibleRef)) void window.api.system.endUrgentPresent()
    })
}
